// The Patterplay runtime - a faithful C++ port of @patterkit/runtime's engine.ts (via the
// corpus-verified C# port). Engine = the world + flow manager; Flow = one playable cursor.
// std-only (no Unreal types) so it compiles standalone for the clang corpus TestHost and
// inside the UE plugin alike. Header-only; all members inline.
//
// Every property bag lives in ONE ScopeRegistry per game (the one-registry model): the game
// hands the engine its registry (EngineOptions::registry) or the engine makes its own and acts
// as its own game. `@patter` is registered under `patter`; the per-flow and per-scene bags
// under keys starting `patter/` (see registrykeys below), which no expression can name.
// saveGame() / loadGame() snapshot and restore what is NOT a property: cursors, PRNGs, visits,
// and selectors. The registry's values ride in saveGame() only when the engine made the
// registry itself; otherwise the game saves the registry once.
#pragma once

#include <string>
#include <vector>
#include <map>
#include <unordered_map>
#include <set>
#include <memory>
#include <functional>
#include <algorithm>
#include <stdexcept>
#include <cstdint>
#include <utility>
#include <optional>
#include <iostream>
#include "Kernel.h"         // the shared kernel, its names in `patter`, and kernelCall
#include "Mulberry32.h"   // ToUint32: the shared JS seed coercion
#include "Bundle.h"
#include "Ast.h"
#include "Dialect.h"        // the Patter dialect, and the shared evaluator it configures
#include "Expr/Specificity.h"  // the shared matched-constraint scorer
#include "Expr/PropertyBag.h"   // the shared state kernel: scene and stage props live in these
#include "Expr/ScopeRegistry.h" // the game's one registry: every bag above is registered in it
#include "Expr/StateLogger.h"   // LogMount: what listBags() hands a state logger
#include "Interp.h"
#include "StepResult.h"

namespace patter
{
    // A quality's ladder outside an expression, over a bare list of stages (Engine and Flow take a quality's
    // ref instead): the kernel's, named here as the rest of the kernel is.
    using wildwinter::expr::StageIndex;
    using wildwinter::expr::CompareStages;
    using wildwinter::expr::NextStage;

    // ----- helpers -------------------------------------------------------------

    // toLower, gameIdify and effectiveGameId live in Bundle.h: extensionsOf reads a scene and a block by gameId.

    // Split a ref into scope + name. `isScope` says which heads are scopes: the registry's tokens
    // (@world, another engine's @story) plus @scene. Without them "@world.gold" splits to a @patter
    // property literally named "world.gold", which reads as absent and takes the falsy branch in
    // silence. A head that is not a scope, and a bare `@name`, are @patter.
    inline std::pair<std::string, std::string> splitRef(const std::string& ref,
                                                       const std::function<bool(const std::string&)>& isScope)
    {
        std::string body = (!ref.empty() && ref[0] == '@') ? ref.substr(1) : ref;
        size_t dot = body.find('.');
        if (dot != std::string::npos && body.find('.', dot + 1) == std::string::npos)
        {
            std::string head = body.substr(0, dot), tail = body.substr(dot + 1);
            if (head == "scene" || head == "patter" || (isScope && isScope(head))) return { head, toLower(tail) };
        }
        return { "patter", toLower(body) };
    }

    // A host scope the story reads and writes, whose values the GAME keeps: an embedder binds one per
    // token through EngineOptions::hostScopes, and the engine registers it in the game's registry as an
    // EXTERNAL (foreign) scope, never stored or saved there. A declared scope nobody binds is
    // self-backed by a standalone engine, as a property the registry stores and saves.
    struct HostScope
    {
        // Returns nullptr when this scope has no such name (which reads as a graceful false). The
        // pointer must stay valid until the next call on this scope: the registry copies immediately,
        // and a binding that computes values should hold its own slot.
        std::function<const PatterValue*(const std::string&)> get;
        std::function<void(const std::string&, const PatterValue&)> set;
    };

    // A bound HostScope as the registry's resolver: the one adapter between the shape a game binds
    // (and UPatterWorld hands over) and the shared registry's foreign scope.
    class HostScopeResolver : public IScopeResolver
    {
    public:
        explicit HostScopeResolver(HostScope scope) : scope_(std::move(scope)) {}
        std::optional<PatterValue> get(const std::string& name) const override
        {
            if (!scope_.get) return std::nullopt;
            const PatterValue* v = scope_.get(name);
            return v ? std::optional<PatterValue>(*v) : std::nullopt;
        }
        bool canSet() const override { return static_cast<bool>(scope_.set); }
        void set(const std::string& name, const PatterValue& value) override { scope_.set(name, value); }
    private:
        HostScope scope_;
    };

    // A bundle's host-scope declaration in the registry's vocabulary.
    inline ScopeDeclaration toForeignDecl(const HostScopeDecl& d)
    {
        ScopeDeclaration sd;
        sd.name = d.name;
        sd.type = d.type;
        if (!d.values.empty()) sd.values = d.values;
        if (!d.stages.empty()) sd.stages = d.stages;
        if (d.hasDefault) sd.defaultValue = d.def;
        if (d.hasWritable) sd.writable = d.writable;
        return sd;
    }

    // A self-backed host scope's declaration (the standalone @world): the scope's own `writable`
    // default folded in, since an owned bag reads writability per declaration. Names fold to lower
    // case in the bag, as the compiler emits every reference ("isNight" is read as "isnight").
    inline ScopeDeclaration selfBackedDecl(const HostScopeDecl& d, const HostScopeSpec& spec)
    {
        ScopeDeclaration sd = toForeignDecl(d);
        if (!d.hasWritable && spec.hasWritable) sd.writable = spec.writable;
        return sd;
    }

    // ----- the one registry ---------------------------------------------------------

    // The owner label on everything this engine registers: named in a clash error and carried on the
    // registry's examiner rows, so one inspector can group a combined game by engine.
    inline const char* const PATTER_OWNER = "Patter";

    // The registry keys this engine stores its instance bags under. An id is escaped (`%` then `/`) so
    // a flow named "npc/bob" cannot collide with another flow's scene. Every runtime writes the same
    // keys: they are in the save.
    namespace registrykeys
    {
        inline std::string esc(const std::string& id)
        {
            std::string out;
            out.reserve(id.size());
            for (char c : id)
            {
                if (c == '%') out += "%25";
                else if (c == '/') out += "%2F";
                else out += c;
            }
            return out;
        }
        /** The inverse of esc, for a key read back out of a registry save. */
        inline std::string unesc(const std::string& key)
        {
            std::string out;
            out.reserve(key.size());
            for (size_t i = 0; i < key.size(); ++i)
            {
                if (key.compare(i, 3, "%2F") == 0) { out += '/'; i += 2; }
                else if (key.compare(i, 3, "%25") == 0) { out += '%'; i += 2; }
                else out += key[i];
            }
            return out;
        }
        /** A scene's SHARED @scene props (one bag per scene, every flow's). */
        inline std::string stage(const std::string& sceneId) { return "patter/scene/" + esc(sceneId); }
        /** Everything one flow registers starts with this. */
        inline std::string flow(const std::string& flowId) { return "patter/flow/" + esc(flowId) + "/"; }
        /** A flow's NOT-shared @patter globals. */
        inline std::string flowGlobals(const std::string& flowId) { return flow(flowId) + "patter"; }
        /** A flow's NOT-shared @scene props for one scene. */
        inline std::string flowScene(const std::string& flowId, const std::string& sceneId) { return flow(flowId) + "scene/" + esc(sceneId); }
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
    struct BeatInfo
    {
        std::string id, kind, character, characterName, direction, text;
        std::string qualifier, qualifierName;   // speaker qualifier gameId (`vo`) and shown name (source locale)
        std::string speakerLabel;               // the speaker's label (source locale): `You (V.O.)`, a pair's own, or the name
        // Line padding (line and text only): the resolved pause after the beat, in seconds, what a delivered
        // step carries (0 for a game event); and the beat's own value, when it sets one.
        double padAfter = 0;
        bool hasOwnPadAfter = false; double ownPadAfter = 0;
        std::vector<std::pair<std::string, PatterValue>> gameData;   // author overrides (raw)
        NodeExtensions extensions;                                   // Patter extension values (raw); empty = none
        std::vector<std::string> tags;                               // accumulated
    };
    struct OutlineNode
    {
        std::string type, id;                     // "group" | "snippet"
        std::vector<std::string> tags;
        // group
        std::string selector;
        bool hasPrompt = false;
        BeatInfo prompt;
        std::vector<OutlineNode> children;
        // snippet
        std::vector<BeatInfo> beats;
        std::string jumpTo, jumpMode;
    };
    struct OutlineBlock
    {
        std::string id, gameId, name;
        std::vector<std::pair<std::string, PatterValue>> gameData;   // the block's own overrides (raw, not merged)
        NodeExtensions extensions;                                   // the block's own Patter extension values (raw)
        std::vector<std::string> tags;
        std::vector<OutlineNode> children;
    };
    struct OutlineScene
    {
        std::string id, gameId, name;
        std::vector<std::pair<std::string, PatterValue>> gameData;   // the scene's own overrides (raw, not merged)
        NodeExtensions extensions;                                   // the scene's own Patter extension values (raw)
        std::vector<std::string> tags;
        std::vector<OutlineBlock> blocks;
    };
    struct FlatBeat { std::string sceneId, blockId, snippetId; BeatInfo beat; };

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
    // A part that fails to evaluate scores as false (a content error played through, see PlayError) and,
    // when `onFail` is given, is reported through it with the evaluator's message. The scorer walks every
    // part, including an `or` branch eligibility never evaluated, so a part can fail here that did not
    // fail there.
    inline int matchedSpec(const AstPtr& nodePtr, EvalContext& ctx, bool want,
                           const std::function<void(const std::string&)>& onFail = nullptr)
    {
        return MatchedSpecificity(nodePtr, [&ctx, &onFail](const AstPtr& n)
        {
            try { return truthy(Evaluate(n, ctx, PatterDialect())); }
            catch (const std::exception& ex)
            {
                if (onFail) onFail(ex.what());
                return false;   // an eval error scores as false
            }
        }, want);
    }

    // ----- save records --------------------------------------------------------

    // `nextId` is SNAPSHOT-ONLY (never set on a live frame): the id of the child at `index` when the
    // save was taken. Restore re-finds the child by this id, so a save survives siblings inserted /
    // removed / reordered before the cursor (live bundle refresh / patched-game saves, spec 9.8);
    // empty falls back to the raw index. Mirrors the JS runtime's StackFrame.nextId.
    // `choiceId` is SNAPSHOT-ONLY too: on a frame whose container is an option of a choice, that choice
    // group's id, so a load whose option has gone offers the choice again. Empty on every other frame, and
    // in a version 3 save.
    struct StackFrame { std::string sceneId, containerId; int index = 0; std::string nextId; std::string choiceId; };

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

    /** The seed value for a property declaration (its default, else the type default): the kernel's
     *  defaultFor, one rule with the bags'. */
    inline PatterValue propDefault(const PropertyDecl& d) { return toScopeDecl(d).defaultOrTypeDefault(); }

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

    /** A flat name/value map as the ordered map a bag loads. */
    inline OrderedMap<std::string, PatterValue> orderedOf(const std::map<std::string, PatterValue>& flat)
    {
        OrderedMap<std::string, PatterValue> values;
        for (const auto& e : flat) values.set(e.first, e.second);
        return values;
    }

    // One option of a pending choice, as a save keeps it: which option, whether it could be taken, and its
    // gameData, saved VERBATIM, since re-deriving on load would re-evaluate conditions. Its prompt is not
    // kept: it is built again, in the language in use and against the current values, each time the choice
    // is delivered. (A version 3 save's option also has a prompt, which a load discards.)
    struct PendingOption
    {
        std::string id;
        bool eligible = false;
        std::shared_ptr<GameData> gameData;   // null = none
    };

    // The serialised cursor + PRNG + visits of a single flow. Its properties are the registry's.
    struct FlowSnapshot
    {
        uint32_t rngState = 0;
        std::map<std::string, int> visits;
        bool flowEnded = false;
        // The choice group whose running dry ended the flow (its End step's reason RanDry); "" = it didn't.
        // Written only when set, and honoured on a load only when flowEnded.
        std::string ranDry;
        std::string currentSceneId;                                                 // "" = none
        std::vector<StackFrame> stack;
        std::string activeSnippetId;                                                // "" = none
        // The id of the next beat the active snippet delivers, so a load against an edited bundle finds
        // its place by id. Empty when no snippet is active or the active one has delivered every beat.
        std::string beatId;
        // Version 3 only, read and never written: the index of the next beat in the active snippet. -1 = absent.
        int beatIndex = -1;
        bool hasPendingChoice = false;                                              // the flow is stopped at a choice
        std::string pendingGroupId;
        std::vector<PendingOption> pendingOptions;
        std::string pendingPromptOwnerId;                                           // chosen option owning a prompt still to replay (save in the choose->advance window)
        std::shared_ptr<ChoicePrompt> pendingPrompt;                                // that prompt as the choice SHOWED it (the one prompt a save keeps as text); null when none, or in a save written before it was carried
        std::map<std::string, SelectorState> selectors;
    };

    /** The save version saveGame() writes. Bumped only when a reader would MISREAD an older save. Version 4
     *  (Patterplay 1.0): a pending choice keeps its options' ids, not their text; the cursor names the next
     *  beat by id; a frame inside an option carries its choice's id. Versions 3 and 4 are read. */
    inline constexpr int SAVE_VERSION = 4;

    // One flow taken out of an engine (Engine::captureFlow) to be put back later (Engine::restoreFlow),
    // under the same id or another: its snapshot as a save writes it, plus its own property values
    // without its id (`scopes`, its NOT-shared @patter globals, and `sceneBags`, its per-scene NOT-shared
    // @scene props). Plain data in the save's spelling (Save.h writes and reads it), so a game saves it as
    // it saves anything else. Shared state (shared properties, shared visit counts, shared selectors) is
    // never in it, so restoring one rewinds nothing else.
    struct FlowState : FlowSnapshot
    {
        int version = SAVE_VERSION;   // SAVE_VERSION when written; a version 3 state still restores
        std::map<std::string, PatterValue> scopes;
        std::map<std::string, std::map<std::string, PatterValue>> sceneBags;
    };

    // A full resumable save-game (version 4): everything that is not a property, plus the registry's
    // values when the engine made its own registry. loadGame reads versions 3 and 4.
    struct SaveGame
    {
        int version = SAVE_VERSION;
        // The engine's own registry's values, keyed by registry key: present only when the engine
        // made the registry itself (a standalone game). A game that passed a registry saves it once,
        // beside this.
        std::optional<ScopeRegistry::SaveBlob> registry;
        std::map<std::string, int> sharedVisits;
        std::map<std::string, SelectorState> sharedSelectors;
        std::map<std::string, FlowSnapshot> flows;
    };

    // ----- checkpoints -------------------------------------------------------------

    class Flow;

    // What an open checkpoint records: how to undo each change, newest last. Each piece of state records
    // itself when it changes (a value, a count, a cursor), never a copy of everything, so a checkpoint
    // costs what the steps inside it do, however much history the game has built up. An undo that names
    // a flow or a bag holds it by shared_ptr, so it outlives whatever a rollback replaces.
    struct Journal
    {
        std::vector<std::function<void()>> undo;
        /** Flows whose cursor is already recorded (or opened inside the checkpoint, so closed on rollback). */
        std::set<const Flow*> flows;
        /** Flows opened inside the checkpoint. */
        std::set<const Flow*> opened;
        /** Selector cursors already copied: shared ones by group id, a flow's own in `flowSelectors`. */
        std::set<std::string> selectors;
        std::map<const Flow*, std::set<std::string>> flowSelectors;
    };

    // An open checkpoint, from Engine::checkpoint(). Opaque: hand it back to rollback() or commit(). A
    // default-constructed one is empty, and is never the open one.
    class Checkpoint
    {
    public:
        Checkpoint() = default;
    private:
        friend class Engine;
        explicit Checkpoint(std::shared_ptr<Journal> journal) : journal_(std::move(journal)) {}
        std::shared_ptr<Journal> journal_;
    };

    // ----- the shared host context the Engine hands to every flow --------------

    /// A problem the engine reported and carried on past. Content can fail at run time in ways the
    /// compiler cannot see: a division by zero, a host value of the wrong type, a story write to a
    /// read-only `@world` value. The story never stops for one. A condition that fails counts as false; an
    /// effect that fails is skipped and the rest of its list still runs; a part of a Best-match condition
    /// that fails scores as false. The engine also reports how it was set up (`setup`: a locale the bundle
    /// doesn't have, a host scope it doesn't declare), a load whose place has gone from the build
    /// (`save`), and a choice that ran dry and so ended the flow (`dry-choice`: a hub whose options were
    /// all used, say). Each is reported through EngineOptions::onError and, when the log or a trace handler is
    /// on, as a `diagnostic` LogEntry; a report made while the engine is being built reaches them as the
    /// constructor ends. Parity with the JS runtime's PlayError.
    struct PlayError
    {
        /// The flow it happened in; "" for a `setup` report, which belongs to no flow.
        std::string flow;
        /// What it was: "condition", "effect", or "best-match" (a part of a condition being scored) that
        /// failed; "setup" (how the engine was set up); "save" (a load whose saved place has gone); or
        /// "dry-choice" (a choice that ran dry with nothing delivered after it, so the flow ended there,
        /// whose `node` is the choice group).
        std::string kind;
        /// The snippet, group, or option whose condition failed, or that owns the effect (a scene, for
        /// its onEntry). For `setup`, the locale or host-scope token at fault. For `save`, the saved
        /// snippet (or, at a pending choice, its group) that has gone.
        std::string node;
        /// The expression's source text, when the bundle carries it; empty when it does not.
        std::string source;
        std::string message;
    };

    /// One retained decision: what the engine CHOSE, not what it produced. The JS runtime's LogEntry,
    /// under the same field names: `type` says which of them an entry carries, and the rest are empty.
    /// `seq` is monotonic across the flow and survives clearLog.
    ///   select:     group, selector, order and exhaust (a sequence's), children, picked (empty when
    ///               nothing was takeable)
    ///   choice:     group, options
    ///   chose:      group, option
    ///   dry:        group
    ///   jump:       to, mode
    ///   write:      target, value, prev (hasPrev false when there was none)
    ///   diagnostic: a problem reported and played through (see PlayError): kind, node, source, message
    struct LogEntry
    {
        std::string type;
        int seq = 0;
        std::string scene;
        /// The flow this happened in. Set on the ENGINE's stream, where a run is several
        /// flows in one order; empty on a flow's own log, which already says whose it is.
        std::string flow;

        std::string group;
        std::string selector, order, exhaust;
        /// Every child a select considered, WITH ITS VERDICT: the reasoning, not just the outcome.
        /// "Why is my line missing" is only answerable from this.
        std::vector<std::pair<std::string, bool>> children;
        std::string picked;
        /// Every option a choice offered, with the ones a condition greyed out marked.
        std::vector<std::pair<std::string, bool>> options;
        std::string option;
        std::string to, mode;
        std::string target;
        PatterValue value;
        bool hasPrev = false;
        PatterValue prev;
        /// A diagnostic's PlayError kind: condition | effect | best-match | setup | save | dry-choice.
        std::string kind;
        std::string node;
        /// A diagnostic's expression source text, when the bundle carries it.
        std::string source;
        std::string message;
    };

