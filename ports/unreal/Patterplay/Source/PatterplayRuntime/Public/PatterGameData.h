// gameData read helpers for Blueprint: sparse overrides resolved against each node type's declared
// field defaults (merge-at-read), as the JS runtime's gameDataFields, gameDataValue, and
// effectiveGameData, Unity's GameDataHelpers, and Godot's PatterBundle helpers do. A step, an option,
// or a scene or block hands over only the values its author overrode; these fill in the rest.
#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "PatterTypes.h"
#include "PatterGameData.generated.h"

class UPatterBundle;

/** One author-defined gameData field a node type declares: its name, type, and default. */
USTRUCT(BlueprintType)
struct FPatterGameDataField
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Name;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	EPatterPropertyType Type = EPatterPropertyType::String;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bHasDefault = false;

	/** The default as a display string, as an FPatterGameDataEntry carries its value. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Default;

	/** The default itself, typed, as an FPatterGameDataEntry's TypedValue. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FPatterValue TypedDefault;

	/** An enum field's options, or the flags a flags field may hold. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FString> Values;

	/** A quality field's ladder, in order. Hand the field to StageIndex, CompareStages or NextStage. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FString> Stages;

	/** What the field is for, in the author's words; empty when they gave none. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Purpose;
};

UCLASS()
class PATTERPLAYRUNTIME_API UPatterGameData : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** The gameData fields declared for a node type ("scene", "block", "line", and so on; empty when none). */
	UFUNCTION(BlueprintPure, Category = "Patterplay|GameData")
	static TArray<FPatterGameDataField> GameDataFields(UPatterBundle* Bundle, const FString& Kind);

	/** One node's value for a field: its override if it has one, else the field's default, as text and typed.
	 *  False when neither is set. */
	UFUNCTION(BlueprintPure, Category = "Patterplay|GameData")
	static bool GameDataValue(const TArray<FPatterGameDataField>& Fields, const TArray<FPatterGameDataEntry>& Node, const FString& Name, FString& OutValue, FPatterValue& OutTypedValue);

	/** A node's full gameData: every declared field resolved (override or default), then any override with
	 *  no declared field. Fields with no value are left out. */
	UFUNCTION(BlueprintPure, Category = "Patterplay|GameData")
	static TArray<FPatterGameDataEntry> EffectiveGameData(const TArray<FPatterGameDataField>& Fields, const TArray<FPatterGameDataEntry>& Node);

	// A quality field's ladder, for game code holding one of its values: the shared kernel's StageIndex,
	// CompareStages and NextStage over the field's declaration, as UPatterEngine's take a property's ref.

	/** The position of Stage on the field's ladder, or -1 when it isn't one of its stages. */
	UFUNCTION(BlueprintPure, Category = "Patterplay|GameData")
	static int32 StageIndex(const FPatterGameDataField& Field, const FString& Stage);

	/** -1, 0 or 1 in OutOrder as A is below, at or above B on the field's ladder. False, logged, when either
	 *  isn't a stage (a deleted one, a drifted value). */
	UFUNCTION(BlueprintPure, Category = "Patterplay|GameData")
	static bool CompareStages(const FPatterGameDataField& Field, const FString& A, const FString& B, int32& OutOrder);

	/** The stage after Stage on the field's ladder in OutStage, staying on the top rung, as advance() does.
	 *  False, logged, when Stage isn't a stage. */
	UFUNCTION(BlueprintPure, Category = "Patterplay|GameData")
	static bool NextStage(const FPatterGameDataField& Field, const FString& Stage, FString& OutStage);
};
