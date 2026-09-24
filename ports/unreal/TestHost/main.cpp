// The corpus TestHost: load corpus.json and replay every section through the C++
// Patterplay runtime, asserting the same results the JS reference produces - the port's
// half of the parity contract. Standalone (clang), no Unreal needed.
//
//   build.sh   (compiles + runs against packages/conformance/corpus.json)

#include <algorithm>
#include <cstdio>
#include <cstdint>
#include <fstream>
#include <limits>
#include <cmath>
#include <sstream>
#include <iostream>
#include <queue>
#include "Json.h"
#include "Patter/Save.h"
#include "Patter/Describe.h"
#include "Patter/StateLogger.h"
#include "Patter/Engine.h"
#include "Patter/Mulberry32.h"
#include "RegistryCorpus.h"   // the shared registry corpus runner, vendored from ../expr

using namespace patter;

static int g_fails = 0;
static void fail(const std::string& section, const std::string& name, const std::string& detail)
{
    ++g_fails;
    std::cerr << "  FAIL [" << section << "] " << name << ": " << detail << "\n";
}

// ----- JSON -> model ----------------------------------------------------------

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

static Expression parseExpr(const JsonValue& e) { Expression x; x.ast = parseAst(e.at("ast")); return x; }

static std::vector<Effect> parseEffects(const JsonValue& e)
{
    std::vector<Effect> out;
    for (const auto& x : e.arr) { Effect ef; ef.target = x.at("target").str; ef.value = parseExpr(x.at("value")); out.push_back(ef); }
    return out;
}

static std::vector<std::string> strList(const JsonValue& a)
{
    std::vector<std::string> v; for (const auto& x : a.arr) v.push_back(x.str); return v;
}

static PropertyDecl parsePropDecl(const JsonValue& p)
{
    PropertyDecl d;
    d.name = p.at("name").str; d.type = p.at("type").str;
    if (const JsonValue* sh = p.find("shared")) { d.hasShared = true; d.shared = sh->b; }
    if (const JsonValue* tp = p.find("temporary")) d.temporary = tp->b;
    if (const JsonValue* df = p.find("default")) { d.hasDefault = true; d.def = toValue(*df); }
    if (const JsonValue* vs = p.find("values")) d.values = strList(*vs);
    if (const JsonValue* st = p.find("stages")) d.stages = strList(*st);
    return d;
}

static HostScopeDecl parseHostDecl(const JsonValue& d)
{
    HostScopeDecl h;
    h.name = d.at("name").str; h.type = d.at("type").str;
    if (const JsonValue* vs = d.find("values")) h.values = strList(*vs);
    if (const JsonValue* st = d.find("stages")) h.stages = strList(*st);
    if (const JsonValue* df = d.find("default")) { h.hasDefault = true; h.def = toValue(*df); }
    if (const JsonValue* w = d.find("writable")) { h.hasWritable = true; h.writable = w->b; }
    return h;
}

static Beat parseBeat(const JsonValue& b)
{
    Beat beat;
    beat.id = b.at("id").str; beat.kind = b.at("kind").str;
    if (const JsonValue* c = b.find("character")) beat.character = c->str;
    if (const JsonValue* dr = b.find("direction")) beat.direction = dr->str;
    if (const JsonValue* gd = b.find("gameData")) beat.gameData = parseGameData(*gd);
    if (const JsonValue* tg = b.find("tags")) beat.tags = strList(*tg);
    return beat;
}

