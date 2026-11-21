// The runner's Bundle and World fields, as a designer sets them in Details: given a Bundle, the runner makes
// its own engine at BeginPlay with World's Patter World bound as @world (a declared name the game hasn't set
// reading its declared default); with no World it takes a Patter World on its own actor; with none there
// either, a story that reads @world logs a warning and plays @world from its declared defaults; a World
// actor with no Patter World is warned about; and an engine handed over with SetEngine first is kept. Runs via
//   -ExecCmds="Automation RunTests Patterplay.RunnerBundleField"
//
// The runner's own rules (Next, Choose, Stop, refusals) are Patterplay.Runner's; this covers only the fields.

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "PatterBundle.h"
#include "PatterEngine.h"
#include "PatterRunnerComponent.h"
#include "PatterWorld.h"
#include "PatterWorldComponent.h"
#include "PatterplayRunnerListener.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"

namespace
{
	// Two @world properties: knows_road, which the game sets, and weather, which it doesn't. "road" is gated
	// on knows_road.
	const TCHAR* RunnerWorldBundleJson = TEXT(R"JSON({
  "schema": "patter/bundle@0",
  "content": { "project": "proj_runnerworld", "version": "1.0.0", "hash": "runnerworldhash" },
  "voiced": false,
  "locales": { "default": "en", "included": ["en"] },
  "properties": [],
  "scopeRegistry": { "version": 1, "scopes": [
    { "token": "world", "declarations": [
      { "name": "knows_road", "type": "boolean", "default": false },
      { "name": "weather", "type": "string", "default": "clear" }
    ] }
  ] },
  "cast": [],
  "strings": { "en": { "T_road": "The road north.", "T_end": "Nowhere to go." } },
  "scenes": {
    "road": { "id": "road", "name": "Road", "blocks": [{ "id": "b_road", "name": "B", "children": [
      { "id": "sn_road", "type": "snippet", "condition": { "src": "@world.knows_road", "ast": ["sv", "world", "knows_road"] },
        "beats": [{ "id": "T_road", "kind": "text" }], "jump": { "to": "END" } },
      { "id": "sn_end", "type": "snippet", "beats": [{ "id": "T_end", "kind": "text" }], "jump": { "to": "END" } }
    ] }] }
  }
})JSON");

	// A story with no host scopes at all.
	const TCHAR* RunnerNoWorldBundleJson = TEXT(R"JSON({"schema":"patter/bundle@0","content":{"project":"proj_runnernoworld","hash":"runnernoworldhash"},"voiced":false,"locales":{"default":"en","included":["en"]},"cast":[],"scenes":{"s":{"id":"s","name":"S","blocks":[{"id":"b","name":"B","children":[{"id":"sn","type":"snippet","beats":[{"id":"T1","kind":"text"}],"jump":{"to":"END"}}]}]}},"strings":{"en":{"T1":"Hello."}}})JSON");
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPatterplayRunnerBundleFieldTest,
	"Patterplay.RunnerBundleField",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FPatterplayRunnerBundleFieldTest::RunTest(const FString& Parameters)
{
	UPatterBundle* Bundle = UPatterBundle::LoadFromString(RunnerWorldBundleJson);
	if (!TestNotNull(TEXT("bundle loads"), Bundle)) return false;
	UPatterBundle* NoWorldBundle = UPatterBundle::LoadFromString(RunnerNoWorldBundleJson);
	if (!TestNotNull(TEXT("no-world bundle loads"), NoWorldBundle)) return false;

	// One each: no World and none on the runner's actor, and a World actor with no Patter World.
	AddExpectedMessagePlain(TEXT("the story reads @world, but no World is set, so @world plays from its declared defaults"),
		ELogVerbosity::Warning, EAutomationExpectedMessageFlags::Contains, 1);
	AddExpectedMessagePlain(TEXT("which has no Patter World"), ELogVerbosity::Warning, EAutomationExpectedMessageFlags::Contains, 1);

	UWorld* Level = UWorld::CreateWorld(EWorldType::Game, false);
	FWorldContext& Context = GEngine->CreateNewWorldContext(EWorldType::Game);
	Context.SetCurrentWorld(Level);

	TArray<UPatterRunnerComponent*> Made;
	// A runner on Host with its fields set as in Details, registered and begun as a level's actor begins it.
	// Outered to the actor, a component is one of its own, as one added in Details is.
	const auto MakeRunner = [&Made](AActor* Host, UPatterBundle* InBundle, AActor* InWorld, UPatterEngine* Given)
	{
		UPatterRunnerComponent* R = NewObject<UPatterRunnerComponent>(Host);
		R->Bundle = InBundle;
		R->World = InWorld;
		R->FlowId = TEXT("talk");
		if (Given) R->SetEngine(Given, TEXT("talk"));
		R->RegisterComponent();
		R->BeginPlay();
		Made.Add(R);
		return R;
	};

	AActor* Holder = Level->SpawnActor<AActor>();
	AActor* Bare = Level->SpawnActor<AActor>();
	AActor* Director = Level->SpawnActor<AActor>();
	if (TestNotNull(TEXT("holder spawns"), Holder) && TestNotNull(TEXT("bare spawns"), Bare) && TestNotNull(TEXT("director spawns"), Director))
	{
		UPatterWorldComponent* WorldComponent = NewObject<UPatterWorldComponent>(Holder, TEXT("PatterWorld"));
		UPatterWorld* GameWorld = WorldComponent->GetPatterWorld();
		GameWorld->SetBool(TEXT("knows_road"), true);

		// --- Bundle and World set: the runner's own engine, the World bound ------------------------------
		{
			UPatterRunnerComponent* R = MakeRunner(Director, Bundle, Holder, nullptr);
			UPatterEngine* Engine = R->GetEngine();
			if (TestNotNull(TEXT("the runner made an engine"), Engine))
			{
				TestEqual(TEXT("with the World bound as world"), Engine->GetHostScope(TEXT("world")), GameWorld);
				TestTrue(TEXT("it reads the game's value"), Engine->GetPropertyBool(TEXT("@world.knows_road")));
				TestEqual(TEXT("a name the game hasn't set reads its declared default"),
					Engine->GetPropertyString(TEXT("@world.weather")), FString(TEXT("clear")));
				TestFalse(TEXT("and the game's World isn't written by it"), GameWorld->Has(TEXT("weather")));
				UPatterplayRunnerListener* L = NewObject<UPatterplayRunnerListener>();
				L->Listen(R);
				TestEqual(TEXT("Begin plays"), R->Begin(TEXT("road")), FString());
				TestEqual(TEXT("a condition sees the game's value"), L->Last(), FString(TEXT("text:T_road")));
				TestNotNull(TEXT("on the runner's FlowId"), Engine->GetFlow(TEXT("talk")));
			}
		}

		// --- no World: a Patter World on the runner's own actor --------------------------------------------
		{
			UPatterRunnerComponent* R = MakeRunner(Holder, Bundle, nullptr, nullptr);
			if (TestNotNull(TEXT("the runner on the World's actor made an engine"), R->GetEngine()))
				TestEqual(TEXT("its own actor's World bound"), R->GetEngine()->GetHostScope(TEXT("world")), GameWorld);
		}

		// --- no World anywhere: the warning, and @world plays from its declared defaults --------------------
		{
			UPatterRunnerComponent* R = MakeRunner(Bare, Bundle, nullptr, nullptr);
			UPatterEngine* Engine = R->GetEngine();
			if (TestNotNull(TEXT("the runner still made an engine"), Engine))
			{
				TestNull(TEXT("nothing bound"), Engine->GetHostScope(TEXT("world")));
				TestFalse(TEXT("self-backed reads the default"), Engine->GetPropertyBool(TEXT("@world.knows_road")));
				UPatterplayRunnerListener* L = NewObject<UPatterplayRunnerListener>();
				L->Listen(R);
				R->Begin(TEXT("road"));
				TestEqual(TEXT("the gate stays shut"), L->Last(), FString(TEXT("text:T_end")));
			}
		}

		// --- a story with no @world: no warning, no World needed ----------------------------------------
		{
			UPatterRunnerComponent* R = MakeRunner(Bare, NoWorldBundle, nullptr, nullptr);
			TestNotNull(TEXT("an engine for a story with no @world"), R->GetEngine());
		}

		// --- a World actor with no Patter World: warned about, nothing bound -----------------------------
		{
			UPatterRunnerComponent* R = MakeRunner(Director, Bundle, Bare, nullptr);
			if (TestNotNull(TEXT("an engine despite the wrong World"), R->GetEngine()))
				TestNull(TEXT("nothing bound from an actor with no Patter World"), R->GetEngine()->GetHostScope(TEXT("world")));
		}

		// --- an engine handed over first is kept --------------------------------------------------------
		{
			UPatterEngine* Given = UPatterEngine::Create(NoWorldBundle, {});
			UPatterRunnerComponent* R = MakeRunner(Director, Bundle, Holder, Given);
			TestEqual(TEXT("SetEngine before BeginPlay wins"), R->GetEngine(), Given);
		}
	}

	for (UPatterRunnerComponent* R : Made) R->DestroyComponent();
	GEngine->DestroyWorldContext(Level);
	Level->DestroyWorld(false);
	return true;
}

#endif
