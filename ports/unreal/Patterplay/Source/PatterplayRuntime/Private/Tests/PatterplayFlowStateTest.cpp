// CaptureFlow / RestoreFlow through the Blueprint wrapper: a flow taken out as data and put back, and
// what RestoreFlow refuses. Runs via
//   -ExecCmds="Automation RunTests Patterplay.FlowState"
//
// The corpus (in the clang TestHost) pins what a restored flow plays; this is the UE-boundary half: the
// state is a JSON FString, a refusal is logged and answers null with nothing changed, and the restored
// flow comes back as a live UPatterFlow that GetFlow hands back. The refusals: a name that is open, an
// open checkpoint, a version a save reader would refuse, and a state with no cursor. Capturing only
// reads, so a checkpoint doesn't stop it.

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "PatterBundle.h"
#include "PatterEngine.h"
#include "PatterSave.h"

namespace
{
	// `@gold` is each flow's own: set as the snippet is entered, and read by its second line.
	const TCHAR* FlowStateBundleJson = TEXT(R"JSON({
  "schema": "patter/bundle@0",
  "content": { "project": "proj_flowstate", "version": "1.0.0", "hash": "flowstatehash" },
  "voiced": false,
  "locales": { "default": "en", "included": ["en"] },
  "properties": [{ "name": "gold", "type": "number", "default": 0, "shared": false }],
  "scopeRegistry": { "version": 1, "scopes": [] },
  "cast": [],
  "strings": { "en": { "T1": "One.", "T2": "Gold {@gold}." } },
  "scenes": {
    "s1": { "id": "s1", "name": "S", "blocks": [{ "id": "b1", "name": "B", "children": [
      { "id": "sn1", "type": "snippet", "beats": [{ "id": "T1", "kind": "text" }, { "id": "T2", "kind": "text" }],
        "onEnter": [{ "kind": "set", "target": "@gold", "value": { "src": "3", "ast": ["n", 3] } }],
        "jump": { "to": "END" } }
    ] }] }
  }
})JSON");
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPatterplayFlowStateTest,
	"Patterplay.FlowState",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FPatterplayFlowStateTest::RunTest(const FString& Parameters)
{
	UPatterBundle* Bundle = UPatterBundle::LoadFromString(FlowStateBundleJson);
	if (!TestNotNull(TEXT("bundle loads"), Bundle)) return false;
	UPatterEngine* Engine = UPatterEngine::Create(Bundle);
	if (!TestNotNull(TEXT("engine"), Engine)) return false;

	// Each refusal is logged as an Error, which UE counts as a test failure unless declared.
	AddExpectedErrorPlain(TEXT("no open flow 'nope' to capture"), EAutomationExpectedErrorFlags::Contains, 1);
	AddExpectedErrorPlain(TEXT("is already open"), EAutomationExpectedErrorFlags::Contains, 1);
	AddExpectedErrorPlain(TEXT("restoreFlow can't be undone"), EAutomationExpectedErrorFlags::Contains, 1);
	AddExpectedErrorPlain(TEXT("unsupported flow state version: 3.9"), EAutomationExpectedErrorFlags::Contains, 1);
	AddExpectedErrorPlain(TEXT("malformed flow state: no cursor"), EAutomationExpectedErrorFlags::Contains, 1);

	TestTrue(TEXT("capturing a name that is not open gives nothing"), Engine->CaptureFlow(TEXT("nope")).IsEmpty());

	UPatterFlow* Main = Engine->OpenFlow(TEXT("main"), TEXT("s1"));
	if (!TestNotNull(TEXT("open"), Main)) return false;
	TestEqual(TEXT("the flow plays its first line"), Main->Advance().Id, FString(TEXT("T1")));
	const FString Mid = Engine->CaptureFlow(TEXT("main"));
	if (!TestFalse(TEXT("the flow is captured"), Mid.IsEmpty())) return false;
	TestFalse(TEXT("capturing doesn't close the flow"), Main->IsClosed());
	TestFalse(TEXT("the state doesn't name the flow it came from"), Mid.Contains(TEXT("main")));

	// --- refused: a name that is open, and an open checkpoint; nothing changes -------------------
	const FString Before = UPatterSave::SerializeState(Engine);
	TestNull(TEXT("restoring over an open name is refused"), Engine->RestoreFlow(TEXT("main"), Mid));
	TestEqual(TEXT("the open flow is still the engine's"), Engine->GetFlow(TEXT("main")), Main);
	Engine->Checkpoint();
	TestNull(TEXT("restoring inside a checkpoint is refused"), Engine->RestoreFlow(TEXT("spare"), Mid));
	TestNull(TEXT("and leaves no flow behind"), Engine->GetFlow(TEXT("spare")));
	TestTrue(TEXT("the checkpoint is still open"), Engine->InCheckpoint());
	TestEqual(TEXT("capturing inside a checkpoint is allowed: it only reads"), Engine->CaptureFlow(TEXT("main")), Mid);
	Engine->Commit();
	FString Fractional = Mid;
	Fractional.ReplaceInline(TEXT("\"version\":3"), TEXT("\"version\":3.9"));
	TestNull(TEXT("a version of 3.9 is refused, not read as 3"), Engine->RestoreFlow(TEXT("spare"), Fractional));
	const FString NoCursor = TEXT(R"({"version":3,"rngState":0,"visits":{},"scopes":{"patter":{}},"sceneBags":{}})");
	TestNull(TEXT("a state with no cursor is refused"), Engine->RestoreFlow(TEXT("spare"), NoCursor));
	TestNull(TEXT("and leaves no flow behind"), Engine->GetFlow(TEXT("spare")));
	TestEqual(TEXT("nothing changed"), UPatterSave::SerializeState(Engine), Before);

	// --- closed, then restored under the same name and under another -----------------------------
	Engine->CloseFlow(TEXT("main"));
	TestTrue(TEXT("the closed flow's wrapper is closed"), Main->IsClosed());
	UPatterFlow* Back = Engine->RestoreFlow(TEXT("main"), Mid);
	if (TestNotNull(TEXT("the same name, now free, restores"), Back))
	{
		TestFalse(TEXT("and it is live"), Back->IsClosed());
		TestEqual(TEXT("GetFlow hands back the restored flow's wrapper"), Engine->GetFlow(TEXT("main")), Back);
		TestTrue(TEXT("the closed wrapper stays closed"), Main->IsClosed());
		const FPatterStep Step = Back->Advance();
		TestEqual(TEXT("it carries on where it was captured"), Step.Id, FString(TEXT("T2")));
		TestEqual(TEXT("with its own values"), Step.Text, FString(TEXT("Gold 3.")));
	}
	UPatterFlow* Carried = Engine->RestoreFlow(TEXT("carried"), Mid);
	if (TestNotNull(TEXT("another name restores too"), Carried))
		TestEqual(TEXT("with the same values"), Carried->Advance().Text, FString(TEXT("Gold 3.")));
	return true;
}

#endif
