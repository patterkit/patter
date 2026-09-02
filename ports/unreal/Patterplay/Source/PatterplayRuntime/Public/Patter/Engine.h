// The Patterplay runtime - a faithful C++ port of @patterkit/runtime's engine.ts (via the
// corpus-verified C# port). Engine = the world + flow manager; Flow = one playable cursor.
// std-only (no Unreal types) so it compiles standalone for the clang corpus TestHost and
// inside the UE plugin alike. Header-only; all members inline.
#pragma once

#include <string>
#include <vector>
#include <map>
#include <set>
#include <memory>
#include <functional>
#include <algorithm>
#include <stdexcept>
#include <cstdint>
#include <utility>
#include <iostream>
#include "PatterValue.h"
#include "Mulberry32.h"   // ToUint32: the shared JS seed coercion
#include "Bundle.h"
#include "Ast.h"
#include "Dialect.h"        // the Patter dialect, and the shared evaluator it configures
#include "Expr/Specificity.h"  // the shared matched-constraint scorer
#include "Expr/PropertyBag.h"   // the shared state kernel: scene and stage props live in these
#include "Expr/StateLogger.h"   // LogMount: what listBags() hands a state logger
#include "Interp.h"
#include "StepResult.h"

namespace patter
{
    // ----- helpers -------------------------------------------------------------

    inline std::string toLower(const std::string& s)
    {
        std::string r = s;
        for (char& c : r) if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
        return r;
    }

    // `hostTokens` are the scopes a project DECLARES (@world and friends). They have to be passed in
    // rather than hard-coded: without them "@world.gold" splits to a @patter property literally named
    // "world.gold", which reads as absent and takes the falsy branch in silence.
    inline std::pair<std::string, std::string> splitRef(const std::string& ref,
                                                       const std::set<std::string>& hostTokens = {})
    {
        std::string body = (!ref.empty() && ref[0] == '@') ? ref.substr(1) : ref;
        size_t dot = body.find('.');
        if (dot != std::string::npos && body.find('.', dot + 1) == std::string::npos)
        {
            std::string head = body.substr(0, dot), tail = body.substr(dot + 1);
            if (head == "scene" || head == "patter" || hostTokens.count(head)) return { head, toLower(tail) };
        }
        return { "patter", toLower(body) };
    }

    // The seed value for a self-backed host property: its `default`, else the type default.
    inline PatterValue hostScopeDefault(const HostScopeDecl& d)
    {
        if (d.hasDefault) return d.def;
        if (d.type == "boolean") return PatterValue::Bool(false);
        if (d.type == "number") return PatterValue::Num(0);
        if (d.type == "string") return PatterValue::Str("");
        if (d.type == "flags") return PatterValue::Flags({});
        if (d.type == "enum") return PatterValue::Str(d.values.empty() ? "" : d.values[0]);
        if (d.type == "quality") return PatterValue::Str(d.stages.empty() ? "" : d.stages[0]); // the ladder's start
        return PatterValue::Bool(false);
    }

    // A host scope the story reads and writes: the GAME owns the value. An embedder binds one per
    // token through EngineOptions::hostScopes; a declared scope with no binding is SELF-BACKED from
    // its declaration defaults, so a standalone build plays the same story a bound one does.
    struct HostScope
    {
        // Returns nullptr when this scope has no such name (which reads as a graceful false). The
        // pointer must stay valid until the next call on this scope, exactly as patterGet's does: the
        // evaluator copies immediately, and a binding that computes values should hold its own slot.
        std::function<const PatterValue*(const std::string&)> get;
        std::function<void(const std::string&, const PatterValue&)> set;
    };

    // The self-backed fallback. Keyed LOWER CASE, which is load-bearing rather than tidy: the compiler
    // folds every property reference, so an AST reads "isnight" where the declaration says "isNight".
    // Seeding verbatim means a declared name carrying a capital is never found, reads as absent, and
    // silently takes the falsy branch - the bug the JS runtime shipped (fixed 2026-08-18) and this port
    // must not repeat. An OPAQUE scope (no `declarations`) starts empty and accepts any name.
    inline HostScope selfBackedScope(const HostScopeSpec& spec)
    {
        auto bag = std::make_shared<std::map<std::string, PatterValue>>();
        for (const HostScopeDecl& d : spec.declarations)
            if (!d.name.empty()) (*bag)[toLower(d.name)] = hostScopeDefault(d);
        HostScope s;
        // Pointers into a std::map stay valid across inserts, so the bag is its own stable storage.
        s.get = [bag](const std::string& n) -> const PatterValue* {
            auto it = bag->find(toLower(n));
            return it != bag->end() ? &it->second : nullptr;
        };
        s.set = [bag](const std::string& n, const PatterValue& v) { (*bag)[toLower(n)] = v; };
        return s;
    }

    inline PatterValue propDefault(const PropertyDecl& d)
    {
        if (d.hasDefault) return d.def;
        if (d.type == "boolean") return PatterValue::Bool(false);
        if (d.type == "number") return PatterValue::Num(0);
        if (d.type == "string") return PatterValue::Str("");
        if (d.type == "flags") return PatterValue::Flags({});
        if (d.type == "enum") return PatterValue::Str(d.values.empty() ? "" : d.values[0]);
        if (d.type == "quality") return PatterValue::Str(d.stages.empty() ? "" : d.stages[0]); // the ladder's start
        return PatterValue::Bool(false);
    }

    // One shared @patter property for a live state inspector: ref, type, current value, declared
    // default (for reset-to-default), and enum options.
    //
    // The shared kernel's PropertyRow (Expr/PropertyBag.h) IS this row - name, type, value,
    // defaultValue, enum values, the quality ladder, writable. Patter adds one thing: `path`,
    // the addressable reference getProperty/setProperty take. So this extends rather than
    // restates it, exactly as the JS runtime does with the same shared row.
    // It was a full copy until 2026-09-02, which is how `def` and `defaultValue` came to be
    // two names for one field.
    // PropertyView is gone. It was the shared PropertyRow plus a `path`, and `path` moved
    // onto that row on 2026-09-02 - so the name was a synonym, and a synonym for a shared
    // type is how the two families drifted: the same row called PropertyView here,
    // ScopePropertyRow there, PropertyRow in the kernel. listProperties() returns PropertyRow.

    // Static structure introspection (editor / dev tooling): a read-only view of the AUTHORED tree
    // (scenes -> blocks -> groups/snippets -> beats), mirroring the JS BeatInfo / OutlineNode / etc.
    struct OutlineBeat
    {
        std::string id, kind, character, characterName, direction, text;
        std::vector<std::pair<std::string, PatterValue>> gameData;   // author overrides (raw)
        std::vector<std::string> tags;                               // accumulated
    };
    struct OutlineNode
    {
        std::string type, id;                     // "group" | "snippet"
        std::vector<std::string> tags;
        // group
        std::string selector;
        bool hasPrompt = false;
        OutlineBeat prompt;
        std::vector<OutlineNode> children;
        // snippet
        std::vector<OutlineBeat> beats;
        std::string jumpTo, jumpMode;
    };
    struct OutlineBlock { std::string id, gameId, name; std::vector<std::string> tags; std::vector<OutlineNode> children; };
    struct OutlineScene { std::string id, gameId, name; std::vector<std::string> tags; std::vector<OutlineBlock> blocks; };
    struct OutlineFlatBeat { std::string sceneId, blockId, snippetId; OutlineBeat beat; };

    inline std::string gameIdify(const std::string& text)
    {
        std::string s = toLower(text), tmp;
        for (size_t i = 0; i < s.size(); ++i)
        {
            unsigned char c = static_cast<unsigned char>(s[i]);
            if (c == '\'') continue;                      // drop apostrophes (incl. the ASCII one)
            bool keep = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-';
            tmp += keep ? static_cast<char>(c) : '-';
        }
        // collapse runs of '-' and trim.
        std::string out; bool prevDash = true;
        for (char c : tmp)
        {
            if (c == '-') { if (!prevDash) { out += '-'; prevDash = true; } }
            else { out += c; prevDash = false; }
        }
        while (!out.empty() && out.back() == '-') out.pop_back();
        return out;
    }

    inline std::string effectiveGameId(const std::string& gameId, const std::string& name)
    {
        std::string g = gameId;
        // trim
        size_t a = g.find_first_not_of(" \t"); size_t b = g.find_last_not_of(" \t");
        g = (a == std::string::npos) ? "" : g.substr(a, b - a + 1);
        return !g.empty() ? g : gameIdify(name);
    }

    inline void walkNodes(const std::vector<NodePtr>& nodes, const std::function<void(const Node*)>& visit)
    {
        for (const auto& n : nodes)
        {
            visit(n.get());
            if (n->isGroup()) walkNodes(n->children, visit);
        }
    }

    /** Truthiness for a bare condition. One line, because the rule is on the
     *  SHARED value type. */
    inline bool truthy(const PatterValue& v) { return v.truthy(); }

    // matched-specificity: how many atomic constraints are actively holding this condition TRUE against
    // the live state, walked with a De-Morgan polarity flag (parity contract, mirrors the JS reference).
    // Matched-constraint specificity is the SHARED scorer (Patter/Expr/Specificity.h,
    // vendored from expr/ports/unreal). Until 2026-09-01 it was inline here and the
    // Storylet Engine had its own module: one scorer, six hand transliterations. It
    // takes truthiness as a callback, so it never needed to know a value type, a
    // dialect or a scope, which makes it the purest thing in the family to share.
    inline int matchedSpec(const AstPtr& nodePtr, EvalContext& ctx, bool want)
    {
        return MatchedSpecificity(nodePtr, [&ctx](const AstPtr& n)
        {
            try { return truthy(Evaluate(n, ctx, PatterDialect())); }
            catch (const std::exception&) { return false; }   // an eval error scores as false
        }, want);
    }

    // ----- save records --------------------------------------------------------

    // `nextId` is SNAPSHOT-ONLY (never set on a live frame): the id of the child at `index` when the
    // save was taken. Restore re-finds the child by this id, so a save survives siblings inserted /
    // removed / reordered before the cursor (live bundle refresh / patched-game saves, spec 9.8);
    // empty falls back to the raw index. Mirrors the JS runtime's StackFrame.nextId.
    struct StackFrame { std::string sceneId, containerId; int index = 0; std::string nextId; };

    struct SelectorState
    {
        int seq = 0;                  // sequential cursor (0 = unstarted; matches `?? 0`)
        bool bagInit = false;         // false = the shuffle bag has not been filled
        std::vector<std::string> bag;
        bool hasLast = false; std::string last;
    };

    // ---- bags <-> the save envelope -----------------------------------------
    //
    // Scene and stage state lives in a PropertyBag; the SAVE stays a flat name -> value
    // map per scene. The bag is a runtime detail, the envelope is a contract with every
    // save already on disk.