    /// The engine-level live tap (Engine::onTrace): every flow's decisions, each with the flow it happened in.
    using TraceHandler = std::function<void(const std::string& flow, const LogEntry& entry)>;

    // A line or text beat's pause (line padding): its own `padAfter` when it sets one, and the resolved one.
    struct BeatPad
    {
        bool hasOwn = false; double own = 0;
        double resolved = DEFAULT_PAD_AFTER;
    };

    struct FlowHost
    {
        /// True when the run asked for a log.
        bool logEnabled = false;
        /// True when anything takes the decisions: the log, or an Engine::onTrace handler. Flows skip
        /// building entries otherwise.
        bool tracing = false;
        /// The engine's live taps, each under the id its unsubscribe removes.
        std::vector<std::pair<int, TraceHandler>> traceHandlers;
        int nextTraceHandler = 0;
        /// The engine's ordered stream, shared by pointer so a flow appends without holding
        /// the engine.
        std::vector<LogEntry>* engineLog = nullptr;
        int engineLogSeq = 0;   // the next engine-log seq: its own counter, since the log's size restarts after a clear
        /// Called with the group id when a choice runs dry - no takeable option and no
        /// eligible fallback - so the silent fall-through is observable, as on every runtime
        /// (onDryChoice in JS). Live feedback, distinct from the log's `dry` entry.
        std::function<void(const std::string&)> onDryChoice;
        /// Where a problem the engine carried on past is reported (see PlayError). Unset: nowhere but the
        /// log, as a std-only core has no console of its own to warn on.
        std::function<void(const PlayError&)> onError;
        /// Where the saved values a load put back to their defaults are reported (EngineOptions::onRefit).
        std::function<void(const std::vector<LoadMisfit>&)> onRefit;
        /// Say what the registry's refitting loads have put back since it last said: after a load, a
        /// flow's restore, and each bag that claims saved values.
        void reportRefits()
        {
            if (!registry) return;
            // This engine's own keys only: the game's registry may hold other engines' and the game's misfits.
            std::vector<LoadMisfit> misfits = registry->takeMisfits([this](const std::string& scope)
            {
                if (scope == "patter" || scope.rfind("patter/", 0) == 0) return true;
                return std::find(hostScopes.begin(), hostScopes.end(), scope) != hostScopes.end();
            });
            if (!misfits.empty() && onRefit) onRefit(misfits);
        }
        const Bundle* bundle = nullptr;
        bool emitIds = false; // IDs-only build: emit beat IDs + omit character names (the game localises)
        // The active locale's string table and the default locale's, pointing into the bundle the engine
        // plays (or the one replaceStrings pushed), which outlives it. Pointers, not copies: a locale switch
        // or a live string refresh re-points them rather than copying every line.
        const std::map<std::string, std::string>* strings = &noStrings();
        const std::map<std::string, std::string>* defaultStrings = &noStrings();
        static const std::map<std::string, std::string>& noStrings() { static const std::map<std::string, std::string> none; return none; }
        std::map<std::string, std::string> castDisplay;
        // Speaker qualifier gameId -> authored name: the fallback for its shown name, as castDisplay is for a speaker's.
        std::map<std::string, std::string> qualifierDisplay;
        // (character, qualifier gameId) -> that character's own label with that qualifier, for the overridden
        // pairs only (the unlocalised fallback). A pair not here follows the pattern, whatever a loc file holds for it.
        std::map<std::pair<std::string, std::string>, std::string> speakerLabels;
        // The project's speaker pattern (the unlocalised fallback for the `speaker:pattern` string).
        std::string speakerPattern = DEFAULT_SPEAKER_PATTERN;

        // A project-level string (`cast:`, `qualifier:`, `speaker:`): the active locale's, then the default
        // locale's; `source` reads the default locale only. Null when neither has it.
        const std::string* locString(const std::string& key, bool source = false) const
        {
            if (!source) { auto a = strings->find(key); if (a != strings->end()) return &a->second; }
            auto d = defaultStrings->find(key);
            return d != defaultStrings->end() ? &d->second : nullptr;
        }
        // A speaker's shown name: the `cast:<name>` string (see locString), else the cast's displayName. Null
        // when neither gives one. Every name a line or a beat shows comes through here.
        const std::string* characterName(const std::string& character, bool source = false) const
        {
            if (const std::string* s = locString("cast:" + character, source)) return s;
            auto c = castDisplay.find(character);
            return c != castDisplay.end() ? &c->second : nullptr;
        }
        // A speaker qualifier's shown name, as a speaker's is: the `qualifier:<gameId>` string, else the
        // authored name. Null when neither gives one.
        const std::string* qualifierName(const std::string& gameId, bool source = false) const
        {
            if (const std::string* s = locString("qualifier:" + gameId, source)) return s;
            auto q = qualifierDisplay.find(gameId);
            return q != qualifierDisplay.end() ? &q->second : nullptr;
        }
        std::map<std::string, const Node*> nodeIndex;
        std::map<std::string, std::string> blockToScene;
        std::map<std::string, const Block*> blockById;
        // Host-facing addresses (spec §6), shared with the engine: scene gameId -> internal id, and
        // per-scene block gameId -> internal id. A flow needs them to resolve goto by address.
        std::map<std::string, std::string> sceneGameIdToId;
        std::map<std::string, std::map<std::string, std::string>> blockGameIdToId;
        std::map<std::string, std::vector<std::string>> tagIndex;   // author tags (#215): node id -> accumulated
        // Line padding: every line and text beat's resolved pause, worked out once per bundle (indexPads).
        std::map<std::string, BeatPad> padIndex;
        // Every beat by its id (a snippet's beats and an option's prompt), for Flow::stepFor; built once per
        // bundle with the indexes above.
        std::map<std::string, const Beat*> beatIndex;
        // Each option of a choice, by its id, to the id of the choice it belongs to: a save stamps the frame an
        // option's content runs in with its choice (StackFrame::choiceId).
        std::map<std::string, std::string> optionChoice;
        /** The game's one registry: @patter (the SHARED globals), host scopes, every instance bag. */
        std::shared_ptr<ScopeRegistry> registry;
        /** True when the engine made the registry (a standalone game): saveGame() then carries its values. */
        bool ownsRegistry = true;
        /** The SHARED @patter globals' bag, registered under `patter`. A bag, not a map: it carries
         *  the audit hook a state logger pushes from, and the clone guard on a mutable default. */
        std::shared_ptr<PropertyBag> patterBag;
        /** Host scopes this engine self-backed and registered (the game bound none, nobody else had). */
        std::vector<std::string> hostScopes;
        /** Host scopes the embedder bound (EngineOptions::hostScopes), registered as external scopes. */
        std::vector<std::string> boundScopes;
        std::vector<PropertyDecl> patterSharedDecls;
        /// Each declaration set's quality ladders, built on first use (see Flow::ladders). They point into the
        /// bundle and these declarations, which live as long as the host.
        std::unordered_map<std::string, std::unordered_map<std::string, const std::vector<std::string>*>> qualityLadders;
        std::vector<PropertyDecl> patterLocalDecls;
        std::set<std::string> patterSharedNames;
        std::map<std::string, std::set<std::string>> sceneSharedNames;
        std::map<std::string, int> sharedVisits;
        std::map<std::string, SelectorState> sharedSelectors;
        /** Per-scene SHARED scene props, each registered under registrykeys::stage(sceneId). Made the
         *  first time any flow needs the scene, so a bag loaded before then waits in the registry and
         *  is claimed here. */
        std::map<std::string, std::shared_ptr<PropertyBag>> stageBags;
        /** The open checkpoint's undo journal, or null when none is open (see Engine::checkpoint). */
        std::shared_ptr<Journal> journal;
        /** Memoised splitRef results (ref -> {scope, name}). The split depends only on the registry's
         *  set of scopes, so the memo is dropped whenever that moves (refSplitRevision). */
        mutable std::map<std::string, std::pair<std::string, std::string>> refSplitCache;
        mutable int refSplitRevision = -1;
        std::function<double()> customRng;
        bool replayPromptOnChoose = false;
        // Closed captions (#214): captionsOn shows cues in dialogue lines (default true); when false the
        // engine strips captionOpen..captionClose spans from line text. Mutable via setClosedCaptions.
        bool captionsOn = true;
        std::string captionOpen = "[";  // default: square brackets (#214)
        std::string captionClose = "]";
        std::string captionCharacter = "SFX"; // a cast member whose whole lines are captions (silent when off)
    };

    // A qualified speaker's label: the pattern with its placeholders filled. Every `{name}` and every
    // `{qualifier}` is replaced, as plain text; nothing else in the pattern is read (and nothing the names
    // bring with them). The one composition rule, on every runtime and in Patterpad.
    inline std::string formatSpeakerLabel(const std::string& pattern, const std::string& name, const std::string& qualifier)
    {
        auto replaceAll = [](const std::string& text, const std::string& token, const std::string& with) {
            std::string out;
            std::size_t from = 0;
            for (std::size_t at; (at = text.find(token, from)) != std::string::npos; from = at + token.size())
                out.append(text, from, at - from).append(with);
            return out.append(text, from, std::string::npos);
        };
        // The name goes in last, so a `{qualifier}` inside the name stays as it is (as the reference does).
        std::string out;
        std::size_t from = 0;
        for (std::size_t at; (at = pattern.find("{name}", from)) != std::string::npos; from = at + 6)
            out.append(replaceAll(pattern.substr(from, at - from), "{qualifier}", qualifier)).append(name);
        return out.append(replaceAll(pattern.substr(from), "{qualifier}", qualifier));
    }

    // The name to show for a line's speaker: with a qualifier, the character's own label for that pair when the
    // bundle overrides it (the `speaker:<name>:<gameId>` string, else the authored label), else the speaker
    // pattern (`{name} ({qualifier})`, the `speaker:pattern` string, else the bundle's) filled with the
    // character's and the qualifier's shown names; with none, the character's shown name. Each piece is looked
    // up as FlowHost::locString does (`source` reads the default locale only), and the token stands in for a
    // name the cast doesn't give, as the gameId does for a qualifier's. False with no character (or an empty
    // one), and in IDs-only mode, where the game maps the tokens itself.
    inline bool speakerLabelOf(const FlowHost& host, bool hasCharacter, const std::string& character,
                               bool hasQualifier, const std::string& qualifier, std::string& out, bool source = false)
    {
        if (!hasCharacter || character.empty() || host.emitIds) return false;
        const std::string* found = host.characterName(character, source);
        const std::string name = found ? *found : character;
        if (!hasQualifier) { out = name; return true; }
        auto own = host.speakerLabels.find({character, qualifier});
        if (own != host.speakerLabels.end())
        {
            const std::string* label = host.locString("speaker:" + character + ":" + qualifier, source);
            out = label ? *label : own->second;
            return true;
        }
        const std::string* shown = host.qualifierName(qualifier, source);
        const std::string* pattern = host.locString("speaker:pattern", source);
        out = formatSpeakerLabel(pattern ? *pattern : host.speakerPattern, name, shown ? *shown : qualifier);
        return true;
    }

    struct EngineOptions
    {
        std::function<double()> rng;                  // shared custom PRNG (runtime corpus cases)
        bool hasSeed = false; double seed = 0;        // per-flow built-in PRNG (scripted corpus cases)
        // The locale to play (embedded localisation); empty = the bundle's default. A locale the bundle
        // doesn't have resolves by the one locale rule (see Engine::setLocale) and is reported (`setup`).
        // An IDs-only bundle takes it as given.
        std::string locale;
        bool replayPromptOnChoose = false;
        bool closedCaptions = true;                   // #214: show caption cues in dialogue lines (default)
        /// Retain a trace of the engine's DECISIONS, readable through log(). Off by default:
        /// a shipped game pays nothing for a debugging surface it never reads.
        bool log = false;
        /// Fired with the choice's group id whenever a choice runs dry. Unaffected by `log`
        /// and useful with it off: live feedback, not an audit read afterwards.
        std::function<void(const std::string&)> onDryChoice;
        /// Called with each problem the engine reported and carried on past (see PlayError): a condition
        /// that failed and counted as false, an effect that failed and was skipped, a Best-match part that
        /// failed and scored as false, a set-up problem (reported as the constructor ends), a load whose
        /// place has gone. The story carries on either way. Unaffected by `log`, which also records each as
        /// a `diagnostic` entry. Unset, the core reports nothing: the UE wrapper sets it (a Warning in the
        /// log and UPatterEngine::OnError), and so should any other host.
        std::function<void(const PlayError&)> onError;
        /// Called with the saved values a load put back to their defaults because they no longer fit their
        /// declarations: a stage, an enum value or a flag deleted since the save was taken, or a value of
        /// another type. Each LoadMisfit says where it was (`scope`, the registry key), its `name`, and what
        /// the save held. Loads refit, so a stage the build no longer has never reaches a gate that orders
        /// it. Called after loadGame, restoreFlow, hotSwap and each bag a flow makes that claims saved values;
        /// a game that loads its own registry passes refit too, and hears those here as the engine's bags
        /// claim them. Unset, the core reports nothing, as for onError: the UE wrapper sets it (a Warning in
        /// the log and UPatterEngine::OnRefit). JS's onRefit.
        std::function<void(const std::vector<LoadMisfit>&)> onRefit;
        // Live game state per host-scope token ("world" -> your resolver): values the GAME keeps. Each
        // binding is registered in the registry as an external scope (read and written through, never
        // stored or saved there). Declared tokens you do not bind are self-backed by a standalone
        // engine, as properties the registry stores and saves; given the game's registry, the engine
        // self-backs nothing, since those tokens are the game's to register (or another engine's).
        // Tokens are case-sensitive: a token the bundle doesn't declare is reported (`setup`), naming the
        // declared spelling when only the case differs, and never folded onto it.
        std::map<std::string, HostScope> hostScopes;
        // The game's registry: ONE per game, holding every engine's properties except those the game
        // keeps itself, saved once. Given one, the engine registers its own scopes in it (@patter under
        // `patter`, its per-flow and per-scene bags under keys starting `patter/`, and each bound host
        // scope), reads every other scope from it, and saveGame() leaves the property values to the
        // game. Leave it null and the engine makes its own registry and acts as its own game: it
        // self-backs declared host scopes, and saveGame() carries the registry's values too.
        std::shared_ptr<ScopeRegistry> registry;
    };

    // The ONE rule for resolving a scene address, used by openFlow, goto, and every engine lookup: its gameId
    // (the host-facing address, spec 6) first, then its internal id. Empty when it does not resolve.
    // openFlow used to try the internal id first and goto the gameId, so the two could land in different
    // scenes when one scene's id was another's gameId.
    inline std::string resolveScene(const FlowHost& host, const std::string& ref)
    {
        auto it = host.sceneGameIdToId.find(ref);
        if (it != host.sceneGameIdToId.end()) return it->second;
        return host.bundle->scenes.count(ref) ? ref : std::string();
    }

    // The one rule for a block address, always WITHIN a scene: its gameId there first, then the internal
    // id of a block in that scene. A real block of another scene does not resolve. Empty when it does not.
    inline std::string resolveBlock(const FlowHost& host, const std::string& sceneId, const std::string& ref)
    {
        auto m = host.blockGameIdToId.find(sceneId);
        if (m != host.blockGameIdToId.end())
        {
            auto it = m->second.find(ref);
            if (it != m->second.end()) return it->second;
        }
        auto owner = host.blockToScene.find(ref);
        return owner != host.blockToScene.end() && owner->second == sceneId ? ref : std::string();
    }

    // Split a ref against the registry's current tokens (@scene is always Patter's). Memoised per ref;
    // the memo is dropped when the registry's set of scopes moves.
    inline std::pair<std::string, std::string> splitHostRef(const FlowHost& host, const std::string& ref)
    {
        const ScopeRegistry& reg = *host.registry;
        if (host.refSplitRevision != reg.revision())
        {
            host.refSplitCache.clear();
            host.refSplitRevision = reg.revision();
        }
        auto hit = host.refSplitCache.find(ref);
        if (hit != host.refSplitCache.end()) return hit->second;
        // Another engine's scope the content names (`@story.act`) is a scope even before that engine
        // registers it: a write then fails naming it, where it would otherwise land in @patter as
        // `story.act`.
        const std::vector<std::string>& external = host.bundle->externalScopes;
        auto split = splitRef(ref, std::function<bool(const std::string&)>(
            [&reg, &external](const std::string& t)
            {
                return reg.has(t) || std::find(external.begin(), external.end(), t) != external.end();
            }));
        host.refSplitCache.emplace(ref, split);
        return split;
    }

    // What a declared property takes, in words, for a refused host write: the same words on every runtime.
    inline std::string takesWords(const std::string& type, const std::vector<std::string>& values, const std::vector<std::string>& stages)
    {
        const auto quoted = [](const std::vector<std::string>& xs)
        {
            std::string out;
            for (size_t i = 0; i < xs.size(); ++i) { if (i) out += ", "; out += PatterValue::JsonQuote(xs[i]); }
            return out;
        };
        if (type == "number") return "a number";
        if (type == "boolean") return "true or false";
        if (type == "enum") return "one of " + quoted(values);
        if (type == "flags") return !values.empty() ? "a list of flags from " + quoted(values) : "a list of flags";
        if (type == "quality") return "one of its stages " + quoted(stages);
        return "text";
    }

    // Refuse a host write that doesn't fit what the content declared (the hands-on review, 2026-10): a string
    // for a number, a value an enum or a quality doesn't list, a flag a flags property doesn't, or a name the
    // content doesn't declare. The rule is the kernel's ValueFits, the one a load walks saved values with, so
    // a value the game may set is exactly one a save may carry; an enum whose own default is "" (none chosen)
    // takes "" back. A scope the bundle doesn't declare (another engine's, or one the game keeps) is its
    // owner's to check, and an opaque one (no declarations) takes anything. Throws EvalError, changing nothing.
    // `name` is lowercased, as splitRef gives it; `sceneId` is the scene an @scene write lands in.
    inline void checkHostWrite(const FlowHost& host, const std::string& scope, const std::string& name,
                               const PatterValue& value, const std::string& sceneId)
    {
        bool found = false, noneChosen = false;
        std::string type;
        const std::vector<std::string>* values = nullptr;
        const std::vector<std::string>* stages = nullptr;
        const auto take = [&](const auto& d)
        {
            found = true; type = d.type; values = &d.values; stages = &d.stages;
            noneChosen = d.type == "enum" && d.hasDefault && d.def.isString() && d.def.asString().empty();
        };
        if (scope == "patter" || scope == "scene")
        {
            const std::vector<PropertyDecl>* decls = nullptr;
            if (scope == "patter") decls = &host.bundle->properties;
            else
            {
                auto it = host.bundle->scenes.find(sceneId);
                if (it != host.bundle->scenes.end()) decls = &it->second.sceneProps;
            }
            if (decls) for (const auto& d : *decls) if (toLower(d.name) == name) { take(d); break; }
        }
        else
        {
            const HostScopeSpec* spec = nullptr;
            for (const auto& sp : host.bundle->scopeRegistry.scopes) if (sp.token == scope) { spec = &sp; break; }
            if (!spec || !spec->hasDeclarations) return;   // not this bundle's to check, or opaque: the game's
            for (const auto& d : spec->declarations) if (toLower(d.name) == name) { take(d); break; }
        }
        const std::string path = "@" + scope + "." + name;
        if (!found) throw EvalError("no property at \"" + path + "\": the content declares no " + path);
        const auto listed = [](const std::vector<std::string>* xs)
        {
            return xs && !xs->empty() ? std::optional<std::vector<std::string>>(*xs) : std::nullopt;
        };
        if (!wildwinter::expr::ValueFits(type, listed(values), listed(stages), value, noneChosen))
            throw EvalError("\"" + path + "\" takes " + takesWords(type, *values, *stages) + "; " + value.toJsonString() + " doesn't fit");
    }