static NodePtr parseNode(const JsonValue& n)
{
    auto node = std::make_shared<Node>();
    node->id = n.at("id").str; node->type = n.at("type").str;
    if (const JsonValue* c = n.find("condition")) node->condition = std::make_shared<Expression>(parseExpr(*c));
    if (const JsonValue* oe = n.find("onEnter")) node->onEnter = parseEffects(*oe);
    if (const JsonValue* ox = n.find("onExit")) node->onExit = parseEffects(*ox);
    if (const JsonValue* gd = n.find("gameData")) node->gameData = parseGameData(*gd);
    if (const JsonValue* tg = n.find("tags")) node->tags = strList(*tg);

    if (node->isGroup())
    {
        if (const JsonValue* sel = n.find("selector")) node->selector = sel->str;
        if (const JsonValue* ch = n.find("children")) for (const auto& c : ch->arr) node->children.push_back(parseNode(c));
        if (const JsonValue* pr = n.find("prompt")) node->prompt = std::make_shared<Beat>(parseBeat(*pr));
        if (const JsonValue* st = n.find("sticky")) node->sticky = st->b;
        if (const JsonValue* fb = n.find("fallback")) node->fallback = fb->b;
        if (const JsonValue* su = n.find("secretUntilEligible")) node->secretUntilEligible = su->b;
        if (const JsonValue* sh = n.find("shared")) node->shared = sh->b;
        if (const JsonValue* op = n.find("options"))
        {
            node->options = std::make_shared<SelectorOptions>();
            if (const JsonValue* o = op->find("order")) node->options->order = o->str;
            if (const JsonValue* x = op->find("exhaust")) node->options->exhaust = x->str;
        }
    }
    else
    {
        if (const JsonValue* bts = n.find("beats")) for (const auto& bt : bts->arr) node->beats.push_back(parseBeat(bt));
        if (const JsonValue* jp = n.find("jump")) { node->jump = std::make_shared<Jump>(); node->jump->to = jp->at("to").str; if (const JsonValue* md = jp->find("mode")) node->jump->mode = md->str; }
    }
    return node;
}

static std::map<std::string, std::map<std::string, std::string>> parseStrings(const JsonValue& e)
{
    std::map<std::string, std::map<std::string, std::string>> out;
    for (const auto& loc : e.obj) { std::map<std::string, std::string> t; for (const auto& kv : loc.second.obj) t[kv.first] = kv.second.str; out[loc.first] = t; }
    return out;
}