    /** A bundle PropertyDecl as the shared kernel's ScopeDeclaration: the same property in
     *  the two vocabularies. `temporary` and `shared` are the engine's business, not the bag's. */
    inline ScopeDeclaration toScopeDecl(const PropertyDecl& d)
    {
        ScopeDeclaration sd;
        sd.name = d.name;
        sd.type = d.type;
        if (!d.values.empty()) sd.values = d.values;
        if (!d.stages.empty()) sd.stages = d.stages;
        if (d.hasDefault) sd.defaultValue = d.def;
        return sd;
    }

    /** One half of a scene's props: the shared ones (stage bag) or the rest (scene bag). */
    inline std::vector<ScopeDeclaration> declsFor(
        const std::vector<PropertyDecl>& props, const std::set<std::string>* shared, bool wantShared)
    {
        std::vector<ScopeDeclaration> out;
        for (const auto& d : props)
        {
            bool isShared = shared && shared->count(toLower(d.name)) > 0;
            if (isShared == wantShared) out.push_back(toScopeDecl(d));
        }
        return out;
    }

    /** The @patter globals bag: prefixed "@patter.", which is both the address a row reports
     *  and the log path - there is one shared globals bag. */
    inline std::shared_ptr<PropertyBag> makeSharedPatter(const std::vector<PropertyDecl>& props)
    {
        std::vector<ScopeDeclaration> decls;
        for (const auto& d : props) decls.push_back(toScopeDecl(d));
        return std::make_shared<PropertyBag>(&decls, nullptr, "@patter.");
    }

    /** One bag as the flat name/value map the save envelope carries, and back. */
    inline std::map<std::string, PatterValue> flatOf(const PropertyBag& bag)
    {
        std::map<std::string, PatterValue> flat;
        for (const auto& e : bag.save()) flat[e.first] = e.second;
        return flat;
    }

    inline OrderedMap<std::string, PatterValue> orderedOf(const std::map<std::string, PatterValue>& flat)
    {
        OrderedMap<std::string, PatterValue> values;
        for (const auto& e : flat) values.set(e.first, e.second);
        return values;
    }

    inline std::map<std::string, std::map<std::string, PatterValue>> saveBags(
        const std::map<std::string, std::shared_ptr<PropertyBag>>& bags)
    {
        std::map<std::string, std::map<std::string, PatterValue>> out;
        for (const auto& kv : bags)
        {
            std::map<std::string, PatterValue> flat;
            for (const auto& e : kv.second->save()) flat[e.first] = e.second;
            out[kv.first] = flat;
        }
        return out;
    }

    struct FlowSnapshot
    {
        std::map<std::string, PatterValue> scopes;                                  // not-shared @patter
        std::map<std::string, std::map<std::string, PatterValue>> sceneBags;
        uint32_t rngState = 0;
        std::map<std::string, int> visits;
        bool flowEnded = false;
        std::string currentSceneId;                                                 // "" = none
        std::vector<StackFrame> stack;
        std::string activeSnippetId;                                                // "" = none
        int beatIndex = 0;
        std::string pendingGroupId;
        std::vector<ChoiceOption> pendingOptions;                                   // empty = no pending choice
        std::string pendingPromptOwnerId;                                           // chosen option owning a prompt still to replay (save in the choose->advance window)
        std::map<std::string, SelectorState> selectors;
    };

    struct SaveGame
    {
        int version = 2;
        std::map<std::string, PatterValue> shared;
        std::map<std::string, int> sharedVisits;
        std::map<std::string, SelectorState> sharedSelectors;
        std::map<std::string, std::map<std::string, PatterValue>> stageBags;
        std::map<std::string, FlowSnapshot> flows;
    };

    // ----- the shared host context the Engine hands to every flow --------------

    /// One retained decision: what the engine CHOSE, not what it produced. `type` is
    /// select | choice | chose | dry | jump | write; `seq` is monotonic across the flow and
    /// survives clearLog. Parity with the JS runtime's LogEntry.
    struct LogEntry
    {
        std::string type;
        int seq = 0;
        std::string scene;
        /// The flow this happened in. Set on the ENGINE's stream, where a run is several
        /// flows in one order; empty on a flow's own log, which already says whose it is.
        std::string flow;
        /// Group / target / jump destination, whichever the type names.
        std::string subject;
        /// Every child or option considered, WITH ITS VERDICT: the reasoning, not just the
        /// outcome. "Why is my line missing" is only answerable from this.
        std::vector<std::pair<std::string, bool>> considered;
        std::string picked;
        std::string selector;
        std::string detail;
        PatterValue value;
        bool hasPrev = false;
        PatterValue prev;
    };

    struct FlowHost
    {
        /// True when the run asked for a log; flows skip building entries otherwise.
        bool logEnabled = false;
        /// The engine's ordered stream, shared by pointer so a flow appends without holding
        /// the engine.
        std::vector<LogEntry>* engineLog = nullptr;
        /// Called with the group id when a choice runs dry - no takeable option and no
        /// eligible fallback - so the silent fall-through is observable. Parity with the JS
        /// runtime's onDryChoice, which the three ports never had. Live feedback, distinct
        /// from the log's `dry` entry.
        std::function<void(const std::string&)> onDryChoice;
        const Bundle* bundle = nullptr;
        bool emitIds = false; // IDs-only build: emit beat IDs + omit character names (the game localises)
        std::map<std::string, std::string> strings;
        std::map<std::string, std::string> defaultStrings;
        std::map<std::string, std::string> castDisplay;
        std::map<std::string, const Node*> nodeIndex;
        std::map<std::string, std::string> blockToScene;
        std::map<std::string, const Block*> blockById;
        // Host-facing addresses (spec §6), shared with the engine: scene gameId -> internal id, and
        // per-scene block gameId -> internal id. A flow needs them to resolve goto by address.
        std::map<std::string, std::string> sceneGameIdToId;
        std::map<std::string, std::map<std::string, std::string>> blockGameIdToId;
        std::map<std::string, std::vector<std::string>> tagIndex;   // author tags (#215): node id -> accumulated
        /** The @patter globals. A bag, not a map: it carries the audit hook a state logger
         *  pushes from, and the clone guard on a mutable default. Shared by pointer so a flow
         *  writes through the same one. */
        std::shared_ptr<PropertyBag> sharedPatter;
        std::vector<PropertyDecl> patterSharedDecls;
        std::vector<PropertyDecl> patterLocalDecls;
        std::set<std::string> patterSharedNames;
        std::map<std::string, std::set<std::string>> sceneSharedNames;
        std::map<std::string, int> sharedVisits;
        std::map<std::string, SelectorState> sharedSelectors;
        std::map<std::string, std::shared_ptr<PropertyBag>> stageBags;
        // Host scopes by token, already resolved: an embedder's binding where one was given, a
        // self-backed bag for every other token the bundle declares. Empty for a bundle with none.
        std::map<std::string, HostScope> hostScopes;
        std::set<std::string> hostTokens;
        std::function<double()> customRng;
        bool replayPromptOnChoose = false;
        // Closed captions (#214): captionsOn shows cues in dialogue lines (default true); when false the
        // engine strips captionOpen..captionClose spans from line text. Mutable via setClosedCaptions.
        bool captionsOn = true;
        std::string captionOpen = "[";  // default: square brackets (#214)
        std::string captionClose = "]";
        std::string captionCharacter = "SFX"; // a cast member whose whole lines are captions (silent when off)
    };

    struct EngineOptions
    {
        std::function<double()> rng;                  // shared custom PRNG (runtime corpus cases)
        bool hasSeed = false; double seed = 0;        // per-flow built-in PRNG (scripted corpus cases)
        std::string locale;
        bool replayPromptOnChoose = false;
        bool closedCaptions = true;                   // #214: show caption cues in dialogue lines (default)
        /// Retain a trace of the engine's DECISIONS, readable through log(). Off by default:
        /// a shipped game pays nothing for a debugging surface it never reads.
        bool log = false;
        /// Fired with the choice's group id whenever a choice runs dry. Unaffected by `log`
        /// and useful with it off: live feedback, not an audit read afterwards.
        std::function<void(const std::string&)> onDryChoice;
        // Live game state per host-scope token ("world" -> your resolver). A binding WINS over the
        // self-backed bag for that token; declared tokens you do not bind are self-backed.
        std::map<std::string, HostScope> hostScopes;
    };

    // ----- Flow ----------------------------------------------------------------

    // The result of advanceToStop: every beat played on the way to a stop, plus the terminal
    // choice / end that stopped it.
    struct AdvanceToStopResult
    {
        std::vector<StepResult> played;
        StepResult stop;
    };

    /** The reverse of saveBags: seed each bag from the BUNDLE's declarations, then lay the
     *  saved values over. A property the save predates keeps its declared default rather than
     *  vanishing, and one the bundle has since dropped lands as a stray. */
    inline std::map<std::string, std::shared_ptr<PropertyBag>> loadBags(
        const FlowHost& host,
        const std::map<std::string, std::map<std::string, PatterValue>>& saved,
        bool wantShared)
    {
        std::map<std::string, std::shared_ptr<PropertyBag>> out;
        for (const auto& kv : saved)
        {
            const std::set<std::string>* shared = nullptr;
            auto sn = host.sceneSharedNames.find(kv.first);
            if (sn != host.sceneSharedNames.end()) shared = &sn->second;

            std::vector<ScopeDeclaration> decls;
            if (host.bundle)
            {
                auto sc = host.bundle->scenes.find(kv.first);
                if (sc != host.bundle->scenes.end()) decls = declsFor(sc->second.sceneProps, shared, wantShared);
            }
            auto bag = std::make_shared<PropertyBag>(&decls);
            OrderedMap<std::string, PatterValue> values;
            for (const auto& e : kv.second) values.set(e.first, e.second);
            bag->load(values);
            out.emplace(kv.first, std::move(bag));
        }
        return out;
    }

    class Flow
    {
    public:
        Flow(std::string id, FlowHost* host, double seed) : id_(std::move(id)), host_(host)
        {
            rngState_ = Mulberry32::ToUint32(seed);
            local_ = freshLocal();
            // FnScope wraps a lambda as the shared IScopeSource. `get` returns an
            // optional rather than a pointer, because the Storylet Engine's scopes
            // compose values on the fly and cannot hand back a stable address.
            auto fnScope = [](std::function<const PatterValue*(const std::string&)> f)
            {
                return std::make_shared<FnScope>([f](const std::string& n) -> std::optional<PatterValue>
                {
                    const PatterValue* v = f(n);
                    return v ? std::optional<PatterValue>(*v) : std::nullopt;
                });
            };
            evalCtx_.scopes["patter"] = fnScope([this](const std::string& n) { return patterGet(n); });
            evalCtx_.scopes["scene"] = fnScope([this](const std::string& n) { return sceneGet(n); });
            // Declared host scopes (@world): bound by the embedder or self-backed by the engine.
            // Registering them is what stops "@world.x" reading as a graceful false.
            for (const auto& kv : host_->hostScopes)
            {
                const HostScope* scope = &kv.second;
                evalCtx_.scopes[kv.first] = fnScope([scope](const std::string& n) { return scope->get(n); });
            }
            // The dialect's host hooks. The shared EvalContext carries them as an
            // opaque `const void*`; PatterDialect casts it back to PatterHost.
            evalHost_.nextRandom = [this]() { return rng(); };
            evalHost_.visits = [this](const std::string& id) { auto it = visitCounts_.find(id); return it != visitCounts_.end() ? it->second : 0; };
            evalHost_.patterVisits = [this](const std::string& id) { auto it = host_->sharedVisits.find(id); return it != host_->sharedVisits.end() ? it->second : 0; };
            evalCtx_.host = &evalHost_;
            // The quality channel: a property's stage ladder, from wherever the declaration lives -
            // @patter decls, the CURRENT scene's decls (they move with the flow), or a host scope.
            evalCtx_.qualities = [this](const std::string& scope, const std::string& name) { return stagesFor(scope, name); };
        }
        Flow(const Flow&) = delete;
        Flow& operator=(const Flow&) = delete;

