// Blueprint-facing types for a played step. The engine's std:: step result is converted to
// these at the UObject boundary.
//
// Enums or strings: a value a Blueprint switches on while the game plays is an enum, so it gets a
// dropdown and a Switch node (a step's type, a prompt's kind, a beat's kind, a content error's kind, a
// property's type). A record kept for debugging and tooling (a decision log entry, the outline) keeps its
// fields as strings, because it carries the JS runtime's record field for field, the same on every
// runtime, and some of those fields are open sets (a selector, a jump's mode). A field's type is part of
// every graph that reads it, so neither side is converted to the other.
#pragma once

#include "CoreMinimal.h"
#include "PatterTypes.generated.h"

UENUM(BlueprintType)
enum class EPatterStepType : uint8
{
	Line,
	Text,
	GameEvent,
	Choice,
	End
};

/** Why a flow ended: an End step's EndReason (the JS runtime's FlowEndReason, "ended" | "ran-dry"). */
UENUM(BlueprintType)
enum class EPatterFlowEndReason : uint8
{
	/** It ran out: the end of a block, an END, or the host's Goto("END"). Also every step that isn't an End. */
	Ended,
	/** A choice ran dry (no option left to take, and no fallback) with nothing delivered after it, so the flow
	 *  ended there: a hub whose options were all used, say. Reported once through OnError too (DryChoice). */
	RanDry
};

/** What a choice option's prompt is: a line someone speaks, plain text, or none at all. */
UENUM(BlueprintType)
enum class EPatterPromptKind : uint8
{
	None,
	Line,
	Text,
};

UENUM(BlueprintType)
enum class EPatterPropertyType : uint8
{
	Boolean,
	Number,
	String,
	Flags,
	Enum,
	// A quality: a story stage on an ordered ladder (appended, so existing Blueprint assets keep their values).
	Quality
};

UENUM(BlueprintType)
enum class EPatterValueKind : uint8
{
	Boolean,
	Number,
	String,   // a string property, an enum value, or a quality's stage
	Flags
};

/** What a problem the engine reported and carried on past was (FPatterPlayError). */
UENUM(BlueprintType)
enum class EPatterPlayErrorKind : uint8
{
	/** A condition that failed to evaluate. It counted as false. */
	Condition,
	/** An effect whose value failed to evaluate, or whose write was refused. It was skipped. */
	Effect,
	/** A part of a Best-match condition that failed while being scored. It scored as false. */
	BestMatch,
	/** How the engine was set up: a locale the bundle doesn't have, or a host scope it doesn't declare.
	 *  Flow is empty and Node is the locale or the scope's token. */
	Setup,
	/** A load whose saved place has gone from this build: the flow resumed at the nearest safe point. Node
	 *  is the saved snippet, or the pending choice's group. */
	Save,
	/** A choice that ran dry (no option left to take, and no fallback) with nothing delivered after it, so
	 *  the flow ended there. Node is the choice's group; the End step's EndReason is RanDry. Reported once,
	 *  when the flow first ends; a load doesn't report it again. */
	DryChoice
};

/** A Patter value crossing the Blueprint boundary: what a UPatterWorld holds and reports. Shaped
 *  like the Storylet Engine's FStoryletValue, so a project running both reads one shape. `Display`
 *  is the stringified rendering ("true", a JS-stable number, the raw string, flags comma-joined). */
/** How an engine plays, set when it is made (UPatterEngine::CreateWithOptions). The same choices the JS
 *  runtime's EngineOptions, Unity's EngineOptions and Godot's options dictionary offer; the dry-choice
 *  and error callbacks are the engine's OnDryChoice and OnError events instead, the Blueprint way. */
USTRUCT(BlueprintType)
struct FPatterEngineOptions
{
	GENERATED_BODY()