    // The stage ladder of each declared quality in one set of declarations, by lowercased name (the first
    // declaration of a name wins). Built once per set and kept on the host: a comparison asks for a ladder
    // every time it runs, and scanning the declarations each time cost a pass and a lowercasing per
    // declaration per comparison. `each` calls the function it is given with every declaration in the set.
    template <typename Each>
    const std::vector<std::string>* qualityLadder(FlowHost& host, const std::string& cacheKey, Each each, const std::string& key)
    {
        auto found = host.qualityLadders.find(cacheKey);
        if (found == host.qualityLadders.end())
        {
            std::unordered_map<std::string, const std::vector<std::string>*> built;
            each([&built](const auto& d) { if (d.type == "quality") built.emplace(toLower(d.name), &d.stages); });
            found = host.qualityLadders.emplace(cacheKey, std::move(built)).first;
        }
        auto hit = found->second.find(key);
        return hit == found->second.end() ? nullptr : hit->second;
    }

    // ----- Flow ----------------------------------------------------------------

    // The result of advanceToStop: every beat played on the way to a stop, plus the terminal
    // choice / end that stopped it.
    struct AdvanceToStopResult
    {
        std::vector<StepResult> played;
        StepResult stop;
    };

    class Flow : public std::enable_shared_from_this<Flow>
    {
    public:
        Flow(std::string id, FlowHost* host, double seed) : id_(std::move(id)), host_(host)
        {
            rngState_ = Mulberry32::ToUint32(seed);
            local_ = newLocal(); // registered by begin() / restore()
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
            // @patter and @scene each span a shared bag and this flow's own, split by each property's
            // `shared` flag, so the flow composes those two tokens itself over registered bags. Every
            // other token comes from the registry's context (see context()).
            patterScope_ = fnScope([this](const std::string& n) { return patterGet(n); });
            sceneScope_ = fnScope([this](const std::string& n) { return sceneGet(n); });
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

        const std::vector<std::string>& ladderOf(const std::string& ref)
        {
            auto sp = splitHostRef(*host_, ref);
            context(); // the registry's quality lookup, for a scope another engine or the game declares
            const std::vector<std::string>* ladder = stagesFor(sp.first, sp.second);
            if (!ladder) throw EvalError("'" + ref + "' is not a quality");
            return *ladder;
        }

        // The stage ladder of `@scope.name` when it is a declared quality, else null. Names compare
        // lowercase, as the compiler emits references. Mirrors the JS Flow.stagesFor.
        const std::vector<std::string>* stagesFor(const std::string& scope, const std::string& name) const
        {
            const std::string key = toLower(name);
            if (scope == "patter")
                return ladders("patter", [&](auto add) { for (const auto& d : host_->patterSharedDecls) add(d); for (const auto& d : host_->patterLocalDecls) add(d); }, key);
            if (scope == "scene")
            {
                auto it = host_->bundle->scenes.find(currentSceneId_);
                if (it == host_->bundle->scenes.end()) return nullptr;
                return ladders("scene/" + currentSceneId_, [&](auto add) { for (const auto& d : it->second.sceneProps) add(d); }, key);
            }
            // Any other scope's ladder is the registry's (another engine's @story, the game's @world),
            // with the bundle's own host-scope declarations behind it for a game that registered
            // @world undeclared.
            if (registryQualities_)
            {
                if (const auto* s = registryQualities_(scope, name)) return s;
            }
            return ladders("host/" + scope, [&](auto add)
            {
                for (const auto& spec : host_->bundle->scopeRegistry.scopes)
                    if (spec.token == scope) for (const auto& d : spec.declarations) add(d);
            }, key);
        }

        template <typename Each>
        const std::vector<std::string>* ladders(const std::string& cacheKey, Each each, const std::string& key) const
        {
            return qualityLadder(*host_, cacheKey, each, key);
        }

        // The options of the choice currently waiting for the player, empty when none is pending. The same
        // list the `choice` step carries, its prompts built now in the language in use and against the
        // current values - re-readable, e.g. after restoring a save or switching language.
        std::vector<ChoiceOption> getChoices() { return hasPendingChoice_ ? offer() : std::vector<ChoiceOption>{}; }

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
            touch();
            if (scene == "END")
            {
                started_ = true; clearPending();
                activeSnippet_ = nullptr; beatIndex_ = 0;
                flowEnded_ = true; stack_.clear();
                dryChoice_.clear(); ranDry_.clear(); // the host ended it: Ended, whatever ran dry before
                return true;
            }
            // Resolve BOTH addresses before touching state, so a bad one is a no-op, not a half-move.
            const std::string sceneId = resolveScene(*host_, scene);
            if (sceneId.empty()) return false;

            std::string blockId;
            if (!block.empty())
            {
                blockId = resolveBlock(*host_, sceneId, block);
                if (blockId.empty()) return false; // a block address is scene-scoped: unknown HERE is unknown
            }
            if (!started_) { begin(sceneId, blockId); return true; }

            clearPending();
            activeSnippet_ = nullptr; beatIndex_ = 0; // abandon the rest of the snippet being delivered
            flowEnded_ = false;                       // an ended flow resumes at the target
            dryChoice_.clear(); ranDry_.clear();
            enterTarget(blockId.empty() ? sceneId : blockId, "jump"); // replace the stack, like an authored goto
            settle();
            return true;
        }

        // Finish this flow for good. Engine-managed (closeFlow, reset, and the openFlow replace path). A
        // dropped flow used to stay fully live, so a host still holding it could keep advancing it and move
        // shared state. Closing makes that stale reference inert. Terminal: never revived.
        void close()
        {
            releaseBags(false);
            closed_ = true;
            flowEnded_ = true;
            stack_.clear();
            activeSnippet_ = nullptr;
            beatIndex_ = 0;
            clearPending();
        }

        bool isClosed() const { return closed_; }
        bool isEnded() const { return flowEnded_; }

        /** Forget everything in this flow and begin again: its per-flow state (not-shared @patter globals and
         *  @scene props), cursor, call stack, selector cursors, visit counts, and anything waiting to be
         *  delivered. Shared state is untouched. The one public way to begin a flow again (openFlow begins a
         *  new one), as Flow.reset is on every runtime. */
        void reset(const std::string& sceneId = std::string(), const std::string& blockId = std::string())
        {
            begin(sceneId, blockId);
        }

    private:
        friend class Engine;

        /** Begin this flow at a scene (empty: the bundle's start, else the first authored scene), and
         *  optionally a block within it. The engine's own entry point: openFlow and a goto on an unstarted flow
         *  begin a flow here. A game calls reset(). */
        void begin(std::string sceneId, std::string blockId)
        {
            // No scene named: the project's start, when the bundle carries one; else the first scene, below.
            const BundleStart& start = host_->bundle->start;
            // A start naming a scene, or block, the bundle doesn't have (only a hand-edited bundle can) is passed over.
            if (sceneId.empty() && blockId.empty() && start.present && host_->bundle->scenes.count(start.scene))
            {
                sceneId = start.scene;
                if (!start.block.empty())
                {
                    auto owner = host_->blockToScene.find(start.block);
                    if (owner != host_->blockToScene.end() && owner->second == start.scene) blockId = start.block;
                }
            }
            // Starting resets this flow's property bags, which a rollback can't put back: only a flow opened
            // inside the checkpoint may start in one.
            if (host_->journal && !host_->journal->opened.count(this))
                throw std::runtime_error("a flow can't be started or reset while a checkpoint is open");
            // A start is a reset: this flow's bags go, and so does anything a load left waiting for them.
            releaseBags(false);
            host_->registry->discardParked(registrykeys::flow(id_));
            mountLocal();
            selectors_.clear();
            visitCounts_.clear();
            stack_.clear();
            currentSceneId_.clear();
            flowEnded_ = false;
            dryChoice_.clear(); ranDry_.clear();
            activeSnippet_ = nullptr;
            beatIndex_ = 0;
            clearPending();
            started_ = true;

            if (!blockId.empty())
            {
                auto it = host_->blockToScene.find(blockId);
                if (it == host_->blockToScene.end()) throw std::runtime_error("unknown block: " + blockId);
                enterSceneSetup(it->second);
                stack_.push_back({ it->second, blockId, 0, "", "" });
                enter(blockId);
            }
            else
            {
                std::string id = sceneId;
                if (id.empty() && !host_->bundle->scenes.empty()) id = host_->bundle->scenesInOrder().front()->id;
                auto it = host_->bundle->scenes.find(id);
                if (it == host_->bundle->scenes.end()) throw std::runtime_error(id.empty() ? "no scenes in bundle" : ("unknown scene: " + id));
                enterSceneSetup(id);
                if (!it->second.blocks.empty())
                {
                    const Block& first = it->second.blocks.front();
                    stack_.push_back({ id, first.id, 0, "", "" });
                    enter(first.id);
                }
            }
            settle();
        }

    public:
        /** This flow's id, as the engine knows it. */
        const std::string& id() const { return id_; }

        /** How many times this flow has entered each node, by node id. */
        const std::map<std::string, int>& getVisitCounts() const { return visitCounts_; }

        /**
         * The step this flow would deliver for beat `beatId` right now, as advance() would give it: its text in
         * the active locale, interpolated against this flow's values (unless the project is voiced), closed
         * captions applied, and the speaker's names and label, its pause, Game Data, and tags. Built by the same
         * function that builds a delivered step, so the two can't differ. It doesn't move the flow, count a
         * visit, or run an effect. Empty for an id that is neither a beat nor an option's prompt. For a game
         * that keeps lines by id and shows them again (after a load, or a language switch).
         */
        std::optional<StepResult> stepFor(const std::string& beatId)
        {
            auto it = host_->beatIndex.find(beatId);
            if (it == host_->beatIndex.end()) return std::nullopt;
            return beatResult(*it->second);
        }

        StepResult advance()
        {
            if (closed_) return StepResult::End(); // a stale reference drives nothing: plain Ended
            if (!started_) throw std::runtime_error("flow has not been started");
            touch();
            if (pendingPromptBeat_)
            {
                const Beat* b = pendingPromptBeat_; std::shared_ptr<ChoicePrompt> shown = pendingPromptShown_;
                pendingPromptBeat_ = nullptr; pendingPromptShown_.reset(); pendingPromptOwnerId_.clear();
                return shown ? promptResult(*b, *shown) : beatResult(*b);
            }
            settle();
            if (!flowEnded_ && !activeSnippet_ && !hasPendingChoice_) flowEnded_ = true;
            if (flowEnded_) return endResult();
            dryChoice_.clear(); // a choice or a beat comes after it: play carried on past the dry choice
            if (hasPendingChoice_)
            {
                StepResult r; r.type = StepType::Choice; r.groupId = pendingGroupId_; r.options = offer(); return r;
            }
            return beatResult(activeSnippet_->beats[beatIndex_++]);
        }

    private:
        /** The End step. The first time a flow reports its end straight after a choice ran dry, that choice is
         *  why it ended: say so through onError, once (Ian's rulings on choices that run dry, 2026-10-30). An
         *  explicit END reached after it still counts; a block simply ending, with nothing dry, is just the end. */
        StepResult endResult()
        {
            if (!dryChoice_.empty())
            {
                const std::string group = dryChoice_;
                dryChoice_.clear();
                ranDry_ = group;
                PlayError err;
                err.flow = id_; err.kind = "dry-choice"; err.node = group;
                err.message = "choice '" + group + "' ran dry (no option left to take, and no fallback) with nothing after it, so the flow ended there";
                report(err);
            }
            return StepResult::End(ranDry_.empty() ? FlowEndReason::Ended : FlowEndReason::RanDry);
        }

    public:

        /// This flow's decisions, in order. Empty unless the run was opened with
        /// EngineOptions::log. The engine's log carries the same events tagged with the flow.
        const std::vector<LogEntry>& log() const { return log_; }

        /// Drop the retained entries. `seq` keeps counting, so order survives a clear.
        void clearLog() { log_.clear(); }

    private:
        // The write itself. `host` says WHO is writing, which is all `writable: false` cares about: the
        // registry refuses a story's write to a read-only declaration, bound or self-backed alike. A
        // refusal is the kernel's RegistryError, rethrown as Patterplay's EvalError.
        void writeProperty(const std::string& ref, const PatterValue& value, bool host)
        {
            kernelCall([&]
            {
                auto sp = splitHostRef(*host_, ref);
                const std::string& name = sp.second;
                // The game's value must fit what the content declared; the story's own writes were checked as
                // they compiled.
                if (host)
                {
                    if (sp.first == "scene" && currentSceneId_.empty()) throw std::runtime_error("'" + ref + "': the flow has not entered a scene yet");
                    checkHostWrite(*host_, sp.first, name, value, currentSceneId_);
                }
                Journal* journal = host_->journal.get();
                if (sp.first == "patter")
                {
                    // Inside a checkpoint, each write records how to put the old value back, against the bag
                    // it actually landed in (a `@scene` write's bag depends on the scene the flow is in).
                    if (journal)
                    {
                        const bool shared = host_->patterSharedNames.count(name) > 0;
                        std::optional<PatterValue> prev = shared ? host_->patterBag->get(name) : local_->get(name);
                        if (prev)
                        {
                            if (shared)
                            {
                                std::shared_ptr<ScopeRegistry> reg = host_->registry;
                                journal->undo.push_back([reg, name, was = *prev] { reg->set("patter", name, was); });
                            }
                            else
                            {
                                std::shared_ptr<PropertyBag> bag = local_;
                                journal->undo.push_back([bag, name, was = *prev] { bag->set(name, was); });
                            }
                        }
                    }
                    patterSet(name, value);
                }
                else if (sp.first == "scene")
                {
                    if (currentSceneId_.empty()) throw std::runtime_error("'" + ref + "': the flow has not entered a scene yet");
                    if (journal)
                    {
                        std::shared_ptr<PropertyBag> bag = sceneBagShared(name);
                        std::optional<PatterValue> prev = bag ? bag->get(name) : std::nullopt;
                        if (bag && prev) journal->undo.push_back([bag, name, was = *prev] { bag->set(name, was); });
                    }
                    sceneSet(name, value);
                }
                else
                {
                    std::optional<PatterValue> prev = journal ? host_->registry->get(sp.first, name) : std::nullopt;
                    host_->registry->set(sp.first, name, value, host); // host scopes, other engines' scopes
                    // Recorded after the write: one a read-only host scope refused never happened, so has
                    // nothing to undo.
                    if (journal && prev)
                    {
                        std::shared_ptr<ScopeRegistry> reg = host_->registry;
                        journal->undo.push_back([reg, scope = sp.first, name, was = *prev] { reg->set(scope, name, was, /*host=*/true); });
                    }
                }
            });
        }

        /// Record one decision, on this flow's log and the engine's. Cheap with logging off:
        /// the entry is never built. The engine's vector is appended to through a pointer -
        /// nothing captures the engine, which is the shape Godot's weak debug registry forced.
        void emit(LogEntry e)
        {
            if (!host_->tracing) return;
            e.scene = currentSceneId_;
            LogEntry wide = e;
            wide.flow = id_;
            if (host_->logEnabled)
            {
                e.seq = seq_++;
                log_.push_back(std::move(e));
                wide.seq = host_->engineLogSeq++;
                if (host_->engineLog) host_->engineLog->push_back(wide);
            }
            if (!host_->traceHandlers.empty())
            {
                // A copy: a handler may unsubscribe itself, or another, while being called.
                const auto handlers = host_->traceHandlers;
                for (const auto& h : handlers) h.second(id_, wide);
            }
        }

    public:
        void choose(const std::string& id)
        {
            if (!hasPendingChoice_) throw std::runtime_error("no choice is pending");
            const PendingOption* option = nullptr;
            for (auto& o : pendingOptions_) if (o.id == id) { option = &o; break; }
            if (!option) throw std::runtime_error("unknown choice option: " + id);
            if (!option->eligible) throw std::runtime_error("choice option is not eligible: " + id);
            touch();
            const Node* picked = pendingById_[id];
            if (host_->tracing) { LogEntry e; e.type = "chose"; e.group = pendingGroupId_; e.option = id; emit(std::move(e)); }
            // Speak the chosen option's prompt back as its first beat (spec 5): only an AUTHORED prompt, and
            // exactly as the choice showed it (the one prompt that doesn't follow the language: a documented
            // exception). A prompt borrowed from the option's own first content line is not replayed, since
            // that line is about to play as content anyway. A choice never delivered since a load shows its
            // prompt as it would be now, before the option's onEnter runs. (Worked out before
            // clearPendingChoice() drops what was shown.)
            const Beat* authored = host_->replayPromptOnChoose ? authoredPromptOf(picked) : nullptr;
            std::shared_ptr<ChoicePrompt> shownPrompt;
            if (authored)
            {
                auto was = pendingShown_.find(id);
                std::shared_ptr<ChoicePrompt> shown = was != pendingShown_.end() ? was->second : promptFor(picked);
                if (shown) shownPrompt = std::make_shared<ChoicePrompt>(*shown);
            }
            clearPendingChoice();
            pendingPromptBeat_ = shownPrompt ? authored : nullptr;
            pendingPromptShown_ = shownPrompt;
            pendingPromptOwnerId_ = pendingPromptBeat_ ? picked->id : "";
            enterChild(picked);
        }

        // Read a property by ref: @patter and @scene through this flow's halves, anything else (host
        // scopes, other engines' scopes) from the registry. The pointer is valid until the next call.
        const PatterValue* getProperty(const std::string& ref) const
        {
            auto sp = splitHostRef(*host_, ref);
            if (sp.first == "patter") return patterGet(sp.second);
            if (sp.first == "scene") return sceneGet(sp.second);
            std::optional<PatterValue> v = host_->registry->get(sp.first, sp.second);
            if (!v) return nullptr;
            slot_ = std::move(*v);
            return &slot_;
        }

        // Write a property by ref. The GAME's surface, so a host declaration's `writable: false` binds
        // the story, not the game that owns the value. Effects use writeProperty(.., false). THROWS
        // EvalError, changing nothing, on a value that doesn't fit the declaration, or a name the content
        // doesn't declare (an @scene name in the scene this flow is in), as Engine::setProperty does.
        void setProperty(const std::string& ref, const PatterValue& value) { writeProperty(ref, value, true); }

