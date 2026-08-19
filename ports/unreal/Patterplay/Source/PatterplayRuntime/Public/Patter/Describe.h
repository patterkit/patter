#pragma once
// ---------------------------------------------------------------------------
// describeBundle - the bundle inspector's runtime half. Port of the JS
// reference (packages/runtime/src/describe.ts); read that header for the
// argument, which is not repeated here.
//
// A BUNDLE-level function, deliberately NOT an Engine method: it answers the
// integrator's question from the imported asset alone, with no engine, no state
// and nothing running.
//
//     I dropped a .patterc into my project. What may my game code call, and is
//     this the bundle I think it is?
//
// Everything is in BUNDLE ORDER, never sorted: two runtimes must render the
// same rows in the same sequence, and bundle order is the only order all four
// ports can agree on without importing a collation rule.
//
// Cheap by construction: one walk, no expression parsing, no string tables.
// The details customisation should still build its rows once, not per repaint.
// ---------------------------------------------------------------------------

#include "Patter/Bundle.h"
#include "Patter/Engine.h"   // effectiveGameId

#include <string>
#include <vector>

namespace patter
{
    // Which bundle this is: identity, staleness fingerprints, and how it ships.
    struct BundleIdentity
    {
        std::string schema;           // "patter/bundle@0"
        std::string project;          // a save must agree with this
        std::string version;          // empty when the project stamps none
        std::string hash;             // fingerprint over the WHOLE bundle
        // The same fingerprint with the string tables left out. Equal structureHash plus a different
        // hash means a TEXT-ONLY edit, which is what makes a live hot-swap safe; showing both lets an
        // integrator tell those apart at sight.
        std::string structureHash;
        bool voiced = false;
        std::string defaultLocale;
        std::vector<std::string> locales;
        std::string localisation = "embedded";   // "embedded" | "ids"
        // True when the source locale was embedded purely for debug playback. Such a build is NOT
        // shippable, which is worth saying loudly in an inspector.
        bool sourceDebug = false;
    };

    struct BlockAddress { std::string gameId, name; };

    // One scene, and the addresses game code may aim at inside it.
    struct AddressSummary
    {
        std::string gameId;   // what runFlow / goto take
        std::string name;
        // A block address is SCENE-SCOPED: the pair is the address, which is why these are nested
        // rather than flattened - flattening invites calling one alone.
        std::vector<BlockAddress> blocks;
    };

    // One declared property. hasDefault rather than the value alone: an inspector wants to know
    // whether the host MUST supply something.
    struct PropertySummary
    {
        std::string name, type;
        bool hasDefault = false;
        PatterValue def;
        bool shared = true;
    };

    // A host scope (@world and friends): what the GAME must supply. The highest-value section here.
    struct HostScopeSummary
    {
        std::string token;
        bool writable = true;
        // An OPAQUE scope declares no names: any name is accepted, unchecked. The host contract is
        // then "anything", which is worth showing as such rather than as an empty property list.
        bool opaque = false;
        std::vector<PropertySummary> properties;
    };

    struct SceneProperties { std::string gameId; std::vector<PropertySummary> properties; };

    // Story-owned declarations, for orientation rather than for calling.
    struct OwnedProperties
    {
        std::vector<PropertySummary> patter;
        std::vector<SceneProperties> scene;
    };

    struct GameDataFieldSummary
    {
        std::string name, type;
        bool hasDefault = false;
        std::vector<std::string> values;   // enum options: the set host code switches on
    };

    struct GameDataSummary { std::string kind; std::vector<GameDataFieldSummary> fields; };

    // "Is this the right build?" at a glance.
    struct BundleCounts
    {
        int scenes = 0, blocks = 0, groups = 0, snippets = 0;
        // Snippet beats: the SAME population getBeatSequence walks, deliberately, so a tool that
        // lists beats and an inspector that counts them never disagree. Choice prompts are not in
        // it - see prompts.
        int beats = 0;
        // Choice-option prompts: beats that live on a group rather than in a snippet. A separate row
        // rather than folded in, which would make beats disagree with getBeatSequence, or dropped,
        // which would understate a choice-heavy story.
        int prompts = 0;
        int gameEvents = 0;
        int cast = 0;
    };

    struct BundleDescription
    {
        BundleIdentity identity;
        std::vector<AddressSummary> addresses;
        std::vector<HostScopeSummary> hostScopes;
        OwnedProperties properties;
        std::vector<GameDataSummary> gameData;
        BundleCounts counts;
    };

