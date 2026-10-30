// The corpus TestHost: load corpus.json and replay every section through the C++
// Patterplay runtime, asserting the same results the JS reference produces - the port's
// half of the parity contract. Standalone (clang), no Unreal needed.
//
//   build.sh   (compiles + runs against packages/conformance/corpus.json)

#include <algorithm>
#include <cstdio>
#include <cstdint>
#include <fstream>
#include <functional>
#include <limits>
#include <cmath>
#include <sstream>
#include <iostream>
#include <queue>
#include <chrono>
#include "Json.h"
#include "Patter/Save.h"
#include "Patter/Describe.h"
#include "Patter/StateLogger.h"
#include "Patter/Engine.h"
#include "Patter/Mulberry32.h"
#include "Patter/BundleJson.h"
#include "Patter/Audio.h"
#include "Patter/Runner.h"
#include "../Patterplay/Source/PatterplayRuntime/Private/Tests/PatterBundleReaderCase.h"   // shared with the plugin's test
#include "RegistryCorpus.h"   // the shared registry corpus runner, vendored from ../expr

using namespace patter;

static int g_fails = 0;
static void fail(const std::string& section, const std::string& name, const std::string& detail)
{
    ++g_fails;
    std::cerr << "  FAIL [" << section << "] " << name << ": " << detail << "\n";
}

// ----- JSON -> model ----------------------------------------------------------

// The corpus's own inputs (scope values, expected results, gameData overrides, save blobs), not a
// bundle's: strict, so a corpus case written wrong fails loudly instead of reading as false.
static PatterValue toValue(const JsonValue& e)
{
    switch (e.type)
    {
        case JsonValue::Bool: return PatterValue::Bool(e.b);
        case JsonValue::Number: return PatterValue::Num(e.num);
        case JsonValue::String: return PatterValue::Str(e.str);
        case JsonValue::Array:
        {
            std::vector<std::string> f;
            for (const auto& x : e.arr) f.push_back(x.str);
            return PatterValue::Flags(f);
        }
        default: throw std::runtime_error("unsupported value kind");
    }
}

static std::shared_ptr<GameData> parseGameData(const JsonValue& e)
{
    auto gd = std::make_shared<GameData>();
    for (const auto& kv : e.obj) (*gd)[kv.first] = toValue(kv.second);
    return gd;
}

// One line, because the tag dispatch is the SHARED source (Patter/Expr/Ast.h),
// parameterised on the JSON type. This host's JsonValue matches the default
// AstJson accessors, so there is nothing to specialise. It also gains the arity
// checks the UE loader had and this one did not.
static AstPtr parseAst(const JsonValue& e) { return DeserialiseAstFrom<JsonValue>(e); }

// The bundle itself is read by the plugin's own reader (Patter/BundleJson.h), so the corpus checks the
// parser games use rather than a second one beside it. This host only says how to read its JsonValue's
// objects; the scalar and array accessors are AstJson's defaults, which already fit it.
namespace patter
{
    template <>
    struct BundleJson<JsonValue>
    {
        static bool isObject(const JsonValue& v) { return v.isObject(); }
        static bool isNull(const JsonValue& v) { return v.isNull(); }
        static bool isNumber(const JsonValue& v) { return v.isNumber(); }
        static bool isBool(const JsonValue& v) { return v.isBool(); }
        static const JsonValue* find(const JsonValue& o, const char* key) { return o.isObject() ? o.find(key) : nullptr; }
        // JsonValue keeps an object's fields in a vector, in document order.
        template <typename Fn>
        static void forEachField(const JsonValue& o, Fn&& fn) { for (const auto& kv : o.obj) fn(kv.first, kv.second); }
    };
}


// ----- normalised step -> JsonValue (mirror normaliseStep) --------------------

static JsonValue valueToJson(const PatterValue& v)
{
    switch (v.kind)
    {
        case PatterKind::Bool: return JsonValue::Boolean(v.b);
        case PatterKind::Number: return JsonValue::Num(v.n);
        case PatterKind::Str: return JsonValue::Str(v.s);
        case PatterKind::Flags: { JsonValue a = JsonValue::Arr(); for (auto& s : v.f) a.push(JsonValue::Str(s)); return a; }
        default: return JsonValue();
    }
}
static JsonValue gameDataToJson(const GameData& gd)
{
    JsonValue o = JsonValue::Obj();
    for (const auto& kv : gd) o.set(kv.first, valueToJson(kv.second));
    return o;
}
// Patter extension values: the core's neutral tree, back into this host's JsonValue for the comparison.
static JsonValue treeToJson(const JsonTree& t)
{
    switch (t.type)
    {
        case JsonTree::Bool: return JsonValue::Boolean(t.b);
        case JsonTree::Number: return JsonValue::Num(t.num);
        case JsonTree::String: return JsonValue::Str(t.str);
        case JsonTree::Array: { JsonValue a = JsonValue::Arr(); for (const auto& x : t.arr) a.push(treeToJson(x)); return a; }
        case JsonTree::Object: { JsonValue o = JsonValue::Obj(); for (const auto& kv : t.obj) o.set(kv.first, treeToJson(kv.second)); return o; }
        default: return JsonValue();
    }
}
static JsonValue extensionValuesToJson(const ExtensionValues& values)
{
    JsonValue o = JsonValue::Obj();
    for (const auto& kv : values) o.set(kv.first, treeToJson(kv.second));
    return o;
}
static JsonValue extensionsToJson(const NodeExtensions& ext)
{
    JsonValue o = JsonValue::Obj();
    for (const auto& kv : ext) o.set(kv.first, extensionValuesToJson(kv.second));
    return o;
}
static JsonValue tagsToJson(const std::vector<std::string>& tags)
{
    JsonValue a = JsonValue::Arr();
    for (const auto& t : tags) a.push(JsonValue::Str(t));
    return a;
}
// Whether a bundle's strings are IDs-only, as the runtime reads it (a source-debug build still resolves names).
static bool isIdsOnly(const Bundle& bundle)
{
    return bundle.localisation.mode == "ids" && !bundle.localisation.sourceDebug;
}

// A speaker's label as a transcript records it: only where it differs from what a line with no qualifier shows
// (nothing in IDs-only mode or with no speaker, else the display name, else the token), so a transcript names it
// where a qualifier or a pair's own label changes it. A runtime that drops a label it should carry records a
// marker rather than nothing. Set on `o` only when recorded. The JS runner's labelField.
static void setLabelField(JsonValue& o, bool hasCharacter, const std::string& character, bool hasCharacterName, const std::string& characterName,
                          bool hasSpeakerLabel, const std::string& speakerLabel, bool idsOnly)
{
    const bool hasPlain = !idsOnly && hasCharacter && !character.empty();
    const std::string plain = !hasPlain ? std::string() : hasCharacterName ? characterName : character;
    if (hasSpeakerLabel == hasPlain && (!hasPlain || speakerLabel == plain)) return;
    o.set("speakerLabel", JsonValue::Str(hasSpeakerLabel ? speakerLabel : "<missing>"));
}

// `idsOnly`: the bundle's strings are IDs-only, so names (the speaker's label among them) are the game's to resolve.
static JsonValue normalize(const StepResult& s, bool idsOnly = false)
{
    JsonValue o = JsonValue::Obj();
    switch (s.type)
    {
        case StepType::Line:
            o.set("type", JsonValue::Str("line")); o.set("id", JsonValue::Str(s.id)); o.set("text", JsonValue::Str(s.text));
            if (s.hasCharacter) o.set("character", JsonValue::Str(s.character));
            if (s.hasCharacterName) o.set("characterName", JsonValue::Str(s.characterName));
            if (s.hasDirection) o.set("direction", JsonValue::Str(s.direction));
            if (s.hasQualifier) o.set("qualifier", JsonValue::Str(s.qualifier));               // speaker qualifier gameId
            if (s.hasQualifierName) o.set("qualifierName", JsonValue::Str(s.qualifierName));   // and its locale-resolved name
            setLabelField(o, s.hasCharacter, s.character, s.hasCharacterName, s.characterName, s.hasSpeakerLabel, s.speakerLabel, idsOnly); // where it differs
            if (s.padAfter != DEFAULT_PAD_AFTER) o.set("padAfter", JsonValue::Num(s.padAfter)); // line padding, when not the default
            if (s.gameData) o.set("gameData", gameDataToJson(*s.gameData));
            if (!s.extensions.empty()) o.set("extensions", extensionsToJson(s.extensions));   // Patter extension values, raw
            if (s.hasTags) o.set("tags", tagsToJson(s.tags));
            break;
        case StepType::Text:
            o.set("type", JsonValue::Str("text")); o.set("id", JsonValue::Str(s.id)); o.set("text", JsonValue::Str(s.text));
            if (s.padAfter != DEFAULT_PAD_AFTER) o.set("padAfter", JsonValue::Num(s.padAfter));
            if (s.action) o.set("action", JsonValue::Boolean(true)); // action text: not shown to the player
            if (s.gameData) o.set("gameData", gameDataToJson(*s.gameData));
            if (!s.extensions.empty()) o.set("extensions", extensionsToJson(s.extensions));   // Patter extension values, raw
            if (s.hasTags) o.set("tags", tagsToJson(s.tags));
            break;
        case StepType::GameEvent:
            o.set("type", JsonValue::Str("gameEvent")); o.set("id", JsonValue::Str(s.id));
            if (s.gameData) o.set("gameData", gameDataToJson(*s.gameData));
            if (!s.extensions.empty()) o.set("extensions", extensionsToJson(s.extensions));   // Patter extension values, raw
            if (s.hasTags) o.set("tags", tagsToJson(s.tags));
            break;
        case StepType::Choice:
        {
            // The whole choice as the host receives it: the group id, and each option's structured prompt.
            // A prompt's speaker fields are written when set, an empty string included, as on a line step.
            o.set("type", JsonValue::Str("choice"));
            o.set("groupId", JsonValue::Str(s.groupId));
            JsonValue opts = JsonValue::Arr();
            for (const auto& opt : s.options)
            {
                JsonValue od = JsonValue::Obj();
                od.set("id", JsonValue::Str(opt.id));
                if (opt.prompt)
                {
                    JsonValue p = JsonValue::Obj();
                    p.set("kind", JsonValue::Str(opt.prompt->kind));
                    p.set("text", JsonValue::Str(opt.prompt->text));
                    if (opt.prompt->hasCharacter) p.set("character", JsonValue::Str(opt.prompt->character));
                    if (opt.prompt->hasCharacterName) p.set("characterName", JsonValue::Str(opt.prompt->characterName));
                    if (opt.prompt->hasDirection) p.set("direction", JsonValue::Str(opt.prompt->direction));
                    if (opt.prompt->hasQualifier) p.set("qualifier", JsonValue::Str(opt.prompt->qualifier));
                    if (opt.prompt->hasQualifierName) p.set("qualifierName", JsonValue::Str(opt.prompt->qualifierName));
                    if (opt.prompt->kind == "line")
                        setLabelField(p, opt.prompt->hasCharacter, opt.prompt->character, opt.prompt->hasCharacterName, opt.prompt->characterName,
                                      opt.prompt->hasSpeakerLabel, opt.prompt->speakerLabel, idsOnly);
                    // Line padding, when not the default; a prompt without one records a marker, as normaliseStep does.
                    if (!opt.prompt->hasPadAfter) p.set("padAfter", JsonValue::Str("<missing>"));
                    else if (opt.prompt->padAfter != DEFAULT_PAD_AFTER) p.set("padAfter", JsonValue::Num(opt.prompt->padAfter));
                    od.set("prompt", std::move(p));
                }
                od.set("eligible", JsonValue::Boolean(opt.eligible));
                if (opt.gameData) od.set("gameData", gameDataToJson(*opt.gameData));
                if (!opt.extensions.empty()) od.set("extensions", extensionsToJson(opt.extensions));
                opts.push(std::move(od));
            }
            o.set("options", std::move(opts));
            break;
        }
        case StepType::End:
            o.set("type", JsonValue::Str("end"));
            // Recorded only when it ran dry (corpus 10); absent = "ended".
            if (s.reason == EndReason::RanDry) o.set("reason", JsonValue::Str("ran-dry"));
            break;
    }
    return o;
}

// ----- structural match (produced vs expected) --------------------------------

static bool matchValue(const JsonValue& a, const JsonValue& e);
static bool matchObject(const JsonValue& a, const JsonValue& e)
{
    if (a.obj.size() != e.obj.size()) return false;
    for (const auto& kv : e.obj) { const JsonValue* av = a.find(kv.first); if (!av || !matchValue(*av, kv.second)) return false; }
    return true;
}
static bool matchValue(const JsonValue& a, const JsonValue& e)
{
    if (a.type != e.type) return false;
    switch (e.type)
    {
        case JsonValue::Object: return matchObject(a, e);
        case JsonValue::Array:
            if (a.arr.size() != e.arr.size()) return false;
            for (size_t i = 0; i < e.arr.size(); ++i) if (!matchValue(a.arr[i], e.arr[i])) return false;
            return true;
        case JsonValue::String: return a.str == e.str;
        case JsonValue::Number: return a.num == e.num;
        case JsonValue::Bool: return a.b == e.b;
        case JsonValue::Null: return true;
        default: return false;
    }
}

static std::string dump(const JsonValue& v)
{
    switch (v.type)
    {
        case JsonValue::Object: { std::string s = "{"; bool f = true; for (auto& kv : v.obj) { if (!f) s += ","; f = false; s += "\"" + kv.first + "\":" + dump(kv.second); } return s + "}"; }
        case JsonValue::Array: { std::string s = "["; for (size_t i = 0; i < v.arr.size(); ++i) { if (i) s += ","; s += dump(v.arr[i]); } return s + "]"; }
        case JsonValue::String: return "\"" + v.str + "\"";
        case JsonValue::Number: return PatterValue::JsNumber(v.num);
        case JsonValue::Bool: return v.b ? "true" : "false";
        default: return "null";
    }
}

// ----- sections ---------------------------------------------------------------

static int runExpressions(const JsonValue& arr, const std::string& family = "expr")
{
    int pass = 0;
    for (const auto& c : arr.arr)
    {
        std::string name = c.at("name").str;
        try
        {
            AstPtr node = parseAst(c.at("ast"));
            EvalContext ctx;
            // bag scopes (stable for the eval; values copied into a kept map)
            auto bags = std::make_shared<std::map<std::string, std::map<std::string, PatterValue>>>();
            for (const auto& scope : c.at("scopes").obj)
            {
                std::map<std::string, PatterValue> bag;
                for (const auto& p : scope.second.obj) bag[p.first] = toValue(p.second);
                (*bags)[scope.first] = bag;
            }
            for (auto& kv : *bags)
            {
                const std::string token = kv.first;
                ctx.scopes[token] = std::make_shared<FnScope>(
                    [bags, token](const std::string& n) -> std::optional<PatterValue> {
                        auto& bag = (*bags)[token];
                        auto it = bag.find(n);
                        return it != bag.end() ? std::optional<PatterValue>(it->second) : std::nullopt;
                    });
            }
            // The dialect's host hooks live in PatterHost, reached through
            // ctx.host; it must outlive the evaluation, so it is a local here.
            std::shared_ptr<Mulberry32> rng;
            PatterHost evalHost;
            if (const JsonValue* seed = c.find("seed")) { rng = std::make_shared<Mulberry32>(seed->num); evalHost.nextRandom = [rng]() { return rng->next(); }; }
            ctx.host = &evalHost;
            // A quality case's ladders, keyed "scope.name", answer the evaluator's quality channel.
            std::map<std::string, std::vector<std::string>> ladders;
            if (const JsonValue* q = c.find("qualities"); q && q->isObject())
            {
                for (const auto& pair : q->obj)
                {
                    std::vector<std::string> ladder;
                    for (const auto& stage : pair.second.arr) ladder.push_back(stage.str);
                    ladders[pair.first] = std::move(ladder);
                }
                ctx.qualities = [&ladders](const std::string& scope, const std::string& prop) -> const std::vector<std::string>*
                {
                    auto it = ladders.find(scope + "." + prop);
                    return it == ladders.end() ? nullptr : &it->second;
                };
            }

            // `expectError` cases pin the TYPING contract: which operand
            // combinations the evaluator must REFUSE. Without them a runtime
            // that never raises passes every value case and is still wrong
            // about most of the language. Needed for the expr parity corpus,
            // which is mostly made of them.
            const bool expectError = c.find("expectError") != nullptr;
            std::string error;
            bool raised = false;
            PatterValue actual;
            try { actual = Evaluate(node, ctx, PatterDialect()); }
            catch (const std::exception& ex) { raised = true; error = ex.what(); }

            if (expectError)
            {
                if (raised) ++pass;
                else fail(family, name, "expected an eval error, got " + actual.toDisplayString());
            }
            else if (raised)
            {
                fail(family, name, "unexpected error: " + error);
            }
            else
            {
                PatterValue expected = toValue(c.at("expected"));
                if (actual.valueEquals(expected)) ++pass;
                else fail(family, name, "expected " + valueToJson(expected).str + ", got " + actual.toDisplayString());
            }
        }
        catch (const std::exception& ex) { fail(family, name, ex.what()); }
    }
    return pass;
}

/** The host's stage helpers over a ladder (expr corpus v4), through the vendored kernel: a position,
 *  -1, 0 or 1, or a stage name, or an error where the case expects one. */
static int runStages(const JsonValue& arr)
{
    int pass = 0;
    for (const auto& c : arr.arr)
    {
        const std::string name = c.at("name").str;
        const bool expectError = c.find("expectError") != nullptr;
        std::vector<std::string> ladder;
        for (const auto& stage : c.at("ladder").arr) ladder.push_back(stage.str);
        std::vector<PatterValue> args;
        for (const auto& a : c.at("args").arr) args.push_back(toValue(a));
        std::string got, error;
        bool raised = false;
        try
        {
            const std::string call = c.at("call").str;
            if (call == "index") got = std::to_string(StageIndex(ladder, args.at(0)));
            else if (call == "compare") got = std::to_string(CompareStages(ladder, args.at(0), args.at(1)));
            else if (call == "next") got = "\"" + NextStage(ladder, args.at(0)) + "\"";
            else { raised = true; error = "unknown call " + call; }
        }
        catch (const std::exception& ex) { raised = true; error = ex.what(); }

        if (expectError)
        {
            if (raised) ++pass;
            else fail("expr/stages", name, "expected an error, got " + got);
        }
        else if (raised) fail("expr/stages", name, "unexpected error: " + error);
        else
        {
            const JsonValue& e = c.at("expected");
            const std::string want = e.isString() ? "\"" + e.str + "\"" : std::to_string(static_cast<int>(e.num));
            if (got == want) ++pass;
            else fail("expr/stages", name, "expected " + want + ", got " + got);
        }
    }
    return pass;
}

static int runSpecificity(const JsonValue& arr)
{
    int pass = 0;
    for (const auto& c : arr.arr)
    {
        std::string name = c.at("name").str;
        try
        {
            AstPtr node = parseAst(c.at("ast"));
            EvalContext ctx;
            auto bags = std::make_shared<std::map<std::string, std::map<std::string, PatterValue>>>();
            for (const auto& scope : c.at("scopes").obj)
            {
                std::map<std::string, PatterValue> bag;
                for (const auto& p : scope.second.obj) bag[p.first] = toValue(p.second);
                (*bags)[scope.first] = bag;
            }
            for (auto& kv : *bags)
            {
                const std::string token = kv.first;
                ctx.scopes[token] = std::make_shared<FnScope>(
                    [bags, token](const std::string& n) -> std::optional<PatterValue> {
                        auto& bag = (*bags)[token];
                        auto it = bag.find(n);
                        return it != bag.end() ? std::optional<PatterValue>(it->second) : std::nullopt;
                    });
            }
            int actual = matchedSpec(node, ctx, true);
            int expected = static_cast<int>(c.at("expected").num);
            if (actual == expected) ++pass;
            else fail("spec", name, "expected " + std::to_string(expected) + ", got " + std::to_string(actual));
        }
        catch (const std::exception& ex) { fail("spec", name, ex.what()); }
    }
    return pass;
}

// A case's `engineOptions`: the construction options it plays under, for its engine and every engine a
// saveLoad / hotSwap makes (they share `opts`). An absent key keeps the engine's default.
// What every engine of the running case reported through onRefit, for expectRefits.
static std::vector<LoadMisfit> caseRefits;
// What every engine of the running case reported through onError, from the first engine's construction on,
// for expectErrors.
static std::vector<PlayError> caseErrors;

static void applyEngineOptions(const JsonValue& c, EngineOptions& opts)
{
    // A fresh case: its engines (and every one a saveLoad or hotSwap makes) record into one list each.
    caseRefits.clear();
    caseErrors.clear();
    opts.onRefit = [](const std::vector<LoadMisfit>& m) { caseRefits.insert(caseRefits.end(), m.begin(), m.end()); };
    opts.onError = [](const PlayError& e) { caseErrors.push_back(e); };
    // The case's locale (corpus 8): every engine it makes is made in it, whatever setLocale did since.
    if (const JsonValue* loc = c.find("locale")) opts.locale = loc->str;
    // The case's host scopes (corpus 8): each token bound to a store kept for the whole case, read and written
    // by name, shared by every engine the case makes.
    if (const JsonValue* hs = c.find("hostScopes"))
        for (const auto& token : hs->arr)
        {
            auto store = std::make_shared<std::map<std::string, PatterValue>>();
            HostScope scope;
            scope.get = [store](const std::string& name) -> const PatterValue*
            {
                auto it = store->find(name);
                return it != store->end() ? &it->second : nullptr;
            };
            scope.set = [store](const std::string& name, const PatterValue& value) { (*store)[name] = value; };
            opts.hostScopes[token.str] = scope;
        }
    const JsonValue* eo = c.find("engineOptions");
    if (!eo) return;
    if (const JsonValue* rp = eo->find("replayPromptOnChoose")) opts.replayPromptOnChoose = rp->b;
    if (const JsonValue* cc = eo->find("closedCaptions")) opts.closedCaptions = cc->b;
}

static int runRuntime(const JsonValue& arr)
{
    int pass = 0;
    for (const auto& c : arr.arr)
    {
        std::string name = c.at("name").str;
        try
        {
            Bundle bundle = parseBundle(c.at("bundle"));
            EngineOptions opts;
            std::shared_ptr<Mulberry32> rng;
            if (const JsonValue* seed = c.find("seed")) { rng = std::make_shared<Mulberry32>(seed->num); opts.rng = [rng]() { return rng->next(); }; }
            applyEngineOptions(c, opts);

            Engine engine(bundle, opts);
            std::string startScene, startBlock;
            if (const JsonValue* start = c.find("start")) { if (const JsonValue* sc = start->find("scene")) startScene = sc->str; if (const JsonValue* bl = start->find("block")) startBlock = bl->str; }
            Flow* flow = engine.openFlow("main", startScene, startBlock);

            std::queue<std::string> scripted;
            if (const JsonValue* ch = c.find("choices")) for (const auto& x : ch->arr) scripted.push(x.str);

            JsonValue transcript = JsonValue::Arr();
            for (int i = 0; i < 1000; ++i)
            {
                StepResult step = flow->advance();
                transcript.push(normalize(step, isIdsOnly(bundle)));
                if (step.type == StepType::End) break;
                if (step.type == StepType::Choice)
                {
                    std::string pick;
                    if (!scripted.empty()) { pick = scripted.front(); scripted.pop(); }
                    else for (auto& o : step.options) if (o.eligible) { pick = o.id; break; }
                    if (pick.empty()) break;
                    flow->choose(pick);
                }
            }
            if (matchValue(transcript, c.at("expectedTranscript"))) ++pass;
            else fail("runtime", name, "transcript mismatch\n    expected " + dump(c.at("expectedTranscript")) + "\n    got      " + dump(transcript));
        }
        catch (const std::exception& ex) { fail("runtime", name, ex.what()); }
    }
    return pass;
}

// The corpus's decision-log cases. Each is played as a runtime case is, with the log on, and the live
// tap is held to it: onTrace must hand over exactly the decisions the log keeps, in order, with the log
// on and with it off, and none once unsubscribed.
// An entry as the reference writes it: its type's fields under the JS names, an absent field absent, and
// a select's picked present even when nothing was (null).
static JsonValue logEntryToJson(const LogEntry& e, bool withSeq = true)
{
    JsonValue o = JsonValue::Obj();
    o.set("type", JsonValue::Str(e.type));
    if (!e.flow.empty()) o.set("flow", JsonValue::Str(e.flow));
    if (withSeq) o.set("seq", JsonValue::Num(e.seq));
    if (!e.scene.empty()) o.set("scene", JsonValue::Str(e.scene));
    const auto verdicts = [](const std::vector<std::pair<std::string, bool>>& list)
    {
        JsonValue a = JsonValue::Arr();
        for (const auto& c : list) { JsonValue v = JsonValue::Obj(); v.set("id", JsonValue::Str(c.first)); v.set("eligible", JsonValue::Boolean(c.second)); a.push(v); }
        return a;
    };
    if (e.type == "select")
    {
        o.set("group", JsonValue::Str(e.group)); o.set("selector", JsonValue::Str(e.selector));
        if (!e.order.empty()) o.set("order", JsonValue::Str(e.order));
        if (!e.exhaust.empty()) o.set("exhaust", JsonValue::Str(e.exhaust));
        o.set("children", verdicts(e.children));
        o.set("picked", e.picked.empty() ? JsonValue() : JsonValue::Str(e.picked));
    }
    else if (e.type == "choice") { o.set("group", JsonValue::Str(e.group)); o.set("options", verdicts(e.options)); }
    else if (e.type == "chose") { o.set("group", JsonValue::Str(e.group)); o.set("option", JsonValue::Str(e.option)); }
    else if (e.type == "dry") o.set("group", JsonValue::Str(e.group));
    else if (e.type == "jump") { o.set("to", JsonValue::Str(e.to)); o.set("mode", JsonValue::Str(e.mode)); }
    else if (e.type == "write")
    {
        o.set("target", JsonValue::Str(e.target)); o.set("value", valueToJson(e.value));
        if (e.hasPrev) o.set("prev", valueToJson(e.prev));
    }
    else if (e.type == "diagnostic")
    {
        o.set("kind", JsonValue::Str(e.kind)); o.set("node", JsonValue::Str(e.node));
        if (!e.source.empty()) o.set("source", JsonValue::Str(e.source));
        o.set("message", JsonValue::Str(e.message));
    }
    return o;
}

static std::string traceKey(const LogEntry& e) { return dump(logEntryToJson(e, false)); }

struct LogRun { std::vector<std::string> logged, traced; JsonValue shaped = JsonValue::Arr(); size_t afterStop = 0; };

static LogRun playLogCase(const JsonValue& c, bool log)
{
    Bundle bundle = parseBundle(c.at("bundle"));
    EngineOptions opts;
    opts.log = log;
    std::shared_ptr<Mulberry32> rng;
    if (const JsonValue* seed = c.find("seed")) { rng = std::make_shared<Mulberry32>(seed->num); opts.rng = [rng]() { return rng->next(); }; }
    Engine engine(bundle, opts);
    LogRun run;
    auto stop = engine.onTrace([&run](const std::string& flow, const LogEntry& e)
        { run.traced.push_back(flow == e.flow ? traceKey(e) : "handed over as " + flow + ", entry says " + e.flow); });
    const JsonValue& start = c.at("start");
    std::string startBlock;
    if (const JsonValue* bl = start.find("block")) startBlock = bl->str;
    Flow* flow = engine.openFlow("main", start.at("scene").str, startBlock);
    std::queue<std::string> scripted;
    if (const JsonValue* ch = c.find("choices")) for (const auto& x : ch->arr) scripted.push(x.str);
    for (int i = 0; i < 200; ++i)
    {
        StepResult step = flow->advance();
        if (step.type == StepType::End) break;
        if (step.type == StepType::Choice)
        {
            std::string pick;
            if (!scripted.empty()) { pick = scripted.front(); scripted.pop(); }
            else for (auto& o : step.options) if (o.eligible) { pick = o.id; break; }
            if (pick.empty()) break;
            flow->choose(pick);
        }
    }
    stop();
    const size_t before = run.traced.size();
    engine.openFlow("later", start.at("scene").str, "")->advance();
    run.afterStop = run.traced.size() - before;
    for (const LogEntry& e : engine.log())
        if (e.flow == "main") { run.logged.push_back(traceKey(e)); run.shaped.push(logEntryToJson(e)); }
    return run;
}