        // A quality's ladder, for game code holding one of its values: the position of `value` on the ladder of
        // the quality `ref` names (@patter, @scene in the scene this flow is in, or a host scope), or -1 when it
        // isn't one of the stages. Throws EvalError when `ref` isn't a quality.
        int stageIndex(const std::string& ref, const PatterValue& value) { return StageIndex(ladderOf(ref), value); }
        // -1, 0 or 1 as stage `a` is below, at or above stage `b` on that ladder. Throws EvalError when either
        // isn't a stage, or `ref` isn't a quality.
        int compareStages(const std::string& ref, const PatterValue& a, const PatterValue& b)
        {
            const auto& ladder = ladderOf(ref);
            return kernelCall([&] { return CompareStages(ladder, a, b); });
        }
        // The stage after `value` on that ladder, staying on the top rung, as advance() does. Throws EvalError
        // when `value` isn't a stage, or `ref` isn't a quality.
        std::string nextStage(const std::string& ref, const PatterValue& value)
        {
            const auto& ladder = ladderOf(ref);
            return kernelCall([&] { return NextStage(ladder, value); });
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

        /** @internal Snapshot this flow's cursor + PRNG + visits. Its properties are the registry's. */
        FlowSnapshot snapshot() const
        {
            FlowSnapshot s;
            s.rngState = rngState_;
            s.visits = visitCounts_;
            s.flowEnded = flowEnded_;
            s.ranDry = ranDry_;   // why it ended, when a choice running dry ended it: a loaded game ends the same way
            s.currentSceneId = currentSceneId_;
            // Stamp each frame with the id of the child it would run next, so a restore against an
            // EDITED bundle re-finds the position by id instead of trusting the raw index (spec 9.8). A frame
            // an option's content runs in carries its choice (choiceId), to be offered again if the option
            // has gone.
            s.stack = stack_;
            for (auto& frame : s.stack)
            {
                const std::vector<NodePtr>* children = childrenOf(frame.containerId);
                if (children && frame.index >= 0 && frame.index < static_cast<int>(children->size()))
                    frame.nextId = (*children)[frame.index]->id;
                auto choice = host_->optionChoice.find(frame.containerId);
                if (choice != host_->optionChoice.end()) frame.choiceId = choice->second;
            }
            s.activeSnippetId = activeSnippet_ ? activeSnippet_->id : "";
            // The next beat by id, so an edit to the snippet can't move it; none once every beat is delivered.
            if (activeSnippet_ && beatIndex_ >= 0 && beatIndex_ < static_cast<int>(activeSnippet_->beats.size()))
                s.beatId = activeSnippet_->beats[beatIndex_].id;
            if (hasPendingChoice_)
            {
                // Which options, never their text: a prompt is built again in the language in use whenever the
                // choice is delivered. The gameData is the save's own copy.
                s.hasPendingChoice = true;
                s.pendingGroupId = pendingGroupId_;
                for (const PendingOption& o : pendingOptions_) s.pendingOptions.push_back({ o.id, o.eligible, copyGameData(o.gameData) });
            }
            s.pendingPromptOwnerId = pendingPromptOwnerId_;
            if (pendingPromptShown_) s.pendingPrompt = std::make_shared<ChoicePrompt>(*pendingPromptShown_);
            s.selectors = selectors_;
            return s;
        }

        /** @internal Restore this flow from a snapshot: its cursor, PRNG, visits, and selector cursors.
         *  Its property values are the registry's and stay as they are (a load puts the saved ones there
         *  first). A place that has gone from the build resumes at the nearest safe point, reported (`save`). */
        void restore(const FlowSnapshot& snap)
        {
            if (host_->journal) throw std::runtime_error("a flow can't be restored while a checkpoint is open");
            const Drift drift = restoreCursor(snap);
            // Register this flow's bags: each claims the values the registry holds for it (loaded by the
            // game, by loadGame from the save, or handed back by the engine this one replaces), laid over
            // fresh defaults. Released KEEPING their values, so a live flow restored in place keeps its
            // property values (a fresh one, made by a load, is claiming the loaded values either way). The
            // scenes the cursor stands in are registered now; any other scene's bag is claimed on entry.
            releaseBags(true);
            mountLocal();
            {
                std::vector<std::string> scenes;
                auto note = [&scenes](const std::string& s)
                {
                    if (!s.empty() && std::find(scenes.begin(), scenes.end(), s) == scenes.end()) scenes.push_back(s);
                };
                note(currentSceneId_);
                for (const auto& frame : stack_) note(frame.sceneId);
                for (const auto& s : scenes) if (host_->bundle->scenes.count(s)) ensureSceneBags(s);
            }
            // Only now, with the values back, can a choice be offered again: its conditions read them.
            if (drift.gone)
            {
                PlayError err;
                err.flow = id_; err.kind = "save"; err.node = drift.node;
                err.message = "the save's place has gone from this build: " + drift.instead;
                report(err);
                if (drift.reoffer) setupChoice(drift.reoffer);
            }
        }

    private:
        /** Where a load found its saved place gone from the build (spec 9.8), to resume from once the flow's
         *  bags are back. */
        struct Drift
        {
            bool gone = false;
            /** The report's node: the saved snippet, or at a pending choice its group. */
            std::string node;
            /** What has gone and what the flow does instead, for the report's message. */
            std::string instead;
            /** The choice to offer again: the one the gone option belonged to, or a pending choice none of whose
             *  options survive. */
            const Node* reoffer = nullptr;
        };

        /** The cursor half of restore(), without touching the bags. Says where the saved place had gone, if it had. */
        Drift restoreCursor(const FlowSnapshot& snap)
        {
            rngState_ = snap.rngState;
            visitCounts_ = snap.visits;
            started_ = true;
            flowEnded_ = snap.flowEnded;
            dryChoice_.clear();
            ranDry_ = snap.flowEnded ? snap.ranDry : std::string(); // honoured only on an ended flow; never re-reported
            currentSceneId_ = snap.currentSceneId;
            Drift drift;
            // Re-bind each frame to the CURRENT bundle: prefer the saved next-child id (survives
            // siblings inserted / removed / reordered before the cursor); fall back to the raw index
            // when absent (at the container's end) or its node drifted out of the bundle (spec 9.8
            // best-effort). A frame whose OPTION has gone, with its choice still there, ends the stack:
            // the choice is offered again.
            stack_.clear();
            for (const StackFrame& saved : snap.stack)
            {
                const std::vector<NodePtr>* children = childrenOf(saved.containerId);
                if (!children && !saved.choiceId.empty())
                {
                    auto choice = host_->nodeIndex.find(saved.choiceId);
                    if (choice != host_->nodeIndex.end() && choice->second->isGroup() && choice->second->selector == "choice")
                    {
                        drift.gone = true;
                        drift.node = !snap.activeSnippetId.empty() ? snap.activeSnippetId
                            : snap.hasPendingChoice ? snap.pendingGroupId : saved.containerId;
                        drift.instead = "option " + saved.containerId + " has gone, so choice " + saved.choiceId + " is offered again";
                        drift.reoffer = choice->second;
                        break;
                    }
                }
                StackFrame frame{ saved.sceneId, saved.containerId, saved.index, "", "" };   // live frames carry no stamps
                if (!saved.nextId.empty() && children)
                    for (size_t i = 0; i < children->size(); i++)
                        if ((*children)[i]->id == saved.nextId) { frame.index = static_cast<int>(i); break; }
                stack_.push_back(std::move(frame));
            }

            // Content-drift policy (spec 9.8): if a saved position points at content deleted since the save,
            // resume at the nearest safe point rather than throwing. A gone snippet is skipped: play carries on
            // from the surviving stack. A gone NEXT beat in a surviving snippet finishes the snippet (its onExit
            // and jump run), so nothing plays twice. A version 3 save names the beat by its raw index, trusted
            // as it always was.
            activeSnippet_ = nullptr;
            beatIndex_ = 0;
            if (!drift.reoffer && !snap.activeSnippetId.empty())
            {
                auto it = host_->nodeIndex.find(snap.activeSnippetId);
                if (it != host_->nodeIndex.end() && it->second->isSnippet())
                {
                    const std::vector<Beat>& beats = it->second->beats;
                    activeSnippet_ = it->second;
                    if (!snap.beatId.empty())
                    {
                        int at = -1;
                        for (size_t i = 0; i < beats.size(); i++) if (beats[i].id == snap.beatId) { at = static_cast<int>(i); break; }
                        beatIndex_ = at >= 0 ? at : static_cast<int>(beats.size());
                        if (at < 0)
                        {
                            drift.gone = true; drift.node = snap.activeSnippetId;
                            drift.instead = "beat " + snap.beatId + " has gone from snippet " + snap.activeSnippetId + ", so the snippet ends there";
                        }
                    }
                    // Version 4 writes no beat once every one is delivered; version 3 writes its index.
                    else beatIndex_ = snap.beatIndex >= 0 ? snap.beatIndex : static_cast<int>(beats.size());
                }
                else
                {
                    drift.gone = true; drift.node = snap.activeSnippetId;
                    drift.instead = "snippet " + snap.activeSnippetId + " has gone, so play carries on after it";
                }
            }
            selectors_ = snap.selectors;

            // Replay the saved option set VERBATIM (schema 9.3) - re-deriving would re-evaluate conditions
            // (double-consuming PRNG draws) and could change the choice under the player. Prompts are not in
            // the save (a version 3 save's are discarded): they are built when the choice is delivered.
            // Options whose nodes drifted out of the bundle are dropped. A choice with no surviving option is
            // offered again, when its group is still there, or dissolves (9.8).
            clearPendingChoice();
            if (!drift.reoffer && snap.hasPendingChoice)
            {
                std::vector<PendingOption> options;
                std::map<std::string, const Node*> byId;
                for (const auto& o : snap.pendingOptions)
                {
                    auto it = host_->nodeIndex.find(o.id);
                    if (it == host_->nodeIndex.end()) continue;
                    byId[o.id] = it->second;
                    options.push_back({ o.id, o.eligible, copyGameData(o.gameData) });
                }
                if (!options.empty()) { hasPendingChoice_ = true; pendingGroupId_ = snap.pendingGroupId; pendingOptions_ = std::move(options); pendingById_ = std::move(byId); }
                else
                {
                    auto group = host_->nodeIndex.find(snap.pendingGroupId);
                    const bool isChoice = group != host_->nodeIndex.end() && group->second->isGroup() && group->second->selector == "choice";
                    drift.gone = true; drift.node = snap.pendingGroupId; drift.reoffer = isChoice ? group->second : nullptr;
                    drift.instead = isChoice ? "none of choice " + snap.pendingGroupId + "'s options is left, so it's offered again"
                                             : "choice " + snap.pendingGroupId + " has gone, so play carries on after it";
                }
            }

            // A save taken between choose() and the next advance() left a prompt still to be replayed: the
            // chosen option's authored prompt beat, found again by its owner, and the prompt as the choice
            // showed it, carried by the save. A save from before pendingPrompt existed has only the owner, and
            // its beat is resolved when delivered, as it was then. Dropped if the option drifted out of the
            // bundle or has no authored prompt (spec 9.8): the live choose() would replay nothing.
            pendingPromptBeat_ = nullptr;
            pendingPromptShown_.reset();
            pendingPromptOwnerId_ = drift.reoffer ? std::string() : snap.pendingPromptOwnerId;
            if (!pendingPromptOwnerId_.empty())
            {
                auto it = host_->nodeIndex.find(pendingPromptOwnerId_);
                if (it != host_->nodeIndex.end()) pendingPromptBeat_ = authoredPromptOf(it->second);
            }
            if (!pendingPromptBeat_) pendingPromptOwnerId_.clear();
            else if (snap.pendingPrompt)
            {
                pendingPromptShown_ = std::make_shared<ChoicePrompt>(*snap.pendingPrompt);
                if (!pendingPromptShown_->hasPadAfter) { pendingPromptShown_->hasPadAfter = true; pendingPromptShown_->padAfter = padOf(pendingPromptBeat_->id); }
                // A save from before prompts carried a speaker's label works it out again.
                std::string label;
                if (pendingPromptShown_->kind == "line" && !pendingPromptShown_->hasSpeakerLabel
                    && speakerLabelOf(*host_, pendingPromptShown_->hasCharacter, pendingPromptShown_->character,
                                      pendingPromptShown_->hasQualifier, pendingPromptShown_->qualifier, label))
                { pendingPromptShown_->hasSpeakerLabel = true; pendingPromptShown_->speakerLabel = label; }
            }
            return drift;
        }

        /** Inside a checkpoint, the first change to this flow records its cursor and PRNG, so a rollback
         *  can put them back: a handful of fields and a copy of the call stack (a few frames), never its
         *  history. Its visits, selector cursors, and property values are recorded change by change as
         *  they happen. */
        void touch()
        {
            Journal* journal = host_->journal.get();
            if (!journal || journal->flows.count(this)) return;
            journal->flows.insert(this);
            struct Cursor
            {
                uint32_t rngState; bool started, flowEnded; std::string dryChoice, ranDry, currentSceneId;
                const Node* activeSnippet; int beatIndex;
                bool hasPendingChoice; std::string pendingGroupId; std::vector<PendingOption> pendingOptions;
                std::map<std::string, const Node*> pendingById; std::map<std::string, std::shared_ptr<ChoicePrompt>> pendingShown;
                const Beat* pendingPromptBeat; std::shared_ptr<ChoicePrompt> pendingPromptShown; std::string pendingPromptOwnerId;
                std::vector<StackFrame> stack;   // a copy of the frames: they advance in place (index++)
            };
            Cursor c{ rngState_, started_, flowEnded_, dryChoice_, ranDry_, currentSceneId_, activeSnippet_, beatIndex_,
                      hasPendingChoice_, pendingGroupId_, pendingOptions_, pendingById_, pendingShown_,
                      pendingPromptBeat_, pendingPromptShown_, pendingPromptOwnerId_, stack_ };
            std::shared_ptr<Flow> self = shared_from_this();
            journal->undo.push_back([self, c = std::move(c)]
            {
                Flow& f = *self;
                f.rngState_ = c.rngState; f.started_ = c.started; f.flowEnded_ = c.flowEnded;
                f.dryChoice_ = c.dryChoice; f.ranDry_ = c.ranDry;
                f.currentSceneId_ = c.currentSceneId; f.activeSnippet_ = c.activeSnippet; f.beatIndex_ = c.beatIndex;
                f.hasPendingChoice_ = c.hasPendingChoice; f.pendingGroupId_ = c.pendingGroupId;
                f.pendingOptions_ = c.pendingOptions; f.pendingById_ = c.pendingById; f.pendingShown_ = c.pendingShown;
                f.pendingPromptBeat_ = c.pendingPromptBeat; f.pendingPromptShown_ = c.pendingPromptShown; f.pendingPromptOwnerId_ = c.pendingPromptOwnerId;
                f.stack_ = c.stack;
            });
        }

    public:
        /** @internal Remove every bag this flow registered; with `keep`, their values wait in the
         *  registry for the flow that replaces this one. Engine-driven (close, loadGame, hotSwap). */
        void releaseBags(bool keep)
        {
            ScopeRegistry& reg = *host_->registry;
            for (const auto& key : registered_) if (reg.has(key)) reg.remove(key, keep);
            registered_.clear();
            sceneBags_.clear();
        }

    private:
        std::string id_;
        FlowHost* host_;
        std::vector<LogEntry> log_;
        /// Monotonic across the flow's life; survives clearLog so order is stable.
        int seq_ = 0;
        std::shared_ptr<PropertyBag> local_;   // this flow's not-shared @patter half, registrykeys::flowGlobals
        std::map<std::string, std::shared_ptr<PropertyBag>> sceneBags_;
        /// The registry keys this flow has registered (its globals and each scene bag), in order.
        std::vector<std::string> registered_;
        /// The read slot getProperty hands out for a registry scope's value.
        mutable PatterValue slot_;
        std::shared_ptr<const IScopeSource> patterScope_;
        std::shared_ptr<const IScopeSource> sceneScope_;
        /// The registry revision evalCtx_'s scopes were built at; -1 = never.
        int ctxRevision_ = -1;
        /// The registry's quality ladders, from the context last built.
        std::function<const std::vector<std::string>*(const std::string&, const std::string&)> registryQualities_;
        uint32_t rngState_ = 0;
        bool started_ = false, flowEnded_ = false;
        // The choice that last ran dry, while nothing has been delivered since: if the flow ends with it set,
        // it ended because that choice ran dry. "" = none.
        std::string dryChoice_;
        // The choice whose running dry ended this flow, once it has (the End step's RanDry); saved. "" = none.
        std::string ranDry_;
        // Closed by the engine (see close()). Terminal, and distinct from flowEnded_: an ENDED flow is
        // merely out of content and goto revives it; a CLOSED one is finished for good.
        bool closed_ = false;
        std::string currentSceneId_;
        std::vector<StackFrame> stack_;
        const Node* activeSnippet_ = nullptr;
        int beatIndex_ = 0;
        bool hasPendingChoice_ = false;
        std::string pendingGroupId_;
        // The options offered, without their prompts: those are built again, in the language in use, each time
        // the choice is delivered (offer()).
        std::vector<PendingOption> pendingOptions_;
        std::map<std::string, const Node*> pendingById_;
        // Each option's prompt as it was last delivered (null: none), for a replay to speak exactly what the player saw.
        std::map<std::string, std::shared_ptr<ChoicePrompt>> pendingShown_;
        const Beat* pendingPromptBeat_ = nullptr;                                   // replayPromptOnChoose: the chosen option's authored prompt beat
        std::shared_ptr<ChoicePrompt> pendingPromptShown_;                          // ...as the choice showed it; null only after loading a save that did not carry it
        std::string pendingPromptOwnerId_;                                          // owner of pendingPromptBeat_, found again across a save in the choose->advance window
        std::map<std::string, SelectorState> selectors_;
        std::map<std::string, int> visitCounts_;
        EvalContext evalCtx_;
        // The dialect's host hooks, held by the flow so evalCtx_.host stays valid.
        PatterHost evalHost_;

        void clearPendingChoice() { hasPendingChoice_ = false; pendingGroupId_.clear(); pendingOptions_.clear(); pendingById_.clear(); pendingShown_.clear(); }

        /** The pending choice's options as the game is handed them: each prompt built now, in the language in
         *  use and against the current values (and remembered, for a replay to speak as shown), and the game's
         *  own copy of each option's gameData. */
        std::vector<ChoiceOption> offer()
        {
            std::vector<ChoiceOption> out;
            out.reserve(pendingOptions_.size());
            for (const PendingOption& o : pendingOptions_)
            {
                const Node* node = pendingById_[o.id];
                ChoiceOption opt;
                opt.id = o.id;
                opt.prompt = promptFor(node);
                pendingShown_[o.id] = opt.prompt;
                opt.eligible = o.eligible;
                opt.gameData = copyGameData(o.gameData);
                opt.extensions = node->extensions;   // the bundle's, read-only by contract
                out.push_back(std::move(opt));
            }
            return out;
        }

        /** Drop everything waiting to be delivered: an open choice, and a chosen option's prompt still to be
         *  replayed. Every move that abandons the flow's place (start and reset, goto, close) does this, so none
         *  leaves a stale prompt behind. start() cleared only the choice, so a restart between choose() and the
         *  next advance() replayed the abandoned run's prompt, and close() left the shown prompt behind. */
        void clearPending()
        {
            clearPendingChoice();
            pendingPromptBeat_ = nullptr;
            pendingPromptShown_.reset();
            pendingPromptOwnerId_.clear();
        }

        // -- scope resolvers --
        const PatterValue* patterGet(const std::string& n) const
        {
            if (host_->patterSharedNames.count(n))
            {
                return host_->patterBag->values().get(n);
            }
            return local_->values().get(n);
        }
        void patterSet(const std::string& n, const PatterValue& v)
        {
            if (host_->patterSharedNames.count(n)) host_->registry->set("patter", n, v); else local_->set(n, v);
        }
        // The bag a @scene property of the current scene lives in (stage or this flow's), made if
        // missing. A closed flow makes nothing: it must not register bags after it has let them go.
        PropertyBag* sceneBagFor(const std::string& n) { return sceneBagShared(n).get(); }
        // The same bag as an owning handle, for a checkpoint's undo to hold.
        std::shared_ptr<PropertyBag> sceneBagShared(const std::string& n)
        {
            if (currentSceneId_.empty()) return nullptr;
            if (!closed_ && host_->bundle->scenes.count(currentSceneId_)) ensureSceneBags(currentSceneId_);
            auto sn = host_->sceneSharedNames.find(currentSceneId_);
            bool shared = sn != host_->sceneSharedNames.end() && sn->second.count(n);
            if (shared) { auto it = host_->stageBags.find(currentSceneId_); return it != host_->stageBags.end() ? it->second : nullptr; }
            auto it = sceneBags_.find(currentSceneId_); return it != sceneBags_.end() ? it->second : nullptr;
        }

        // The eval context, its scopes refreshed if the registry's set of scopes has moved since it was
        // built: every constituent resolves live state at call time, but another engine registering
        // @story after this flow opened must still be readable. Rebuilding it per evaluation was the
        // engine's hottest allocation, so it is rebuilt only when the revision moves.
        EvalContext& context()
        {
            const ScopeRegistry& reg = *host_->registry;
            if (reg.revision() != ctxRevision_)
            {
                EvalContext base = reg.toEvalContext();
                evalCtx_.scopes = std::move(base.scopes);  // every registered scope: other engines' too
                evalCtx_.scopes["patter"] = patterScope_;  // overridden with the merged shared+per-flow views
                evalCtx_.scopes["scene"] = sceneScope_;
                registryQualities_ = std::move(base.qualities);
                ctxRevision_ = reg.revision();
            }
            return evalCtx_;
        }

        /** A fresh, unregistered bag for the NOT-shared @patter globals (the shared ones live on the host). */
        std::shared_ptr<PropertyBag> newLocal() const
        {
            std::vector<ScopeDeclaration> decls;
            for (const auto& d : host_->patterLocalDecls) decls.push_back(toScopeDecl(d));
            return std::make_shared<PropertyBag>(&decls, nullptr, "@patter.");
        }

        /** Register a fresh globals bag under this flow's key; it claims any values waiting there. */
        void mountLocal()
        {
            local_ = newLocal();
            const std::string key = registrykeys::flowGlobals(id_);
            mount(key, local_);
            registered_.push_back(key);
        }

        /** Register one of this flow's bags. A clash is the kernel's RegistryError, naming the
         *  holder, rethrown as Patterplay's EvalError. */
        void mount(const std::string& key, const std::shared_ptr<PropertyBag>& bag)
        {
            kernelCall([&] { host_->registry->mountOwned(key, bag, std::string(PATTER_OWNER)); });
            host_->reportRefits();   // a bag that claimed values a refitting load parked says what it put back
        }

        /** Mount, and say whether the mount CLAIMED values a load had parked at `key`. Only asked while a
         *  checkpoint is open (`ask`), since only a rollback needs to know: it must hand claimed values back
         *  to the registry, or a scene first entered inside the checkpoint loses its saved values. A fresh
         *  bag holds only its defaults, so a change across the mount is a claim. Parked values equal to the
         *  defaults are not told apart, and need not be: dropping them changes nothing a story can read. */
        bool mountClaims(const std::string& key, const std::shared_ptr<PropertyBag>& bag, bool ask)
        {
            const std::string before = ask ? bagValues(*bag) : std::string();
            mount(key, bag);
            return ask && bagValues(*bag) != before;
        }

        static std::string bagValues(const PropertyBag& bag)
        {
            std::string out;
            for (const auto& kv : bag.save()) { out += kv.first; out += '='; out += kv.second.toJsonString(); out += ';'; }
            return out;
        }

        /** Make (and register) scene `s`'s stage bag and this flow's bag for it, if not made yet. A bag
         *  made here claims whatever values the registry holds for its key: that is how a loaded save
         *  reaches it. The bag's constructor seeds each declared default (the type's when none),
         *  normalises the name, and copies the default so two bags never share a flags vector. */
        void ensureSceneBags(const std::string& s)
        {
            auto sc = host_->bundle->scenes.find(s);
            if (sc == host_->bundle->scenes.end()) return;
            const std::set<std::string>* shared = nullptr;
            auto sn = host_->sceneSharedNames.find(s);
            if (sn != host_->sceneSharedNames.end()) shared = &sn->second;
            Journal* journal = host_->journal.get();
            if (!sceneBags_.count(s))
            {
                std::vector<ScopeDeclaration> decls = declsFor(sc->second.sceneProps, shared, false);
                auto bag = std::make_shared<PropertyBag>(&decls, nullptr, "@scene.");
                const std::string key = registrykeys::flowScene(id_, s);
                const bool claimed = mountClaims(key, bag, journal != nullptr);
                registered_.push_back(key);
                sceneBags_.emplace(s, bag);
                // Made inside a checkpoint: a rollback unmakes it, so the scene seeds afresh on its next
                // real entry, unless the mount claimed values a load had parked, which go back to the registry.
                if (journal)
                {
                    std::shared_ptr<Flow> self = shared_from_this();
                    journal->undo.push_back([self, s, key, bag, claimed]
                    {
                        auto it = self->sceneBags_.find(s);
                        if (it == self->sceneBags_.end() || it->second != bag) return; // already released with the flow
                        ScopeRegistry& reg = *self->host_->registry;
                        if (reg.has(key)) reg.remove(key, claimed);
                        self->registered_.erase(std::remove(self->registered_.begin(), self->registered_.end(), key), self->registered_.end());
                        self->sceneBags_.erase(it);
                    });
                }
            }
            if (!host_->stageBags.count(s))
            {
                std::vector<ScopeDeclaration> decls = declsFor(sc->second.sceneProps, shared, true);
                auto bag = std::make_shared<PropertyBag>(&decls, nullptr, "@scene.");
                const bool claimed = mountClaims(registrykeys::stage(s), bag, journal != nullptr);
                host_->stageBags.emplace(s, bag);
                if (journal)
                {
                    FlowHost* host = host_;
                    journal->undo.push_back([host, s, bag, claimed]
                    {
                        auto it = host->stageBags.find(s);
                        if (it == host->stageBags.end() || it->second != bag) return;
                        const std::string key = registrykeys::stage(s);
                        if (host->registry->has(key)) host->registry->remove(key, claimed);
                        host->stageBags.erase(it);
                    });
                }
            }
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
                    runEffects(activeSnippet_->onExit, activeSnippet_->id);
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
                if (host_->tracing && frame.index != from)
                {
                    LogEntry e; e.type = "select"; e.group = frame.containerId; e.selector = "run";
                    for (int i = from; i <= frame.index && i < static_cast<int>(children->size()); i++)
                        e.children.emplace_back((*children)[i]->id, i == frame.index);
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
            runEffects(it->second.onEntry, it->second.id);
        }

        void enterChild(const Node* node)
        {
            enter(node->id);
            if (node->isSnippet()) { beginSnippet(node); return; }
            std::string selector = node->selector.empty() ? "run" : node->selector;
            if (selector == "run") { stack_.push_back({ currentSceneId_, node->id, 0, "", "" }); return; }
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
            runEffects(snippet->onEnter, snippet->id);
            activeSnippet_ = snippet;
            beatIndex_ = 0;
        }

        void setupChoice(const Node* group)
        {
            std::vector<PendingOption> options;
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
                options.push_back({ child->id, elig, child->gameData });   // prompts are built as it's delivered
                byId[child->id] = child;
            }
            // A choice is offered only when the player can take something. One whose every remaining option
            // is greyed out left the player stuck in front of it, so it runs dry instead, as a choice with no
            // options does: the fallback follows if there is one, otherwise the flow moves on.
            bool takeable = false;
            for (const auto& o : options) if (o.eligible) { takeable = true; break; }
            if (takeable)
            {
                // Including options a condition left ineligible: "why is that greyed out" is a
                // question about the moment the choice was built.
                if (host_->tracing)
                {
                    LogEntry e; e.type = "choice"; e.group = group->id;
                    for (const auto& o : options) e.options.emplace_back(o.id, o.eligible);
                    emit(std::move(e));
                }
                hasPendingChoice_ = true; pendingGroupId_ = group->id; pendingOptions_ = options; pendingById_ = byId;
                pendingShown_.clear();
                return;
            }
            // No normal option can be taken. Auto-follow the fallback if it is eligible (its own condition
            // still applies).
            for (const Node* f : fallbacks) if (eligible(f)) { enterChild(f); return; }
            // Nothing takeable and no eligible fallback: the choice runs dry and the flow walks
            // past it. The behaviour is unchanged; this makes the silent fall-through observable.
            if (host_->tracing) { LogEntry e; e.type = "dry"; e.group = group->id; emit(std::move(e)); }
            // Beside the log, not instead of it: live feedback a host acts on, against an audit
            // read afterwards. A shipped game runs with the log off and this still wired.
            if (host_->onDryChoice) host_->onDryChoice(group->id);
            dryChoice_ = group->id; // if the flow ends before anything else plays, this is why
        }

        // -- jumps --
        void resolveJump(const Jump* jump)
        {
            if (!jump) return;
            enterTarget(jump->to, jump->mode == "call" ? "call" : "jump");
        }
        void enterTarget(const std::string& to, const std::string& mode)
        {
            if (host_->tracing) { LogEntry e; e.type = "jump"; e.to = to; e.mode = mode; emit(std::move(e)); }
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
            StackFrame frame{ sceneId, containerId, 0, "", "" };
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
                if (!host_->tracing) return picked;
                LogEntry e; e.type = "select"; e.group = group->id;
                e.selector = group->selector.empty() ? "default" : group->selector;
                if (group->selector == "sequence")
                {
                    e.order = group->options && !group->options->order.empty() ? group->options->order : "sequential";
                    e.exhaust = group->options && !group->options->exhaust.empty() ? group->options->exhaust : "once";
                }
                e.children = considered;
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
            auto isEligible = [&](const std::string& id) {
                for (const Node* c : elig) if (c->id == id) return true;
                return false;
            };
            if (!st.bagInit) { st.bag = fill(); st.bagInit = true; }
            // The bag was filled from the children eligible THEN. Draw only from those still eligible now, so
            // a child whose condition has since gone false is never drawn (it used to be drawn, and the group
            // then played nothing). If none of the bag is drawable, the pass is over, exactly as when the bag
            // is empty.
            bool anyDrawable = false;
            for (const std::string& id : st.bag) if (isEligible(id)) { anyDrawable = true; break; }
            if (!anyDrawable)
            {
                if (exhaust == "once") return nullptr;
                if (stick) { const Node* last = elig[len - 1]; st.hasLast = true; st.last = last->id; return last; }
                st.bag = fill();                       // repeat: reshuffle
                if (st.bag.empty()) return nullptr;
            }
            // Draw without replacement, never repeating the immediately-previous pick when another is
            // drawable. The pool keeps the bag's order, so when every member is still eligible the draw
            // consumes the PRNG exactly as it always did.
            std::vector<std::string> pool;
            pool.reserve(st.bag.size());
            for (const std::string& id : st.bag) if (isEligible(id)) pool.push_back(id);
            int p = -1;
            if (st.hasLast && pool.size() > 1)
                for (size_t k = 0; k < pool.size(); ++k) if (pool[k] == st.last) { p = static_cast<int>(k); break; }
            int span = p >= 0 ? static_cast<int>(pool.size()) - 1 : static_cast<int>(pool.size());
            int i = static_cast<int>(std::floor(rng() * span));
            if (p >= 0 && i >= p) ++i;
            std::string pick = pool[static_cast<size_t>(i)];
            for (size_t k = 0; k < st.bag.size(); ++k) if (st.bag[k] == pick) { st.bag.erase(st.bag.begin() + k); break; }
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
            if (!node->condition) return 0;
            return matchedSpec(node->condition->ast, context(), true, [this, node](const std::string& message)
            {
                reportError("best-match", node->id, node->condition.get(), message);
            });
        }
        SelectorState& selectorStateFor(const Node* group)
        {
            auto& map = group->shared ? host_->sharedSelectors : selectors_;
            // A cursor is copied the first time a checkpoint sees it (shared ones once for every flow).
            Journal* journal = host_->journal.get();
            if (journal)
            {
                std::set<std::string>& seen = group->shared ? journal->selectors : journal->flowSelectors[this];
                if (seen.insert(group->id).second)
                {
                    auto was = map.find(group->id);
                    const bool had = was != map.end();
                    SelectorState copy = had ? was->second : SelectorState{};   // a value copy: the bag vector too
                    // The map by its owner, never by address alone: the flow's own lives as long as the flow.
                    std::shared_ptr<Flow> self = group->shared ? nullptr : shared_from_this();
                    FlowHost* host = host_;
                    journal->undo.push_back([host, self, id = group->id, had, copy]
                    {
                        auto& m = self ? self->selectors_ : host->sharedSelectors;
                        if (had) m[id] = copy; else m.erase(id);
                    });
                }
            }
            return map[group->id];
        }

        // -- effects / expressions --
        // Run an effect list. `owner` is the snippet or scene it belongs to, for an error report.
        void runEffects(const std::vector<Effect>& effects, const std::string& owner)
        {
            for (const auto& ef : effects)
            {
                try
                {
                    PatterValue value = evalExpr(ef.value);
                    // `prev` read before the write, so a reader can say "0 -> 7" in one pass.
                    const bool tracing = host_->tracing;
                    LogEntry e;
                    if (tracing)
                    {
                        e.type = "write"; e.target = ef.target; e.value = value;
                        if (const PatterValue* pv = getProperty(ef.target)) { e.prev = *pv; e.hasPrev = true; }
                    }
                    writeProperty(ef.target, value, false);   // the STORY writes: a read-only host property refuses it
                    if (tracing) emit(std::move(e));
                }
                catch (const std::exception& ex)
                {
                    // Skipped, reported, and the rest of the list still runs (see PlayError). No `write`
                    // entry: nothing was written.
                    reportError("effect", owner, &ef.value, ex.what());
                }
            }
        }
        // Whether a node's condition holds. A condition that fails to evaluate counts as false (see PlayError).
        bool eligible(const Node* node)
        {
            if (!node->condition) return true;
            try { return truthy(evalExpr(*node->condition)); }
            catch (const std::exception& ex)
            {
                reportError("condition", node->id, node->condition.get(), ex.what());
                return false;
            }
        }
        // Report a content error the engine is playing through: to the host's onError, and to the log.
        void reportError(const std::string& kind, const std::string& node, const Expression* expr, const std::string& message)
        {
            PlayError err;
            err.flow = id_; err.kind = kind; err.node = node; err.source = expr ? expr->src : std::string(); err.message = message;
            report(err);
        }
        // Report a problem this flow carried on past: to the host's onError, and to the log.
        void report(const PlayError& err)
        {
            if (host_->onError) host_->onError(err);
            if (!host_->tracing) return;
            LogEntry e; e.type = "diagnostic"; e.kind = err.kind; e.node = err.node; e.source = err.source; e.message = err.message;
            emit(std::move(e));
        }
        // A refusal from the evaluator is the kernel's ExprError, rethrown as Patterplay's EvalError.
        PatterValue evalExpr(const Expression& expr)
        {
            return kernelCall([&] { return Evaluate(expr.ast, context(), PatterDialect()); });
        }
        void enter(const std::string& id)
        {
            auto ownBefore = visitCounts_.find(id);
            const bool ownHad = ownBefore != visitCounts_.end();
            const int ownWas = ownHad ? ownBefore->second : 0;
            visitCounts_[id] = ownWas + 1;
            auto before = host_->sharedVisits.find(id);
            const bool had = before != host_->sharedVisits.end();
            const int was = had ? before->second : 0;
            host_->sharedVisits[id] = was + 1;
            // Inside a checkpoint, one undo puts both counts back: the flow's own and the world's.
            if (host_->journal)
            {
                std::shared_ptr<Flow> self = shared_from_this();
                host_->journal->undo.push_back([self, id, ownHad, ownWas, had, was]
                {
                    if (ownHad) self->visitCounts_[id] = ownWas; else self->visitCounts_.erase(id);
                    std::map<std::string, int>& shared = self->host_->sharedVisits;
                    if (had) shared[id] = was; else shared.erase(id);
                });
            }
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
            r.extensions = beat.extensions;   // Patter extension values, raw, on every kind of beat
            if (beat.kind == "gameEvent") { r.type = StepType::GameEvent; r.id = beat.id; r.gameData = copyGameData(beat.gameData); applyTags(r); return r; }
            if (beat.kind == "text") { r.type = StepType::Text; r.id = beat.id; r.text = interp(resolveString(beat.id)); r.padAfter = padOf(beat.id); r.action = beat.action; r.gameData = copyGameData(beat.gameData); applyTags(r); return r; }
            // line
            std::string raw = resolveString(beat.id);
            r.type = StepType::Line; r.id = beat.id;
            r.padAfter = padOf(beat.id);   // a silent line still fires, so it still carries its pause
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
                // Each field as the beat sets it: a "" is kept, only an unset field is absent.
                if (beat.hasCharacter) { r.hasCharacter = true; r.character = beat.character; }
                std::string cn; if (resolveCharacterName(beat, cn)) { r.hasCharacterName = true; r.characterName = cn; }
                if (beat.hasDirection) { r.hasDirection = true; r.direction = beat.direction; }
                if (beat.hasQualifier) { r.hasQualifier = true; r.qualifier = beat.qualifier; }
                std::string qn; if (resolveQualifierName(beat, qn)) { r.hasQualifierName = true; r.qualifierName = qn; }
                std::string sl; if (resolveSpeakerLabel(beat, sl)) { r.hasSpeakerLabel = true; r.speakerLabel = sl; }
            }
            r.gameData = copyGameData(beat.gameData);   // the game's own copy
            applyTags(r);
            return r;
        }
        // A line or text beat's resolved pause (line padding): its own `padAfter`, else the nearest default
        // above it, else the project's, else the built-in one; clamped to zero on a snippet's last line.
        double padOf(const std::string& beatId) const
        {
            auto it = host_->padIndex.find(beatId);
            return it != host_->padIndex.end() ? it->second.resolved : DEFAULT_PAD_AFTER;
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
                p->kind = "line"; p->text = captionLine(text);
                if (beat->hasCharacter) { p->hasCharacter = true; p->character = beat->character; }
                std::string cn; if (resolveCharacterName(*beat, cn)) { p->hasCharacterName = true; p->characterName = cn; }
                if (beat->hasDirection) { p->hasDirection = true; p->direction = beat->direction; }
                if (beat->hasQualifier) { p->hasQualifier = true; p->qualifier = beat->qualifier; }
                std::string qn; if (resolveQualifierName(*beat, qn)) { p->hasQualifierName = true; p->qualifierName = qn; }
                std::string sl; if (resolveSpeakerLabel(*beat, sl)) { p->hasSpeakerLabel = true; p->speakerLabel = sl; }
            }
            else { p->kind = "text"; p->text = text; }
            p->hasPadAfter = true; p->padAfter = padOf(beat->id);
            return p;
        }
        // An option's AUTHORED prompt beat: an Option group's own prompt. The only prompt a replay speaks.
        static const Beat* authoredPromptOf(const Node* node)
        {
            return node->isGroup() && node->prompt ? node->prompt.get() : nullptr;
        }
        // A replayed prompt as a step: the beat's id, gameData, and tags, and the text and speaker fields
        // the choice showed.
        StepResult promptResult(const Beat& beat, const ChoicePrompt& shown)
        {
            StepResult r;
            r.id = beat.id; r.text = shown.text; r.gameData = copyGameData(beat.gameData); r.extensions = beat.extensions; r.padAfter = padOf(beat.id);
            auto it = host_->tagIndex.find(beat.id);
            if (it != host_->tagIndex.end() && !it->second.empty()) { r.hasTags = true; r.tags = it->second; }
            if (shown.kind == "text") { r.type = StepType::Text; return r; }
            r.type = StepType::Line;
            if (shown.hasCharacter) { r.hasCharacter = true; r.character = shown.character; }
            if (shown.hasCharacterName) { r.hasCharacterName = true; r.characterName = shown.characterName; }
            if (shown.hasDirection) { r.hasDirection = true; r.direction = shown.direction; }
            if (shown.hasQualifier) { r.hasQualifier = true; r.qualifier = shown.qualifier; }
            if (shown.hasQualifierName) { r.hasQualifierName = true; r.qualifierName = shown.qualifierName; }
            if (shown.hasSpeakerLabel) { r.hasSpeakerLabel = true; r.speakerLabel = shown.speakerLabel; }
            return r;
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
            auto a = host_->strings->find(id);
            if (a != host_->strings->end()) return a->second;
            auto d = host_->defaultStrings->find(id);
            if (d != host_->defaultStrings->end()) return "<Untranslated: " + id + "> " + d->second;
            return id;
        }
        // A speaker's resolved name: the first of the active cast string, the default one, and the cast's
        // displayName that exists (an empty string included). False when the beat has no character at all.
        bool resolveCharacterName(const Beat& beat, std::string& out)
        {
            if (!beat.hasCharacter) return false;
            if (host_->emitIds) return false; // IDs-only: omit the display name; the game maps the `character` token
            const std::string* name = host_->characterName(beat.character);
            if (!name) return false;
            out = *name; return true;
        }
        // A speaker qualifier's shown name, resolved as a speaker's is: the active `qualifier:<gameId>` string,
        // the default one, then the authored name. False when the beat has no qualifier, and in IDs-only mode
        // (the game maps the `qualifier` gameId itself).
        bool resolveQualifierName(const Beat& beat, std::string& out)
        {
            if (!beat.hasQualifier) return false;
            if (host_->emitIds) return false;
            const std::string* name = host_->qualifierName(beat.qualifier);
            if (!name) return false;
            out = *name; return true;
        }
        // The speaker's label in the active locale (see speakerLabelOf). False with no character, and in IDs-only mode.
        bool resolveSpeakerLabel(const Beat& beat, std::string& out)
        {
            return speakerLabelOf(*host_, beat.hasCharacter, beat.character, beat.hasQualifier, beat.qualifier, out);
        }

