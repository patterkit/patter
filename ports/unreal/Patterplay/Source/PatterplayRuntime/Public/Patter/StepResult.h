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
    };

    struct ChoiceOption
    {
        std::string id;
        std::shared_ptr<ChoicePrompt> prompt;   // null when no prompt at all
        bool eligible = false;
        std::shared_ptr<GameData> gameData;
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
        std::shared_ptr<GameData> gameData;
        bool hasTags = false; std::vector<std::string> tags;   // author tags (#215)
        std::vector<ChoiceOption> options;       // choice only
        std::string groupId;                     // choice only

        static StepResult End() { StepResult r; r.type = StepType::End; return r; }
    };
}
