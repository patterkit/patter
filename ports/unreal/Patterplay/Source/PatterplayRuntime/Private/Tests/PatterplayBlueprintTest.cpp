// The Blueprint surface the other runtimes' users already have: a flow's choices, properties (its @scene
// included), log, interpolation and caption stripping; the engine's locale, captions and source-debug
// getters, addresses, scene and block tags and Game Data, every open flow, and OpenFlow with a block and
// a seed; an option's prompt as one value, and the flags that tell an unset speaker from an empty one.
// Runs via
//   -ExecCmds="Automation RunTests Patterplay.Blueprint"

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "PatterBundle.h"
#include "PatterEngine.h"
#include "PatterGameData.h"
#include "PatterAudioResolver.h"

PRAGMA_DISABLE_DEPRECATION_WARNINGS

namespace
{
	// Compiled from a Patter project: one scene with a scene property, tags and Game Data; a line that
	// sets the property on its way out; and a choice of a spoken prompt and a text one.
	const TCHAR* BlueprintBundleJson = TEXT(R"JSON({"schema":"patter/bundle@0","content":{"project":"bp","hash":"0htxidz","structureHash":"0wam8yk"},"voiced":false,"locales":{"default":"en","included":["en"]},"cast":[{"name":"ANNA"}],"properties":[{"name":"gold","type":"number","shared":true,"default":3}],"gameDataFields":{"scene":[{"name":"music","type":"string","default":"calm"}],"block":[{"name":"light","type":"number","default":1}]},"scenes":{"s_hall":{"id":"s_hall","type":"scene","name":"Great Hall","gameData":{"music":"tense"},"tags":["indoor"],"sceneProps":[{"name":"knocks","type":"number","default":0}],"blocks":[{"id":"b_door","type":"block","name":"The Door","children":[{"id":"sn_greet","type":"snippet","beats":[{"id":"L_greet","kind":"line","character":"ANNA"}],"onExit":[{"kind":"set","target":"@scene.knocks","value":{"src":"@scene.knocks + 1","ast":["bin","+",["sv","scene","knocks"],["n",1]]}}]},{"id":"g_ask","type":"group","selector":"choice","children":[{"id":"o_knock","type":"group","children":[{"id":"sn_k","type":"snippet","jump":{"to":"END"}}],"prompt":{"id":"P_knock","kind":"line","character":"ANNA","direction":"softly"}},{"id":"o_leave","type":"group","children":[{"id":"sn_l","type":"snippet","jump":{"to":"END"}}],"prompt":{"id":"P_leave","kind":"text"}}]}],"gameData":{"light":2},"tags":["door"]}]}},"strings":{"en":{"L_greet":"Gold {@gold}.","P_knock":"Knock","P_leave":"Leave"}}})JSON");

