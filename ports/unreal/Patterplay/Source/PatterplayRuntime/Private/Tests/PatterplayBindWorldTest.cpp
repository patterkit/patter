// Binding @world without writing the HostScopes map: the Patter World component (its world made on first
// ask, the same object after, found on an actor by FindPatterWorld), UPatterEngine::CreateWithWorld (the
// existing host-scopes path under "world", or no binding for a null world), and UPatterBundle::DeclaresWorld.
// Runs via
//   -ExecCmds="Automation RunTests Patterplay.BindWorld"
//
// The container itself (reads, writes, read-only, saves, hot swaps) is Patterplay.World's; this covers only
// the routes added for an engine set up in the editor.

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "PatterBundle.h"
#include "PatterEngine.h"
#include "PatterWorld.h"
#include "PatterWorldComponent.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"

namespace
{
	// One @world property, knows_road. Snippet "learn" writes it; "road" is gated on it.
	const TCHAR* BindWorldBundleJson = TEXT(R"JSON({
  "schema": "patter/bundle@0",
  "content": { "project": "proj_bindworld", "version": "1.0.0", "hash": "bindworldhash" },
  "voiced": false,
  "locales": { "default": "en", "included": ["en"] },
  "properties": [],
  "scopeRegistry": { "version": 1, "scopes": [
    { "token": "world", "declarations": [
      { "name": "knows_road", "type": "boolean", "default": false }
    ] }
  ] },
  "cast": [],
  "strings": { "en": { "T_learn": "You learn the road.", "T_road": "The road north." } },
  "scenes": {
    "learn": { "id": "learn", "name": "Learn", "blocks": [{ "id": "b_learn", "name": "B", "children": [
      { "id": "sn_learn", "type": "snippet", "beats": [{ "id": "T_learn", "kind": "text" }],
        "onEnter": [{ "kind": "set", "target": "@world.knows_road", "value": { "src": "true", "ast": ["b", true] } }],
        "jump": { "to": "END" } }
    ] }] },
    "road": { "id": "road", "name": "Road", "blocks": [{ "id": "b_road", "name": "B", "children": [
      { "id": "sn_road", "type": "snippet", "condition": { "src": "@world.knows_road", "ast": ["sv", "world", "knows_road"] },
        "beats": [{ "id": "T_road", "kind": "text" }], "jump": { "to": "END" } }
    ] }] }
  }
})JSON");

	// A story with no host scopes at all.
	const TCHAR* NoWorldBundleJson = TEXT(R"JSON({"schema":"patter/bundle@0","content":{"project":"proj_noworld","hash":"noworldhash"},"voiced":false,"locales":{"default":"en","included":["en"]},"cast":[],"scenes":{"s":{"id":"s","name":"S","blocks":[{"id":"b","name":"B","children":[{"id":"sn","type":"snippet","beats":[{"id":"T1","kind":"text"}],"jump":{"to":"END"}}]}]}},"strings":{"en":{"T1":"Hello."}}})JSON");

	// A host scope spelt "World": tokens are case-sensitive, so this isn't @world.
	const TCHAR* OtherCaseBundleJson = TEXT(R"JSON({"schema":"patter/bundle@0","content":{"project":"proj_case","hash":"casehash"},"voiced":false,"locales":{"default":"en","included":["en"]},"properties":[],"scopeRegistry":{"version":1,"scopes":[{"token":"World","declarations":[{"name":"x","type":"boolean","default":false}]}]},"cast":[],"scenes":{"s":{"id":"s","name":"S","blocks":[{"id":"b","name":"B","children":[{"id":"sn","type":"snippet","beats":[{"id":"T1","kind":"text"}],"jump":{"to":"END"}}]}]}},"strings":{"en":{"T1":"Hello."}}})JSON");

	// Play a scene through its own flow to the end; the LAST content step's text, or "" for none.
	FString PlayBindScene(UPatterEngine* Engine, const TCHAR* FlowId, const TCHAR* Scene)
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

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPatterplayBindWorldTest,
	"Patterplay.BindWorld",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FPatterplayBindWorldTest::RunTest(const FString& Parameters)
{
	UPatterBundle* Bundle = UPatterBundle::LoadFromString(BindWorldBundleJson);
	if (!TestNotNull(TEXT("bundle loads"), Bundle)) return false;

	// --- DeclaresWorld ------------------------------------------------------------------
	TestTrue(TEXT("a story with @world declares it"), Bundle->DeclaresWorld());
	{
		UPatterBundle* NoWorld = UPatterBundle::LoadFromString(NoWorldBundleJson);
		if (!TestNotNull(TEXT("no-world bundle loads"), NoWorld)) return false;
		TestFalse(TEXT("a story with no host scopes doesn't"), NoWorld->DeclaresWorld());
		UPatterBundle* OtherCase = UPatterBundle::LoadFromString(OtherCaseBundleJson);
		if (!TestNotNull(TEXT("other-case bundle loads"), OtherCase)) return false;
		TestFalse(TEXT("the token matches case-sensitively"), OtherCase->DeclaresWorld());
		UPatterBundle* Unparsed = NewObject<UPatterBundle>();
		TestFalse(TEXT("an unparsed bundle declares nothing"), Unparsed->DeclaresWorld());
	}

	// --- the component's world: made on first ask, the same object after ------------------
	UPatterWorldComponent* Component = NewObject<UPatterWorldComponent>();
	UPatterWorld* World = Component->GetPatterWorld();
	if (!TestNotNull(TEXT("the component makes a world"), World)) return false;
	TestEqual(TEXT("and hands back the same one"), Component->GetPatterWorld(), World);
	World->SetBool(TEXT("Knows_Road"), false);
	TestTrue(TEXT("its names match case-insensitively"), World->Has(TEXT("knows_road")));

	// --- CreateWithWorld binds it as "world" --------------------------------------------
	UPatterEngine* Engine = UPatterEngine::CreateWithWorld(Bundle, World);
	if (!TestNotNull(TEXT("engine with world"), Engine)) return false;
	TestEqual(TEXT("bound under world"), Engine->GetHostScope(TEXT("world")), World);
	TestEqual(TEXT("road gated shut while the world says no"), PlayBindScene(Engine, TEXT("r1"), TEXT("road")), FString());
	World->SetBool(TEXT("knows_road"), true);
	TestEqual(TEXT("a condition sees the game's value"), PlayBindScene(Engine, TEXT("r2"), TEXT("road")), FString(TEXT("The road north.")));
	World->SetBool(TEXT("knows_road"), false);
	TestEqual(TEXT("learn plays"), PlayBindScene(Engine, TEXT("l"), TEXT("learn")), FString(TEXT("You learn the road.")));
	TestTrue(TEXT("an effect writes back to the world"), World->GetBool(TEXT("knows_road")));

	// --- a null world binds nothing: @world is self-backed ----------------------------
	{
		UPatterEngine* Plain = UPatterEngine::CreateWithWorld(Bundle, nullptr);
		if (!TestNotNull(TEXT("engine with no world"), Plain)) return false;
		TestNull(TEXT("nothing bound"), Plain->GetHostScope(TEXT("world")));
		TestFalse(TEXT("self-backed reads the default"), Plain->GetPropertyBool(TEXT("@world.knows_road")));
		TestEqual(TEXT("learn plays self-backed"), PlayBindScene(Plain, TEXT("l"), TEXT("learn")), FString(TEXT("You learn the road.")));
		TestTrue(TEXT("and the engine keeps the write itself"), Plain->GetPropertyBool(TEXT("@world.knows_road")));
	}

	// --- a null bundle is refused, as Create refuses it ----------------------------------
	AddExpectedError(TEXT("null/unparsed bundle"), EAutomationExpectedErrorFlags::Contains, 1);
	TestNull(TEXT("no bundle, no engine"), UPatterEngine::CreateWithWorld(nullptr, World));

	// --- FindPatterWorld on an actor ------------------------------------------------------
	TestNull(TEXT("a null actor has no world"), UPatterWorldComponent::FindPatterWorld(nullptr));
	{
		UWorld* Level = UWorld::CreateWorld(EWorldType::Game, false);
		FWorldContext& Context = GEngine->CreateNewWorldContext(EWorldType::Game);
		Context.SetCurrentWorld(Level);

		AActor* Bare = Level->SpawnActor<AActor>();
		AActor* Holder = Level->SpawnActor<AActor>();
		if (TestNotNull(TEXT("actors spawn"), Bare) && TestNotNull(TEXT("holder spawns"), Holder))
		{
			TestNull(TEXT("an actor with no Patter World has none"), UPatterWorldComponent::FindPatterWorld(Bare));
			// Outered to the actor, a component is one of its own, as one added in Details is.
			// (Not registered: FindComponentByClass reads the actor's own components, registered or not.)
			UPatterWorldComponent* OnActor = NewObject<UPatterWorldComponent>(Holder, TEXT("PatterWorld"));
			// Found before anyone asked the component, and the same object the component then gives.
			UPatterWorld* Found = UPatterWorldComponent::FindPatterWorld(Holder);
			TestNotNull(TEXT("found on the actor"), Found);
			TestEqual(TEXT("the component's own world"), OnActor->GetPatterWorld(), Found);
			TestEqual(TEXT("found again, the same"), UPatterWorldComponent::FindPatterWorld(Holder), Found);
		}

		GEngine->DestroyWorldContext(Level);
		Level->DestroyWorld(false);
	}
	return true;
}

#endif
