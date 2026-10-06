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

/** What failed in a content error the engine played through (FPatterPlayError). */
UENUM(BlueprintType)
enum class EPatterPlayErrorKind : uint8
{
	/** A condition that failed to evaluate. It counted as false. */
	Condition,
	/** An effect whose value failed to evaluate, or whose write was refused. It was skipped. */
	Effect,
	/** A part of a Best-match condition that failed while being scored. It scored as false. */
	BestMatch
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

	/** The language to play in, such as "fr". Empty: the bundle's default locale. */
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

	/** Prompt.Text, from before the prompt was its own value. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay", meta = (DeprecatedProperty, DeprecationMessage = "Use Prompt.Text, as every Patterplay runtime's option has it."))
	FString Text;

	/** Prompt.Kind, or None without a prompt, from before the prompt was its own value. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay", meta = (DeprecatedProperty, DeprecationMessage = "Use Prompt.Kind and bHasPrompt, as every Patterplay runtime's option has it."))
	EPatterPromptKind PromptKind = EPatterPromptKind::None;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay", meta = (DeprecatedProperty, DeprecationMessage = "Use Prompt.Character, as every Patterplay runtime's option has it."))
	FString Character;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay", meta = (DeprecatedProperty, DeprecationMessage = "Use Prompt.CharacterName, as every Patterplay runtime's option has it."))
	FString CharacterName;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay", meta = (DeprecatedProperty, DeprecationMessage = "Use Prompt.Direction, as every Patterplay runtime's option has it."))
	FString Direction;
};

// One shared @patter property for the Runtime State inspector: its ref, type, current value and
// declared default (as display strings), enum options, and whether it currently sits at its
// default (so a reset button can disable). Mirrors patter::PropertyRow and the Unity / Godot row.
/** One retained decision, for a debug UI: what the engine CHOSE, not what it produced. A step
 *  says which line played; this says why THAT line and not its siblings. `Considered` carries
 *  every child or option looked at with its verdict, which is the whole point: naming only the
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

	/** A diagnostic's kind: condition | effect | best-match. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Kind;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Node;

	/** A diagnostic's expression source text, when the bundle carries it. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Source;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Message;

	/** Group, To, Target, or Node, whichever the type names: the field before entries took the JS names. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay", meta = (DeprecatedProperty, DeprecationMessage = "Use Group, To, Target, or Node, the fields every Patterplay runtime's entry has."))
	FString Subject;

	/** Children or Options: the field before entries took the JS names. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay", meta = (DeprecatedProperty, DeprecationMessage = "Use Children or Options, the fields every Patterplay runtime's entry has."))
	TArray<FPatterLogConsidered> Considered;

	/** Mode or Message: the field before entries took the JS names. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay", meta = (DeprecatedProperty, DeprecationMessage = "Use Mode or Message, the fields every Patterplay runtime's entry has."))
	FString Detail;
};

/** A content error the engine played through, as UPatterEngine::OnError reports it. Content can fail at
 *  run time in ways the compiler cannot see: a division by zero, a host value of the wrong type, a story
 *  write to a read-only @world value. The story never stops for one: a condition that fails counts as
 *  false, an effect that fails is skipped and the rest of its list still runs, and a part of a Best-match
 *  condition that fails scores as false. The same rule holds on every Patterplay runtime. */
USTRUCT(BlueprintType)
struct FPatterPlayError
{
	GENERATED_BODY()

	/** The flow it happened in. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Flow;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	EPatterPlayErrorKind Kind = EPatterPlayErrorKind::Condition;

	/** The snippet, group, or option whose condition failed, or that owns the effect (a scene, for its
	 *  on-entry effects). */
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

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FPatterOption> Options;

	/** A Choice step's choice group id (empty on every other step). */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString GroupId;

	// The beat's author Game Data (raw overrides). Host events ride on this: a game-event beat's
	// cue lives here for your game to act on. Read a field's full effective value (override merged
	// over the declared defaults) via the gameData helpers when you need the defaults too.
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FPatterGameDataEntry> GameData;

	// Accumulated author tags (own + every ancestor's, outermost-first). Empty when none.
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FString> Tags;
};
