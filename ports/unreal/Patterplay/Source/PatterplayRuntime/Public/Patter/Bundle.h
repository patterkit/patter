// The compiled-bundle model (a parsed .patterc). Plain structs, filled by the one reader in
// BundleJson.h from any JSON library (the standalone TestHost uses a tiny parser, the UE plugin
// uses FJsonValue) - the engine stays parser-agnostic. Mirrors @patterkit/model's shapes.
#pragma once

#include <algorithm>
#include <string>
#include <vector>
#include <map>
#include <memory>
#include <utility>
#include "PatterValue.h"
#include "Ast.h"

namespace patter
{
    using GameData = std::map<std::string, PatterValue>;

    // The built-in pause after a line or text beat, in seconds, for a project that sets no default of its own
    // (line padding, design/proposals/line-padding.md): the same on every runtime and in Patterpad's Play window.
    inline constexpr double DEFAULT_PAD_AFTER = 0.6;

    struct Locales { std::string defaultLocale = "en"; std::vector<std::string> included; };
    struct Cast { std::string name, displayName; };
    // A speaker qualifier as the bundle ships it (`V.O.`): the `gameId` a line stores, and its authored
    // name (the unlocalised fallback for its shown name).
    struct Qualifier { std::string gameId, name; };

    struct PropertyDecl
    {
        std::string name, type;
        bool hasShared = false; bool shared = false;   // optional<bool>
        bool temporary = false;
        bool hasDefault = false; PatterValue def;       // optional<PatterValue>
        std::vector<std::string> values;
        std::vector<std::string> stages;                // quality: the ORDERED stage ladder
    };

    // ----- host scopes (@world): design/scope-registry.md section 6 ------------
    //
    // The GAME owns these values; the story reads (and may write) them. A runtime that ignores the
    // registry reads `@world.x` as a graceful false and plays a silently DIFFERENT story from the
    // same bundle, which is what the conformance case "a declared host scope with no resolver is
    // self-backed from its defaults" exists to catch.

    struct HostScopeDecl
    {
        std::string name, type;
        std::vector<std::string> values;               // enum / flags
        std::vector<std::string> stages;               // quality: the ordered stage ladder
        bool hasDefault = false; PatterValue def;      // optional<PatterValue>
        bool hasWritable = false; bool writable = true;
    };

    struct HostScopeSpec
    {
        std::string token;                             // the token after '@', e.g. "world"
        bool hasWritable = false; bool writable = true;
        // `present` distinguishes an OPAQUE scope (no `declarations` key: any name, nothing seeded)
        // from one that declares an empty list.
        bool hasDeclarations = false;
        std::vector<HostScopeDecl> declarations;
    };

    struct HostScopeRegistry
    {
        bool present = false;
        int version = 1;
        std::vector<HostScopeSpec> scopes;
    };

    // `src` is the expression's source text when the bundle carries it (empty when it does not): what a
    // content error the engine plays through reports as its `source`.
    struct Expression { AstPtr ast; std::string src; };
    struct Effect { std::string target; Expression value; };

    struct Beat
    {
        std::string id, kind, character, direction;
        bool hasCharacter = false, hasDirection = false; // set, even to "" (absent = unset): a "" is a value
        bool hasQualifier = false; std::string qualifier; // speaker qualifier gameId (`vo`), line only
        bool hasPadAfter = false; double padAfter = 0;    // the pause after it, in seconds (line / text only)
        std::shared_ptr<GameData> gameData;             // null = none
        std::vector<std::string> tags;                  // author tags (#215)
    };

    struct Jump { std::string to, mode; };
    struct SelectorOptions { std::string order, exhaust; };

    struct Node
    {
        std::string id, type;                           // "group" | "snippet"
        std::shared_ptr<Expression> condition;
        std::vector<Effect> onEnter, onExit;
        std::shared_ptr<GameData> gameData;
        std::vector<std::string> tags;                  // author tags (#215)
        bool hasPadAfterDefault = false; double padAfterDefault = 0;   // line padding: the default for the beats inside

        // group
        std::string selector;
        std::vector<std::shared_ptr<Node>> children;
        std::shared_ptr<Beat> prompt;
        bool sticky = false, fallback = false, secretUntilEligible = false, shared = false;
        std::shared_ptr<SelectorOptions> options;

        // snippet
        std::vector<Beat> beats;
        std::shared_ptr<Jump> jump;

        bool isSnippet() const { return type == "snippet"; }
        bool isGroup() const { return type == "group"; }
    };
    using NodePtr = std::shared_ptr<Node>;

    struct Block
    {
        std::string id, name, gameId;
        std::vector<NodePtr> children;
        std::vector<std::string> tags;
        std::shared_ptr<GameData> gameData;             // author overrides (raw); null = none
        bool hasPadAfterDefault = false; double padAfterDefault = 0;   // line padding: the default for the beats inside
    };
    struct Scene
    {
        std::string id, name, gameId;
        std::vector<Block> blocks;
        std::vector<PropertyDecl> sceneProps;
        std::vector<Effect> onEntry;
        std::vector<std::string> tags;                  // author tags (#215)
        std::shared_ptr<GameData> gameData;             // author overrides (raw); null = none
        bool hasPadAfterDefault = false; double padAfterDefault = 0;   // line padding: the default for the beats inside
    };

    struct GameDataField
    {
        std::string name, type;
        bool hasDefault = false; PatterValue def;
        std::vector<std::string> values;
        std::string purpose;   // what the field is for, in the author's words; empty when they gave none
    };