        const std::string& currentScene() const { return currentSceneId_; }

        // The stage ladder of `@scope.name` when it is a declared quality, else null. Names compare
        // lowercase, as the compiler emits references. Mirrors the JS Flow.stagesFor.
        const std::vector<std::string>* stagesFor(const std::string& scope, const std::string& name) const
        {
            const std::string key = toLower(name);
            auto fromProps = [&key](const std::vector<PropertyDecl>& decls) -> const std::vector<std::string>* {
                for (const auto& d : decls) if (d.type == "quality" && toLower(d.name) == key) return &d.stages;
                return nullptr;
            };
            if (scope == "patter")
            {
                if (const auto* s = fromProps(host_->patterSharedDecls)) return s;
                return fromProps(host_->patterLocalDecls);
            }
            if (scope == "scene")
            {
                auto it = host_->bundle->scenes.find(currentSceneId_);
                if (it == host_->bundle->scenes.end()) return nullptr;
                return fromProps(it->second.sceneProps);
            }
            for (const auto& spec : host_->bundle->scopeRegistry.scopes)
            {
                if (spec.token != scope) continue;
                for (const auto& d : spec.declarations)
                    if (d.type == "quality" && toLower(d.name) == key) return &d.stages;
                return nullptr;
            }
            return nullptr;
        }

        // The options of the choice currently waiting for the player, empty when none is pending. The same
        // list the `choice` step carries - re-readable, e.g. after restoring a save.
        std::vector<ChoiceOption> getChoices() const { return hasPendingChoice_ ? pendingOptions_ : std::vector<ChoiceOption>{}; }

        // Advance repeatedly, collecting every played beat, until a choice or the end - the "play to the
        // next stop" a host's play UI / tooling wants. The terminal choice / end is returned as `stop`;
        // `played` holds the line / text / game-event results walked on the way to it. Termination is
        // guaranteed (each advance makes progress, or settle throws on a contentless jump cycle).
        AdvanceToStopResult advanceToStop()
        {
            AdvanceToStopResult res;
            for (;;)
            {
                StepResult r = advance();
                if (r.type == StepType::Choice || r.type == StepType::End) { res.stop = r; return res; }
                res.played.push_back(r);
            }
        }

        // Send this flow's cursor to an ADDRESS, exactly as an authored `go` jump would: the target scene's
        // onEntry runs, entering counts as a visit, and the callstack is REPLACED (pending call-returns
        // discarded). `scene`/`block` are host-facing gameIds (spec §6) or internal ids; `block` is
        // scene-scoped. "END" ends the flow. HOST navigation, so it lands IMMEDIATELY: the rest of the
        // snippet being delivered is abandoned and a pending choice dropped. An unstarted flow starts here;
        // an ended one resumes. Returns false - cursor untouched - if the address does not resolve.
        // MOVES, never resets.
        bool gotoAddress(const std::string& scene, const std::string& block = "")
        {
            if (closed_) return false; // closed is terminal: unlike "ended", a goto cannot revive it
            if (scene == "END")
            {
                started_ = true; clearPending(); pendingPromptBeat_ = nullptr; pendingPromptOwnerId_.clear();
                activeSnippet_ = nullptr; beatIndex_ = 0;
                flowEnded_ = true; stack_.clear();
                return true;
            }
            // Resolve BOTH addresses before touching state, so a bad one is a no-op, not a half-move.
            std::string sceneId;
            auto sit = host_->sceneGameIdToId.find(scene);
            if (sit != host_->sceneGameIdToId.end()) sceneId = sit->second;
            else if (host_->bundle->scenes.count(scene)) sceneId = scene;
            if (sceneId.empty()) return false;

            std::string blockId;
            if (!block.empty())
            {
                auto ait = host_->blockGameIdToId.find(sceneId);
                if (ait != host_->blockGameIdToId.end())
                {
                    auto bit = ait->second.find(block);
                    if (bit != ait->second.end()) blockId = bit->second;
                }
                if (blockId.empty())
                {
                    auto owner = host_->blockToScene.find(block);
                    if (owner != host_->blockToScene.end() && owner->second == sceneId) blockId = block;
                }
                if (blockId.empty()) return false; // a block address is scene-scoped: unknown HERE is unknown
            }
            if (!started_) { start(sceneId, blockId); return true; }

            clearPending(); pendingPromptBeat_ = nullptr; pendingPromptOwnerId_.clear();
            activeSnippet_ = nullptr; beatIndex_ = 0; // abandon the rest of the snippet being delivered
            flowEnded_ = false;                       // an ended flow resumes at the target
            enterTarget(blockId.empty() ? sceneId : blockId, "jump"); // replace the stack, like an authored goto
            settle();
            return true;
        }

        // Finish this flow for good. Engine-managed (closeFlow, reset, and the openFlow replace path). A
        // dropped flow used to stay fully live, so a host still holding it could keep advancing it and move
        // shared state. Closing makes that stale reference inert. Terminal: never revived.
        void close()
        {
            closed_ = true;
            flowEnded_ = true;
            stack_.clear();
            activeSnippet_ = nullptr;
            beatIndex_ = 0;
            clearPending();
            pendingPromptBeat_ = nullptr;
            pendingPromptOwnerId_.clear();
        }

        bool isClosed() const { return closed_; }
        bool isEnded() const { return flowEnded_; }

        void start(const std::string& sceneId, const std::string& blockId)
        {
            sceneBags_.clear();
            local_ = freshLocal();
            selectors_.clear();
            visitCounts_.clear();
            stack_.clear();
            currentSceneId_.clear();
            flowEnded_ = false;
            activeSnippet_ = nullptr;
            beatIndex_ = 0;
            clearPending();
            started_ = true;

            if (!blockId.empty())
            {
                auto it = host_->blockToScene.find(blockId);
                if (it == host_->blockToScene.end()) throw std::runtime_error("unknown block: " + blockId);
                enterSceneSetup(it->second);
                stack_.push_back({ it->second, blockId, 0, "" });
                enter(blockId);
            }
            else
            {
                std::string id = sceneId;
                if (id.empty() && !host_->bundle->scenes.empty()) id = host_->bundle->scenes.begin()->first;
                auto it = host_->bundle->scenes.find(id);
                if (it == host_->bundle->scenes.end()) throw std::runtime_error(id.empty() ? "no scenes in bundle" : ("unknown scene: " + id));
                enterSceneSetup(id);
                if (!it->second.blocks.empty())
                {
                    const Block& first = it->second.blocks.front();
                    stack_.push_back({ id, first.id, 0, "" });
                    enter(first.id);
                }
            }
            settle();
        }

        StepResult advance()
        {
            if (closed_) { StepResult r; r.type = StepType::End; return r; } // a stale reference drives nothing
            if (!started_) throw std::runtime_error("flow has not been started");
            if (pendingPromptBeat_) { const Beat* b = pendingPromptBeat_; pendingPromptBeat_ = nullptr; pendingPromptOwnerId_.clear(); return beatResult(*b); }
            settle();
            if (flowEnded_) return StepResult::End();
            if (hasPendingChoice_)
            {
                StepResult r; r.type = StepType::Choice; r.groupId = pendingGroupId_; r.options = pendingOptions_; return r;
            }
            if (!activeSnippet_) { flowEnded_ = true; return StepResult::End(); }
            return beatResult(activeSnippet_->beats[beatIndex_++]);
        }

        /// This flow's decisions, in order. Empty unless the run was opened with
        /// EngineOptions::log. The engine's log carries the same events tagged with the flow.
        const std::vector<LogEntry>& log() const { return log_; }

        /// Drop the retained entries. `seq` keeps counting, so order survives a clear.
        void clearLog() { log_.clear(); }

    private:
        /// Record one decision, on this flow's log and the engine's. Cheap with logging off:
        /// the entry is never built. The engine's vector is appended to through a pointer -
        /// nothing captures the engine, which is the shape Godot's weak debug registry forced.
        void emit(LogEntry e)
        {
            if (!host_->logEnabled) return;
            e.scene = currentSceneId_;
            e.seq = seq_++;
            log_.push_back(e);
            if (host_->engineLog)
            {
                LogEntry wide = e;
                wide.flow = id_;
                wide.seq = static_cast<int>(host_->engineLog->size());
                host_->engineLog->push_back(std::move(wide));
            }
        }

    public:
        void choose(const std::string& id)
        {
            if (!hasPendingChoice_) throw std::runtime_error("no choice is pending");
            const ChoiceOption* option = nullptr;
            for (auto& o : pendingOptions_) if (o.id == id) { option = &o; break; }
            if (!option) throw std::runtime_error("unknown choice option: " + id);
            if (!option->eligible) throw std::runtime_error("choice option is not eligible: " + id);
            const Node* node = pendingById_[id];
            { LogEntry e; e.type = "chose"; e.subject = pendingGroupId_; e.picked = id; emit(std::move(e)); }
            const Node* picked = node;
            clearPending();
            pendingPromptBeat_ = host_->replayPromptOnChoose ? promptBeatOf(picked) : nullptr;
            pendingPromptOwnerId_ = pendingPromptBeat_ ? picked->id : "";
            enterChild(picked);
        }

        const PatterValue* getProperty(const std::string& ref) const
        {
            auto sp = splitRef(ref, host_->hostTokens);
            if (sp.first == "patter") return patterGet(sp.second);
            if (sp.first == "scene") return sceneGet(sp.second);
            auto hs = host_->hostScopes.find(sp.first);
            return hs != host_->hostScopes.end() ? hs->second.get(sp.second) : nullptr;
        }

        void setProperty(const std::string& ref, const PatterValue& value)
        {
            auto sp = splitRef(ref, host_->hostTokens);
            if (sp.first == "patter") patterSet(sp.second, value);
            else if (auto hs = host_->hostScopes.find(sp.first); hs != host_->hostScopes.end()) hs->second.set(sp.second, value);
            else if (sp.first == "scene")
            {
                if (currentSceneId_.empty()) throw std::runtime_error("'" + ref + "': the flow has not entered a scene yet");
                sceneSet(sp.second, value);
            }
        }

        // Expand {@ref} slots against this flow's CURRENT state. An IDs-only game calls this on a string it
        // looked up in its OWN loc system for a beat id the engine emitted, to apply property replacement.
        std::string interpolate(const std::string& text) { return interp(text); }

