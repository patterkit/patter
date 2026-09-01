// Blueprint-facing types for a played step. The engine's std:: step result is converted to
// these at the UObject boundary.
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

/** One author Game Data value: name, value type, and the value as a display string. Carried by
 *  delivered steps (host events ride on Game Data) and by the structure-introspection beats. */
USTRUCT(BlueprintType)
struct FPatterGameDataEntry
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Name;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	EPatterPropertyType Type = EPatterPropertyType::String;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Value;
};

USTRUCT(BlueprintType)
struct FPatterOption
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Id;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Text;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bEligible = false;

	// The option's author Game Data (raw overrides), so a host can draw the option from data / an icon.
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FPatterGameDataEntry> GameData;

	// The prompt's spoken metadata for a LINE prompt (empty for a text prompt) - mirrors FPatterStep.
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Character;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString CharacterName;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Direction;
};

// One shared @patter property for the Runtime State inspector: its ref, type, current value and
// declared default (as display strings), enum options, and whether it currently sits at its
// default (so a reset button can disable). Mirrors patter::PropertyRow and the Unity / Godot row.
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

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString CharacterName;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Direction;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FPatterOption> Options;

	// The beat's author Game Data (raw overrides). Host events ride on this: a game-event beat's
	// cue lives here for your game to act on. Read a field's full effective value (override merged
	// over the declared defaults) via the gameData helpers when you need the defaults too.
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FPatterGameDataEntry> GameData;

	// Accumulated author tags (own + every ancestor's, outermost-first). Empty when none.
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FString> Tags;
};
