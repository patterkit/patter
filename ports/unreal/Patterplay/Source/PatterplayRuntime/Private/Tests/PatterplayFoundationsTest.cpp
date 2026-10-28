// The runtime foundations before 1.0, as a Blueprint game sees them. Runs via
//   -ExecCmds="Automation RunTests Patterplay.Foundations"
//
// The UE-boundary half the clang TestHost cannot reach (the core's half is the conformance corpus): a
// Setup report made while the engine is built is logged and recorded at once and reaches OnError on the
// first OpenFlow, since OnError can only be bound once Create has returned; the locale in use and the
// bundle's locales; a host write that doesn't fit is RETURNED, as Blueprint can't catch a throw; a flow's
// refused call leaves its reason in GetLastError; a pending choice follows SetLocale; and a load whose
// place has gone reaches OnError as Save.

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "PatterBundle.h"
#include "PatterEngine.h"
#include "PatterWorld.h"
#include "PatterplayErrorsListener.h"

namespace
{
	// The project starts at s2 (not the first scene), which opens on a line and then a choice. The second
	// bundle is the same project with the choice's option replaced, for a hot swap at the pending choice.
	FString FoundationsBundleJson(const TCHAR* Option, const TCHAR* Prompt)
	{
		return FString::Printf(TEXT(R"JSON({
  "schema": "patter/bundle@0",
  "content": { "project": "proj_foundations", "hash": "h_%s", "structureHash": "s_%s" },
  "voiced": false,
  "locales": { "default": "en", "included": ["en", "fr"] },
  "start": { "scene": "s2" },
  "properties": [
    { "name": "gold", "type": "number", "shared": true, "default": 1 },
    { "name": "mood", "type": "enum", "values": ["calm", "tense"], "shared": true, "default": "" }
  ],
  "scopeRegistry": { "version": 1, "scopes": [
    { "token": "world", "declarations": [ { "name": "alarm", "type": "boolean", "default": false } ] }
  ] },
  "cast": [],
  "strings": {
    "en": { "T1": "first", "T2": "start {@gold}", "P_a": "Ask", "P_b": "Leave", "A1": "asked" },
    "fr": { "T1": "premier", "T2": "début {@gold}", "P_a": "Demander", "P_b": "Partir", "A1": "demandé" }
  },
  "scenes": {
    "s1": { "id": "s1", "name": "S1", "blocks": [{ "id": "b1", "name": "B", "children": [
      { "id": "n1", "type": "snippet", "beats": [{ "id": "T1", "kind": "text" }], "jump": { "to": "END" } }
    ] }] },
    "s2": { "id": "s2", "name": "S2", "blocks": [{ "id": "b2", "name": "B", "children": [
      { "id": "n2", "type": "snippet", "beats": [{ "id": "T2", "kind": "text" }] },
      { "id": "g", "type": "group", "selector": "choice", "children": [
        { "id": "%s", "type": "group", "prompt": { "id": "%s", "kind": "text" }, "children": [
          { "id": "c_%s", "type": "snippet", "beats": [{ "id": "A1", "kind": "text" }], "jump": { "to": "END" } }
        ] }
      ] }
    ] }] }
  }
})JSON"), Option, Option, Option, Prompt, Option);
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPatterplayFoundationsTest,
	"Patterplay.Foundations",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FPatterplayFoundationsTest::RunTest(const FString& Parameters)
{
	UPatterBundle* Bundle = UPatterBundle::LoadFromString(FoundationsBundleJson(TEXT("o_a"), TEXT("P_a")));
	if (!TestNotNull(TEXT("bundle loads"), Bundle)) return false;

	// --- Setup reports made while the engine is built -----------------------------------------
	// "FR" is the bundle's "fr" by case only, and "World" isn't the "world" it declares: each is a Warning
	// in the log at once. "World" isn't folded onto "world", which the engine then self-backs.
	AddExpectedMessagePlain(TEXT("is spelled \"fr\" in this bundle"), ELogVerbosity::Warning, EAutomationExpectedMessageFlags::Contains, 1);
	AddExpectedMessagePlain(TEXT("it declares \"world\", and a scope's token is case-sensitive"), ELogVerbosity::Warning, EAutomationExpectedMessageFlags::Contains, 1);
	FPatterEngineOptions Options;
	Options.Locale = TEXT("FR");
	Options.bLog = true;
	UPatterWorld* World = NewObject<UPatterWorld>();
	UPatterEngine* Engine = UPatterEngine::CreateWithOptions(Bundle, Options, { { TEXT("World"), World } });
	if (!TestNotNull(TEXT("engine"), Engine)) return false;

	UPatterplayErrorsListener* Listener = NewObject<UPatterplayErrorsListener>();
	Engine->OnError.AddDynamic(Listener, &UPatterplayErrorsListener::HandleError);
	TestEqual(TEXT("nothing reaches OnError before the first OpenFlow"), Listener->Errors.Num(), 0);

	TArray<FPatterLogEntry> Setup;
	for (const FPatterLogEntry& Row : Engine->Log()) if (Row.Type == TEXT("diagnostic")) Setup.Add(Row);
	if (TestEqual(TEXT("the decision log has both at once"), Setup.Num(), 2))
	{
		TestEqual(TEXT("the locale's: kind"), Setup[0].Kind, FString(TEXT("setup")));
		TestEqual(TEXT("the locale's: node"), Setup[0].Node, FString(TEXT("FR")));
		TestEqual(TEXT("the locale's: no flow"), Setup[0].Flow, FString());
		TestEqual(TEXT("the scope's: node"), Setup[1].Node, FString(TEXT("World")));
	}

	TestEqual(TEXT("Locale is the locale in use"), Engine->Locale(), FString(TEXT("fr")));
	const FPatterLocales Locales = Engine->Locales();
	TestEqual(TEXT("Locales: the default"), Locales.Default, FString(TEXT("en")));
	TestEqual(TEXT("Locales: every locale included"), FString::Join(Locales.Included, TEXT(",")), FString(TEXT("en,fr")));
	TestNull(TEXT("the wrong-case container isn't the world"), Engine->GetHostScope(TEXT("world")));

	// --- the first OpenFlow delivers them, and a flow with no scene starts at the project's start -------
	UPatterFlow* Flow = Engine->OpenFlow(TEXT("main"), FString());
	if (!TestNotNull(TEXT("flow opens"), Flow)) return false;
	if (TestEqual(TEXT("OnError has both now"), Listener->Errors.Num(), 2))
	{
		TestTrue(TEXT("the locale's: kind"), Listener->Errors[0].Kind == EPatterPlayErrorKind::Setup);
		TestEqual(TEXT("the locale's: node"), Listener->Errors[0].Node, FString(TEXT("FR")));
		TestEqual(TEXT("the locale's: no flow"), Listener->Errors[0].Flow, FString());
		TestTrue(TEXT("the scope's: kind"), Listener->Errors[1].Kind == EPatterPlayErrorKind::Setup);
		TestEqual(TEXT("the scope's: node"), Listener->Errors[1].Node, FString(TEXT("World")));
	}
	TestNotNull(TEXT("a second flow opens"), Engine->OpenFlow(TEXT("other"), TEXT("s1")));
	TestEqual(TEXT("and nothing is delivered twice"), Listener->Errors.Num(), 2);
	TestEqual(TEXT("the start scene, in French"), Flow->Advance().Text, FString(TEXT("début 1")));
	TestEqual(TEXT("the self-backed world reads its default"), Engine->GetPropertyBool(TEXT("@world.alarm")), false);

	// --- a host write that doesn't fit is refused, returned, and logged ------------------------
	AddExpectedErrorPlain(TEXT("\"@patter.gold\" takes a number; \"lots\" doesn't fit"), EAutomationExpectedErrorFlags::Contains, 1);
	AddExpectedErrorPlain(TEXT("no property at \"@patter.silver\": the content declares no @patter.silver"), EAutomationExpectedErrorFlags::Contains, 1);
	AddExpectedErrorPlain(TEXT("\"@world.alarm\" takes true or false; 1 doesn't fit"), EAutomationExpectedErrorFlags::Contains, 1);
	AddExpectedErrorPlain(TEXT("\"@patter.mood\" takes one of \"calm\", \"tense\"; \"angry\" doesn't fit"), EAutomationExpectedErrorFlags::Contains, 1);
	TestEqual(TEXT("a string for a number"), Engine->SetPropertyString(TEXT("@gold"), TEXT("lots")), FString(TEXT("\"@patter.gold\" takes a number; \"lots\" doesn't fit")));
	TestEqual(TEXT("an undeclared name"), Engine->SetPropertyNumber(TEXT("@silver"), 1), FString(TEXT("no property at \"@patter.silver\": the content declares no @patter.silver")));
	TestEqual(TEXT("a number for a host scope's boolean"), Engine->SetPropertyNumber(TEXT("@world.alarm"), 1), FString(TEXT("\"@world.alarm\" takes true or false; 1 doesn't fit")));
	FPatterValue Angry;
	Angry.Kind = EPatterValueKind::String;
	Angry.String = TEXT("angry");
	TestEqual(TEXT("a value an enum doesn't list, on a flow"), Flow->SetProperty(TEXT("@mood"), Angry), FString(TEXT("\"@patter.mood\" takes one of \"calm\", \"tense\"; \"angry\" doesn't fit")));
	TestEqual(TEXT("the refused write changed nothing"), Engine->GetPropertyNumber(TEXT("@gold")), 1.0);
	TestEqual(TEXT("an enum whose default is \"\" takes \"\" back"), Engine->SetPropertyString(TEXT("@mood"), FString()), FString());
	TestEqual(TEXT("a value that fits lands"), Engine->SetPropertyNumber(TEXT("@gold"), 5), FString());
	TestEqual(TEXT("and reads back"), Engine->GetPropertyNumber(TEXT("@gold")), 5.0);

	// --- a pending choice follows the language --------------------------------------------------
	const FPatterStep Choice = Flow->Advance();
	if (TestEqual(TEXT("the choice, in French"), Choice.Options.Num(), 1))
		TestEqual(TEXT("its prompt"), Choice.Options[0].Prompt.Text, FString(TEXT("Demander")));
	Engine->SetLocale(TEXT("en"));
	const TArray<FPatterOption> Again = Flow->GetChoices();
	if (TestEqual(TEXT("the same choice"), Again.Num(), 1))
		TestEqual(TEXT("now in English"), Again[0].Prompt.Text, FString(TEXT("Ask")));

	// --- a refused flow call leaves its reason in GetLastError, until the next succeeds ----------
	AddExpectedErrorPlain(TEXT("unknown choice option: nope"), EAutomationExpectedErrorFlags::Contains, 1);
	Flow->Choose(TEXT("nope"));
	TestEqual(TEXT("GetLastError says why"), Flow->GetLastError(), FString(TEXT("unknown choice option: nope")));
	Flow->Choose(TEXT("o_a"));
	TestEqual(TEXT("and a call that succeeds clears it"), Flow->GetLastError(), FString());
	TestEqual(TEXT("the chosen option plays"), Flow->Advance().Text, FString(TEXT("asked")));

	// --- a load whose place has gone reaches OnError as Save --------------------------------------
	{
		UPatterEngine* Live = UPatterEngine::Create(Bundle, {});
		if (!TestNotNull(TEXT("a second engine"), Live)) return false;
		UPatterplayErrorsListener* Heard = NewObject<UPatterplayErrorsListener>();
		Live->OnError.AddDynamic(Heard, &UPatterplayErrorsListener::HandleError);
		UPatterFlow* At = Live->OpenFlow(TEXT("main"), TEXT("s2"));
		if (!TestNotNull(TEXT("its flow opens"), At)) return false;
		At->Advance();
		TestTrue(TEXT("at the choice"), At->Advance().Type == EPatterStepType::Choice);
		UPatterBundle* Edited = UPatterBundle::LoadFromString(FoundationsBundleJson(TEXT("o_b"), TEXT("P_b")));
		if (!TestNotNull(TEXT("the edited bundle loads"), Edited)) return false;
		AddExpectedMessagePlain(TEXT("the save's place has gone from this build"), ELogVerbosity::Warning, EAutomationExpectedMessageFlags::Contains, 1);
		TestTrue(TEXT("hot swap"), Live->HotSwap(Edited));
		if (TestEqual(TEXT("the moved place is reported"), Heard->Errors.Num(), 1))
		{
			TestTrue(TEXT("kind"), Heard->Errors[0].Kind == EPatterPlayErrorKind::Save);
			TestEqual(TEXT("node: the pending choice's group"), Heard->Errors[0].Node, FString(TEXT("g")));
			TestEqual(TEXT("flow"), Heard->Errors[0].Flow, FString(TEXT("main")));
		}
		const FPatterStep Offered = At->Advance();
		if (TestEqual(TEXT("the choice is offered again"), Offered.Options.Num(), 1))
			TestEqual(TEXT("with what it has now"), Offered.Options[0].Id, FString(TEXT("o_b")));
	}
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
