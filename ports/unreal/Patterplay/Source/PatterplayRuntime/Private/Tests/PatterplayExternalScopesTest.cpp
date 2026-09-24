// Other engines' scopes at the UE boundary (expr/family/engine-scopes.json): the Unreal bundle loader
// reads `externalScopes` (the clang TestHost reads bundles with a parser of its own, so this is the
// only place PatterBundleLoader's half is checked), the engine reads and writes such a scope through
// the game's registry, and a flow that names it where nobody registered it is refused as it opens (or
// a save as it loads), the refusal reaching the output log the way every refused open or load does.
// The core's own behaviour is held by the TestHost's [external-scopes] cases. Runs via
//   -ExecCmds="Automation RunTests Patterplay.ExternalScopes"

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "PatterBundle.h"
#include "PatterEngine.h"
#include "PatterSave.h"
#include "Patter/Engine.h"
#include "Patter/Kernel.h"   // patter::ScopeRegistry, the shared kernel's

namespace
{
	// one-registry.test.ts's intro scene, as Patter's exportBundle writes it: a plain line, then a
	// line gated on `@story.act >= 2` reading `{@story.act}`, whose exit bumps `@story.act`.
	const TCHAR* ExternalBundleJson = TEXT(R"JSON({"schema":"patter/bundle@0","content":{"project":"or","hash":"1vj7vkz","structureHash":"1kvbvcl"},"voiced":false,"locales":{"default":"en","included":["en"]},"properties":[{"name":"fame","type":"number","default":0,"shared":true},{"name":"mood","type":"number","default":0,"shared":false}],"scenes":{"gate":{"id":"gate","type":"scene","name":"Gate","gameId":"gate","blocks":[{"id":"b","type":"block","name":"B","children":[{"id":"hello","type":"snippet","beats":[{"id":"H","kind":"text"}]},{"id":"shout","type":"snippet","condition":{"src":"@story.act >= 2","ast":["bin",">=",["sv","story","act"],["n",2]]},"beats":[{"id":"L","kind":"text"}],"onExit":[{"kind":"set","target":"@story.act","value":{"src":"@story.act + 1","ast":["bin","+",["sv","story","act"],["n",1]]}}],"jump":{"to":"END"}}]}]}},"strings":{"en":{"L":"act {@story.act}","H":"hello"}},"externalScopes":["story"]})JSON");
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPatterplayExternalScopesTest,
	"Patterplay.ExternalScopes",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FPatterplayExternalScopesTest::RunTest(const FString& Parameters)
{
	UPatterBundle* Bundle = UPatterBundle::LoadFromString(ExternalBundleJson);
	if (!TestNotNull(TEXT("bundle loads"), Bundle)) return false;
	TestTrue(TEXT("the loader reads externalScopes"), Bundle->Raw()->externalScopes == std::vector<std::string>{ "story" });

	// Registered by another engine (a stand-in for the Storylet Engine): read and written through it.
	{
		auto Registry = std::make_shared<patter::ScopeRegistry>();
		patter::ScopeDeclaration Act;
		Act.name = "act";
		Act.type = "number";
		Act.defaultValue = patter::PatterValue::Num(2);
		patter::OwnedScopeOptions Story;
		Story.owner = std::string("Storylet Engine");
		Registry->defineOwned("story", { Act }, Story);
		UPatterEngine* Engine = UPatterEngine::CreateWithRegistry(Bundle, Registry);
		if (!TestNotNull(TEXT("engine on the game's registry"), Engine)) return false;
		UPatterFlow* Flow = Engine->OpenFlow(TEXT("f"), TEXT("gate"));
		if (!TestNotNull(TEXT("flow opens"), Flow)) return false;
		TestEqual(TEXT("the plain line"), Flow->Advance().Text, FString(TEXT("hello")));
		TestEqual(TEXT("the gated line reads @story.act"), Flow->Advance().Text, FString(TEXT("act 2")));
		TestTrue(TEXT("then ends"), Flow->Advance().Type == EPatterStepType::End);
		const std::optional<patter::PatterValue> After = Registry->get("story", "act");
		TestTrue(TEXT("the exit wrote the other engine's value"), After && After->isNumber() && After->n == 3.0);
	}

	// Nobody registered it: the open is refused, and so is a save made where the other engine was
	// present, loaded where it is not, before anything changes. Each refusal is the core's, logged as
	// an error, the way the wrapper reports every refused open or load.
	{
		const TCHAR* Refusal = TEXT("this content names @story, which no engine on this registry registered: give every engine the game's one registry");
		AddExpectedErrorPlain(Refusal, EAutomationExpectedErrorFlags::Contains, 2);
		AddExpectedErrorPlain(TEXT("unknown scope '@story'"), EAutomationExpectedErrorFlags::Contains, 1);

		UPatterEngine* Alone = UPatterEngine::CreateWithRegistry(Bundle, std::make_shared<patter::ScopeRegistry>());
		if (!TestNotNull(TEXT("engine on an empty registry"), Alone)) return false;
		TestNull(TEXT("the open is refused"), Alone->OpenFlow(TEXT("f"), TEXT("gate")));
		TestNull(TEXT("and leaves no flow behind"), Alone->GetFlow(TEXT("f")));

		auto MakeStory = [](double Value)
		{
			auto Registry = std::make_shared<patter::ScopeRegistry>();
			patter::ScopeDeclaration Act;
			Act.name = "act";
			Act.type = "number";
			Act.defaultValue = patter::PatterValue::Num(Value);
			patter::OwnedScopeOptions Story;
			Story.owner = std::string("Storylet Engine");
			Registry->defineOwned("story", { Act }, Story);
			return Registry;
		};
		auto GameRegistry = MakeStory(2);
		UPatterEngine* Game = UPatterEngine::CreateWithRegistry(Bundle, GameRegistry);
		if (!TestNotNull(TEXT("engine where the other engine is present"), Game)) return false;
		TestNotNull(TEXT("its flow opens"), Game->OpenFlow(TEXT("f"), TEXT("gate")));
		const FString Save = UPatterSave::SaveStateToJson(Game);

		auto Elsewhere = MakeStory(1);
		UPatterEngine* Other = UPatterEngine::CreateWithRegistry(Bundle, Elsewhere);
		if (!TestNotNull(TEXT("a second engine"), Other)) return false;
		UPatterFlow* Keep = Other->OpenFlow(TEXT("keep"), TEXT("gate"));
		TestNotNull(TEXT("its flow opens"), Keep);
		Elsewhere->remove("story");
		TestFalse(TEXT("the load is refused"), UPatterSave::LoadStateFromJson(Other, Save));
		TestTrue(TEXT("the load changed nothing"), Keep && !Keep->IsClosed() && Other->GetFlow(TEXT("keep")) == Keep);
		TestNull(TEXT("and restored no flow"), Other->GetFlow(TEXT("f")));

		// The engine that took the scope away mid-game: a write names it, never landing in @patter.
		GameRegistry->remove("story");
		Game->SetPropertyNumber(TEXT("@story.act"), 1.f);   // refused and logged, never thrown through
		TestFalse(TEXT("the refused write did not land in @patter"), GameRegistry->get("patter", "story.act").has_value());
	}
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