        void seedScene(const Scene& scene)
        {
            const std::set<std::string>* shared = nullptr;
            auto sn = host_->sceneSharedNames.find(scene.id);
            if (sn != host_->sceneSharedNames.end()) shared = &sn->second;
            auto isShared = [&](const std::string& name) { return shared && shared->count(name); };

            ensureSceneBags(scene.id);
            for (const auto& decl : scene.sceneProps)
            {
                if (!decl.temporary) continue;
                std::string name = toLower(decl.name);
                std::shared_ptr<PropertyBag> bag = isShared(name) ? host_->stageBags[scene.id] : sceneBags_[scene.id];
                if (!bag) continue;
                if (host_->journal)
                {
                    std::optional<PatterValue> prev = bag->get(name);
                    if (prev) host_->journal->undo.push_back([bag, name, was = *prev] { bag->set(name, was); });
                }
                // Through set, so the reset is audited: a temporary snapping back to its
                // default is a state change, and a log that omits it is wrong.
                bag->set(name, propDefault(decl));
            }
        }

    };

    // ----- locales ---------------------------------------------------------------

    // How a requested locale resolved (see resolveLocale): the locale in use, the string table it reads (none:
    // every string falls back to the default locale, marked untranslated), and what to report when it isn't an
    // exact match (empty when it is).
    struct LocaleChoice
    {
        std::string locale;
        bool hasTable = false; std::string table;
        std::string problem;
    };