static int runLogs(const JsonValue& arr)
{
    int pass = 0;
    for (const auto& c : arr.arr)
    {
        std::string name = c.at("name").str;
        try
        {
            LogRun on = playLogCase(c, true), off = playLogCase(c, false);
            if (!matchValue(on.shaped, c.at("expectedLog")))
                fail("logs", name, "log mismatch\n    expected " + dump(c.at("expectedLog")) + "\n    got      " + dump(on.shaped));
            else if (on.traced != on.logged)
                fail("logs", name, "onTrace with the log on handed over " + std::to_string(on.traced.size()) + " decisions, the log kept " + std::to_string(on.logged.size()) + ", or they differ");
            else if (off.traced != on.logged)
                fail("logs", name, "onTrace with the log off handed over " + std::to_string(off.traced.size()) + " decisions, the log kept " + std::to_string(on.logged.size()) + ", or they differ");
            else if (on.afterStop != 0) fail("logs", name, "a handler was called after its unsubscribe");
            else ++pass;
        }
        catch (const std::exception& ex) { fail("logs", name, ex.what()); }
    }
    return pass;
}

// The corpus's describe cases: what describeBundle says about a bundle, held field for field to the
// reference's description. An empty optional string or list is the core's absent, and is left out.
static JsonValue describeToJson(const BundleDescription& d)
{
    const auto str = [](const std::string& v) { return JsonValue::Str(v); };
    const auto strs = [](const std::vector<std::string>& v) { JsonValue a = JsonValue::Arr(); for (const auto& x : v) a.push(JsonValue::Str(x)); return a; };
    const auto prop = [&](const PropertySummary& p)
    {
        JsonValue o = JsonValue::Obj();
        o.set("name", str(p.name)); o.set("type", str(p.type)); o.set("hasDefault", JsonValue::Boolean(p.hasDefault));
        if (p.hasDefault) o.set("default", valueToJson(p.def));
        o.set("shared", JsonValue::Boolean(p.shared));
        return o;
    };
    const auto props = [&](const std::vector<PropertySummary>& v) { JsonValue a = JsonValue::Arr(); for (const auto& p : v) a.push(prop(p)); return a; };
    JsonValue id = JsonValue::Obj();
    id.set("schema", str(d.identity.schema)); id.set("project", str(d.identity.project));
    if (!d.identity.version.empty()) id.set("version", str(d.identity.version));
    if (!d.identity.hash.empty()) id.set("hash", str(d.identity.hash));
    if (!d.identity.structureHash.empty()) id.set("structureHash", str(d.identity.structureHash));
    id.set("voiced", JsonValue::Boolean(d.identity.voiced)); id.set("defaultLocale", str(d.identity.defaultLocale));
    id.set("locales", strs(d.identity.locales)); id.set("localisation", str(d.identity.localisation));
    id.set("sourceDebug", JsonValue::Boolean(d.identity.sourceDebug));
    JsonValue addresses = JsonValue::Arr();
    for (const auto& a : d.addresses)
    {
        JsonValue o = JsonValue::Obj(); o.set("gameId", str(a.gameId)); o.set("name", str(a.name));
        JsonValue blocks = JsonValue::Arr();
        for (const auto& b : a.blocks) { JsonValue bo = JsonValue::Obj(); bo.set("gameId", str(b.gameId)); bo.set("name", str(b.name)); blocks.push(bo); }
        o.set("blocks", blocks); addresses.push(o);
    }
    JsonValue hostScopes = JsonValue::Arr();
    for (const auto& h : d.hostScopes)
    {
        JsonValue o = JsonValue::Obj(); o.set("token", str(h.token)); o.set("writable", JsonValue::Boolean(h.writable));
        o.set("opaque", JsonValue::Boolean(h.opaque)); o.set("properties", props(h.properties)); hostScopes.push(o);
    }
    JsonValue scene = JsonValue::Arr();
    for (const auto& sp : d.properties.scene) { JsonValue o = JsonValue::Obj(); o.set("gameId", str(sp.gameId)); o.set("properties", props(sp.properties)); scene.push(o); }
    JsonValue owned = JsonValue::Obj(); owned.set("patter", props(d.properties.patter)); owned.set("scene", scene);
    JsonValue gameData = JsonValue::Arr();
    for (const auto& g : d.gameData)
    {
        JsonValue fields = JsonValue::Arr();
        for (const auto& f : g.fields)
        {
            JsonValue o = JsonValue::Obj(); o.set("name", str(f.name)); o.set("type", str(f.type)); o.set("hasDefault", JsonValue::Boolean(f.hasDefault));
            if (!f.values.empty()) o.set("values", strs(f.values));
            if (!f.purpose.empty()) o.set("purpose", str(f.purpose));
            fields.push(o);
        }
        JsonValue o = JsonValue::Obj(); o.set("kind", str(g.kind)); o.set("fields", fields); gameData.push(o);
    }
    JsonValue counts = JsonValue::Obj();
    counts.set("scenes", JsonValue::Num(d.counts.scenes)); counts.set("blocks", JsonValue::Num(d.counts.blocks));
    counts.set("groups", JsonValue::Num(d.counts.groups)); counts.set("snippets", JsonValue::Num(d.counts.snippets));
    counts.set("beats", JsonValue::Num(d.counts.beats)); counts.set("prompts", JsonValue::Num(d.counts.prompts));
    counts.set("gameEvents", JsonValue::Num(d.counts.gameEvents)); counts.set("cast", JsonValue::Num(d.counts.cast));
    JsonValue o = JsonValue::Obj();
    o.set("identity", id); o.set("addresses", addresses); o.set("hostScopes", hostScopes);
    o.set("properties", owned); o.set("gameData", gameData); o.set("counts", counts);
    return o;
}

static int runDescribes(const JsonValue& arr)
{
    int pass = 0;
    for (const auto& c : arr.arr)
    {
        std::string name = c.at("name").str;
        try
        {
            JsonValue got = describeToJson(describeBundle(parseBundle(c.at("bundle"))));
            if (matchValue(got, c.at("expected"))) ++pass;
            else fail("describes", name, "description mismatch\n    expected " + dump(c.at("expected")) + "\n    got      " + dump(got));
        }
        catch (const std::exception& ex) { fail("describes", name, ex.what()); }
    }
    return pass;
}

// The corpus's outline cases: getOutline() and getBeatSequence() held field for field to the reference's.
// An empty string, list, or gameData is the core's absent, and is left out where the reference omits it;
// a group's selector and children and a snippet's beats are always there, as the reference writes them.
static JsonValue strsToJson(const std::vector<std::string>& v)
{
    JsonValue a = JsonValue::Arr();
    for (const auto& x : v) a.push(JsonValue::Str(x));
    return a;
}

static JsonValue rawGameDataToJson(const std::vector<std::pair<std::string, PatterValue>>& gd)
{
    JsonValue o = JsonValue::Obj();
    for (const auto& kv : gd) o.set(kv.first, valueToJson(kv.second));
    return o;
}

static JsonValue beatInfoToJson(const BeatInfo& b)
{
    JsonValue o = JsonValue::Obj();
    o.set("id", JsonValue::Str(b.id)); o.set("kind", JsonValue::Str(b.kind));
    if (!b.character.empty()) o.set("character", JsonValue::Str(b.character));
    if (!b.characterName.empty()) o.set("characterName", JsonValue::Str(b.characterName));
    if (!b.direction.empty()) o.set("direction", JsonValue::Str(b.direction));
    if (!b.qualifier.empty()) o.set("qualifier", JsonValue::Str(b.qualifier));
    if (!b.qualifierName.empty()) o.set("qualifierName", JsonValue::Str(b.qualifierName));
    if (!b.speakerLabel.empty()) o.set("speakerLabel", JsonValue::Str(b.speakerLabel));
    // Line padding: a line or text beat always has its resolved pause, defaults included; its own only when set.
    if (b.kind == "line" || b.kind == "text") o.set("padAfter", JsonValue::Num(b.padAfter));
    if (b.hasOwnPadAfter) o.set("ownPadAfter", JsonValue::Num(b.ownPadAfter));
    if (!b.text.empty()) o.set("text", JsonValue::Str(b.text));
    if (!b.gameData.empty()) o.set("gameData", rawGameDataToJson(b.gameData));
    if (!b.extensions.empty()) o.set("extensions", extensionsToJson(b.extensions));
    if (!b.tags.empty()) o.set("tags", strsToJson(b.tags));
    return o;
}

static JsonValue outlineNodeToJson(const OutlineNode& n)
{
    JsonValue o = JsonValue::Obj();
    o.set("type", JsonValue::Str(n.type)); o.set("id", JsonValue::Str(n.id));
    if (!n.tags.empty()) o.set("tags", strsToJson(n.tags));
    if (n.type == "group")
    {
        if (!n.selector.empty()) o.set("selector", JsonValue::Str(n.selector));
        if (n.hasPrompt) o.set("prompt", beatInfoToJson(n.prompt));
        JsonValue children = JsonValue::Arr();
        for (const auto& c : n.children) children.push(outlineNodeToJson(c));
        o.set("children", children);
    }
    else
    {
        JsonValue beats = JsonValue::Arr();
        for (const auto& b : n.beats) beats.push(beatInfoToJson(b));
        o.set("beats", beats);
        if (!n.jumpTo.empty())
        {
            o.set("jumpTo", JsonValue::Str(n.jumpTo));
            if (!n.jumpMode.empty()) o.set("jumpMode", JsonValue::Str(n.jumpMode));
        }
    }
    return o;
}

static JsonValue outlineToJson(const std::vector<OutlineScene>& scenes)
{
    JsonValue out = JsonValue::Arr();
    for (const auto& s : scenes)
    {
        JsonValue so = JsonValue::Obj();
        so.set("id", JsonValue::Str(s.id));
        if (!s.gameId.empty()) so.set("gameId", JsonValue::Str(s.gameId));
        so.set("name", JsonValue::Str(s.name));
        if (!s.gameData.empty()) so.set("gameData", rawGameDataToJson(s.gameData));
        if (!s.extensions.empty()) so.set("extensions", extensionsToJson(s.extensions));
        if (!s.tags.empty()) so.set("tags", strsToJson(s.tags));
        JsonValue blocks = JsonValue::Arr();
        for (const auto& b : s.blocks)
        {
            JsonValue bo = JsonValue::Obj();
            bo.set("id", JsonValue::Str(b.id));
            if (!b.gameId.empty()) bo.set("gameId", JsonValue::Str(b.gameId));
            bo.set("name", JsonValue::Str(b.name));
            if (!b.gameData.empty()) bo.set("gameData", rawGameDataToJson(b.gameData));
            if (!b.extensions.empty()) bo.set("extensions", extensionsToJson(b.extensions));
            if (!b.tags.empty()) bo.set("tags", strsToJson(b.tags));
            JsonValue children = JsonValue::Arr();
            for (const auto& c : b.children) children.push(outlineNodeToJson(c));
            bo.set("children", children);
            blocks.push(bo);
        }
        so.set("blocks", blocks);
        out.push(so);
    }
    return out;
}

static JsonValue beatSequenceToJson(const std::vector<FlatBeat>& seq)
{
    JsonValue out = JsonValue::Arr();
    for (const auto& f : seq)
    {
        JsonValue o = JsonValue::Obj();
        o.set("sceneId", JsonValue::Str(f.sceneId)); o.set("blockId", JsonValue::Str(f.blockId));
        o.set("snippetId", JsonValue::Str(f.snippetId)); o.set("beat", beatInfoToJson(f.beat));
        out.push(o);
    }
    return out;
}

static int runOutlines(const JsonValue& arr)
{
    int pass = 0;
    for (const auto& c : arr.arr)
    {
        std::string name = c.at("name").str;
        try
        {
            Bundle bundle = parseBundle(c.at("bundle"));
            Engine engine(bundle, EngineOptions{});
            JsonValue outline = outlineToJson(engine.getOutline());
            JsonValue sequence = beatSequenceToJson(engine.getBeatSequence());
            if (!matchValue(outline, c.at("expectedOutline")))
                fail("outlines", name, "outline mismatch\n    expected " + dump(c.at("expectedOutline")) + "\n    got      " + dump(outline));
            else if (!matchValue(sequence, c.at("expectedBeatSequence")))
                fail("outlines", name, "beat sequence mismatch\n    expected " + dump(c.at("expectedBeatSequence")) + "\n    got      " + dump(sequence));
            else ++pass;
        }
        catch (const std::exception& ex) { fail("outlines", name, ex.what()); }
    }
    return pass;
}

// The corpus's audio cases: a manifest read through the core's readAudioManifest (the reader the plugin
// uses too), and each lookup's resolved path under its base, or null for no take.
static int runAudio(const JsonValue& arr)
{
    int pass = 0;
    for (const auto& c : arr.arr)
    {
        std::string name = c.at("name").str;
        try
        {
            const AudioManifest manifest = readAudioManifest(JsonParser(c.at("manifest").str).parse());
            bool ok = true;
            for (const auto& l : c.at("lookups").arr)
            {
                const std::optional<std::string> got = AudioResolver(manifest, l.at("base").str).resolve(l.at("beatId").str);
                const JsonValue& want = l.at("expected");
                const bool match = want.isNull() ? !got.has_value() : (got.has_value() && *got == want.str);
                if (!match)
                {
                    fail("audio", name, "base \"" + l.at("base").str + "\", beat " + l.at("beatId").str + ": expected "
                        + dump(want) + ", got " + (got ? "\"" + *got + "\"" : std::string("null")));
                    ok = false;
                }
            }
            if (ok) ++pass;
        }
        catch (const std::exception& ex) { fail("audio", name, ex.what()); }
    }
    return pass;
}

// The corpus's duration cases: each text (UTF-8, as the corpus holds it) through the core's estimateLineDuration,
// held to the reference's seconds.
static int runDurations(const JsonValue& arr)
{
    int pass = 0;
    for (const auto& c : arr.arr)
    {
        std::string name = c.at("name").str;
        try
        {
            const JsonValue* locale = c.find("locale");
            const double got = locale ? estimateLineDuration(c.at("text").str, locale->str) : estimateLineDuration(c.at("text").str);
            const double want = c.at("expected").num;
            if (std::fabs(got - want) <= 1e-9) ++pass;
            else fail("durations", name, "expected " + std::to_string(want) + ", got " + std::to_string(got));
        }
        catch (const std::exception& ex) { fail("durations", name, ex.what()); }
    }
    return pass;
}

// A property row as the reference's listProperties() serialises it: values and stages only where the
// declaration has them.
static JsonValue propertiesToJson(const std::vector<PropertyRow>& rows)
{
    JsonValue out = JsonValue::Arr();
    for (const auto& r : rows)
    {
        JsonValue o = JsonValue::Obj();
        o.set("name", JsonValue::Str(r.name)); o.set("path", JsonValue::Str(r.path)); o.set("type", JsonValue::Str(r.type));
        if (r.values) o.set("values", strsToJson(*r.values));
        if (r.stages) o.set("stages", strsToJson(*r.stages));
        o.set("value", valueToJson(r.value)); o.set("default", valueToJson(r.defaultValue));
        o.set("writable", JsonValue::Boolean(r.writable));
        out.push(o);
    }
    return out;
}

static int envelopeRoundTrips = 0;
static int gameDataReads = 0;   // expectGameData ops that ran and matched
static int extensionReads = 0;  // expectExtensions and expectNodeExtensions ops that ran and matched
static int propertyReads = 0;   // expectProperties ops that ran and matched

// Run a script's ops against a LIVE engine, returning whether every op matched and the engine that
// ends up live (saveLoad / hotSwap replace it). Shared by the scripted cases and the saves cases, whose
// engine arrives already loaded from an envelope another runtime wrote.
// `bundleB` is the case's EDITED bundle, null when it has none.
static std::pair<bool, std::shared_ptr<Engine>> runScript(std::shared_ptr<Engine> engine, const Bundle& bundle, const Bundle* bundleB,
    const EngineOptions& opts, const JsonValue& script, const std::string& name, std::string current)
{
    bool ok = true;
    patter::Checkpoint checkpoint;
    // A call the runtime must refuse (expectRefused): it throws, and the engine is as it was, still
    // inside its checkpoint. The ops after it prove nothing else moved.
    const auto refused = [&engine](const std::string& what, const std::function<void()>& call)
    {
        const bool wasIn = engine->inCheckpoint();
        try { call(); }
        catch (const std::exception&)
        {
            if (engine->inCheckpoint() != wasIn) throw std::runtime_error(what + ": a refusal changed the checkpoint");
            return;
        }
        throw std::runtime_error(what + ": expected the runtime to refuse it");
    };
    const auto refusing = [](const JsonValue& op) { const JsonValue* r = op.find("expectRefused"); return r && r->isBool() && r->b; };
    std::map<std::string, patter::FlowState> captured; // captureFlow states, by name, for restoreFlow
    // What the last advance or stepFor handed the host, for `scribble`: its own copy, which it may deface.
    std::optional<StepResult> handed;
            for (const auto& op : script.arr)
            {
                JsonValue chunk = JsonValue::Arr();
                std::string kind = op.at("op").str;
                if (kind == "openFlow")
                {
                    // A refused open (expectResult false) must leave everything as it was: the name still
                    // means the same flow (or none), that flow is not closed, and the current flow does not move.
                    const std::string flowId = op.at("flow").str;
                    std::string sc = op.has("scene") ? op.at("scene").str : "";
                    std::string bl = op.has("block") ? op.at("block").str : "";
                    const std::string where = sc + (bl.empty() ? "" : "/" + bl);
                    const bool hasWant = op.has("expectResult");
                    const bool want = hasWant && op.at("expectResult").b;
                    int64_t seed = 0; const int64_t* seedP = nullptr;
                    if (const JsonValue* s = op.find("seed")) { seed = static_cast<int64_t>(s->num); seedP = &seed; }
                    Flow* before = engine->getFlow(flowId);
                    bool opened = true;
                    try { engine->openFlow(flowId, sc, bl, seedP); }
                    catch (const std::exception&) { if (!hasWant || want) throw; opened = false; }
                    if (hasWant && opened != want)
                        throw std::runtime_error("openFlow " + flowId + " at " + where + ": expected " + (want ? "true" : "false") + ", got " + (opened ? "true" : "false"));
                    if (opened) current = flowId;
                    else
                    {
                        if (engine->getFlow(flowId) != before)
                            throw std::runtime_error("openFlow " + flowId + " at " + where + ": a refused open changed what the name means");
                        if (before && before->isClosed())
                            throw std::runtime_error("openFlow " + flowId + " at " + where + ": a refused open closed the flow already open");
                    }
                }
                else if (kind == "useFlow") current = op.at("flow").str;
                else if (kind == "advance")
                {
                    handed = engine->getFlow(current)->advance();
                    chunk.push(normalize(*handed, isIdsOnly(bundle)));
                }
                // The step a flow would deliver for a beat now, recorded as a delivered one is; none for an unknown id.
                else if (kind == "stepFor")
                {
                    const std::string flowId = op.has("flow") ? op.at("flow").str : current;
                    handed = engine->getFlow(flowId)->stepFor(op.at("beat").str);
                    if (handed) chunk.push(normalize(*handed, isIdsOnly(bundle)));
                }
                // A careless host (corpus 8) defaces what it was handed, in place: every flags list gains
                // "scribbled", then every value becomes "scribbled" and the map gains the key too. It is the host's
                // own copy, so nothing the engine hands out next changes. Extension values are left alone.
                else if (kind == "scribble")
                {
                    const auto deface = [](const std::shared_ptr<GameData>& gameData)
                    {
                        if (!gameData) return;
                        for (auto& kv : *gameData) if (kv.second.isFlags()) kv.second.f.push_back("scribbled");
                        for (auto& kv : *gameData) kv.second = PatterValue::Str("scribbled");
                        (*gameData)["scribbled"] = PatterValue::Str("scribbled");
                    };
                    if (handed && handed->type == StepType::Choice) for (auto& o : handed->options) deface(o.gameData);
                    else if (handed && handed->type != StepType::End) deface(handed->gameData);
                }
                else if (kind == "choose") engine->getFlow(current)->choose(op.at("id").str);
                // Host navigation by address. No transcript of its own; the next advance shows where it
                // landed. expectResult pins the returned bool.
                else if (kind == "resetFlow")
                    engine->getFlow(current)->reset(op.has("scene") ? op.at("scene").str : std::string(),
                                                    op.has("block") ? op.at("block").str : std::string());
                else if (kind == "goto")
                {
                    const bool moved = engine->getFlow(current)->gotoAddress(
                        op.at("scene").str, op.has("block") ? op.at("block").str : std::string());
                    if (op.has("expectResult") && moved != op.at("expectResult").b)
                        throw std::runtime_error("goto " + op.at("scene").str + ": unexpected result");
                }
                // A flow taken out as data and put back: the state goes through JSON (Patter/Save.h) to
                // prove it is plain data, and a restored flow becomes the current one.
                else if (kind == "captureFlow")
                    captured[op.at("into").str] = deserializeFlowState(serializeFlowState(engine->captureFlow(op.at("flow").str)));
                else if (kind == "closeFlow") engine->closeFlow(op.at("flow").str);
                else if (kind == "restoreFlow")
                {
                    auto state = captured.find(op.at("from").str);
                    if (state == captured.end()) throw std::runtime_error("restoreFlow: nothing captured under '" + op.at("from").str + "'");
                    const std::string flowId = op.at("flow").str;
                    if (refusing(op)) refused("restoreFlow", [&] { engine->restoreFlow(flowId, state->second); });
                    else { engine->restoreFlow(flowId, state->second); current = flowId; }
                }
                else if (kind == "saveLoad")
                {
                    // Round-trip through the patter/save@0 envelope (Patter/Save.h), asserting the
                    // flattened state survives byte-for-byte - which exercises the StateLogger's
                    // snapshot/diff at the same time (parity brief B1/B2).
                    auto before = snapshotState(*engine);
                    std::string json = serializeState(*engine);
                    engine = std::make_shared<Engine>(bundle, opts);
                    deserializeState(*engine, json);
                    // A load mounts @scene bags only for the scenes a flow stands in; the rest wait in the
                    // registry, parked, and the snapshot sees mounted bags only. So an @scene value that is
                    // there before and gone after is parked, not lost: the script's own steps prove it comes
                    // back when the flow re-enters that scene. Anything else that differs is a real change.
                    for (const auto& c : diffState(before, snapshotState(*engine)))
                    {
                        const bool parked = !c.to.has_value() && c.path.find("@scene:") != std::string::npos;
                        if (!parked) throw std::runtime_error("envelope round-trip changed flattened state at " + c.path);
                    }
                    ++envelopeRoundTrips;
                }
                // Live bundle refresh (spec 9.8): the whole game carried onto the EDITED bundle.
                // Through the core's own hotSwap, as the reference runner does: the bags are handed to the
                // replacement on the same registry.
                else if (kind == "hotSwap")
                {
                    if (refusing(op)) refused("hotSwap", [&] { engine->hotSwap(bundleB ? *bundleB : bundle); });
                    else if (!bundleB) throw std::runtime_error("hotSwap: the case has no bundleB");
                    else engine = std::shared_ptr<Engine>(engine->hotSwap(*bundleB));
                }
                else if (kind == "setLocale") engine->setLocale(op.at("locale").str);
                else if (kind == "setClosedCaptions") engine->setClosedCaptions(op.at("on").b);
                else if (kind == "reset")
                {
                    if (refusing(op)) refused("reset", [&] { engine->reset(); });
                    else { engine->reset(); current.clear(); }
                }
                // Checkpoints: none produces a transcript; the advances after them show the state they left.
                else if (kind == "checkpoint")
                {
                    if (refusing(op)) refused("checkpoint", [&] { engine->checkpoint(); });
                    else checkpoint = engine->checkpoint();
                }
                else if (kind == "rollback") { engine->rollback(checkpoint); checkpoint = patter::Checkpoint(); }
                else if (kind == "commit") { engine->commit(checkpoint); checkpoint = patter::Checkpoint(); }
                // Static structure query: no transcript, expectResult pins the exact list INCLUDING
                // order. No scene = the declared project cast.
                else if (kind == "expectCast")
                {
                    std::vector<std::string> got = !op.has("scene") ? engine->getCast()
                        : !op.has("block") ? engine->castForScene(op.at("scene").str)
                        : engine->castForBlock(op.at("scene").str, op.at("block").str);
                    std::vector<std::string> want;
                    for (const auto& w : op.at("expectResult").arr) want.push_back(w.str);
                    if (got != want)
                    {
                        std::string g, e;
                        for (const auto& n : got) { if (!g.empty()) g += ", "; g += n; }
                        for (const auto& n : want) { if (!e.empty()) e += ", "; e += n; }
                        throw std::runtime_error("expectCast: expected [" + e + "], got [" + g + "]");
                    }
                }
                // Static scene / block gameData read: no transcript, expectResult pins the RAW overrides
                // exactly (same key set, equal values; key order is not significant). Scene alone =
                // gameDataForScene, scene + block = gameDataForBlock.
                else if (kind == "expectGameData")
                {
                    const std::string scene = op.at("scene").str;
                    const bool forBlock = op.has("block");
                    GameData got = forBlock ? engine->gameDataForBlock(scene, op.at("block").str)
                                            : engine->gameDataForScene(scene);
                    JsonValue produced = gameDataToJson(got);
                    const JsonValue& want = op.at("expectResult");
                    if (!matchValue(produced, want))
                    {
                        const std::string scope = forBlock ? scene + "/" + op.at("block").str : scene;
                        throw std::runtime_error("expectGameData " + scope + ": expected " + dump(want) + ", got " + dump(produced));
                    }
                    ++gameDataReads;
                }
                // Static scene / block Patter extension values (corpus 3), or a snippet's (corpus 6, `snippet` and
                // no `scene`): the node's own, raw, by extension id. Compared deeply; key order is not significant
                // (matchValue finds each key).
                else if (kind == "expectExtensions")
                {
                    const bool forSnippet = op.has("snippet");
                    const std::string scene = forSnippet ? std::string() : op.at("scene").str;
                    const bool forBlock = !forSnippet && op.has("block");
                    const JsonValue produced = extensionsToJson(forSnippet ? engine->extensionsForSnippet(op.at("snippet").str)
                                                              : forBlock ? engine->extensionsForBlock(scene, op.at("block").str)
                                                                         : engine->extensionsForScene(scene));
                    const JsonValue& want = op.at("expectResult");
                    if (!matchValue(produced, want))
                    {
                        const std::string scope = forSnippet ? "snippet " + op.at("snippet").str
                                                : forBlock ? scene + "/" + op.at("block").str : scene;
                        throw std::runtime_error("expectExtensions " + scope + ": expected " + dump(want) + ", got " + dump(produced));
                    }
                    ++extensionReads;
                }
                // Any node's extension values, read off the case's BUNDLE by the core helper extensionsOf; with
                // `effective`, one extension's values filled in: effectiveGameData(extensionDecls(...), raw[ext]).
                else if (kind == "expectNodeExtensions")
                {
                    const std::string nodeKind = op.at("kind").str;
                    const std::string address = op.has("address") ? op.at("address").str : std::string();
                    const NodeExtensions raw = extensionsOf(bundle, nodeKind, address);
                    const JsonValue* effective = op.find("effective");
                    JsonValue produced;
                    std::string scope = nodeKind + (op.has("address") ? " " + address : std::string());
                    if (effective)
                    {
                        const std::string ext = effective->at("extension").str;
                        produced = extensionValuesToJson(effectiveGameData(extensionDecls(bundle, ext, nodeKind), raw.get(ext)));
                        scope += " (effective " + ext + ")";
                    }
                    else produced = extensionsToJson(raw);
                    const JsonValue& want = op.at("expectResult");
                    if (!matchValue(produced, want))
                        throw std::runtime_error("expectNodeExtensions " + scope + ": expected " + dump(want) + ", got " + dump(produced));
                    ++extensionReads;
                }
                // The state inspector's rows, as JSON: each shared @patter property in declaration order.
                else if (kind == "expectProperties")
                {
                    JsonValue got = propertiesToJson(engine->listProperties());
                    if (!matchValue(got, op.at("expectResult")))
                        throw std::runtime_error("expectProperties: expected " + dump(op.at("expectResult")) + ", got " + dump(got));
                    ++propertyReads;
                }
                else if (kind == "stage")
                {
                    // A quality's ladder by its ref, on the engine or (onFlow) the current flow.
                    const JsonValue* onFlowV = op.find("onFlow");
                    const bool onFlow = onFlowV && onFlowV->b;
                    const std::string call = op.at("call").str, ref = op.at("ref").str;
                    std::vector<PatterValue> args;
                    for (const auto& a : op.at("args").arr) args.push_back(toValue(a));
                    auto run = [&]() -> std::string
                    {
                        Flow* f = onFlow ? engine->getFlow(current) : nullptr;
                        if (call == "index") return std::to_string(onFlow ? f->stageIndex(ref, args.at(0)) : engine->stageIndex(ref, args.at(0)));
                        if (call == "compare") return std::to_string(onFlow ? f->compareStages(ref, args.at(0), args.at(1)) : engine->compareStages(ref, args.at(0), args.at(1)));
                        if (call == "next") return "\"" + (onFlow ? f->nextStage(ref, args.at(0)) : engine->nextStage(ref, args.at(0))) + "\"";
                        throw std::runtime_error("unknown stage call '" + call + "'");
                    };
                    const JsonValue* refusedV = op.find("expectRefused");
                    if (refusedV && refusedV->b) refused("stage " + call + " " + ref, [&] { run(); });
                    else
                    {
                        const JsonValue& e = op.at("expectResult");
                        const std::string want = e.isString() ? "\"" + e.str + "\"" : std::to_string(static_cast<int>(e.num));
                        const std::string got = run();
                        if (got != want) throw std::runtime_error("stage " + call + " " + ref + ": expected " + want + ", got " + got);
                    }
                }
                else if (kind == "setProperty")
                {
                    // The game's write, with host authority (a game moving @world).
                    const std::string ref = op.at("ref").str;
                    const PatterValue value = toValue(op.at("value"));
                    const JsonValue* refusedV = op.find("expectRefused");
                    if (refusedV && refusedV->b) refused("setProperty " + ref, [&] { engine->setProperty(ref, value); });
                    else engine->setProperty(ref, value);
                }
                // What the engines reported to onError since the case began (the first engine's construction
                // included) or the last expectErrors, in order: kind and node, and flow when the expectation gives
                // it. Never the message, which is each runtime's own wording. Taking them empties the record.
                else if (kind == "expectErrors")
                {
                    const JsonValue& want = op.at("expectResult");
                    bool same = want.arr.size() == caseErrors.size();
                    for (size_t i = 0; same && i < want.arr.size(); ++i)
                    {
                        const JsonValue& w = want.arr[i];
                        const PlayError& e = caseErrors[i];
                        same = e.kind == w.at("kind").str && e.node == w.at("node").str && (!w.has("flow") || e.flow == w.at("flow").str);
                    }
                    if (!same)
                    {
                        JsonValue got = JsonValue::Arr();
                        for (const PlayError& e : caseErrors)
                        {
                            JsonValue o = JsonValue::Obj();
                            o.set("kind", JsonValue::Str(e.kind)); o.set("node", JsonValue::Str(e.node)); o.set("flow", JsonValue::Str(e.flow));
                            got.push(o);
                        }
                        throw std::runtime_error("expectErrors: expected " + dump(want) + ", got " + dump(got));
                    }
                    caseErrors.clear();
                }
                // The locale in use (engine.locale) and the bundle's locales (engine.locales).
                else if (kind == "expectLocale")
                {
                    const Locales locales = engine->locales();
                    JsonValue got = JsonValue::Obj();
                    got.set("locale", JsonValue::Str(engine->locale()));
                    got.set("default", JsonValue::Str(locales.defaultLocale));
                    JsonValue included = JsonValue::Arr();
                    for (const auto& l : locales.included) included.push(JsonValue::Str(l));
                    got.set("included", included);
                    if (!matchValue(got, op.at("expectResult")))
                        throw std::runtime_error("expectLocale: expected " + dump(op.at("expectResult")) + ", got " + dump(got));
                }
                else if (kind == "expectRefits")
                {
                    // What the case's loads put back, in order, as { scope, name, value }.
                    JsonValue got = JsonValue::Arr();
                    for (const LoadMisfit& m : caseRefits)
                    {
                        JsonValue o = JsonValue::Obj();
                        o.set("scope", JsonValue::Str(m.scope)); o.set("name", JsonValue::Str(m.name)); o.set("value", valueToJson(m.value));
                        got.push(o);
                    }
                    if (!matchValue(got, op.at("expectResult")))
                        throw std::runtime_error("expectRefits: expected " + dump(op.at("expectResult")) + ", got " + dump(got));
                    caseRefits.clear();
                }
                // An op this host cannot run is a check that cannot fail: refuse it, never skip it.
                else throw std::runtime_error("unknown script op '" + kind + "'");

                const JsonValue* expect = op.find("expect");
                bool match = expect ? matchValue(chunk, *expect) : (chunk.arr.empty());
                if (!match) { ok = false; fail("scripted", name, "op " + kind + ": mismatch (got " + dump(chunk) + ")"); break; }
            }
    return { ok, engine };
}

