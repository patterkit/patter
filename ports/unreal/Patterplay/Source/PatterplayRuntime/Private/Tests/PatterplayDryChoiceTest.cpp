// A choice that runs dry and ends the flow, as a Blueprint game sees it. Runs via
//   -ExecCmds="Automation RunTests Patterplay.DryChoice"
//
// The UE-boundary half the clang TestHost cannot reach: the core's `dry-choice` report arrives through
// OnError as EPatterPlayErrorKind::DryChoice (and a Warning in the log), and the End step carries
// EPatterFlowEndReason::RanDry, through a save and load. The core's own behaviour is pinned in the TestHost
// ([dry-choice]) and the conformance corpus.

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "PatterBundle.h"
#include "PatterEngine.h"
#include "PatterSave.h"
#include "PatterplayErrorsListener.h"

namespace
{
	// The hub: one once-only option that comes back to it. Once it's used, the choice runs dry and the flow ends.
	const TCHAR* DryChoiceBundleJson = TEXT(R"JSON({
  "schema": "patter/bundle@0",
  "content": { "project": "proj_dry", "version": "1.0.0", "hash": "dryhash" },
  "voiced": false,
  "locales": { "default": "en", "included": ["en"] },
  "properties": [],
  "cast": [],
  "strings": { "en": { "P": "Ask", "ANS": "answered" } },
  "scenes": {
    "s": { "id": "s", "name": "S", "blocks": [{ "id": "hub", "name": "Hub", "children": [
      { "id": "g", "type": "group", "selector": "choice", "children": [
        { "id": "ask", "type": "group", "prompt": { "id": "P", "kind": "text" }, "children": [
          { "id": "sn_ans", "type": "snippet", "beats": [{ "id": "ANS", "kind": "text" }], "jump": { "to": "hub" } }
        ] }
      ] }
    ] }] }
  }
})JSON");
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPatterplayDryChoiceTest,
	"Patterplay.DryChoice",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FPatterplayDryChoiceTest::RunTest(const FString& Parameters)
{
	UPatterBundle* Bundle = UPatterBundle::LoadFromString(DryChoiceBundleJson);
	if (!TestNotNull(TEXT("bundle loads"), Bundle)) return false;

	UPatterEngine* Engine = UPatterEngine::CreateWithOptions(Bundle, FPatterEngineOptions(), {});
	if (!TestNotNull(TEXT("engine"), Engine)) return false;
	UPatterplayErrorsListener* Listener = NewObject<UPatterplayErrorsListener>();
	Engine->OnError.AddDynamic(Listener, &UPatterplayErrorsListener::HandleError);

	// Reported once, a Warning in the log as well as the event.
	AddExpectedMessagePlain(TEXT("ran dry"), ELogVerbosity::Warning, EAutomationExpectedMessageFlags::Contains, 1);

	UPatterFlow* Flow = Engine->OpenFlow(TEXT("f"), TEXT("s"));
	if (!TestNotNull(TEXT("flow opens"), Flow)) return false;
	const FPatterStep Offered = Flow->Advance();
	TestTrue(TEXT("the hub is offered"), Offered.Type == EPatterStepType::Choice);
	TestTrue(TEXT("a choice step's reason is Ended"), Offered.EndReason == EPatterFlowEndReason::Ended);
	Flow->Choose(TEXT("ask"));
	TestEqual(TEXT("the answer plays"), Flow->Advance().Text, FString(TEXT("answered")));

	// Back at the hub, the option used: the choice runs dry and the flow ends there.
	const FPatterStep End = Flow->Advance();
	TestTrue(TEXT("the flow ends"), End.Type == EPatterStepType::End);
	TestTrue(TEXT("because the choice ran dry"), End.EndReason == EPatterFlowEndReason::RanDry);
	if (TestEqual(TEXT("one report"), Listener->Errors.Num(), 1))
	{
		const FPatterPlayError& Dry = Listener->Errors[0];
		TestTrue(TEXT("kind"), Dry.Kind == EPatterPlayErrorKind::DryChoice);
		TestEqual(TEXT("node is the choice's group"), Dry.Node, FString(TEXT("g")));
		TestEqual(TEXT("flow"), Dry.Flow, FString(TEXT("f")));
	}
	TestTrue(TEXT("asked again, the same end"), Flow->Advance().EndReason == EPatterFlowEndReason::RanDry);
	TestEqual(TEXT("asked again, not reported again"), Listener->Errors.Num(), 1);

	// A save keeps the reason; loading it doesn't report it again.
	const FString Saved = UPatterSave::SerializeState(Engine);
	TestTrue(TEXT("the save names the dry choice"), Saved.Contains(TEXT("\"ranDry\":\"g\"")));
	TestTrue(TEXT("the save loads"), UPatterSave::DeserializeState(Engine, Saved));
	UPatterFlow* Loaded = Engine->GetFlow(TEXT("f"));
	if (TestNotNull(TEXT("the flow came back"), Loaded))
	{
		TestTrue(TEXT("the loaded flow ends the same way"), Loaded->Advance().EndReason == EPatterFlowEndReason::RanDry);
		TestEqual(TEXT("the load reported nothing"), Listener->Errors.Num(), 1);

		// The host ending it is a plain end.
		TestTrue(TEXT("Goto END"), Loaded->Goto(TEXT("END"), TEXT("")));
		TestTrue(TEXT("the host's end is plain"), Loaded->Advance().EndReason == EPatterFlowEndReason::Ended);
	}
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