        // Apply the project's caption rule UNCONDITIONALLY (#214). Public so an IDs-only game can match the
        // embedded runtime: stripCaptions(interpolate(text)) when its captions are off.
        std::string stripCaptions(const std::string& text) { return patter::stripCaptions(text, host_->captionOpen, host_->captionClose); }

        // -- save / restore --
        /** THIS flow's own kernel bags: its not-shared @patter half and its per-scene @scene
         *  props, each prefixed with the flow id so one path space holds every flow. The shared
         *  halves are the Engine's listBags. */
        std::vector<LogMount> listBags()
        {
            std::vector<LogMount> mounts;
            mounts.push_back(LogMount{local_, id_ + "/@patter."});
            for (auto& kv : sceneBags_)
            {
                mounts.push_back(LogMount{kv.second, id_ + "/@scene:" + kv.first + "."});
            }
            return mounts;
        }

        FlowSnapshot snapshot() const
        {
            FlowSnapshot s;
            s.scopes = flatOf(*local_);
            s.sceneBags = saveBags(sceneBags_);
            s.rngState = rngState_;
            s.visits = visitCounts_;
            s.flowEnded = flowEnded_;
            s.currentSceneId = currentSceneId_;
            // Stamp each frame with the id of the child it would run next, so a restore against an
            // EDITED bundle re-finds the position by id instead of trusting the raw index (spec 9.8).
            s.stack = stack_;
            for (auto& frame : s.stack)
            {
                const std::vector<NodePtr>* children = childrenOf(frame.containerId);
                if (children && frame.index >= 0 && frame.index < static_cast<int>(children->size()))
                    frame.nextId = (*children)[frame.index]->id;
            }
            s.activeSnippetId = activeSnippet_ ? activeSnippet_->id : "";
            s.beatIndex = beatIndex_;
            if (hasPendingChoice_) { s.pendingGroupId = pendingGroupId_; s.pendingOptions = pendingOptions_; }
            s.pendingPromptOwnerId = pendingPromptOwnerId_;
            s.selectors = selectors_;
            return s;
        }

        void restore(const FlowSnapshot& snap)
        {
            rngState_ = snap.rngState;
            visitCounts_ = snap.visits;
            started_ = true;
            flowEnded_ = snap.flowEnded;
            beatIndex_ = snap.beatIndex;
            currentSceneId_ = snap.currentSceneId;
            // Re-bind each frame to the CURRENT bundle: prefer the saved next-child id (survives
            // siblings inserted / removed / reordered before the cursor); fall back to the raw index
            // when absent or its node drifted out of the bundle (spec 9.8 best-effort).
            stack_ = snap.stack;
            for (auto& frame : stack_)
            {
                if (!frame.nextId.empty())
                {
                    const std::vector<NodePtr>* children = childrenOf(frame.containerId);
                    if (children)
                        for (size_t i = 0; i < children->size(); i++)
                            if ((*children)[i]->id == frame.nextId) { frame.index = static_cast<int>(i); break; }
                }
                frame.nextId.clear(); // live frames never carry it
            }
            sceneBags_ = loadBags(*host_, snap.sceneBags, false);
            local_ = freshLocal();
            local_->load(orderedOf(snap.scopes));

            activeSnippet_ = nullptr;
            if (!snap.activeSnippetId.empty())
            {
                auto it = host_->nodeIndex.find(snap.activeSnippetId);
                if (it != host_->nodeIndex.end() && it->second->isSnippet()) activeSnippet_ = it->second;
            }
            selectors_ = snap.selectors;

            clearPending();
            if (!snap.pendingOptions.empty())
            {
                std::vector<ChoiceOption> options;
                std::map<std::string, const Node*> byId;
                for (const auto& o : snap.pendingOptions)
                {
                    auto it = host_->nodeIndex.find(o.id);
                    if (it == host_->nodeIndex.end()) continue;
                    byId[o.id] = it->second;
                    options.push_back(o);
                }
                if (!options.empty()) { hasPendingChoice_ = true; pendingGroupId_ = snap.pendingGroupId; pendingOptions_ = options; pendingById_ = byId; }
            }

            // A save taken between choose() and the next advance() left a prompt still to be replayed;
            // re-derive it from the chosen option (dropped if that option drifted out of the bundle).
            pendingPromptBeat_ = nullptr;
            pendingPromptOwnerId_ = snap.pendingPromptOwnerId;
            if (!pendingPromptOwnerId_.empty())
            {
                auto it = host_->nodeIndex.find(pendingPromptOwnerId_);
                if (it != host_->nodeIndex.end()) pendingPromptBeat_ = promptBeatOf(it->second);
            }
            if (!pendingPromptBeat_) pendingPromptOwnerId_.clear();
        }

    private:
        std::string id_;
        FlowHost* host_;
        std::vector<LogEntry> log_;
        /// Monotonic across the flow's life; survives clearLog so order is stable.
        int seq_ = 0;
        std::shared_ptr<PropertyBag> local_;   // this flow's not-shared @patter half
        std::map<std::string, std::shared_ptr<PropertyBag>> sceneBags_;
        uint32_t rngState_ = 0;
        bool started_ = false, flowEnded_ = false;
        // Closed by the engine (see close()). Terminal, and distinct from flowEnded_: an ENDED flow is
        // merely out of content and goto revives it; a CLOSED one is finished for good.
        bool closed_ = false;
        std::string currentSceneId_;
        std::vector<StackFrame> stack_;
        const Node* activeSnippet_ = nullptr;
        int beatIndex_ = 0;
        bool hasPendingChoice_ = false;
        std::string pendingGroupId_;
        std::vector<ChoiceOption> pendingOptions_;
        std::map<std::string, const Node*> pendingById_;
        const Beat* pendingPromptBeat_ = nullptr;
        std::string pendingPromptOwnerId_;                                          // owner of pendingPromptBeat_, re-derivable across a save in the choose->advance window
        std::map<std::string, SelectorState> selectors_;
        std::map<std::string, int> visitCounts_;
        EvalContext evalCtx_;
        // The dialect's host hooks, held by the flow so evalCtx_.host stays valid.
        PatterHost evalHost_;

        void clearPending() { hasPendingChoice_ = false; pendingGroupId_.clear(); pendingOptions_.clear(); pendingById_.clear(); }

        // -- scope resolvers --
        const PatterValue* patterGet(const std::string& n) const
        {
            if (host_->patterSharedNames.count(n))
            {
                return host_->sharedPatter->values().get(n);
            }
            return local_->values().get(n);
        }
        void patterSet(const std::string& n, const PatterValue& v)
        {
            if (host_->patterSharedNames.count(n)) host_->sharedPatter->set(n, v); else local_->set(n, v);
        }
        PropertyBag* sceneBagFor(const std::string& n)
        {
            if (currentSceneId_.empty()) return nullptr;
            auto sn = host_->sceneSharedNames.find(currentSceneId_);
            bool shared = sn != host_->sceneSharedNames.end() && sn->second.count(n);
            if (shared) { auto it = host_->stageBags.find(currentSceneId_); return it != host_->stageBags.end() ? it->second.get() : nullptr; }
            auto it = sceneBags_.find(currentSceneId_); return it != sceneBags_.end() ? sceneBags_.at(currentSceneId_).get() : nullptr;
        }
        const PatterValue* sceneGet(const std::string& n) const
        {
            return const_cast<Flow*>(this)->sceneGetMut(n);
        }
        const PatterValue* sceneGetMut(const std::string& n)
        {
            auto* bag = sceneBagFor(n);
            if (!bag) return nullptr;
            // Through values(), not get(): get() hands back an optional by value, and a
            // pointer into a temporary is a dangling read. values() is the bag's storage.
            return bag->values().get(n);
        }
        void sceneSet(const std::string& n, const PatterValue& v)
        {
            auto* bag = sceneBagFor(n);
            // Not silent: an engine write notifies subscribers and is audited, where a host
            // write is silent but still audited. This is the engine's own write.
            if (bag) bag->set(n, v);
        }

        // -- settle / entry --
        void settle()
        {
            int transitions = 0;
            for (;;)
            {
                if (++transitions > 10000) throw std::runtime_error("flow did not settle after 10000 transitions - likely a jump cycle with no deliverable content");
                if (flowEnded_ || hasPendingChoice_) return;

                if (activeSnippet_)
                {
                    if (beatIndex_ < static_cast<int>(activeSnippet_->beats.size())) return;
                    runEffects(activeSnippet_->onExit);
                    const Jump* jump = activeSnippet_->jump.get();
                    activeSnippet_ = nullptr;
                    beatIndex_ = 0;
                    resolveJump(jump);
                    continue;
                }

                if (stack_.empty()) { flowEnded_ = true; return; }
                StackFrame& frame = stack_.back();
                if (frame.sceneId != currentSceneId_) currentSceneId_ = frame.sceneId;
                const std::vector<NodePtr>* children = childrenOf(frame.containerId);
                if (!children) { stack_.pop_back(); continue; }
                // A `run` container walks its children in order, skipping the ones whose
                // condition does not hold. That skip IS the decision an author asks about.
                const int from = frame.index;
                while (frame.index < static_cast<int>(children->size()) && !eligible((*children)[frame.index].get())) frame.index++;
                if (host_->logEnabled && frame.index != from)
                {
                    LogEntry e; e.type = "select"; e.subject = frame.containerId; e.selector = "run";
                    for (int i = from; i <= frame.index && i < static_cast<int>(children->size()); i++)
                        e.considered.emplace_back((*children)[i]->id, i == frame.index);
                    if (frame.index < static_cast<int>(children->size())) e.picked = (*children)[frame.index]->id;
                    emit(std::move(e));
                }
                if (frame.index >= static_cast<int>(children->size())) { stack_.pop_back(); continue; }
                const Node* child = (*children)[frame.index++].get();
                enterChild(child);
            }
        }

        void enterSceneSetup(const std::string& sceneId)
        {
            auto it = host_->bundle->scenes.find(sceneId);
            if (it == host_->bundle->scenes.end()) throw std::runtime_error("unknown scene: " + sceneId);
            currentSceneId_ = sceneId;
            enter(sceneId);
            seedScene(it->second);
            runEffects(it->second.onEntry);
        }

        void enterChild(const Node* node)
        {
            enter(node->id);
            if (node->isSnippet()) { beginSnippet(node); return; }
            std::string selector = node->selector.empty() ? "run" : node->selector;
            if (selector == "run") { stack_.push_back({ currentSceneId_, node->id, 0, "" }); return; }
            if (selector == "choice") { setupChoice(node); return; }
            const Node* pick = selectChild(node);
            if (pick) enterChild(pick);
        }

        const std::vector<NodePtr>* childrenOf(const std::string& containerId) const
        {
            auto b = host_->blockById.find(containerId);
            if (b != host_->blockById.end()) return &b->second->children;
            auto n = host_->nodeIndex.find(containerId);
            if (n != host_->nodeIndex.end() && n->second->isGroup()) return &n->second->children;
            return nullptr;
        }

        void beginSnippet(const Node* snippet)
        {
            runEffects(snippet->onEnter);
            activeSnippet_ = snippet;
            beatIndex_ = 0;
        }

