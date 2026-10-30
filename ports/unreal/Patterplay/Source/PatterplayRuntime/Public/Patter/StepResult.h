// What Flow::advance() surfaces at each stop - the normalised step the conformance
// transcript pins (line / text / gameEvent / choice / end).
#pragma once

#include <string>
#include <vector>
#include <memory>
#include "Bundle.h"

namespace patter
{
    enum class StepType { Line, Text, GameEvent, Choice, End };

    /// Why a flow ended (an End step's `reason`; JS EndReason "ended" | "ran-dry"). RanDry when it ended
    /// because a choice ran dry with nothing delivered after it (a hub that ran out, reported through
    /// onError too, as a `dry-choice`); Ended otherwise: falling off the end of a block, an END, or the
    /// host's gotoAddress("END").
    enum class EndReason { Ended, RanDry };

    struct ChoicePrompt
    {
        std::string kind;            // line | text
        std::string text;
        // Line only, and only when set: a field set to "" is kept (has = true), as on StepResult.
        bool hasCharacter = false; std::string character;
        bool hasCharacterName = false; std::string characterName;
        bool hasDirection = false; std::string direction;
        bool hasQualifier = false; std::string qualifier;           // speaker qualifier gameId (`vo`)
        bool hasQualifierName = false; std::string qualifierName;   // and its resolved shown name
        // The name to show for the speaker, locale-resolved: `You (V.O.)`, a pair's own label, or with no qualifier
        // the shown name. Unset with no character, and in an IDs-only build.
        bool hasSpeakerLabel = false; std::string speakerLabel;
        // The prompt's resolved pause, in seconds (line padding): when it is spoken (by replayPromptOnChoose,
        // or by a game that voices it), the wait before the reply, negative to cut in on the question. Always
        // set by the engine; hasPadAfter is false only on a prompt read from a save written before it existed.
        bool hasPadAfter = false; double padAfter = DEFAULT_PAD_AFTER;
    };

    // A node's gameData as the game's own copy (null when it has none): the bundle's object is shared by
    // every engine on the bundle, so what a game is handed must be a copy. Flags lists are values, so they
    // copy with it. Extension values are not copied (see StepResult::extensions).
    inline std::shared_ptr<GameData> copyGameData(const std::shared_ptr<GameData>& gameData)
    {
        return gameData ? std::make_shared<GameData>(*gameData) : nullptr;
    }

    struct ChoiceOption
    {
        std::string id;
        std::shared_ptr<ChoicePrompt> prompt;   // null when no prompt at all
        bool eligible = false;
        // The option's own author gameData, raw: the game's own copy (null when it sets none), so editing it
        // changes nothing the engine, or another engine on the same bundle, hands out next.
        std::shared_ptr<GameData> gameData;
        // The option's Patter extension values, by extension id, exactly as the bundle carries them: raw and
        // sparse, any JSON, never read by the engine, and the bundle's own, so read-only by contract. Empty
        // when it has none. Fill in defaults with effectiveGameData(extensionDecls(bundle, id, "option"),
        // option.extensions.get(id)). A save doesn't carry them: they're read off the option's node.
        NodeExtensions extensions;
    };

    struct StepResult
    {
        StepType type = StepType::End;
        std::string id;
        std::string text;
        bool hasCharacter = false; std::string character;
        bool hasCharacterName = false; std::string characterName;
        bool hasDirection = false; std::string direction;
        bool hasQualifier = false; std::string qualifier;           // speaker qualifier gameId (`vo`)
        bool hasQualifierName = false; std::string qualifierName;   // and its resolved shown name
        // The name to show for the speaker, locale-resolved: `You (V.O.)`, a pair's own label, or with no qualifier
        // the shown name. Unset with no character, and in an IDs-only build.
        bool hasSpeakerLabel = false; std::string speakerLabel;
        // The pause after a line or text step, in seconds (line padding): always set on those two, resolved
        // from the beat's own value and the defaults above it; 0 on any other step, which carries none.
        double padAfter = 0;
        // A text step that is action: a direction for whoever stages the scene, never shown to the player (a
        // dialogue scene's text, unless the project localises it). Its text is the source in every locale. False
        // on any other step, and on a replayed option prompt, which never is.
        bool action = false;
        // The beat's own author gameData, raw: the game's own copy (null when it sets none), so editing it
        // changes nothing the engine, or another engine on the same bundle, hands out next.
        std::shared_ptr<GameData> gameData;
        // A line, text or game-event step's Patter extension values (the beat's, a replayed prompt's
        // included), by extension id, raw as the bundle carries them; empty when the beat has none. Not
        // copied: they're the bundle's own, and read-only by contract.
        NodeExtensions extensions;
        bool hasTags = false; std::vector<std::string> tags;   // author tags (#215)
        std::vector<ChoiceOption> options;       // choice only
        std::string groupId;                     // choice only
        EndReason reason = EndReason::Ended;     // end only: why the flow ended

        static StepResult End(EndReason why = EndReason::Ended) { StepResult r; r.type = StepType::End; r.reason = why; return r; }
    };
}
