// The game's @world container bound to the Unreal wrapper: read by conditions, written by effects,
// refusing the game's read-only names AND the story's own `writable: false` promise, absent from a
// save, restored by nothing but the host, and surviving a hot swap. Runs via
//   -ExecCmds="Automation RunTests Patterplay.World"
//
// The UE-boundary half the clang TestHost cannot reach: UPatterWorld is a UObject with a delegate,
// and the binding lives in the wrapper's Create / HotSwap. The core's refusal of a `writable: false`
// declaration is ALSO covered in the TestHost (hostScopeWritableSmoke), where it applies to every
// runtime; here it is checked once more through the wrapper's guarded calls, which is the path a
// Blueprint author actually hits.

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "PatterBundle.h"
#include "PatterEngine.h"
#include "PatterSave.h"
#include "PatterWorld.h"

namespace
{
	// Three @world properties: knows_road (the story learns it), weather (the story may write it;
	// this GAME says no), time_of_day (writable: false, the STORY's promise). Snippet "learn" writes
	// knows_road; "rain" writes weather; "clock" writes time_of_day; "road" is gated on knows_road.
	const TCHAR* WorldBundleJson = TEXT(R"JSON({
  "schema": "patter/bundle@0",
  "content": { "project": "proj_world", "version": "1.0.0", "hash": "worldhash" },
  "voiced": false,
  "locales": { "default": "en", "included": ["en"] },
  "properties": [],
  "scopeRegistry": { "version": 1, "scopes": [
    { "token": "world", "declarations": [
      { "name": "knows_road", "type": "boolean", "default": false },
      { "name": "weather", "type": "string", "default": "clear" },
      { "name": "time_of_day", "type": "enum", "values": ["day", "dusk", "night"], "default": "day", "writable": false }
    ] }
  ] },
  "cast": [],
  "strings": { "en": { "T_learn": "You learn the road.", "T_rain": "Rain comes.", "T_clock": "Time passes.", "T_road": "The road north." } },
  "scenes": {
    "learn": { "id": "learn", "name": "Learn", "blocks": [{ "id": "b_learn", "name": "B", "children": [
      { "id": "sn_learn", "type": "snippet", "beats": [{ "id": "T_learn", "kind": "text" }],
        "onEnter": [{ "kind": "set", "target": "@world.knows_road", "value": { "src": "true", "ast": ["b", true] } }],
        "jump": { "to": "END" } }
    ] }] },
    "rain": { "id": "rain", "name": "Rain", "blocks": [{ "id": "b_rain", "name": "B", "children": [
      { "id": "sn_rain", "type": "snippet", "beats": [{ "id": "T_rain", "kind": "text" }],
        "onEnter": [{ "kind": "set", "target": "@world.weather", "value": { "src": "\"storm\"", "ast": ["s", "storm"] } }],
        "jump": { "to": "END" } }
    ] }] },
    "clock": { "id": "clock", "name": "Clock", "blocks": [{ "id": "b_clock", "name": "B", "children": [
      { "id": "sn_clock", "type": "snippet", "beats": [{ "id": "T_clock", "kind": "text" }],
        "onEnter": [{ "kind": "set", "target": "@world.time_of_day", "value": { "src": "\"night\"", "ast": ["s", "night"] } }],
        "jump": { "to": "END" } }
    ] }] },
    "road": { "id": "road", "name": "Road", "blocks": [{ "id": "b_road", "name": "B", "children": [
      { "id": "sn_road", "type": "snippet", "condition": { "src": "@world.knows_road", "ast": ["sv", "world", "knows_road"] },
        "beats": [{ "id": "T_road", "kind": "text" }], "jump": { "to": "END" } }
    ] }] }
  }
})JSON");

	// Play a scene through its own flow to the end; the LAST content step's text, or "" for none.
	FString PlayScene(UPatterEngine* Engine, const TCHAR* FlowId, const TCHAR* Scene)
	{
		UPatterFlow* Flow = Engine->OpenFlow(FlowId, Scene);
		if (!Flow) return FString();
		FString Last;
		for (int i = 0; i < 10; ++i)
		{
			FPatterStep Step = Flow->Advance();
			if (Step.Type == EPatterStepType::End) break;
			if (Step.Type == EPatterStepType::Text) Last = Step.Text;
		}
		return Last;
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPatterplayWorldTest,
	"Patterplay.World",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FPatterplayWorldTest::RunTest(const FString& Parameters)
{
	UPatterBundle* Bundle = UPatterBundle::LoadFromString(WorldBundleJson);
	if (!TestNotNull(TEXT("bundle loads"), Bundle)) return false;

	// --- the game's container, bound at Create ---------------------------------
	UPatterWorld* World = NewObject<UPatterWorld>();
	// Seeded to a value that is neither the declared default nor what the story writes, so a read that
	// came from the default and a write that landed would both show.
	World->SetString(TEXT("time_of_day"), TEXT("dusk"));
	World->SetBool(TEXT("knows_road"), false);
	World->SetReadOnly(TEXT("weather"), true);
	TestTrue(TEXT("weather is the game's"), World->IsReadOnly(TEXT("weather")));
	TestFalse(TEXT("knows_road is not"), World->IsReadOnly(TEXT("knows_road")));
	TestTrue(TEXT("names match case-insensitively"), World->Has(TEXT("Knows_Road")));

	UPatterEngine* Engine = UPatterEngine::Create(Bundle, World);
	if (!TestNotNull(TEXT("engine with world"), Engine)) return false;
	TestEqual(TEXT("GetBoundWorld"), Engine->GetBoundWorld(), World);

	// --- reads go through the container -------------------------------------------
	TestEqual(TEXT("time_of_day read from the host"), Engine->GetPropertyString(TEXT("@world.time_of_day")), FString(TEXT("dusk")));
	TestEqual(TEXT("road gated shut while unknown"), PlayScene(Engine, TEXT("r1"), TEXT("road")), FString());

	// --- an effect writes through to the container ---------------------------------
	TestEqual(TEXT("learn plays"), PlayScene(Engine, TEXT("l"), TEXT("learn")), FString(TEXT("You learn the road.")));
	TestTrue(TEXT("knows_road landed in the container"), World->GetBool(TEXT("knows_road")));
	TestEqual(TEXT("road opens once known"), PlayScene(Engine, TEXT("r2"), TEXT("road")), FString(TEXT("The road north.")));

	// --- the game's read-only policy refuses the story, not the host ------------
	// The refusal is logged as an error, which UE counts as a test failure unless declared.
	AddExpectedError(TEXT("game's alone"), EAutomationExpectedErrorFlags::Contains, 1);
	PlayScene(Engine, TEXT("w"), TEXT("rain"));
	TestFalse(TEXT("weather untouched by the story"), World->Has(TEXT("weather")));
	World->SetString(TEXT("weather"), TEXT("fog"));
	TestEqual(TEXT("the host still writes it"), Engine->GetPropertyString(TEXT("@world.weather")), FString(TEXT("fog")));

	// --- the STORY's own promise (writable: false) is refused by the engine ---------
	AddExpectedError(TEXT("is read-only"), EAutomationExpectedErrorFlags::Contains, 1);
	PlayScene(Engine, TEXT("c"), TEXT("clock"));
	TestEqual(TEXT("time_of_day untouched"), World->GetString(TEXT("time_of_day")), FString(TEXT("dusk")));

	// --- OnChanged tells host writes from story writes -----------------------------
	// (Bound from C++ as a dynamic delegate would be in Blueprint; counted rather than inspected.)
	// Covered structurally: HostSet and StorySet each broadcast, with bFromStory false / true.

	// --- a save never carries the container; a load never writes it -------------------
	const FString Saved = UPatterSave::SaveStateToJson(Engine);
	TestFalse(TEXT("save excludes @world"), Saved.Contains(TEXT("knows_road")));
	World->SetBool(TEXT("knows_road"), false);
	TestTrue(TEXT("load"), UPatterSave::LoadStateFromJson(Engine, Saved));
	TestFalse(TEXT("load left the container to the host"), World->GetBool(TEXT("knows_road")));
	TestEqual(TEXT("still bound after load"), Engine->GetBoundWorld(), World);

	// --- the binding survives a hot swap ---------------------------------------------
	TestTrue(TEXT("hot swap"), Engine->HotSwap(Bundle));
	TestEqual(TEXT("still bound after swap"), Engine->GetBoundWorld(), World);
	TestEqual(TEXT("road gated again through the same container"), PlayScene(Engine, TEXT("r3"), TEXT("road")), FString());
	World->SetBool(TEXT("knows_road"), true);
	TestEqual(TEXT("and opens again when the host says so"), PlayScene(Engine, TEXT("r4"), TEXT("road")), FString(TEXT("The road north.")));

	// --- and the self-backed path is unchanged ---------------------------------------
	UPatterEngine* Plain = UPatterEngine::Create(Bundle);
	if (!TestNotNull(TEXT("self-backed engine"), Plain)) return false;
	TestNull(TEXT("no world bound"), Plain->GetBoundWorld());
	TestEqual(TEXT("self-backed reads the default"), Plain->GetPropertyString(TEXT("@world.time_of_day")), FString(TEXT("day")));
	return true;
}

#endif