        void setupChoice(const Node* group)
        {
            std::vector<ChoiceOption> options;
            std::map<std::string, const Node*> byId;
            std::vector<const Node*> fallbacks;
            for (const auto& childPtr : group->children)
            {
                const Node* child = childPtr.get();
                if (child->fallback) { fallbacks.push_back(child); continue; }
                if (!child->sticky)
                {
                    auto it = visitCounts_.find(child->id);
                    if (it != visitCounts_.end() && it->second >= 1) continue;
                }
                bool elig = eligible(child);
                if (!elig && child->secretUntilEligible) continue;
                ChoiceOption opt;
                opt.id = child->id;
                opt.prompt = promptFor(child);
                opt.eligible = elig;
                opt.gameData = child->gameData;
                options.push_back(opt);
                byId[child->id] = child;
            }
            if (!options.empty())
            {
                // Including options a condition left ineligible: "why is that greyed out" is a
                // question about the moment the choice was built.
                if (host_->logEnabled)
                {
                    LogEntry e; e.type = "choice"; e.subject = group->id;
                    for (const auto& o : options) e.considered.emplace_back(o.id, o.eligible);
                    emit(std::move(e));
                }
                hasPendingChoice_ = true; pendingGroupId_ = group->id; pendingOptions_ = options; pendingById_ = byId;
                return;
            }
            for (const Node* f : fallbacks) if (eligible(f)) { enterChild(f); return; }
            // Nothing takeable and no eligible fallback: the choice runs dry and the flow walks
            // past it. The behaviour is unchanged; this makes the silent fall-through observable.
            { LogEntry e; e.type = "dry"; e.subject = group->id; emit(std::move(e)); }
            // Beside the log, not instead of it: live feedback a host acts on, against an audit
            // read afterwards. A shipped game runs with the log off and this still wired.
            if (host_->onDryChoice) host_->onDryChoice(group->id);
        }

        // -- jumps --
        void resolveJump(const Jump* jump)
        {
            if (!jump) return;
            enterTarget(jump->to, jump->mode == "call" ? "call" : "jump");
        }
        void enterTarget(const std::string& to, const std::string& mode)
        {
            { LogEntry e; e.type = "jump"; e.subject = to; e.detail = mode; emit(std::move(e)); }
            if (to == "END") { flowEnded_ = true; stack_.clear(); return; }
            std::string sceneId, containerId;
            auto sc = host_->bundle->scenes.find(to);
            if (sc != host_->bundle->scenes.end())
            {
                enterSceneSetup(to);
                if (sc->second.blocks.empty()) { if (mode == "jump") stack_.clear(); return; }
                sceneId = to; containerId = sc->second.blocks.front().id;
            }
            else
            {
                auto loc = host_->blockToScene.find(to);
                if (loc == host_->blockToScene.end()) throw std::runtime_error("jump target not found: " + to);
                if (loc->second != currentSceneId_) enterSceneSetup(loc->second);
                sceneId = loc->second; containerId = to;
            }
            enter(containerId);
            StackFrame frame{ sceneId, containerId, 0, "" };
            if (mode == "call") stack_.push_back(frame); else { stack_.clear(); stack_.push_back(frame); }
        }

        // -- selectors --
        const Node* selectChild(const Node* group)
        {
            std::vector<const Node*> elig;
            std::vector<std::pair<std::string, bool>> considered;
            for (const auto& c : group->children)
            {
                const bool ok = eligible(c.get());
                considered.emplace_back(c->id, ok);
                if (ok) elig.push_back(c.get());
            }
            // The reasoning goes in the entry: every child looked at, with its verdict.
            const auto trace = [&](const Node* picked) -> const Node*
            {
                LogEntry e; e.type = "select"; e.subject = group->id;
                e.selector = group->selector.empty() ? "default" : group->selector;
                e.considered = considered;
                if (picked) e.picked = picked->id;
                emit(std::move(e));
                return picked;
            };
            if (elig.empty()) return trace(nullptr);
            SelectorState& st = selectorStateFor(group);
            if (group->selector == "branch") return trace(elig.front());
            if (group->selector == "sequence")
            {
                std::string order = group->options && !group->options->order.empty() ? group->options->order : "sequential";
                std::string exhaust = group->options && !group->options->exhaust.empty() ? group->options->exhaust : "once";
                return trace(order == "shuffle" ? pickShuffle(elig, exhaust, st)
                    : order == "specificity" ? pickSpecificity(elig, exhaust, st)
                    : pickSequential(elig, exhaust, st));
            }
            return nullptr;   // run / choice / default are handled in enterChild, not here
        }
        const Node* pickSequential(std::vector<const Node*>& elig, const std::string& exhaust, SelectorState& st)
        {
            int len = static_cast<int>(elig.size());
            int n = st.seq;
            st.seq = n + 1;
            if (exhaust == "repeat") return elig[n % len];
            if (n < len) return elig[n];
            if (exhaust == "stick") return elig[len - 1];
            return nullptr;
        }
        const Node* pickShuffle(std::vector<const Node*>& elig, const std::string& exhaust, SelectorState& st)
        {
            int len = static_cast<int>(elig.size());
            bool stick = exhaust == "stick";
            auto fill = [&]() {
                std::vector<std::string> ids;
                int upto = stick ? len - 1 : len;
                for (int i = 0; i < upto; ++i) ids.push_back(elig[i]->id);
                return ids;
            };
            if (!st.bagInit) { st.bag = fill(); st.bagInit = true; }
            if (st.bag.empty())
            {
                if (exhaust == "once") return nullptr;
                if (stick) { const Node* last = elig[len - 1]; st.hasLast = true; st.last = last->id; return last; }
                st.bag = fill();
            }
            // Draw without replacement, never repeating the immediately-previous pick - allocation-free:
            // find last's slot and draw into the reduced span skipping it, then erase the pick in place.
            std::vector<std::string>& pool = st.bag;
            int p = -1;
            if (st.hasLast && pool.size() > 1)
                for (size_t k = 0; k < pool.size(); ++k) if (pool[k] == st.last) { p = static_cast<int>(k); break; }
            int span = p >= 0 ? static_cast<int>(pool.size()) - 1 : static_cast<int>(pool.size());
            int i = static_cast<int>(std::floor(rng() * span));
            if (p >= 0 && i >= p) ++i;
            std::string pick = pool[static_cast<size_t>(i)];
            pool.erase(pool.begin() + i); // draw without replacement, in place
            st.hasLast = true; st.last = pick;
            for (const Node* c : elig) if (c->id == pick) return c;
            return nullptr;
        }
        // order == "specificity" (Best match): keep the top matched-specificity tier, tie-break by the
        // seeded PRNG (no immediate repeat); a no-condition child scores 0 (the filler). Composes with
        // exhaust exactly like shuffle: repeat re-scores every draw; once/stick draw without replacement.
        const Node* pickSpecificity(std::vector<const Node*>& elig, const std::string& exhaust, SelectorState& st)
        {
            bool repeat = exhaust == "repeat";
            std::vector<const Node*> pool;
            if (repeat) { pool = elig; }
            else
            {
                if (!st.bagInit) { for (const Node* c : elig) st.bag.push_back(c->id); st.bagInit = true; }
                for (const Node* c : elig)
                {
                    bool inBag = false;
                    for (const std::string& id : st.bag) if (id == c->id) { inBag = true; break; }
                    if (inBag) pool.push_back(c);
                }
                if (pool.empty())
                {
                    if (exhaust == "stick" && st.hasLast) for (const Node* c : elig) if (c->id == st.last) return c;
                    return nullptr;
                }
            }
            // Top specificity tier among the drawable pool.
            int best = -1;
            std::vector<int> scores; scores.reserve(pool.size());
            for (const Node* c : pool) { int s = specScore(c); scores.push_back(s); if (s > best) best = s; }
            std::vector<const Node*> tier;
            for (size_t k = 0; k < pool.size(); ++k) if (scores[k] == best) tier.push_back(pool[k]);
            // A lone top-tier child is returned WITHOUT drawing, so a clear winner consumes no randomness.
            const Node* pick = nullptr;
            if (tier.size() == 1) { pick = tier[0]; }
            else
            {
                int p = -1;
                if (st.hasLast) for (size_t k = 0; k < tier.size(); ++k) if (tier[k]->id == st.last) { p = static_cast<int>(k); break; }
                int span = p >= 0 ? static_cast<int>(tier.size()) - 1 : static_cast<int>(tier.size());
                int i = static_cast<int>(std::floor(rng() * span));
                if (p >= 0 && i >= p) ++i;
                pick = tier[static_cast<size_t>(i)];
            }
            if (!repeat)
                for (size_t k = 0; k < st.bag.size(); ++k) if (st.bag[k] == pick->id) { st.bag.erase(st.bag.begin() + k); break; }
            st.hasLast = true; st.last = pick->id;
            return pick;
        }
        // A child's Best-match score: 0 with no condition (the filler tier), else its (passing) condition's
        // specificity. Scored against this flow's live eval context via the free matchedSpec.
        int specScore(const Node* node)
        {
            return node->condition ? matchedSpec(node->condition->ast, evalCtx_, true) : 0;
        }
        SelectorState& selectorStateFor(const Node* group)
        {
            auto& map = group->shared ? host_->sharedSelectors : selectors_;
            return map[group->id];
        }

        // -- effects / expressions --
        void runEffects(const std::vector<Effect>& effects)
        {
            for (const auto& ef : effects)
            {
                PatterValue value = evalExpr(ef.value);
                // `prev` read before the write, so a reader can say "0 -> 7" in one pass.
                LogEntry e; e.type = "write"; e.subject = ef.target; e.value = value;
                if (host_->logEnabled)
                    if (const PatterValue* pv = getProperty(ef.target)) { e.prev = *pv; e.hasPrev = true; }
                setProperty(ef.target, value);
                emit(std::move(e));
            }
        }
        bool eligible(const Node* node)
        {
            if (!node->condition) return true;
            return truthy(evalExpr(*node->condition));
        }
        PatterValue evalExpr(const Expression& expr) { return Evaluate(expr.ast, evalCtx_, PatterDialect()); }
        void enter(const std::string& id)
        {
            visitCounts_[id] = visitCounts_.count(id) ? visitCounts_[id] + 1 : 1;
            host_->sharedVisits[id] = host_->sharedVisits.count(id) ? host_->sharedVisits[id] + 1 : 1;
        }
        double rng()
        {
            if (host_->customRng) return host_->customRng();
            // The shared Mulberry32, not a copy of the mixing inline here. This
            // file carried its own until 2026-09-01, so Patterplay shipped the
            // algorithm twice in C++ alone. rngState_ is still the serialisable
            // position, so saves are unaffected.
            Mulberry32 prng(rngState_);
            const double draw = prng.next();
            rngState_ = prng.state();
            return draw;
        }

