// The compiled-bundle model (a parsed .patterc). Plain structs; any JSON library can
// populate them (the standalone TestHost uses a tiny parser, the UE plugin uses
// FJsonObject) - the engine stays parser-agnostic. Mirrors @patterkit/model's shapes.
#pragma once

#include <string>
#include <vector>
#include <map>
#include <memory>
#include "PatterValue.h"
#include "Ast.h"

namespace patter
{
    using GameData = std::map<std::string, PatterValue>;

    struct Locales { std::string defaultLocale = "en"; std::vector<std::string> included; };
    struct Cast { std::string name, displayName; };

    struct PropertyDecl
    {
        std::string name, type;
        bool hasShared = false; bool shared = false;   // optional<bool>
        bool temporary = false;
        bool hasDefault = false; PatterValue def;       // optional<PatterValue>
        std::vector<std::string> values;
    };

    struct Expression { AstPtr ast; };
    struct Effect { std::string target; Expression value; };

    struct Beat
    {
        std::string id, kind, character, direction;
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

    struct Block { std::string id, name, gameId; std::vector<NodePtr> children; std::vector<std::string> tags; };
    struct Scene
    {
        std::string id, name, gameId;
        std::vector<Block> blocks;
        std::vector<PropertyDecl> sceneProps;
        std::vector<Effect> onEntry;
        std::vector<std::string> tags;                  // author tags (#215)
    };

    struct GameDataField
    {
        std::string name, type;
        bool hasDefault = false; PatterValue def;
        std::vector<std::string> values;
    };

    // How strings ship + resolve (spec §11): "embedded" (resolve per locale) or "ids" (emit beat IDs);
    // sourceDebug embeds the source language for debug playback only.
    struct Localisation { std::string mode = "embedded"; bool sourceDebug = false; };

    // Closed-caption config (#214): cue delimiters + a `character` whose whole lines are captions (omitted
    // when off). `present` distinguishes a baked config from the default [ / ] + SFX.
    struct CaptionDelimiters { std::string open = "["; std::string close = "]"; std::string character; bool present = false; };

    struct Bundle
    {
        bool voiced = false;
        std::string contentHash;      // content.hash - the build identity (live-link stale-build check)
        std::string structureHash;    // content.structureHash - the same fingerprint minus the strings:
                                      // equal + a different contentHash = a text-only edit (refresh tier 1)
        std::string contentProject;   // content.project - optional project name
        Locales locales;
        std::vector<Cast> cast;
        std::vector<PropertyDecl> properties;
        std::map<std::string, Scene> scenes;
        std::map<std::string, std::map<std::string, std::string>> strings;   // locale -> id -> text (empty in "ids")
        Localisation localisation;
        std::map<std::string, std::vector<GameDataField>> gameDataFields;
        CaptionDelimiters closedCaptions;   // #214; `present=false` => use the default ( / )
    };

    // ----- gameData merge-at-read (port of gamedata.ts) ------------------------

    inline std::vector<GameDataField> gameDataFieldsFor(const Bundle& bundle, const std::string& kind)
    {
        auto it = bundle.gameDataFields.find(kind);
        return it != bundle.gameDataFields.end() ? it->second : std::vector<GameDataField>{};
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
