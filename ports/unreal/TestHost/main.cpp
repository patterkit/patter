// The corpus TestHost: load corpus.json and replay every section through the C++
// Patterplay runtime, asserting the same results the JS reference produces - the port's
// half of the parity contract. Standalone (clang), no Unreal needed.
//
//   build.sh   (compiles + runs against packages/conformance/corpus.json)

#include <cstdio>
#include <cstdint>
#include <fstream>
#include <sstream>
#include <iostream>
#include <queue>
#include "Json.h"
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

static AstPtr parseAst(const JsonValue& e)
{
    const std::string& tag = e.arr[0].str;
    auto node = std::make_shared<AstNode>();
    if (tag == "b") { node->tag = AstTag::Bool; node->b = e.arr[1].b; }
    else if (tag == "n") { node->tag = AstTag::Number; node->n = e.arr[1].num; }
    else if (tag == "s") { node->tag = AstTag::Str; node->s = e.arr[1].str; }
    else if (tag == "sv") { node->tag = AstTag::ScopedVar; node->scope = e.arr[1].str; node->name = e.arr[2].str; }
    else if (tag == "u") { node->tag = AstTag::Unary; node->op = e.arr[1].str; node->operand = parseAst(e.arr[2]); }
    else if (tag == "bin") { node->tag = AstTag::Binary; node->op = e.arr[1].str; node->left = parseAst(e.arr[2]); node->right = parseAst(e.arr[3]); }
    else if (tag == "fd") { node->tag = AstTag::FlagDelta; node->sign = e.arr[1].str; node->name = e.arr[2].str; }
    else if (tag == "call") { node->tag = AstTag::Call; node->fn = e.arr[1].str; for (size_t i = 2; i < e.arr.size(); ++i) node->args.push_back(parseAst(e.arr[i])); }
    else throw std::runtime_error("unknown ast tag: " + tag);
    return node;
}

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
    return d;
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
    if (const JsonValue* v = b.find("voiced")) bundle.voiced = v->b;
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
        case JsonValue::Number: return PatterValue::jsNumber(v.num);
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
                ctx.scopes[token] = [bags, token](const std::string& n) -> const PatterValue* {
                    auto& bag = (*bags)[token]; auto it = bag.find(n); return it != bag.end() ? &it->second : nullptr;
                };
            }
            std::shared_ptr<Mulberry32> rng;
            if (const JsonValue* seed = c.find("seed")) { rng = std::make_shared<Mulberry32>(static_cast<int64_t>(seed->num)); ctx.nextRandom = [rng]() { return rng->next(); }; }
            PatterValue actual = evaluate(*node, ctx);
            PatterValue expected = toValue(c.at("expected"));
            if (actual.valueEquals(expected)) ++pass;
            else fail("expr", name, "expected " + valueToJson(expected).str + ", got " + actual.toDisplayString());
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
                ctx.scopes[token] = [bags, token](const std::string& n) -> const PatterValue* {
                    auto& bag = (*bags)[token]; auto it = bag.find(n); return it != bag.end() ? &it->second : nullptr;
                };
            }
            int actual = matchedSpec(*node, ctx, true);
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
            if (const JsonValue* seed = c.find("seed")) { rng = std::make_shared<Mulberry32>(static_cast<int64_t>(seed->num)); opts.rng = [rng]() { return rng->next(); }; }
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

static int runScripted(const JsonValue& arr)
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
                else if (kind == "saveLoad") { SaveGame blob = engine->saveGame(); engine = std::make_shared<Engine>(bundle, opts); engine->loadGame(blob); }
                // Live bundle refresh (spec 9.8): the whole game carried onto the EDITED bundle.
                else if (kind == "hotSwap") { SaveGame blob = engine->saveGame(); engine = std::make_shared<Engine>(bundleB, opts); engine->loadGame(blob); }
                else if (kind == "setLocale") engine->setLocale(op.at("locale").str);
                else if (kind == "setClosedCaptions") engine->setClosedCaptions(op.at("on").b);
                else if (kind == "reset") { engine->reset(); current.clear(); }

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

// A small local check for Engine::listProperties() (the live-inspector contract): it isn't part of
// the shared corpus, so exercise it directly - only shared @patter decls, each with type / value /
// default / enum values, and a live setProperty reflected on the next read.
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

    std::vector<std::string> refs; for (const auto& r : rows) refs.push_back(r.ref);
    if (refs != std::vector<std::string>{ "@gold", "@mood", "@notes" })
        fail("inspector", "listProperties", "unexpected refs (got " + [&]{ std::string o; for (auto& x : refs) o += x + " "; return o; }() + ")");

    if (rows[0].type != "number" || !rows[0].value.isNumber() || rows[0].value.n != 5 || rows[0].def.n != 5)
        fail("inspector", "number row", "gold row wrong: " + rows[0].value.toDisplayString());
    if (rows[1].values != std::vector<std::string>{ "calm", "tense" } || rows[1].value.s != "calm")
        fail("inspector", "enum row", "mood row wrong");
    if (rows[2].type != "flags" || !rows[2].def.isFlags() || !rows[2].def.f.empty())
        fail("inspector", "flags default", "notes default should be empty flags");

    engine.setProperty("@gold", PatterValue::Num(42));
    if (engine.listProperties()[0].value.n != 42)
        fail("inspector", "live setProperty", "gold value did not reflect setProperty");
}

// Structure introspection (Engine::listOutline / beatSequence): not part of the shared corpus, so
// exercise directly on a hand-built scene -> block -> choice group -> snippets -> beats.
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
    runOutlineSmoke();

    std::cout << "expressions: " << e << "  specificity: " << sp << "  runtime: " << r << "  scripted: " << s << "  gameData: " << g << "\n";
    std::cout << (g_fails == 0 ? "ALL PASS" : (std::to_string(g_fails) + " FAILED")) << "\n";
    return g_fails == 0 ? 0 : 1;
}
