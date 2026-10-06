// One bundle, and what reading it must give, shared by the two hosts of the bundle reader: the plugin's
// automation test Patterplay.BundleReader (through PatterLoadBundle and FJsonValue) and the corpus
// TestHost (through its own JsonValue). Both call patter::parseBundle, so the reading itself is one
// function; what differs is each host's BundleJson / AstJson accessors, and this is what checks them
// against each other: the same JSON must give the same facts through either. Std-only, so the TestHost
// includes it by path.
//
// It leans on what an accessor could get wrong: object fields in document order (the scene ids sort the
// other way from the authored order), a null read as absent, a value's type told apart (a boolean, a
// number, a string, a flag list), and a required field reported by name.
#pragma once

#include <string>
#include <vector>
#include "Patter/Bundle.h"

namespace patter { namespace bundlereadercase
{
    inline const char* Json()
    {
        return R"JSON({
  "schema": "patter/bundle@0",
  "content": { "project": "proj_reader", "version": "2.1.0", "hash": "h1", "structureHash": "s1" },
  "voiced": true,
  "localisation": { "mode": "ids", "sourceDebug": true },
  "closedCaptions": { "open": "<", "close": ">", "character": "FX" },
  "locales": { "default": "en", "included": ["en", "fr"] },
  "cast": [{ "name": "ANNA", "displayName": "Anna" }, { "name": "FX" }],
  "properties": [
    { "name": "gold", "type": "number", "shared": true, "default": 5 },
    { "name": "mood", "type": "enum", "values": ["calm", "cross"], "default": "calm", "temporary": true },
    { "name": "seen", "type": "flags", "default": ["a", "b"] },
    { "name": "loose", "type": "boolean", "default": null }
  ],
  "scopeRegistry": { "version": 1, "scopes": [
    { "token": "world", "writable": false, "declarations": [
      { "name": "clock", "type": "string", "default": "day", "writable": false },
      { "name": "rank", "type": "quality", "stages": ["low", "high"], "default": null } ] },
    { "token": "opaque" }
  ] },
  "externalScopes": ["story"],
  "gameDataFields": { "line": [{ "name": "camera", "type": "string", "default": "wide", "values": ["wide", "close"] }] },
  "strings": { "en": { "L1": "Hello.", "T1": "Go" }, "fr": { "L1": "Bonjour." } },
  "scenes": {
    "scn_zz": { "id": "scn_zz", "name": "Tavern", "gameId": "tavern", "tags": ["night"],
      "gameData": { "music": "jig", "volume": 0.5, "loud": true, "moods": ["warm"] },
      "sceneProps": [{ "name": "visits", "type": "number", "default": 0 }],
      "onEntry": [{ "kind": "set", "target": "@scene.visits", "value": { "src": "@scene.visits + 1", "ast": ["bin", "+", ["sv", "scene", "visits"], ["n", 1]] } }],
      "blocks": [{ "id": "b_t", "name": "Bar", "gameId": "bar", "children": [
        { "id": "g_c", "type": "group", "selector": "choice", "shared": true,
          "options": { "order": "authored", "exhaust": "once" },
          "prompt": { "id": "P1", "kind": "line", "character": "ANNA" },
          "children": [
            { "id": "o_s", "type": "snippet", "sticky": true, "beats": [{ "id": "T1", "kind": "text" }], "jump": { "to": "scn_aa", "mode": "call" } },
            { "id": "o_h", "type": "snippet", "secretUntilEligible": true,
              "condition": { "src": "@gold > 3", "ast": ["bin", ">", ["sv", "patter", "gold"], ["n", 3]] },
              "beats": [{ "id": "L1", "kind": "line", "character": "", "direction": "quietly", "tags": ["hush"], "gameData": { "camera": "close" } }] },
            { "id": "o_f", "type": "snippet", "fallback": true, "onExit": [{ "kind": "set", "target": "@gold", "value": { "src": "0", "ast": ["n", 0] } }] }
          ] }
      ] }] },
    "scn_aa": { "id": "scn_aa", "name": "Gate", "blocks": [] },
    "scn_mm": { "id": "scn_mm", "blocks": [{ "id": "b_m", "children": [] }] }
  }
})JSON";
    }

    /** A bundle missing a required field, and the error either host must report for it. */
    inline const char* MissingFieldJson()
    {
        return R"JSON({ "locales": { "default": "en" }, "scenes": { "s": { "id": "s", "blocks": [{ "name": "no id" }] } } })JSON";
    }
    inline const char* MissingFieldError() { return "bundle: missing/invalid field 'id'"; }

    /** Every way the bundle read from Json() differs from what it should be; empty when it matches. */
    inline std::vector<std::string> Check(const Bundle& b)
    {
        std::vector<std::string> bad;
        auto expect = [&bad](bool ok, const char* what) { if (!ok) bad.push_back(what); };

        expect(b.schema == "patter/bundle@0", "schema");
        expect(b.contentProject == "proj_reader" && b.contentVersion == "2.1.0" && b.contentHash == "h1" && b.structureHash == "s1", "content");
        expect(b.voiced, "voiced");
        expect(b.localisation.mode == "ids" && b.localisation.sourceDebug, "localisation");
        expect(b.closedCaptions.present && b.closedCaptions.open == "<" && b.closedCaptions.close == ">" && b.closedCaptions.character == "FX", "closedCaptions");
        expect(b.locales.defaultLocale == "en" && b.locales.included == std::vector<std::string>{"en", "fr"}, "locales");
        expect(b.cast.size() == 2 && b.cast[0].displayName == "Anna" && b.cast[1].name == "FX" && b.cast[1].displayName.empty(), "cast");

        expect(b.properties.size() == 4, "properties");
        if (b.properties.size() == 4)
        {
            const PropertyDecl& gold = b.properties[0];
            expect(gold.hasShared && gold.shared && gold.hasDefault && gold.def.kind == PatterKind::Number && gold.def.n == 5, "a number default, shared");
            const PropertyDecl& mood = b.properties[1];
            expect(mood.temporary && mood.values == std::vector<std::string>{"calm", "cross"} && mood.def.kind == PatterKind::Str && mood.def.s == "calm", "an enum default, temporary");
            const PropertyDecl& seen = b.properties[2];
            expect(seen.def.kind == PatterKind::Flags && seen.def.f.size() == 2, "a flags default");
            expect(!b.properties[3].hasDefault, "a null default reads as absent");
        }

        expect(b.scopeRegistry.present && b.scopeRegistry.version == 1 && b.scopeRegistry.scopes.size() == 2, "scopeRegistry");
        if (b.scopeRegistry.scopes.size() == 2)
        {
            const HostScopeSpec& world = b.scopeRegistry.scopes[0];
            expect(world.token == "world" && world.hasWritable && !world.writable && world.hasDeclarations && world.declarations.size() == 2, "a declared host scope");
            if (world.declarations.size() == 2)
            {
                expect(world.declarations[0].hasWritable && !world.declarations[0].writable && world.declarations[0].def.s == "day", "a read-only declaration");
                expect(world.declarations[1].stages == std::vector<std::string>{"low", "high"} && !world.declarations[1].hasDefault, "a quality declaration, null default absent");
            }
            expect(!b.scopeRegistry.scopes[1].hasDeclarations && !b.scopeRegistry.scopes[1].hasWritable, "an opaque host scope");
        }
        expect(b.externalScopes == std::vector<std::string>{"story"}, "externalScopes");
        auto gdf = b.gameDataFields.find("line");
        expect(gdf != b.gameDataFields.end() && gdf->second.size() == 1 && gdf->second[0].hasDefault && gdf->second[0].def.s == "wide" && gdf->second[0].values.size() == 2, "gameDataFields");
        expect(b.strings.size() == 2 && b.strings.at("en").at("T1") == "Go" && b.strings.at("fr").size() == 1, "strings");

        // Document order, not id order, and not the map's.
        expect(b.sceneOrder == std::vector<std::string>{"scn_zz", "scn_aa", "scn_mm"}, "sceneOrder is the authored order");

        auto zz = b.scenes.find("scn_zz");
        if (zz == b.scenes.end()) { bad.push_back("scene scn_zz"); return bad; }
        const Scene& s = zz->second;
        expect(s.name == "Tavern" && s.gameId == "tavern" && s.tags == std::vector<std::string>{"night"}, "scene fields");
        expect(s.gameData && s.gameData->size() == 4 && s.gameData->at("music").kind == PatterKind::Str && s.gameData->at("volume").n == 0.5
            && s.gameData->at("loud").kind == PatterKind::Bool && s.gameData->at("loud").b && s.gameData->at("moods").kind == PatterKind::Flags, "scene gameData, one value of each kind");
        expect(s.sceneProps.size() == 1 && s.sceneProps[0].name == "visits", "sceneProps");
        expect(s.onEntry.size() == 1 && s.onEntry[0].target == "@scene.visits" && s.onEntry[0].value.src == "@scene.visits + 1" && s.onEntry[0].value.ast, "onEntry effect, with its src");
        expect(s.blocks.size() == 1 && s.blocks[0].gameId == "bar" && s.blocks[0].children.size() == 1, "block");
        expect(b.scenes.count("scn_aa") && b.scenes.at("scn_aa").blocks.empty(), "a scene with no blocks");
        expect(b.scenes.count("scn_mm") && b.scenes.at("scn_mm").name.empty() && b.scenes.at("scn_mm").blocks.size() == 1, "a scene with no name");
        if (s.blocks.size() != 1 || s.blocks[0].children.size() != 1) return bad;

        const Node& g = *s.blocks[0].children[0];
        expect(g.isGroup() && g.selector == "choice" && g.shared && g.options && g.options->order == "authored" && g.options->exhaust == "once", "group, options");
        expect(g.prompt && g.prompt->id == "P1" && g.prompt->character == "ANNA", "prompt");
        expect(g.children.size() == 3, "options");
        if (g.children.size() != 3) return bad;
        const Node& sticky = *g.children[0];
        expect(sticky.sticky && !sticky.fallback && !sticky.secretUntilEligible, "a sticky option");
        expect(sticky.jump && sticky.jump->to == "scn_aa" && sticky.jump->mode == "call", "a call jump");
        const Node& secret = *g.children[1];
        expect(secret.secretUntilEligible && !secret.sticky, "a secret-until-eligible option");
        expect(secret.condition && secret.condition->src == "@gold > 3" && secret.condition->ast, "a condition, with its src");
        expect(secret.beats.size() == 1, "beats");
        if (secret.beats.size() == 1)
        {
            const Beat& l = secret.beats[0];
            expect(l.hasCharacter && l.character.empty(), "a \"\" character is set, not absent");
            expect(l.hasDirection && l.direction == "quietly" && l.tags == std::vector<std::string>{"hush"}, "beat direction, tags");
            expect(l.gameData && l.gameData->at("camera").s == "close", "beat gameData");
        }
        expect(!secret.jump, "no jump");
        const Node& fallback = *g.children[2];
        expect(fallback.fallback && fallback.onExit.size() == 1 && fallback.onExit[0].value.src == "0", "a fallback option, its onExit");
        return bad;
    }
}}
