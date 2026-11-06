// The live debug link reconnects. Runs via
//   -ExecCmds="Automation RunTests Patterplay.DebugLink"
//
// A close (or an attempt that never opens) is tried again after 1 s, doubling to at most 10 s; a hello puts
// the wait back to 1 s; the hello on a reconnect carries the current build and the flows open now; nothing is
// queued while the editor is away; a link the editor replaced (close code 4000) stays closed; and Close()
// stops the retries. Unreal has no WebSocket server to test against without another plugin, so the test plays
// the socket's part: it raises the events the link's socket handlers would (connected, closed with a code,
// failed to connect), reads the waits rather than sleeping through them, and catches what the link sends.

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "PatterDebugLink.h"
#include "HAL/PlatformTime.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

// The link's friend: the socket's events, the retry clock, and a sink for what it sends.
struct FPatterDebugLinkTestAccess
{
	static void CatchSends(FPatterDebugLink& Link, TArray<FString>* Sent) { Link.SentForTest = Sent; }
	static void Connected(FPatterDebugLink& Link) { Link.HandleConnected(); }
	static void Gone(FPatterDebugLink& Link, int32 StatusCode) { Link.HandleGone(StatusCode); }
	// Make the next attempt due now and let the ticker's check run, as it would on its next tick.
	static void RetryNow(FPatterDebugLink& Link)
	{
		if (Link.RetryAt > 0.0) Link.RetryAt = 1.0;
		Link.RetryTick();
	}
	static double SecondsToRetry(const FPatterDebugLink& Link) { return Link.RetryAt > 0.0 ? Link.RetryAt - FPlatformTime::Seconds() : 0.0; }
	static double NextWait(const FPatterDebugLink& Link) { return Link.RetryWait; }
	static bool Pending(const FPatterDebugLink& Link) { return Link.RetryAt > 0.0; }
	static int32 Queued(const FPatterDebugLink& Link) { return Link.Queue.Num(); }
	static bool Ticking(const FPatterDebugLink& Link) { return Link.RetryTicker.IsValid(); }
};

namespace
{
	TSharedPtr<FJsonObject> ParseJson(const FString& Text)
	{
		TSharedPtr<FJsonObject> Obj;
		const TSharedRef<TJsonReader<TCHAR>> Reader = TJsonReaderFactory<TCHAR>::Create(Text);
		FJsonSerializer::Deserialize(Reader, Obj);
		return Obj;
	}

	FString Field(const TSharedPtr<FJsonObject>& Obj, const TCHAR* Name)
	{
		FString Out;
		if (Obj.IsValid()) Obj->TryGetStringField(Name, Out);
		return Out;
	}

