// GetFlow after a flow id is REOPENED, through the Blueprint wrapper. Runs via
//   -ExecCmds="Automation RunTests Patterplay.Flows"
//
// The UE-boundary half the clang TestHost cannot reach: the core's flowPtr always answers with the
// live flow, and the fault was in the wrapper's own list of the UPatterFlow objects it handed out.
// GetFlow took the FIRST wrapper carrying the id, which after a reopen is the old, closed one, and
// answered null for a flow that was open. The JS engine.getFlow (and every other runtime) answers
// with the live flow. Beside it, the rule the same list broke from the other side: a wrapper whose
// flow was replaced or closed stays closed, and a later re-bind (a close of another flow, a load)
// must not point it at the new flow of the same name.

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "PatterBundle.h"
#include "PatterEngine.h"
#include "PatterSave.h"

namespace
{
	// One scene, one beat, then the end: enough for a flow to open, play, and be saved.
	const TCHAR* FlowsBundleJson = TEXT(R"JSON({
  "schema": "patter/bundle@0",
  "content": { "project": "proj_flows", "version": "1.0.0", "hash": "flowshash" },
  "voiced": false,
  "locales": { "default": "en", "included": ["en"] },
  "properties": [],
  "scopeRegistry": { "version": 1, "scopes": [] },
  "cast": [],
  "strings": { "en": { "T1": "Once." } },
  "scenes": {
    "s1": { "id": "s1", "name": "S", "blocks": [{ "id": "b1", "name": "B", "children": [
      { "id": "sn1", "type": "snippet", "beats": [{ "id": "T1", "kind": "text" }], "jump": { "to": "END" } }
    ] }] }
  }
})JSON");
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPatterplayFlowsTest,
	"Patterplay.Flows",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FPatterplayFlowsTest::RunTest(const FString& Parameters)
{
	UPatterBundle* Bundle = UPatterBundle::LoadFromString(FlowsBundleJson);
	if (!TestNotNull(TEXT("bundle loads"), Bundle)) return false;
	UPatterEngine* Engine = UPatterEngine::Create(Bundle);
	if (!TestNotNull(TEXT("engine"), Engine)) return false;

	// --- reopening a name REPLACES; GetFlow answers with the replacement ---------------
	UPatterFlow* First = Engine->OpenFlow(TEXT("main"), TEXT("s1"));
	UPatterFlow* Second = Engine->OpenFlow(TEXT("main"), TEXT("s1"));
	if (!TestNotNull(TEXT("first open"), First) || !TestNotNull(TEXT("reopen"), Second)) return false;
	TestTrue(TEXT("the replaced flow's wrapper is closed"), First->IsClosed());
	TestFalse(TEXT("the reopened flow's wrapper is live"), Second->IsClosed());
	TestEqual(TEXT("GetFlow after a reopen hands back the live flow's wrapper"), Engine->GetFlow(TEXT("main")), Second);

	// --- closed, then opened again under the same name ---------------------------------------
	Engine->CloseFlow(TEXT("main"));
	TestNull(TEXT("GetFlow after a close answers null"), Engine->GetFlow(TEXT("main")));
	UPatterFlow* Third = Engine->OpenFlow(TEXT("main"), TEXT("s1"));
	if (!TestNotNull(TEXT("open after close"), Third)) return false;
	TestEqual(TEXT("GetFlow after close and reopen hands back the live flow's wrapper"), Engine->GetFlow(TEXT("main")), Third);

	// --- a closed wrapper stays closed through a later re-bind -------------------------------
	// Closing another flow re-binds every wrapper the engine holds, by id.
	UPatterFlow* Other = Engine->OpenFlow(TEXT("other"), TEXT("s1"));
	if (!TestNotNull(TEXT("another flow"), Other)) return false;
	Engine->CloseFlow(TEXT("other"));
	TestTrue(TEXT("a replaced wrapper is still closed after another flow's close"), First->IsClosed());
	TestTrue(TEXT("a closed wrapper is still closed after another flow's close"), Second->IsClosed());
	TestFalse(TEXT("the live wrapper is still live"), Third->IsClosed());
	TestEqual(TEXT("and GetFlow still hands back the live one"), Engine->GetFlow(TEXT("main")), Third);

	// --- and through a load, which re-binds every wrapper to the restored flows ----------------
	const FString Saved = UPatterSave::SaveStateToJson(Engine);
	if (TestTrue(TEXT("the save loads back"), UPatterSave::LoadStateFromJson(Engine, Saved)))
	{
		TestTrue(TEXT("a replaced wrapper is still closed after a load"), First->IsClosed());
		TestTrue(TEXT("a closed wrapper is still closed after a load"), Second->IsClosed());
		TestFalse(TEXT("the held live wrapper answers for the restored flow"), Third->IsClosed());
		TestEqual(TEXT("GetFlow after a load hands back the held wrapper"), Engine->GetFlow(TEXT("main")), Third);
	}

	// --- a load into an engine that never opened the flow --------------------------------------
	UPatterEngine* Fresh = UPatterEngine::Create(Bundle);
	if (!TestNotNull(TEXT("a fresh engine"), Fresh)) return false;
	if (TestTrue(TEXT("the save loads into a fresh engine"), UPatterSave::LoadStateFromJson(Fresh, Saved)))
	{
		UPatterFlow* Restored = Fresh->GetFlow(TEXT("main"));
		if (TestNotNull(TEXT("GetFlow hands back a flow the load restored"), Restored))
		{
			TestFalse(TEXT("and it is live"), Restored->IsClosed());
			TestEqual(TEXT("and asking again gives the same wrapper"), Fresh->GetFlow(TEXT("main")), Restored);
		}
	}
	return true;
}

#endif