	/** Seed every flow's random choices (shuffle, random(), tie-breaks) with Seed, for a repeatable run.
	 *  Off: the runtime's default seed. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Patterplay")
	bool bUseSeed = false;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Patterplay", meta = (EditCondition = "bUseSeed"))
	int64 Seed = 0;

	/** The language to play in, such as "fr". Empty: the bundle's default locale. A locale the bundle doesn't
	 *  have resolves by the one locale rule (see UPatterEngine::SetLocale) and is reported (Setup). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Patterplay")
	FString Locale;

	/** Speak a chosen option's authored prompt back as the first beat after the choice. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Patterplay")
	bool bReplayPromptOnChoose = false;

	/** Show closed-caption cues in dialogue lines (the default). Off strips them, and silences the
	 *  caption character's lines. SetClosedCaptions changes it later. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Patterplay")
	bool bClosedCaptions = true;

	/** Keep a log of the engine's decisions, read with Log. Off by default: a shipped game pays nothing
	 *  for a debugging aid it never reads. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Patterplay")
	bool bLog = false;
};

/** The bundle's locales (UPatterEngine::Locales): its default, and every locale it includes. */
USTRUCT(BlueprintType)
struct FPatterLocales
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Default;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FString> Included;
};

/** Made in Blueprint for SetProperty: set Kind and the one field it names (bBool, Number, String, or Flags).
 *  Display is ignored on the way in. */
USTRUCT(BlueprintType)
struct FPatterValue
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Patterplay")
	EPatterValueKind Kind = EPatterValueKind::Boolean;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Patterplay")
	bool bBool = false;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Patterplay")
	double Number = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Patterplay")
	FString String;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Patterplay")
	TArray<FString> Flags;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Patterplay")
	FString Display;
};

/** One author Game Data value: name, value type, and the value, both as a display string and typed.
 *  Carried by delivered steps (host events ride on Game Data) and by the structure-introspection beats. */
USTRUCT(BlueprintType)
struct FPatterGameDataEntry
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Name;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	EPatterPropertyType Type = EPatterPropertyType::String;

	/** The value as text, for showing. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Value;

	/** The value itself, for a game to act on: a number as a number, flags as a list. A game event's cue
	 *  rides on Game Data, so a Blueprint branching on one reads this rather than parsing the text. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FPatterValue TypedValue;
};

/** One Patter extension field's value on a node: its name and its value as strict JSON text, raw as the
 *  bundle wrote it. An extension value may be any JSON (a record, a map or a list as well as a scalar),
 *  which no FPatterValue can hold, so it crosses as text: hand a scalar one to
 *  UPatterGameData::ExtensionValueToScalar, or parse a structured one with the game's JSON reader. The
 *  engine never interprets these. */
USTRUCT(BlueprintType)
struct FPatterExtensionEntry
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Name;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Json;
};

/** One Patter extension's values on a node, by extension id, in bundle order. A node carries one of these
 *  per extension that sets anything on it. */
USTRUCT(BlueprintType)
struct FPatterExtensionValues
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Extension;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FPatterExtensionEntry> Values;
};

/** A choice option's prompt, as the JS runtime's ChoicePrompt: a line someone speaks or plain text. The
 *  bHas flags tell an unset field from an empty one. */
USTRUCT(BlueprintType)
struct FPatterChoicePrompt
{
	GENERATED_BODY()

	/** Line or Text. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	EPatterPromptKind Kind = EPatterPromptKind::Text;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Text;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Character;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bHasCharacter = false;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString CharacterName;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bHasCharacterName = false;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Direction;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bHasDirection = false;

	/** The speaker qualifier's gameId (`vo`, `os`, `radio`): how the line is delivered, `TAM (O.S.)`. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Qualifier;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bHasQualifier = false;

	/** The qualifier's shown name (`O.S.`), locale-resolved as CharacterName is; unset in an IDs-only build. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString QualifierName;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bHasQualifierName = false;

	/** The name to show for the speaker, locale-resolved as CharacterName is: with a qualifier, the character's
	 *  own label for that pair if the project gives one, else the project's speaker pattern filled in
	 *  (`You (V.O.)`); with none, the shown name. Show this rather than putting CharacterName and QualifierName
	 *  together yourself. Unset with no character, and in an IDs-only build. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString SpeakerLabel;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bHasSpeakerLabel = false;

	/** The prompt's resolved pause, in seconds (line padding), as on a step: when the prompt is spoken (by
	 *  bReplayPromptOnChoose, or by a game that voices it), the wait before the reply, negative to cut in on
	 *  the question. Always set. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	double PadAfter = 0.6;
};

USTRUCT(BlueprintType)
struct FPatterOption
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Id;

	/** The option's prompt, when it has one (bHasPrompt). */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FPatterChoicePrompt Prompt;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bHasPrompt = false;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bEligible = false;