        // -- strings / beats --
        StepResult beatResult(const Beat& beat)
        {
            StepResult r;
            // Accumulated author tags (#215): present only when non-empty (parity with gameData).
            auto applyTags = [&](StepResult& s) {
                auto it = host_->tagIndex.find(beat.id);
                if (it != host_->tagIndex.end() && !it->second.empty()) { s.hasTags = true; s.tags = it->second; }
            };
            if (beat.kind == "gameEvent") { r.type = StepType::GameEvent; r.id = beat.id; r.gameData = beat.gameData; applyTags(r); return r; }
            if (beat.kind == "text") { r.type = StepType::Text; r.id = beat.id; r.text = interp(resolveString(beat.id)); r.gameData = beat.gameData; applyTags(r); return r; }
            // line
            std::string raw = resolveString(beat.id);
            r.type = StepType::Line; r.id = beat.id;
            // Closed captions (#214): a line goes SILENT (off only) when the caption CHARACTER speaks it
            // (whole line is a caption, delimiters or not) OR stripping cues leaves it empty. A silent line
            // still FIRES (audio plays) but carries no text + no speaker.
            bool ccOff = !host_->captionsOn;
            bool captionChar = ccOff && !host_->captionCharacter.empty() && beat.character == host_->captionCharacter;
            std::string text = captionChar ? std::string() : captionLine(host_->bundle->voiced ? raw : interp(raw));
            r.text = text;
            bool silent = ccOff && text.empty();
            if (!silent)
            {
                if (!beat.character.empty()) { r.hasCharacter = true; r.character = beat.character; }
                std::string cn; if (resolveCharacterName(beat.character, cn)) { r.hasCharacterName = true; r.characterName = cn; }
                if (!beat.direction.empty()) { r.hasDirection = true; r.direction = beat.direction; }
            }
            r.gameData = beat.gameData;
            applyTags(r);
            return r;
        }
        std::string interp(const std::string& raw)
        {
            return patter::interpolate(raw, [this](const std::string& ref, PatterValue& out) {
                const PatterValue* v = getProperty(ref);
                if (!v) return false;
                out = *v; return true;
            });
        }
        // Caption-strip a dialogue line ONLY when captions are off; otherwise pass it through (#214).
        std::string captionLine(const std::string& text)
        {
            return host_->captionsOn ? text : patter::stripCaptions(text, host_->captionOpen, host_->captionClose);
        }
        std::shared_ptr<ChoicePrompt> promptFor(const Node* node)
        {
            const Beat* beat = promptBeatOf(node);
            if (!beat) return nullptr;
            auto p = std::make_shared<ChoicePrompt>();
            std::string text = interp(resolveString(beat->id));
            if (beat->kind == "line")
            {
                // A line-kind prompt is dialogue, so captions apply.
                p->kind = "line"; p->text = captionLine(text); p->character = beat->character;
                std::string cn; if (resolveCharacterName(beat->character, cn)) p->characterName = cn;
                p->direction = beat->direction;
            }
            else { p->kind = "text"; p->text = text; }
            return p;
        }
        const Beat* promptBeatOf(const Node* node)
        {
            if (node->isGroup() && node->prompt) return node->prompt.get();
            const Node* snippet = node->isSnippet() ? node : firstTextSnippetIn(node->children);
            if (!snippet) return nullptr;
            for (const auto& b : snippet->beats) if (b.kind == "line" || b.kind == "text") return &b;
            return nullptr;
        }
        const Node* firstTextSnippetIn(const std::vector<NodePtr>& children)
        {
            const Node* found = nullptr;
            walkNodes(children, [&](const Node* n) {
                if (!found && n->isSnippet())
                    for (const auto& b : n->beats) if (b.kind == "line" || b.kind == "text") { found = n; break; }
            });
            return found;
        }
        std::string resolveString(const std::string& id)
        {
            if (host_->emitIds) return id; // IDs-only build: the game resolves text from this id itself
            auto a = host_->strings.find(id);
            if (a != host_->strings.end()) return a->second;
            auto d = host_->defaultStrings.find(id);
            if (d != host_->defaultStrings.end()) return "<Untranslated: " + id + "> " + d->second;
            return id;
        }
        bool resolveCharacterName(const std::string& character, std::string& out)
        {
            if (character.empty()) return false;
            if (host_->emitIds) return false; // IDs-only: omit the display name; the game maps the `character` token
            std::string key = "cast:" + character;
            auto a = host_->strings.find(key); if (a != host_->strings.end()) { out = a->second; return true; }
            auto d = host_->defaultStrings.find(key); if (d != host_->defaultStrings.end()) { out = d->second; return true; }
            auto c = host_->castDisplay.find(character); if (c != host_->castDisplay.end()) { out = c->second; return true; }
            return false;
        }

        void seedScene(const Scene& scene)
        {
            const std::set<std::string>* shared = nullptr;
            auto sn = host_->sceneSharedNames.find(scene.id);
            if (sn != host_->sceneSharedNames.end()) shared = &sn->second;
            auto isShared = [&](const std::string& name) { return shared && shared->count(name); };

            // The bag's constructor IS the loop this replaced: lowercase the name, seed the
            // declared default else the type's, and copy it so two bags seeded from one
            // declaration set never share a mutable flags vector.
            if (!sceneBags_.count(scene.id))
            {
                std::vector<ScopeDeclaration> decls = declsFor(scene.sceneProps, shared, false);
                sceneBags_.emplace(scene.id, std::make_shared<PropertyBag>(&decls));
            }
            if (!host_->stageBags.count(scene.id))
            {
                std::vector<ScopeDeclaration> decls = declsFor(scene.sceneProps, shared, true);
                host_->stageBags.emplace(scene.id, std::make_shared<PropertyBag>(&decls));
            }
            for (const auto& decl : scene.sceneProps)
            {
                if (!decl.temporary) continue;
                std::string name = toLower(decl.name);
                PropertyBag* bag = isShared(name) ? host_->stageBags[scene.id].get() : sceneBags_[scene.id].get();
                // Through set, so the reset is audited: a temporary snapping back to its
                // default is a state change, and a log that omits it is wrong.
                bag->set(name, propDefault(decl));
            }
        }

        /** This flow's NOT-shared @patter half, in a bag for the same reasons as the shared one. */
        std::shared_ptr<PropertyBag> freshLocal()
        {
            std::vector<ScopeDeclaration> decls;
            for (const auto& d : host_->patterLocalDecls) decls.push_back(toScopeDecl(d));
            return std::make_shared<PropertyBag>(&decls, nullptr, "@patter.");
        }
    };

    // ----- Engine --------------------------------------------------------------

    class Engine
    {
    public:
        Engine(const Bundle& bundle, const EngineOptions& options = EngineOptions())
        {
            creationOptions_ = options; // reused verbatim by hotSwap (same seed source + settings)
            allStrings_ = &bundle.strings;
            std::string locale = options.locale.empty() ? bundle.locales.defaultLocale : options.locale;
            const auto& allStrings = bundle.strings;
            currentLocale_ = locale;
            // Localisation mode (spec §11): "ids" + no source-debug -> emit beat IDs + omit character names.
            host_.logEnabled = options.log;
            // By POINTER, so a flow appends to the engine's stream without holding the engine.
            host_.engineLog = &engineLog_;
            host_.onDryChoice = options.onDryChoice;
            host_.emitIds = bundle.localisation.mode == "ids" && !bundle.localisation.sourceDebug;
            sourceDebug_ = bundle.localisation.mode == "ids" && bundle.localisation.sourceDebug;
            if (sourceDebug_) std::cerr << "[Patterplay] source-only DEBUG build: strings are the source language for debugging, not a shippable localised build.\n";
            auto ls = allStrings.find(locale); if (ls != allStrings.end()) host_.strings = ls->second;
            auto ds = allStrings.find(bundle.locales.defaultLocale); if (ds != allStrings.end()) host_.defaultStrings = ds->second;

            for (const auto& c : bundle.cast) if (!c.displayName.empty()) host_.castDisplay[c.name] = c.displayName;
            defaultSeed_ = options.hasSeed ? Mulberry32::ToUint32(options.seed) : 0x9e3779b9u;

            for (const auto& kv : bundle.scenes)
            {
                const std::string& sceneId = kv.first; const Scene& scene = kv.second;
                sceneGameIdToId_[effectiveGameId(scene.gameId, scene.name)] = sceneId;
                host_.sceneGameIdToId[effectiveGameId(scene.gameId, scene.name)] = sceneId;
                std::map<std::string, std::string> blockAddrs;
                // Author tags (#215): accumulate scene -> block -> node (own + ancestors), deduped, outermost-first.
                std::vector<std::string> sceneTags = dedupeTags(scene.tags, {});
                host_.tagIndex[sceneId] = sceneTags;
                for (const auto& block : scene.blocks)
                {
                    host_.blockToScene[block.id] = sceneId;
                    host_.blockById[block.id] = &block;
                    blockAddrs[effectiveGameId(block.gameId, block.name)] = block.id;
                    std::vector<std::string> blockTags = dedupeTags(block.tags, sceneTags);
                    host_.tagIndex[block.id] = blockTags;
                    walkNodes(block.children, [&](const Node* n) { host_.nodeIndex[n->id] = n; });
                    indexTags(block.children, blockTags);
                }
                blockGameIdToId_[sceneId] = blockAddrs;
                host_.blockGameIdToId[sceneId] = blockAddrs;
            }

            for (const auto& p : bundle.properties)
            {
                bool shared = p.hasShared ? p.shared : true;
                if (shared) { host_.patterSharedDecls.push_back(p); host_.patterSharedNames.insert(toLower(p.name)); }
                else host_.patterLocalDecls.push_back(p);
            }
            host_.sharedPatter = makeSharedPatter(host_.patterSharedDecls);

            for (const auto& kv : bundle.scenes)
            {
                std::set<std::string> names;
                for (const auto& p : kv.second.sceneProps) { bool sh = p.hasShared ? p.shared : false; if (sh) names.insert(toLower(p.name)); }
                host_.sceneSharedNames[kv.first] = names;
            }

            host_.bundle = &bundle;
            host_.customRng = options.rng;
            host_.replayPromptOnChoose = options.replayPromptOnChoose;
            host_.captionsOn = options.closedCaptions; // captions shown by default (full text)
            host_.captionOpen = bundle.closedCaptions.present ? bundle.closedCaptions.open : "[";   // default: square brackets (#214)
            host_.captionClose = bundle.closedCaptions.present ? bundle.closedCaptions.close : "]";
            host_.captionCharacter = (bundle.closedCaptions.present && !bundle.closedCaptions.character.empty()) ? bundle.closedCaptions.character : "SFX";

            // Host scopes (design/scope-registry.md section 6). An embedder's binding wins for its
            // token; every OTHER token the bundle declares gets a self-backed bag seeded from its
            // declarations, so a standalone build plays the same story a bound one does.
            for (const auto& kv : options.hostScopes) host_.hostScopes[kv.first] = kv.second;
            for (const HostScopeSpec& spec : bundle.scopeRegistry.scopes)
            {
                if (spec.token.empty() || host_.hostScopes.count(spec.token)) continue;   // the binding wins
                host_.hostScopes[spec.token] = selfBackedScope(spec);
            }
            for (const auto& kv : host_.hostScopes) host_.hostTokens.insert(kv.first);
        }