	FPatterValue Number(double N)
	{
		FPatterValue V;
		V.Kind = EPatterValueKind::Number;
		V.Number = N;
		return V;
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPatterplayBlueprintTest,
	"Patterplay.Blueprint",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FPatterplayBlueprintTest::RunTest(const FString& Parameters)
{
	UPatterBundle* Bundle = UPatterBundle::LoadFromString(BlueprintBundleJson);
	if (!TestNotNull(TEXT("bundle loads"), Bundle)) return false;
	FPatterEngineOptions Options;
	Options.bLog = true;
	UPatterEngine* Engine = UPatterEngine::CreateWithOptions(Bundle, Options);
	if (!TestNotNull(TEXT("engine"), Engine)) return false;

	// --- the engine's getters, addresses, tags and Game Data -------------------------------
	TestEqual(TEXT("Locale"), Engine->Locale(), FString(TEXT("en")));
	TestFalse(TEXT("IsSourceDebug"), Engine->IsSourceDebug());
	TestTrue(TEXT("ClosedCaptions on by default"), Engine->ClosedCaptions());
	TestEqual(TEXT("SceneAddress"), Engine->SceneAddress(TEXT("s_hall")), FString(TEXT("great-hall")));
	TestEqual(TEXT("BlockAddress"), Engine->BlockAddress(TEXT("b_door")), FString(TEXT("the-door")));
	TestEqual(TEXT("TagsForScene"), FString::Join(Engine->TagsForScene(TEXT("great-hall")), TEXT(",")), FString(TEXT("indoor")));
	TestEqual(TEXT("TagsForBlock: the scene's, then its own"), FString::Join(Engine->TagsForBlock(TEXT("great-hall"), TEXT("the-door")), TEXT(",")), FString(TEXT("indoor,door")));
	const TArray<FPatterGameDataEntry> SceneData = Engine->GameDataForScene(TEXT("great-hall"));
	if (TestEqual(TEXT("GameDataForScene: the scene's own override"), SceneData.Num(), 1))
		TestEqual(TEXT("GameDataForScene: music"), SceneData[0].Value, FString(TEXT("tense")));
	const TArray<FPatterGameDataEntry> BlockData = Engine->GameDataForBlock(TEXT("great-hall"), TEXT("the-door"));
	if (TestEqual(TEXT("GameDataForBlock: the block's own override"), BlockData.Num(), 1))
		TestEqual(TEXT("GameDataForBlock: light"), BlockData[0].Value, FString(TEXT("2")));

	// --- the gameData helpers fill a node's overrides in from the declared defaults ------------------
	const TArray<FPatterGameDataField> SceneFields = UPatterGameData::GameDataFields(Bundle, TEXT("scene"));
	if (TestEqual(TEXT("GameDataFields: the scene type's one field"), SceneFields.Num(), 1))
	{
		TestEqual(TEXT("GameDataFields: its name"), SceneFields[0].Name, FString(TEXT("music")));
		TestEqual(TEXT("GameDataFields: its default"), SceneFields[0].Default, FString(TEXT("calm")));
	}
	const TArray<FPatterGameDataEntry> Effective = UPatterGameData::EffectiveGameData(SceneFields, SceneData);
	TestTrue(TEXT("EffectiveGameData keeps the scene's override"), Effective.Num() == 1 && Effective[0].Value == TEXT("tense"));
	FString Light;
	const TArray<FPatterGameDataField> BlockFields = UPatterGameData::GameDataFields(Bundle, TEXT("block"));
	TestTrue(TEXT("GameDataValue: a node with no override reads the default"), UPatterGameData::GameDataValue(BlockFields, {}, TEXT("light"), Light) && Light == TEXT("1"));
	TestTrue(TEXT("GameDataValue: the block's override"), UPatterGameData::GameDataValue(BlockFields, BlockData, TEXT("light"), Light) && Light == TEXT("2"));
	TestFalse(TEXT("GameDataValue: an undeclared field with no override"), UPatterGameData::GameDataValue(BlockFields, {}, TEXT("nothing"), Light));

	// --- the audio resolver joins its base and a take, keeping a base that is a root --------------------
	const FString Manifest = TEXT(R"({"clips": {"L": {"file": "final/L.wav"}}})");
	TestEqual(TEXT("audio: a folder"), UPatterAudioResolver::Create(Manifest, TEXT("Audio"))->Resolve(TEXT("L")), FString(TEXT("Audio/final/L.wav")));
	TestEqual(TEXT("audio: a folder with its slash"), UPatterAudioResolver::Create(Manifest, TEXT("Audio/"))->Resolve(TEXT("L")), FString(TEXT("Audio/final/L.wav")));
	TestEqual(TEXT("audio: the root keeps its slash"), UPatterAudioResolver::Create(Manifest, TEXT("/"))->Resolve(TEXT("L")), FString(TEXT("/final/L.wav")));
	TestEqual(TEXT("audio: no take is empty"), UPatterAudioResolver::Create(Manifest, TEXT("Audio"))->Resolve(TEXT("M")), FString());

	// --- OpenFlow with a block and a seed, and Flows ---------------------------------------------
	UPatterFlow* Flow = Engine->OpenFlow(TEXT("main"), TEXT("great-hall"), TEXT("the-door"), true, 7);
	if (!TestNotNull(TEXT("OpenFlow with a block and a seed"), Flow)) return false;
	TestEqual(TEXT("Id"), Flow->Id(), FString(TEXT("main")));
	const TArray<UPatterFlow*> Open = Engine->Flows();
	TestTrue(TEXT("Flows hands back the open flow's wrapper"), Open.Num() == 1 && Open[0] == Flow);

	// --- a step says whether its speaker is set ------------------------------------------------
	const FPatterStep Line = Flow->Advance();
	TestEqual(TEXT("the line interpolates @gold"), Line.Text, FString(TEXT("Gold 3.")));
	TestTrue(TEXT("bHasCharacter"), Line.bHasCharacter);
	TestEqual(TEXT("Character"), Line.Character, FString(TEXT("ANNA")));
	TestFalse(TEXT("bHasDirection: the line has none"), Line.bHasDirection);

	// --- the choice, with each option's prompt as one value -----------------------------------
	const FPatterStep Choice = Flow->Advance();
	TestTrue(TEXT("then a choice"), Choice.Type == EPatterStepType::Choice);
	const TArray<FPatterOption> Choices = Flow->GetChoices();
	if (TestEqual(TEXT("GetChoices: both options"), Choices.Num(), 2))
	{
		const FPatterOption& Knock = Choices[0];
		TestTrue(TEXT("a prompt"), Knock.bHasPrompt);
		TestTrue(TEXT("a spoken prompt"), Knock.Prompt.Kind == EPatterPromptKind::Line);
		TestEqual(TEXT("its text"), Knock.Prompt.Text, FString(TEXT("Knock")));
		TestTrue(TEXT("its speaker is set"), Knock.Prompt.bHasCharacter);
		TestEqual(TEXT("its direction"), Knock.Prompt.Direction, FString(TEXT("softly")));
		TestEqual(TEXT("the deprecated flat Text still reads"), Knock.Text, FString(TEXT("Knock")));
		TestTrue(TEXT("a text prompt"), Choices[1].Prompt.Kind == EPatterPromptKind::Text);
		TestFalse(TEXT("with no speaker"), Choices[1].Prompt.bHasCharacter);
		TestEqual(TEXT("the step carries the same options"), Choice.Options.Num(), 2);
	}

	// --- a flow's properties, @scene included ---------------------------------------------------
	FPatterValue Knocks;
	if (TestTrue(TEXT("GetProperty reads @scene"), Flow->GetProperty(TEXT("@scene.knocks"), Knocks)))
		TestEqual(TEXT("the line's onExit counted one knock"), Knocks.Number, 1.0);
	Flow->SetProperty(TEXT("@scene.knocks"), Number(5));
	Flow->GetProperty(TEXT("@scene.knocks"), Knocks);
	TestEqual(TEXT("SetProperty writes @scene"), Knocks.Number, 5.0);
	FPatterValue Unset;
	TestFalse(TEXT("GetProperty: an unknown property is unset"), Flow->GetProperty(TEXT("@scene.nothing"), Unset));
	Engine->SetProperty(TEXT("@gold"), Number(9));
	FPatterValue Gold;
	if (TestTrue(TEXT("the engine's GetProperty"), Engine->GetProperty(TEXT("@gold"), Gold)))
		TestEqual(TEXT("the engine's SetProperty"), Gold.Number, 9.0);
	TestEqual(TEXT("Interpolate reads the flow's state"), Flow->Interpolate(TEXT("{@gold} gold, {@scene.knocks} knocks")), FString(TEXT("9 gold, 5 knocks")));
	TestEqual(TEXT("StripCaptions leaves plain text alone"), Flow->StripCaptions(TEXT("plain")), FString(TEXT("plain")));

	// --- the flow's own log ----------------------------------------------------------------------
	const TArray<FPatterLogEntry> FlowLog = Flow->Log();
	TestTrue(TEXT("the flow's log has the choice"), FlowLog.ContainsByPredicate([](const FPatterLogEntry& E) { return E.Type == TEXT("choice") && E.Group == TEXT("g_ask") && E.Options.Num() == 2; }));
	Flow->ClearLog();
	TestEqual(TEXT("ClearLog empties the flow's log"), Flow->Log().Num(), 0);

	// --- AdvanceToStop: what played, and the stop -------------------------------------------------
	Flow->Choose(TEXT("o_leave"));
	FPatterStep Stop;
	const TArray<FPatterStep> Played = Flow->AdvanceToStop(Stop);
	TestEqual(TEXT("nothing more played"), Played.Num(), 0);
	TestTrue(TEXT("the flow ends"), Stop.Type == EPatterStepType::End);
	return true;
}

PRAGMA_ENABLE_DEPRECATION_WARNINGS

#endif // WITH_DEV_AUTOMATION_TESTS