    // How strings ship + resolve (spec §11): "embedded" (resolve per locale) or "ids" (emit beat IDs);
    // sourceDebug embeds the source language for debug playback only.
    struct Localisation { std::string mode = "embedded"; bool sourceDebug = false; };

    // Closed-caption config (#214): cue delimiters + a `character` whose whole lines are captions (omitted
    // when off). `present` distinguishes a baked config from the default [ / ] + SFX.
    struct CaptionDelimiters { std::string open = "["; std::string close = "]"; std::string character; bool present = false; };

    struct Bundle
    {
        std::string schema;           // the bundle schema tag ("patter/bundle@0"); empty if absent
        bool voiced = false;
        std::string contentHash;      // content.hash - the build identity (live-link stale-build check)
        std::string structureHash;    // content.structureHash - the same fingerprint minus the strings:
                                      // equal + a different contentHash = a text-only edit (refresh tier 1)
        std::string contentProject;   // content.project - optional project name
        std::string contentVersion;   // content.version - the authored bundle version, if stamped
        Locales locales;
        std::vector<Cast> cast;
        std::vector<Qualifier> qualifiers;   // the speaker qualifiers the content uses; empty = none
        // The project's own line-padding default, when it sets one; absent = DEFAULT_PAD_AFTER.
        bool hasPadAfterDefault = false; double padAfterDefault = 0;
        std::vector<PropertyDecl> properties;
        std::map<std::string, Scene> scenes;
        // Scene ids in AUTHORED order (the bundle's key order, which is the project's nav order). `scenes`
        // is a sorted map, so anything order-dependent walks this instead: the default start scene, the
        // outline, the beat sequence. Walking the map started a flow on the alphabetically first scene id.
        std::vector<std::string> sceneOrder;

        // The scenes in authored order: `sceneOrder` first, then any scene it does not name (a bundle
        // built in code rather than by a loader) in id order.
        std::vector<const Scene*> scenesInOrder() const
        {
            std::vector<const Scene*> out;
            out.reserve(scenes.size());
            for (const std::string& id : sceneOrder)
            {
                auto it = scenes.find(id);
                if (it != scenes.end()) out.push_back(&it->second);
            }
            if (out.size() != scenes.size())
                for (const auto& kv : scenes)
                    if (std::find(sceneOrder.begin(), sceneOrder.end(), kv.first) == sceneOrder.end()) out.push_back(&kv.second);
            return out;
        }
        std::map<std::string, std::map<std::string, std::string>> strings;   // locale -> id -> text (empty in "ids")
        Localisation localisation;
        std::map<std::string, std::vector<GameDataField>> gameDataFields;
        // The node types in gameDataFields in bundle order, which the map does not keep: a description
        // lists them in this order, as every runtime does.
        std::vector<std::string> gameDataKinds;
        CaptionDelimiters closedCaptions;   // #214; `present=false` => use the default [ / ]
        HostScopeRegistry scopeRegistry;    // declared host scopes; `present=false` => the project declares none
        // Other engines' game-wide scopes the content names (`story`), sorted: the family's shared
        // vocabulary, opaque to the compiler and never self-backed. A ref to one is a scope even before
        // its engine registers it, and the engine reports when the game has not. Empty = none.
        std::vector<std::string> externalScopes;
    };

    // ----- gameData merge-at-read (port of gamedata.ts) ------------------------

    // The author-defined gameData fields declared for a node TYPE (empty when none).
    inline std::vector<GameDataField> gameDataFields(const Bundle& bundle, const std::string& kind)
    {
        auto it = bundle.gameDataFields.find(kind);
        return it != bundle.gameDataFields.end() ? it->second : std::vector<GameDataField>{};
    }

    [[deprecated("Use gameDataFields, the name every Patterplay runtime uses.")]]
    inline std::vector<GameDataField> gameDataFieldsFor(const Bundle& bundle, const std::string& kind) { return gameDataFields(bundle, kind); }

    // One node's effective value for a field: its sparse OVERRIDE if present, else the field's declared
    // default (null if neither is set). `fields` is the schema for the node's type; `node` may be null.
    inline const PatterValue* gameDataValue(const std::vector<GameDataField>& fields, const GameData* node, const std::string& name)
    {
        if (node)
        {
            auto it = node->find(name);
            if (it != node->end()) return &it->second;
        }
        for (const auto& fld : fields) if (fld.name == name) return fld.hasDefault ? &fld.def : nullptr;
        return nullptr;
    }

    // A node's FULL effective gameData: declared fields filled (override or default), override-only
    // orphans kept. `node` may be null (pure defaults). Returns ordered pairs (declared, then orphan).
    inline std::vector<std::pair<std::string, PatterValue>>
    effectiveGameData(const std::vector<GameDataField>& fields, const GameData* node)
    {
        std::vector<std::pair<std::string, PatterValue>> out;
        auto has = [&](const std::string& k) { for (auto& p : out) if (p.first == k) return true; return false; };
        for (const auto& fld : fields)
        {
            if (node)
            {
                auto it = node->find(fld.name);
                if (it != node->end()) { out.emplace_back(fld.name, it->second); continue; }
            }
            if (fld.hasDefault) out.emplace_back(fld.name, fld.def);
        }
        if (node) for (const auto& kv : *node) if (!has(kv.first)) out.emplace_back(kv.first, kv.second);
        return out;
    }
}