        // The active locale (string + character-name lookups resolve in it).
        const std::string& locale() const { return currentLocale_; }

        // True for a source-only DEBUG build: the embedded strings are the source language (for debugging),
        // not a shippable localised build. An IDs-only ship build is false.
        bool isSourceDebug() const { return sourceDebug_; }

        // Switch the active locale LIVE - subsequent string lookups (new beats, character names, {@ref})
        // render in it; flow position / state / visits / rng are untouched. All open flows share host_, so
        // the swap reaches them at once. A locale with no table degrades to the source via <Untranslated>.
        void setLocale(const std::string& locale)
        {
            currentLocale_ = locale;
            // Re-point the active strings off the live table source (the bundle's, unless replaceStrings
            // re-pointed it at a pushed bundle's) - no whole-table copy.
            auto it = allStrings_->find(locale);
            host_.strings = it != allStrings_->end() ? it->second : std::map<std::string, std::string>();
        }

        // Live bundle refresh, tier 1 (strings only): swap every locale's string table in place from a
        // freshly compiled bundle whose STRUCTURE is unchanged (same content.structureHash). Like
        // setLocale, nothing restarts and no flow is touched: the next delivered beat reads the new text.
        // The caller keeps `bundle` alive for this engine's lifetime (same contract as the constructor).
        // Structural edits need hotSwap() instead (a structure change here simply won't show).
        void replaceStrings(const Bundle& bundle)
        {
            allStrings_ = &bundle.strings;
            auto it = allStrings_->find(currentLocale_);
            host_.strings = it != allStrings_->end() ? it->second : std::map<std::string, std::string>();
            auto ds = allStrings_->find(host_.bundle->locales.defaultLocale);
            host_.defaultStrings = ds != allStrings_->end() ? ds->second : std::map<std::string, std::string>();
        }

        // Live bundle refresh, tier 2 (full swap): rebuild on an edited bundle with the whole run carried
        // over (saveGame -> fresh engine -> loadGame) plus the presentation state that isn't save state
        // (active locale, captions toggle). Content drift resolves per spec 9.8: stack frames re-find
        // their next child by id, drifted options drop, a vanished snippet is skipped. Returns the
        // REPLACEMENT engine (caller owns it AND keeps `bundle` alive for its lifetime); discard this one
        // and re-bind flow handles via next->getFlow(id).
        std::unique_ptr<Engine> hotSwap(const Bundle& bundle)
        {
            SaveGame snapshot = saveGame();
            std::unique_ptr<Engine> next(new Engine(bundle, creationOptions_));
            next->loadGame(snapshot);
            next->setLocale(currentLocale_);
            next->setClosedCaptions(host_.captionsOn);
            return next;
        }

        // Whether closed captions are currently shown (full dialogue text).
        bool closedCaptions() const { return host_.captionsOn; }

        // Turn closed captions on/off LIVE (#214). When OFF, subsequent dialogue lines have their caption
        // cues + surrounding whitespace stripped; narration / prompts / etc. untouched. A presentation
        // toggle reaching every open flow at once; not save state.
        void setClosedCaptions(bool on) { host_.captionsOn = on; }

        /// The run's decisions, in order, each naming the flow it happened in. Empty unless
        /// the engine was built with EngineOptions::log. A flow's own log stays flow-local;
        /// this is the only place a story spanning several flows reads as one sequence.
        const std::vector<LogEntry>& log() const { return engineLog_; }

        /// Drop the retained entries. `seq` does NOT restart, so two reads either side of a
        /// clear still agree about what came first.
        void clearLog() { engineLog_.clear(); }

        Flow* openFlow(const std::string& id, const std::string& scene = "", const std::string& block = "", const int64_t* seed = nullptr)
        {
            std::string sceneId = resolveSceneRef(scene);
            std::string blockId = resolveBlockRef(sceneId, block);
            // Re-opening a name REPLACES it: finish the old flow so a host still holding it cannot keep
            // driving the shared world. Replacing is a reset - contrast runFlow, which reuses.
            { auto prev = flows_.find(id); if (prev != flows_.end()) prev->second->close(); }
            auto flow = std::make_shared<Flow>(id, &host_, seed ? *seed : static_cast<int64_t>(defaultSeed_));
            Flow* raw = flow.get();
            flows_[id] = std::move(flow);
            raw->start(sceneId, blockId);
            return raw;
        }
        Flow* getFlow(const std::string& id) { auto it = flows_.find(id); return it != flows_.end() ? it->second.get() : nullptr; }

        /** Every currently-open flow. Parity with the JS runtime's flows() and the Godot / C#
         *  ports: a state logger mounts each flow's own bags, so it has to be able to ask. */
        std::vector<Flow*> flows()
        {
            std::vector<Flow*> out;
            out.reserve(flows_.size());
            for (const auto& kv : flows_) out.push_back(kv.second.get());
            return out;
        }

        /** The SHARED kernel bags with the path each answers to in a log: the @patter globals,
         *  and one per scene for the shared @scene props. Parity with the Storylet Engine's
         *  listBags - it is what a state logger mounts.
         *
         *  A stage bag's LOG path is `@scene:<sceneId>.` where its address is `@scene.`: a
         *  property is addressed relative to a flow's current scene, but a log spans scenes.
         *  loadGame() replaces every bag, so re-enumerate after a load. */
        std::vector<LogMount> listBags()
        {
            std::vector<LogMount> mounts;
            mounts.push_back(LogMount{host_.sharedPatter, std::nullopt});
            for (auto& kv : host_.stageBags)
            {
                mounts.push_back(LogMount{kv.second, "@scene:" + kv.first + "."});
            }
            return mounts;
        }
        /** The same flow as an OWNING handle, for a wrapper that outlives the map entry (see `flows_`).
         *  Empty for an id that is not open, which is the honest answer: the wrapper reads as closed. */
        std::shared_ptr<Flow> flowPtr(const std::string& id)
        {
            auto it = flows_.find(id);
            return it != flows_.end() ? it->second : std::shared_ptr<Flow>();
        }
        // Close (remove) a flow. The flow object is FINISHED, not merely unregistered, so a host still
        // holding it cannot keep advancing it into the shared world.
        void closeFlow(const std::string& id)
        {
            auto it = flows_.find(id);
            if (it != flows_.end()) it->second->close();
            flows_.erase(id);
        }

        // "Play this address and give me everything it produced" - the one-call bark form. The NAMED flow
        // is reused if it exists (moved with gotoAddress) and opened at the address if not, then run to its
        // next stop. Reuse is the point: a flow owns its selector cursors, so a shuffle keeps its bag and an
        // "once each" list keeps its place across calls. Empty vector = nothing left to play. Throws if the
        // address does not resolve.
        std::vector<StepResult> runFlow(const std::string& flow, const std::string& scene, const std::string& block = "")
        {
            Flow* f = getFlow(flow);
            if (f)
            {
                if (!f->gotoAddress(scene, block))
                    throw std::runtime_error("runFlow: address not found: " + scene + (block.empty() ? "" : " / " + block));
            }
            else f = openFlow(flow, scene, block);

            return f->advanceToStop().played;
        }

        // Author tags (#215): a beat's accumulated tags (own + every ancestor's), the same value its step
        // carries. Empty for an unknown id or a beat with no tags anywhere up the chain.
        std::vector<std::string> tagsForBeat(const std::string& beatId) const
        {
            auto it = host_.tagIndex.find(beatId);
            return it != host_.tagIndex.end() ? it->second : std::vector<std::string>{};
        }
        // A scene's own tags, by internal id or gameId address.
        std::vector<std::string> tagsForScene(const std::string& sceneRef)
        {
            auto it = host_.tagIndex.find(resolveSceneRef(sceneRef));
            return it != host_.tagIndex.end() ? it->second : std::vector<std::string>{};
        }
        // The host-facing address (gameId) of a scene by internal id, empty if unknown. The inverse of the
        // address resolution openFlow / gotoAddress do - for a host that wants to display, log, or pass
        // back the address of where it currently is.
        std::string sceneAddress(const std::string& sceneId) const
        {
            auto it = host_.bundle->scenes.find(sceneId);
            return it != host_.bundle->scenes.end() ? effectiveGameId(it->second.gameId, it->second.name) : std::string();
        }
        // The host-facing address (gameId) of a block by internal id, empty if unknown.
        std::string blockAddress(const std::string& blockId) const
        {
            auto it = host_.blockById.find(blockId);
            return it != host_.blockById.end() ? effectiveGameId(it->second->gameId, it->second->name) : std::string();
        }
        // A block's accumulated tags (scene + block), by scene + block ref (id or gameId).
        std::vector<std::string> tagsForBlock(const std::string& sceneRef, const std::string& blockRef)
        {
            auto it = host_.tagIndex.find(resolveBlockRef(resolveSceneRef(sceneRef), blockRef));
            return it != host_.tagIndex.end() ? it->second : std::vector<std::string>{};
        }

        // Every cast member the PROJECT declares, in authored order - the same list describeBundle
        // counts. A superset of any scene's cast: a beat's character must be a declared member, so
        // castForScene / castForBlock only ever return names from here.
        std::vector<std::string> getCast() const
        {
            // Cast is absent from a bundle whose project declares none, and a nameless member is junk
            // from a hand-edited bundle: both give an empty answer, not a throw.
            std::vector<std::string> names;
            names.reserve(host_.bundle->cast.size());
            for (const auto& c : host_.bundle->cast) if (!c.name.empty()) names.push_back(c.name);
            return names;
        }

        // A scene's cast: the character token of every speaker with a line anywhere in it, deduped, in
        // first-appearance order. Static, like listOutline: it walks the authored structure, so a speaker
        // behind a condition, inside any group, or voicing a choice prompt counts - this is who CAN speak
        // in the scene, not who a given playthrough heard. Empty for an unknown ref or a scene with no
        // dialogue. Tokens, not display names: read those off a delivered step.
        std::vector<std::string> castForScene(const std::string& sceneRef)
        {
            std::vector<std::string> cast;
            auto it = host_.bundle->scenes.find(resolveSceneRef(sceneRef));
            if (it == host_.bundle->scenes.end()) return cast;
            std::set<std::string> seen;
            for (const auto& block : it->second.blocks) collectCast(block.children, seen, cast);
            return cast;
        }

        // One block's cast, by scene + block ref (id or gameId). castForScene, block-scoped.
        std::vector<std::string> castForBlock(const std::string& sceneRef, const std::string& blockRef)
        {
            std::vector<std::string> cast;
            auto it = host_.blockById.find(resolveBlockRef(resolveSceneRef(sceneRef), blockRef));
            if (it == host_.blockById.end()) return cast;
            std::set<std::string> seen;
            collectCast(it->second->children, seen, cast);
            return cast;
        }

