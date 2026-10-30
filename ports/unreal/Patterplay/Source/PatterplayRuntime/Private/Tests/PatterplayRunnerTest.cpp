// The thin runner as a Blueprint game sees it: UPatterRunnerComponent. Runs via
//   -ExecCmds="Automation RunTests Patterplay.Runner"
//
// The clang TestHost pins the std core's patter::Runner against the JS reference's runner tests; this is the
// UE-boundary half, the same cases through the component: each delivered beat waits for Next, a choice for
// Choose, and the end raises OnEnded; handlers that call Next themselves don't deepen the stack; Stop drops
// what was asked for and leaves the flow where it is; a later Begin(Scene) moves the same flow; a refusal is
// returned, kept in GetLastError and logged, as Blueprint can't catch a throw; a load and a hot swap on the
// same engine need nothing, and a new engine is handed over with Rebind; OnEnded hands on the end's reason,
// RanDry when a choice ran dry with nothing after it.

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "PatterBundle.h"
#include "PatterEngine.h"
#include "PatterSave.h"
#include "PatterRunnerComponent.h"
#include "PatterplayRunnerListener.h"

namespace
{
	// The JS runner test's hub: one option that comes back to it. Once it's used, the choice runs dry and
	// nothing follows, so the flow ends because it ran dry.
	const TCHAR* HubBundleJson = TEXT(R"JSON({"schema":"patter/bundle@0","content":{"project":"run_hub","hash":"runhub"},"voiced":false,"locales":{"default":"en","included":["en"]},"cast":[{"name":"NPC"}],"scenes":{"hub":{"id":"hub","type":"scene","name":"Hub","blocks":[{"id":"bh","type":"block","name":"BH","children":[{"id":"g","type":"group","selector":"choice","children":[{"id":"o","type":"group","prompt":{"id":"C_a","kind":"text"},"children":[{"id":"sn_o","type":"snippet","beats":[{"id":"L_a","kind":"line","character":"NPC"}],"jump":{"to":"hub"}}]}]}]}]}},"strings":{"en":{"C_a":"Ask.","L_a":"Asked."}}})JSON");