// jsonQuote, writing each character outside the Basic Multilingual Plane back as the escaped surrogate
// pair the corpus gave it as, so the save boundary's own reader (Save.h) has to join the pair too.
static std::string jsonQuoteAstralEscaped(const std::string& s)
{
    const std::string q = patter::loggerdetail::jsonQuote(s);
    std::string out;
    for (size_t i = 0; i < q.size(); ++i)
    {
        const unsigned char c = static_cast<unsigned char>(q[i]);
        if ((c & 0xF8) == 0xF0 && i + 3 < q.size())
        {
            auto cont = [&](size_t k) { return static_cast<unsigned>(static_cast<unsigned char>(q[i + k]) & 0x3F); };
            const unsigned cp = (((c & 0x07u) << 18) | (cont(1) << 12) | (cont(2) << 6) | cont(3)) - 0x10000;
            char buf[16];
            std::snprintf(buf, sizeof buf, "\\u%04x\\u%04x", 0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
            out += buf;
            i += 3;
        }
        else out += q[i];
    }
    return out;
}

// JSON text of a parsed value, for handing the corpus's envelope to the save boundary as a STRING -
// which is how a game hands it over, and the only entry the boundary has.
static std::string jsonText(const JsonValue& v)
{
    const auto jsonQuote = jsonQuoteAstralEscaped;
    switch (v.type)
    {
        case JsonValue::Null: return "null";
        case JsonValue::Bool: return v.b ? "true" : "false";
        case JsonValue::Number:
        {
            char buf[64]; std::snprintf(buf, sizeof buf, "%.17g", v.num); return buf;
        }
        case JsonValue::String: return jsonQuote(v.str);
        case JsonValue::Array:
        {
            std::string out = "[";
            for (size_t i = 0; i < v.arr.size(); ++i) { if (i) out += ","; out += jsonText(v.arr[i]); }
            return out + "]";
        }
        case JsonValue::Object:
        {
            std::string out = "{"; bool first = true;
            for (const auto& kv : v.obj) { if (!first) out += ","; first = false; out += jsonQuote(kv.first) + ":" + jsonText(kv.second); }
            return out + "}";
        }
    }
    return "null";
}

// Every key path in a value: "save/flows/main/cursor/stack[0]/sceneId". Containers included, array
// elements indexed, leaf types not recorded. Mirrors the JS runner's envelopeKeyPaths; the caller sorts.
static void keyPaths(const JsonValue& v, const std::string& path, std::vector<std::string>& into)
{
    if (v.isArray())
    {
        if (!path.empty()) into.push_back(path);
        for (size_t i = 0; i < v.arr.size(); ++i) keyPaths(v.arr[i], path + "[" + std::to_string(i) + "]", into);
    }
    else if (v.isObject())
    {
        if (!path.empty()) into.push_back(path);
        for (const auto& kv : v.obj) keyPaths(kv.second, path.empty() ? kv.first : path + "/" + kv.first, into);
    }
    else into.push_back(path);
}

// -- saves: an envelope the JS reference wrote, loaded through THIS core's own boundary ---------------
static int runSaves(const JsonValue& arr)
{
    int pass = 0;
    for (const auto& c : arr.arr)
    {
        std::string name = c.at("name").str;
        try
        {
            Bundle bundle = parseBundle(c.at("bundle"));
            EngineOptions opts;
            if (const JsonValue* sd = c.find("seed")) { opts.hasSeed = true; opts.seed = static_cast<int64_t>(sd->num); }
            applyEngineOptions(c, opts);
            auto engine = std::make_shared<Engine>(bundle, opts);
            // Writer and reader are different runtimes here, which no self round-trip can test. Then the
            // core must write the loaded state back in the same shape (key paths) before continuing:
            // loading a shape is not the same as adopting it.
            deserializeState(*engine, jsonText(c.at("envelope")));
            JsonValue back = JsonParser(serializeState(*engine)).parse();
            std::vector<std::string> got; keyPaths(back, "", got); std::sort(got.begin(), got.end());
            std::vector<std::string> want; for (const auto& k : c.at("keyPaths").arr) want.push_back(k.str);
            if (got != want)
            {
                std::string missing, extra;
                for (const auto& k : want) if (std::find(got.begin(), got.end(), k) == got.end()) missing += (missing.empty() ? "" : ", ") + k;
                for (const auto& k : got) if (std::find(want.begin(), want.end(), k) == want.end()) extra += (extra.empty() ? "" : ", ") + k;
                throw std::runtime_error("re-serialised save has different key paths; missing: [" + missing + "] extra: [" + extra + "]");
            }
            if (runScript(engine, bundle, nullptr, opts, c.at("script"), name, "").first) ++pass;
        }
        catch (const std::exception& ex) { fail("saves", name, ex.what()); }
    }
    return pass;
}

int runScripted(const JsonValue& arr)
{
    int pass = 0;
    for (const auto& c : arr.arr)
    {
        std::string name = c.at("name").str;
        try
        {
            Bundle bundle = parseBundle(c.at("bundle"));
            // The EDITED bundle a hotSwap op switches to (cross-bundle drift cases, spec 9.8).
            Bundle bundleB;
            const JsonValue* bb = c.find("bundleB");
            if (bb) bundleB = parseBundle(*bb);
            EngineOptions opts;
            if (const JsonValue* sd = c.find("seed")) { opts.hasSeed = true; opts.seed = static_cast<int64_t>(sd->num); }
            applyEngineOptions(c, opts);
            auto engine = std::make_shared<Engine>(bundle, opts);
            if (runScript(engine, bundle, bb ? &bundleB : nullptr, opts, c.at("script"), name, "").first) ++pass;
        }
        catch (const std::exception& ex) { fail("scripted", name, ex.what()); }
    }
    return pass;
}

static int runGameData(const JsonValue& arr)
{
    int pass = 0;
    for (const auto& c : arr.arr)
    {
        std::string name = c.at("name").str;
        try
        {
            Bundle bundle = parseBundle(c.at("bundle"));
            std::string kind = c.at("kind").str;
            std::shared_ptr<GameData> node;
            if (const JsonValue* n = c.find("node")) node = parseGameData(*n);
            const std::vector<GameDataField> fields = gameDataFields(bundle, kind);
            auto effective = effectiveGameData(fields, node.get());
            // gameDataValue agrees with the merge, field by field.
            for (const auto& p : effective)
            {
                const PatterValue* v = gameDataValue(fields, node.get(), p.first);
                if (!v || valueToJson(*v).str != valueToJson(p.second).str || v->kind != p.second.kind)
                    throw std::runtime_error("gameDataValue disagrees with effectiveGameData on " + p.first);
            }
            JsonValue produced = JsonValue::Obj();
            for (auto& p : effective) produced.set(p.first, valueToJson(p.second));
            if (matchValue(produced, c.at("expected"))) ++pass;
            else fail("gameData", name, "expected " + dump(c.at("expected")) + ", got " + dump(produced));
        }
        catch (const std::exception& ex) { fail("gameData", name, ex.what()); }
    }
    return pass;
}

// The decision trace: what the engine CHOSE, not what it produced. Its whole point is that the
// REASONING is in the entry - a select names every child it looked at with its verdict - so this
// asserts the considered list, not merely that something was logged. Off unless asked for,
// because a shipped game should pay nothing for a debugging surface it never reads.
static void runTraceLogSmoke()
{
    Bundle b;
    { PropertyDecl d; d.name = "gate"; d.type = "boolean"; d.hasDefault = true; d.def = PatterValue::Bool(false); b.properties.push_back(d); }

    // Two snippets under one block: the first gated on a condition that is false. The block is
    // a `run` container, which is the commonest decision in the engine.
    auto gated = std::make_shared<Node>(); gated->type = "snippet"; gated->id = "sn_gated";
    {   // @gate, built directly rather than parsed: the AST is the compiled form.
        auto node = std::make_shared<AstNode>();
        const_cast<AstNode*>(node.get())->tag = AstTag::ScopedVar;
        const_cast<AstNode*>(node.get())->scope = "patter";
        const_cast<AstNode*>(node.get())->name = "gate";
        gated->condition = std::make_shared<Expression>();
        gated->condition->ast = node;
    }
    { Beat beat; beat.id = "T_no"; beat.kind = "text"; gated->beats.push_back(beat); }
    auto open = std::make_shared<Node>(); open->type = "snippet"; open->id = "sn_open";
    { Beat beat; beat.id = "T_yes"; beat.kind = "text"; open->beats.push_back(beat); }

    Block block; block.id = "b"; block.name = "B"; block.children = { gated, open };
    Scene scene; scene.id = "s"; scene.name = "S"; scene.blocks = { block };
    b.scenes["s"] = scene;

    { // off unless asked for
        EngineOptions quiet; Engine e(b, quiet);
        Flow* f = e.openFlow("main", "s", "b");
        for (int i = 0; i < 20 && f->advance().type != StepType::End; i++) {}
        if (!e.log().empty() || !f->log().empty())
            fail("trace", "off by default", "a run that did not ask for a log has one");
    }

    EngineOptions opts; opts.log = true;
    Engine engine(b, opts);
    Flow* flow = engine.openFlow("main", "s", "b");
    for (int i = 0; i < 20 && flow->advance().type != StepType::End; i++) {}

    if (flow->log().empty()) { fail("trace", "empty", "a played flow logged nothing"); return; }

    const LogEntry* sel = nullptr;
    for (const auto& e : flow->log()) if (e.type == "select") { sel = &e; break; }
    if (!sel) { fail("trace", "select", "the skip past an ineligible sibling was not recorded"); return; }
    if (sel->children.size() != 2)
        fail("trace", "reasoning", "the select does not name both children it walked");
    else if (sel->children[0].first != "sn_gated" || sel->children[0].second
          || sel->children[1].first != "sn_open" || !sel->children[1].second)
        fail("trace", "reasoning", "the select does not say WHICH sibling was dropped");
    if (sel->picked != "sn_open") fail("trace", "picked", "the pick was not recorded");

    for (size_t i = 1; i < flow->log().size(); i++)
        if (flow->log()[i].seq <= flow->log()[i - 1].seq)
            fail("trace", "seq", "seq is not a monotonic ordering of the flow");
    for (const auto& e : engine.log())
        if (e.flow != "main") fail("trace", "flow tag", "an engine entry does not name its flow");

    int lastBefore = -1;
    for (const auto& e : engine.log()) lastBefore = std::max(lastBefore, e.seq);
    engine.clearLog();
    if (!engine.log().empty()) fail("trace", "clearLog", "the engine's stream did not empty");
    if (flow->log().empty()) fail("trace", "flow-local", "clearing the engine emptied a flow's own log");
    // After the clear the engine's stream keeps counting: seq was the log's size, so it restarted at 0
    // and entries read either side of a clear could not be ordered.
    Flow* again = engine.openFlow("again", "s", "b");
    for (int i = 0; i < 20 && again->advance().type != StepType::End; i++) {}
    bool restarted = engine.log().empty();
    for (const auto& e : engine.log()) if (e.seq <= lastBefore) restarted = true;
    if (restarted) fail("trace", "seq after clearLog", "the engine's seq restarted after a clear");

    std::cout << "  [trace] decisions logged: " << flow->log().size() << ", with the dropped sibling named\n";
}

// The bundle reader's shared case (PatterBundleReaderCase.h), read through this host's JsonValue. The
// plugin's automation test Patterplay.BundleReader reads the same JSON through FJsonValue and checks the
// same facts, so the two hosts' accessors cannot drift apart unseen.
static void runBundleReaderCase()
{
    namespace rc = patter::bundlereadercase;
    for (const std::string& what : rc::Check(parseBundle(JsonParser(rc::Json()).parse())))
        fail("bundle-reader", what, "read differently from the plugin's expectation");
    std::string error;
    try { parseBundle(JsonParser(rc::MissingFieldJson()).parse()); }
    catch (const std::exception& ex) { error = ex.what(); }
    if (error != rc::MissingFieldError()) fail("bundle-reader", "missing field", "expected \"" + std::string(rc::MissingFieldError()) + "\", got \"" + error + "\"");
    std::cout << "  [bundle-reader] the plugin's reader, through this host's JSON: the shared case\n";
}

// Moving a flow drops everything waiting to be delivered. With replayPromptOnChoose, choose() leaves the
// chosen option's prompt waiting to be spoken back by the next advance(). A restart (start) between the two
// used to clear only the choice, so the abandoned run's prompt played as the restarted run's first beat; and
// close() left the shown prompt behind. All now share one clearPending, as on the other three runtimes.
static void runPendingClearedCheck()
{
    const char* json = R"JSON({"schema":"patter/bundle@0","locales":{"default":"en","included":["en"]},
      "scenes":{"s":{"id":"s","type":"scene","name":"S","gameId":"s","blocks":[{"id":"b","type":"block","name":"B","gameId":"b","children":[
        {"id":"sn_open","type":"snippet","beats":[{"id":"OPEN","kind":"text"}]},
        {"id":"g","type":"group","selector":"choice","children":[
          {"id":"o","type":"group","prompt":{"id":"P","kind":"line","character":"PC"},"children":[
            {"id":"sn_ans","type":"snippet","beats":[{"id":"ANS","kind":"text"}],"jump":{"to":"END"}}]}]}]}]}},
      "strings":{"en":{"OPEN":"opening","P":"Ask","ANS":"answer"}}})JSON";
    const Bundle bundle = parseBundle(JsonParser(json).parse());
    EngineOptions opts; opts.replayPromptOnChoose = true;
    auto toChosen = [&](Engine& engine) {
        Flow* flow = engine.openFlow("f", "s");
        flow->advance();
        flow->advance();
        flow->choose("o");
        return flow;
    };
    { Engine e(bundle, opts); if (toChosen(e)->advance().id != "P") fail("pending", "replay", "the chosen prompt was not spoken back"); }
    { Engine e(bundle, opts); Flow* f = toChosen(e); f->reset("s", ""); const auto r = f->advance();
      if (r.id != "OPEN") fail("pending", "reset", "a reset replayed the abandoned run's prompt (got " + r.id + ")"); }
    { Engine e(bundle, opts); Flow* f = toChosen(e); f->gotoAddress("s", ""); const auto r = f->advance();
      if (r.id != "OPEN") fail("pending", "goto", "a goto replayed the abandoned run's prompt (got " + r.id + ")"); }
    std::cout << "  [pending] a restart or a goto drops a chosen prompt still waiting to be replayed\n";
}

// A save written before choice prompts carried their pause (line padding) has prompts without `padAfter`. A
// pending choice's prompts aren't read from a save any more (version 4 builds them as the choice is delivered,
// so each carries its pause: an authored prompt's, or a bare snippet's first content line's); the pending
// replay prompt's shown copy is worked out again on load.
static void runOldSavePromptPadCheck()
{
    const char* json = R"JSON({"schema":"patter/bundle@0","locales":{"default":"en","included":["en"]},
      "scenes":{"s":{"id":"s","type":"scene","name":"S","gameId":"s","blocks":[{"id":"b","type":"block","name":"B","gameId":"b","children":[
        {"id":"g","type":"group","selector":"choice","children":[
          {"id":"o","type":"group","prompt":{"id":"P","kind":"line","character":"PC","padAfter":-0.4},"children":[
            {"id":"sn_ans","type":"snippet","beats":[{"id":"ANS","kind":"text"}],"jump":{"to":"END"}}]},
          {"id":"sn_bare","type":"snippet","beats":[{"id":"BARE","kind":"text","padAfter":2},{"id":"MORE","kind":"text"}],"jump":{"to":"END"}}]}]}]}},
      "strings":{"en":{"P":"Ask","ANS":"answer","BARE":"Leave","MORE":"bye"}}})JSON";
    const Bundle bundle = parseBundle(JsonParser(json).parse());
    EngineOptions opts; opts.replayPromptOnChoose = true;
    auto strip = [](std::string s) {
        for (const std::string key : { ",\"padAfter\":-0.4", ",\"padAfter\":2" })
            for (std::size_t at; (at = s.find(key)) != std::string::npos;) s.erase(at, key.size());
        return s;
    };
    auto padOfOption = [](Flow* f, const std::string& id) {
        for (const auto& o : f->getChoices()) if (o.id == id && o.prompt) return o.prompt->hasPadAfter ? o.prompt->padAfter : 99.0;
        return 99.0;
    };
    // A pending choice: both options' prompts, built as the loaded choice is delivered.
    {
        Engine live(bundle, opts); Flow* f = live.openFlow("f", "s"); f->advance();
        if (padOfOption(f, "o") != -0.4 || padOfOption(f, "sn_bare") != 2) fail("old-save", "live", "a prompt did not carry its pause");
        const std::string old = strip(serializeState(live));
        if (old.find("padAfter") != std::string::npos) fail("old-save", "strip", "the test could not make an old save");
        Engine loaded(bundle, opts); deserializeState(loaded, old); Flow* g = loaded.getFlow("f");
        if (!g || padOfOption(g, "o") != -0.4) fail("old-save", "authored prompt", "an old save's prompt pause was not re-resolved");
        if (!g || padOfOption(g, "sn_bare") != 2) fail("old-save", "bare snippet", "an old save's bare prompt pause was not re-resolved");
    }
    // A prompt waiting to be replayed: its shown copy saves its pause again.
    {
        Engine live(bundle, opts); Flow* f = live.openFlow("f", "s"); f->advance(); f->choose("o");
        const std::string old = strip(serializeState(live));
        Engine loaded(bundle, opts); deserializeState(loaded, old);
        if (serializeState(loaded).find("\"padAfter\":-0.4") == std::string::npos)
            fail("old-save", "pending prompt", "an old save's pending prompt did not save its pause again");
        Flow* g = loaded.getFlow("f");
        const auto r = g ? g->advance() : StepResult{};
        if (r.id != "P" || r.padAfter != -0.4) fail("old-save", "replay", "the replayed prompt lost its pause");
    }
    std::cout << "  [old-save] a saved prompt without a pause is worked out again on load\n";
}

// A bundle qualifier without a name gives a line no shown qualifier name (JS, Unity, and Godot leave the field
// off); it reported an empty one here. A locale string can still name it.
static void runNamelessQualifierCheck()
{
    auto run = [](const std::string& strings) {
        const std::string json = R"JSON({"schema":"patter/bundle@0","locales":{"default":"en","included":["en"]},"cast":[{"name":"TAM"}],
          "qualifiers":[{"gameId":"vo"}],
          "scenes":{"s":{"id":"s","type":"scene","name":"S","gameId":"s","blocks":[{"id":"b","type":"block","name":"B","gameId":"b","children":[
            {"id":"sn","type":"snippet","beats":[{"id":"L","kind":"line","character":"TAM","qualifier":"vo"}]}]}]}},
          "strings":{"en":{"L":"Hello")JSON" + strings + "}}}";
        const Bundle bundle = parseBundle(JsonParser(json).parse());   // the engine reads it by reference
        Engine engine(bundle, EngineOptions{});
        return engine.openFlow("f", "s")->advance();
    };
    const auto bare = run("");
    if (!bare.hasQualifier || bare.qualifier != "vo") fail("nameless-qualifier", "qualifier", "the line lost its qualifier");
    if (bare.hasQualifierName) fail("nameless-qualifier", "no name", "a nameless qualifier gave a shown name (\"" + bare.qualifierName + "\")");
    const auto named = run(",\"qualifier:vo\":\"V.O.\"");
    if (!named.hasQualifierName || named.qualifierName != "V.O.") fail("nameless-qualifier", "locale string", "a locale string did not name a nameless qualifier");
    std::cout << "  [nameless-qualifier] a qualifier without a name gives no shown name; a locale string still can\n";
}