	TArray<FString> Flows(const TSharedPtr<FJsonObject>& Obj)
	{
		TArray<FString> Out;
		const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
		if (Obj.IsValid() && Obj->TryGetArrayField(TEXT("flows"), Values))
		{
			for (const TSharedPtr<FJsonValue>& V : *Values) Out.Add(V->AsString());
		}
		Out.Sort();
		return Out;
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPatterplayDebugLinkTest,
	"Patterplay.DebugLink",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FPatterplayDebugLinkTest::RunTest(const FString& Parameters)
{
	using A = FPatterDebugLinkTestAccess;
	// Nothing listens on port 1, so the real socket never gets anywhere; the test raises its events.
	TSharedRef<FPatterDebugLink> Link = FPatterDebugLink::Create(TEXT("h1"), TEXT("Smoke"), TEXT("ws://127.0.0.1:1"));
	TArray<FString> Sent;
	A::CatchSends(*Link, &Sent);
	TestEqual(TEXT("a new link is connecting"), Link->State(), FString(TEXT("connecting")));

	// Before the first socket opens, frames queue; on open the hello goes first, then them.
	Link->FlowOpened(TEXT("main"));
	TestEqual(TEXT("a frame queues while the first socket connects"), A::Queued(*Link), 1);
	A::Connected(*Link);
	if (TestEqual(TEXT("on open: the hello, then the queued frame"), Sent.Num(), 2))
	{
		const TSharedPtr<FJsonObject> Hello = ParseJson(Sent[0]);
		TestEqual(TEXT("the hello"), Field(Hello, TEXT("t")), FString(TEXT("hello")));
		TestEqual(TEXT("with the build"), Field(Hello, TEXT("build")), FString(TEXT("h1")));
		TestEqual(TEXT("then the flow"), Field(ParseJson(Sent[1]), TEXT("t")), FString(TEXT("flowOpen")));
	}
	TestEqual(TEXT("and it reads as connected"), Link->State(), FString(TEXT("connected")));

	// The editor closes normally: retried after 1 s, the next wait 2 s, still "connecting".
	A::Gone(*Link, 1000);
	TestTrue(TEXT("a closed link schedules a retry"), A::Pending(*Link));
	TestTrue(FString::Printf(TEXT("1 s away (got %.2f)"), A::SecondsToRetry(*Link)), A::SecondsToRetry(*Link) > 0.5 && A::SecondsToRetry(*Link) <= 1.0);
	TestEqual(TEXT("the next wait is 2 s"), A::NextWait(*Link), 2.0);
	TestEqual(TEXT("and it reads as connecting, not closed"), Link->State(), FString(TEXT("connecting")));
	TestTrue(TEXT("the retry ticker is running"), A::Ticking(*Link));

	// The editor is away: each failed attempt doubles the wait, to at most 10 s.
	TArray<double> Seen;
	for (int32 i = 0; i < 5; ++i)
	{
		Seen.Add(A::NextWait(*Link));
		A::RetryNow(*Link);
		TestFalse(TEXT("an attempt is under way"), A::Pending(*Link));
		A::Gone(*Link, -1);   // OnConnectionError
	}
	TestTrue(TEXT("the waits double to 10 s (2, 4, 8, 10, 10)"), Seen == TArray<double>({ 2.0, 4.0, 8.0, 10.0, 10.0 }));
	TestEqual(TEXT("and stay there"), A::NextWait(*Link), 10.0);

	// While the editor is away nothing queues, and the build and flows move on.
	const int32 SentBefore = Sent.Num();
	Link->Observe(TEXT("side"), TEXT("s1"), TEXT("b1"), TEXT("line"));
	TestEqual(TEXT("nothing is queued while there's no open socket"), A::Queued(*Link), 0);
	Link->SetBuild(TEXT("h2"));
	TestEqual(TEXT("nor sent"), Sent.Num(), SentBefore);

	// The editor is back: the same hello, with the current build and open flows; the wait back to 1 s.
	A::RetryNow(*Link);
	A::Connected(*Link);
	if (TestEqual(TEXT("on reconnect: one hello"), Sent.Num(), SentBefore + 1))
	{
		const TSharedPtr<FJsonObject> Again = ParseJson(Sent.Last());
		TestEqual(TEXT("says hello again"), Field(Again, TEXT("t")), FString(TEXT("hello")));
		TestEqual(TEXT("with the new build"), Field(Again, TEXT("build")), FString(TEXT("h2")));
		TestEqual(TEXT("and project"), Field(Again, TEXT("project")), FString(TEXT("Smoke")));
		TestEqual(TEXT("and the flows open now"), FString::Join(Flows(Again), TEXT(",")), FString(TEXT("main,side")));
	}
	TestEqual(TEXT("a hello puts the wait back to 1 s"), A::NextWait(*Link), 1.0);
	Link->Observe(TEXT("main"), TEXT("s1"), TEXT("b2"), TEXT("line"));
	TestEqual(TEXT("frames flow again"), Field(ParseJson(Sent.Last()), TEXT("beatId")), FString(TEXT("b2")));

	// Closed after a hello: 1 s again.
	A::Gone(*Link, 1006);
	TestTrue(FString::Printf(TEXT("retried 1 s away, since the hello reset it (got %.2f)"), A::SecondsToRetry(*Link)),
		A::SecondsToRetry(*Link) > 0.5 && A::SecondsToRetry(*Link) <= 1.0);
	A::RetryNow(*Link);
	A::Connected(*Link);

	// Replaced by another game: closed for good, no retry, nothing posted.
	A::Gone(*Link, 4000);
	TestEqual(TEXT("a replaced link reads as closed"), Link->State(), FString(TEXT("closed")));
	TestFalse(TEXT("and schedules no retry"), A::Pending(*Link));
	const int32 SentAtReplace = Sent.Num();
	Link->Observe(TEXT("main"), TEXT("s1"), TEXT("b3"), TEXT("line"));
	TestTrue(TEXT("and sends or queues nothing"), Sent.Num() == SentAtReplace && A::Queued(*Link) == 0);
	A::Gone(*Link, 1000);
	TestFalse(TEXT("a later close doesn't revive it"), A::Pending(*Link));
	Link->Close();

	// Switched off while retrying: Close() stops it.
	TSharedRef<FPatterDebugLink> Off = FPatterDebugLink::Create(TEXT("h1"), TEXT("Smoke"), TEXT("ws://127.0.0.1:1"));
	TArray<FString> OffSent;
	A::CatchSends(*Off, &OffSent);
	A::Gone(*Off, -1);
	TestTrue(TEXT("a link that never opened retries"), A::Pending(*Off));
	TestEqual(TEXT("and reads as connecting"), Off->State(), FString(TEXT("connecting")));
	Off->Close();
	TestEqual(TEXT("Close() closes it"), Off->State(), FString(TEXT("closed")));
	TestFalse(TEXT("with no retry pending"), A::Pending(*Off));
	TestFalse(TEXT("and no ticker left"), A::Ticking(*Off));

	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