    // The one rule for a locale, used wherever one is set (the constructor, setLocale, replaceStrings, and
    // hotSwap through the constructor). Case and `_` / `-` don't matter: an exact match, then the language
    // alone (`fr` for `fr-FR`), then the bundle's default. Anything but an exact match carries a problem to
    // report. The default reads no table of its own here, so its text keeps the `<Untranslated: id>` marker
    // and the gap shows. `fr` never looks for `fr-FR`. An IDs-only bundle takes the locale as given: the game
    // localises it. Null `requested` = none asked for: the default, unreported. The same rule, and the same
    // messages, on every runtime.
    inline LocaleChoice resolveLocale(const Bundle& bundle, const std::string* requested)
    {
        const std::string& def = bundle.locales.defaultLocale;
        if (!requested) return { def, true, def, "" };
        if (bundle.localisation.mode == "ids") return { *requested, true, *requested, "" };
        std::vector<std::string> have;
        const auto add = [&have](const std::string& l) { if (std::find(have.begin(), have.end(), l) == have.end()) have.push_back(l); };
        add(def);
        for (const auto& l : bundle.locales.included) add(l);
        for (const auto& kv : bundle.strings) add(kv.first);
        if (std::find(have.begin(), have.end(), *requested) != have.end()) return { *requested, true, *requested, "" };
        const auto norm = [](const std::string& l)
        {
            std::string out = toLower(l);
            std::replace(out.begin(), out.end(), '_', '-');
            return out;
        };
        const std::string want = norm(*requested);
        for (const auto& l : have)
            if (norm(l) == want)
                return { l, true, l, "the locale \"" + *requested + "\" is spelled \"" + l + "\" in this bundle, so it's using \"" + l + "\"" };
        const std::string language = want.substr(0, want.find('-'));
        for (const auto& l : have)
            if (norm(l) == language)
                return { l, true, l, "this bundle has no locale \"" + *requested + "\", so it's using its language, \"" + l + "\"" };
        return { def, false, "", "this bundle has no locale \"" + *requested + "\", so it's using the default, \"" + def + "\", with every string marked untranslated" };
    }

    // ----- Engine --------------------------------------------------------------

    class Engine
    {
    public:
        Engine(const Bundle& bundle, const EngineOptions& options = EngineOptions())
            : Engine(bundle, options, HotSwapTag{ !options.registry }) {}

        // Engines are not copied: flows point at their engine's host, and bags are registered once.
        Engine(const Engine&) = delete;
        Engine& operator=(const Engine&) = delete;

        // An engine that goes away hands its bags back to the registry with their values kept (the
        // same as a live reload does), and closes its flows, so a wrapper still holding one reads as
        // finished rather than reaching into a freed engine. A game's registry keeps saving those
        // values, and the next engine built on it claims them. Nothing to do after hotSwap, whose
        // replacement already holds the bags.
        ~Engine()
        {
            if (released_) return;
            try { release(true); } catch (...) { /* a destructor never throws */ }
        }

    private:
        // Internal: the constructor hotSwap uses. A hotSwap replacement of a standalone engine shares
        // its predecessor's registry but is still its own game (it self-backs host scopes and saves the
        // registry's values); that is not a choice a caller makes, so it is not public API.
        // setupReported is set only on the engine a refused hotSwap load falls back on, which stands in for a
        // replacement that has already made its set-up reports, so it makes none.
        struct HotSwapTag { bool ownsRegistry; bool setupReported = false; };

        Engine(const Bundle& bundle, const EngineOptions& options, HotSwapTag tag)
        {
            creationOptions_ = options; // reused by hotSwap (same seed source + settings)
            allStrings_ = &bundle.strings;
            // Set-up problems found while building, reported as the constructor ends, when the engine can report.
            std::vector<std::pair<std::string, std::string>> setup;
            if (!options.locale.empty()) requestedLocale_ = options.locale;
            currentLocale_ = resolveLocale(bundle, requestedLocale_ ? &*requestedLocale_ : nullptr);
            if (!currentLocale_.problem.empty()) setup.emplace_back(options.locale, currentLocale_.problem);
            const auto& allStrings = bundle.strings;
            // Localisation mode (spec §11): "ids" + no source-debug -> emit beat IDs + omit character names.
            host_.logEnabled = options.log;
            host_.tracing = options.log;
            // By POINTER, so a flow appends to the engine's stream without holding the engine.
            host_.engineLog = &engineLog_;
            host_.onDryChoice = options.onDryChoice;
            host_.onError = options.onError;
            host_.onRefit = options.onRefit;
            host_.emitIds = bundle.localisation.mode == "ids" && !bundle.localisation.sourceDebug;
            sourceDebug_ = bundle.localisation.mode == "ids" && bundle.localisation.sourceDebug;
            if (sourceDebug_) std::cerr << "[Patterplay] source-only DEBUG build: strings are the source language for debugging, not a shippable localised build.\n";
            host_.strings = tableOf(currentLocale_);
            auto ds = allStrings.find(bundle.locales.defaultLocale); if (ds != allStrings.end()) host_.defaultStrings = &ds->second;

            for (const auto& c : bundle.cast) if (!c.displayName.empty()) host_.castDisplay[c.name] = c.displayName;
            // A nameless qualifier gives no shown name of its own (a locale string still can), as the reference.
            for (const auto& q : bundle.qualifiers) if (!q.gameId.empty() && q.hasName) host_.qualifierDisplay[q.gameId] = q.name;
            // The overridden character and qualifier pairs, with their source labels, and the project's pattern.
            for (const auto& c : bundle.cast) for (const auto& kv : c.qualifierLabels) host_.speakerLabels[{c.name, kv.first}] = kv.second;
            host_.speakerPattern = bundle.hasSpeakerPattern ? bundle.speakerPattern : DEFAULT_SPEAKER_PATTERN;
            defaultSeed_ = options.hasSeed ? Mulberry32::ToUint32(options.seed) : 0x9e3779b9u;

            for (const auto& kv : bundle.scenes)
            {
                const std::string& sceneId = kv.first; const Scene& scene = kv.second;
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
                    walkNodes(block.children, [&](const Node* n)
                    {
                        host_.nodeIndex[n->id] = n;
                        if (n->isGroup())
                        {
                            if (n->prompt) host_.beatIndex[n->prompt->id] = n->prompt.get();
                            if (n->selector == "choice") for (const auto& option : n->children) host_.optionChoice[option->id] = n->id;
                        }
                        else for (const auto& beat : n->beats) host_.beatIndex[beat.id] = &beat;
                    });
                    indexTags(block.children, blockTags);
                    // Line padding: the nearest default above each beat, block over scene over project.
                    const double projectPad = bundle.hasPadAfterDefault ? bundle.padAfterDefault : DEFAULT_PAD_AFTER;
                    const double scenePad = scene.hasPadAfterDefault ? scene.padAfterDefault : projectPad;
                    indexPads(block.children, block.hasPadAfterDefault ? block.padAfterDefault : scenePad);
                }
                host_.blockGameIdToId[sceneId] = blockAddrs;
            }

            for (const auto& p : bundle.properties)
            {
                bool shared = p.hasShared ? p.shared : true;
                if (shared) { host_.patterSharedDecls.push_back(p); host_.patterSharedNames.insert(toLower(p.name)); }
                else host_.patterLocalDecls.push_back(p);
            }

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

            // The registry: the game's, or the engine's own, when it acts as its own game.
            host_.registry = options.registry ? options.registry : std::make_shared<ScopeRegistry>();
            host_.ownsRegistry = tag.ownsRegistry;
            // @patter (the SHARED globals) prefixed "@patter.", which is both the address a row reports
            // and the log path.
            host_.patterBag = makeSharedPatter(host_.patterSharedDecls);
            registerScopes(bundle, options, setup);
            // The `patter` bag (and any self-backed host scope) claimed values the game may have loaded first.
            host_.reportRefits();
            // Last, so the game's handler and the decision log hear about an engine that is ready to be asked.
            // The engine a refused hotSwap load falls back on makes none: the replacement before it already did.
            if (!tag.setupReported) for (const auto& s : setup) reportSetup(s.first, s.second);
        }

        // Report a set-up problem (a `setup` PlayError, which belongs to no flow): to the game's onError, and to
        // the decision log and the live tap, under no flow.
        void reportSetup(const std::string& node, const std::string& message)
        {
            if (host_.onError)
            {
                PlayError err;
                err.flow = ""; err.kind = "setup"; err.node = node; err.message = message;
                host_.onError(err);
            }
            if (!host_.tracing) return;
            LogEntry e; e.type = "diagnostic"; e.kind = "setup"; e.node = node; e.message = message;
            if (!host_.traceHandlers.empty())
            {
                const auto handlers = host_.traceHandlers;   // a copy: a handler may unsubscribe while being called
                for (const auto& h : handlers) h.second("", e);
            }
            if (host_.logEnabled) { e.seq = host_.engineLogSeq++; engineLog_.push_back(std::move(e)); }
        }

        // The string table a resolved locale reads: none when it fell back to the default (see resolveLocale).
        const std::map<std::string, std::string>* tableOf(const LocaleChoice& choice) const
        {
            if (!choice.hasTable) return &FlowHost::noStrings();
            auto it = allStrings_->find(choice.table);
            return it != allStrings_->end() ? &it->second : &FlowHost::noStrings();
        }

        // Use a resolved locale: re-point the active strings off the live table source (the bundle's, unless
        // replaceStrings re-pointed it at a pushed bundle's) - no whole-table copy.
        void useLocale(LocaleChoice choice)
        {
            currentLocale_ = std::move(choice);
            host_.strings = tableOf(currentLocale_);
        }

    public:

        // The locale in use (string + character-name lookups resolve in it): the one the game asked for, or the
        // one it fell back to (`fr` for `fr-FR`, the default for a locale the bundle doesn't have).
        const std::string& locale() const { return currentLocale_.locale; }

        // The bundle's locales: its default, and every locale it includes. A fresh copy each call.
        Locales locales() const { return host_.bundle->locales; }

        // True for a source-only DEBUG build: the embedded strings are the source language (for debugging),
        // not a shippable localised build. An IDs-only ship build is false.
        bool isSourceDebug() const { return sourceDebug_; }

        // The bundle's build identity (its content hash), the one a debug link handshakes with.
        const std::string& buildId() const { return host_.bundle->contentHash; }

        // Switch the active locale LIVE - subsequent string lookups (new beats, a pending choice's options,
        // character names, {@ref}) render in it; flow position / state / visits / rng are untouched. All open
        // flows share host_, so the swap reaches them at once.
        //
        // The locale resolves by one rule, the same for EngineOptions::locale: case and `_` / `-` don't
        // matter, so an exact match wins, then the language alone (`fr` for `fr-FR`), then the bundle's
        // default, whose text then keeps the `<Untranslated: id>` marker so the gap shows. Anything but an
        // exact match is reported (`setup`). `fr` never looks for `fr-FR`. An IDs-only bundle takes the
        // locale as given, unreported.
        void setLocale(const std::string& locale)
        {
            requestedLocale_ = locale;
            useLocale(resolveLocale(*host_.bundle, &locale));
            if (!currentLocale_.problem.empty()) reportSetup(locale, currentLocale_.problem);
        }

        // Live bundle refresh, tier 1 (strings only): swap every locale's string table in place from a
        // freshly compiled bundle whose STRUCTURE is unchanged (same content.structureHash). Like
        // setLocale, nothing restarts and no flow is touched: the next delivered beat reads the new text.
        // The caller keeps `bundle` alive for this engine's lifetime (same contract as the constructor).
        // Structural edits need hotSwap() instead (a structure change here simply won't show).
        void replaceStrings(const Bundle& bundle)
        {
            allStrings_ = &bundle.strings;
            // The requested locale resolves again against the new tables; a fallback is reported only when it
            // changed, so a live text edit doesn't repeat what the game has already heard.
            const std::string was = currentLocale_.problem;
            useLocale(resolveLocale(bundle, requestedLocale_ ? &*requestedLocale_ : nullptr));
            auto ds = allStrings_->find(host_.bundle->locales.defaultLocale);
            host_.defaultStrings = ds != allStrings_->end() ? &ds->second : &FlowHost::noStrings();
            const std::string& now = currentLocale_.problem;
            if (!now.empty() && now != was) reportSetup(requestedLocale_ ? *requestedLocale_ : std::string(), now);
        }

