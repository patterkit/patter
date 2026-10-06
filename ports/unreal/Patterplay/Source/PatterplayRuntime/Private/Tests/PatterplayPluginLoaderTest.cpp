// The plugin's own path, from a bundle's JSON to played steps. Runs via
//   -ExecCmds="Automation RunTests Patterplay.PluginPath"
//
// The clang TestHost ran the corpus through ITS OWN bundle parser until 2026-10, so the corpus could not
// see what the plugin's loader (PatterBundleLoader.cpp) read or missed. Two things it missed, both found
// in a 2026-10 review: the project's closed-caption settings were never read, so a game always fell back
// to [ ] and SFX; and scenes were played in id order rather than authored order, so a flow opened with no
// scene started on whichever scene id sorted first. Beside them, what CreateWithOptions sets, and a
// number property that round-trips through Blueprint as a double.
//
// Both hosts now read through one reader (Patter/BundleJson.h). Patterplay.BundleReader, below, checks
// that the plugin's FJsonValue accessors give it what the TestHost's give it, from the same JSON.

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "PatterBundle.h"
#include "PatterBundleLoader.h"
#include "PatterEngine.h"
#include "Patter/Bundle.h"
#include "PatterBundleReaderCase.h"

namespace
{
	// Two scenes whose ids sort the other way round from the authored order. The first holds a line with
	// a caption cue in the project's own delimiters, then a line from the caption character, then an
	// interpolated number; the second is never meant to be the start, and its branch gives the decision
	// log something to record.
	const TCHAR* PluginPathBundleJson = TEXT(R"JSON({
  "schema": "patter/bundle@0",
  "content": { "project": "proj_plugin", "version": "1.0.0", "hash": "pluginhash" },
  "voiced": false,
  "closedCaptions": { "open": "<", "close": ">", "character": "FX" },
  "locales": { "default": "en", "included": ["en", "fr"] },
  "properties": [{ "name": "x", "type": "number", "default": 0 }],
  "scopeRegistry": { "version": 1, "scopes": [] },
  "cast": [{ "name": "ANNA" }, { "name": "FX" }],
  "strings": {
    "en": { "L1": "Hello <laughs> there.", "L2": "Thunder.", "T1": "x={@x}", "T2": "gate" },
    "fr": { "L1": "Bonjour <rit> toi.", "L2": "Tonnerre.", "T1": "x={@x}", "T2": "porte" }
  },
  "scenes": {
    "scn_zz": { "id": "scn_zz", "name": "Tavern", "blocks": [{ "id": "b_t", "name": "B", "children": [
      { "id": "sn_t", "type": "snippet", "beats": [
        { "id": "L1", "kind": "line", "character": "ANNA" },
        { "id": "L2", "kind": "line", "character": "FX" },
        { "id": "T1", "kind": "text" }
      ], "jump": { "to": "END" } }
    ] }] },
    "scn_aa": { "id": "scn_aa", "name": "Gate", "blocks": [{ "id": "b_g", "name": "B", "children": [
      { "id": "g_g", "type": "group", "selector": "branch", "children": [
        { "id": "sn_g", "type": "snippet", "beats": [{ "id": "T2", "kind": "text" }], "jump": { "to": "END" } }
      ] }
    ] }] }
  }
})JSON");
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPatterplayPluginPathTest,
	"Patterplay.PluginPath",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FPatterplayPluginPathTest::RunTest(const FString& Parameters)
{
	UPatterBundle* Bundle = UPatterBundle::LoadFromString(PluginPathBundleJson);
	if (!TestNotNull(TEXT("bundle loads"), Bundle)) return false;

	// --- authored scene order, and the project's own caption cues kept while captions are on -----------
	{
		UPatterEngine* Engine = UPatterEngine::Create(Bundle);
		if (!TestNotNull(TEXT("engine"), Engine)) return false;
		UPatterFlow* Flow = Engine->OpenFlow(TEXT("f"), TEXT(""));
		if (!TestNotNull(TEXT("a flow opens with no scene named"), Flow)) return false;
		const FPatterStep First = Flow->Advance();
		TestEqual(TEXT("no scene named starts on the first AUTHORED scene, not the first id"), First.Id, FString(TEXT("L1")));
		TestEqual(TEXT("captions on by default: the cue is shown"), First.Text, FString(TEXT("Hello <laughs> there.")));
	}

	// --- captions off: the project's delimiters and caption character apply -----------------------------
	{
		FPatterEngineOptions Options;
		Options.bClosedCaptions = false;
		UPatterEngine* Engine = UPatterEngine::CreateWithOptions(Bundle, Options);
		if (!TestNotNull(TEXT("engine with captions off"), Engine)) return false;
		UPatterFlow* Flow = Engine->OpenFlow(TEXT("f"), TEXT("scn_zz"));
		if (!TestNotNull(TEXT("flow"), Flow)) return false;
		const FPatterStep Line = Flow->Advance();
		TestFalse(TEXT("the < > cue is stripped (the loader read the project's delimiters)"), Line.Text.Contains(TEXT("laughs")));
		const FPatterStep Next = Flow->Advance();
		TestEqual(TEXT("the caption character's line still plays"), Next.Id, FString(TEXT("L2")));
		TestTrue(TEXT("but silent (the loader read the caption character)"), Next.Text.IsEmpty());
	}

	// --- the other options: locale, and the decision log ---------------------------------------------
	{
		FPatterEngineOptions Options;
		Options.Locale = TEXT("fr");
		Options.bLog = true;
		Options.bUseSeed = true;
		Options.Seed = 7;
		UPatterEngine* Engine = UPatterEngine::CreateWithOptions(Bundle, Options);
		if (!TestNotNull(TEXT("engine with options"), Engine)) return false;
		UPatterFlow* Flow = Engine->OpenFlow(TEXT("f"), TEXT("scn_aa"));
		if (!TestNotNull(TEXT("flow"), Flow)) return false;
		TestEqual(TEXT("the locale option plays in French"), Flow->Advance().Text, FString(TEXT("porte")));
		TestTrue(TEXT("the log option keeps a decision log"), Engine->GetLog().Num() > 0);
	}

	// --- a number property is a double through Blueprint --------------------------------------------
	{
		UPatterEngine* Engine = UPatterEngine::Create(Bundle);
		if (!TestNotNull(TEXT("engine"), Engine)) return false;
		Engine->SetPropertyNumber(TEXT("@x"), 0.1);
		TestEqual(TEXT("0.1 reads back exactly"), Engine->GetPropertyNumber(TEXT("@x")), 0.1);
		UPatterFlow* Flow = Engine->OpenFlow(TEXT("f"), TEXT("scn_zz"));
		if (!TestNotNull(TEXT("flow"), Flow)) return false;
		Flow->Advance();
		Flow->Advance();
		TestEqual(TEXT("and interpolates as 0.1, not 0.10000000149011612"), Flow->Advance().Text, FString(TEXT("x=0.1")));
	}
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPatterplayBundleReaderTest,
	"Patterplay.BundleReader",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

// The shared case (PatterBundleReaderCase.h), read through the plugin's loader. The corpus TestHost
// reads the same JSON through its own JsonValue and checks the same facts.
bool FPatterplayBundleReaderTest::RunTest(const FString& Parameters)
{
	namespace rc = patter::bundlereadercase;
	{
		patter::Bundle Bundle;
		FString Error;
		if (!TestTrue(TEXT("the shared case loads"), PatterLoadBundle(FString(UTF8_TO_TCHAR(rc::Json())), Bundle, Error)))
		{
			AddError(Error);
			return false;
		}
		for (const std::string& What : rc::Check(Bundle))
			AddError(FString::Printf(TEXT("read differently from the TestHost's expectation: %s"), UTF8_TO_TCHAR(What.c_str())));
	}
	{
		patter::Bundle Bundle;
		FString Error;
		TestFalse(TEXT("a missing required field fails the load"), PatterLoadBundle(FString(UTF8_TO_TCHAR(rc::MissingFieldJson())), Bundle, Error));
		TestEqual(TEXT("and names the field, as the TestHost's throw does"), Error, FString(UTF8_TO_TCHAR(rc::MissingFieldError())));
	}
	return true;
}

#endif