	// The option's author Game Data (raw overrides), so a host can draw the option from data / an icon.
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FPatterGameDataEntry> GameData;

	/** The option's Patter extension values, raw; empty when it has none.
	 *  UPatterGameData::GetEffectiveExtensionValues fills in the defaults. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FPatterExtensionValues> Extensions;
};

// One shared @patter property for the Runtime State inspector: its ref, type, current value and
// declared default (as display strings), enum options, and whether it currently sits at its
// default (so a reset button can disable). Mirrors patter::PropertyRow and the Unity / Godot row.
/** One retained decision, for a debug UI: what the engine CHOSE, not what it produced. A step
 *  says which line played; this says why THAT line and not its siblings. `Children` and `Options`
 *  carry every child or option looked at with its verdict, which is the whole point: naming only the
 *  winner answers what happened and not why. */
USTRUCT(BlueprintType)
struct FPatterLogConsidered
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Id;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bEligible = false;
};

USTRUCT(BlueprintType)
struct FPatterLogEntry
{
	GENERATED_BODY()

	/** select | choice | chose | dry | jump | write | diagnostic. The JS runtime's entry under the same
	 *  field names: Type says which of them an entry carries, and the rest are empty.
	 *    select:     Group, Selector, Order and Exhaust (a sequence's), Children, Picked (empty when nothing was takeable)
	 *    choice:     Group, Options
	 *    chose:      Group, Option
	 *    dry:        Group
	 *    jump:       To, Mode
	 *    write:      Target, Value, Prev (bHasPrev false when there was none)
	 *    diagnostic: a content error the engine played through (see FPatterPlayError): Kind, Node, Source, Message */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Type;

	/** Monotonic across the flow; survives ClearLog, so order is stable. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	int32 Seq = 0;

	/** The flow this happened in. A run is several flows in one order. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Flow;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Scene;

	/** The group a select, choice, chose, or dry entry is about. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Group;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Selector;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Order;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Exhaust;

	/** Every child a select considered, with its verdict: the reasoning, not just the outcome. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FPatterLogConsidered> Children;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Picked;

	/** Every option a choice offered, with the ones a condition greyed out marked. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FPatterLogConsidered> Options;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Option;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString To;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Mode;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Target;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Value;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Prev;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bHasPrev = false;

	/** A diagnostic's kind: condition | effect | best-match | setup | save | dry-choice. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Kind;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Node;

	/** A diagnostic's expression source text, when the bundle carries it. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Source;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Message;
};

/** A problem the engine reported and carried on past, as UPatterEngine::OnError reports it. Content can fail
 *  at run time in ways the compiler cannot see: a division by zero, a host value of the wrong type, a story
 *  write to a read-only @world value. The story never stops for one: a condition that fails counts as
 *  false, an effect that fails is skipped and the rest of its list still runs, and a part of a Best-match
 *  condition that fails scores as false. The engine also reports how it was set up (Setup: a locale the
 *  bundle doesn't have, a host scope it doesn't declare), a load whose place has gone from the build
 *  (Save), and a choice that ran dry and so ended the flow (DryChoice). The same rule holds on every
 *  Patterplay runtime. */
USTRUCT(BlueprintType)
struct FPatterPlayError
{
	GENERATED_BODY()