// Speaker labels, beyond what the corpus pins. A `speaker:<name>:<gameId>` string counts only for a pair the bundle
// overrides (the cast's qualifierLabels): a stale one a locale still holds for a pair that follows the pattern is
// ignored. A save written before prompts carried their label has none, and loading it works the label out again
// from the saved speaker, in the locale the loading engine plays. And the pattern's placeholders are plain text:
// each is replaced wherever it appears, and nothing a name brings with it is read.
static void runSpeakerLabelCheck()
{
    const char* json = R"JSON({"schema":"patter/bundle@0","locales":{"default":"en","included":["en","fr"]},
      "cast":[{"name":"TAM","displayName":"Tam","qualifierLabels":{"os":"Tam offstage"}}],
      "qualifiers":[{"gameId":"vo","name":"V.O."},{"gameId":"os","name":"O.S."}],
      "scenes":{"s":{"id":"s","type":"scene","name":"S","gameId":"s","blocks":[{"id":"b","type":"block","name":"B","gameId":"b","children":[
        {"id":"sn","type":"snippet","beats":[{"id":"L_vo","kind":"line","character":"TAM","qualifier":"vo"},{"id":"L_os","kind":"line","character":"TAM","qualifier":"os"}]},
        {"id":"g","type":"group","selector":"choice","children":[
          {"id":"o","type":"group","prompt":{"id":"P","kind":"line","character":"TAM","qualifier":"vo"},"children":[
            {"id":"sn_ans","type":"snippet","beats":[{"id":"ANS","kind":"text"}],"jump":{"to":"END"}}]}]}]}]}},
      "strings":{"en":{"L_vo":"Hm.","L_os":"Hey!","P":"Think","ANS":"ok","speaker:TAM:vo":"STALE"},
                 "fr":{"L_vo":"Hm.","L_os":"Hé !","P":"Penser","ANS":"ok","qualifier:vo":"voix off","speaker:pattern":"{name}, {qualifier}","speaker:TAM:vo":"STALE","speaker:TAM:os":"Tam hors champ"}}})JSON";
    const Bundle bundle = parseBundle(JsonParser(json).parse());
    auto labelOf = [](const StepResult& r) { return r.hasSpeakerLabel ? r.speakerLabel : std::string("<none>"); };
    auto promptLabel = [](Flow* f) {
        for (const auto& o : f->getChoices()) if (o.id == "o" && o.prompt) return o.prompt->hasSpeakerLabel ? o.prompt->speakerLabel : std::string("<none>");
        return std::string("<no prompt>");
    };
    EngineOptions en; EngineOptions fr; fr.locale = "fr";
    {
        Engine e(bundle, en); Flow* f = e.openFlow("f", "s");
        const std::string vo = labelOf(f->advance()), os = labelOf(f->advance());
        if (vo != "Tam (V.O.)") fail("speaker-label", "stale string", "a speaker: string for a pair the bundle doesn't override was used: got " + vo);
        if (os != "Tam offstage") fail("speaker-label", "own label", "an overridden pair did not show its own label: got " + os);
    }
    {
        Engine e(bundle, fr); Flow* f = e.openFlow("f", "s");
        const std::string vo = labelOf(f->advance()), os = labelOf(f->advance());
        if (vo != "Tam, voix off") fail("speaker-label", "stale string, translated", "a translated pattern lost to a stale speaker: string: got " + vo);
        if (os != "Tam hors champ") fail("speaker-label", "own label, translated", "an overridden pair did not show its translated label: got " + os);
    }
    {
        // A pending choice's prompts aren't saved (version 4): each is built as the choice is delivered, its
        // label in the loading engine's locale.
        Engine live(bundle, en); Flow* f = live.openFlow("f", "s"); f->advance(); f->advance(); f->advance();
        if (promptLabel(f) != "Tam (V.O.)") fail("speaker-label", "live prompt", "the prompt did not carry its label: got " + promptLabel(f));
        const std::string saved = serializeState(live);
        if (saved.find("speakerLabel") != std::string::npos || saved.find("\"prompt\"") != std::string::npos)
            fail("speaker-label", "pending save", "a pending choice's save kept its prompt text: " + saved);
        Engine same(bundle, en); deserializeState(same, saved);
        Flow* g = same.getFlow("f");
        if (!g || promptLabel(g) != "Tam (V.O.)") fail("speaker-label", "loaded", "a loaded choice's prompt label was not built: got " + (g ? promptLabel(g) : std::string("no flow")));
        Engine other(bundle, fr); deserializeState(other, saved);
        Flow* h = other.getFlow("f");
        if (!h || promptLabel(h) != "Tam, voix off") fail("speaker-label", "loaded, current locale", "a loaded choice's prompt label was not built in the current locale: got " + (h ? promptLabel(h) : std::string("no flow")));
    }
    {
        // An old save taken between choose() and advance(): the prompt waiting to be spoken back has no label
        // either, and the replayed line works it out again, in the loading engine's locale.
        EngineOptions enReplay = en; enReplay.replayPromptOnChoose = true;
        EngineOptions frReplay = fr; frReplay.replayPromptOnChoose = true;
        Engine live(bundle, enReplay); Flow* f = live.openFlow("f", "s"); f->advance(); f->advance(); f->advance(); f->choose("o");
        std::string old = serializeState(live);
        const std::string key = ",\"speakerLabel\":\"Tam (V.O.)\"";
        if (old.find("pendingPrompt") == std::string::npos || old.find(key) == std::string::npos)
            fail("speaker-label", "replay save", "the save did not carry the prompt waiting to be spoken back, with its label");
        for (std::size_t at; (at = old.find(key)) != std::string::npos;) old.erase(at, key.size());
        Engine same(bundle, enReplay); deserializeState(same, old);
        if (serializeState(same).find(key) == std::string::npos) fail("speaker-label", "replay, saved again", "a re-resolved replay label did not save again");
        Flow* g = same.getFlow("f");
        const StepResult r = g ? g->advance() : StepResult{};
        if (r.id != "P" || labelOf(r) != "Tam (V.O.)") fail("speaker-label", "replay", "an old save's replayed prompt lost its label: got " + labelOf(r));
        Engine other(bundle, frReplay); deserializeState(other, old);
        Flow* h = other.getFlow("f");
        const StepResult t = h ? h->advance() : StepResult{};
        if (t.id != "P" || labelOf(t) != "Tam, voix off") fail("speaker-label", "replay, current locale", "an old save's replayed prompt label was not re-resolved in the current locale: got " + labelOf(t));
    }
    if (formatSpeakerLabel("{name}/{qualifier}/{name}", "A{qualifier}", "Q{name}") != "A{qualifier}/Q{name}/A{qualifier}")
        fail("speaker-label", "placeholders", "the pattern's placeholders were not filled as plain text");
    std::cout << "  [speaker-label] a stale speaker: string for a pair that isn't overridden is ignored; a pending prompt's label is built in the locale in use; an old replayed prompt's is worked out again\n";
}

// A small local check for Engine::listProperties() (the live-inspector contract): it isn't part of
// the shared corpus, so exercise it directly - only shared @patter decls, each with type / value /
// default / enum values, and a live setProperty reflected on the next read.
// A host-scope declaration's `writable: false` is refused by the ENGINE, whether the scope is bound by
// the game or self-backed. The JS reference always did; this core let a bound scope's set straight
// through until 2026-09-03 (from-storylets/unreal-wrapper-host-scopes). Not a corpus case: the corpus
// cannot see an error report, so it is pinned here beside the other checks the corpus cannot express.
// The refused write is a content error the engine plays through (PlayError): skipped, reported through
// onError, and the rest of the effect list still runs. It used to throw out of openFlow.
static void runHostScopeWritableSmoke()
{
    const char* json = R"JSON({
      "schema": "patter/bundle@0", "locales": { "default": "en", "included": ["en"] },
      "strings": { "en": { "T": "hi" } }, "properties": [],
      "scopeRegistry": { "version": 1, "scopes": [ { "token": "world", "declarations": [
        { "name": "clock", "type": "string", "default": "day", "writable": false },
        { "name": "known", "type": "boolean", "default": false } ] } ] },
      "scenes": { "s": { "id": "s", "gameId": "s", "blocks": [ { "id": "b", "gameId": "b", "children": [
        { "id": "sn", "type": "snippet", "beats": [ { "id": "T", "kind": "text" } ],
          "onEnter": [ { "kind": "set", "target": "@world.clock", "value": { "src": "\"night\"", "ast": ["s", "night"] } },
                       { "kind": "set", "target": "@world.known", "value": { "src": "true", "ast": ["b", true] } } ],
          "jump": { "to": "END" } } ] } ] } } })JSON";
    Bundle bundle = parseBundle(JsonParser(json).parse());
    for (int pass = 0; pass < 2; ++pass)
    {
        const bool bound = pass == 1;
        const std::string label = bound ? "bound" : "self-backed";
        // A bound scope has no defaults: the GAME owns its values and seeds them itself.
        auto store = std::make_shared<std::map<std::string, PatterValue>>();
        (*store)["clock"] = PatterValue::Str("day"); (*store)["known"] = PatterValue::Bool(false);
        EngineOptions opts;
        if (bound)
        {
            HostScope scope;
            scope.get = [store](const std::string& n) -> const PatterValue* { auto it = store->find(n); return it == store->end() ? nullptr : &it->second; };
            scope.set = [store](const std::string& n, const PatterValue& v) { (*store)[n] = v; };
            opts.hostScopes["world"] = scope;
        }
        std::vector<PlayError> errors;
        opts.onError = [&errors](const PlayError& e) { errors.push_back(e); };
        Engine engine(bundle, opts);
        std::string message;
        StepResult first;
        try { first = engine.openFlow("main", "s", "b")->advance(); }
        catch (const std::exception& ex) { message = ex.what(); }
        if (!message.empty()) fail("host-scope", label, "a refused story write still threw out of the flow: " + message);
        if (first.type != StepType::Text || first.id != "T") fail("host-scope", label, "the flow did not play on past the refused write");
        if (errors.size() != 1 || errors[0].kind != "effect" || errors[0].node != "sn" || errors[0].flow != "main"
            || errors[0].source != "\"night\"" || errors[0].message.find("'@world.clock' is read-only") == std::string::npos)
            fail("host-scope", label, "a story write to a writable:false declaration was not reported through onError as one effect error on sn");
        const PatterValue* knownAfter = engine.getProperty("@world.known");
        if (!knownAfter || !knownAfter->b) fail("host-scope", label, "the effect after the refused write did not run");
        if (bound && (*store)["clock"].s != "day")
            fail("host-scope", label, "the refused write still landed in the game's scope");
        const PatterValue* clock = engine.getProperty("@world.clock");
        if (!clock || clock->s != "day") fail("host-scope", label, "a story write to a writable:false declaration changed the value");
        // The GAME's own path through the engine is NOT refused: `writable: false` is the story's promise
        // about the story's writes, never a lock on the value's owner (ruled across the family
        // 2026-09-05, from-storylets/host-writes-to-read-only-world).
        message.clear();
        try { engine.setProperty("@world.clock", PatterValue::Str("night")); }
        catch (const std::exception& ex) { message = ex.what(); }
        if (!message.empty()) fail("host-scope", label, "the GAME's setProperty on a writable:false declaration was refused: " + message);
        const PatterValue* moved = engine.getProperty("@world.clock");
        if (!moved || moved->s != "night") fail("host-scope", label, "the game's write did not land");
        // And a writable name still lands.
        engine.setProperty("@world.known", PatterValue::Bool(true));
        const PatterValue* known = engine.getProperty("@world.known");
        if (!known || !known->b) fail("host-scope", label, "a writable declaration was refused too");
    }
    std::cout << "  [host-scope] writable:false is the story's promise, refused bound or self-backed\n";
}

// ----- one registry per game -------------------------------------------------------------------------
//
// The engine registers every property bag it has in the game's ScopeRegistry: @patter under `patter`,
// and its per-flow and per-scene bags under keys that start `patter/`. saveGame() keeps only what is
// not a property, unless the engine made its own registry (a standalone game), when the registry's
// values ride along. Ports of the JS reference's one-registry.test.ts, combined-game.test.ts and
// save-envelope-shape.test.ts (packages/runtime/test), held to the same expectations: the bundles
// below are those tests' fixtures as the JS compiler exports them. Not corpus cases: the script
// grammar has no registry of the game's own, no "this must throw", and no second engine.

static int g_regPass = 0, g_regTotal = 0;

static void regCase(const std::string& name, const std::function<void()>& body)
{
    ++g_regTotal;
    try { body(); ++g_regPass; }
    catch (const std::exception& ex) { fail("one-registry", name, ex.what()); }
}

static void need(bool ok, const std::string& what) { if (!ok) throw std::runtime_error(what); }

static JsonValue parseJ(const std::string& text) { return JsonParser(text).parse(); }

/** A registry's values as JSON, for an order-insensitive comparison (the JS tests' toEqual). */
static JsonValue blobJson(const ScopeRegistry::SaveBlob& blob)
{
    JsonValue o = JsonValue::Obj();
    for (const auto& kv : blob)
    {
        JsonValue section = JsonValue::Obj();
        for (const auto& p : kv.second) section.set(p.first, valueToJson(p.second));
        o.set(kv.first, std::move(section));
    }
    return o;
}

static void expectJson(const JsonValue& got, const std::string& want, const std::string& what)
{
    JsonValue w = parseJ(want);
    if (!matchValue(got, w)) throw std::runtime_error(what + ": expected " + dump(w) + ", got " + dump(got));
}

static ScopeRegistry::SaveBlob blobOf(const std::string& json)
{
    ScopeRegistry::SaveBlob blob;
    for (const auto& kv : parseJ(json).obj)
    {
        OrderedMap<std::string, PatterValue> section;
        for (const auto& p : kv.second.obj) section.set(p.first, toValue(p.second));
        blob.set(kv.first, std::move(section));
    }
    return blob;
}

static double numberAt(const PatterValue* v, const std::string& what)
{
    if (!v || !v->isNumber()) throw std::runtime_error(what + ": expected a number, got " + (v ? v->toDisplayString() : std::string("nothing")));
    return v->n;
}

static void expectNumber(const PatterValue* v, double want, const std::string& what)
{
    const double got = numberAt(v, what);
    if (got != want) throw std::runtime_error(what + ": expected " + PatterValue::JsNumber(want) + ", got " + PatterValue::JsNumber(got));
}

static void expectNumber(const std::optional<PatterValue>& v, double want, const std::string& what)
{
    expectNumber(v ? &*v : nullptr, want, what);
}

static void expectThrow(const std::function<void()>& body, const std::string& contains, const std::string& what)
{
    std::string message;
    try { body(); }
    catch (const std::exception& ex) { message = ex.what(); }
    if (message.empty()) throw std::runtime_error(what + ": did not throw");
    if (message.find(contains) == std::string::npos) throw std::runtime_error(what + ": threw \"" + message + "\", expected it to say \"" + contains + "\"");
}

static std::vector<std::string> sortedKeys(const JsonValue& o)
{
    std::vector<std::string> keys;
    for (const auto& kv : o.obj) keys.push_back(kv.first);
    std::sort(keys.begin(), keys.end());
    return keys;
}

static std::string joined(const std::vector<std::string>& v)
{
    std::string out;
    for (const auto& s : v) out += (out.empty() ? "" : ", ") + s;
    return "[" + out + "]";
}

static void playOut(Flow* flow)
{
    for (int i = 0; i < 10 && flow->advance().type != StepType::End; i++) { /* play to the end */ }
}

// one-registry.test.ts: `@fame` shared, `@mood` per flow; `@scene.count` per flow, `@scene.tally` the
// scene's shared bag; a declared @world with `gold`. The snippet's exit bumps all five.
static const Bundle& orBundle()
{
    static const Bundle b = parseBundle(parseJ(R"JSON({"schema":"patter/bundle@0","content":{"project":"or","hash":"06croli","structureHash":"19cnayl"},"voiced":false,"locales":{"default":"en","included":["en"]},"properties":[{"name":"fame","type":"number","default":0,"shared":true},{"name":"mood","type":"number","default":0,"shared":false}],"scopeRegistry":{"version":1,"scopes":[{"token":"world","declarations":[{"name":"gold","type":"number","default":0}]}]},"scenes":{"s":{"id":"s","type":"scene","name":"S","gameId":"s","sceneProps":[{"name":"count","type":"number","default":0},{"name":"tally","type":"number","default":0,"shared":true}],"blocks":[{"id":"b","type":"block","name":"B","children":[{"id":"sn","type":"snippet","beats":[{"id":"L","kind":"text"}],"onExit":[{"kind":"set","target":"@fame","value":{"src":"@fame + 1","ast":["bin","+",["sv","patter","fame"],["n",1]]}},{"kind":"set","target":"@mood","value":{"src":"@mood + 2","ast":["bin","+",["sv","patter","mood"],["n",2]]}},{"kind":"set","target":"@scene.count","value":{"src":"@scene.count + 1","ast":["bin","+",["sv","scene","count"],["n",1]]}},{"kind":"set","target":"@scene.tally","value":{"src":"@scene.tally + 1","ast":["bin","+",["sv","scene","tally"],["n",1]]}},{"kind":"set","target":"@world.gold","value":{"src":"@world.gold + 5","ast":["bin","+",["sv","world","gold"],["n",5]]}}],"jump":{"to":"END"}}]}]}},"strings":{"en":{"L":"gold {@world.gold}"}}})JSON"));
    return b;
}

// The same, reading `@story.act` (compiled against another engine's spec, which it does not declare
// as its own, so the bundle lists it in externalScopes) after a first snippet that makes the flow build
// its context before @story is replaced.
static const Bundle& withStoryBundle()
{
    static const Bundle b = parseBundle(parseJ(R"JSON({"schema":"patter/bundle@0","content":{"project":"or","hash":"0oj4bfr","structureHash":"1cazdgj"},"voiced":false,"locales":{"default":"en","included":["en"]},"properties":[{"name":"fame","type":"number","default":0,"shared":true},{"name":"mood","type":"number","default":0,"shared":false}],"scenes":{"s":{"id":"s","type":"scene","name":"S","gameId":"s","sceneProps":[{"name":"count","type":"number","default":0},{"name":"tally","type":"number","default":0,"shared":true}],"blocks":[{"id":"b","type":"block","name":"B","children":[{"id":"intro","type":"snippet","condition":{"src":"@fame >= 0","ast":["bin",">=",["sv","patter","fame"],["n",0]]},"beats":[{"id":"I","kind":"text"}]},{"id":"yes","type":"snippet","condition":{"src":"@story.act >= 2","ast":["bin",">=",["sv","story","act"],["n",2]]},"beats":[{"id":"L","kind":"text"}],"jump":{"to":"END"}}]}]}},"strings":{"en":{"I":"intro","L":"act two"}},"externalScopes":["story"]})JSON"));
    return b;
}

// combined-game.test.ts: the purchase needs gold AND the second act; on exit it spends shared gold and
// bumps Patter's own shared `@patter.visits`.
static const Bundle& combinedBundle()
{
    static const Bundle b = parseBundle(parseJ(R"JSON({"schema":"patter/bundle@0","content":{"project":"p","hash":"0l7gt7r","structureHash":"0o6kky5"},"voiced":false,"locales":{"default":"en","included":["en"]},"cast":[{"name":"MERCHANT"}],"properties":[{"name":"visits","type":"number","shared":true,"default":0}],"scenes":{"shop":{"id":"shop","type":"scene","name":"Shop","blocks":[{"id":"b","type":"block","name":"B","children":[{"id":"buy","type":"snippet","condition":{"src":"@world.gold >= 10 && @story.act >= 2","ast":["bin","and",["bin",">=",["sv","world","gold"],["n",10]],["bin",">=",["sv","story","act"],["n",2]]]},"beats":[{"id":"L","kind":"line","character":"MERCHANT"}],"onExit":[{"kind":"set","target":"@world.gold","value":{"src":"@world.gold - 10","ast":["bin","-",["sv","world","gold"],["n",10]]}},{"kind":"set","target":"@visits","value":{"src":"@visits + 1","ast":["bin","+",["sv","patter","visits"],["n",1]]}}],"jump":{"to":"END"}}]}]}},"strings":{"en":{"L":"A fine blade."}},"externalScopes":["story"]})JSON"));
    return b;
}

// save-envelope-shape.test.ts: `@gold` shared, `@scene.count` per flow, `@scene.tally` shared.
static const Bundle& envelopeBundle()
{
    static const Bundle b = parseBundle(parseJ(R"JSON({"schema":"patter/bundle@0","content":{"project":"p","hash":"1n4f73e","structureHash":"0g7bf8q"},"voiced":false,"locales":{"default":"en","included":["en"]},"properties":[{"name":"gold","type":"number","default":0,"shared":true}],"scenes":{"s":{"id":"s","type":"scene","name":"S","gameId":"s","sceneProps":[{"name":"count","type":"number","default":0,"shared":false},{"name":"tally","type":"number","default":0,"shared":true}],"blocks":[{"id":"b","type":"block","name":"B","children":[{"id":"sn","type":"snippet","beats":[{"id":"L","kind":"text"}],"onExit":[{"kind":"set","target":"@scene.count","value":{"src":"1","ast":["n",1]}},{"kind":"set","target":"@scene.tally","value":{"src":"2","ast":["n",2]}},{"kind":"set","target":"@gold","value":{"src":"7","ast":["n",7]}}],"jump":{"to":"END"}}]}]}},"strings":{"en":{"L":"hi"}}})JSON"));
    return b;
}

static ScopeDeclaration numberDecl(const std::string& name, std::optional<double> def = std::nullopt)
{
    ScopeDeclaration d;
    d.name = name;
    d.type = "number";
    if (def) d.defaultValue = PatterValue::Num(*def);
    return d;
}

/** A game that owns its registry and registers `@world` itself, as a property the registry stores. */
struct RegGame
{
    std::shared_ptr<ScopeRegistry> registry;
    std::unique_ptr<Engine> patter;
};

static RegGame makeGame()
{
    RegGame g;
    g.registry = std::make_shared<ScopeRegistry>();
    OwnedScopeOptions world;
    world.owner = "Game";
    g.registry->defineOwned("world", { numberDecl("gold", 0) }, world);
    EngineOptions opts;
    opts.registry = g.registry;
    opts.hasSeed = true; opts.seed = 1;
    g.patter = std::make_unique<Engine>(orBundle(), opts);
    return g;
}

static std::unique_ptr<Engine> standalone(const Bundle& bundle, double seed)
{
    EngineOptions opts;
    opts.hasSeed = true; opts.seed = seed;
    return std::make_unique<Engine>(bundle, opts);
}

/** The registry keys a registry holds (registered and parked), sorted. */
static std::vector<std::string> registryKeys(const ScopeRegistry& registry)
{
    std::vector<std::string> keys;
    for (const auto& kv : registry.save()) keys.push_back(kv.first);
    std::sort(keys.begin(), keys.end());
    return keys;
}

