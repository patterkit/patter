// The compiled-bundle model (a parsed .patterc). Plain structs, filled by the one reader in
// BundleJson.h from any JSON library (the standalone TestHost uses a tiny parser, the UE plugin
// uses FJsonValue) - the engine stays parser-agnostic. Mirrors @patterkit/model's shapes.
#pragma once

#include <algorithm>
#include <string>
#include <vector>
#include <map>
#include <memory>
#include <optional>
#include <utility>
#include "PatterValue.h"
#include "Ast.h"
#include "JsonTree.h"
#include "Expr/OrderedMap.h"   // NodeExtensions keep the bundle's key order

namespace patter
{
    using GameData = std::map<std::string, PatterValue>;

    /** One extension's values on a node: field name -> value, raw as the bundle wrote them, in bundle order.
     *  Any JSON, so held as the neutral tree. */
    using ExtensionValues = OrderedMap<std::string, JsonTree>;
    /** A node's Patter extension values: extension id -> field -> value, raw, in bundle order. The engine
     *  never reads them; it hands them over wherever it hands over gameData. Empty when the node has none. */
    using NodeExtensions = OrderedMap<std::string, ExtensionValues>;

    // The built-in pause after a line or text beat, in seconds, for a project that sets no default of its own
    // (line padding, design/proposals/line-padding.md): the same on every runtime and in Patterpad's Play window.
    inline constexpr double DEFAULT_PAD_AFTER = 0.6;

    // The speaker pattern a project starts with, how a character's label reads with a qualifier: `You (V.O.)`.
    // `{name}` and `{qualifier}` are plain placeholders, never run through line interpolation.
    inline constexpr const char* DEFAULT_SPEAKER_PATTERN = "{name} ({qualifier})";

