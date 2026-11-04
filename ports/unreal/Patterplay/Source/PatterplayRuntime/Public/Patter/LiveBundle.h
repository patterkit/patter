// Live bundle refresh: the game-side apply step. A port of @patterkit/play-helpers' applyLiveBundle (Unity's
// PatterLiveBundle.ApplyLiveBundle, Godot's Engine.apply_live_bundle), and the ONE rule for C++: UPatterEngine's
// ApplyLiveBundle calls it, and so can a host that plays the core directly.
//
// The editor pushes a freshly compiled bundle over the debug link; the host parses it into a Bundle (the plugin's
// UPatterBundle::LoadFromString, or parseBundle over the host's own JSON) and hands it here with the bundle the
// engine is running:
//   - the same structureHash  -> "text": engine.replaceStrings(next), the same engine back, nothing restarts.
//   - any other               -> "structure": engine.hotSwap(next), a replacement engine with the run carried over
//                                (content drift resolved by the save rules, spec 9.8). Re-bind flow handles through
//                                the new engine's getFlow(id).
// A structureHash missing on either side (an older compiler) is a "structure" swap: safe, just less gentle.
#pragma once

#include <memory>
#include <string>
#include "Patter/Bundle.h"
#include "Patter/Engine.h"

namespace patter
{
    /** What applying a pushed bundle produced. */
    struct LiveBundleResult
    {
        /** The engine to keep using: the same one for "text", a replacement for "structure". */
        std::shared_ptr<Engine> engine;
        /** The bundle the engine now plays (`next`): hold it for the next apply's comparison. */
        const Bundle* bundle = nullptr;
        /** Which tier applied: "text" (strings only, nothing restarted) or "structure" (a full hot swap). */
        std::string kind;
    };

    /** Apply `next` to `engine`, which is running `current`. The caller keeps `next` alive for as long as the engine
     *  it gets back plays (either tier points into it), as for the Engine constructor. Throws what hotSwap throws:
     *  a swap refused because a checkpoint is open (nothing changed), or no replacement could be built. A text edit
     *  never throws. */
    inline LiveBundleResult applyLiveBundle(std::shared_ptr<Engine> engine, const Bundle& current, const Bundle& next)
    {
        const bool sameStructure = !current.structureHash.empty() && current.structureHash == next.structureHash;
        if (sameStructure)
        {
            engine->replaceStrings(next);
            return { std::move(engine), &next, "text" };
        }
        std::shared_ptr<Engine> swapped(engine->hotSwap(next));
        return { std::move(swapped), &next, "structure" };
    }
}