static void runOneRegistryCases()
{
    regCase("registers every bag in the game's registry, under Patter's keys and owner label", []
    {
        RegGame g = makeGame();
        playOut(g.patter->openFlow("f", "s"));
        expectJson(blobJson(g.registry->save()),
            R"({"world":{"gold":5},"patter":{"fame":1},"patter/flow/f/patter":{"mood":2},"patter/flow/f/scene/s":{"count":1},"patter/scene/s":{"tally":1}})",
            "registry values");
        // Examiner rows keep the story's addresses; the scope column says which bag, the owner whose.
        JsonValue rows = JsonValue::Arr();
        for (const auto& r : g.registry->listProperties())
        {
            if (r.owner != std::optional<std::string>("Patter")) continue;
            JsonValue row = JsonValue::Arr();
            row.push(JsonValue::Str(r.scope)); row.push(JsonValue::Str(r.path)); row.push(valueToJson(r.value));
            rows.push(std::move(row));
        }
        expectJson(rows, R"([["patter","@patter.fame",1],["patter/flow/f/patter","@patter.mood",2],["patter/flow/f/scene/s","@scene.count",1],["patter/scene/s","@scene.tally",1]])", "Patter's rows");
    });

    regCase("leaves the values out of saveGame when the game passed the registry", []
    {
        RegGame g = makeGame();
        playOut(g.patter->openFlow("f", "s"));
        need(!g.patter->saveGame().registry.has_value(), "the save carries registry values");
        JsonValue save = parseJ(serializeState(*g.patter)).at("save");
        need(!save.has("registry"), "the envelope carries registry values");
        const auto keys = sortedKeys(save.at("flows").at("f"));
        need(keys == std::vector<std::string>{ "cursor", "rngState", "visits" }, "a flow's snapshot holds " + joined(keys));
    });

    regCase("uses a @world the game registered, and self-backs nothing", []
    {
        RegGame g = makeGame();
        std::optional<std::string> owner;
        for (const auto& r : g.registry->listProperties()) if (r.scope == "world") owner = r.owner;
        need(owner == std::optional<std::string>("Game"), "@world is not the game's");
        playOut(g.patter->openFlow("f", "s"));
        expectNumber(g.registry->get("world", "gold"), 5, "world.gold");
    });

    regCase("does not self-back a declared host scope in the game's registry: that token is the game's", []
    {
        auto registry = std::make_shared<ScopeRegistry>();
        EngineOptions opts; opts.registry = registry;
        Engine engine(orBundle(), opts);
        need(registry->has("patter"), "@patter is not registered");
        need(!registry->has("world"), "the engine self-backed @world in the game's registry");
    });

    regCase("a standalone engine self-backs @world as a stored property, and saves it", []
    {
        auto patter = standalone(orBundle(), 1);
        playOut(patter->openFlow("f", "s"));
        const std::string json = serializeState(*patter);
        expectJson(parseJ(json).at("save").at("registry").at("world"), R"({"gold":5})", "the saved @world");
        auto restored = standalone(orBundle(), 1);
        deserializeState(*restored, json);
        expectNumber(restored->getProperty("@world.gold"), 5, "restored @world.gold");
    });

    // One save for the game, loaded in either order. Both halves as the JSON a game stores: the
    // registry's through saveRegistry, Patter's through its own envelope.
    struct GameSave { std::string registry; std::string patter; };
    auto session1 = []
    {
        RegGame g = makeGame();
        playOut(g.patter->openFlow("f", "s"));
        g.patter->openFlow("g", "s"); // a second flow, still at its first beat
        return GameSave{ saveRegistry(*g.registry), serializeState(*g.patter) };
    };
    auto check = [](RegGame& g)
    {
        expectNumber(g.patter->getProperty("@fame"), 1, "@fame");
        expectNumber(g.patter->getProperty("@world.gold"), 5, "@world.gold");
        need(g.patter->getFlow("f") && g.patter->getFlow("g"), "a saved flow did not come back");
        expectNumber(g.patter->getFlow("f")->getProperty("@mood"), 2, "f @mood");
        expectNumber(g.patter->getFlow("f")->getProperty("@scene.count"), 1, "f @scene.count");
        expectNumber(g.patter->getFlow("g")->getProperty("@scene.count"), 0, "g @scene.count");
        expectNumber(g.patter->getFlow("g")->getProperty("@scene.tally"), 1, "g @scene.tally");
        // Play on: g's exit lands on the restored shared values.
        playOut(g.patter->getFlow("g"));
        expectNumber(g.patter->getProperty("@fame"), 2, "@fame after g plays");
        expectNumber(g.registry->get("patter/scene/s", "tally"), 2, "the scene's shared tally after g plays");
    };

    regCase("one save for the game: registry first, then the engine", [&]
    {
        GameSave save = session1();
        RegGame g = makeGame();
        loadRegistry(*g.registry, save.registry);
        deserializeState(*g.patter, save.patter);
        check(g);
    });

    regCase("one save for the game: the engine first, then the registry", [&]
    {
        GameSave save = session1();
        RegGame g = makeGame();
        deserializeState(*g.patter, save.patter);
        loadRegistry(*g.registry, save.registry);
        check(g);
    });

    regCase("one save for the game: into a game already playing, live flows are replaced by the saved ones", [&]
    {
        GameSave save = session1();
        RegGame g = makeGame();
        playOut(g.patter->openFlow("f", "s"));
        playOut(g.patter->openFlow("stray", "s")); // not in the save: its bags must not survive
        loadRegistry(*g.registry, save.registry);
        deserializeState(*g.patter, save.patter);
        check(g);
        for (const auto& k : registryKeys(*g.registry)) need(k.find("stray") == std::string::npos, "a stray flow's bag survived: " + k);
    });

    regCase("reads a scope another engine registered again after the flow opened", []
    {
        auto registry = std::make_shared<ScopeRegistry>();
        OwnedScopeOptions other; other.owner = "Other engine";
        registry->defineOwned("story", { numberDecl("act", 1) }, other);
        EngineOptions opts; opts.registry = registry;
        Engine patter(withStoryBundle(), opts);
        Flow* flow = patter.openFlow("f", "s");
        StepResult first = flow->advance();
        need(first.type == StepType::Text && first.text == "intro", "expected the intro, got " + dump(normalize(first)));
        // The other engine rebuilds (a live edit): its scope goes, and comes back holding a new value.
        registry->remove("story").defineOwned("story", { numberDecl("act", 2) }, other);
        StepResult second = flow->advance();
        need(second.type == StepType::Text && second.text == "act two", "the flow did not read @story: got " + dump(normalize(second)));
    });

    regCase("refuses a token another engine holds, naming it, and leaves the registry as it was", []
    {
        auto registry = std::make_shared<ScopeRegistry>();
        EngineOptions opts; opts.registry = registry;
        Engine first(orBundle(), opts);
        expectThrow([&] { Engine second(orBundle(), opts); }, "scope '@patter' is already registered by Patter", "a second Patter");

        auto withWorld = std::make_shared<ScopeRegistry>();
        OwnedScopeOptions game; game.owner = "Game";
        withWorld->defineOwned("world", {}, game);
        EngineOptions bound; bound.registry = withWorld;
        auto zero = std::make_shared<PatterValue>(PatterValue::Num(0));
        HostScope scope; scope.get = [zero](const std::string&) { return zero.get(); };
        bound.hostScopes["world"] = scope;
        expectThrow([&] { Engine clash(orBundle(), bound); }, "scope '@world' is already registered by Game", "binding a @world the game holds");
        need(!withWorld->has("patter"), "the half-built engine left @patter behind");
    });

    regCase("escapes a flow id in its keys, so no two flows' keys can meet", []
    {
        RegGame g = makeGame();
        g.patter->openFlow("npc/bob", "s");
        g.patter->openFlow("npc%2Fbob", "s");
        std::vector<std::string> keys;
        for (const auto& k : registryKeys(*g.registry)) if (k.rfind("patter/flow/", 0) == 0) keys.push_back(k);
        need(keys == std::vector<std::string>{ "patter/flow/npc%252Fbob/patter", "patter/flow/npc%252Fbob/scene/s",
            "patter/flow/npc%2Fbob/patter", "patter/flow/npc%2Fbob/scene/s" }, "keys " + joined(keys));
    });

    regCase("removes a flow's bags when it closes, and reopening a name starts it fresh", []
    {
        RegGame g = makeGame();
        playOut(g.patter->openFlow("f", "s"));
        g.patter->closeFlow("f");
        for (const auto& k : registryKeys(*g.registry)) need(k.rfind("patter/flow/f/", 0) != 0, "a closed flow's bag stayed: " + k);
        // Values a load left waiting for "f" belong to the saved flow, not to a new one of the same name.
        ScopeRegistry::SaveBlob blob = g.registry->save();
        for (const auto& kv : blobOf(R"({"patter/flow/f/scene/s":{"count":9}})")) blob.set(kv.first, kv.second);
        g.registry->load(blob);
        Flow* fresh = g.patter->openFlow("f", "s");
        expectNumber(fresh->getProperty("@scene.count"), 0, "a fresh flow's @scene.count");
    });

    regCase("reset drops Patter's waiting values and no other engine's", []
    {
        RegGame g = makeGame();
        ScopeRegistry::SaveBlob blob = g.registry->save();
        for (const auto& kv : blobOf(R"({"patter/scene/elsewhere":{"tally":3},"other/deck/inn":{"drawn":1}})")) blob.set(kv.first, kv.second);
        g.registry->load(blob);
        g.patter->reset();
        ScopeRegistry::SaveBlob saved = g.registry->save();
        need(!saved.get("patter/scene/elsewhere"), "reset kept Patter's waiting values");
        need(saved.get("other/deck/inn") != nullptr, "reset dropped another engine's waiting values");
        expectJson(blobJson(saved).at("other/deck/inn"), R"({"drawn":1})", "the other engine's values");
    });

    regCase("hotSwap hands every bag to the replacement on the same registry", []
    {
        RegGame g = makeGame();
        playOut(g.patter->openFlow("f", "s"));
        std::shared_ptr<Flow> flow = g.patter->flowPtr("f");
        std::unique_ptr<Engine> next = g.patter->hotSwap(orBundle());
        need(flow->isClosed(), "the old engine's flow is still open");
        expectNumber(next->getProperty("@fame"), 1, "@fame");
        need(next->getFlow("f") != nullptr, "the flow did not carry over");
        expectNumber(next->getFlow("f")->getProperty("@mood"), 2, "@mood");
        expectNumber(next->getFlow("f")->getProperty("@scene.tally"), 1, "@scene.tally");
        int patterRows = 0;
        for (const auto& r : g.registry->listProperties()) if (r.scope == "patter") ++patterRows;
        need(patterRows == 1, "@patter rows: " + std::to_string(patterRows));
        need(!next->saveGame().registry.has_value(), "the replacement saves the game's registry");
    });

    regCase("a standalone engine's hotSwap keeps its self-backed @world and keeps saving it", []
    {
        auto patter = standalone(orBundle(), 1);
        playOut(patter->openFlow("f", "s"));
        std::unique_ptr<Engine> next = patter->hotSwap(orBundle());
        expectNumber(next->getProperty("@world.gold"), 5, "@world.gold");
        SaveGame save = next->saveGame();
        need(save.registry.has_value() && save.registry->get("world"), "the replacement stopped saving @world");
        expectJson(blobJson(*save.registry).at("world"), R"({"gold":5})", "the saved @world");
    });

    regCase("a host scope declared writable:false refuses the story, bound or self-backed, and not the game", []
    {
        // The scope-level flag, which the registry reads per scope for a bound (external) scope and the
        // engine folds into each declaration for a self-backed one. A declaration's own flag wins.
        static const Bundle bundle = parseBundle(parseJ(R"JSON({"schema":"patter/bundle@0","locales":{"default":"en","included":["en"]},"strings":{"en":{"T":"hi"}},"properties":[],
          "scopeRegistry":{"version":1,"scopes":[{"token":"rules","writable":false,"declarations":[{"name":"cap","type":"number","default":1},{"name":"open","type":"number","default":0,"writable":true}]}]},
          "scenes":{"s":{"id":"s","gameId":"s","blocks":[{"id":"b","gameId":"b","children":[{"id":"sn","type":"snippet","beats":[{"id":"T","kind":"text"}],
            "onEnter":[{"kind":"set","target":"@rules.open","value":{"src":"5","ast":["n",5]}},{"kind":"set","target":"@rules.cap","value":{"src":"9","ast":["n",9]}}],
            "jump":{"to":"END"}}]}]}}})JSON"));
        for (int pass = 0; pass < 2; ++pass)
        {
            const bool bound = pass == 1;
            const std::string label = bound ? "bound: " : "self-backed: ";
            auto store = std::make_shared<std::map<std::string, PatterValue>>();
            (*store)["cap"] = PatterValue::Num(1); (*store)["open"] = PatterValue::Num(0);
            EngineOptions opts;
            if (bound)
            {
                HostScope scope;
                scope.get = [store](const std::string& n) -> const PatterValue* { auto it = store->find(n); return it == store->end() ? nullptr : &it->second; };
                scope.set = [store](const std::string& n, const PatterValue& v) { (*store)[n] = v; };
                opts.hostScopes["rules"] = scope;
            }
            // The story's refused write is a content error played through: reported, not thrown.
            std::string reported;
            opts.onError = [&reported](const PlayError& e) { reported += e.kind + " on " + e.node + ": " + e.message; };
            Engine engine(bundle, opts);
            engine.openFlow("main", "s", "b");
            need(reported.find("effect on sn: ") == 0 && reported.find("'@rules.cap' is read-only") != std::string::npos,
                label + "the story's write to a read-only scope was not reported (got: " + reported + ")");
            expectNumber(engine.getProperty("@rules.open"), 5, label + "a declaration writable:true inside it");
            expectNumber(engine.getProperty("@rules.cap"), 1, label + "@rules.cap after the refused write");
            engine.setProperty("@rules.cap", PatterValue::Num(3)); // the game's own write
            expectNumber(engine.getProperty("@rules.cap"), 3, label + "@rules.cap after the game's write");
        }
    });

    regCase("refuses a save version it does not read, naming it", []
    {
        auto engine = standalone(envelopeBundle(), 0);
        SaveGame save; save.version = 5;
        expectThrow([&] { engine->loadGame(save); }, "unsupported save version: 5", "a version 5 save");
        save.version = 2;   // version 2 saves no longer load (1.0)
        expectThrow([&] { engine->loadGame(save); }, "unsupported save version: 2", "a version 2 save");
    });
}

// combined-game.test.ts: ONE ScopeRegistry for the whole game, and one save. The game registers @world
// itself (a property the registry stores); a stand-in for the Storylet Engine registers @story the way
// an engine does (the real one is proven beside Patter in the storylets repo); Patter registers the rest.
static void registerStoryStandIn(ScopeRegistry& registry)
{
    OwnedScopeOptions o;
    o.normalise = [](const std::string& n) { return n; };
    o.owner = "Storylet Engine";
    registry.defineOwned("story", { numberDecl("act", 1) }, o);
}

static RegGame combinedGame()
{
    RegGame g;
    g.registry = std::make_shared<ScopeRegistry>();
    OwnedScopeOptions world; world.owner = "Game";
    g.registry->defineOwned("world", { numberDecl("gold"), numberDecl("reputation") }, world);
    registerStoryStandIn(*g.registry);
    EngineOptions opts; opts.registry = g.registry;
    g.patter = std::make_unique<Engine>(combinedBundle(), opts);
    return g;
}

static void runCombinedGameCases()
{
    regCase("combined: both sides read and write one registry live, and each reads the other's scope", []
    {
        RegGame g = combinedGame();
        g.registry->set("world", "gold", PatterValue::Num(25), /*host=*/true); // the game stocks the world
        g.registry->set("story", "act", PatterValue::Num(2));                   // the storylet side moves the story on
        Flow* flow = g.patter->openFlow("main", "shop");
        expectNumber(g.patter->getProperty("@story.act"), 2, "@story.act");
        StepResult line = flow->advance();
        need(line.type == StepType::Line && line.id == "L" && line.character == "MERCHANT", "expected the merchant's line, got " + dump(normalize(line)));
        need(flow->advance().type == StepType::End, "the flow did not end"); // onExit: spends gold, bumps visits
        expectNumber(g.registry->get("world", "gold"), 15, "world.gold");
        expectNumber(g.registry->get("patter", "visits"), 1, "patter.visits");
    });

    regCase("combined: saves the registry once, with every engine's properties, and Patter's save holds none", []
    {
        RegGame g = combinedGame();
        g.registry->set("world", "gold", PatterValue::Num(25), true);
        g.registry->set("world", "reputation", PatterValue::Num(3), true);
        g.registry->set("story", "act", PatterValue::Num(2));
        Flow* f = g.patter->openFlow("main", "shop");
        f->advance(); f->advance();
        JsonValue registry = blobJson(g.registry->save());
        expectJson(registry.at("world"), R"({"gold":15,"reputation":3})", "world");
        expectJson(registry.at("story"), R"({"act":2})", "story");
        expectJson(registry.at("patter"), R"({"visits":1})", "patter");
        need(!g.patter->saveGame().registry.has_value(), "Patter's save carries registry values");
        need(serializeState(*g.patter).find("reputation") == std::string::npos, "Patter's save mentions a world property");
    });

    regCase("combined: resumes both sides from the one save, loading the registry first or last", []
    {
        RegGame g1 = combinedGame();
        g1.registry->set("world", "gold", PatterValue::Num(25), true);
        g1.registry->set("story", "act", PatterValue::Num(2));
        Flow* f1 = g1.patter->openFlow("main", "shop");
        f1->advance(); f1->advance();
        g1.patter->openFlow("main", "shop"); // a fresh run at the gate, saved mid-flow
        const std::string registrySave = saveRegistry(*g1.registry);
        const std::string patterSave = serializeState(*g1.patter);

        for (bool registryFirst : { true, false })
        {
            const std::string order = registryFirst ? "registry first: " : "registry last: ";
            RegGame g2 = combinedGame();
            if (registryFirst) loadRegistry(*g2.registry, registrySave);
            deserializeState(*g2.patter, patterSave);
            if (!registryFirst) loadRegistry(*g2.registry, registrySave);

            expectNumber(g2.patter->getProperty("@world.gold"), 15, order + "@world.gold");
            expectNumber(g2.patter->getProperty("@story.act"), 2, order + "@story.act");
            expectNumber(g2.patter->getProperty("@visits"), 1, order + "@visits");
            // gold(15) >= 10 and act 2: a second purchase proceeds on the restored state.
            Flow* f2 = g2.patter->getFlow("main");
            need(f2 != nullptr, order + "the flow did not come back");
            StepResult line = f2->advance();
            need(line.type == StepType::Line && line.id == "L", order + "expected the line, got " + dump(normalize(line)));
            need(f2->advance().type == StepType::End, order + "the flow did not end");
            expectNumber(g2.registry->get("world", "gold"), 5, order + "world.gold");
            expectNumber(g2.registry->get("patter", "visits"), 2, order + "patter.visits");
        }
    });

    regCase("combined: loads a save forward across content drift (lenient by design)", []
    {
        // A registry save from older content: a world property that no longer exists, none of the newer
        // `reputation`, and a section for an engine this build no longer runs.
        RegGame g = combinedGame();
        g.registry->load(blobOf(R"({"world":{"gold":7,"retired_flag":1},"patter":{"visits":9},"story":{"act":3},"retired_engine":{"x":1}})"));
        expectNumber(g.registry->get("world", "gold"), 7, "known -> restored");
        expectNumber(g.registry->get("world", "reputation"), 0, "newer -> default");
        expectNumber(g.registry->get("world", "retired_flag"), 1, "vanished -> kept as a stray");
        expectNumber(g.patter->getProperty("@visits"), 9, "@visits");
        need(g.registry->save().get("retired_engine") != nullptr, "an unclaimed section was dropped");
        g.registry->discardParked();
        need(g.registry->save().get("retired_engine") == nullptr, "discardParked kept an unclaimed section");
    });

    regCase("combined: a clash between engines fails as the game combines them, naming who holds the token", []
    {
        ScopeRegistry registry;
        registerStoryStandIn(registry);
        expectThrow([&] { registerStoryStandIn(registry); }, "scope '@story' is already registered by Storylet Engine", "a second @story");
    });
}

// save-envelope-shape.test.ts: the save's SHAPE, checked rather than round-tripped. Property values are
// plain name -> value sections keyed by registry key, and games have saves on disk written that way. A
// round-trip cannot tell the difference (a bag that serialised itself would round-trip perfectly and
// still break every save on disk), so this reads the JSON, and loads saves written out by hand, in
// version 4 and in the version 3 games shipped before 1.0. Version 2 is refused.
static std::unique_ptr<Engine> playedEnvelope()
{
    auto engine = standalone(envelopeBundle(), 0);
    playOut(engine->openFlow("f", "s", "b"));
    return engine;
}

static const char* kEnvelopeRegistry =
    R"({"patter":{"gold":7},"patter/flow/f/patter":{},"patter/flow/f/scene/s":{"count":1},"patter/scene/s":{"tally":2}})";

static void runSaveEnvelopeCases()
{
    regCase("save shape: writes every bag as a PLAIN record of bare scalars, under its registry key", []
    {
        JsonValue save = parseJ(serializeState(*playedEnvelope())).at("save");
        // A standalone engine made its own registry, so its values ride in the save. Plain objects: no
        // class, no wrapper, and nothing else beside the values.
        need(save.at("version").num == 4, "version " + dump(save.at("version")));
        expectJson(save.at("registry"), kEnvelopeRegistry, "registry");
        // A flow's snapshot holds no properties: those are the registry's.
        const auto flowKeys = sortedKeys(save.at("flows").at("f"));
        need(flowKeys == std::vector<std::string>{ "cursor", "rngState", "visits" }, "flow keys " + joined(flowKeys));
        const auto keys = sortedKeys(save);
        need(keys == std::vector<std::string>{ "flows", "registry", "sharedSelectors", "sharedVisits", "version" }, "save keys " + joined(keys));
    });

    regCase("save shape: leaves the values out when the game passed the registry: the game saves it once", []
    {
        auto registry = std::make_shared<ScopeRegistry>();
        EngineOptions opts; opts.registry = registry; opts.hasSeed = true; opts.seed = 0;
        Engine engine(envelopeBundle(), opts);
        playOut(engine.openFlow("f", "s", "b"));
        need(!parseJ(serializeState(engine)).at("save").has("registry"), "the envelope carries registry values");
        expectJson(blobJson(registry->save()), dump(parseJ(serializeState(*playedEnvelope())).at("save").at("registry")), "the game's registry");
    });

    regCase("save shape: round-trips through JSON with the values intact", []
    {
        const std::string blob = serializeState(*playedEnvelope());
        auto after = standalone(envelopeBundle(), 0);
        deserializeState(*after, blob);
        expectJson(parseJ(serializeState(*after)), dump(parseJ(blob)), "the re-saved envelope");
    });

    // Written out here rather than produced by saveGame(), so a change that alters the writer and the reader
    // together cannot satisfy it. This is what a player's save looks like on disk: today's (version 4), and
    // one written before 1.0 (version 3), which names the next beat by its index.
    static const std::string kFlowsOnDisk = R"(,"sharedVisits":{"s":1,"b":1,"sn":1},"sharedSelectors":{},"flows":{"f":{"rngState":0,"visits":{"s":1,"b":1,"sn":1},"cursor":{"flowEnded":true,"currentSceneId":"s","stack":[],"activeSnippetId":null,%BEAT%"pendingChoice":null,"pendingPromptOwnerId":null,"selectors":{}}}}}})";
    const auto onDisk = [](int version)
    {
        std::string flows = kFlowsOnDisk;
        flows.replace(flows.find("%BEAT%"), 6, version == 3 ? R"("beatIndex":0,)" : "");
        return std::string(R"({"schema":"patter/save@0","save":{"version":)") + std::to_string(version) + R"(,"registry":)" + kEnvelopeRegistry + flows;
    };

    regCase("save shape: loads a save written by HAND in today's format (version 4)", [onDisk]
    {
        auto engine = standalone(envelopeBundle(), 0);
        deserializeState(*engine, onDisk(4));
        expectNumber(engine->getProperty("@gold"), 7, "@gold");
        need(engine->getFlow("f") != nullptr, "the flow did not come back");
        expectNumber(engine->getFlow("f")->getProperty("@scene.count"), 1, "@scene.count");
        expectNumber(engine->getFlow("f")->getProperty("@scene.tally"), 2, "@scene.tally");
        expectJson(parseJ(serializeState(*engine)), onDisk(4), "the re-saved envelope");
    });

    regCase("save shape: loads a version 3 save written by HAND, and writes it back as version 4", [onDisk]
    {
        auto engine = standalone(envelopeBundle(), 0);
        deserializeState(*engine, onDisk(3));
        expectNumber(engine->getProperty("@gold"), 7, "@gold");
        need(engine->getFlow("f") != nullptr, "the flow did not come back");
        expectNumber(engine->getFlow("f")->getProperty("@scene.count"), 1, "@scene.count");
        expectJson(parseJ(serializeState(*engine)), onDisk(4), "the re-saved envelope");
    });

    // The shape every runtime wrote before the registry held the properties: no longer read (1.0).
    static const char* kV2 = R"({"version":2,"shared":{"patter":{"gold":7}},"sharedVisits":{"s":1,"b":1,"sn":1},"sharedSelectors":{},"stageBags":{"s":{"tally":2}},"flows":{"f":{"scopes":{"patter":{}},"sceneBags":{"s":{"count":1}},"rngState":0,"visits":{"s":1,"b":1,"sn":1},"cursor":{"flowEnded":true,"currentSceneId":"s","stack":[],"activeSnippetId":null,"beatIndex":0,"pendingChoice":null,"pendingPromptOwnerId":null,"selectors":{}}}}})";

    // Everything a load reads is checked BEFORE anything changes. Each of these used to get further: a
    // bare snapshot with no envelope loaded, a version of 3.9 was read as 3, and a save with no flows
    // closed every flow before it was found wanting. Now each is refused and the engine is as it was:
    // the same flow, still open, at the same place, with the same values.
    regCase("save shape: refuses a bare snapshot, a version that is not exactly 3 or 4, and a save with no flows, changing nothing", []
    {
        const std::string wrap = R"({"schema":"patter/save@0","save":)";
        const std::string v3Flows = R"("flows":{"f":{"rngState":0,"visits":{},"cursor":{"flowEnded":true,"currentSceneId":"s","stack":[],"activeSnippetId":null,"beatIndex":0,"pendingChoice":null,"pendingPromptOwnerId":null,"selectors":{}}}})";
        const std::vector<std::pair<std::string, std::string>> refused = {
            { kV2, "loadState: not a patter/save@0 envelope" },
            { wrap + kV2 + "}", "unsupported save version: 2" },
            { wrap + R"({"version":3.9,"registry":{},"sharedVisits":{},"sharedSelectors":{},)" + v3Flows + "}}", "unsupported save version: 3.9" },
            { wrap + R"({"version":"3","registry":{},"sharedVisits":{},"sharedSelectors":{},)" + v3Flows + "}}", "unsupported save version: 3" },
            { wrap + R"({"registry":{},"sharedVisits":{},"sharedSelectors":{},)" + v3Flows + "}}", "unsupported save version: undefined" },
            { wrap + R"({"version":3,"registry":{"patter":{"gold":99}},"sharedVisits":{},"sharedSelectors":{}}})", "malformed save: no flows" },
            { wrap + R"({"version":3,"registry":{"patter":{"gold":99}},"sharedVisits":{},"sharedSelectors":{},"flows":[]}})", "malformed save: no flows" },
        };
        std::string problems; // every refusal checked, so one that slips through does not hide the rest
        for (const auto& c : refused)
        {
            try
            {
                auto engine = standalone(envelopeBundle(), 0);
                Flow* f = engine->openFlow("f", "s");
                playOut(f);
                engine->setProperty("@gold", PatterValue::Num(4));
                const std::string before = serializeState(*engine);
                expectThrow([&] { deserializeState(*engine, c.first); }, c.second, "the save " + c.first);
                need(engine->getFlow("f") == f && !f->isClosed(), "a refused save (" + c.second + ") replaced or closed the open flow");
                expectNumber(engine->getProperty("@gold"), 4, "@gold after a refused save (" + c.second + ")");
                need(serializeState(*engine) == before, "a refused save (" + c.second + ") changed the engine");
            }
            catch (const std::exception& ex) { problems += std::string(problems.empty() ? "" : "\n      ") + ex.what(); }
        }
        need(problems.empty(), problems);
    });
}

// ----- other engines' scopes -------------------------------------------------------------------------
//
// expr/family/engine-scopes.json: a Patter line may name another engine's game-wide scope (`@story.act`)
// with no project setting. The compiler records the tokens it names in the bundle (`externalScopes`),
// never as a scope to self-back; the engine reads and writes them through the game's registry, and
// refuses to open a flow (or load a save) where nobody registered one, before anything changes. A ref
// in that list is a scope even when its engine is gone, so a write after another engine took its scope
// away mid-game fails naming it. Ports of the runtime cases of one-registry.test.ts's "other engines'
// scopes", over the bundles its gate and intro scenes export to (written out by running that test's
// own builders); the compile-only cases belong to the TS compiler, which native runtimes never run.

static int g_extPass = 0, g_extTotal = 0;

static void extCase(const std::string& name, const std::function<void()>& body)
{
    ++g_extTotal;
    try { body(); ++g_extPass; }
    catch (const std::exception& ex) { fail("external-scopes", name, ex.what()); }
}

// The gate: `@story.act >= 2` gates a text line reading `{@story.act}`, and its exit sets
// `@story.act + 1`. Compiled with no scope setting at all.
static const Bundle& gateBundle()
{
    static const Bundle b = parseBundle(parseJ(R"JSON({"schema":"patter/bundle@0","content":{"project":"or","hash":"0m5p8ho","structureHash":"168d7pm"},"voiced":false,"locales":{"default":"en","included":["en"]},"properties":[{"name":"fame","type":"number","default":0,"shared":true},{"name":"mood","type":"number","default":0,"shared":false}],"scenes":{"gate":{"id":"gate","type":"scene","name":"Gate","gameId":"gate","blocks":[{"id":"b","type":"block","name":"B","children":[{"id":"shout","type":"snippet","condition":{"src":"@story.act >= 2","ast":["bin",">=",["sv","story","act"],["n",2]]},"beats":[{"id":"L","kind":"text"}],"onExit":[{"kind":"set","target":"@story.act","value":{"src":"@story.act + 1","ast":["bin","+",["sv","story","act"],["n",1]]}}],"jump":{"to":"END"}}]}]}},"strings":{"en":{"L":"act {@story.act}"}},"externalScopes":["story"]})JSON"));
    return b;
}

/** The refusal, the same on every runtime. */
static const char* kExternalRefusal =
    "this content names @story, which no engine on this registry registered: give every engine the game's one registry";

/** A registry holding a stand-in for the Storylet Engine's `@story`. */
static std::shared_ptr<ScopeRegistry> storyRegistry(double act, std::optional<std::string> owner = std::string("Storylet Engine"))
{
    auto registry = std::make_shared<ScopeRegistry>();
    OwnedScopeOptions story; story.owner = std::move(owner);
    registry->defineOwned("story", { numberDecl("act", act) }, story);
    return registry;
}

static void runExternalScopeCases()
{
    extCase("reads externalScopes from the bundle, and never self-backs one", []
    {
        need(gateBundle().externalScopes == std::vector<std::string>{ "story" }, "externalScopes: " + joined(gateBundle().externalScopes));
        need(!gateBundle().scopeRegistry.present, "the bundle declares a scope registry");
        need(orBundle().externalScopes.empty(), "a bundle that names no other engine has externalScopes " + joined(orBundle().externalScopes));
        auto registry = storyRegistry(1);
        EngineOptions opts; opts.registry = registry;
        Engine patter(gateBundle(), opts);
        patter.openFlow("f", "gate");
        for (const auto& k : registryKeys(*registry))
            need(k == "story" || k.rfind("patter", 0) == 0, "the engine registered a key of another engine's: " + k);
    });

    extCase("reads and writes it through the game's registry", []
    {
        auto registry = storyRegistry(2);
        EngineOptions opts; opts.registry = registry;
        Engine engine(gateBundle(), opts);
        Flow* flow = engine.openFlow("f", "gate");
        StepResult line = flow->advance();
        need(line.type == StepType::Text && line.text == "act 2", "expected the text \"act 2\", got " + dump(normalize(line)));
        need(flow->advance().type == StepType::End, "the flow did not end");
        expectNumber(registry->get("story", "act"), 3, "story.act after the exit");
    });

    extCase("refuses to open a flow, or load a save, where nobody registered it, before anything changes", []
    {
        EngineOptions lone; lone.registry = std::make_shared<ScopeRegistry>();
        Engine alone(gateBundle(), lone);
        expectThrow([&] { alone.openFlow("f", "gate"); }, kExternalRefusal, "the open");
        need(alone.getFlow("f") == nullptr, "the refused open left a flow behind");

        // A save made where the Storylet Engine was present, loaded where it is not: refused whole.
        auto registry = storyRegistry(2);
        EngineOptions gameOpts; gameOpts.registry = registry;
        Engine game(gateBundle(), gameOpts);
        Flow* flow = game.openFlow("f", "gate");
        SaveGame save = game.saveGame();
        auto elsewhere = storyRegistry(1, std::nullopt);
        EngineOptions otherOpts; otherOpts.registry = elsewhere;
        Engine other(gateBundle(), otherOpts);
        other.openFlow("keep", "gate");
        elsewhere->remove("story");
        expectThrow([&] { other.loadGame(save); }, kExternalRefusal, "the load");
        need(other.getFlow("keep") != nullptr && !other.getFlow("keep")->isClosed(), "the refused load closed the flow it had");
        need(other.getFlow("f") == nullptr, "the refused load restored a flow");

        // The engine that took the scope away mid-game: a write names it.
        registry->remove("story");
        expectThrow([&] { flow->setProperty("@story.act", PatterValue::Num(1)); }, "unknown scope '@story'", "a flow's write");
        expectThrow([&] { game.setProperty("@story.act", PatterValue::Num(1)); }, "unknown scope '@story'", "the engine's write");
    });

    extCase("opens once the game has registered it, whatever order it built its engines in", []
    {
        auto registry = std::make_shared<ScopeRegistry>();
        EngineOptions opts; opts.registry = registry;
        Engine engine(gateBundle(), opts);
        // Registered after the engine was built, before any flow opens.
        OwnedScopeOptions story; story.owner = "Storylet Engine";
        registry->defineOwned("story", { numberDecl("act", 2) }, story);
        StepResult line = engine.openFlow("f", "gate")->advance();
        need(line.type == StepType::Text && line.text == "act 2", "expected the text \"act 2\", got " + dump(normalize(line)));
    });

    std::cout << "  [external-scopes] other engines' scopes, read, written, and refused where nobody registered them: " << g_extPass << "/" << g_extTotal << "\n";
}