    struct Locales { std::string defaultLocale = "en"; std::vector<std::string> included; };
    // A cast member as the bundle ships it. qualifierLabels is the character's own label with a qualifier, by the
    // qualifier's gameId, in the source language (`{ vo: "Your thoughts" }`): only the pairs a project overrides;
    // every other pair's label is the speaker pattern filled in.
    struct Cast { std::string name, displayName; std::map<std::string, std::string> qualifierLabels; };
    // A speaker qualifier as the bundle ships it (`V.O.`): the `gameId` a line stores, and its authored
    // name (the unlocalised fallback for its shown name). hasName is false when the bundle gives no name (or
    // one that isn't a string): then no shown name comes from it, only from a locale string.
    struct Qualifier { std::string gameId, name; bool hasName = false; };

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
        bool action = false;                            // a snippet's text beat that is action (bundle only)
        std::shared_ptr<GameData> gameData;             // null = none
        NodeExtensions extensions;                      // Patter extension values, raw; empty = none
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
        NodeExtensions extensions;                      // Patter extension values, raw; empty = none
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
        NodeExtensions extensions;                      // Patter extension values, raw; empty = none
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
        NodeExtensions extensions;                      // Patter extension values, raw; empty = none
        bool hasPadAfterDefault = false; double padAfterDefault = 0;   // line padding: the default for the beats inside
    };

    struct GameDataField
    {
        std::string name, type;   // type: text, multiline, number, boolean, enum, flags or quality
        bool hasDefault = false; PatterValue def;
        std::vector<std::string> values;
        /** A quality field's ladder, in order: hand it to the stage helpers (StageIndex, CompareStages,
         *  NextStage) to compare or step the field's stage. */
        std::vector<std::string> stages;
        std::string purpose;   // what the field is for, in the author's words; empty when they gave none
    };

    /** A map field's key: its type, and what a reference key points at. */
    struct ExtensionKeyDecl { std::string type, to; };

    /** A compiled Patter extension field declaration (@patterkit/model's ExtensionFieldDecl): the editor's words
     *  gone, every default resolved by the compiler. Structured types carry their parts: `fields` for a record,
     *  `key` and `of` for a map, `of` and `id` for a list, `to` for a reference. Read by nothing in the engine;
     *  effectiveGameData fills a node's gaps from it, given extensionDecls. */
    struct ExtensionFieldDecl
    {
        std::string name, type;
        /** Always present on a top-level declaration, and may be any JSON. Absent only on a map's or a list's
         *  element (`of`). */
        std::optional<JsonTree> defaultValue;
        std::optional<std::vector<std::string>> values;
        std::optional<std::vector<std::string>> stages;
        std::string to;                                  // a reference's target kind; empty when not one
        std::vector<ExtensionFieldDecl> fields;          // a record's fields
        std::optional<ExtensionKeyDecl> key;             // a map's key
        std::shared_ptr<ExtensionFieldDecl> of;          // a map's or a list's element
        std::string id;                                  // a list of records: the field that identifies an item
        std::optional<double> min, max;
        std::optional<bool> required;
    };

    /** One Patter extension as the bundle carries it. */
    struct BundleExtension
    {
        std::string version;
        /** Compiled declarations by node kind (project, scene, block, snippet, line, text, gameEvent, option). */
        OrderedMap<std::string, std::vector<ExtensionFieldDecl>> fields;
        /** The project node's values, raw, when it has any. */
        std::optional<ExtensionValues> project;
        /** Every setting the manifest declares, by setting name: the project's value, or else the setting's
         *  default. Each names a host field. Empty when the manifest declares none. */
        OrderedMap<std::string, std::string> settings;
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
        // The project's speaker pattern, the unlocalised fallback for the `speaker:pattern` string; absent when
        // the project keeps DEFAULT_SPEAKER_PATTERN or uses no qualifiers.
        bool hasSpeakerPattern = false; std::string speakerPattern;
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
        // The Patter extensions the project takes, by id, in bundle order: each one's declarations by node kind
        // and the project node's values (patterkit design/proposals/patter-storylet-extensions.md, "At
        // runtime"). Every other node carries its own values. Empty when the project takes none.
        OrderedMap<std::string, BundleExtension> extensions;
    };

    // ----- gameIds -------------------------------------------------------------

    inline std::string toLower(const std::string& s)
    {
        std::string r = s;
        for (char& c : r) if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
        return r;
    }

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

    // ----- Patter extension values (port of gamedata.ts) -----------------------
    //
    // The same rule as gameData (patterkit design/proposals/patter-storylet-extensions.md, "At runtime"): raw
    // on the node, the declarations with every default resolved in the bundle's `extensions` section, and the
    // same two helpers, overloaded for extension declarations, fill a node's values in, given extensionDecls.
    // extensionsOf reads any node's values off the bundle, by the address a game already uses.

    /** One extension field's effective value: the node's own when it sets one, else the declared default;
     *  null for a name declared nowhere and set nowhere. `node` may be null. */
    inline const JsonTree* gameDataValue(const std::vector<ExtensionFieldDecl>& decls, const ExtensionValues* node, const std::string& name)
    {
        if (node) if (const JsonTree* v = node->get(name)) return v;
        for (const auto& d : decls) if (d.name == name) return d.defaultValue ? &*d.defaultValue : nullptr;
        return nullptr;
    }

    /** One extension's values on a node, filled in: every declared field resolved (the value set, else the
     *  default; a structured default arrives whole), in declaration order, then any value set with no
     *  declaration, kept as it is. `node` may be null (pure defaults). */
    inline ExtensionValues effectiveGameData(const std::vector<ExtensionFieldDecl>& decls, const ExtensionValues* node)
    {
        ExtensionValues out;
        for (const auto& d : decls)
            if (const JsonTree* v = gameDataValue(decls, node, d.name)) out.set(d.name, *v);
        if (node) for (const auto& kv : *node) if (!out.contains(kv.first)) out.set(kv.first, kv.second);
        return out;
    }

    /** One extension's declarations for a node kind (project, scene, block, snippet, line, text, gameEvent,
     *  option), every default resolved. Empty when the bundle has no such extension or it declares nothing
     *  for the kind. */
    inline std::vector<ExtensionFieldDecl> extensionDecls(const Bundle& bundle, const std::string& extension, const std::string& kind)
    {
        const BundleExtension* ext = bundle.extensions.get(extension);
        if (!ext) return {};
        const std::vector<ExtensionFieldDecl>* decls = ext->fields.get(kind);
        return decls ? *decls : std::vector<ExtensionFieldDecl>{};
    }

    /** One extension's settings, by setting name: every setting its manifest declares, the project's value or
     *  else the setting's default. Each names a host field, so a game reads here which gameData field holds
     *  what the extension claims. Empty when the bundle has no such extension or it declares no settings. A
     *  fresh map each call. */
    inline OrderedMap<std::string, std::string> extensionSettings(const Bundle& bundle, const std::string& extension)
    {
        const BundleExtension* ext = bundle.extensions.get(extension);
        return ext ? ext->settings : OrderedMap<std::string, std::string>{};
    }

    namespace extensionsdetail
    {
        // A node directly inside a choice that is a group is an option; its prompt beat is a line or text.
        // Mirrors the reference's walk exactly, including where a beat of another kind ends one level's search.
        inline void find(const std::vector<NodePtr>& children, bool inChoice, const std::string& kind, const std::string& address,
                         const NodeExtensions*& found)
        {
            for (const NodePtr& node : children)
            {
                if (found) return;
                if (node->isGroup())
                {
                    if (inChoice && node->id == address && kind == "option") { found = &node->extensions; return; }
                    if (inChoice && node->prompt && node->prompt->id == address && node->prompt->kind == kind) { found = &node->prompt->extensions; return; }
                    find(node->children, node->selector == "choice", kind, address, found);
                    continue;
                }
                if (node->id == address && kind == "snippet") { found = &node->extensions; return; }
                for (const Beat& beat : node->beats)
                {
                    if (beat.id != address) continue;
                    if (beat.kind == kind) found = &beat.extensions;
                    return;
                }
            }
        }
    }

    /**
     * A node's Patter extension values, by extension id, raw; empty when it has none or the address names
     * nothing. By the names a game already holds: `project` (no address); `scene` by id or gameId; `block` as
     * "scene/block", each by id or gameId; `snippet`, `line`, `text`, `gameEvent` and `option` (a group
     * directly inside a choice) by node id. A node of another kind than the one asked for reads as none, as
     * does an unknown kind. A fresh copy each call.
     */
    inline NodeExtensions extensionsOf(const Bundle& bundle, const std::string& kind, const std::string& address = "")
    {
        const std::vector<const Scene*> scenes = bundle.scenesInOrder();
        const auto sceneOf = [&](const std::string& ref) -> const Scene*
        {
            auto it = bundle.scenes.find(ref);
            if (it != bundle.scenes.end()) return &it->second;
            for (const Scene* s : scenes) if (effectiveGameId(s->gameId, s->name) == ref) return s;
            return nullptr;
        };
        if (kind == "project")
        {
            NodeExtensions out;
            for (const auto& kv : bundle.extensions) if (kv.second.project) out.set(kv.first, *kv.second.project);
            return out;
        }
        if (kind == "scene")
        {
            const Scene* scene = sceneOf(address);
            return scene ? scene->extensions : NodeExtensions{};
        }
        if (kind == "block")
        {
            const size_t slash = address.find('/');
            if (slash == std::string::npos) return {};
            const Scene* scene = sceneOf(address.substr(0, slash));
            if (!scene) return {};
            const std::string ref = address.substr(slash + 1);
            for (const Block& b : scene->blocks) if (b.id == ref) return b.extensions;
            for (const Block& b : scene->blocks) if (effectiveGameId(b.gameId, b.name) == ref) return b.extensions;
            return {};
        }
        if (kind == "snippet" || kind == "option" || kind == "line" || kind == "text" || kind == "gameEvent")
        {
            const NodeExtensions* found = nullptr;
            for (const Scene* scene : scenes)
                for (const Block& block : scene->blocks)
                    if (!found) extensionsdetail::find(block.children, false, kind, address, found);
            return found ? *found : NodeExtensions{};
        }
        return {};
    }
}