        // Collect speakers under a run of nodes in document order. A group contributes its option
        // prompt's speaker (a prompt is a line | text beat) before its children.
        static void collectCast(const std::vector<NodePtr>& nodes, std::set<std::string>& seen, std::vector<std::string>& into)
        {
            for (const auto& n : nodes)
            {
                if (n->type == "group")
                {
                    if (n->prompt && n->prompt->kind == "line" && !n->prompt->character.empty()
                        && seen.insert(n->prompt->character).second)
                        into.push_back(n->prompt->character);
                    collectCast(n->children, seen, into);
                    continue;
                }
                for (const auto& beat : n->beats)
                    if (beat.kind == "line" && !beat.character.empty() && seen.insert(beat.character).second)
                        into.push_back(beat.character);
            }
        }

        void reset()
        {
            for (auto& kv : flows_) kv.second->close(); // finish them, don't just forget them
            flows_.clear();
            host_.sharedPatter = makeSharedPatter(host_.patterSharedDecls);
            host_.sharedVisits.clear();
            host_.sharedSelectors.clear();
            host_.stageBags.clear();
        }

        const PatterValue* getProperty(const std::string& ref) const
        {
            auto sp = splitRef(ref, host_.hostTokens);
            if (sp.first == "scene") throw std::runtime_error("'" + ref + "': @scene properties are scene-scoped - read/write them on a Flow, not the Engine");
            auto hs = host_.hostScopes.find(sp.first);
            if (hs != host_.hostScopes.end()) return hs->second.get(sp.second);
            return host_.sharedPatter->values().get(sp.second);
        }
        void setProperty(const std::string& ref, const PatterValue& value)
        {
            auto sp = splitRef(ref, host_.hostTokens);
            if (sp.first == "scene") throw std::runtime_error("'" + ref + "': @scene properties are scene-scoped - read/write them on a Flow, not the Engine");
            auto hs = host_.hostScopes.find(sp.first);
            if (hs != host_.hostScopes.end()) { hs->second.set(sp.second, value); return; }
            host_.sharedPatter->set(sp.second, value);
        }

        // The shared @patter properties for a live state inspector: each with its ref, type, current
        // value, declared default, and enum options. Per-flow (@local) properties are excluded, matching
        // JS engine.listProperties(). Values read fresh, so a live setProperty is reflected next call.
        std::vector<PropertyRow> listProperties() const
        {
            std::vector<PropertyRow> rows;
            rows.reserve(host_.patterSharedDecls.size());
            for (const auto& d : host_.patterSharedDecls)
            {
                PropertyRow r;
                r.name = d.name;
                // The QUALIFIED address, matching what the shared bag composes for every other
                // scope. `@gold` still resolves on input - splitRef defaults an unqualified name to
                // the patter scope - but it is the shorthand, not the address a row reports.
                r.path = "@patter." + d.name;
                r.type = d.type;
                if (!d.values.empty()) r.values = d.values;
                if (!d.stages.empty()) r.stages = d.stages;
                r.defaultValue = propDefault(d);
                const PatterValue* held = host_.sharedPatter->values().get(toLower(d.name));
                r.value = held ? *held : r.defaultValue;
                rows.push_back(std::move(r));
            }
            return rows;
        }

        // --- Static structure introspection (editor / dev tooling) -----------------
        // The authored tree: scenes -> blocks -> children (groups + snippets, groups preserved) -> a
        // snippet's beats. Static; per-beat data at the source locale. Scenes iterate by id (std::map).
        std::vector<OutlineScene> listOutline() const
        {
            std::vector<OutlineScene> out;
            for (const auto& kv : host_.bundle->scenes)
            {
                const Scene& scene = kv.second;
                OutlineScene os;
                os.id = scene.id;
                os.gameId = effectiveGameId(scene.gameId, scene.name);
                os.name = scene.name;
                os.tags = tagsById(scene.id);
                for (const Block& block : scene.blocks)
                {
                    OutlineBlock ob;
                    ob.id = block.id;
                    ob.gameId = effectiveGameId(block.gameId, block.name);
                    ob.name = block.name;
                    ob.tags = tagsById(block.id);
                    for (const NodePtr& n : block.children) ob.children.push_back(outlineNode(*n));
                    os.blocks.push_back(std::move(ob));
                }
                out.push_back(std::move(os));
            }
            return out;
        }

        // Every beat in document order, flattened through groups, with its scene/block/snippet + data.
        std::vector<OutlineFlatBeat> beatSequence() const
        {
            std::vector<OutlineFlatBeat> seq;
            for (const auto& kv : host_.bundle->scenes)
            {
                const Scene& scene = kv.second;
                for (const Block& block : scene.blocks) collectBeats(block.children, scene.id, block.id, seq);
            }
            return seq;
        }

    private:
        void collectBeats(const std::vector<NodePtr>& nodes, const std::string& sceneId, const std::string& blockId,
                          std::vector<OutlineFlatBeat>& into) const
        {
            for (const NodePtr& n : nodes)
            {
                if (n->isGroup()) { collectBeats(n->children, sceneId, blockId, into); continue; }
                for (const Beat& b : n->beats)
                    into.push_back(OutlineFlatBeat{ sceneId, blockId, n->id, beatInfo(b) });
            }
        }

        OutlineNode outlineNode(const Node& n) const
        {
            OutlineNode on;
            on.type = n.type;
            on.id = n.id;
            on.tags = tagsById(n.id);
            if (n.isGroup())
            {
                on.selector = n.selector;
                if (n.prompt) { on.hasPrompt = true; on.prompt = beatInfo(*n.prompt); }
                for (const NodePtr& c : n.children) on.children.push_back(outlineNode(*c));
            }
            else
            {
                for (const Beat& b : n.beats) on.beats.push_back(beatInfo(b));
                if (n.jump) { on.jumpTo = n.jump->to; on.jumpMode = n.jump->mode; }
            }
            return on;
        }

        OutlineBeat beatInfo(const Beat& beat) const
        {
            OutlineBeat info;
            info.id = beat.id;
            info.kind = beat.kind;
            if (beat.kind == "line")
            {
                if (!beat.character.empty())
                {
                    info.character = beat.character;
                    auto c = host_.defaultStrings.find("cast:" + beat.character);
                    if (c != host_.defaultStrings.end()) info.characterName = c->second;
                    else { auto d = host_.castDisplay.find(beat.character); if (d != host_.castDisplay.end()) info.characterName = d->second; }
                }
                info.direction = beat.direction;
            }
            if (beat.kind == "line" || beat.kind == "text")
            {
                auto t = host_.defaultStrings.find(beat.id);
                if (t != host_.defaultStrings.end()) info.text = t->second;   // source, un-interpolated
            }
            if (beat.gameData) for (const auto& kv : *beat.gameData) info.gameData.emplace_back(kv.first, kv.second);
            info.tags = tagsById(beat.id);
            return info;
        }

        std::vector<std::string> tagsById(const std::string& id) const
        {
            auto it = host_.tagIndex.find(id);
            return it != host_.tagIndex.end() ? it->second : std::vector<std::string>{};
        }

    public:
        SaveGame saveGame()
        {
            SaveGame s;
            s.version = 2;
            s.shared = flatOf(*host_.sharedPatter);
            s.sharedVisits = host_.sharedVisits;
            s.sharedSelectors = host_.sharedSelectors;
            s.stageBags = saveBags(host_.stageBags);
            for (auto& kv : flows_) s.flows[kv.first] = kv.second->snapshot();
            return s;
        }
        void loadGame(const SaveGame& save)
        {
            if (save.version != 2) throw std::runtime_error("unsupported save version");
            // Seeded from the declarations, then the saved values laid over: a property the
            // save predates keeps its default rather than vanishing.
            host_.sharedPatter = makeSharedPatter(host_.patterSharedDecls);
            host_.sharedPatter->load(orderedOf(save.shared));
            host_.sharedVisits = save.sharedVisits;
            host_.sharedSelectors = save.sharedSelectors;
            host_.stageBags = loadBags(host_, save.stageBags, true);
            flows_.clear();
            for (const auto& kv : save.flows)
            {
                auto flow = std::make_shared<Flow>(kv.first, &host_, static_cast<int64_t>(defaultSeed_));
                flow->restore(kv.second);
                flows_[kv.first] = std::move(flow);
            }
        }

    private:
        FlowHost host_;
        std::vector<LogEntry> engineLog_;
        uint32_t defaultSeed_ = 0x9e3779b9u;
        // SHARED, not unique: a wrapper (UPatterFlow, and any host object of that shape) outlives the
        // core object by design, and three paths destroy a flow underneath one - loadGame rebuilds the
        // map, closeFlow erases an entry, reset clears the lot. Holding a shared_ptr means a wrapper
        // that misses a re-bind keeps its flow ALIVE and reads as closed, rather than reading freed
        // memory. The other three runtimes are reference counted; this brings C++ into line.
        // The public accessors still hand out `Flow*` (`.get()`), so existing C++ is unaffected;
        // `flowPtr` is the handle for anything that needs to OUTLIVE the map entry.
        std::map<std::string, std::shared_ptr<Flow>> flows_;
        std::map<std::string, std::string> sceneGameIdToId_;
        std::map<std::string, std::map<std::string, std::string>> blockGameIdToId_;
        std::string currentLocale_;
        // The live string-table source: the constructor's bundle, unless replaceStrings re-pointed it at a
        // pushed bundle's tables (whose lifetime the caller guarantees, same as the constructor's bundle).
        const std::map<std::string, std::map<std::string, std::string>>* allStrings_ = nullptr;
        EngineOptions creationOptions_; // reused verbatim by hotSwap
        bool sourceDebug_ = false; // source-only DEBUG build: strings are the source language, not shippable

        std::string resolveSceneRef(const std::string& r)
        {
            if (r.empty()) return "";
            if (host_.bundle->scenes.count(r)) return r;
            auto it = sceneGameIdToId_.find(r);
            return it != sceneGameIdToId_.end() ? it->second : r;
        }
        std::string resolveBlockRef(const std::string& sceneId, const std::string& r)
        {
            if (r.empty()) return "";
            if (host_.blockById.count(r)) return r;
            if (!sceneId.empty())
            {
                auto m = blockGameIdToId_.find(sceneId);
                if (m != blockGameIdToId_.end()) { auto it = m->second.find(r); if (it != m->second.end()) return it->second; }
            }
            return r;
        }

        // Author tags (#215): combine inherited + own, deduped, preserving first-seen order.
        static std::vector<std::string> dedupeTags(const std::vector<std::string>& own, const std::vector<std::string>& inherited)
        {
            std::set<std::string> seen;
            std::vector<std::string> out;
            for (const auto& t : inherited) if (seen.insert(t).second) out.push_back(t);
            for (const auto& t : own) if (seen.insert(t).second) out.push_back(t);
            return out;
        }
        // Walk groups/snippets carrying the parent's accumulated tags; record each node's and each beat's.
        void indexTags(const std::vector<NodePtr>& nodes, const std::vector<std::string>& inherited)
        {
            for (const auto& n : nodes)
            {
                std::vector<std::string> acc = dedupeTags(n->tags, inherited);
                host_.tagIndex[n->id] = acc;
                if (n->isGroup()) indexTags(n->children, acc);
                else for (const auto& beat : n->beats) host_.tagIndex[beat.id] = dedupeTags(beat.tags, acc);
            }
        }
    };
}
