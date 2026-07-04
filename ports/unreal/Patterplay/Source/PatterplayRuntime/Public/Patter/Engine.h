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
#include <iostream>
#include "PatterValue.h"
#include "Bundle.h"
#include "Expression.h"
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

    inline std::pair<std::string, std::string> splitRef(const std::string& ref)
    {
        std::string body = (!ref.empty() && ref[0] == '@') ? ref.substr(1) : ref;
        size_t dot = body.find('.');
        if (dot != std::string::npos && body.find('.', dot + 1) == std::string::npos)
        {
            std::string head = body.substr(0, dot), tail = body.substr(dot + 1);
            if (head == "scene" || head == "patter") return { head, toLower(tail) };
        }
        return { "patter", toLower(body) };
    }

    inline PatterValue propDefault(const PropertyDecl& d)
    {
        if (d.hasDefault) return d.def;
        if (d.type == "boolean") return PatterValue::Bool(false);
        if (d.type == "number") return PatterValue::Num(0);
        if (d.type == "string") return PatterValue::Str("");
        if (d.type == "flags") return PatterValue::Flags({});
        if (d.type == "enum") return PatterValue::Str(d.values.empty() ? "" : d.values[0]);
        return PatterValue::Bool(false);
    }

    // One shared @patter property for a live state inspector: ref, type, current value, declared
    // default (for reset-to-default), and enum options. Mirrors the JS PropertyRow and the Unity /
    // Godot ListProperties() row so all four runtimes expose the same inspection contract.
    struct PropertyRow
    {
        std::string ref;
        std::string type;
        PatterValue value;
        PatterValue def;
        std::vector<std::string> values;
    };

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

    inline bool truthy(const PatterValue& v)
    {
        switch (v.kind)
        {
            case PatterKind::Bool: return v.b;
            case PatterKind::Number: return v.n != 0;
            case PatterKind::Str: return v.s != "";
            case PatterKind::Flags: return !v.f.empty();
            default: return false;
        }
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

    struct FlowHost
    {
        const Bundle* bundle = nullptr;
        bool emitIds = false; // IDs-only build: emit beat IDs + omit character names (the game localises)
        std::map<std::string, std::string> strings;
        std::map<std::string, std::string> defaultStrings;
        std::map<std::string, std::string> castDisplay;
        std::map<std::string, const Node*> nodeIndex;
        std::map<std::string, std::string> blockToScene;
        std::map<std::string, const Block*> blockById;
        std::map<std::string, std::vector<std::string>> tagIndex;   // author tags (#215): node id -> accumulated
        std::map<std::string, PatterValue> sharedPatter;
        std::vector<PropertyDecl> patterSharedDecls;
        std::vector<PropertyDecl> patterLocalDecls;
        std::set<std::string> patterSharedNames;
        std::map<std::string, std::set<std::string>> sceneSharedNames;
        std::map<std::string, int> sharedVisits;
        std::map<std::string, SelectorState> sharedSelectors;
        std::map<std::string, std::map<std::string, PatterValue>> stageBags;
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
        bool hasSeed = false; int64_t seed = 0;       // per-flow built-in PRNG (scripted corpus cases)
        std::string locale;
        bool replayPromptOnChoose = false;
        bool closedCaptions = true;                   // #214: show caption cues in dialogue lines (default)
    };

    // ----- Flow ----------------------------------------------------------------

    class Flow
    {
    public:
        Flow(std::string id, FlowHost* host, int64_t seed) : id_(std::move(id)), host_(host)
        {
            rngState_ = static_cast<uint32_t>(seed);
            local_ = freshLocal();
            evalCtx_.scopes["patter"] = [this](const std::string& n) { return patterGet(n); };
            evalCtx_.scopes["scene"] = [this](const std::string& n) { return sceneGet(n); };
            evalCtx_.nextRandom = [this]() { return rng(); };
            evalCtx_.visits = [this](const std::string& id) { auto it = visitCounts_.find(id); return it != visitCounts_.end() ? it->second : 0; };
            evalCtx_.patterVisits = [this](const std::string& id) { auto it = host_->sharedVisits.find(id); return it != host_->sharedVisits.end() ? it->second : 0; };
        }
        Flow(const Flow&) = delete;
        Flow& operator=(const Flow&) = delete;

        const std::string& currentScene() const { return currentSceneId_; }
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

        void choose(const std::string& id)
        {
            if (!hasPendingChoice_) throw std::runtime_error("no choice is pending");
            const ChoiceOption* option = nullptr;
            for (auto& o : pendingOptions_) if (o.id == id) { option = &o; break; }
            if (!option) throw std::runtime_error("unknown choice option: " + id);
            if (!option->eligible) throw std::runtime_error("choice option is not eligible: " + id);
            const Node* node = pendingById_[id];
            const Node* picked = node;
            clearPending();
            pendingPromptBeat_ = host_->replayPromptOnChoose ? promptBeatOf(picked) : nullptr;
            pendingPromptOwnerId_ = pendingPromptBeat_ ? picked->id : "";
            enterChild(picked);
        }

        const PatterValue* getProperty(const std::string& ref) const
        {
            auto sp = splitRef(ref);
            if (sp.first == "patter") return patterGet(sp.second);
            if (sp.first == "scene") return sceneGet(sp.second);
            return nullptr;
        }

        void setProperty(const std::string& ref, const PatterValue& value)
        {
            auto sp = splitRef(ref);
            if (sp.first == "patter") patterSet(sp.second, value);
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
        FlowSnapshot snapshot() const
        {
            FlowSnapshot s;
            s.scopes = local_;
            s.sceneBags = sceneBags_;
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
            sceneBags_ = snap.sceneBags;
            local_ = freshLocal();
            for (auto& kv : snap.scopes) local_[kv.first] = kv.second;

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
        std::map<std::string, PatterValue> local_;
        std::map<std::string, std::map<std::string, PatterValue>> sceneBags_;
        uint32_t rngState_ = 0;
        bool started_ = false, flowEnded_ = false;
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

        void clearPending() { hasPendingChoice_ = false; pendingGroupId_.clear(); pendingOptions_.clear(); pendingById_.clear(); }

        // -- scope resolvers --
        const PatterValue* patterGet(const std::string& n) const
        {
            if (host_->patterSharedNames.count(n))
            {
                auto it = host_->sharedPatter.find(n);
                return it != host_->sharedPatter.end() ? &it->second : nullptr;
            }
            auto it = local_.find(n);
            return it != local_.end() ? &it->second : nullptr;
        }
        void patterSet(const std::string& n, const PatterValue& v)
        {
            if (host_->patterSharedNames.count(n)) host_->sharedPatter[n] = v; else local_[n] = v;
        }
        std::map<std::string, PatterValue>* sceneBagFor(const std::string& n)
        {
            if (currentSceneId_.empty()) return nullptr;
            auto sn = host_->sceneSharedNames.find(currentSceneId_);
            bool shared = sn != host_->sceneSharedNames.end() && sn->second.count(n);
            if (shared) { auto it = host_->stageBags.find(currentSceneId_); return it != host_->stageBags.end() ? &it->second : nullptr; }
            auto it = sceneBags_.find(currentSceneId_); return it != sceneBags_.end() ? &it->second : nullptr;
        }
        const PatterValue* sceneGet(const std::string& n) const
        {
            return const_cast<Flow*>(this)->sceneGetMut(n);
        }
        const PatterValue* sceneGetMut(const std::string& n)
        {
            auto* bag = sceneBagFor(n);
            if (!bag) return nullptr;
            auto it = bag->find(n);
            return it != bag->end() ? &it->second : nullptr;
        }
        void sceneSet(const std::string& n, const PatterValue& v)
        {
            auto* bag = sceneBagFor(n);
            if (bag) (*bag)[n] = v;
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
                while (frame.index < static_cast<int>(children->size()) && !eligible((*children)[frame.index].get())) frame.index++;
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
                hasPendingChoice_ = true; pendingGroupId_ = group->id; pendingOptions_ = options; pendingById_ = byId;
                return;
            }
            for (const Node* f : fallbacks) if (eligible(f)) { enterChild(f); return; }
        }

        // -- jumps --
        void resolveJump(const Jump* jump)
        {
            if (!jump) return;
            enterTarget(jump->to, jump->mode == "call" ? "call" : "jump");
        }
        void enterTarget(const std::string& to, const std::string& mode)
        {
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
            for (const auto& c : group->children) if (eligible(c.get())) elig.push_back(c.get());
            if (elig.empty()) return nullptr;
            SelectorState& st = selectorStateFor(group);
            if (group->selector == "branch") return elig.front();
            if (group->selector == "sequence")
            {
                std::string order = group->options && !group->options->order.empty() ? group->options->order : "sequential";
                std::string exhaust = group->options && !group->options->exhaust.empty() ? group->options->exhaust : "once";
                return order == "shuffle" ? pickShuffle(elig, exhaust, st) : pickSequential(elig, exhaust, st);
            }
            return nullptr;
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
        SelectorState& selectorStateFor(const Node* group)
        {
            auto& map = group->shared ? host_->sharedSelectors : selectors_;
            return map[group->id];
        }

        // -- effects / expressions --
        void runEffects(const std::vector<Effect>& effects)
        {
            for (const auto& e : effects) setProperty(e.target, evalExpr(e.value));
        }
        bool eligible(const Node* node)
        {
            if (!node->condition) return true;
            return truthy(evalExpr(*node->condition));
        }
        PatterValue evalExpr(const Expression& expr) { return evaluate(*expr.ast, evalCtx_); }
        void enter(const std::string& id)
        {
            visitCounts_[id] = visitCounts_.count(id) ? visitCounts_[id] + 1 : 1;
            host_->sharedVisits[id] = host_->sharedVisits.count(id) ? host_->sharedVisits[id] + 1 : 1;
        }
        double rng()
        {
            if (host_->customRng) return host_->customRng();
            rngState_ = rngState_ + 0x6d2b79f5u;
            uint32_t t = (rngState_ ^ (rngState_ >> 15)) * (1u | rngState_);
            t = (t + ((t ^ (t >> 7)) * (61u | t))) ^ t;
            return (t ^ (t >> 14)) / 4294967296.0;
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

            if (!sceneBags_.count(scene.id))
            {
                std::map<std::string, PatterValue> bag;
                for (const auto& decl : scene.sceneProps) { std::string name = toLower(decl.name); if (!isShared(name)) bag[name] = propDefault(decl); }
                sceneBags_[scene.id] = bag;
            }
            if (!host_->stageBags.count(scene.id))
            {
                std::map<std::string, PatterValue> bag;
                for (const auto& decl : scene.sceneProps) { std::string name = toLower(decl.name); if (isShared(name)) bag[name] = propDefault(decl); }
                host_->stageBags[scene.id] = bag;
            }
            for (const auto& decl : scene.sceneProps)
            {
                if (!decl.temporary) continue;
                std::string name = toLower(decl.name);
                auto* bag = isShared(name) ? &host_->stageBags[scene.id] : &sceneBags_[scene.id];
                (*bag)[name] = propDefault(decl);
            }
        }

        std::map<std::string, PatterValue> freshLocal()
        {
            std::map<std::string, PatterValue> d;
            for (const auto& decl : host_->patterLocalDecls) d[toLower(decl.name)] = propDefault(decl);
            return d;
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
            host_.emitIds = bundle.localisation.mode == "ids" && !bundle.localisation.sourceDebug;
            sourceDebug_ = bundle.localisation.mode == "ids" && bundle.localisation.sourceDebug;
            if (sourceDebug_) std::cerr << "[Patterplay] source-only DEBUG build: strings are the source language for debugging, not a shippable localised build.\n";
            auto ls = allStrings.find(locale); if (ls != allStrings.end()) host_.strings = ls->second;
            auto ds = allStrings.find(bundle.locales.defaultLocale); if (ds != allStrings.end()) host_.defaultStrings = ds->second;

            for (const auto& c : bundle.cast) if (!c.displayName.empty()) host_.castDisplay[c.name] = c.displayName;
            defaultSeed_ = options.hasSeed ? static_cast<uint32_t>(options.seed) : 0x9e3779b9u;

            for (const auto& kv : bundle.scenes)
            {
                const std::string& sceneId = kv.first; const Scene& scene = kv.second;
                sceneGameIdToId_[effectiveGameId(scene.gameId, scene.name)] = sceneId;
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
            }

            for (const auto& p : bundle.properties)
            {
                bool shared = p.hasShared ? p.shared : true;
                if (shared) { host_.patterSharedDecls.push_back(p); host_.patterSharedNames.insert(toLower(p.name)); }
                else host_.patterLocalDecls.push_back(p);
            }
            for (const auto& d : host_.patterSharedDecls) host_.sharedPatter[toLower(d.name)] = propDefault(d);

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

        Flow* openFlow(const std::string& id, const std::string& scene = "", const std::string& block = "", const int64_t* seed = nullptr)
        {
            std::string sceneId = resolveSceneRef(scene);
            std::string blockId = resolveBlockRef(sceneId, block);
            auto flow = std::unique_ptr<Flow>(new Flow(id, &host_, seed ? *seed : static_cast<int64_t>(defaultSeed_)));
            Flow* raw = flow.get();
            flows_[id] = std::move(flow);
            raw->start(sceneId, blockId);
            return raw;
        }
        Flow* getFlow(const std::string& id) { auto it = flows_.find(id); return it != flows_.end() ? it->second.get() : nullptr; }
        void closeFlow(const std::string& id) { flows_.erase(id); }

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
        // A block's accumulated tags (scene + block), by scene + block ref (id or gameId).
        std::vector<std::string> tagsForBlock(const std::string& sceneRef, const std::string& blockRef)
        {
            auto it = host_.tagIndex.find(resolveBlockRef(resolveSceneRef(sceneRef), blockRef));
            return it != host_.tagIndex.end() ? it->second : std::vector<std::string>{};
        }

        void reset()
        {
            flows_.clear();
            host_.sharedPatter.clear();
            for (const auto& d : host_.patterSharedDecls) host_.sharedPatter[toLower(d.name)] = propDefault(d);
            host_.sharedVisits.clear();
            host_.sharedSelectors.clear();
            host_.stageBags.clear();
        }

        const PatterValue* getProperty(const std::string& ref) const
        {
            auto sp = splitRef(ref);
            if (sp.first == "scene") throw std::runtime_error("'" + ref + "': @scene properties are scene-scoped - read/write them on a Flow, not the Engine");
            auto it = host_.sharedPatter.find(sp.second);
            return it != host_.sharedPatter.end() ? &it->second : nullptr;
        }
        void setProperty(const std::string& ref, const PatterValue& value)
        {
            auto sp = splitRef(ref);
            if (sp.first == "scene") throw std::runtime_error("'" + ref + "': @scene properties are scene-scoped - read/write them on a Flow, not the Engine");
            host_.sharedPatter[sp.second] = value;
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
                r.ref = "@" + d.name;
                r.type = d.type;
                r.values = d.values;
                r.def = propDefault(d);
                auto it = host_.sharedPatter.find(toLower(d.name));
                r.value = it != host_.sharedPatter.end() ? it->second : r.def;
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
            s.shared = host_.sharedPatter;
            s.sharedVisits = host_.sharedVisits;
            s.sharedSelectors = host_.sharedSelectors;
            s.stageBags = host_.stageBags;
            for (auto& kv : flows_) s.flows[kv.first] = kv.second->snapshot();
            return s;
        }
        void loadGame(const SaveGame& save)
        {
            if (save.version != 2) throw std::runtime_error("unsupported save version");
            host_.sharedPatter = save.shared;
            host_.sharedVisits = save.sharedVisits;
            host_.sharedSelectors = save.sharedSelectors;
            host_.stageBags = save.stageBags;
            flows_.clear();
            for (const auto& kv : save.flows)
            {
                auto flow = std::unique_ptr<Flow>(new Flow(kv.first, &host_, static_cast<int64_t>(defaultSeed_)));
                flow->restore(kv.second);
                flows_[kv.first] = std::move(flow);
            }
        }

    private:
        FlowHost host_;
        uint32_t defaultSeed_ = 0x9e3779b9u;
        std::map<std::string, std::unique_ptr<Flow>> flows_;
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
