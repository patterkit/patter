// The corpus TestHost: load corpus.json and replay every section through the C++
// Patterplay runtime, asserting the same results the JS reference produces - the port's
// half of the parity contract. Standalone (clang), no Unreal needed.
//
//   build.sh   (compiles + runs against packages/conformance/corpus.json)

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
            std::string current;
            bool ok = true;
            for (const auto& op : c.at("script").arr)
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
                else if (kind == "hotSwap") { SaveGame blob = engine->saveGame(); engine = std::make_shared<Engine>(bundleB, opts); engine->loadGame(blob); }
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
            if (ok) ++pass;
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
// The save envelope's SHAPE, checked rather than round-tripped.
//
// Scene and stage state is held in a shared PropertyBag; the SAVE is still a flat
// name -> value map per scene. A round-trip cannot tell the difference - a bag that
// serialised itself would round-trip perfectly and still break every save on disk.
// So this reads the JSON, and loads one edited by hand.
static void runSaveShapeSmoke()
{
    Bundle b;
    b.locales.defaultLocale = "en";
    b.locales.included = { "en" };
    b.strings["en"]["T"] = "hi";

    Scene scene; scene.id = "s"; scene.gameId = "s";
    { PropertyDecl d; d.name = "mood"; d.type = "string"; d.hasDefault = true; d.def = PatterValue::Str("calm");
      d.hasShared = true; d.shared = false; scene.sceneProps.push_back(d); }
    { PropertyDecl d; d.name = "alarm"; d.type = "boolean"; d.hasDefault = true; d.def = PatterValue::Bool(false);
      d.hasShared = true; d.shared = true; scene.sceneProps.push_back(d); }
    Block block; block.id = "b"; block.gameId = "b";
    auto sn = std::make_shared<Node>(); sn->id = "sn"; sn->type = "snippet";
    { Beat beat; beat.id = "T"; beat.kind = "text"; sn->beats.push_back(beat); }
    sn->jump = std::make_shared<Jump>(); sn->jump->to = "END";
    block.children.push_back(sn);
    scene.blocks.push_back(block);
    b.scenes["s"] = scene;

    EngineOptions opts;
    auto engine = std::make_shared<Engine>(b, opts);
    Flow* flow = engine->openFlow("main", "s", "b");
    for (int i = 0; i < 10; ++i) { StepResult r = flow->advance(); if (r.type == StepType::End) break; }
    flow->setProperty("@scene.mood", PatterValue::Str("tense"));

    std::string json = serializeState(*engine);
    // Flat: the values sit directly under the scene id, with no bag wrapper around them.
    if (json.find("\"stageBags\":{\"s\":{\"alarm\":") == std::string::npos)
        fail("save shape", "stage bag is flat", json);
    if (json.find("\"sceneBags\":{\"s\":{\"mood\":\"tense\"}") == std::string::npos)
        fail("save shape", "scene bag is flat", json);

    // A save edited by hand, in the format on disk today, still loads.
    std::string hand = json;
    size_t at = hand.find("\"mood\":\"tense\"");
    if (at != std::string::npos) hand.replace(at, std::string("\"mood\":\"tense\"").size(), "\"mood\":\"furious\"");
    auto engine2 = std::make_shared<Engine>(b, opts);
    deserializeState(*engine2, hand);
    Flow* f2 = engine2->getFlow("main");
    const PatterValue* got = f2 ? f2->getProperty("@scene.mood") : nullptr;
    if (!got || got->s != "furious")
        fail("save shape", "a hand-edited value loads", got ? got->toDisplayString() : "<null>");
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

static bool jsonHas(const JsonValue& obj, const std::string& key) { return obj.has(key); }

// The scope kernel's `writable` rule: decl.writable ?? scope.writable ?? true.
//
// This port has no ScopeRegistry - Patterplay mounts its host scopes by hand - so a
// case with a "scope" is run by FOLDING the scope default into each declaration that
// says nothing of its own, then seeding the bag. The fold is the rule, written down
// once; what these cases pin here is the shared PropertyBag, which is the code that
// actually refuses. The value is read back on BOTH outcomes.
static int runExprRegistry(const JsonValue& arr)
{
    int pass = 0;
    for (const auto& c : arr.arr)
    {
        std::string name = c.at("name").str;
        std::optional<bool> scopeWritable;
        if (jsonHas(c, "scope") && jsonHas(c.at("scope"), "writable")) scopeWritable = c.at("scope").at("writable").b;
        std::vector<ScopeDeclaration> decls;
        for (const auto& d : c.at("declarations").arr)
        {
            ScopeDeclaration decl;
            decl.name = d.at("name").str;
            decl.type = d.at("type").str;
            decl.defaultValue = toValue(d.at("default"));
            if (jsonHas(d, "writable")) decl.writable = d.at("writable").b;
            else decl.writable = scopeWritable;
            decls.push_back(std::move(decl));
        }
        const std::string setName = c.at("set").at("name").str;
        const PatterValue value = toValue(c.at("set").at("value"));
        const bool expectError = c.has("expectError") && c.at("expectError").b;
        const PatterValue expected = toValue(c.at("expected"));

        PropertyBag bag(&decls);
        std::optional<std::string> error;
        try { bag.set(setName, value); } catch (const std::exception& ex) { error = ex.what(); }
        std::optional<PatterValue> readBack = bag.get(setName);

        bool ok = true;
        if (expectError)
        {
            if (!error) { fail("expr/registry", name, "expected a read-only refusal, the write landed"); ok = false; }
            else if (error->find("is read-only") == std::string::npos) { fail("expr/registry", name, "refused, but not as read-only: " + *error); ok = false; }
        }
        else if (error) { fail("expr/registry", name, "unexpected refusal: " + *error); ok = false; }
        if (!readBack || !readBack->valueEquals(expected))
        {
            fail("expr/registry", name, "read back " + (readBack ? readBack->toJsonString() : std::string("<unset>")) + ", expected " + expected.toJsonString());
            ok = false;
        }
        if (ok) ++pass;
    }
    return pass;
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
    runInspectorSmoke();
    runSaveShapeSmoke();
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
        // A family the corpus carries and this harness does not run is a check
        // that cannot fail here, so a missing key is a failure, not a skip.
        if (!jsonHas(exprRoot, "registry")) { std::cerr << "expr parity corpus has no registry family\n"; return 2; }
        const JsonValue& xreg = exprRoot.at("registry");
        int xr = runExprRegistry(xreg);
        std::cout << "expr corpus v" << static_cast<int>(exprRoot.at("version").num)
            << " - prng: " << xp << "/" << xprng.arr.size()
            << "  expressions: " << xe << "/" << xexpr.arr.size()
            << "  registry: " << xr << "/" << xreg.arr.size() << "\n";
    }
    std::cout << (g_fails == 0 ? "ALL PASS" : (std::to_string(g_fails) + " FAILED")) << "\n";
    return g_fails == 0 ? 0 : 1;
}
