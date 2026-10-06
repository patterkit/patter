// Content errors play through, as a Blueprint game sees them. Runs via
//   -ExecCmds="Automation RunTests Patterplay.Errors"
//
// The UE-boundary half the clang TestHost cannot reach: the core reports each content error through
// EngineOptions::onError, and the wrapper turns that into a Warning in the log and the OnError event,
// bound here as a Blueprint binds it (a UFUNCTION on a UObject). Beside it, the decision log's
// `diagnostic` rows through Log, and the save refusals a load now makes before changing anything,
// through UPatterSave. The core's own reports are pinned in the TestHost ([play-errors]).

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "PatterBundle.h"
#include "PatterEngine.h"
#include "PatterSave.h"
#include "PatterplayErrorsListener.h"

namespace
{
	// One scene. The snippet's effects fail in the middle of the list (a division by zero, then a write
	// to @world.clock, which the story promised not to make); a branch child's condition fails too.
	const TCHAR* ErrorsBundleJson = TEXT(R"JSON({
  "schema": "patter/bundle@0",
  "content": { "project": "proj_errors", "version": "1.0.0", "hash": "errorshash" },
  "voiced": false,
  "locales": { "default": "en", "included": ["en"] },
  "properties": [
    { "name": "zero", "type": "number", "default": 0 },
    { "name": "a", "type": "number", "default": 0 },
    { "name": "c", "type": "number", "default": 0 },
    { "name": "d", "type": "number", "default": 0 }
  ],
  "scopeRegistry": { "version": 1, "scopes": [
    { "token": "world", "declarations": [ { "name": "clock", "type": "string", "default": "day", "writable": false } ] }
  ] },
  "cast": [],
  "strings": { "en": { "T_vals": "a={@a} c={@c} d={@d}", "T_bad": "bad", "T_ok": "ok" } },
  "scenes": {
    "s": { "id": "s", "name": "S", "blocks": [{ "id": "b", "name": "B", "children": [
      { "id": "sn_set", "type": "snippet", "beats": [{ "id": "T_vals", "kind": "text" }], "onEnter": [
        { "kind": "set", "target": "@a", "value": { "src": "1", "ast": ["n", 1] } },
        { "kind": "set", "target": "@c", "value": { "src": "10 / @zero", "ast": ["bin", "/", ["n", 10], ["sv", "patter", "zero"]] } },
        { "kind": "set", "target": "@world.clock", "value": { "src": "\"night\"", "ast": ["s", "night"] } },
        { "kind": "set", "target": "@d", "value": { "src": "1", "ast": ["n", 1] } }
      ] },
      { "id": "g_br", "type": "group", "selector": "branch", "children": [
        { "id": "sn_bad", "type": "snippet", "condition": { "src": "10 / @zero > 1", "ast": ["bin", ">", ["bin", "/", ["n", 10], ["sv", "patter", "zero"]], ["n", 1]] },
          "beats": [{ "id": "T_bad", "kind": "text" }] },
        { "id": "sn_ok", "type": "snippet", "beats": [{ "id": "T_ok", "kind": "text" }] }
      ] },
      { "id": "sn_end", "type": "snippet", "jump": { "to": "END" } }
    ] }] }
  }
})JSON");
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPatterplayErrorsTest,
	"Patterplay.Errors",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FPatterplayErrorsTest::RunTest(const FString& Parameters)
{
	UPatterBundle* Bundle = UPatterBundle::LoadFromString(ErrorsBundleJson);
	if (!TestNotNull(TEXT("bundle loads"), Bundle)) return false;

	FPatterEngineOptions Options;
	Options.bLog = true;
	UPatterEngine* Engine = UPatterEngine::CreateWithOptions(Bundle, Options);
	if (!TestNotNull(TEXT("engine"), Engine)) return false;

	UPatterplayErrorsListener* Listener = NewObject<UPatterplayErrorsListener>();
	Engine->OnError.AddDynamic(Listener, &UPatterplayErrorsListener::HandleError);

	// Each error is a Warning in the log as well as the event: three of them, none an Error.
	AddExpectedMessagePlain(TEXT("played through"), ELogVerbosity::Warning, EAutomationExpectedMessageFlags::Contains, 3);

	// --- the story plays through every one of them -----------------------------------
	UPatterFlow* Flow = Engine->OpenFlow(TEXT("main"), TEXT("s"));
	if (!TestNotNull(TEXT("flow opens"), Flow)) return false;
	TestEqual(TEXT("the effects either side of the failures landed"), Flow->Advance().Text, FString(TEXT("a=1 c=0 d=1")));
	TestEqual(TEXT("the failing condition counted as false"), Flow->Advance().Text, FString(TEXT("ok")));
	TestTrue(TEXT("then ends"), Flow->Advance().Type == EPatterStepType::End);
	TestEqual(TEXT("the refused write left @world.clock alone"), Engine->GetPropertyString(TEXT("@world.clock")), FString(TEXT("day")));

	// --- OnError carried each one, in order ----------------------------------------------
	if (TestEqual(TEXT("three errors reported"), Listener->Errors.Num(), 3))
	{
		const FPatterPlayError& Div = Listener->Errors[0];
		TestEqual(TEXT("effect: flow"), Div.Flow, FString(TEXT("main")));
		TestTrue(TEXT("effect: kind"), Div.Kind == EPatterPlayErrorKind::Effect);
		TestEqual(TEXT("effect: node is the snippet owning it"), Div.Node, FString(TEXT("sn_set")));
		TestEqual(TEXT("effect: source"), Div.Source, FString(TEXT("10 / @zero")));
		TestEqual(TEXT("effect: message"), Div.Message, FString(TEXT("division by zero")));

		const FPatterPlayError& ReadOnly = Listener->Errors[1];
		TestTrue(TEXT("read-only write: kind"), ReadOnly.Kind == EPatterPlayErrorKind::Effect);
		TestEqual(TEXT("read-only write: node"), ReadOnly.Node, FString(TEXT("sn_set")));
		TestEqual(TEXT("read-only write: source"), ReadOnly.Source, FString(TEXT("\"night\"")));
		TestTrue(TEXT("read-only write: message names the value"), ReadOnly.Message.Contains(TEXT("'@world.clock' is read-only")));

		const FPatterPlayError& Cond = Listener->Errors[2];
		TestTrue(TEXT("condition: kind"), Cond.Kind == EPatterPlayErrorKind::Condition);
		TestEqual(TEXT("condition: node is the child whose condition failed"), Cond.Node, FString(TEXT("sn_bad")));
		TestEqual(TEXT("condition: source"), Cond.Source, FString(TEXT("10 / @zero > 1")));
		TestEqual(TEXT("condition: message"), Cond.Message, FString(TEXT("division by zero")));
	}

	// --- the decision log has a diagnostic row for each, and no write for a skipped effect ---
	TArray<FString> Writes;
	TArray<FPatterLogEntry> Diagnostics;
	for (const FPatterLogEntry& Row : Engine->Log())
	{
		if (Row.Type == TEXT("write")) Writes.Add(Row.Subject);
		if (Row.Type == TEXT("diagnostic")) Diagnostics.Add(Row);
	}
	TestEqual(TEXT("only the effects that landed are writes"), FString::Join(Writes, TEXT(",")), FString(TEXT("@a,@d")));
	if (TestEqual(TEXT("three diagnostic rows"), Diagnostics.Num(), 3))
	{
		TestEqual(TEXT("diagnostic: kind"), Diagnostics[0].Kind, FString(TEXT("effect")));
		TestEqual(TEXT("diagnostic: subject is the node"), Diagnostics[0].Subject, FString(TEXT("sn_set")));
		TestEqual(TEXT("diagnostic: detail is the message"), Diagnostics[0].Detail, FString(TEXT("division by zero")));
		TestEqual(TEXT("diagnostic: source"), Diagnostics[0].Source, FString(TEXT("10 / @zero")));
		TestEqual(TEXT("diagnostic: flow"), Diagnostics[0].Flow, FString(TEXT("main")));
		TestEqual(TEXT("diagnostic: a condition's kind"), Diagnostics[2].Kind, FString(TEXT("condition")));
	}

	// --- a save the engine cannot read is refused before anything changes -----------------
	// Each refusal is logged as an Error, which UE counts as a test failure unless declared.
	AddExpectedErrorPlain(TEXT("not a patter/save@0 envelope"), EAutomationExpectedErrorFlags::Contains, 1);
	AddExpectedErrorPlain(TEXT("unsupported save version: 3.9"), EAutomationExpectedErrorFlags::Contains, 1);
	AddExpectedErrorPlain(TEXT("malformed save: no flows"), EAutomationExpectedErrorFlags::Contains, 1);
	const FString Good = UPatterSave::SerializeState(Engine);
	const FString Bare = TEXT(R"({"version":3,"registry":{},"sharedVisits":{},"sharedSelectors":{},"flows":{}})");
	const FString Fractional = TEXT(R"({"schema":"patter/save@0","save":{"version":3.9,"registry":{},"sharedVisits":{},"sharedSelectors":{},"flows":{}}})");
	const FString NoFlows = TEXT(R"({"schema":"patter/save@0","save":{"version":3,"registry":{},"sharedVisits":{},"sharedSelectors":{}}})");
	TestFalse(TEXT("a bare snapshot with no envelope is refused"), UPatterSave::DeserializeState(Engine, Bare));
	TestFalse(TEXT("a version of 3.9 is refused, not read as 3"), UPatterSave::DeserializeState(Engine, Fractional));
	TestFalse(TEXT("a save with no flows is refused"), UPatterSave::DeserializeState(Engine, NoFlows));
	TestFalse(TEXT("the flow is still open"), Flow->IsClosed());
	TestEqual(TEXT("the same flow, still the engine's"), Engine->GetFlow(TEXT("main")), Flow);
	TestEqual(TEXT("nothing changed"), UPatterSave::SerializeState(Engine), Good);
	TestTrue(TEXT("and the good save still loads"), UPatterSave::DeserializeState(Engine, Good));

	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