        // Live bundle refresh, tier 2 (full swap): rebuild on an edited bundle with the whole run carried
        // over (saveGame -> fresh engine -> loadGame) plus the presentation state that isn't save state (the
        // locale asked for, resolved again against the new bundle and reported again if it falls back; the
        // captions toggle). Content drift resolves per spec 9.8: stack frames re-find their next child and
        // the next beat by id, drifted options drop, and a place that has gone resumes at the nearest safe
        // point, reported (`save`).
        //
        // Returns the REPLACEMENT engine, on the same registry (caller owns it AND keeps `bundle` alive
        // for its lifetime). This one hands its bags over (each is removed from the registry with its
        // values kept, and the replacement claims them as it registers), its flows are closed, and it
        // should be discarded; re-bind flow handles via next->getFlow(id). If the restore throws
        // (defensive: spec 9.8 makes this unreachable for ordinary edits), the swap falls back to a
        // fresh engine with each saved flow restarted from the top of the scene it was in; the shared
        // properties carry over.
        std::unique_ptr<Engine> hotSwap(const Bundle& bundle)
        {
            refuseInCheckpoint("hotSwap");
            SaveGame snapshot = saveGame();
            // The replacement registers on the SAME registry, and a standalone engine's replacement is
            // still its own game (so its saveGame keeps carrying the registry's values).
            EngineOptions options = creationOptions_;
            options.registry = host_.registry;
            // Built in the locale this one was asked for, so the new bundle's locales resolve it, as the
            // constructor reports.
            if (requestedLocale_) options.locale = *requestedLocale_;
            const HotSwapTag tag{ host_.ownsRegistry };
            // On a game's registry, this engine's own values are parked again to be REFITTED as the
            // replacement claims them: the edit may have deleted a stage, an enum value or a flag one of them
            // holds, and the snapshot does not carry the game's registry. A standalone engine's snapshot
            // carries its registry, which the replacement's load refits.
            ScopeRegistry::SaveBlob own;
            if (!host_.ownsRegistry)
            {
                std::set<std::string> tokens(host_.hostScopes.begin(), host_.hostScopes.end());
                tokens.insert("patter");
                for (const auto& kv : host_.registry->save())
                    if (tokens.count(kv.first) || kv.first.rfind("patter/", 0) == 0) own.set(kv.first, kv.second);
            }
            release(true);
            if (!host_.ownsRegistry) host_.registry->load(own, /*keepParked=*/true, /*refit=*/true);
            std::unique_ptr<Engine> next(new Engine(bundle, options, tag));
            try
            {
                next->loadGame(snapshot);
            }
            catch (const std::exception&)
            {
                // A partial load may have mutated `next`: hand its bags back, fall back on a THIRD
                // engine and restart each flow at the top of the scene it was in (dropped when that
                // scene is gone too).
                next->release(true);
                // The values the failed load parked go back unrefitted; park the save's own again, refitted,
                // before the fallback claims them, so a stage the edit deleted is put back here too.
                if (host_.ownsRegistry) { if (snapshot.registry) host_.registry->load(*snapshot.registry, true, true); }
                else host_.registry->load(own, /*keepParked=*/true, /*refit=*/true);
                // The fallback stands in for the replacement, which has made the set-up reports: it makes none.
                next.reset(new Engine(bundle, options, HotSwapTag{ tag.ownsRegistry, true }));
                for (const auto& kv : snapshot.flows)
                {
                    try { next->openFlow(kv.first, kv.second.currentSceneId); }
                    catch (const std::exception&) { /* scene deleted: drop the flow */ }
                }
            }
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

        /** How many times each node has been entered across every flow, by node id: the shared count. With a
         *  flow's own getVisitCounts, every visit count the run keeps, read without a save. */
        const std::map<std::string, int>& getVisitCounts() const { return host_.sharedVisits; }

        /// Drop the retained entries. `seq` does NOT restart, so two reads either side of a
        /// clear still agree about what came first.
        void clearLog() { engineLog_.clear(); }

        /// Live tap on the run's decisions, for tooling that wants them as they happen rather than retained:
        /// each is handed over with the flow it happened in, with the log on or off. Returns its own
        /// unsubscribe, which must not outlive the engine.
        std::function<void()> onTrace(TraceHandler handler)
        {
            const int id = host_.nextTraceHandler++;
            host_.traceHandlers.emplace_back(id, std::move(handler));
            host_.tracing = true;
            FlowHost* host = &host_;
            return [host, id]
            {
                auto& v = host->traceHandlers;
                v.erase(std::remove_if(v.begin(), v.end(), [id](const auto& h) { return h.first == id; }), v.end());
                host->tracing = host->logEnabled || !v.empty();
            };
        }

        // Open (and start) a named flow; re-opening a name replaces it. Throws on an address that does not
        // resolve (an unknown scene, or a block that is not in the named scene), before anything changes:
        // nothing is opened, and a flow already open under `id` carries on exactly as it was.
        Flow* openFlow(const std::string& id, const std::string& scene = "", const std::string& block = "", const int64_t* seed = nullptr)
        {
            assertExternalScopes();
            std::string sceneId, blockId;
            resolveOpenAddress(scene, block, sceneId, blockId);
            // Re-opening a name REPLACES it: finish the old flow so a host still holding it cannot keep
            // driving the shared world. Replacing is a reset - contrast runFlow, which reuses.
            std::shared_ptr<Flow> prior;
            { auto prev = flows_.find(id); if (prev != flows_.end()) prior = prev->second; }
            std::shared_ptr<Journal> journal = host_.journal;
            if (journal && prior && !prior->isClosed())
                throw std::runtime_error("openFlow would replace the open flow '" + id + "', which can't be undone while a checkpoint is open");
            if (prior) prior->close(); // finish the flow this name used to mean
            auto flow = std::make_shared<Flow>(id, &host_, seed ? *seed : static_cast<int64_t>(defaultSeed_));
            Flow* raw = flow.get();
            if (journal)
            {
                // Opened inside the checkpoint: rolling back closes it and puts back whatever the name meant.
                journal->flows.insert(raw);
                journal->opened.insert(raw);
                journal->undo.push_back([this, id, flow, prior]
                {
                    flow->close();
                    if (prior) flows_[id] = prior; else flows_.erase(id);
                });
            }
            flows_[id] = std::move(flow);
            raw->begin(sceneId, blockId);
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
            mounts.push_back(LogMount{host_.patterBag, std::nullopt});
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
        // Take flow `id` out of the engine as plain data, to be put back later with restoreFlow: its
        // snapshot as saveGame writes it, and its own property values without its id (so it can come back
        // under another). Shared state is never in it. Doesn't close the flow; close it with closeFlow
        // AFTER capturing, since closing drops its values. Only reads, so it is allowed while a checkpoint
        // is open. Throws for an id that is not open.
        FlowState captureFlow(const std::string& id)
        {
            auto it = flows_.find(id);
            if (it == flows_.end()) throw std::runtime_error("no open flow '" + id + "' to capture");
            FlowState state;
            static_cast<FlowSnapshot&>(state) = it->second->snapshot();
            state.version = SAVE_VERSION;
            flowValuesFrom(id, host_.registry->save(), state);
            return state;
        }

        // Open flow `id` from a captureFlow state, the per-flow half of loadGame: its values go into the
        // registry as a load's do, and the flow is restored as a load restores each flow (a scene the
        // cursor isn't in claims its values when the flow enters it). `id` needn't be the id it was
        // captured from. Against an edited bundle it re-finds its place by id, as a load does. Refused
        // (throws, before anything changes) while a checkpoint is open, for a version a save reader would
        // refuse, or if a flow of that id is open. A state that won't restore throws too, leaving nothing
        // behind under the id.
        Flow* restoreFlow(const std::string& id, const FlowState& state)
        {
            refuseInCheckpoint("restoreFlow");
            if (state.version != 3 && state.version != SAVE_VERSION)
                throw std::runtime_error("unsupported flow state version: " + std::to_string(state.version));
            if (flows_.count(id))
                throw std::runtime_error("a flow '" + id + "' is already open; close it before restoring another under that id");
            assertExternalScopes();
            // Anything a load left waiting under this id belonged to a flow that has gone, as when a flow starts.
            const std::string parked = registrykeys::flow(id);
            host_.registry->discardParked(parked);
            host_.registry->load(flowSections(id, state), /*keepParked=*/true, /*refit=*/true);
            auto flow = std::make_shared<Flow>(id, &host_, static_cast<int64_t>(defaultSeed_));
            try
            {
                flow->restore(state);
            }
            catch (...)
            {
                flow->close();   // a state that won't restore leaves nothing behind
                host_.registry->discardParked(parked);
                throw;
            }
            Flow* raw = flow.get();
            flows_[id] = std::move(flow);
            host_.reportRefits();
            return raw;
        }

        // Close (remove) a flow. The flow object is FINISHED, not merely unregistered, so a host still
        // holding it cannot keep advancing it into the shared world.
        void closeFlow(const std::string& id)
        {
            refuseInCheckpoint("closeFlow");
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

        // A scene's own author gameData, by internal id or gameId address: the RAW sparse overrides, exactly
        // as a beat's step carries its own. Not merged with the project's declared field defaults (resolve
        // those with effectiveGameData(gameDataFields(bundle, "scene"), ...)), and not inherited by the
        // scene's blocks. A fresh copy each call; empty when the scene sets none or the ref is unknown.
        GameData gameDataForScene(const std::string& sceneRef)
        {
            auto it = host_.bundle->scenes.find(resolveSceneRef(sceneRef));
            return it != host_.bundle->scenes.end() && it->second.gameData ? *it->second.gameData : GameData{};
        }
        // A block's own author gameData, by scene + block ref (id or gameId). Raw overrides, like
        // gameDataForScene (merge defaults with gameDataFields(bundle, "block")); the scene's gameData
        // is not folded in. A fresh copy each call; empty when the block sets none or the ref is unknown.
        GameData gameDataForBlock(const std::string& sceneRef, const std::string& blockRef)
        {
            auto it = host_.blockById.find(resolveBlockRef(resolveSceneRef(sceneRef), blockRef));
            return it != host_.blockById.end() && it->second->gameData ? *it->second->gameData : GameData{};
        }

        // A scene's own Patter extension values (by internal id or gameId address), by extension id: raw and
        // sparse, exactly as the bundle carries them, any JSON, never read by the engine (fill in defaults with
        // effectiveGameData(extensionDecls(bundle, id, "scene"), ...)). Not inherited by its blocks. A fresh
        // copy each call; empty when the scene has none or the ref is unknown.
        NodeExtensions extensionsForScene(const std::string& sceneRef)
        {
            auto it = host_.bundle->scenes.find(resolveSceneRef(sceneRef));
            return it != host_.bundle->scenes.end() ? it->second.extensions : NodeExtensions{};
        }
        // A block's own Patter extension values, by scene + block ref (id or gameId). Raw, like
        // extensionsForScene; the scene's are not folded in. Empty when the block has none or the ref is unknown.
        NodeExtensions extensionsForBlock(const std::string& sceneRef, const std::string& blockRef)
        {
            auto it = host_.blockById.find(resolveBlockRef(resolveSceneRef(sceneRef), blockRef));
            return it != host_.blockById.end() ? it->second->extensions : NodeExtensions{};
        }
        // A snippet's own Patter extension values, by snippet id (as a beat sequence or a step names it). Raw,
        // like extensionsForScene; its scene's and block's are not folded in. Empty when the snippet has none,
        // the id is unknown, or it names a node that isn't a snippet.
        NodeExtensions extensionsForSnippet(const std::string& snippetId)
        {
            auto it = host_.nodeIndex.find(snippetId);
            return it != host_.nodeIndex.end() && it->second->isSnippet() ? it->second->extensions : NodeExtensions{};
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
        // first-appearance order. Static, like getOutline: it walks the authored structure, so a speaker
        // behind a condition, inside any group, or voicing a choice prompt counts - this is who CAN speak
        // in the scene, not who a given playthrough heard. Empty for an unknown ref or a scene with no
        // dialogue. Tokens, not display names: read those off a delivered step.
        // Kept once worked out, by scene id: Blueprint's CastForScene is a pure node, so it is asked again for
        // every pin wired to it, and the walk is the whole scene. An engine's structure never changes (a hot
        // swap builds a new engine), so the answer can't go stale.
        std::vector<std::string> castForScene(const std::string& sceneRef)
        {
            const std::string sceneId = resolveSceneRef(sceneRef);
            auto cached = sceneCast_.find(sceneId);
            if (cached != sceneCast_.end()) return cached->second;
            std::vector<std::string> cast;
            auto it = host_.bundle->scenes.find(sceneId);
            if (it == host_.bundle->scenes.end()) return cast;
            std::set<std::string> seen;
            for (const auto& block : it->second.blocks) collectCast(block.children, seen, cast);
            sceneCast_.emplace(sceneId, cast);
            return cast;
        }

        // One block's cast, by scene + block ref (id or gameId). castForScene, block-scoped.
        std::vector<std::string> castForBlock(const std::string& sceneRef, const std::string& blockRef)
        {
            const std::string blockId = resolveBlockRef(resolveSceneRef(sceneRef), blockRef);
            auto cached = blockCast_.find(blockId);
            if (cached != blockCast_.end()) return cached->second;
            std::vector<std::string> cast;
            auto it = host_.blockById.find(blockId);
            if (it == host_.blockById.end()) return cast;
            std::set<std::string> seen;
            collectCast(it->second->children, seen, cast);
            blockCast_.emplace(blockId, cast);
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
            refuseInCheckpoint("reset");
            for (auto& kv : flows_) kv.second->close(); // finish them, don't just forget them
            flows_.clear();
            std::vector<ScopeDeclaration> decls;
            for (const auto& d : host_.patterSharedDecls) decls.push_back(toScopeDecl(d));
            host_.patterBag->reseed(&decls); // in place: it stays registered under `patter`
            host_.sharedVisits.clear();
            host_.sharedSelectors.clear();
            for (const auto& kv : host_.stageBags)
            {
                const std::string key = registrykeys::stage(kv.first);
                if (host_.registry->has(key)) host_.registry->remove(key);
            }
            host_.stageBags.clear();
            // Values loaded for bags nobody has claimed yet are the old game's too: a flow opened after
            // the reset must not pick them up. Other engines' parked values are theirs, and stay.
            host_.registry->discardParked(std::string("patter/"));
        }

        // Read a shared (@patter, host scope, or another engine's) property by ref. @scene refs are
        // rejected (flow-level). The pointer is valid until the next call on this engine.
        const PatterValue* getProperty(const std::string& ref) const
        {
            auto sp = splitHostRef(host_, ref);
            if (sp.first == "scene") throw std::runtime_error("'" + ref + "': @scene properties are scene-scoped - read/write them on a Flow, not the Engine");
            if (sp.first == "patter") return host_.patterBag->values().get(host_.patterBag->normalise(sp.second));
            std::optional<PatterValue> v = host_.registry->get(sp.first, sp.second);
            if (!v) return nullptr;
            slot_ = std::move(*v);
            return &slot_;
        }
        // Write a shared property by ref. The GAME's surface: a host declaration's `writable: false` is
        // the story's promise about the story's writes, never a lock on the value's owner.
        //
        // THROWS EvalError, changing nothing, on a value that doesn't fit the property's declaration (a string
        // for a number, a value an enum or a quality doesn't list, a flag a flags property doesn't), and on a
        // name the content doesn't declare in @patter or a host scope the bundle declares. An opaque host scope
        // takes anything, and another engine's scope is that engine's to check.
        void setProperty(const std::string& ref, const PatterValue& value)
        {
            auto sp = splitHostRef(host_, ref);
            if (sp.first == "scene") throw std::runtime_error("'" + ref + "': @scene properties are scene-scoped - read/write them on a Flow, not the Engine");
            checkHostWrite(host_, sp.first, sp.second, value, std::string());
            std::optional<PatterValue> prev = host_.journal ? host_.registry->get(sp.first, sp.second) : std::nullopt;
            kernelCall([&] { host_.registry->set(sp.first, sp.second, value, /*host=*/true); });
            if (host_.journal && prev)
            {
                std::shared_ptr<ScopeRegistry> reg = host_.registry;
                host_.journal->undo.push_back([reg, scope = sp.first, name = sp.second, was = *prev]
                {
                    reg->set(scope, name, was, /*host=*/true);
                });
            }
        }

        // A quality's ladder, for game code holding one of its values: the position of `value` on the ladder of
        // the quality `ref` names (@patter or a host scope such as @world), or -1 when it isn't one of the
        // stages. Throws EvalError when `ref` isn't a quality. @scene qualities are read on a Flow.
        int stageIndex(const std::string& ref, const PatterValue& value) { return StageIndex(ladderOf(ref), value); }
        // -1, 0 or 1 as stage `a` is below, at or above stage `b` on that ladder, the order a condition compares
        // them in. Throws EvalError when either isn't a stage, or `ref` isn't a quality.
        int compareStages(const std::string& ref, const PatterValue& a, const PatterValue& b)
        {
            const auto& ladder = ladderOf(ref);
            return kernelCall([&] { return CompareStages(ladder, a, b); });
        }
        // The stage after `value` on that ladder, staying on the top rung, as advance() does. Throws EvalError
        // when `value` isn't a stage, or `ref` isn't a quality.
        std::string nextStage(const std::string& ref, const PatterValue& value)
        {
            const auto& ladder = ladderOf(ref);
            return kernelCall([&] { return NextStage(ladder, value); });
        }

        // The ladder of a quality outside any flow: a @patter global's, or another scope's (the registry's, as
        // another engine or the game declares it, then the bundle's own host-scope declarations).
        // Flow::stagesFor without @scene, which belongs to a flow's current scene.
        const std::vector<std::string>& ladderOf(const std::string& ref)
        {
            auto sp = splitHostRef(host_, ref);
            if (sp.first == "scene") throw std::runtime_error("'" + ref + "': @scene properties are scene-scoped - read/write them on a Flow, not the Engine");
            const std::string key = toLower(sp.second);
            const std::vector<std::string>* ladder = nullptr;
            if (sp.first == "patter")
                ladder = qualityLadder(host_, "patter", [&](auto add) { for (const auto& d : host_.patterSharedDecls) add(d); for (const auto& d : host_.patterLocalDecls) add(d); }, key);
            else
            {
                // Kept on the engine: the ladder the lookup hands back lives as long as the lookup does.
                stageCtx_ = host_.registry->toEvalContext();
                if (stageCtx_.qualities) ladder = stageCtx_.qualities(sp.first, sp.second);
                if (!ladder)
                    ladder = qualityLadder(host_, "host/" + sp.first, [&](auto add)
                    {
                        for (const auto& spec : host_.bundle->scopeRegistry.scopes)
                            if (spec.token == sp.first) for (const auto& d : spec.declarations) add(d);
                    }, key);
            }
            if (!ladder) throw EvalError("'" + ref + "' is not a quality");
            return *ladder;
        }

        // Open a checkpoint: from here until rollback() or commit(), the engine keeps what it needs to undo
        // every change the story makes. rollback() puts the game back exactly as it was at the checkpoint:
        // property values (every scope, including a host's `@world`, which is written back through the
        // game), visit counts, shuffle and sequence positions, `@scene` bags made since, every flow's cursor
        // and PRNG, and any flow opened since (closed and forgotten). commit() keeps everything and stops
        // recording.
        //
        // The use is asking "would this say anything?" without consequences: move a flow to an address,
        // advance it, and roll back if it had nothing to give, so its scene's onEntry effects, its visits,
        // and its shuffle draws never happened.
        //
        // One checkpoint at a time. Inside one, the calls that replace or drop flows or their bags wholesale
        // (reset, loadGame, hotSwap, closeFlow, restoreFlow, openFlow on the name of an open flow, and a
        // flow's own reset and restore) throw. Not undone: log entries already recorded, and draws from a
        // custom `rng` the game supplied.
        Checkpoint checkpoint()
        {
            if (host_.journal) throw std::runtime_error("a checkpoint is already open: roll it back or commit it first");
            host_.journal = std::make_shared<Journal>();
            return Checkpoint(host_.journal);
        }

        // Undo everything since checkpoint() (see there), and close it.
        void rollback(const Checkpoint& cp)
        {
            endCheckpoint(cp);
            // Taken out first, so the journal lets go of the flows and bags its undos hold once they've run.
            std::vector<std::function<void()>> undo = std::move(cp.journal_->undo);
            *cp.journal_ = Journal();
            for (auto it = undo.rbegin(); it != undo.rend(); ++it) (*it)();
        }

        // Keep everything since checkpoint(), and close it.
        void commit(const Checkpoint& cp)
        {
            endCheckpoint(cp);
            *cp.journal_ = Journal(); // nothing left to undo: let go of what the undos held
        }

        // True while a checkpoint is open.
        bool inCheckpoint() const { return host_.journal != nullptr; }

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
                const PatterValue* held = host_.patterBag->values().get(toLower(d.name));
                r.value = held ? *held : r.defaultValue;
                rows.push_back(std::move(r));
            }
            return rows;
        }

        // --- Static structure introspection (editor / dev tooling) -----------------
        // The authored tree: scenes -> blocks -> children (groups + snippets, groups preserved) -> a
        // snippet's beats. Static; per-beat data at the source locale. Scenes in authored order.
        std::vector<OutlineScene> getOutline() const
        {
            std::vector<OutlineScene> out;
            for (const Scene* sp : host_.bundle->scenesInOrder())
            {
                const Scene& scene = *sp;
                OutlineScene os;
                os.id = scene.id;
                os.gameId = effectiveGameId(scene.gameId, scene.name);
                os.name = scene.name;
                if (scene.gameData) os.gameData.assign(scene.gameData->begin(), scene.gameData->end());
                os.extensions = scene.extensions;
                os.tags = tagsById(scene.id);
                for (const Block& block : scene.blocks)
                {
                    OutlineBlock ob;
                    ob.id = block.id;
                    ob.gameId = effectiveGameId(block.gameId, block.name);
                    ob.name = block.name;
                    if (block.gameData) ob.gameData.assign(block.gameData->begin(), block.gameData->end());
                    ob.extensions = block.extensions;
                    ob.tags = tagsById(block.id);
                    for (const NodePtr& n : block.children) ob.children.push_back(outlineNode(*n));
                    os.blocks.push_back(std::move(ob));
                }
                out.push_back(std::move(os));
            }
            return out;
        }

        // Every beat in document order, flattened through groups, with its scene/block/snippet + data.
        std::vector<FlatBeat> getBeatSequence() const
        {
            std::vector<FlatBeat> seq;
            for (const Scene* scene : host_.bundle->scenesInOrder())
                for (const Block& block : scene->blocks) collectBeats(block.children, scene->id, block.id, seq);
            return seq;
        }


    private:
        void collectBeats(const std::vector<NodePtr>& nodes, const std::string& sceneId, const std::string& blockId,
                          std::vector<FlatBeat>& into) const
        {
            for (const NodePtr& n : nodes)
            {
                if (n->isGroup()) { collectBeats(n->children, sceneId, blockId, into); continue; }
                for (const Beat& b : n->beats)
                    into.push_back(FlatBeat{ sceneId, blockId, n->id, beatInfo(b) });
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

        BeatInfo beatInfo(const Beat& beat) const
        {
            BeatInfo info;
            info.id = beat.id;
            info.kind = beat.kind;
            if (beat.kind == "line")
            {
                if (!beat.character.empty())
                {
                    info.character = beat.character;
                    if (const std::string* name = host_.characterName(beat.character, true)) info.characterName = *name;
                }
                info.direction = beat.direction;
                if (beat.hasQualifier)
                {
                    info.qualifier = beat.qualifier;
                    if (const std::string* name = host_.qualifierName(beat.qualifier, true)) info.qualifierName = *name;
                }
                speakerLabelOf(host_, beat.hasCharacter, beat.character, beat.hasQualifier, beat.qualifier, info.speakerLabel, true);
            }
            if (beat.kind == "line" || beat.kind == "text")
            {
                auto pad = host_.padIndex.find(beat.id);
                info.padAfter = pad != host_.padIndex.end() ? pad->second.resolved : DEFAULT_PAD_AFTER;
                if (pad != host_.padIndex.end() && pad->second.hasOwn) { info.hasOwnPadAfter = true; info.ownPadAfter = pad->second.own; }
                auto t = host_.defaultStrings->find(beat.id);
                if (t != host_.defaultStrings->end()) info.text = t->second;   // source, un-interpolated
            }
            if (beat.gameData) for (const auto& kv : *beat.gameData) info.gameData.emplace_back(kv.first, kv.second);
            info.extensions = beat.extensions;
            info.tags = tagsById(beat.id);
            return info;
        }

        std::vector<std::string> tagsById(const std::string& id) const
        {
            auto it = host_.tagIndex.find(id);
            return it != host_.tagIndex.end() ? it->second : std::vector<std::string>{};
        }

    public:
        // Snapshot the whole game's NON-property state: visit counts, shared selector cursors, and every
        // live flow's cursor and PRNG. The property values are the registry's: a standalone engine (one
        // that made its own registry) carries them here under `registry`; a game that passed a registry
        // saves it once itself, beside each engine's saveGame().
        SaveGame saveGame()
        {
            SaveGame s;
            s.version = SAVE_VERSION;
            if (host_.ownsRegistry) s.registry = host_.registry->save();
            s.sharedVisits = host_.sharedVisits;
            s.sharedSelectors = host_.sharedSelectors;
            for (auto& kv : flows_) s.flows[kv.first] = kv.second->snapshot();
            return s;
        }

        // Restore a saveGame(): visit counts, shared selector cursors, and every flow. Property values
        // come from the registry. A save that carries them (a standalone engine's) has them moved into the
        // registry here; otherwise the game loads its registry itself, before or after this call. Either
        // order works: this engine's bags are handed back to the registry (values kept) and the restored
        // flows claim them as they register. Reads versions 3 and 4. A flow whose saved place has gone from
        // this build resumes at the nearest safe point, reported (`save`).
        void loadGame(const SaveGame& save)
        {
            refuseInCheckpoint("loadGame");
            if (save.version != 3 && save.version != SAVE_VERSION)
                throw std::runtime_error("unsupported save version: " + std::to_string(save.version));
            assertExternalScopes();
            ScopeRegistry& reg = *host_.registry;
            // Flows the save does not have are over: their bags go. The rest are handed back with their
            // values, which is what a game that loaded its registry first has just laid the save's values
            // over.
            for (auto& kv : flows_) { kv.second->releaseBags(save.flows.count(kv.first) > 0); kv.second->close(); }
            flows_.clear();
            for (const auto& kv : host_.stageBags)
            {
                const std::string key = registrykeys::stage(kv.first);
                if (reg.has(key)) reg.remove(key, true);
            }
            host_.stageBags.clear();

            const std::optional<ScopeRegistry::SaveBlob>& values = save.registry;
            if (values)
            {
                // The engine's own registry takes the save wholesale. A game's registry may hold values
                // the game loaded for other engines, still waiting to be claimed: add to those, never
                // replace them.
                reg.load(*values, /*keepParked=*/!host_.ownsRegistry, /*refit=*/true);
            }
            host_.sharedVisits = save.sharedVisits;
            host_.sharedSelectors = save.sharedSelectors;
            for (const auto& kv : save.flows)
            {
                auto flow = std::make_shared<Flow>(kv.first, &host_, static_cast<int64_t>(defaultSeed_));
                flow->restore(kv.second);
                flows_[kv.first] = std::move(flow);
            }
            host_.reportRefits();
        }

    private:
        void endCheckpoint(const Checkpoint& cp)
        {
            if (!host_.journal || host_.journal != cp.journal_) throw std::runtime_error("that checkpoint is not the open one");
            host_.journal.reset();
        }

        void refuseInCheckpoint(const std::string& what) const
        {
            if (host_.journal) throw std::runtime_error(what + " can't be undone, so it isn't allowed while a checkpoint is open");
        }

        // Content that names another engine's scope (`@story.act`) runs only where that engine is on this
        // registry: without it every read would answer false and every write fail, so the flow is refused
        // as it opens (or the save as it loads), before anything changes. By then a game has built all of
        // its engines, whatever order it built them in. The same message on every runtime.
        void assertExternalScopes() const
        {
            for (const std::string& token : host_.bundle->externalScopes)
            {
                if (!host_.registry->has(token))
                    throw std::runtime_error("this content names @" + token
                        + ", which no engine on this registry registered: give every engine the game's one registry");
            }
        }

        // One flow's own values (a FlowState's) as registry sections under flow `id`'s keys.
        static ScopeRegistry::SaveBlob flowSections(const std::string& id, const FlowState& f)
        {
            ScopeRegistry::SaveBlob out;
            out.set(registrykeys::flowGlobals(id), orderedOf(f.scopes));
            for (const auto& kv : f.sceneBags) out.set(registrykeys::flowScene(id, kv.first), orderedOf(kv.second));
            return out;
        }

        // The inverse of flowSections: flow `id`'s sections in a registry save, without the id, into
        // `out`'s scopes and sceneBags. Values still waiting in the registry for a scene the flow hasn't
        // re-entered are in the save, so they come too.
        static void flowValuesFrom(const std::string& id, const ScopeRegistry::SaveBlob& saved, FlowState& out)
        {
            const std::string prefix = registrykeys::flow(id);
            const std::string scenePrefix = "scene/";
            for (const auto& section : saved)
            {
                if (section.first.compare(0, prefix.size(), prefix) != 0) continue;
                const std::string rest = section.first.substr(prefix.size());
                std::map<std::string, PatterValue> values;
                for (const auto& kv : section.second) values[kv.first] = kv.second;
                if (rest == "patter") out.scopes = std::move(values);
                else if (rest.compare(0, scenePrefix.size(), scenePrefix) == 0)
                    out.sceneBags[registrykeys::unesc(rest.substr(scenePrefix.size()))] = std::move(values);
            }
        }

        // Register this engine's game-wide scopes: @patter, every bound host scope (external), and, for a
        // standalone engine only, a self-backed bag for each declared host scope nobody bound. On any
        // throw, remove (keeping values) whatever this constructor registered, so a clash leaves the
        // game's registry as it was, then rethrow.
        void registerScopes(const Bundle& bundle, const EngineOptions& options, std::vector<std::pair<std::string, std::string>>& setup)
        {
            ScopeRegistry& reg = *host_.registry;
            const std::string owner = PATTER_OWNER;
            std::vector<std::string> registered;
            try
            {
                reg.mountOwned("patter", host_.patterBag, owner); // claims values the game loaded first
                registered.push_back("patter");
                // The game's bindings are EXTERNAL scopes: the game keeps the values, the registry never
                // saves them. Declarations (types, read-only) come from the compiled bundle.
                std::set<std::string> bound;
                for (const auto& kv : options.hostScopes)
                {
                    const HostScopeSpec* spec = nullptr;
                    for (const auto& sp : bundle.scopeRegistry.scopes) if (sp.token == kv.first) { spec = &sp; break; }
                    // Tokens are case-sensitive everywhere, so a near miss is reported, never folded: folding
                    // would make a second spelling of the scope. Another engine's scope the content names is that
                    // engine's to declare.
                    const auto& external = bundle.externalScopes;
                    if (!spec && std::find(external.begin(), external.end(), kv.first) == external.end())
                    {
                        const HostScopeSpec* near = nullptr;
                        for (const auto& sp : bundle.scopeRegistry.scopes) if (toLower(sp.token) == toLower(kv.first)) { near = &sp; break; }
                        setup.emplace_back(kv.first, near
                            ? "hostScopes binds \"" + kv.first + "\", which this bundle doesn't declare: it declares \"" + near->token + "\", and a scope's token is case-sensitive"
                            : "hostScopes binds \"" + kv.first + "\", which this bundle doesn't declare");
                    }
                    std::vector<ScopeDeclaration> decls;
                    if (spec) for (const auto& d : spec->declarations) decls.push_back(toForeignDecl(d));
                    ForeignScopeOptions fo;
                    fo.writable = spec && spec->hasWritable ? spec->writable : true;
                    fo.owner = owner;
                    reg.defineForeign(kv.first, std::make_shared<HostScopeResolver>(kv.second), &decls, fo);
                    registered.push_back(kv.first);
                    host_.boundScopes.push_back(kv.first);
                    bound.insert(kv.first);
                }
                // A declared host scope nobody bound. A standalone engine is its own game, so it
                // self-backs the scope: a property bag seeded from the declarations, stored and SAVED by
                // the registry like any other, since only a resolver the game binds is external. Given
                // the GAME's registry, the engine registers nothing here: those tokens are the game's to
                // register, or another engine's (a bundle compiled against the Storylet Engine's spec
                // declares @story), and self-backing one would clash with its real owner depending only
                // on which engine was built first.
                if (host_.ownsRegistry)
                {
                    for (const HostScopeSpec& spec : bundle.scopeRegistry.scopes)
                    {
                        if (spec.token.empty() || bound.count(spec.token) || reg.has(spec.token)) continue;
                        std::vector<ScopeDeclaration> decls;
                        for (const auto& d : spec.declarations) decls.push_back(selfBackedDecl(d, spec));
                        OwnedScopeOptions oo;
                        oo.owner = owner;
                        reg.defineOwned(spec.token, decls, oo);
                        registered.push_back(spec.token);
                        host_.hostScopes.push_back(spec.token);
                    }
                }
            }
            catch (...)
            {
                // A clash leaves the game's registry as it was: the half-built engine takes nothing with it.
                // The clash itself is the kernel's RegistryError, rethrown as Patterplay's EvalError.
                for (const auto& k : registered) if (reg.has(k)) reg.remove(k, true);
                rethrowKernelError();
            }
        }

        // Remove every bag this engine registered, keeping the values parked when `keep` (a live reload
        // handing its state to a replacement), and close its flows. The engine is inert afterwards.
        void release(bool keep)
        {
            released_ = true;
            for (auto& kv : flows_) { kv.second->releaseBags(keep); kv.second->close(); }
            flows_.clear();
            ScopeRegistry& reg = *host_.registry;
            for (const auto& kv : host_.stageBags)
            {
                const std::string key = registrykeys::stage(kv.first);
                if (reg.has(key)) reg.remove(key, keep);
            }
            host_.stageBags.clear();
            if (reg.has("patter")) reg.remove("patter", keep);
            for (const auto& t : host_.hostScopes) if (reg.has(t)) reg.remove(t, keep);
            for (const auto& t : host_.boundScopes) if (reg.has(t)) reg.remove(t);
        }

    private:
        FlowHost host_;
        /// Set once release() has handed this engine's bags back: the engine is inert.
        bool released_ = false;
        /// The read slot getProperty hands out for a registry scope's value.
        mutable PatterValue slot_;
        EvalContext stageCtx_;      // the registry's quality lookup, held while a ladder it handed back is read
        std::vector<LogEntry> engineLog_;
        std::unordered_map<std::string, std::vector<std::string>> sceneCast_, blockCast_;   // see castForScene
        uint32_t defaultSeed_ = 0x9e3779b9u;
        // SHARED, not unique: a wrapper (UPatterFlow, and any host object of that shape) outlives the
        // core object by design, and three paths destroy a flow underneath one - loadGame rebuilds the
        // map, closeFlow erases an entry, reset clears the lot. Holding a shared_ptr means a wrapper
        // that misses a re-bind keeps its flow ALIVE and reads as closed, rather than reading freed
        // memory. The other three runtimes are reference counted; this brings C++ into line.
        // The public accessors still hand out `Flow*` (`.get()`), so existing C++ is unaffected;
        // `flowPtr` is the handle for anything that needs to OUTLIVE the map entry.
        std::map<std::string, std::shared_ptr<Flow>> flows_;
        // The locale in use, as the resolver found it, and the one the game asked for (the option, or the last
        // setLocale), which hotSwap and replaceStrings resolve again against the bundle they take.
        LocaleChoice currentLocale_;
        std::optional<std::string> requestedLocale_;
        // The live string-table source: the constructor's bundle, unless replaceStrings re-pointed it at a
        // pushed bundle's tables (whose lifetime the caller guarantees, same as the constructor's bundle).
        const std::map<std::string, std::map<std::string, std::string>>* allStrings_ = nullptr;
        EngineOptions creationOptions_; // reused by hotSwap, on the same registry
        bool sourceDebug_ = false; // source-only DEBUG build: strings are the source language, not shippable

        // openFlow's address as internal ids, or a throw when it does not resolve. By the one address rule
        // Flow::gotoAddress follows too (resolveScene / resolveBlock): a scene by its gameId first, then its
        // internal id; with a scene, the block within that scene only, so a block from another scene does not
        // resolve. With no scene, the block is an internal id from any scene. Neither: the first scene. The
        // same rule on every runtime.
        void resolveOpenAddress(const std::string& scene, const std::string& block, std::string& sceneId, std::string& blockId)
        {
            sceneId.clear(); blockId.clear();
            if (!scene.empty())
            {
                sceneId = resolveScene(host_, scene);
                if (sceneId.empty()) throw std::runtime_error("unknown scene: " + scene);
                if (block.empty()) return;
                blockId = resolveBlock(host_, sceneId, block);
                if (blockId.empty()) throw std::runtime_error("unknown block: " + block);
                return;
            }
            if (!block.empty())
            {
                if (!host_.blockToScene.count(block)) throw std::runtime_error("unknown block: " + block);
                blockId = block;
                return;
            }
            if (host_.bundle->scenes.empty()) throw std::runtime_error("no scenes in bundle");
        }
        // A scene reference to its internal id by the one address rule (resolveScene); an unknown one passes
        // through, for the caller to find nothing.
        std::string resolveSceneRef(const std::string& r)
        {
            if (r.empty()) return "";
            const std::string id = resolveScene(host_, r);
            return id.empty() ? r : id;
        }
        // A block reference to its internal id by the one address rule (resolveBlock): with a scene, only a
        // block IN that scene resolves, so a block of another scene is empty here and the caller finds nothing.
        // With no scene, only an internal id resolves, since a block's gameId is only unique within its scene.
        std::string resolveBlockRef(const std::string& sceneId, const std::string& r)
        {
            if (r.empty()) return "";
            if (sceneId.empty()) return r;
            return resolveBlock(host_, sceneId, r);
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
        // Walk groups/snippets carrying the parent's accumulated tags; record each node's and each beat's,
        // an option's prompt beat included.
        void indexTags(const std::vector<NodePtr>& nodes, const std::vector<std::string>& inherited)
        {
            for (const auto& n : nodes)
            {
                std::vector<std::string> acc = dedupeTags(n->tags, inherited);
                host_.tagIndex[n->id] = acc;
                // An option's prompt beat is a beat like any other: its own tags plus the option's. Left out,
                // a replayed prompt and the outline's prompt lost every tag (all four runtimes, until 2026-10).
                if (n->isGroup() && n->prompt) host_.tagIndex[n->prompt->id] = dedupeTags(n->prompt->tags, acc);
                if (n->isGroup()) indexTags(n->children, acc);
                else for (const auto& beat : n->beats) host_.tagIndex[beat.id] = dedupeTags(beat.tags, acc);
            }
        }
        // Line padding (design/proposals/line-padding.md): record each line and text beat's pause, its own
        // `padAfter` else the nearest `padAfterDefault` above it (snippet, then each group innermost first; the
        // caller passes the block's, scene's, or project's). A snippet's last line or text beat is clamped to
        // zero or more: what follows the seam isn't certain, so nothing can cut in on it. A negative pause before
        // a game event stands (the event starts as the line ends), and a game event doesn't count as a snippet's
        // last line. An option's prompt is the head of its option's run: it resolves through the option and is
        // never clamped.
        void setPad(const Beat& beat, double inherited, bool clamp)
        {
            BeatPad pad;
            if (beat.hasPadAfter) { pad.hasOwn = true; pad.own = beat.padAfter; }
            pad.resolved = beat.hasPadAfter ? beat.padAfter : inherited;
            if (clamp && pad.resolved < 0) pad.resolved = 0;
            host_.padIndex[beat.id] = pad;
        }
        void indexPads(const std::vector<NodePtr>& nodes, double inherited)
        {
            auto spoken = [](const Beat& b) { return b.kind == "line" || b.kind == "text"; };
            for (const auto& n : nodes)
            {
                const double def = n->hasPadAfterDefault ? n->padAfterDefault : inherited;
                if (n->isGroup())
                {
                    if (n->prompt) setPad(*n->prompt, def, false);
                    indexPads(n->children, def);
                    continue;
                }
                // Only the snippet's last line or text beat (game events don't count) is clamped.
                std::size_t last = n->beats.size();
                for (std::size_t i = 0; i < n->beats.size(); ++i) if (spoken(n->beats[i])) last = i;
                for (std::size_t i = 0; i < n->beats.size(); ++i)
                    if (spoken(n->beats[i])) setPad(n->beats[i], def, i == last);
            }
        }
    };
}