	/** The flow it happened in; empty for a Setup report, which belongs to no flow. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Flow;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	EPatterPlayErrorKind Kind = EPatterPlayErrorKind::Condition;

	/** The snippet, group, or option whose condition failed, or that owns the effect (a scene, for its
	 *  on-entry effects). For Setup, the locale or host-scope token at fault; for Save, the saved snippet
	 *  (or the pending choice's group) that has gone; for DryChoice, the choice's group. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Node;

	/** The expression's source text, when the bundle carries it; empty when it does not. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Source;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Message;
};

USTRUCT(BlueprintType)
struct FPatterPropertyRow
{
	GENERATED_BODY()

	/** The addressable reference GetProperty / SetProperty take ("@hp"). Called Ref
	 *  until 2026-09-01; the row shape is now @wildwinter/scoperegistry's, shared with
	 *  the Storylet Engine, where the same field is Path. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Path;

	/** The bare declared name ("hp"). */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Name;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	EPatterPropertyType Type = EPatterPropertyType::Boolean;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Value;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Default;

	// The closed choice list: an enum's options (Type == Enum), or a quality's stage ladder IN ORDER
	// (Type == Quality) - either way, what a UI offers as the value choices.
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FString> Values;

	/** A quality's ordered stage ladder: the closed-set twin of Values. Folded INTO
	 *  Values until 2026-09-01, which the Storylet Engine's struct never did - the
	 *  shared row has both, and a consumer should not have to read Type to know
	 *  which kind of list it is holding. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FString> Stages;

	/** False for a declared read-only property, so an inspector can disable it.
	 *  Always true across Patterplay today; carried because the row is shared. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bWritable = true;

	// True when Value currently equals Default (a reset button uses this to disable itself).
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bIsDefault = false;
};

USTRUCT(BlueprintType)
struct FPatterStep
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	EPatterStepType Type = EPatterStepType::End;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Id;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Text;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Character;

	/** Whether the step has a character at all: a line whose speaker is unset reads differently from one
	 *  whose speaker is empty. Likewise bHasCharacterName and bHasDirection. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bHasCharacter = false;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString CharacterName;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bHasCharacterName = false;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Direction;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bHasDirection = false;

	/** The speaker qualifier's gameId (`vo`, `os`, `radio`): how the line is delivered, `TAM (O.S.)`. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Qualifier;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bHasQualifier = false;

	/** The qualifier's shown name (`O.S.`), locale-resolved as CharacterName is; unset in an IDs-only build. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString QualifierName;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bHasQualifierName = false;

	/** The name to show for the speaker, locale-resolved as CharacterName is: with a qualifier, the character's
	 *  own label for that pair if the project gives one, else the project's speaker pattern filled in
	 *  (`You (V.O.)`); with none, the shown name. Show this rather than putting CharacterName and QualifierName
	 *  together yourself. Unset with no character, and in an IDs-only build. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString SpeakerLabel;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bHasSpeakerLabel = false;

	/** The pause after this line or text step, in seconds (line padding): the beat's own, else the nearest
	 *  default above it, else the project's, else the built-in 0.6. Negative = the next line starts that long
	 *  before this one ends (a cut-in). Always set on a Line or Text step; 0 on any other. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	double PadAfter = 0;

	/** True on a Text step that is action: a direction for whoever stages the scene, never shown to the
	 *  player (a dialogue scene's text, unless the project localises it). Its Text is the source in every
	 *  locale. False on any other step, and on a replayed option prompt, which never is. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bAction = false;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FPatterOption> Options;

	/** A Choice step's choice group id (empty on every other step). */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString GroupId;

	/** An End step's reason: RanDry when a choice ran dry with nothing delivered after it, so the flow ended
	 *  there (reported once through OnError as well), else Ended. Asked again, an ended flow gives the same
	 *  reason, and a save keeps it. Ended on every other step. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	EPatterFlowEndReason EndReason = EPatterFlowEndReason::Ended;

	// The beat's author Game Data (raw overrides). Host events ride on this: a game-event beat's
	// cue lives here for your game to act on. Read a field's full effective value (override merged
	// over the declared defaults) via the gameData helpers when you need the defaults too.
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FPatterGameDataEntry> GameData;

	/** A line, text or game-event step's Patter extension values (a replayed prompt's included), raw as the
	 *  bundle carries them; empty when the beat has none. UPatterGameData::GetEffectiveExtensionValues fills
	 *  in the defaults. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FPatterExtensionValues> Extensions;

	// Accumulated author tags (own + every ancestor's, outermost-first). Empty when none.
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FString> Tags;
};