// ----- flow state -------------------------------------------------------------------------------------
//
// captureFlow / restoreFlow: the host-surface half of the contract the corpus pins (a restored flow carries
// on with its own values). Ports of the JS reference's flow-state.test.ts (packages/runtime/test), over its
// bundle as the JS compiler exports it: what restore refuses and that a refusal leaves nothing behind, a
// state that outlives a save and load, ids that need escaping, the scene bags of scenes the flow has left
// (or hasn't yet re-entered after a load), and the state's JSON shape.

static int g_fsPass = 0, g_fsTotal = 0;

static void fsCase(const std::string& name, const std::function<void()>& body)
{
    ++g_fsTotal;
    try { body(); ++g_fsPass; }
    catch (const std::exception& ex) { fail("flow-state", name, ex.what()); }
}

// `@gold` and `@scene.mine` are both the flow's own; s's onEnter sets them, then jumps to t, which plays
// two lines and jumps back to s.
static const Bundle& flowStateBundle()
{
    static const Bundle b = parseBundle(parseJ(R"JSON({"schema":"patter/bundle@0","content":{"project":"p","hash":"0eutawq","structureHash":"13o8xbf"},"voiced":false,"locales":{"default":"en","included":["en"]},"properties":[{"name":"gold","type":"number","default":0,"shared":false}],"scenes":{"s":{"id":"s","type":"scene","name":"S","gameId":"s","sceneProps":[{"name":"mine","type":"number","default":0,"shared":false}],"blocks":[{"id":"b","type":"block","name":"B","children":[{"id":"sn","type":"snippet","beats":[{"id":"T","kind":"text"}],"onEnter":[{"kind":"set","target":"@scene.mine","value":{"src":"7","ast":["n",7]}},{"kind":"set","target":"@gold","value":{"src":"3","ast":["n",3]}}],"jump":{"to":"t"}}]}]},"t":{"id":"t","type":"scene","name":"T","gameId":"t","blocks":[{"id":"b2","type":"block","name":"B2","children":[{"id":"sn2","type":"snippet","beats":[{"id":"U","kind":"text"},{"id":"U2","kind":"text"}],"jump":{"to":"s"}}]}]}},"strings":{"en":{"T":"mine {@scene.mine}, gold {@gold}","U":"u","U2":"u2"}}})JSON"));
    return b;
}

/** A flow that has been through s (setting its values) and is part-way through t. */
static Flow* inT(Engine& engine, const std::string& id = "f")
{
    Flow* flow = engine.openFlow(id, "s");
    flow->advance();
    flow->advance();
    return flow;
}

/** A state sent through JSON, to prove it is plain data. */
static FlowState viaJson(const FlowState& state) { return deserializeFlowState(serializeFlowState(state)); }

static void expectText(const StepResult& r, const std::string& id, const std::string& text, const std::string& what)
{
    if (r.type != StepType::Text || r.id != id || (!text.empty() && r.text != text))
        throw std::runtime_error(what + ": expected text " + id + (text.empty() ? "" : " \"" + text + "\"") + ", got " + r.id + " \"" + r.text + "\"");
}

static void runFlowStateCases()
{
    fsCase("capture the flow's own values without its id, including a scene it has left, in the save's spelling", []
    {
        auto engine = standalone(flowStateBundle(), 0);
        inT(*engine, "npc/bob");
        const std::string json = serializeFlowState(engine->captureFlow("npc/bob"));
        JsonValue state = parseJ(json);
        need(state.at("version").num == 4, "version " + dump(state.at("version")));
        expectJson(state.at("scopes"), R"({"patter":{"gold":3}})", "scopes");
        expectJson(state.at("sceneBags").at("s"), R"({"mine":7})", "sceneBags.s");
        need(json.find("npc") == std::string::npos, "the state names the flow it was captured from: " + json);
        // The flow's snapshot as a save writes it, plus `version` and the values: nothing else.
        const auto keys = sortedKeys(state);
        need(keys == std::vector<std::string>{ "cursor", "rngState", "sceneBags", "scopes", "version", "visits" }, "state keys " + joined(keys));
    });

    fsCase("restore under another id, escaped or not, and carry on with the flow's own values", []
    {
        for (const std::string id : { "g", "npc/alice", "100%" })
        {
            auto engine = standalone(flowStateBundle(), 0);
            inT(*engine, "npc/bob");
            const FlowState state = viaJson(engine->captureFlow("npc/bob"));
            engine->closeFlow("npc/bob");
            Flow* flow = engine->restoreFlow(id, state);
            need(engine->getFlow(id) == flow, "getFlow('" + id + "') is not the restored flow");
            expectNumber(flow->getProperty("@gold"), 3, "@gold restored under '" + id + "'");
            expectText(flow->advance(), "U2", "", "under '" + id + "', the first advance");
            expectText(flow->advance(), "T", "mine 7, gold 3", "under '" + id + "', back in s");
        }
    });

    fsCase("outlive a save and load, including values parked for a scene the flow hasn't re-entered", []
    {
        auto first = standalone(flowStateBundle(), 0);
        inT(*first);
        auto loaded = standalone(flowStateBundle(), 0);
        deserializeState(*loaded, serializeState(*first));
        const FlowState state = viaJson(loaded->captureFlow("f"));   // s's bag is still parked here
        expectJson(parseJ(serializeFlowState(state)).at("sceneBags").at("s"), R"({"mine":7})", "sceneBags.s, parked");
        loaded->closeFlow("f");
        auto later = standalone(flowStateBundle(), 0);
        deserializeState(*later, serializeState(*loaded));            // a save with no flow in it
        Flow* flow = later->restoreFlow("f", state);
        flow->advance();
        expectText(flow->advance(), "T", "mine 7, gold 3", "back in s after a save and load");
    });

    fsCase("drop what a load left waiting under the id, as a fresh start does", []
    {
        auto first = standalone(flowStateBundle(), 0);
        inT(*first);
        auto loaded = standalone(flowStateBundle(), 0);
        deserializeState(*loaded, serializeState(*first));            // f's bag for s is parked, waiting for it to re-enter
        loaded->closeFlow("f");
        auto elsewhere = standalone(flowStateBundle(), 0);
        elsewhere->openFlow("g", "t");                                 // never been in s
        const FlowState state = viaJson(elsewhere->captureFlow("g"));
        loaded->restoreFlow("f", state);
        need(!loaded->captureFlow("f").sceneBags.count("s"), "the restored flow inherited the closed flow's parked bag for s");
    });

    // A state with no cursor is refused as it is read, before anything changes (the case below), so what
    // fails a restore here is a bag that can't register: the game's registry already holds the key the
    // restored flow's bag for t needs.
    fsCase("leave nothing behind when a state won't restore", []
    {
        auto source = standalone(flowStateBundle(), 0);
        inT(*source);
        const FlowState state = viaJson(source->captureFlow("f"));
        auto registry = std::make_shared<ScopeRegistry>();
        OwnedScopeOptions game;
        game.owner = "Game";
        registry->defineOwned(registrykeys::flowScene("f", "t"), {}, game);
        EngineOptions opts; opts.registry = registry; opts.hasSeed = true; opts.seed = 0;
        Engine engine(flowStateBundle(), opts);
        const std::string before = serializeState(engine);
        const std::string registryBefore = dump(blobJson(registry->save()));
        expectThrow([&] { engine.restoreFlow("f", state); }, "patter/flow/f/scene/t", "restoring where its bag can't register");
        need(engine.getFlow("f") == nullptr, "a failed restore left a flow 'f'");
        need(serializeState(engine) == before, "a failed restore changed the engine");
        need(dump(blobJson(registry->save())) == registryBefore, "a failed restore left values behind: " + dump(blobJson(registry->save())));
        registry->remove(registrykeys::flowScene("f", "t"));
        Flow* flow = engine.restoreFlow("f", state);
        expectText(flow->advance(), "U2", "", "the same state, restored once the key is free");
    });

    fsCase("refuse an unknown capture, an open id, a checkpoint, an unknown version, and no cursor, leaving nothing behind", []
    {
        auto engine = standalone(flowStateBundle(), 0);
        expectThrow([&] { engine->captureFlow("nope"); }, "no open flow 'nope'", "capturing an id that is not open");
        inT(*engine);
        const FlowState state = viaJson(engine->captureFlow("f"));
        const std::string before = serializeState(*engine);
        expectThrow([&] { engine->restoreFlow("f", state); }, "already open", "restoring over an open id");
        Checkpoint cp = engine->checkpoint();
        expectThrow([&] { engine->restoreFlow("g", state); }, "checkpoint", "restoring inside a checkpoint");
        need(serializeFlowState(engine->captureFlow("f")) == serializeFlowState(state), "capturing inside a checkpoint gave another state");
        engine->commit(cp);
        FlowState unknown = state;
        unknown.version = 99;
        expectThrow([&] { engine->restoreFlow("g", unknown); }, "unsupported flow state version: 99", "restoring version 99");
        unknown.version = 2;   // version 2 no longer restores (1.0)
        expectThrow([&] { engine->restoreFlow("g", unknown); }, "unsupported flow state version: 2", "restoring version 2");
        // A version read from JSON is checked as a save's is: 3.9 is refused, not read as 3.
        std::string json = serializeFlowState(state);
        json.replace(json.find("\"version\":4"), 11, "\"version\":3.9");
        expectThrow([&] { deserializeFlowState(json); }, "unsupported flow state version: 3.9", "reading version 3.9");
        // A state with no cursor, or one that isn't an object, is refused.
        JsonValue noCursor = parseJ(serializeFlowState(state));
        noCursor.obj.erase(std::remove_if(noCursor.obj.begin(), noCursor.obj.end(),
            [](const auto& kv) { return kv.first == "cursor"; }), noCursor.obj.end());
        expectThrow([&] { engine->restoreFlow("g", deserializeFlowState(dump(noCursor))); }, "malformed flow state: no cursor", "restoring with no cursor");
        noCursor.set("cursor", JsonValue());
        expectThrow([&] { engine->restoreFlow("g", deserializeFlowState(dump(noCursor))); }, "malformed flow state: no cursor", "restoring with a null cursor");
        need(serializeState(*engine) == before, "a refused restore changed the engine");
        need(engine->getFlow("g") == nullptr, "a refused restore left a flow 'g'");
    });

    std::cout << "  [flow-state] flows captured as data, restored under any id, and refused where they must be: " << g_fsPass << "/" << g_fsTotal << "\n";
}

// ----- runner -----------------------------------------------------------------------------------------
//
// The thin runner (Patter/Runner.h): the flow API turned from pull to push. Ports of the JS reference's
// runner.test.ts (packages/play-helpers/test), over its bundle as the JS compiler exports it: each
// delivered beat waits for next(), a choice for choose(), and the end raises ended; handlers that call
// next() themselves don't deepen the stack; stop() drops what was asked for and leaves the flow where it
// is; a later begin(scene) moves the same flow, keeping the playthrough; rebind() plays on after a hot swap.

static int g_runPass = 0, g_runTotal = 0;

static void runCase(const std::string& name, const std::function<void()>& body)
{
    ++g_runTotal;
    try { body(); ++g_runPass; }
    catch (const std::exception& ex) { fail("runner", name, ex.what()); }
}

// talk: a line, a text and a game event, then a choice of two options, each a line and the end. shop: one
// line and the end.
static const Bundle& runnerBundle()
{
    static const Bundle b = parseBundle(parseJ(R"JSON({"schema":"patter/bundle@0","content":{"project":"run","hash":"1mn9ico","structureHash":"1bg0cg5"},"voiced":false,"locales":{"default":"en","included":["en"]},"cast":[{"name":"NPC"}],"scenes":{"talk":{"id":"talk","type":"scene","name":"Talk","blocks":[{"id":"b1","type":"block","name":"B1","children":[{"id":"sn1","type":"snippet","beats":[{"id":"L1","kind":"line","character":"NPC"},{"id":"T1","kind":"text","action":true},{"id":"E1","kind":"gameEvent"}]},{"id":"grp","type":"group","selector":"choice","children":[{"id":"opt_a","type":"group","children":[{"id":"sn_a","type":"snippet","beats":[{"id":"L_a","kind":"line","character":"NPC"}],"jump":{"to":"END"}}],"prompt":{"id":"C_a","kind":"text"}},{"id":"opt_b","type":"group","children":[{"id":"sn_b","type":"snippet","beats":[{"id":"L_b","kind":"line","character":"NPC"}],"jump":{"to":"END"}}],"prompt":{"id":"C_b","kind":"text"}}]}]}]},"shop":{"id":"shop","type":"scene","name":"Shop","blocks":[{"id":"b2","type":"block","name":"B2","children":[{"id":"sn_s","type":"snippet","beats":[{"id":"L_s","kind":"line","character":"NPC"}],"jump":{"to":"END"}}]}]}},"strings":{"en":{"L1":"Hello.","T1":"A door creaks.","C_a":"Ask.","C_b":"Leave.","L_a":"Asked.","L_b":"Bye.","L_s":"Welcome."}}})JSON"));
    return b;
}

/** A runner whose every event is written down as kind:id. */
struct Recorded
{
    std::unique_ptr<Engine> engine = standalone(runnerBundle(), 0);
    Runner runner{*engine};
    std::vector<std::string> seen;
    Recorded()
    {
        runner.onLine([this](const StepResult& s) { seen.push_back("line:" + s.id); });
        runner.onText([this](const StepResult& s) { seen.push_back("text:" + s.id); });
        runner.onGameEvent([this](const StepResult& s) { seen.push_back("gameEvent:" + s.id); });
        runner.onChoice([this](const RunnerChoice& c)
        {
            std::string ids;
            for (const ChoiceOption& o : c.options) ids += (ids.empty() ? "" : ",") + o.id;
            seen.push_back("choice:" + ids);
        });
        runner.onEnded([this] { seen.push_back("ended"); });
    }
    std::string last() const { return seen.empty() ? std::string() : seen.back(); }
};

static void expectSeen(const std::vector<std::string>& got, const std::vector<std::string>& want, const std::string& what)
{
    if (got != want) throw std::runtime_error(what + ": expected [" + joined(want) + "], got [" + joined(got) + "]");
}

static void runRunnerCases()
{
    runCase("delivers one beat per next(), a game event included, then the choice, then the end", []
    {
        Recorded r;
        r.runner.begin("talk");
        expectSeen(r.seen, {"line:L1"}, "after start");
        r.runner.next();
        r.runner.next();
        expectSeen(r.seen, {"line:L1", "text:T1", "gameEvent:E1"}, "after two next()s");
        r.runner.next();
        need(r.last() == "choice:opt_a,opt_b", "expected the choice, got " + r.last());
        r.runner.choose("opt_b");
        need(r.last() == "line:L_b", "expected line:L_b after choosing, got " + r.last());
        r.runner.next();
        need(r.last() == "ended", "expected ended, got " + r.last());
    });

    runCase("hands each event the step itself", []
    {
        auto engine = standalone(runnerBundle(), 0);
        Runner runner(*engine);
        std::string text;
        runner.onLine([&](const StepResult& s) { text = s.speakerLabel + ": " + s.text; });
        runner.begin("talk");
        need(text == "NPC: Hello.", "expected \"NPC: Hello.\", got \"" + text + "\"");
    });

    runCase("starts at the first scene with no address", []
    {
        Recorded r;
        r.runner.begin();
        expectSeen(r.seen, {"line:L1"}, "after begin()");
    });

    runCase("plays a whole run from handlers that call next() themselves, without deepening the stack", []
    {
        auto engine = standalone(runnerBundle(), 0);
        Runner runner(*engine);
        std::vector<std::string> seen;
        int depth = 0, deepest = 0;
        const auto step = [&](const StepResult& s) { ++depth; deepest = std::max(deepest, depth); seen.push_back(s.id); runner.next(); --depth; };
        runner.onLine(step);
        runner.onText(step);
        runner.onGameEvent(step);
        runner.onChoice([&](const RunnerChoice&) { runner.choose("opt_a"); });
        runner.onEnded([&] { seen.push_back("ended"); });
        runner.begin("talk");
        expectSeen(seen, {"L1", "T1", "E1", "L_a", "ended"}, "the run");
        need(deepest == 1, "handlers nested " + std::to_string(deepest) + " deep");
    });

    runCase("stop() drops a next() a handler asked for and leaves the flow where it is, unended", []
    {
        auto engine = standalone(runnerBundle(), 0);
        Runner runner(*engine);
        std::vector<std::string> seen;
        runner.onLine([&](const StepResult& s) { seen.push_back(s.id); runner.next(); runner.stop(); });
        runner.onText([&](const StepResult& s) { seen.push_back(s.id); });
        runner.onEnded([&] { seen.push_back("ended"); });
        runner.begin("talk");
        expectSeen(seen, {"L1"}, "after start");
        need(runner.flow() && !runner.flow()->isEnded(), "the flow ended");
        runner.next();
        expectSeen(seen, {"L1", "T1"}, "after next()");
    });

    runCase("a later begin(scene) moves the same flow, keeping its visit counts", []
    {
        Recorded r;
        r.runner.begin("talk");
        Flow* flow = r.engine->getFlow("main");
        r.runner.begin("shop");
        need(r.engine->getFlow("main") == flow, "begin(\"shop\") opened another flow");
        need(r.last() == "line:L_s", "expected line:L_s, got " + r.last());
        auto it = flow->getVisitCounts().find("talk");
        need(it != flow->getVisitCounts().end() && it->second == 1, "talk's visit count was lost");
    });

    runCase("begin() on an open flow begins the story again", []
    {
        Recorded r;
        r.runner.begin("shop");
        r.runner.begin();
        expectSeen(r.seen, {"line:L_s", "line:L1"}, "after begin(\"shop\") then begin()");
    });

    runCase("refuses an address that doesn't resolve, and leaves the flow as it was", []
    {
        Recorded r;
        r.runner.begin("talk");
        expectThrow([&] { r.runner.begin("nowhere"); }, "address not found", "begin(\"nowhere\")");
        r.runner.next();
        expectSeen(r.seen, {"line:L1", "text:T1"}, "after the refusal and next()");
    });

    runCase("refuses a block without its scene on an open flow", []
    {
        Recorded r;
        r.runner.begin("talk");
        expectThrow([&] { r.runner.begin("", "b1"); }, "a block needs its scene", "begin(\"\", \"b1\")");
    });

    runCase("refuses next() and choose() before begin()", []
    {
        auto engine = standalone(runnerBundle(), 0);
        Runner runner(*engine);
        expectThrow([&] { runner.next(); }, "begin() first", "next() before begin()");
        expectThrow([&] { runner.choose("opt_a"); }, "begin() first", "choose() before begin()");
    });

    runCase("carries on after a load with next(), and after a hot swap once rebound", []
    {
        Recorded r;
        r.runner.begin("talk");
        r.runner.next();
        const SaveGame save = r.engine->saveGame();
        r.runner.next();
        r.engine->loadGame(save);
        r.runner.next();
        need(r.last() == "gameEvent:E1", "after the load, expected gameEvent:E1, got " + r.last());

        std::unique_ptr<Engine> swapped = r.engine->hotSwap(runnerBundle());
        r.runner.rebind(*swapped);
        r.runner.next();
        need(r.last() == "choice:opt_a,opt_b", "after the hot swap, expected the choice, got " + r.last());
    });

    runCase("stops listening when asked", []
    {
        auto engine = standalone(runnerBundle(), 0);
        Runner runner(*engine);
        std::vector<std::string> seen;
        const Runner::Subscription ticket = runner.onLine([&](const StepResult& s) { seen.push_back(s.id); });
        runner.off(ticket);
        runner.begin("talk");
        expectSeen(seen, {}, "after off()");
    });

    std::cout << "  [runner] the thin runner: beats pushed as events, next() and choose() queued, stop(), begin() moving the flow, rebind(): " << g_runPass << "/" << g_runTotal << "\n";
}

static void runOneRegistry()
{
    runOneRegistryCases();
    runCombinedGameCases();
    runSaveEnvelopeCases();
    std::cout << "  [one-registry] the game's registry, one save, loaded in either order: " << g_regPass << "/" << g_regTotal << "\n";
    runExternalScopeCases();
}

// Content errors play through (PlayError): a condition that fails counts as false, an effect that fails
// is skipped and the rest of its list runs, a Best-match part that fails scores as false, and each is
// REPORTED, to EngineOptions::onError and (log on) as a `diagnostic` entry. The corpus pins what plays;
// it cannot see a report, so the reports are pinned here: kind, node, source, and message, the flow, the
// log entry's shape, and that a skipped effect leaves no `write` entry.
static int g_playErrPass = 0, g_playErrTotal = 0;

static void playErrCase(const std::string& name, const std::function<void()>& body)
{
    ++g_playErrTotal;
    try { body(); ++g_playErrPass; }
    catch (const std::exception& ex) { fail("play-errors", name, ex.what()); }
}

static std::string describeErrors(const std::vector<PlayError>& errors)
{
    std::string out;
    for (const auto& e : errors)
        out += (out.empty() ? "" : "; ") + e.flow + "/" + e.kind + "/" + e.node + "/" + e.source + "/" + e.message;
    return out.empty() ? "none" : out;
}

static void runPlayErrorCases()
{
    // One scene: its onEntry fails, a snippet's effects fail in the middle of the list, a branch child's
    // condition fails, an option's condition fails, and a Best-match part fails while being scored.
    static const Bundle bundle = parseBundle(parseJ(R"JSON({"schema":"patter/bundle@0","locales":{"default":"en","included":["en"]},
      "strings":{"en":{"T_vals":"a={@a} c={@c} d={@d}","T_bad":"bad","T_ok":"ok","O1":"one","O2":"two","X":"x","Y":"y"}},
      "properties":[{"name":"zero","type":"number","default":0},{"name":"a","type":"number","default":0},{"name":"c","type":"number","default":0},{"name":"d","type":"number","default":0},{"name":"e","type":"number","default":0}],
      "scenes":{"s":{"id":"s","type":"scene","name":"S","onEntry":[{"kind":"set","target":"@e","value":{"src":"1 / @zero","ast":["bin","/",["n",1],["sv","patter","zero"]]}}],
        "blocks":[{"id":"b","type":"block","name":"B","children":[
          {"id":"sn_set","type":"snippet","beats":[{"id":"T_vals","kind":"text"}],"onEnter":[
            {"kind":"set","target":"@a","value":{"src":"1","ast":["n",1]}},
            {"kind":"set","target":"@c","value":{"src":"10 / @zero","ast":["bin","/",["n",10],["sv","patter","zero"]]}},
            {"kind":"set","target":"@d","value":{"src":"1","ast":["n",1]}}]},
          {"id":"g_br","type":"group","selector":"branch","children":[
            {"id":"sn_bad","type":"snippet","condition":{"src":"10 / @zero > 1","ast":["bin",">",["bin","/",["n",10],["sv","patter","zero"]],["n",1]]},"beats":[{"id":"T_bad","kind":"text"}]},
            {"id":"sn_ok","type":"snippet","beats":[{"id":"T_ok","kind":"text"}]}]},
          {"id":"g_ch","type":"group","selector":"choice","children":[
            {"id":"sn_o1","type":"snippet","condition":{"src":"5 / @zero > 1","ast":["bin",">",["bin","/",["n",5],["sv","patter","zero"]],["n",1]]},"beats":[{"id":"O1","kind":"text"}]},
            {"id":"sn_o2","type":"snippet","beats":[{"id":"O2","kind":"text"}]}]},
          {"id":"g_bm","type":"group","selector":"sequence","options":{"order":"specificity","exhaust":"repeat"},"children":[
            {"id":"sn_x","type":"snippet","condition":{"src":"@zero == 0 or 10 / @zero > 2","ast":["bin","or",["bin","==",["sv","patter","zero"],["n",0]],["bin",">",["bin","/",["n",10],["sv","patter","zero"]],["n",2]]]},"beats":[{"id":"X","kind":"text"}]},
            {"id":"sn_y","type":"snippet","condition":{"src":"@a == 1 and @d == 1","ast":["bin","and",["bin","==",["sv","patter","a"],["n",1]],["bin","==",["sv","patter","d"],["n",1]]]},"beats":[{"id":"Y","kind":"text"}]}]},
          {"id":"sn_end","type":"snippet","jump":{"to":"END"}}]}]}}})JSON"));

    // Play the whole scene, taking the one takeable option, and return what the engine reported.
    const auto play = [](Engine& engine, std::vector<std::string>& transcript)
    {
        Flow* flow = engine.openFlow("main", "s");
        for (int i = 0; i < 20; ++i)
        {
            StepResult step = flow->advance();
            if (step.type == StepType::End) break;
            if (step.type == StepType::Choice) { transcript.push_back("choice"); flow->choose("sn_o2"); continue; }
            transcript.push_back(step.text);
        }
    };

    playErrCase("each failure is reported through onError with its kind, node, source, message, and flow", [&]
    {
        std::vector<PlayError> errors;
        EngineOptions opts; opts.onError = [&errors](const PlayError& e) { errors.push_back(e); };
        Engine engine(bundle, opts);
        std::vector<std::string> transcript;
        play(engine, transcript);
        need(joined(transcript) == "[a=1 c=0 d=1, ok, choice, two, y]", "the scene did not play through its errors: " + joined(transcript));
        const std::vector<std::vector<std::string>> want = {
            { "effect", "s", "1 / @zero" },              // the scene's onEntry: its owner is the scene
            { "effect", "sn_set", "10 / @zero" },        // the middle of the snippet's list; @d after it still landed
            { "condition", "sn_bad", "10 / @zero > 1" }, // a branch child: counted false, sn_ok played
            { "condition", "sn_o1", "5 / @zero > 1" },   // an option: greyed out, sn_o2 offered
            { "best-match", "sn_x", "@zero == 0 or 10 / @zero > 2" }, // the `or` branch eligibility never evaluated
        };
        need(errors.size() == want.size(), "expected " + std::to_string(want.size()) + " reports, got " + describeErrors(errors));
        for (size_t i = 0; i < want.size(); ++i)
        {
            const PlayError& e = errors[i];
            if (e.flow != "main" || e.kind != want[i][0] || e.node != want[i][1] || e.source != want[i][2] || e.message != "division by zero")
                throw std::runtime_error("report " + std::to_string(i) + " is wrong: " + describeErrors(errors));
        }
    });

    playErrCase("with the log on, each failure is a diagnostic entry, and a skipped effect leaves no write entry", [&]
    {
        std::vector<PlayError> errors;
        EngineOptions opts; opts.log = true; opts.onError = [&errors](const PlayError& e) { errors.push_back(e); };
        Engine engine(bundle, opts);
        std::vector<std::string> transcript;
        play(engine, transcript);
        std::vector<const LogEntry*> diagnostics;
        std::vector<std::string> writes;
        for (const LogEntry& e : engine.log())
        {
            if (e.type == "diagnostic") diagnostics.push_back(&e);
            if (e.type == "write") writes.push_back(e.target);
        }
        need(diagnostics.size() == errors.size() && !errors.empty(),
            "expected one diagnostic entry per report (" + std::to_string(errors.size()) + "), got " + std::to_string(diagnostics.size()));
        for (size_t i = 0; i < errors.size(); ++i)
        {
            const LogEntry& d = *diagnostics[i];
            if (d.kind != errors[i].kind || d.node != errors[i].node || d.source != errors[i].source || d.message != errors[i].message
                || d.flow != "main" || d.scene != "s")
                throw std::runtime_error("diagnostic " + std::to_string(i) + " does not match its report: kind=" + d.kind + " node=" + d.node
                    + " source=" + d.source + " message=" + d.message + " flow=" + d.flow);
        }
        // Only the two effects that landed are writes: @a and @d. Not @c, and not the scene's @e.
        need(joined(writes) == "[@a, @d]", "the write entries should be @a and @d only, got " + joined(writes));
        // The flow's own log carries the same diagnostics.
        int own = 0;
        for (const LogEntry& e : engine.getFlow("main")->log()) if (e.type == "diagnostic") ++own;
        need(own == static_cast<int>(errors.size()), "the flow's own log has " + std::to_string(own) + " diagnostics");
    });

    playErrCase("with no onError set, the core plays through silently, and the log still records each", [&]
    {
        EngineOptions opts; opts.log = true;
        Engine engine(bundle, opts);
        std::vector<std::string> transcript;
        play(engine, transcript); // must not throw
        need(joined(transcript) == "[a=1 c=0 d=1, ok, choice, two, y]", "the scene did not play through: " + joined(transcript));
        int diagnostics = 0;
        for (const LogEntry& e : engine.log()) if (e.type == "diagnostic") ++diagnostics;
        need(diagnostics == 5, "expected 5 diagnostic entries, got " + std::to_string(diagnostics));
    });

    playErrCase("a story write to a read-only @world is an effect error naming the value, and the list goes on", []
    {
        static const Bundle b = parseBundle(parseJ(R"JSON({"schema":"patter/bundle@0","locales":{"default":"en","included":["en"]},"strings":{"en":{"T":"hi"}},
          "properties":[{"name":"after","type":"number","default":0}],
          "scopeRegistry":{"version":1,"scopes":[{"token":"world","declarations":[{"name":"clock","type":"string","default":"day","writable":false}]}]},
          "scenes":{"s":{"id":"s","gameId":"s","blocks":[{"id":"b","gameId":"b","children":[{"id":"sn","type":"snippet","beats":[{"id":"T","kind":"text"}],
            "onExit":[{"kind":"set","target":"@world.clock","value":{"src":"\"night\"","ast":["s","night"]}},{"kind":"set","target":"@after","value":{"src":"2","ast":["n",2]}}],
            "jump":{"to":"END"}}]}]}}})JSON"));
        std::vector<PlayError> errors;
        EngineOptions opts; opts.log = true; opts.onError = [&errors](const PlayError& e) { errors.push_back(e); };
        Engine engine(b, opts);
        playOut(engine.openFlow("door", "s"));
        need(errors.size() == 1 && errors[0].flow == "door" && errors[0].kind == "effect" && errors[0].node == "sn"
            && errors[0].source == "\"night\"" && errors[0].message.find("'@world.clock' is read-only") != std::string::npos,
            "the refused write was reported as " + describeErrors(errors));
        expectNumber(engine.getProperty("@after"), 2, "@after, the effect after the refused one");
        const PatterValue* clock = engine.getProperty("@world.clock");
        need(clock && clock->s == "day", "the refused write changed @world.clock");
        for (const LogEntry& e : engine.log())
            need(!(e.type == "write" && e.target == "@world.clock"), "a refused write left a write entry");
    });

    std::cout << "  [play-errors] content errors played through and reported: " << g_playErrPass << "/" << g_playErrTotal << "\n";
}

