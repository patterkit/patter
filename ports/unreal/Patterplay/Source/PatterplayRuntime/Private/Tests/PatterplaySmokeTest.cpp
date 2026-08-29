// A UE-BOUNDARY smoke test. The conformance corpus is the real behaviour gate, replayed by the clang
// TestHost over the same Public/Patter headers; this exercises the seams the corpus cannot reach:
// JSON string -> UPatterBundle -> UPatterEngine -> flow -> property -> the bundle description.
//
// Why it exists, and it is not hypothetical. The plugin's own JSON loader (PatterBundleLoader.cpp)
// is compiled ONLY by Unreal: the TestHost ships a separate parser, and .github/workflows/
// play-unreal.yml gates releases on that TestHost alone, on a plain ubuntu runner with no engine.
// So every UE-facing file here - this loader, the UObject wrappers, the editor module - had NO gate
// of any kind, and on 2026-08-19 scopeRegistry parsing was added to that loader, passed every green
// check, and did not compile. Storyletter's port already had a test of this shape; this is Patterplay
// catching up.
//
// Headless:
//   <UE>/Engine/Binaries/Mac/UnrealEditor-Cmd PatterplayDemo.uproject \
//     -ExecCmds="Automation RunTests Patterplay.Smoke; Quit" -unattended -nullrhi -nosplash

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "PatterBundle.h"
#include "PatterEngine.h"
#include "PatterSave.h"
#include "Patter/Describe.h"

