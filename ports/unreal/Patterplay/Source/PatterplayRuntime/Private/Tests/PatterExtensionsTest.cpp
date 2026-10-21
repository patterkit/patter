// Patter extension values at the Blueprint boundary (patterkit design/proposals/patter-storylet-extensions.md,
// "At runtime"). The corpus's extension cases are the behaviour gate, replayed by the clang TestHost over the
// same core; this test exercises the crossing: values riding a step, an option, the outline and a scene or
// block as JSON text, the defaults filled in through the bundle, any node read by address, a scalar read back
// as a Patter value, a quality field's ladder handed to the stage functions, and a save that carries none of it while a load reads the option's values back off the bundle.
// Runs via
//   -ExecCmds="Automation RunTests Patterplay.Extensions"

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "PatterBundle.h"
#include "PatterEngine.h"
#include "PatterGameData.h"
#include "PatterSave.h"

namespace
{
	// Extension "probe" declares for lines a text `note`, a record `cue` and a quality `act`; for options
	// `icon`; for scenes `theme`; for blocks `pace`; for game events `cue`; for the project `studio`. The line
	// sets `note` and `cue`, the game event `cue`, the option o_go `icon` and its prompt `note`, the scene and
	// the block theirs. o_stay sets none. The probe still carries the settings an older compiler wrote, which
	// the loader ignores.
	const TCHAR* ExtensionsBundleJson = TEXT(R"JSON({
  "schema": "patter/bundle@0",
  "content": { "project": "ext", "hash": "0", "structureHash": "0" },
  "voiced": false,
  "locales": { "default": "en", "included": ["en"] },
  "cast": [{ "name": "ANNA" }],
  "extensions": {
    "probe": {
      "version": "1.0.0",
      "fields": {
        "line": [
          { "name": "note", "type": "text", "default": "" },
          { "name": "cue", "type": "record", "default": { "sound": "", "gain": 0 },
            "fields": [{ "name": "sound", "type": "text", "default": "" }, { "name": "gain", "type": "number", "default": 0 }] },
          { "name": "act", "type": "quality", "stages": ["setup", "turn", "close"], "default": "setup" }],
        "gameEvent": [{ "name": "cue", "type": "text", "default": "" }],
        "option": [{ "name": "icon", "type": "text", "default": "dot" }],
        "scene": [{ "name": "theme", "type": "text", "default": "" }],
        "block": [{ "name": "pace", "type": "number", "default": 0 }],
        "project": [{ "name": "studio", "type": "text", "default": "" }]
      },
      "project": { "studio": "Wildwinter" },
      "settings": { "deliveryField": "mood" }
    }
  },
  "scenes": {
    "s_x": { "id": "s_x", "type": "scene", "name": "Harbour", "extensions": { "probe": { "theme": "harbour" } },
      "blocks": [{ "id": "b_main", "type": "block", "name": "Main", "extensions": { "probe": { "pace": 2 } },
        "children": [
          { "id": "sn_a", "type": "snippet", "extensions": { "probe": { "weight": 3 } }, "beats": [
            { "id": "L_one", "kind": "line", "character": "ANNA",
              "extensions": { "probe": { "note": "lights down", "cue": { "sound": "bell", "gain": 0.5 } } } },
            { "id": "E_one", "kind": "gameEvent", "extensions": { "probe": { "cue": "thunder" } } }] },
          { "id": "g_pick", "type": "group", "selector": "choice", "children": [
            { "id": "o_go", "type": "group", "extensions": { "probe": { "icon": "door" } },
              "prompt": { "id": "P_go", "kind": "text", "extensions": { "probe": { "note": "prompt" } } },
              "children": [{ "id": "sn_go", "type": "snippet", "jump": { "to": "END" } }] },
            { "id": "o_stay", "type": "group", "prompt": { "id": "P_stay", "kind": "text" },
              "children": [{ "id": "sn_stay", "type": "snippet", "jump": { "to": "END" } }] }] }] }] }
  },
  "strings": { "en": { "L_one": "Lights down.", "P_go": "Go.", "P_stay": "Stay." } }
})JSON");

	FString JsonOf(const TArray<FPatterExtensionValues>& Extensions, const TCHAR* Extension, const TCHAR* Field)
	{
		FString Json;
		UPatterGameData::FindExtensionValue(Extensions, Extension, Field, Json);
		return Json;
	}

	FString EntryJson(const TArray<FPatterExtensionEntry>& Entries, const TCHAR* Name)
	{
		const FPatterExtensionEntry* E = Entries.FindByPredicate([Name](const FPatterExtensionEntry& X) { return X.Name == Name; });
		return E ? E->Json : FString(TEXT("<absent>"));
	}

	const FPatterOption* OptionNamed(const TArray<FPatterOption>& Options, const TCHAR* Id)
	{
		return Options.FindByPredicate([Id](const FPatterOption& O) { return O.Id == Id; });
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPatterExtensionsTest,
	"Patterplay.Extensions",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FPatterExtensionsTest::RunTest(const FString& Parameters)
{
	UPatterBundle* Bundle = UPatterBundle::LoadFromString(ExtensionsBundleJson);
	if (!TestNotNull(TEXT("the bundle loads"), Bundle)) return false;
	UPatterEngine* Engine = UPatterEngine::Create(Bundle);
	if (!TestNotNull(TEXT("engine created"), Engine)) return false;
	UPatterFlow* Flow = Engine->OpenFlow(TEXT("main"), TEXT("harbour"));
	if (!TestNotNull(TEXT("flow opened"), Flow)) return false;

	// Raw on the step: only what the line sets, a record as JSON text in bundle order.
	const FPatterStep Line = Flow->Advance();
	if (!TestEqual(TEXT("one extension on the line"), Line.Extensions.Num(), 1)) return false;
	TestEqual(TEXT("it is probe"), Line.Extensions[0].Extension, FString(TEXT("probe")));
	TestEqual(TEXT("raw values are the line's own"), Line.Extensions[0].Values.Num(), 2);
	TestEqual(TEXT("note"), JsonOf(Line.Extensions, TEXT("probe"), TEXT("note")), FString(TEXT("\"lights down\"")));
	TestEqual(TEXT("cue, a record"), JsonOf(Line.Extensions, TEXT("probe"), TEXT("cue")), FString(TEXT("{\"sound\":\"bell\",\"gain\":0.5}")));
	{
		FString None;
		TestFalse(TEXT("a value the line doesn't set isn't found"), UPatterGameData::FindExtensionValue(Line.Extensions, TEXT("probe"), TEXT("act"), None));
	}

	// Effective: every declared field, the line's value where it sets one.
	{
		const TArray<FPatterExtensionEntry> Full = UPatterGameData::GetEffectiveExtensionValues(Bundle, TEXT("line"), TEXT("probe"), Line.Extensions);
		TestEqual(TEXT("all three declared fields"), Full.Num(), 3);
		TestEqual(TEXT("note is the line's"), EntryJson(Full, TEXT("note")), FString(TEXT("\"lights down\"")));
		TestEqual(TEXT("act is the default"), EntryJson(Full, TEXT("act")), FString(TEXT("\"setup\"")));
		const TArray<FPatterExtensionEntry> Bare = UPatterGameData::GetEffectiveExtensionValues(Bundle, TEXT("line"), TEXT("probe"), TArray<FPatterExtensionValues>());
		TestEqual(TEXT("a structured default arrives whole"), EntryJson(Bare, TEXT("cue")), FString(TEXT("{\"sound\":\"\",\"gain\":0}")));
		TestEqual(TEXT("an extension the bundle lacks declares nothing"),
			UPatterGameData::GetEffectiveExtensionValues(Bundle, TEXT("line"), TEXT("other"), Line.Extensions).Num(), 0);
	}

	// A game event carries its own; StepFor carries a prompt's.
	const FPatterStep Event = Flow->Advance();
	TestEqual(TEXT("the game event's cue"), JsonOf(Event.Extensions, TEXT("probe"), TEXT("cue")), FString(TEXT("\"thunder\"")));
	{
		FPatterStep Prompt;
		TestTrue(TEXT("StepFor finds the prompt"), Flow->StepFor(TEXT("P_go"), Prompt));
		TestEqual(TEXT("the prompt's note"), JsonOf(Prompt.Extensions, TEXT("probe"), TEXT("note")), FString(TEXT("\"prompt\"")));
	}

	// The choice: o_go carries its icon, o_stay none, and its effective icon is the default.
	const FPatterStep Choice = Flow->Advance();
	if (!TestEqual(TEXT("a choice"), Choice.Type, EPatterStepType::Choice)) return false;
	{
		const FPatterOption* Go = OptionNamed(Choice.Options, TEXT("o_go"));
		const FPatterOption* Stay = OptionNamed(Choice.Options, TEXT("o_stay"));
		if (!TestTrue(TEXT("both options"), Go && Stay)) return false;
		TestEqual(TEXT("o_go's icon"), JsonOf(Go->Extensions, TEXT("probe"), TEXT("icon")), FString(TEXT("\"door\"")));
		TestEqual(TEXT("o_stay carries none"), Stay->Extensions.Num(), 0);
		TestEqual(TEXT("o_stay's icon is the default"),
			EntryJson(UPatterGameData::GetEffectiveExtensionValues(Bundle, TEXT("option"), TEXT("probe"), Stay->Extensions), TEXT("icon")),
			FString(TEXT("\"dot\"")));
	}

	// A save carries none of it; a load reads the option's values back off the bundle.
	{
		const FString Saved = UPatterSave::SerializeState(Engine);
		TestFalse(TEXT("a save carries no extension values"), Saved.Contains(TEXT("\"extensions\"")));
		UPatterEngine* Loaded = UPatterEngine::Create(Bundle);
		if (TestTrue(TEXT("the save loads"), UPatterSave::DeserializeState(Loaded, Saved)))
		{
			UPatterFlow* Back = Loaded->GetFlow(TEXT("main"));
			if (TestNotNull(TEXT("the flow is back"), Back))
			{
				const TArray<FPatterOption> Choices = Back->GetChoices();
				const FPatterOption* Go = OptionNamed(Choices, TEXT("o_go"));
				TestTrue(TEXT("the loaded option's icon, off the bundle"), Go && JsonOf(Go->Extensions, TEXT("probe"), TEXT("icon")) == TEXT("\"door\""));
			}
		}
	}

	// Scenes and blocks, by the engine and on the outline.
	TestEqual(TEXT("ExtensionsForScene"), JsonOf(Engine->ExtensionsForScene(TEXT("harbour")), TEXT("probe"), TEXT("theme")), FString(TEXT("\"harbour\"")));
	TestEqual(TEXT("ExtensionsForBlock"), JsonOf(Engine->ExtensionsForBlock(TEXT("s_x"), TEXT("main")), TEXT("probe"), TEXT("pace")), FString(TEXT("2")));
	TestEqual(TEXT("ExtensionsForScene: an unknown ref"), Engine->ExtensionsForScene(TEXT("nowhere")).Num(), 0);
	TestEqual(TEXT("ExtensionsForSnippet"), JsonOf(Engine->ExtensionsForSnippet(TEXT("sn_a")), TEXT("probe"), TEXT("weight")), FString(TEXT("3")));
	TestEqual(TEXT("ExtensionsForSnippet: a snippet with none"), Engine->ExtensionsForSnippet(TEXT("sn_go")).Num(), 0);
	TestEqual(TEXT("ExtensionsForSnippet: an option is not a snippet"), Engine->ExtensionsForSnippet(TEXT("o_go")).Num(), 0);
	{
		const TArray<FPatterOutlineScene> Outline = Engine->GetOutline();
		if (TestEqual(TEXT("one scene"), Outline.Num(), 1) && TestEqual(TEXT("one block"), Outline[0].Blocks.Num(), 1))
		{
			TestEqual(TEXT("the outline's scene"), JsonOf(Outline[0].Extensions, TEXT("probe"), TEXT("theme")), FString(TEXT("\"harbour\"")));
			TestEqual(TEXT("the outline's block"), JsonOf(Outline[0].Blocks[0].Extensions, TEXT("probe"), TEXT("pace")), FString(TEXT("2")));
			const FPatterOutlineBlock& Block = Outline[0].Blocks[0];
			if (TestTrue(TEXT("the snippet comes first"), Block.Nodes.Num() > 0 && Block.Nodes[0].Beats.Num() == 2))
				TestEqual(TEXT("the outline's beat"), JsonOf(Block.Nodes[0].Beats[0].Extensions, TEXT("probe"), TEXT("note")), FString(TEXT("\"lights down\"")));
		}
	}

	// Any node, by address.
	TestEqual(TEXT("project"), JsonOf(UPatterGameData::ExtensionsOf(Bundle, TEXT("project"), FString()), TEXT("probe"), TEXT("studio")), FString(TEXT("\"Wildwinter\"")));
	TestEqual(TEXT("scene by gameId"), JsonOf(UPatterGameData::ExtensionsOf(Bundle, TEXT("scene"), TEXT("harbour")), TEXT("probe"), TEXT("theme")), FString(TEXT("\"harbour\"")));
	TestEqual(TEXT("block"), JsonOf(UPatterGameData::ExtensionsOf(Bundle, TEXT("block"), TEXT("harbour/main")), TEXT("probe"), TEXT("pace")), FString(TEXT("2")));
	TestEqual(TEXT("option"), JsonOf(UPatterGameData::ExtensionsOf(Bundle, TEXT("option"), TEXT("o_go")), TEXT("probe"), TEXT("icon")), FString(TEXT("\"door\"")));
	TestEqual(TEXT("a prompt is a text beat"), JsonOf(UPatterGameData::ExtensionsOf(Bundle, TEXT("text"), TEXT("P_go")), TEXT("probe"), TEXT("note")), FString(TEXT("\"prompt\"")));
	TestEqual(TEXT("a node of another kind"), UPatterGameData::ExtensionsOf(Bundle, TEXT("line"), TEXT("E_one")).Num(), 0);
	TestEqual(TEXT("an address that names nothing"), UPatterGameData::ExtensionsOf(Bundle, TEXT("snippet"), TEXT("nowhere")).Num(), 0);
	TestEqual(TEXT("an unknown kind"), UPatterGameData::ExtensionsOf(Bundle, TEXT("shelf"), TEXT("L_one")).Num(), 0);

	// A scalar read back as a Patter value; a record is not one.
	{
		FPatterValue Value;
		TestTrue(TEXT("a string is a scalar"), UPatterGameData::ExtensionValueToScalar(TEXT("\"turn\""), Value));
		TestEqual(TEXT("its kind"), Value.Kind, EPatterValueKind::String);
		TestEqual(TEXT("its string"), Value.String, FString(TEXT("turn")));
		TestTrue(TEXT("a number is a scalar"), UPatterGameData::ExtensionValueToScalar(TEXT("0.5"), Value));
		TestEqual(TEXT("its number"), Value.Number, 0.5);
		TestTrue(TEXT("a list of strings reads as flags"), UPatterGameData::ExtensionValueToScalar(TEXT("[\"night\",\"rain\"]"), Value));
		TestEqual(TEXT("its flags"), Value.Flags.Num(), 2);
		TestFalse(TEXT("a record is not a scalar"), UPatterGameData::ExtensionValueToScalar(TEXT("{\"sound\":\"bell\"}"), Value));
		TestFalse(TEXT("text that isn't JSON is not a scalar"), UPatterGameData::ExtensionValueToScalar(TEXT("bell"), Value));
	}

	// The declarations, with a ladder, and the stage functions over one.
	{
		const TArray<FPatterGameDataField> Decls = UPatterGameData::ExtensionDecls(Bundle, TEXT("probe"), TEXT("line"));
		if (TestEqual(TEXT("three line declarations"), Decls.Num(), 3))
		{
			const FPatterGameDataField& Cue = Decls[1];
			TestEqual(TEXT("cue is a record"), Cue.TypeName, FString(TEXT("record")));
			TestEqual(TEXT("a record's default is JSON text only"), Cue.DefaultJson, FString(TEXT("{\"sound\":\"\",\"gain\":0}")));
			TestTrue(TEXT("and has no display default"), Cue.bHasDefault && Cue.Default.IsEmpty());
			const FPatterGameDataField& Act = Decls[2];
			TestEqual(TEXT("act is a quality"), Act.Type, EPatterPropertyType::Quality);
			TestEqual(TEXT("the act ladder"), FString::Join(Act.Stages, TEXT(",")), FString(TEXT("setup,turn,close")));
			TestEqual(TEXT("its scalar default"), Act.TypedDefault.String, FString(TEXT("setup")));
			TestEqual(TEXT("index"), UPatterGameData::StageIndex(Act, TEXT("close")), 2);
			FString Next;
			TestTrue(TEXT("next succeeds"), UPatterGameData::NextStage(Act, TEXT("turn"), Next));
			TestEqual(TEXT("one rung up"), Next, FString(TEXT("close")));
		}
		TestEqual(TEXT("a kind with no declarations"), UPatterGameData::ExtensionDecls(Bundle, TEXT("probe"), TEXT("snippet")).Num(), 0);
		TestEqual(TEXT("an extension the bundle lacks"), UPatterGameData::ExtensionDecls(Bundle, TEXT("other"), TEXT("line")).Num(), 0);
	}

	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