// A choice that runs dry and ENDS the flow is reported, never thrown (Ian's rulings on choices that run dry,
// 2026-10-30): onError gets a `dry-choice` naming the group, once, and the End step's reason is RanDry. The
// corpus pins the transcript and the report; these mirror the JS tests (sticky-fallback.test.ts) and add the
// checkpoint rollback, which no corpus case reaches.
static int g_dryPass = 0, g_dryTotal = 0;

static void dryCase(const std::string& name, const std::function<void()>& body)
{
    ++g_dryTotal;
    try { body(); ++g_dryPass; }
    catch (const std::exception& ex) { fail("dry-choice", name, ex.what()); }
}

static void runDryChoiceCases()
{
    // The hub: one once-only option that comes back. `after` follows the choice in the hub block.
    const auto hub = [](const std::string& after)
    {
        return parseBundle(parseJ(std::string(R"JSON({"schema":"patter/bundle@0","locales":{"default":"en","included":["en"]},
      "strings":{"en":{"P":"Ask","ANS":"answered","ON":"carried on"}},
      "scenes":{"s":{"id":"s","type":"scene","name":"S","gameId":"s","blocks":[{"id":"hub","type":"block","name":"Hub","gameId":"hub","children":[
        {"id":"g","type":"group","selector":"choice","children":[
          {"id":"ask","type":"group","prompt":{"id":"P","kind":"text"},"children":[
            {"id":"sn_ans","type":"snippet","beats":[{"id":"ANS","kind":"text"}],"jump":{"to":"hub"}}]}]})JSON") + after + "]}]}}}"));
    };
    static const Bundle plain = hub("");
    static const Bundle toEnd = hub(R"(,{"id":"fin","type":"snippet","jump":{"to":"END"}})");
    static const Bundle carriesOn = hub(R"(,{"id":"on","type":"snippet","beats":[{"id":"ON","kind":"text"}]})");

    struct Played { std::unique_ptr<Engine> engine; Flow* flow; std::shared_ptr<std::vector<PlayError>> errors; };
    // Offered the choice, take the option, hear the answer: back at the hub, the option used.
    const auto play = [](const Bundle& bundle)
    {
        Played p;
        p.errors = std::make_shared<std::vector<PlayError>>();
        EngineOptions opts; auto errors = p.errors;
        opts.onError = [errors](const PlayError& e) { errors->push_back(e); };
        p.engine = std::make_unique<Engine>(bundle, opts);
        p.flow = p.engine->openFlow("f", "s");
        need(p.flow->advance().type == StepType::Choice, "the hub was not offered");
        p.flow->choose("ask");
        need(p.flow->advance().id == "ANS", "the answer did not play");
        return p;
    };
    const auto kinds = [](const std::vector<PlayError>& errors)
    {
        std::string out;
        for (const auto& e : errors) out += (out.empty() ? "" : ",") + e.kind + "/" + e.node + "/" + e.flow;
        return out;
    };
    const auto isEnd = [](const StepResult& r, EndReason why) { return r.type == StepType::End && r.reason == why; };

    dryCase("reports it through onError once, and ends with reason RanDry", [&]
    {
        Played p = play(plain);
        need(isEnd(p.flow->advance(), EndReason::RanDry), "the end did not say it ran dry");
        need(kinds(*p.errors) == "dry-choice/g/f", "reports: " + kinds(*p.errors));
        need(p.errors->front().message == "choice 'g' ran dry (no option left to take, and no fallback) with nothing after it, so the flow ended there",
             "message: " + p.errors->front().message);
        need(isEnd(p.flow->advance(), EndReason::RanDry), "asked again, the end changed");
        need(p.errors->size() == 1, "asked again, it was reported again: " + kinds(*p.errors));
    });
    dryCase("an END straight after the dry choice still ends because it ran dry", [&]
    {
        Played p = play(toEnd);
        need(isEnd(p.flow->advance(), EndReason::RanDry), "the end did not say it ran dry");
        need(kinds(*p.errors) == "dry-choice/g/f", "reports: " + kinds(*p.errors));
    });
    dryCase("is silent when play carries on after it: the gather idiom", [&]
    {
        Played p = play(carriesOn);
        need(p.flow->advance().id == "ON", "play did not carry on");
        need(isEnd(p.flow->advance(), EndReason::Ended), "the end was not plain");
        need(p.errors->empty(), "reports: " + kinds(*p.errors));
    });
    dryCase("keeps the reason across a save and load, without reporting it again", [&]
    {
        Played p = play(plain);
        p.flow->advance();
        const std::string json = serializeState(*p.engine);
        need(json.find("\"ranDry\":\"g\"") != std::string::npos, "the save has no ranDry: " + json);
        std::vector<PlayError> errors;
        EngineOptions opts; opts.onError = [&errors](const PlayError& e) { errors.push_back(e); };
        Engine again(plain, opts);
        deserializeState(again, json);
        need(isEnd(again.getFlow("f")->advance(), EndReason::RanDry), "the loaded flow's end did not say it ran dry");
        need(errors.empty(), "the load reported: " + kinds(errors));
        // Written only when set: a plain end's save has none.
        Played q = play(carriesOn);
        q.flow->advance(); q.flow->advance();
        need(serializeState(*q.engine).find("ranDry") == std::string::npos, "a plain end's save carries ranDry");
    });
    dryCase("is plain Ended once the host ends it, and a goto that revives it runs dry again", [&]
    {
        Played p = play(plain);
        p.flow->advance();
        p.flow->gotoAddress("END");
        need(isEnd(p.flow->advance(), EndReason::Ended), "goto END did not make it a plain end");
        Played b = play(plain);
        b.flow->advance();
        b.flow->gotoAddress("s"); // an ended flow resumes; the choice is dry again, so it ends the same way, reported again
        need(isEnd(b.flow->advance(), EndReason::RanDry), "the revived flow's end did not say it ran dry");
        need(kinds(*b.errors) == "dry-choice/g/f,dry-choice/g/f", "reports: " + kinds(*b.errors));
        Played c = play(plain);
        c.flow->advance();
        c.flow->reset();
        need(c.flow->advance().type == StepType::Choice, "the reset flow was not offered the hub");
    });
    dryCase("a closed flow's advance is a plain end", [&]
    {
        Played p = play(plain);
        p.flow->advance();
        std::shared_ptr<Flow> held = p.engine->flowPtr("f"); // a stale reference the game kept
        p.engine->closeFlow("f");
        need(isEnd(held->advance(), EndReason::Ended), "a closed flow's end was not plain");
    });
    dryCase("a rollback puts the dry choice and the reason back with the rest of the cursor", [&]
    {
        Played p = play(plain);
        Checkpoint cp = p.engine->checkpoint();
        need(isEnd(p.flow->advance(), EndReason::RanDry), "the end did not say it ran dry");
        p.engine->rollback(cp);
        // Back before the end: the dry choice hasn't been met, so the end is met and reported again.
        need(isEnd(p.flow->advance(), EndReason::RanDry), "after the rollback, the end did not say it ran dry");
        need(p.errors->size() == 2, "reports: " + kinds(*p.errors));
        Checkpoint cp2 = p.engine->checkpoint();
        p.flow->gotoAddress("END");
        need(isEnd(p.flow->advance(), EndReason::Ended), "goto END did not make it a plain end");
        p.engine->rollback(cp2);
        need(isEnd(p.flow->advance(), EndReason::RanDry), "the rollback did not put the reason back");
        need(p.errors->size() == 2, "the restored reason was reported again: " + kinds(*p.errors));
    });
    std::cout << "  [dry-choice] a choice that runs dry and ends the flow, reported once, its end RanDry: " << g_dryPass << "/" << g_dryTotal << "\n";
}

// The one address rule, on the engine's lookups: a block address given with a scene resolves WITHIN that
// scene only (its gameId there, then the internal id of a block in it), so a real block of another scene
// gives nothing; with no scene, a block resolves by internal id. The corpus pins openFlow and goto; these
// lookups answer no transcript, so they are pinned here.
static void runAddressLookupCases()
{
    static const Bundle b = parseBundle(parseJ(R"JSON({"schema":"patter/bundle@0","locales":{"default":"en","included":["en"]},"strings":{"en":{"K":"k","G":"g"}},
      "scenes":{"scn_cellar":{"id":"scn_cellar","type":"scene","name":"Kitchen","tags":["indoor"],"blocks":[{"id":"b_k","type":"block","name":"Stove","tags":["hot"],"gameData":{"heat":3},
          "children":[{"id":"sn_k","type":"snippet","beats":[{"id":"K","kind":"text"}],"jump":{"to":"END"}}]}]},
        "kitchen":{"id":"kitchen","type":"scene","name":"Garden","tags":["outdoor"],"blocks":[{"id":"b_g","type":"block","name":"Bench","tags":["seat"],
          "children":[{"id":"sn_g","type":"snippet","beats":[{"id":"G","kind":"text"}],"jump":{"to":"END"}}]}]}}})JSON"));
    Engine engine(b);
    const auto tags = [&](const std::string& scene, const std::string& block) { return joined(engine.tagsForBlock(scene, block)); };
    std::string problems;
    const auto check = [&problems](bool ok, const std::string& what) { if (!ok) problems += (problems.empty() ? "" : "; ") + what; };
    // "kitchen" is one scene's gameId and the other's internal id: the gameId wins.
    check(joined(engine.tagsForScene("kitchen")) == "[indoor]", "tagsForScene(kitchen) read the internal id first: " + joined(engine.tagsForScene("kitchen")));
    check(tags("kitchen", "stove") == "[indoor, hot]", "tagsForBlock(kitchen, stove) by gameIds: " + tags("kitchen", "stove"));
    check(tags("kitchen", "b_k") == "[indoor, hot]", "tagsForBlock(kitchen, b_k) by internal id in the scene: " + tags("kitchen", "b_k"));
    check(tags("garden", "b_k") == "[]", "tagsForBlock(garden, b_k) resolved a block of another scene: " + tags("garden", "b_k"));
    check(tags("garden", "stove") == "[]", "tagsForBlock(garden, stove) resolved another scene's block gameId: " + tags("garden", "stove"));
    check(tags("nowhere", "b_k") == "[]", "tagsForBlock(nowhere, b_k) resolved under an unknown scene: " + tags("nowhere", "b_k"));
    check(tags("", "b_k") == "[indoor, hot]", "tagsForBlock with no scene did not take the internal id: " + tags("", "b_k"));
    check(tags("", "stove") == "[]", "tagsForBlock with no scene took a block gameId: " + tags("", "stove"));
    check(engine.gameDataForBlock("kitchen", "stove").size() == 1, "gameDataForBlock(kitchen, stove) found nothing");
    check(engine.gameDataForBlock("garden", "b_k").empty(), "gameDataForBlock(garden, b_k) resolved a block of another scene");
    check(engine.castForBlock("garden", "b_k").empty() && engine.castForBlock("kitchen", "b_k").empty(), "castForBlock");
    if (!problems.empty()) fail("addresses", "engine lookups follow the one address rule", problems);
    else std::cout << "  [addresses] engine lookups: a scene's gameId first, a block within its scene\n";
}

// ----- kernel errors -----------------------------------------------------------------------------------
//
// The kernel (wildwinter::expr, shared with the Storylet Engine since 2026-09-24) throws its own
// ExprError and RegistryError, never Patterplay's. Every place the engine calls it for something that
// can refuse catches them and rethrows Patterplay's EvalError with the kernel's message, as the engine
// threw before the kernel was shared, so a game's `catch (const patter::EvalError&)` still works and no
// kernel exception crosses the plugin's API. One case per rethrow site in Engine.h, each of which fails
// (the kernel's own type arrives instead) when that site's kernelCall is removed. A refusal while the
// story evaluates its own content (a condition, an effect) is no longer thrown at all: the engine plays
// through it and reports it (PlayError). Those cases pin that instead, and reach Flow::writeProperty's
// rethrow through the game's own write.

static int g_kernelPass = 0, g_kernelTotal = 0;

static void kernelCase(const std::string& name, const std::function<void()>& body)
{
    ++g_kernelTotal;
    try { body(); ++g_kernelPass; }
    catch (const std::exception& ex) { fail("kernel-errors", name, ex.what()); }
}

/** body must throw Patterplay's EvalError whose message contains `contains`; the kernel's own type, or
 *  any other, is a failure that names what arrived instead. */
static void expectEvalError(const std::function<void()>& body, const std::string& contains, const std::string& what)
{
    std::string message, type;
    try { body(); }
    catch (const EvalError& ex) { message = ex.what(); type = "EvalError"; }
    catch (const wildwinter::expr::ExprError& ex) { message = ex.what(); type = "the kernel's ExprError"; }
    catch (const wildwinter::expr::RegistryError& ex) { message = ex.what(); type = "the kernel's RegistryError"; }
    catch (const std::exception& ex) { message = ex.what(); type = "some other std::exception"; }
    if (type.empty()) throw std::runtime_error(what + ": did not throw");
    if (type != "EvalError") throw std::runtime_error(what + ": threw " + type + " (\"" + message + "\"), not Patterplay's EvalError");
    if (message.find(contains) == std::string::npos) throw std::runtime_error(what + ": threw \"" + message + "\", expected it to say \"" + contains + "\"");
}

/** A scope the game lends with no way to write it. */
struct NoSetScope : IScopeResolver
{
    std::optional<PatterValue> get(const std::string&) const override { return PatterValue::Num(0); }
    bool canSet() const override { return false; }
    void set(const std::string&, const PatterValue&) override {}
};

static void runKernelErrorCases()
{
    kernelCase("a write the registry refuses is Patterplay's EvalError (Flow::writeProperty), and the story's is played through", []
    {
        Bundle bundle = parseBundle(parseJ(R"JSON({"schema":"patter/bundle@0","locales":{"default":"en","included":["en"]},"strings":{"en":{"T":"hi"}},"properties":[],
          "scopeRegistry":{"version":1,"scopes":[{"token":"world","declarations":[{"name":"clock","type":"string","default":"day","writable":false}]}]},
          "scenes":{"s":{"id":"s","gameId":"s","blocks":[{"id":"b","gameId":"b","children":[{"id":"sn","type":"snippet","beats":[{"id":"T","kind":"text"}],
            "onEnter":[{"kind":"set","target":"@world.clock","value":{"src":"\"night\"","ast":["s","night"]}}],"jump":{"to":"END"}}]}]}}})JSON"));
        std::string reported;
        EngineOptions storyOpts; storyOpts.onError = [&reported](const PlayError& e) { reported = e.message; };
        Engine engine(bundle, storyOpts);
        engine.openFlow("main", "s", "b")->advance();
        need(reported.find("'@world.clock' is read-only") != std::string::npos,
            "the story's write to a read-only @world was not reported with the registry's message (got: " + reported + ")");
        // The game's own write goes through the same site, and a scope it lent with no setter refuses it.
        auto registry = std::make_shared<ScopeRegistry>();
        ForeignScopeOptions game; game.owner = "Game";
        registry->defineForeign("clock", std::make_shared<NoSetScope>(), nullptr, game);
        EngineOptions opts; opts.registry = registry;
        Engine onRegistry(orBundle(), opts);
        Flow* flow = onRegistry.openFlow("f", "s");
        expectEvalError([&] { flow->setProperty("@clock.hour", PatterValue::Num(9)); }, "'@clock.hour' is read-only", "the game's write through a flow");
    });

    kernelCase("a flow's bag clashing with a key the game holds is Patterplay's EvalError (Flow::mount)", []
    {
        auto registry = std::make_shared<ScopeRegistry>();
        EngineOptions opts; opts.registry = registry;
        Engine engine(orBundle(), opts);
        OwnedScopeOptions game; game.owner = "Game";
        registry->defineOwned("patter/flow/f/patter", {}, game);
        expectEvalError([&] { engine.openFlow("f", "s"); }, "scope '@patter/flow/f/patter' is already registered by Game", "a flow mount clash");
    });

    kernelCase("an expression the evaluator refuses is played through and reported with its message (Flow::evalExpr)", []
    {
        Bundle bundle = parseBundle(parseJ(R"JSON({"schema":"patter/bundle@0","locales":{"default":"en","included":["en"]},"strings":{"en":{"T":"hi"}},
          "properties":[{"name":"fame","type":"number","default":0,"shared":true}],
          "scenes":{"s":{"id":"s","gameId":"s","blocks":[{"id":"b","gameId":"b","children":[{"id":"sn","type":"snippet","beats":[{"id":"T","kind":"text"}],
            "onEnter":[{"kind":"set","target":"@fame","value":{"src":"1 / 0","ast":["bin","/",["n",1],["n",0]]}}],"jump":{"to":"END"}}]}]}}})JSON"));
        std::string reported;
        EngineOptions opts; opts.onError = [&reported](const PlayError& e) { reported = e.kind + ": " + e.message; };
        Engine engine(bundle, opts);
        StepResult step = engine.openFlow("f", "s")->advance();
        need(step.type == StepType::Text && step.id == "T", "the flow did not play on past an evaluation refusal");
        need(reported == "effect: division by zero", "an evaluation refusal was not reported with the evaluator's message (got: " + reported + ")");
    });

    kernelCase("the game's write to a scope with no setter is Patterplay's EvalError (Engine::setProperty)", []
    {
        auto registry = std::make_shared<ScopeRegistry>();
        ForeignScopeOptions game; game.owner = "Game";
        registry->defineForeign("clock", std::make_shared<NoSetScope>(), nullptr, game);
        EngineOptions opts; opts.registry = registry;
        Engine engine(orBundle(), opts);
        expectEvalError([&] { engine.setProperty("@clock.hour", PatterValue::Num(9)); }, "'@clock.hour' is read-only", "a refused game write");
    });

    kernelCase("a token clash as the engine registers is Patterplay's EvalError (Engine::registerScopes)", []
    {
        auto registry = std::make_shared<ScopeRegistry>();
        OwnedScopeOptions game; game.owner = "Game";
        registry->defineOwned("patter", {}, game);
        EngineOptions opts; opts.registry = registry;
        expectEvalError([&] { Engine engine(orBundle(), opts); }, "scope '@patter' is already registered by Game (wanted by Patter)", "a registration clash");
    });

    std::cout << "  [kernel-errors] every kernel refusal reaches the game as Patterplay's EvalError, or is played through and reported: " << g_kernelPass << "/" << g_kernelTotal << "\n";
}

static void runInspectorSmoke()
{
    Bundle b;
    { PropertyDecl d; d.name = "gold"; d.type = "number"; d.hasDefault = true; d.def = PatterValue::Num(5); b.properties.push_back(d); }
    { PropertyDecl d; d.name = "mood"; d.type = "enum"; d.values = { "calm", "tense" }; d.hasDefault = true; d.def = PatterValue::Str("calm"); b.properties.push_back(d); }
    { PropertyDecl d; d.name = "notes"; d.type = "flags"; b.properties.push_back(d); }
    { PropertyDecl d; d.name = "local"; d.type = "string"; d.hasShared = true; d.shared = false; b.properties.push_back(d); }

    EngineOptions opts;
    Engine engine(b, opts);
    auto rows = engine.listProperties();

    std::vector<std::string> paths; for (const auto& r : rows) paths.push_back(r.path);
    // The QUALIFIED address: a row reports `@patter.gold`, where `@gold` is the shorthand
    // that still resolves on input (splitRef defaults an unqualified name to the patter scope).
    if (paths != std::vector<std::string>{ "@patter.gold", "@patter.mood", "@patter.notes" })
        fail("inspector", "listProperties", "unexpected paths (got " + [&]{ std::string o; for (auto& x : paths) o += x + " "; return o; }() + ")");

    // The row is the shared shape now, so the two fields the old local one lacked are
    // part of the contract: the bare name beside the address, and writable.
    if (rows[0].name != "gold" || rows[0].path != "@patter.gold" || !rows[0].writable)
        fail("inspector", "shared row shape", "name/path/writable wrong on the gold row");

    if (rows[0].type != "number" || !rows[0].value.isNumber() || rows[0].value.n != 5 || rows[0].defaultValue.n != 5)
        fail("inspector", "number row", "gold row wrong: " + rows[0].value.toDisplayString());
    // values/stages are optional on the shared row: a row with no enum options has no vector,
    // where the forked row carried an empty one.
    if (!rows[1].values || *rows[1].values != std::vector<std::string>{ "calm", "tense" } || rows[1].value.s != "calm")
        fail("inspector", "enum row", "mood row wrong");
    if (rows[2].type != "flags" || !rows[2].defaultValue.isFlags() || !rows[2].defaultValue.f.empty())
        fail("inspector", "flags default", "notes default should be empty flags");

    engine.setProperty("@gold", PatterValue::Num(42));
    if (engine.listProperties()[0].value.n != 42)
        fail("inspector", "live setProperty", "gold value did not reflect setProperty");
}

// describeBundle: the bundle inspector's runtime half. Not a corpus case - this adds no runtime
// behaviour, so the corpus is untouched - but the numbers have to agree with the JS reference or two
// inspectors describe the same asset differently. The fixture mirrors the one in the JS tests.
// Checkpoint cost against a long-lived flow (informational, never a failure): one scene of 10,000
// one-beat blocks, every one visited first, so the flow carries a big visit history. Then the same
// goto + advance timed bare and inside checkpoint + rollback. A checkpoint records changes as they
// happen, so its overhead should not grow with the history; snapshot() is timed beside it for scale,
// as the cost a whole-flow copy per checkpoint would pay.
static void runCheckpointTiming()
{
    const int blocks = 10000;
    std::string json = R"({"schema":"patter/bundle@0","content":{"project":"t","hash":"t","structureHash":"t"},"voiced":false,)"
        R"("locales":{"default":"en","included":["en"]},"properties":[],"scenes":{"s":{"id":"s","type":"scene","name":"S","gameId":"s","blocks":[)";
    for (int i = 0; i < blocks; ++i)
    {
        const std::string n = std::to_string(i);
        if (i) json += ",";
        json += R"({"id":"b)" + n + R"(","type":"block","name":"B)" + n + R"(","children":[{"id":"sn)" + n
            + R"(","type":"snippet","beats":[{"id":"T)" + n + R"(","kind":"text"}],"jump":{"to":"END"}}]})";
    }
    json += R"(]}},"strings":{"en":{}}})";
    const Bundle bundle = parseBundle(JsonParser(json).parse());
    EngineOptions opts; opts.hasSeed = true; opts.seed = 1;
    Engine engine(bundle, opts);
    Flow* flow = engine.openFlow("f", "s");
    for (int i = 0; i < blocks; ++i) { flow->gotoAddress("s", "b" + std::to_string(i)); flow->advance(); }

    using clock = std::chrono::steady_clock;
    const int reps = 10000;
    auto micros = [](clock::duration d) { return std::chrono::duration<double, std::micro>(d).count(); };
    auto t0 = clock::now();
    for (int i = 0; i < reps; ++i) { flow->gotoAddress("s", "b" + std::to_string(i % blocks)); flow->advance(); }
    const double bare = micros(clock::now() - t0) / reps;
    t0 = clock::now();
    for (int i = 0; i < reps; ++i)
    {
        Checkpoint cp = engine.checkpoint();
        flow->gotoAddress("s", "b" + std::to_string(i % blocks)); flow->advance();
        engine.rollback(cp);
    }
    const double rolled = micros(clock::now() - t0) / reps;
    t0 = clock::now();
    for (int i = 0; i < reps; ++i)
    {
        Checkpoint cp = engine.checkpoint();
        flow->gotoAddress("s", "b" + std::to_string(i % blocks)); flow->advance();
        engine.commit(cp);
    }
    const double committed = micros(clock::now() - t0) / reps;
    const int snaps = 100;
    t0 = clock::now();
    for (int i = 0; i < snaps; ++i) { FlowSnapshot snap = flow->snapshot(); (void)snap; }
    const double snapshot = micros(clock::now() - t0) / snaps;
    char line[256];
    std::snprintf(line, sizeof line, "  [timing] %d visited blocks, per goto+advance: bare %.2f us, checkpoint+rollback %.2f us, "
        "checkpoint+commit %.2f us (a whole-flow snapshot: %.1f us)\n", blocks, bare, rolled, committed, snapshot);
    std::cout << line;
}