namespace
{
	// A tiny compiled bundle: one scene, one block, a choice group with a prompt, and a snippet
	// carrying a game-event beat. It declares a @patter global, a @scene prop, and a @world host
	// scope with one defaulted and one UNDEFAULTED property, because those are the rows the bundle
	// inspector exists to show. Expressions arrive pre-compiled ({src, ast}).
	const TCHAR* SmokeBundleJson = TEXT(R"JSON({
  "schema": "patter/bundle@0",
  "content": { "project": "proj_smoke", "version": "1.0.0", "hash": "smokehash", "structureHash": "structhash" },
  "voiced": false,
  "locales": { "default": "en", "included": ["en", "fr"] },
  "properties": [{ "name": "gold", "type": "number", "shared": true, "default": 5 }],
  "scopeRegistry": { "version": 1, "scopes": [
    { "token": "world", "declarations": [
      { "name": "isnight", "type": "boolean", "default": true },
      { "name": "weather", "type": "string" }
    ] },
    { "token": "game" }
  ] },
  "cast": [{ "name": "NPC", "displayName": "The Barkeep" }],
  "strings": { "en": { "L1": "Quiet tonight.", "P1": "Ask about the weather", "L2": "Rain, mostly." } },
  "scenes": { "s1": {
    "id": "s1", "name": "Opening Night",
    "sceneProps": [{ "name": "seen", "type": "boolean" }],
    "blocks": [{ "id": "b1", "name": "The Bar", "children": [
      { "id": "sn1", "type": "snippet", "beats": [{ "id": "L1", "kind": "text" }] },
      { "id": "g1", "type": "group", "selector": "choice", "prompt": { "id": "P1", "kind": "text" },
        "children": [
          { "id": "sn2", "type": "snippet", "beats": [{ "id": "L2", "kind": "text" }], "jump": { "to": "END" } }
        ] },
      { "id": "sn3", "type": "snippet", "beats": [{ "id": "E1", "kind": "gameEvent" }], "jump": { "to": "END" } }
    ] }]
  } }
})JSON");
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPatterplaySmokeTest,
	"Patterplay.Smoke",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FPatterplaySmokeTest::RunTest(const FString& Parameters)
{
	// A blob that is not a bundle fails, and says so on the asset rather than only in the log.
	// The refusal is LOGGED as an error, and UE counts any logged Error during a test as a failure -
	// so the intended refusal has to be declared, or this whole test fails on a passing assertion.
	// It was doing exactly that: `Patterplay.Smoke` has been red since the log line was added, and
	// nothing noticed because release CI gates on the clang TestHost, which never runs this file.
	{
		AddExpectedError(TEXT("failed to parse bundle"), EAutomationExpectedErrorFlags::Contains, 1);
		UPatterBundle* Broken = UPatterBundle::LoadFromString(TEXT("{ not json"));
		TestNull(TEXT("a malformed bundle returns null"), Broken);
	}

	UPatterBundle* Bundle = UPatterBundle::LoadFromString(SmokeBundleJson);
	if (!TestNotNull(TEXT("the bundle loads"), Bundle)) return false;
	TestTrue(TEXT("a clean load records no error"), Bundle->LoadError.IsEmpty());

	const patter::Bundle* Raw = Bundle->Raw();
	if (!TestNotNull(TEXT("the parsed bundle is reachable"), Raw)) return false;

	// The loader half the corpus TestHost never compiles: identity, and the declared host scope.
	TestEqual(TEXT("schema parsed"), FString(UTF8_TO_TCHAR(Raw->schema.c_str())), FString(TEXT("patter/bundle@0")));
	TestEqual(TEXT("content.project parsed"), FString(UTF8_TO_TCHAR(Raw->contentProject.c_str())), FString(TEXT("proj_smoke")));
	TestEqual(TEXT("content.version parsed"), FString(UTF8_TO_TCHAR(Raw->contentVersion.c_str())), FString(TEXT("1.0.0")));
	if (TestEqual(TEXT("scopeRegistry parsed"), static_cast<int32>(Raw->scopeRegistry.scopes.size()), 2))
	{
		TestEqual(TEXT("host scope token"), FString(UTF8_TO_TCHAR(Raw->scopeRegistry.scopes[0].token.c_str())), FString(TEXT("world")));
		TestEqual(TEXT("host scope declarations"), static_cast<int32>(Raw->scopeRegistry.scopes[0].declarations.size()), 2);
		// A scope with no "declarations" key is OPAQUE, which an empty list is not.
		TestFalse(TEXT("the opaque scope carries no declarations"), Raw->scopeRegistry.scopes[1].hasDeclarations);
	}

	// The bundle inspector: the callable surface read from the asset alone, nothing running.
	{
		const patter::BundleDescription D = patter::describeBundle(*Raw);
		TestEqual(TEXT("describe project"), FString(UTF8_TO_TCHAR(D.identity.project.c_str())), FString(TEXT("proj_smoke")));
		TestEqual(TEXT("describe locales"), static_cast<int32>(D.identity.locales.size()), 2);
		if (TestEqual(TEXT("describe addresses"), static_cast<int32>(D.addresses.size()), 1))
		{
			TestEqual(TEXT("scene address"), FString(UTF8_TO_TCHAR(D.addresses[0].gameId.c_str())), FString(TEXT("opening-night")));
			// A block address is scene-scoped: nested under its scene, never flattened.
			if (TestEqual(TEXT("block addresses"), static_cast<int32>(D.addresses[0].blocks.size()), 1))
			{
				TestEqual(TEXT("block address"), FString(UTF8_TO_TCHAR(D.addresses[0].blocks[0].gameId.c_str())), FString(TEXT("the-bar")));
			}
		}
		if (TestEqual(TEXT("describe host scopes"), static_cast<int32>(D.hostScopes.size()), 2))
		{
			TestFalse(TEXT("a declared scope is not opaque"), D.hostScopes[0].opaque);
			TestTrue(TEXT("a scope with no declarations is opaque"), D.hostScopes[1].opaque);
			// The row an integrator scans for: a value the GAME must supply.
			TestFalse(TEXT("weather has no default"), D.hostScopes[0].properties[1].hasDefault);
		}
		TestTrue(TEXT("@patter defaults to shared"), D.properties.patter[0].shared);
		TestFalse(TEXT("@scene defaults to per-flow"), D.properties.scene[0].properties[0].shared);
		// beats counts what beatSequence walks; the choice prompt is a SEPARATE row.
		TestEqual(TEXT("describe beats"), D.counts.beats, 3);
		TestEqual(TEXT("describe prompts"), D.counts.prompts, 1);
		TestEqual(TEXT("describe game events"), D.counts.gameEvents, 1);
	}

	// The UObject wrappers, end to end: engine, flow, a played beat, and the self-backed host scope
	// reaching the story (the fault that started this: @world read as false on every port).
	UPatterEngine* Engine = UPatterEngine::Create(Bundle);
	if (!TestNotNull(TEXT("the engine is created"), Engine)) return false;
	UPatterFlow* Flow = Engine->OpenFlow(TEXT("f"), TEXT("s1"));
	if (!TestNotNull(TEXT("a flow opens"), Flow)) return false;
	const FPatterStep Step = Flow->Advance();
	TestEqual(TEXT("the first beat is delivered with its text"), Step.Text, FString(TEXT("Quiet tonight.")));
	TestEqual(TEXT("a declared @patter global reads its default"), Engine->GetPropertyNumber(TEXT("@gold")), 5.0f);

	// A held flow SURVIVES a save/load. The core owns its flows by value and `loadGame` clears the
	// map and rebuilds it, so a wrapper holding the old pointer was reading freed memory on the next
	// call - a crash in a shipped build, and the obvious way to hold a flow from Blueprint is exactly
	// this: a variable. Reported from the Storylet Studio side, 2026-08-29.
	{
		const FString Save = UPatterSave::SaveStateToJson(Engine);
		TestFalse(TEXT("the save produces JSON"), Save.IsEmpty());
		if (TestTrue(TEXT("the save loads back"), UPatterSave::LoadStateFromJson(Engine, Save)))
		{
			// The wrapper the game was already holding must answer for the RESTORED flow. Before the
			// fix this read freed memory; the test would pass or crash depending on the allocator.
			TestFalse(TEXT("a held flow is still live after a load"), Flow->IsClosed());
			TestEqual(TEXT("and it is still the same flow"), Flow->GetFlowId(), FString(TEXT("f")));
			const FPatterStep After = Flow->Advance();
			TestEqual(TEXT("and it advances into the restored story"), static_cast<uint8>(After.Type), static_cast<uint8>(EPatterStepType::Choice));
		}
	}

	// The flow-management surface Blueprint gained: fetch by name, close, and reset. Each one drops or
	// replaces a flow underneath a wrapper, which is the shape that started all this.
	{
		UPatterFlow* Same = Engine->GetFlow(TEXT("f"));
		TestEqual(TEXT("GetFlow hands back the wrapper we already hold"), Same, Flow);
		TestNull(TEXT("GetFlow answers null for a name that is not open"), Engine->GetFlow(TEXT("nope")));

		Engine->CloseFlow(TEXT("f"));
		TestTrue(TEXT("a closed flow's wrapper reads as closed"), Flow->IsClosed());
		TestNull(TEXT("and GetFlow no longer offers it"), Engine->GetFlow(TEXT("f")));

		UPatterFlow* Second = Engine->OpenFlow(TEXT("f2"), TEXT("s1"));
		Engine->Reset();
		TestTrue(TEXT("Reset closes every flow's wrapper"), Second->IsClosed());
		TestEqual(TEXT("and the shared world is back to its defaults"), Engine->GetPropertyNumber(TEXT("@gold")), 5.0f);
	}

	// A flow the save did not carry comes back CLOSED rather than dangling: getFlow answers null for
	// its id, every UPatterFlow method guards on the pointer, and IsClosed reports the truth.
	{
		UPatterEngine* Fresh = UPatterEngine::Create(Bundle);
		UPatterFlow* Ghost = Fresh->OpenFlow(TEXT("ghost"), TEXT("s1"));
		const FString EmptySave = UPatterSave::SaveStateToJson(Engine); // a save with flow "f", not "ghost"
		if (TestTrue(TEXT("the other engine's save loads"), UPatterSave::LoadStateFromJson(Fresh, EmptySave)))
		{
			TestTrue(TEXT("a flow the save did not carry reads as closed"), Ghost->IsClosed());
		}
	}

	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