static Bundle parseBundle(const JsonValue& b)
{
    Bundle bundle;
    if (const JsonValue* sc = b.find("schema")) bundle.schema = sc->str;
    if (const JsonValue* v = b.find("voiced")) bundle.voiced = v->b;
    if (const JsonValue* ct = b.find("content")) {
        if (const JsonValue* h = ct->find("hash")) bundle.contentHash = h->str;
        if (const JsonValue* sh = ct->find("structureHash")) bundle.structureHash = sh->str;
        if (const JsonValue* pr = ct->find("project")) bundle.contentProject = pr->str;
        if (const JsonValue* ver = ct->find("version")) bundle.contentVersion = ver->str;
    }
    if (const JsonValue* lz = b.find("localisation")) {
        if (const JsonValue* m = lz->find("mode")) bundle.localisation.mode = m->str;
        if (const JsonValue* sd = lz->find("sourceDebug")) bundle.localisation.sourceDebug = sd->b;
    }
    if (const JsonValue* cc = b.find("closedCaptions")) {
        bundle.closedCaptions.present = true;
        bundle.closedCaptions.open = cc->at("open").str;
        bundle.closedCaptions.close = cc->at("close").str;
        if (const JsonValue* ch = cc->find("character")) bundle.closedCaptions.character = ch->str;
    }
    const JsonValue& loc = b.at("locales");
    bundle.locales.defaultLocale = loc.at("default").str;
    if (const JsonValue* inc = loc.find("included")) bundle.locales.included = strList(*inc);
    if (const JsonValue* cast = b.find("cast")) for (const auto& c : cast->arr) { Cast cc; cc.name = c.at("name").str; if (const JsonValue* dn = c.find("displayName")) cc.displayName = dn->str; bundle.cast.push_back(cc); }
    if (const JsonValue* props = b.find("properties")) for (const auto& p : props->arr) bundle.properties.push_back(parsePropDecl(p));
    if (const JsonValue* reg = b.find("scopeRegistry"))
    {
        bundle.scopeRegistry.present = true;
        if (const JsonValue* v = reg->find("version")) bundle.scopeRegistry.version = static_cast<int>(v->num);
        if (const JsonValue* scopes = reg->find("scopes"))
            for (const auto& sc : scopes->arr)
            {
                HostScopeSpec spec;
                spec.token = sc.at("token").str;
                if (const JsonValue* w = sc.find("writable")) { spec.hasWritable = true; spec.writable = w->b; }
                if (const JsonValue* decls = sc.find("declarations"))
                {
                    spec.hasDeclarations = true;
                    for (const auto& d : decls->arr) spec.declarations.push_back(parseHostDecl(d));
                }
                bundle.scopeRegistry.scopes.push_back(spec);
            }
    }
    if (const JsonValue* ext = b.find("externalScopes")) bundle.externalScopes = strList(*ext);
    if (const JsonValue* strs = b.find("strings")) bundle.strings = parseStrings(*strs);
    if (const JsonValue* gdf = b.find("gameDataFields"))
        for (const auto& kind : gdf->obj)
        {
            std::vector<GameDataField> fields;
            for (const auto& f : kind.second.arr)
            {
                GameDataField gf; gf.name = f.at("name").str; if (const JsonValue* t = f.find("type")) gf.type = t->str;
                if (const JsonValue* df = f.find("default")) { gf.hasDefault = true; gf.def = toValue(*df); }
                if (const JsonValue* vs = f.find("values")) gf.values = strList(*vs);
                fields.push_back(gf);
            }
            bundle.gameDataFields[kind.first] = fields;
        }
    for (const auto& sc : b.at("scenes").obj)
    {
        Scene scene; scene.id = sc.second.at("id").str;
        if (const JsonValue* nm = sc.second.find("name")) scene.name = nm->str;
        if (const JsonValue* gi = sc.second.find("gameId")) scene.gameId = gi->str;
        if (const JsonValue* tg = sc.second.find("tags")) scene.tags = strList(*tg);
        if (const JsonValue* sp = sc.second.find("sceneProps")) for (const auto& p : sp->arr) scene.sceneProps.push_back(parsePropDecl(p));
        if (const JsonValue* oe = sc.second.find("onEntry")) scene.onEntry = parseEffects(*oe);
        for (const auto& blk : sc.second.at("blocks").arr)
        {
            Block block; block.id = blk.at("id").str;
            if (const JsonValue* nm = blk.find("name")) block.name = nm->str;
            if (const JsonValue* gi = blk.find("gameId")) block.gameId = gi->str;
            if (const JsonValue* tg = blk.find("tags")) block.tags = strList(*tg);
            if (const JsonValue* ch = blk.find("children")) for (const auto& c : ch->arr) block.children.push_back(parseNode(c));
            scene.blocks.push_back(std::move(block));
        }
        bundle.scenes[sc.first] = std::move(scene);
    }
    return bundle;
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
static JsonValue tagsToJson(const std::vector<std::string>& tags)
{
    JsonValue a = JsonValue::Arr();
    for (const auto& t : tags) a.push(JsonValue::Str(t));
    return a;
}
static JsonValue normalize(const StepResult& s)
{
    JsonValue o = JsonValue::Obj();
    switch (s.type)
    {
        case StepType::Line:
            o.set("type", JsonValue::Str("line")); o.set("id", JsonValue::Str(s.id)); o.set("text", JsonValue::Str(s.text));
            if (s.hasCharacter) o.set("character", JsonValue::Str(s.character));
            if (s.hasCharacterName) o.set("characterName", JsonValue::Str(s.characterName));
            if (s.hasDirection) o.set("direction", JsonValue::Str(s.direction));
            if (s.gameData) o.set("gameData", gameDataToJson(*s.gameData));
            if (s.hasTags) o.set("tags", tagsToJson(s.tags));
            break;
        case StepType::Text:
            o.set("type", JsonValue::Str("text")); o.set("id", JsonValue::Str(s.id)); o.set("text", JsonValue::Str(s.text));
            if (s.gameData) o.set("gameData", gameDataToJson(*s.gameData));
            if (s.hasTags) o.set("tags", tagsToJson(s.tags));
            break;
        case StepType::GameEvent:
            o.set("type", JsonValue::Str("gameEvent")); o.set("id", JsonValue::Str(s.id));
            if (s.gameData) o.set("gameData", gameDataToJson(*s.gameData));
            if (s.hasTags) o.set("tags", tagsToJson(s.tags));
            break;
        case StepType::Choice:
        {
            o.set("type", JsonValue::Str("choice"));
            JsonValue opts = JsonValue::Arr();
            for (const auto& opt : s.options)
            {
                JsonValue od = JsonValue::Obj();
                od.set("id", JsonValue::Str(opt.id));
                if (opt.prompt) od.set("text", JsonValue::Str(opt.prompt->text));
                od.set("eligible", JsonValue::Boolean(opt.eligible));
                if (opt.gameData) od.set("gameData", gameDataToJson(*opt.gameData));
                opts.push(std::move(od));
            }
            o.set("options", std::move(opts));
            break;
        }
        case StepType::End: o.set("type", JsonValue::Str("end")); break;
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

static int runExpressions(const JsonValue& arr)
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
                else fail("expr", name, "expected an eval error, got " + actual.toDisplayString());
            }
            else if (raised)
            {
                fail("expr", name, "unexpected error: " + error);
            }
            else
            {
                PatterValue expected = toValue(c.at("expected"));
                if (actual.valueEquals(expected)) ++pass;
                else fail("expr", name, "expected " + valueToJson(expected).str + ", got " + actual.toDisplayString());
            }
        }
        catch (const std::exception& ex) { fail("expr", name, ex.what()); }
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
            if (const JsonValue* loc = c.find("locale")) opts.locale = loc->str;

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
                transcript.push(normalize(step));
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

static int envelopeRoundTrips = 0;

// Run a script's ops against a LIVE engine, returning whether every op matched and the engine that
// ends up live (saveLoad / hotSwap replace it). Shared by the scripted cases and the saves cases, whose
// engine arrives already loaded from an envelope another runtime wrote.
static std::pair<bool, std::shared_ptr<Engine>> runScript(std::shared_ptr<Engine> engine, const Bundle& bundle, const Bundle& bundleB,
    const EngineOptions& opts, const JsonValue& script, const std::string& name, std::string current)
{
    bool ok = true;
            for (const auto& op : script.arr)
            {
                JsonValue chunk = JsonValue::Arr();
                std::string kind = op.at("op").str;
                if (kind == "openFlow")
                {
                    std::string sc = op.has("scene") ? op.at("scene").str : "";
                    std::string bl = op.has("block") ? op.at("block").str : "";
                    int64_t seed = 0; const int64_t* seedP = nullptr;
                    if (const JsonValue* s = op.find("seed")) { seed = static_cast<int64_t>(s->num); seedP = &seed; }
                    engine->openFlow(op.at("flow").str, sc, bl, seedP);
                    current = op.at("flow").str;
                }
                else if (kind == "useFlow") current = op.at("flow").str;
                else if (kind == "advance") chunk.push(normalize(engine->getFlow(current)->advance()));
                else if (kind == "choose") engine->getFlow(current)->choose(op.at("id").str);
                // Host navigation by address. No transcript of its own; the next advance shows where it
                // landed. expectResult pins the returned bool.
                else if (kind == "goto")
                {
                    const bool moved = engine->getFlow(current)->gotoAddress(
                        op.at("scene").str, op.has("block") ? op.at("block").str : std::string());
                    if (op.has("expectResult") && moved != op.at("expectResult").b)
                        throw std::runtime_error("goto " + op.at("scene").str + ": unexpected result");
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
                    if (!diffState(before, snapshotState(*engine)).empty())
                        throw std::runtime_error("envelope round-trip changed flattened state");
                    ++envelopeRoundTrips;
                }
                // Live bundle refresh (spec 9.8): the whole game carried onto the EDITED bundle.
                // Through the core's own hotSwap, as the reference runner does: the bags are handed to the
                // replacement on the same registry.
                else if (kind == "hotSwap") engine = std::shared_ptr<Engine>(engine->hotSwap(bundleB));
                else if (kind == "setLocale") engine->setLocale(op.at("locale").str);
                else if (kind == "setClosedCaptions") engine->setClosedCaptions(op.at("on").b);
                else if (kind == "reset") { engine->reset(); current.clear(); }
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

                const JsonValue* expect = op.find("expect");
                bool match = expect ? matchValue(chunk, *expect) : (chunk.arr.empty());
                if (!match) { ok = false; fail("scripted", name, "op " + kind + ": mismatch (got " + dump(chunk) + ")"); break; }
            }
    return { ok, engine };
}

// JSON text of a parsed value, for handing the corpus's envelope to the save boundary as a STRING -
// which is how a game hands it over, and the only entry the boundary has.
static std::string jsonText(const JsonValue& v)
{
    using patter::loggerdetail::jsonQuote;
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
            if (runScript(engine, bundle, Bundle{}, opts, c.at("script"), name, "").first) ++pass;
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
            if (const JsonValue* bb = c.find("bundleB")) bundleB = parseBundle(*bb);
            EngineOptions opts;
            if (const JsonValue* sd = c.find("seed")) { opts.hasSeed = true; opts.seed = static_cast<int64_t>(sd->num); }
            auto engine = std::make_shared<Engine>(bundle, opts);
            if (runScript(engine, bundle, bundleB, opts, c.at("script"), name, "").first) ++pass;
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
            auto effective = effectiveGameData(gameDataFieldsFor(bundle, kind), node.get());
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
    if (sel->considered.size() != 2)
        fail("trace", "reasoning", "the select does not name both children it walked");
    else if (sel->considered[0].first != "sn_gated" || sel->considered[0].second
          || sel->considered[1].first != "sn_open" || !sel->considered[1].second)
        fail("trace", "reasoning", "the select does not say WHICH sibling was dropped");
    if (sel->picked != "sn_open") fail("trace", "picked", "the pick was not recorded");

    for (size_t i = 1; i < flow->log().size(); i++)
        if (flow->log()[i].seq <= flow->log()[i - 1].seq)
            fail("trace", "seq", "seq is not a monotonic ordering of the flow");
    for (const auto& e : engine.log())
        if (e.flow != "main") fail("trace", "flow tag", "an engine entry does not name its flow");

    engine.clearLog();
    if (!engine.log().empty()) fail("trace", "clearLog", "the engine's stream did not empty");
    if (flow->log().empty()) fail("trace", "flow-local", "clearing the engine emptied a flow's own log");

    std::cout << "  [trace] decisions logged: " << flow->log().size() << ", with the dropped sibling named\n";
}

// A small local check for Engine::listProperties() (the live-inspector contract): it isn't part of
// the shared corpus, so exercise it directly - only shared @patter decls, each with type / value /
// default / enum values, and a live setProperty reflected on the next read.
// A host-scope declaration's `writable: false` is refused by the ENGINE, whether the scope is bound by
// the game or self-backed. The JS reference always did; this core let a bound scope's set straight
// through until 2026-09-03 (from-storylets/unreal-wrapper-host-scopes). Not a corpus case: the script
// grammar has no "this op must throw", so it is pinned here beside the other checks the corpus cannot
// express. The refusal surfaces from openFlow, since a flow settles into its first snippet on open.
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
          "onEnter": [ { "kind": "set", "target": "@world.known", "value": { "src": "true", "ast": ["b", true] } },
                       { "kind": "set", "target": "@world.clock", "value": { "src": "\"night\"", "ast": ["s", "night"] } } ],
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
        Engine engine(bundle, opts);
        std::string message;
        try { engine.openFlow("main", "s", "b")->advance(); }
        catch (const std::exception& ex) { message = ex.what(); }
        if (message.find("'@world.clock' is read-only") == std::string::npos)
            fail("host-scope", label, "a story write to a writable:false declaration was not refused (got: " + (message.empty() ? "no error" : message) + ")");
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
            Engine engine(bundle, opts);
            expectThrow([&] { engine.openFlow("main", "s", "b"); }, "'@rules.cap' is read-only", label + "the story's write to a read-only scope");
            expectNumber(engine.getProperty("@rules.open"), 5, label + "a declaration writable:true inside it");
            expectNumber(engine.getProperty("@rules.cap"), 1, label + "@rules.cap after the refused write");
            engine.setProperty("@rules.cap", PatterValue::Num(3)); // the game's own write
            expectNumber(engine.getProperty("@rules.cap"), 3, label + "@rules.cap after the game's write");
        }
    });

    regCase("refuses a save version it does not read, naming it", []
    {
        auto engine = standalone(envelopeBundle(), 0);
        SaveGame save; save.version = 4;
        expectThrow([&] { engine->loadGame(save); }, "unsupported save version: 4", "a version 4 save");
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
// version 3 and in the version 2 games shipped before the registry held the properties.
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
        need(save.at("version").num == 3, "version " + dump(save.at("version")));
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

    regCase("save shape: loads a save written by HAND in today's format (version 3)", []
    {
        // Written out here rather than produced by saveGame(), so a change that alters the writer and
        // the reader together cannot satisfy it. This is what a player's save looks like on disk.
        const std::string onDisk = std::string(R"({"schema":"patter/save@0","save":{"version":3,"registry":)") + kEnvelopeRegistry
            + R"(,"sharedVisits":{"s":1,"b":1,"sn":1},"sharedSelectors":{},"flows":{"f":{"rngState":0,"visits":{"s":1,"b":1,"sn":1},"cursor":{"flowEnded":true,"currentSceneId":"s","stack":[],"activeSnippetId":null,"beatIndex":0,"pendingChoice":null,"pendingPromptOwnerId":null,"selectors":{}}}}}})";
        auto engine = standalone(envelopeBundle(), 0);
        deserializeState(*engine, onDisk);
        expectNumber(engine->getProperty("@gold"), 7, "@gold");
        need(engine->getFlow("f") != nullptr, "the flow did not come back");
        expectNumber(engine->getFlow("f")->getProperty("@scene.count"), 1, "@scene.count");
        expectNumber(engine->getFlow("f")->getProperty("@scene.tally"), 2, "@scene.tally");
        expectJson(parseJ(serializeState(*engine)), onDisk, "the re-saved envelope");
    });

    // The shape every runtime wrote before the registry held the properties. Players have these on
    // disk; they must keep loading.
    static const char* kV2 = R"({"version":2,"shared":{"patter":{"gold":7}},"sharedVisits":{"s":1,"b":1,"sn":1},"sharedSelectors":{},"stageBags":{"s":{"tally":2}},"flows":{"f":{"scopes":{"patter":{}},"sceneBags":{"s":{"count":1}},"rngState":0,"visits":{"s":1,"b":1,"sn":1},"cursor":{"flowEnded":true,"currentSceneId":"s","stack":[],"activeSnippetId":null,"beatIndex":0,"pendingChoice":null,"pendingPromptOwnerId":null,"selectors":{}}}}})";

    regCase("save shape: loads a version 2 save written by HAND, moving its values into the registry", []
    {
        auto engine = standalone(envelopeBundle(), 0);
        deserializeState(*engine, std::string(R"({"schema":"patter/save@0","save":)") + kV2 + "}");
        expectNumber(engine->getProperty("@gold"), 7, "@gold");
        need(engine->getFlow("f") != nullptr, "the flow did not come back");
        expectNumber(engine->getFlow("f")->getProperty("@scene.count"), 1, "@scene.count");
        JsonValue back = parseJ(serializeState(*engine)).at("save");
        need(back.at("version").num == 3, "re-saved as version " + dump(back.at("version")));
        expectJson(back.at("registry"), kEnvelopeRegistry, "the re-saved registry");
    });

    regCase("save shape: moves a version 2 save into a registry the game supplied, beside values the game already loaded", []
    {
        auto registry = std::make_shared<ScopeRegistry>();
        registry->load(blobOf(R"({"another-engine/deck/inn":{"drawn":3}})")); // the game's own load, waiting for its engine
        EngineOptions opts; opts.registry = registry; opts.hasSeed = true; opts.seed = 0;
        Engine engine(envelopeBundle(), opts);
        deserializeState(engine, kV2);
        need(engine.getFlow("f") != nullptr, "the flow did not come back");
        expectNumber(engine.getFlow("f")->getProperty("@scene.count"), 1, "@scene.count");
        expectJson(blobJson(registry->save()),
            R"({"patter":{"gold":7},"patter/flow/f/patter":{},"patter/flow/f/scene/s":{"count":1},"patter/scene/s":{"tally":2},"another-engine/deck/inn":{"drawn":3}})",
            "the game's registry");
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

static void runOneRegistry()
{
    runOneRegistryCases();
    runCombinedGameCases();
    runSaveEnvelopeCases();
    std::cout << "  [one-registry] the game's registry, one save, loaded in either order: " << g_regPass << "/" << g_regTotal << "\n";
    runExternalScopeCases();
}

// ----- kernel errors -----------------------------------------------------------------------------------
//
// The kernel (wildwinter::expr, shared with the Storylet Engine since 2026-09-24) throws its own
// ExprError and RegistryError, never Patterplay's. Every place the engine calls it for something that
// can refuse catches them and rethrows Patterplay's EvalError with the kernel's message, as the engine
// threw before the kernel was shared, so a game's `catch (const patter::EvalError&)` still works and no
// kernel exception crosses the plugin's API. One case per rethrow site in Engine.h, each of which fails
// (the kernel's own type arrives instead) when that site's kernelCall is removed.

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
    kernelCase("a story write the registry refuses is Patterplay's EvalError (Flow::writeProperty)", []
    {
        Bundle bundle = parseBundle(parseJ(R"JSON({"schema":"patter/bundle@0","locales":{"default":"en","included":["en"]},"strings":{"en":{"T":"hi"}},"properties":[],
          "scopeRegistry":{"version":1,"scopes":[{"token":"world","declarations":[{"name":"clock","type":"string","default":"day","writable":false}]}]},
          "scenes":{"s":{"id":"s","gameId":"s","blocks":[{"id":"b","gameId":"b","children":[{"id":"sn","type":"snippet","beats":[{"id":"T","kind":"text"}],
            "onEnter":[{"kind":"set","target":"@world.clock","value":{"src":"\"night\"","ast":["s","night"]}}],"jump":{"to":"END"}}]}]}}})JSON"));
        Engine engine(bundle);
        expectEvalError([&] { engine.openFlow("main", "s", "b")->advance(); }, "'@world.clock' is read-only", "the story's write to a read-only @world");
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

    kernelCase("an expression the evaluator refuses is Patterplay's EvalError (Flow::evalExpr)", []
    {
        Bundle bundle = parseBundle(parseJ(R"JSON({"schema":"patter/bundle@0","locales":{"default":"en","included":["en"]},"strings":{"en":{"T":"hi"}},
          "properties":[{"name":"fame","type":"number","default":0,"shared":true}],
          "scenes":{"s":{"id":"s","gameId":"s","blocks":[{"id":"b","gameId":"b","children":[{"id":"sn","type":"snippet","beats":[{"id":"T","kind":"text"}],
            "onEnter":[{"kind":"set","target":"@fame","value":{"src":"1 / 0","ast":["bin","/",["n",1],["n",0]]}}],"jump":{"to":"END"}}]}]}}})JSON"));
        Engine engine(bundle);
        expectEvalError([&] { engine.openFlow("f", "s")->advance(); }, "division by zero", "an evaluation refusal");
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

    std::cout << "  [kernel-errors] every kernel refusal reaches the game as Patterplay's EvalError: " << g_kernelPass << "/" << g_kernelTotal << "\n";
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

// Structure introspection (Engine::listOutline / beatSequence): not part of the shared corpus, so
// exercise directly on a hand-built scene -> block -> choice group -> snippets -> beats.
// describeBundle: the bundle inspector's runtime half. Not a corpus case - this adds no runtime
// behaviour, so the corpus is untouched - but the numbers have to agree with the JS reference or two
// inspectors describe the same asset differently. The fixture mirrors the one in the JS tests.
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

static void runOutlineSmoke()
{
    Bundle b;
    b.locales.defaultLocale = "en";
    b.cast.push_back(Cast{ "GUARD", "The Guard" });
    b.strings["en"]["L1"] = "Halt!";
    b.strings["en"]["T1"] = "The gate creaks.";

    auto opt1 = std::make_shared<Node>(); opt1->type = "snippet"; opt1->id = "opt1";
    { Beat beat; beat.id = "L1"; beat.kind = "line"; beat.character = "GUARD"; opt1->beats.push_back(beat); }
    opt1->jump = std::make_shared<Jump>(); opt1->jump->to = "END";
    auto opt2 = std::make_shared<Node>(); opt2->type = "snippet"; opt2->id = "opt2";
    { Beat beat; beat.id = "T1"; beat.kind = "text"; opt2->beats.push_back(beat); }
    auto group = std::make_shared<Node>(); group->type = "group"; group->id = "g1"; group->selector = "choice";
    group->children = { opt1, opt2 };
    auto sn = std::make_shared<Node>(); sn->type = "snippet"; sn->id = "sn";
    { Beat beat; beat.id = "E1"; beat.kind = "gameEvent"; sn->beats.push_back(beat); }

    Block block; block.id = "b1"; block.name = "Intro"; block.children = { group, sn };
    Scene scene; scene.id = "s1"; scene.name = "Opening"; scene.blocks = { block };
    b.scenes["s1"] = scene;

    EngineOptions opts;
    Engine engine(b, opts);

    auto outline = engine.listOutline();
    if (outline.size() != 1 || outline[0].name != "Opening") { fail("outline", "scene", "expected 1 scene 'Opening'"); return; }
    const auto& blk = outline[0].blocks.at(0);
    if (blk.children.size() != 2 || blk.children[0].type != "group" || blk.children[0].children.size() != 2)
        fail("outline", "group", "group not preserved with 2 option children");
    const auto& line = blk.children[0].children[0].beats.at(0);
    if (line.id != "L1" || line.kind != "line" || line.characterName != "The Guard" || line.text != "Halt!")
        fail("outline", "beat data", "line beat data wrong: " + line.characterName + "/" + line.text);
    if (blk.children[1].type != "snippet" || blk.children[1].jumpTo != "" ) { /* sn has no jump -> empty */ }

    auto seq = engine.beatSequence();
    std::vector<std::string> ids; for (const auto& f : seq) ids.push_back(f.beat.id);
    if (ids != std::vector<std::string>{ "L1", "T1", "E1" })
        fail("outline", "beatSequence", "flat order wrong (got " + [&]{ std::string o; for (auto& x : ids) o += x + " "; return o; }() + ")");
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
    runInspectorSmoke();
    runOneRegistry();
    runKernelErrorCases();
    runHostScopeWritableSmoke();
    runTraceLogSmoke();
    runOutlineSmoke();
    runDescribeSmoke();

    std::cout << "  [envelope] scripted save/load round-trips: " << envelopeRoundTrips << "\n";
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
        std::cout << "expr corpus v" << static_cast<int>(exprRoot.at("version").num)
            << " - prng: " << xp << "/" << xprng.arr.size()
            << "  expressions: " << xe << "/" << xexpr.arr.size() << "\n";
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