static void runDescribeSmoke()
{
    Bundle b;
    b.schema = "patter/bundle@0";
    b.contentProject = "Tavern";
    b.contentVersion = "1.2.0";
    b.contentHash = "abc";
    b.structureHash = "def";
    b.locales.defaultLocale = "en";
    b.locales.included = { "en", "fr" };
    { PropertyDecl d; d.name = "gold"; d.type = "number"; d.hasDefault = true; d.def = PatterValue::Num(5); b.properties.push_back(d); }

    HostScopeSpec world;
    world.token = "world";
    world.hasDeclarations = true;
    { HostScopeDecl d; d.name = "isnight"; d.type = "boolean"; d.hasDefault = true; d.def = PatterValue::Bool(true); world.declarations.push_back(d); }
    HostScopeSpec opaque;                       // no declarations at all: any name, unchecked
    opaque.token = "game";
    b.scopeRegistry.present = true;
    b.scopeRegistry.scopes = { world, opaque };

    auto opt1 = std::make_shared<Node>(); opt1->type = "snippet"; opt1->id = "opt1";
    { Beat beat; beat.id = "L1"; beat.kind = "line"; opt1->beats.push_back(beat); }
    auto group = std::make_shared<Node>(); group->type = "group"; group->id = "g1"; group->selector = "choice";
    group->prompt = std::make_shared<Beat>(); group->prompt->id = "P1"; group->prompt->kind = "text";
    group->children = { opt1 };
    auto sn = std::make_shared<Node>(); sn->type = "snippet"; sn->id = "sn";
    { Beat beat; beat.id = "E1"; beat.kind = "gameEvent"; sn->beats.push_back(beat); }

    Block block; block.id = "b1"; block.name = "The Bar"; block.children = { group, sn };
    Scene scene; scene.id = "s1"; scene.name = "Opening Night"; scene.blocks = { block };
    { PropertyDecl d; d.name = "seen"; d.type = "boolean"; scene.sceneProps.push_back(d); }
    b.scenes["s1"] = scene;

    BundleDescription d = describeBundle(b);

    if (d.identity.schema != "patter/bundle@0" || d.identity.project != "Tavern" || d.identity.version != "1.2.0")
        fail("describe", "identity", "schema / project / version not carried");
    if (d.identity.localisation != "embedded") fail("describe", "identity", "absent localisation must read as embedded");
    if (d.addresses.size() != 1 || d.addresses[0].gameId != "opening-night" || d.addresses[0].name != "Opening Night")
        fail("describe", "addresses", "scene address derived from the name");
    if (d.addresses[0].blocks.size() != 1 || d.addresses[0].blocks[0].gameId != "the-bar")
        fail("describe", "addresses", "block address nested under its scene");
    if (d.hostScopes.size() != 2 || d.hostScopes[0].token != "world" || d.hostScopes[0].opaque)
        fail("describe", "hostScopes", "declared scope");
    if (!d.hostScopes[1].opaque || !d.hostScopes[1].properties.empty())
        fail("describe", "hostScopes", "a scope with no declarations is OPAQUE, not empty");
    if (d.properties.patter.size() != 1 || !d.properties.patter[0].shared)
        fail("describe", "properties", "@patter defaults to shared");
    if (d.properties.scene.size() != 1 || d.properties.scene[0].properties[0].shared)
        fail("describe", "properties", "@scene defaults to per-flow");
    // beats counts the population getBeatSequence walks; the choice prompt is a SEPARATE row.
    if (d.counts.scenes != 1 || d.counts.blocks != 1 || d.counts.groups != 1 || d.counts.snippets != 2
        || d.counts.beats != 2 || d.counts.prompts != 1 || d.counts.gameEvents != 1)
        fail("describe", "counts", "scene/block/group/snippet/beat/prompt/gameEvent counts");
}

// Structure introspection (Engine::getOutline / getBeatSequence) on a hand-built scene -> block -> choice
// group -> snippets -> beats. The corpus's outlines section holds the shape to the reference; this keeps
// what that case does not reach, a cast display name read into characterName.
// Patter extension values as text, the form the Blueprint layer hands a game: jsonText writes the tree in
// document order with JS numbers, parseJsonText reads it back, and a save leaves an option's values out
// (they're read off the bundle on load, which the corpus's saveLoad case pins).
static void runExtensionTextSmoke()
{
    std::cout << "  [extension-text] values cross as JSON text and back; a save carries none\n";
    const std::string text = R"({"sound":"bell\n\u00e9","gain":0.5,"tags":["a",true,null,-3e-7],"n":{}})";
    const JsonTree tree = parseJsonText(text);
    const std::string back = jsonText(tree);
    // The escape decoded to UTF-8 and written as it is, a newline escaped, -3e-7 as JS prints it.
    if (back != std::string(R"({"sound":"bell\n)") + "\xC3\xA9" + R"(","gain":0.5,"tags":["a",true,null,-3e-7],"n":{}})")
        fail("extension-text", "round trip", back);
    if (jsonText(parseJsonText(back)) != back) fail("extension-text", "stable", back);
    for (const char* bad : { "bell", "{\"a\":1", "[1,]", "1 2" })
    {
        bool threw = false;
        try { parseJsonText(bad); } catch (const std::exception&) { threw = true; }
        if (!threw) fail("extension-text", "refuses", bad);
    }
    static const Bundle b = parseBundle(parseJ(R"JSON({"schema":"patter/bundle@0","locales":{"default":"en","included":["en"]},"extensions":{"probe":{"version":"1.0.0","fields":{"option":[{"name":"icon","type":"text","default":""}]}}},"scenes":{"s":{"id":"s","type":"scene","name":"S","blocks":[{"id":"b","type":"block","name":"B","children":[{"id":"g","type":"group","selector":"choice","children":[{"id":"o","type":"group","extensions":{"probe":{"icon":"door"}},"prompt":{"id":"P","kind":"text"},"children":[]}]}]}]}},"strings":{"en":{"P":"Go"}}})JSON"));
    Engine engine(b, EngineOptions{});
    engine.openFlow("f", "", "");
    const StepResult choice = engine.getFlow("f")->advance();
    if (choice.type != StepType::Choice || choice.options.size() != 1 || choice.options[0].extensions.empty())
        fail("extension-text", "option", "the option carries no extensions");
    const std::string saved = serializeState(engine);
    if (saved.find("extensions") != std::string::npos) fail("extension-text", "save", "a save carried an option's extension values");
    Engine loaded(b, EngineOptions{});
    deserializeState(loaded, saved);
    const auto options = loaded.getFlow("f")->getChoices();
    if (options.size() != 1 || jsonText(options[0].extensions.at("probe").at("icon")) != "\"door\"")
        fail("extension-text", "load", "a loaded option didn't read its values off the bundle");
}

static void runOutlineSmoke()
{
    Bundle b;
    b.locales.defaultLocale = "en";
    b.cast.push_back(Cast{ "GUARD", "The Guard", {} });
    b.strings["en"]["L1"] = "Halt!";
    b.strings["en"]["T1"] = "The gate creaks.";

    auto opt1 = std::make_shared<Node>(); opt1->type = "snippet"; opt1->id = "opt1";
    { Beat beat; beat.id = "L1"; beat.kind = "line"; beat.hasCharacter = true; beat.character = "GUARD"; opt1->beats.push_back(beat); }
    opt1->jump = std::make_shared<Jump>(); opt1->jump->to = "END";
    auto opt2 = std::make_shared<Node>(); opt2->type = "snippet"; opt2->id = "opt2";
    { Beat beat; beat.id = "T1"; beat.kind = "text"; opt2->beats.push_back(beat); }
    auto group = std::make_shared<Node>(); group->type = "group"; group->id = "g1"; group->selector = "choice";
    group->children = { opt1, opt2 };
    auto sn = std::make_shared<Node>(); sn->type = "snippet"; sn->id = "sn";
    { Beat beat; beat.id = "E1"; beat.kind = "gameEvent"; sn->beats.push_back(beat); }

    Block block; block.id = "b1"; block.name = "Intro"; block.children = { group, sn };
    block.gameData = std::make_shared<GameData>(GameData{ { "lit", PatterValue::Bool(false) } });
    Scene scene; scene.id = "s1"; scene.name = "Opening"; scene.blocks = { block };
    scene.gameData = std::make_shared<GameData>(GameData{ { "music", PatterValue::Str("jig") } });
    b.scenes["s1"] = scene;

    EngineOptions opts;
    Engine engine(b, opts);

    auto outline = engine.getOutline();
    if (outline.size() != 1 || outline[0].name != "Opening") { fail("outline", "scene", "expected 1 scene 'Opening'"); return; }
    const auto& blk = outline[0].blocks.at(0);
    if (blk.children.size() != 2 || blk.children[0].type != "group" || blk.children[0].children.size() != 2)
        fail("outline", "group", "group not preserved with 2 option children");
    const auto& line = blk.children[0].children[0].beats.at(0);
    if (line.id != "L1" || line.kind != "line" || line.characterName != "The Guard" || line.text != "Halt!")
        fail("outline", "beat data", "line beat data wrong: " + line.characterName + "/" + line.text);
    if (blk.children[1].type != "snippet" || blk.children[1].jumpTo != "" ) { /* sn has no jump -> empty */ }
    // Scene / block gameData ride on the outline raw: the node's own overrides, no inheritance.
    if (outline[0].gameData.size() != 1 || outline[0].gameData[0].first != "music" || outline[0].gameData[0].second.s != "jig")
        fail("outline", "scene gameData", "scene gameData not carried raw");
    if (blk.gameData.size() != 1 || blk.gameData[0].first != "lit" || blk.gameData[0].second.b != false)
        fail("outline", "block gameData", "block gameData not carried raw (or the scene's leaked in)");

    auto seq = engine.getBeatSequence();
    std::vector<std::string> ids; for (const auto& f : seq) ids.push_back(f.beat.id);
    if (ids != std::vector<std::string>{ "L1", "T1", "E1" })
        fail("outline", "getBeatSequence", "flat order wrong (got " + [&]{ std::string o; for (auto& x : ids) o += x + " "; return o; }() + ")");
    if (seq[0].snippetId != "opt1" || seq[2].snippetId != "sn")
        fail("outline", "breadcrumb", "flat beat breadcrumb wrong");
}


// --- the @wildwinter/expr parity corpus ------------------------------------
//
// A SECOND corpus, authored in ../expr and vendored here, holding the
// primitives both product families share and neither family's own corpus
// tests: seed coercion, the PRNG draw and state sequence, operator typing,
// short-circuiting, value equality and the comparison rules. The evaluator is
// exercised only incidentally by the Patterplay corpus (through walking a
// scene), so a divergence in expr itself failed nothing anywhere until this
// existed. It caught two, on the day it was written.
//
// Its `expressions` section has the same shape as ours and goes through the
// same runExpressions above. Only the PRNG section is new.

static double exprSeed(const JsonValue& v)
{
    // JSON has no literal for the non-finite doubles, and they are exactly the
    // interesting coercion cases, so the corpus carries them as strings.
    if (v.type == JsonValue::String)
    {
        if (v.str == "NaN") return std::numeric_limits<double>::quiet_NaN();
        if (v.str == "Infinity") return std::numeric_limits<double>::infinity();
        if (v.str == "-Infinity") return -std::numeric_limits<double>::infinity();
        throw std::runtime_error("unknown seed literal: " + v.str);
    }
    return v.num;
}

static int runExprPrng(const JsonValue& arr)
{
    int pass = 0;
    for (const auto& c : arr.arr)
    {
        std::string name = c.at("name").str;
        Mulberry32 prng(exprSeed(c.at("seed")));

        const uint32_t wantSeed = static_cast<uint32_t>(c.at("expectSeedState").num);
        if (prng.state() != wantSeed)
        {
            fail("expr/prng", name, "seed state " + std::to_string(prng.state())
                + ", expected " + std::to_string(wantSeed));
            continue;
        }

        const auto& states = c.at("expectStates").arr;
        const auto& draws = c.at("expectDraws").arr;
        bool ok = true;
        for (size_t i = 0; i < states.size() && ok; ++i)
        {
            const double d = prng.next();
            // The corpus pins the draw's NUMERATOR, an exact uint32, so no port
            // is held to another language's float printing.
            const uint32_t gotDraw = static_cast<uint32_t>(llround(d * 4294967296.0));
            const uint32_t wantDraw = static_cast<uint32_t>(draws[i].num);
            const uint32_t wantState = static_cast<uint32_t>(states[i].num);
            if (gotDraw != wantDraw)
            {
                fail("expr/prng", name, "draw " + std::to_string(i + 1) + " is "
                    + std::to_string(gotDraw) + ", expected " + std::to_string(wantDraw));
                ok = false;
            }
            else if (prng.state() != wantState)
            {
                fail("expr/prng", name, "state after draw " + std::to_string(i + 1) + " is "
                    + std::to_string(prng.state()) + ", expected " + std::to_string(wantState));
                ok = false;
            }
            else if (!(d >= 0.0 && d < 1.0))
            {
                fail("expr/prng", name, "draw " + std::to_string(i + 1) + " outside [0, 1)");
                ok = false;
            }
        }
        if (ok) ++pass;
    }
    return pass;
}

// The runtime foundations before 1.0, where the corpus can't look: the exact words of a refused host write
// (the corpus asks only that it's refused; every runtime and the Storylet Engine share the wording), and a
// setup report's place in the decision log and the live tap, under no flow.
static void runFoundationsCheck()
{
    const char* json = R"JSON({"schema":"patter/bundle@0","locales":{"default":"en","included":["en","fr"]},
      "properties":[{"name":"gold","type":"number","shared":true,"default":1},{"name":"mood","type":"enum","values":["calm","tense"],"shared":true,"default":""},
                    {"name":"keys","type":"flags","values":["iron"],"shared":true},{"name":"act","type":"quality","stages":["one","two"],"shared":true,"default":"one"}],
      "scopeRegistry":{"version":1,"scopes":[{"token":"world","declarations":[{"name":"alarm","type":"boolean","default":false}]}]},
      "scenes":{"s":{"id":"s","type":"scene","name":"S","gameId":"s","sceneProps":[{"name":"count","type":"number","default":0}],
        "blocks":[{"id":"b","type":"block","name":"B","gameId":"b","children":[{"id":"n","type":"snippet","beats":[{"id":"T","kind":"text"}]}]}]}},
      "strings":{"en":{"T":"hi"},"fr":{"T":"salut"}}})JSON";
    const Bundle bundle = parseBundle(JsonParser(json).parse());
    const auto refusal = [](const std::function<void()>& call) -> std::string
    {
        try { call(); } catch (const EvalError& ex) { return ex.what(); }
        return "<not refused>";
    };
    const auto want = [](const std::string& got, const std::string& expected, const std::string& what)
    {
        if (got != expected) fail("foundations", what, "expected \"" + expected + "\", got \"" + got + "\"");
    };
    {
        Engine engine(bundle);
        Flow* flow = engine.openFlow("f", "s");
        want(refusal([&] { engine.setProperty("@gold", PatterValue::Str("lots")); }), "\"@patter.gold\" takes a number; \"lots\" doesn't fit", "a number");
        want(refusal([&] { engine.setProperty("@mood", PatterValue::Str("angry")); }), "\"@patter.mood\" takes one of \"calm\", \"tense\"; \"angry\" doesn't fit", "an enum");
        want(refusal([&] { engine.setProperty("@keys", PatterValue::Flags({ "iron", "gold" })); }), "\"@patter.keys\" takes a list of flags from \"iron\"; [\"iron\",\"gold\"] doesn't fit", "flags");
        want(refusal([&] { engine.setProperty("@act", PatterValue::Str("three")); }), "\"@patter.act\" takes one of its stages \"one\", \"two\"; \"three\" doesn't fit", "a quality");
        want(refusal([&] { engine.setProperty("@world.alarm", PatterValue::Num(1)); }), "\"@world.alarm\" takes true or false; 1 doesn't fit", "a host scope's boolean");
        want(refusal([&] { engine.setProperty("@world.bells", PatterValue::Num(1)); }), "no property at \"@world.bells\": the content declares no @world.bells", "an undeclared host-scope name");
        want(refusal([&] { flow->setProperty("@scene.count", PatterValue::Bool(true)); }), "\"@scene.count\" takes a number; true doesn't fit", "@scene, on a flow");
        want(refusal([&] { engine.setProperty("@mood", PatterValue::Str("")); }), "<not refused>", "an enum whose default is \"\" takes \"\"");
    }
    {
        EngineOptions opts; opts.log = true; opts.locale = "fr-CA";
        std::vector<PlayError> errors;
        opts.onError = [&errors](const PlayError& e) { errors.push_back(e); };
        Engine engine(bundle, opts);
        if (errors.size() != 1 || errors[0].kind != "setup" || errors[0].node != "fr-CA" || !errors[0].flow.empty())
            fail("foundations", "setup report", "the constructor did not report the locale once, as setup, under no flow");
        else if (errors[0].message != "this bundle has no locale \"fr-CA\", so it's using its language, \"fr\"")
            fail("foundations", "setup wording", "got \"" + errors[0].message + "\"");
        if (engine.log().size() != 1 || engine.log()[0].type != "diagnostic" || engine.log()[0].kind != "setup" || !engine.log()[0].flow.empty())
            fail("foundations", "setup in the log", "the decision log did not record the setup report under no flow");
        std::vector<std::string> tapped;
        auto off = engine.onTrace([&tapped](const std::string& flow, const LogEntry& e) { tapped.push_back(flow + ":" + e.kind + ":" + e.node); });
        engine.setLocale("de");
        off();
        if (tapped != std::vector<std::string>{ ":setup:de" }) fail("foundations", "setup on the tap", "the live tap did not hear setLocale's report under no flow");
        if (engine.locale() != "en" || engine.locales().defaultLocale != "en" || engine.locales().included != std::vector<std::string>{ "en", "fr" })
            fail("foundations", "locales", "locale() or locales() is wrong after falling back");
    }
    // Set-up reports are made once by a hot swap whose load is refused, not again by the engine it falls back on.
    // The new bundle names another engine's scope that nothing registered, so the replacement's load is refused.
    {
        std::vector<std::string> nodes;
        EngineOptions opts; opts.locale = "en-GB";
        opts.onError = [&nodes](const PlayError& e) { if (e.kind == "setup") nodes.push_back(e.node); };
        Engine engine(bundle, opts);
        engine.openFlow("f", "s");
        Bundle refusing = bundle;
        refusing.externalScopes = { "quest" };
        std::unique_ptr<Engine> fallback = engine.hotSwap(refusing);
        if (nodes != std::vector<std::string>{ "en-GB", "en-GB" })
            fail("foundations", "a refused-load hot swap", "the locale was reported " + std::to_string(nodes.size()) + " times, not twice");
        nodes.clear();
        std::unique_ptr<Engine> after = fallback->hotSwap(bundle);
        if (nodes != std::vector<std::string>{ "en-GB" })
            fail("foundations", "the fallback's own hot swap", "the locale was reported " + std::to_string(nodes.size()) + " times, not once");
    }
    // A start the bundle doesn't have (only a hand-edited bundle can) is passed over.
    {
        const auto opens = [&bundle](const std::string& scene, const std::string& block) -> std::string
        {
            Bundle b = bundle;
            b.start.present = true; b.start.scene = scene; b.start.block = block;
            try
            {
                Engine engine(b);
                StepResult r = engine.openFlow("f")->advance();
                return r.type == StepType::Text && r.id == "T" ? "T" : "not T";
            }
            catch (const std::exception& ex) { return ex.what(); }
        };
        want(opens("gone", ""), "T", "a start scene the bundle doesn't have starts at the first scene");
        want(opens("s", "gone"), "T", "a start block the scene doesn't have starts at its first block");
    }
    std::cout << "  [foundations] a refused host write in the family's words; a setup report in the log and on the tap, under no flow;"
                 " a refused-load hot swap reports once; a start the bundle doesn't have is passed over\n";
}

int main(int argc, char** argv)
{
    std::string path = argc > 1 ? argv[1] : "corpus.json";
    std::ifstream in(path);
    if (!in) { std::cerr << "corpus not found: " << path << "\n"; return 2; }
    std::stringstream ss; ss << in.rdbuf();
    JsonValue root = JsonParser(ss.str()).parse();

    int e = runExpressions(root.at("expressions"));
    const JsonValue* specArr = root.find("specificity");
    int sp = specArr ? runSpecificity(*specArr) : 0;
    int r = runRuntime(root.at("runtime"));
    int s = runScripted(root.at("scripted"));
    int g = runGameData(root.at("gameData"));
    // Envelopes written by the JS reference, loaded through this core's own boundary. The section
    // must exist: a family the harness cannot run is a check that cannot fail.
    const JsonValue* savesArr = root.find("saves");
    if (!savesArr) { std::cerr << "corpus has no saves section\n"; return 2; }
    int sv = runSaves(*savesArr);
    std::cout << "  [saves] envelopes written by the JS reference, loaded here + continued: " << sv << "/" << savesArr->arr.size() << "\n";
    if (sv != static_cast<int>(savesArr->arr.size())) fail("saves", "section total", std::to_string(sv) + " of " + std::to_string(savesArr->arr.size()) + " passed");
    const JsonValue* logsArr = root.find("logs");
    if (!logsArr) { std::cerr << "corpus has no logs section\n"; return 2; }
    int lg = runLogs(*logsArr);
    std::cout << "  [logs] decision logs, and onTrace streaming the same decisions: " << lg << "/" << logsArr->arr.size() << "\n";
    if (lg != static_cast<int>(logsArr->arr.size())) fail("logs", "section total", std::to_string(lg) + " of " + std::to_string(logsArr->arr.size()) + " passed");
    const JsonValue* describesArr = root.find("describes");
    if (!describesArr) { std::cerr << "corpus has no describes section\n"; return 2; }
    int ds = runDescribes(*describesArr);
    std::cout << "  [describes] the bundle description every runtime gives: " << ds << "/" << describesArr->arr.size() << "\n";
    if (ds != static_cast<int>(describesArr->arr.size())) fail("describes", "section total", std::to_string(ds) + " of " + std::to_string(describesArr->arr.size()) + " passed");
    const JsonValue* outlinesArr = root.find("outlines");
    if (!outlinesArr) { std::cerr << "corpus has no outlines section\n"; return 2; }
    int ol = runOutlines(*outlinesArr);
    std::cout << "  [outlines] the outline and beat sequence every runtime gives: " << ol << "/" << outlinesArr->arr.size() << "\n";
    if (ol != static_cast<int>(outlinesArr->arr.size())) fail("outlines", "section total", std::to_string(ol) + " of " + std::to_string(outlinesArr->arr.size()) + " passed");
    const JsonValue* audioArr = root.find("audio");
    if (!audioArr) { std::cerr << "corpus has no audio section\n"; return 2; }
    int au = runAudio(*audioArr);
    std::cout << "  [audio] the audio resolver's joins, through the reader the plugin uses: " << au << "/" << audioArr->arr.size() << "\n";
    if (au != static_cast<int>(audioArr->arr.size())) fail("audio", "section total", std::to_string(au) + " of " + std::to_string(audioArr->arr.size()) + " passed");
    const JsonValue* durationsArr = root.find("durations");
    if (!durationsArr) { std::cerr << "corpus has no durations section\n"; return 2; }
    int du = runDurations(*durationsArr);
    std::cout << "  [durations] how long a line with no recording lasts: " << du << "/" << durationsArr->arr.size() << "\n";
    if (du != static_cast<int>(durationsArr->arr.size())) fail("durations", "section total", std::to_string(du) + " of " + std::to_string(durationsArr->arr.size()) + " passed");
    runInspectorSmoke();
    runOneRegistry();
    runFlowStateCases();
    runRunnerCases();
    runKernelErrorCases();
    runBundleReaderCase();
    runPendingClearedCheck();
    runOldSavePromptPadCheck();
    runNamelessQualifierCheck();
    runSpeakerLabelCheck();
    runFoundationsCheck();
    runHostScopeWritableSmoke();
    runPlayErrorCases();
    runDryChoiceCases();
    runAddressLookupCases();
    runTraceLogSmoke();
    runOutlineSmoke();
    runExtensionTextSmoke();
    runDescribeSmoke();
    runCheckpointTiming();

    std::cout << "  [envelope] scripted save/load round-trips: " << envelopeRoundTrips << "\n";
    std::cout << "  [gameData] scripted scene / block gameData reads: " << gameDataReads << "\n";
    std::cout << "  [extensions] scripted extension reads (expectExtensions, expectNodeExtensions): " << extensionReads << "\n";
    std::cout << "  [properties] scripted listProperties reads: " << propertyReads << "\n";
    std::cout << "expressions: " << e << "  specificity: " << sp << "  runtime: " << r << "  scripted: " << s << "  gameData: " << g << "\n";

    // The expr parity corpus sits beside ours, vendored from ../expr. Absent is
    // a FAILURE, not a skip: a parity gate that quietly does nothing when its
    // fixture is missing is the shape of check this codebase has been bitten by.
    {
        const size_t slash = path.find_last_of("/\\");
        const std::string exprPath =
            (slash == std::string::npos ? std::string() : path.substr(0, slash + 1)) + "expr-corpus.json";
        std::ifstream exprFile(exprPath);
        if (!exprFile) { std::cerr << "expr parity corpus not found: " << exprPath << "\n"; return 2; }
        std::stringstream exprBuf; exprBuf << exprFile.rdbuf();
        JsonValue exprRoot = JsonParser(exprBuf.str()).parse();
        const JsonValue& xprng = exprRoot.at("prng");
        const JsonValue& xexpr = exprRoot.at("expressions");
        int xp = runExprPrng(xprng);
        int xe = runExpressions(xexpr);
        // Corpus v4's two families: expressions over qualities (ladders beside the scopes) and the
        // host's stage helpers. Absent is a failure, as the corpus file is.
        const JsonValue* xqual = exprRoot.find("qualities");
        const JsonValue* xstages = exprRoot.find("stages");
        if (!xqual || !xstages) fail("expr corpus", "families", "no qualities or stages family (corpus v4)");
        int xq = xqual ? runExpressions(*xqual, "expr/qualities") : 0;
        int xs = xstages ? runStages(*xstages) : 0;
        std::cout << "expr corpus v" << static_cast<int>(exprRoot.at("version").num)
            << " - prng: " << xp << "/" << xprng.arr.size()
            << "  expressions: " << xe << "/" << xexpr.arr.size()
            << "  qualities: " << xq << "/" << (xqual ? xqual->arr.size() : 0)
            << "  stages: " << xs << "/" << (xstages ? xstages->arr.size() : 0) << "\n";
    }

    // The registry corpus, vendored from ../expr beside the other two, run through the
    // shared runner against the vendored ScopeRegistry. It is the registry's contract,
    // the `writable` rule included. Absent is a failure here too: the runner reports a
    // missing file as one.
    {
        const size_t slash = path.find_last_of("/\\");
        const std::string registryPath =
            (slash == std::string::npos ? std::string() : path.substr(0, slash + 1)) + "registry-corpus.json";
        const wildwinter::expr::testing::RegistryCorpusResult reg = wildwinter::expr::testing::RunRegistryCorpus(registryPath);
        for (const std::string& f : reg.failures) fail("registry", "corpus", f);
        std::cout << "registry corpus: " << reg.passed << "/" << reg.total << "\n";
    }
    std::cout << (g_fails == 0 ? "ALL PASS" : (std::to_string(g_fails) + " FAILED")) << "\n";
    return g_fails == 0 ? 0 : 1;
}