    namespace detail
    {
        inline PropertySummary summariseProperty(const PropertyDecl& d, bool scopeDefault)
        {
            PropertySummary s;
            s.name = d.name;
            s.type = d.type;
            s.hasDefault = d.hasDefault;
            if (d.hasDefault) s.def = d.def;
            // A declaration's sharing default differs by the scope it sits in: a project-level
            // property is shared, a scene-local one is per-flow.
            s.shared = d.hasShared ? d.shared : scopeDefault;
            return s;
        }

        inline PropertySummary summariseHostProperty(const HostScopeDecl& d)
        {
            PropertySummary s;
            s.name = d.name;
            s.type = d.type;
            s.hasDefault = d.hasDefault;
            if (d.hasDefault) s.def = d.def;
            // A host scope's values live outside the story, so "shared" is not a choice its
            // declarations make; they are world-wide by nature.
            s.shared = true;
            return s;
        }

        // One pass over a block's tree. Iterative rather than recursive: a deeply nested choice tree
        // should not put an inspector's stack at risk, and traversal order does not matter to a count.
        inline void countBlock(const Block& block, BundleCounts& counts)
        {
            counts.blocks++;
            std::vector<const Node*> stack;
            for (const NodePtr& child : block.children) if (child) stack.push_back(child.get());
            while (!stack.empty())
            {
                const Node* node = stack.back();
                stack.pop_back();
                if (node->type == "group")
                {
                    counts.groups++;
                    if (node->prompt) counts.prompts++;
                    for (const NodePtr& child : node->children) if (child) stack.push_back(child.get());
                    continue;
                }
                counts.snippets++;
                for (const Beat& beat : node->beats)
                {
                    counts.beats++;
                    if (beat.kind == "gameEvent") counts.gameEvents++;
                }
            }
        }
    }

    // Describe a compiled bundle: what it is, and what a game may call on it.
    inline BundleDescription describeBundle(const Bundle& bundle)
    {
        BundleDescription out;
        out.counts.cast = static_cast<int>(bundle.cast.size());

        for (const auto& kv : bundle.scenes)
        {
            const Scene& scene = kv.second;
            out.counts.scenes++;
            AddressSummary addr;
            addr.gameId = effectiveGameId(scene.gameId, scene.name);
            addr.name = scene.name;
            for (const Block& b : scene.blocks) addr.blocks.push_back({ effectiveGameId(b.gameId, b.name), b.name });
            out.addresses.push_back(addr);
            for (const Block& b : scene.blocks) detail::countBlock(b, out.counts);
            // Scene-local declarations default to PER-FLOW, unlike project-level ones.
            if (!scene.sceneProps.empty())
            {
                SceneProperties sp;
                sp.gameId = addr.gameId;
                for (const PropertyDecl& d : scene.sceneProps) sp.properties.push_back(detail::summariseProperty(d, false));
                out.properties.scene.push_back(sp);
            }
        }

        for (const HostScopeSpec& spec : bundle.scopeRegistry.scopes)
        {
            HostScopeSummary hs;
            hs.token = spec.token;
            hs.writable = spec.hasWritable ? spec.writable : true;
            hs.opaque = !spec.hasDeclarations;
            for (const HostScopeDecl& d : spec.declarations) hs.properties.push_back(detail::summariseHostProperty(d));
            out.hostScopes.push_back(hs);
        }

        for (const PropertyDecl& d : bundle.properties) out.properties.patter.push_back(detail::summariseProperty(d, true));

        for (const auto& kv : bundle.gameDataFields)
        {
            if (kv.second.empty()) continue;
            GameDataSummary gd;
            gd.kind = kv.first;
            for (const GameDataField& f : kv.second)
            {
                GameDataFieldSummary fs;
                fs.name = f.name;
                fs.type = f.type;
                fs.hasDefault = f.hasDefault;
                fs.values = f.values;
                gd.fields.push_back(fs);
            }
            out.gameData.push_back(gd);
        }

        out.identity.schema = bundle.schema;
        out.identity.project = bundle.contentProject;
        out.identity.version = bundle.contentVersion;
        out.identity.hash = bundle.contentHash;
        out.identity.structureHash = bundle.structureHash;
        out.identity.voiced = bundle.voiced;
        out.identity.defaultLocale = bundle.locales.defaultLocale;
        out.identity.locales = bundle.locales.included;
        // Absent means "embedded": the back-compat default a bundle written before the field existed
        // relies on.
        out.identity.localisation = bundle.localisation.mode.empty() ? "embedded" : bundle.localisation.mode;
        out.identity.sourceDebug = bundle.localisation.sourceDebug;
        return out;
    }
}