	// The JS runner test's bundle, as the JS compiler exports it. talk: a line, a text and a game event, then
	// a choice of two options, each a line and the end. shop: one line and the end.
	const TCHAR* RunnerBundleJson = TEXT(R"JSON({"schema":"patter/bundle@0","content":{"project":"run","hash":"1mn9ico","structureHash":"1bg0cg5"},"voiced":false,"locales":{"default":"en","included":["en"]},"cast":[{"name":"NPC"}],"scenes":{"talk":{"id":"talk","type":"scene","name":"Talk","blocks":[{"id":"b1","type":"block","name":"B1","children":[{"id":"sn1","type":"snippet","beats":[{"id":"L1","kind":"line","character":"NPC"},{"id":"T1","kind":"text","action":true},{"id":"E1","kind":"gameEvent"}]},{"id":"grp","type":"group","selector":"choice","children":[{"id":"opt_a","type":"group","children":[{"id":"sn_a","type":"snippet","beats":[{"id":"L_a","kind":"line","character":"NPC"}],"jump":{"to":"END"}}],"prompt":{"id":"C_a","kind":"text"}},{"id":"opt_b","type":"group","children":[{"id":"sn_b","type":"snippet","beats":[{"id":"L_b","kind":"line","character":"NPC"}],"jump":{"to":"END"}}],"prompt":{"id":"C_b","kind":"text"}}]}]}]},"shop":{"id":"shop","type":"scene","name":"Shop","blocks":[{"id":"b2","type":"block","name":"B2","children":[{"id":"sn_s","type":"snippet","beats":[{"id":"L_s","kind":"line","character":"NPC"}],"jump":{"to":"END"}}]}]}},"strings":{"en":{"L1":"Hello.","T1":"A door creaks.","C_a":"Ask.","C_b":"Leave.","L_a":"Asked.","L_b":"Bye.","L_s":"Welcome."}}})JSON");
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPatterplayRunnerTest,
	"Patterplay.Runner",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FPatterplayRunnerTest::RunTest(const FString& Parameters)
{
	UPatterBundle* Bundle = UPatterBundle::LoadFromString(RunnerBundleJson);
	if (!TestNotNull(TEXT("bundle loads"), Bundle)) return false;

	// A fresh engine, a runner on it, and a listener writing its events down.
	const auto Recorded = [Bundle](UPatterEngine*& OutEngine, UPatterRunnerComponent*& OutRunner)
	{
		OutEngine = UPatterEngine::Create(Bundle, {});
		OutRunner = NewObject<UPatterRunnerComponent>();
		OutRunner->SetEngine(OutEngine, TEXT("main"));
		UPatterplayRunnerListener* Listener = NewObject<UPatterplayRunnerListener>();
		Listener->Listen(OutRunner);
		return Listener;
	};
	const auto Joined = [](const TArray<FString>& Seen) { return FString::Join(Seen, TEXT(" ")); };

	// --- one beat per Next, a game event included, then the choice, then the end -------------------
	{
		UPatterEngine* Engine; UPatterRunnerComponent* Runner;
		UPatterplayRunnerListener* L = Recorded(Engine, Runner);
		TestEqual(TEXT("Start delivers the first beat"), Runner->Begin(TEXT("talk")), FString());
		TestEqual(TEXT("the line"), Joined(L->Seen), FString(TEXT("line:L1")));
		TestEqual(TEXT("its step"), L->LastSpeech, FString(TEXT("NPC: Hello.")));
		Runner->Next();
		Runner->Next();
		TestEqual(TEXT("a beat each"), Joined(L->Seen), FString(TEXT("line:L1 text:T1 gameEvent:E1")));
		Runner->Next();
		TestEqual(TEXT("the choice"), L->Last(), FString(TEXT("choice:opt_a,opt_b")));
		TestEqual(TEXT("Choose succeeds"), Runner->Choose(TEXT("opt_b")), FString());
		TestEqual(TEXT("what it leads to"), L->Last(), FString(TEXT("line:L_b")));
		Runner->Next();
		TestEqual(TEXT("the end"), L->Last(), FString(TEXT("ended")));
	}

	// --- no address: the project's start, and again on an open flow begins the story again ----------
	{
		UPatterEngine* Engine; UPatterRunnerComponent* Runner;
		UPatterplayRunnerListener* L = Recorded(Engine, Runner);
		Runner->Begin(TEXT("shop"));
		Runner->Begin();
		TestEqual(TEXT("shop, then the start again"), Joined(L->Seen), FString(TEXT("line:L_s line:L1")));
	}

	// --- handlers that call Next and Choose themselves play the whole run, one deep -----------------
	{
		UPatterEngine* Engine; UPatterRunnerComponent* Runner;
		UPatterplayRunnerListener* L = Recorded(Engine, Runner);
		L->bNextOnBeat = true;
		L->ChooseOnChoice = TEXT("opt_a");
		Runner->Begin(TEXT("talk"));
		TestEqual(TEXT("the whole run"), Joined(L->Seen), FString(TEXT("line:L1 text:T1 gameEvent:E1 choice:opt_a,opt_b line:L_a ended")));
		TestEqual(TEXT("never nested"), L->Deepest, 1);
	}

	// --- Stop drops a Next a handler asked for, and leaves the flow unended ------------------------
	{
		UPatterEngine* Engine; UPatterRunnerComponent* Runner;
		UPatterplayRunnerListener* L = Recorded(Engine, Runner);
		L->bStopAfterLine = true;
		Runner->Begin(TEXT("talk"));
		TestEqual(TEXT("only the line"), Joined(L->Seen), FString(TEXT("line:L1")));
		TestFalse(TEXT("not ended"), Runner->GetFlow()->IsEnded());
		Runner->Next();
		TestEqual(TEXT("Next carries on"), Joined(L->Seen), FString(TEXT("line:L1 text:T1")));
	}

	// --- a later Begin(Scene) moves the same flow, keeping its visit counts --------------------------
	{
		UPatterEngine* Engine; UPatterRunnerComponent* Runner;
		UPatterplayRunnerListener* L = Recorded(Engine, Runner);
		Runner->Begin(TEXT("talk"));
		UPatterFlow* Flow = Runner->GetFlow();
		Runner->Begin(TEXT("shop"));
		TestTrue(TEXT("the same flow"), Runner->GetFlow() == Flow);
		TestEqual(TEXT("shop's line"), L->Last(), FString(TEXT("line:L_s")));
		TestEqual(TEXT("talk's visit kept"), Flow->GetVisitCounts().FindRef(TEXT("talk")), 1);
	}

	// --- refusals: returned, kept in GetLastError, logged; nothing changes --------------------------
	{
		UPatterEngine* Engine; UPatterRunnerComponent* Runner;
		UPatterplayRunnerListener* L = Recorded(Engine, Runner);
		AddExpectedErrorPlain(TEXT("call Begin() first"), EAutomationExpectedErrorFlags::Contains, 2);
		TestTrue(TEXT("Next before Begin"), Runner->Next().Contains(TEXT("call Begin() first")));
		TestTrue(TEXT("Choose before Begin"), Runner->Choose(TEXT("opt_a")).Contains(TEXT("call Begin() first")));
		TestTrue(TEXT("kept in GetLastError"), Runner->GetLastError().Contains(TEXT("call Begin() first")));

		Runner->Begin(TEXT("talk"));
		TestEqual(TEXT("a call that succeeds clears it"), Runner->GetLastError(), FString());
		AddExpectedErrorPlain(TEXT("Begin: address not found: nowhere"), EAutomationExpectedErrorFlags::Contains, 1);
		TestEqual(TEXT("an address that doesn't resolve"), Runner->Begin(TEXT("nowhere")), FString(TEXT("Begin: address not found: nowhere")));
		AddExpectedErrorPlain(TEXT("Begin: a block needs its scene"), EAutomationExpectedErrorFlags::Contains, 1);
		TestEqual(TEXT("a block without its scene"), Runner->Begin(FString(), TEXT("b1")), FString(TEXT("Begin: a block needs its scene")));
		AddExpectedErrorPlain(TEXT("no choice is pending"), EAutomationExpectedErrorFlags::Contains, 1);
		TestEqual(TEXT("a choice that isn't pending"), Runner->Choose(TEXT("opt_a")), FString(TEXT("Choose: no choice is pending")));
		Runner->Next();
		TestEqual(TEXT("the flow is where it was"), Joined(L->Seen), FString(TEXT("line:L1 text:T1")));
	}

	// --- a load and a hot swap on the same engine need nothing; a new engine is handed to Rebind ------
	{
		UPatterEngine* Engine; UPatterRunnerComponent* Runner;
		UPatterplayRunnerListener* L = Recorded(Engine, Runner);
		Runner->Begin(TEXT("talk"));
		Runner->Next();
		const FString Save = UPatterSave::SerializeState(Engine);
		Runner->Next();
		TestTrue(TEXT("load"), UPatterSave::DeserializeState(Engine, Save));
		Runner->Next();
		TestEqual(TEXT("after the load"), L->Last(), FString(TEXT("gameEvent:E1")));

		TestTrue(TEXT("hot swap"), Engine->HotSwap(Bundle));
		Runner->Next();
		TestEqual(TEXT("after the hot swap"), L->Last(), FString(TEXT("choice:opt_a,opt_b")));

		UPatterEngine* Another = UPatterEngine::Create(Bundle, {});
		TestTrue(TEXT("the save loads into another engine"), UPatterSave::DeserializeState(Another, Save));
		Runner->Rebind(Another);
		Runner->Next();
		TestEqual(TEXT("after Rebind"), L->Last(), FString(TEXT("gameEvent:E1")));
	}

	// --- OnEnded hands on the reason: RanDry when a choice had nothing left and nothing came after it ---
	{
		UPatterBundle* Hub = UPatterBundle::LoadFromString(HubBundleJson);
		if (!TestNotNull(TEXT("the hub bundle loads"), Hub)) return false;
		UPatterEngine* Engine = UPatterEngine::Create(Hub, {});
		UPatterRunnerComponent* Runner = NewObject<UPatterRunnerComponent>();
		Runner->SetEngine(Engine, TEXT("main"));
		UPatterplayRunnerListener* L = NewObject<UPatterplayRunnerListener>();
		L->Listen(Runner);
		// The dry choice is reported once, a Warning in the log.
		AddExpectedMessagePlain(TEXT("ran dry"), ELogVerbosity::Warning, EAutomationExpectedMessageFlags::Contains, 1);
		Runner->Begin(TEXT("hub"));
		Runner->Choose(TEXT("o"));
		Runner->Next(); // back at the hub, its only option used: it runs dry, and nothing follows
		TestEqual(TEXT("the end says it ran dry"), Joined(L->Seen), FString(TEXT("choice:o line:L_a ended:ran-dry")));
	}
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
