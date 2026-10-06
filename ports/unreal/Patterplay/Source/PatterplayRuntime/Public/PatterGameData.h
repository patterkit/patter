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

	/** An enum field's options. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	TArray<FString> Values;
};

UCLASS()
class PATTERPLAYRUNTIME_API UPatterGameData : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** The gameData fields declared for a node type ("beat", "scene", "block", and so on; empty when none). */
	UFUNCTION(BlueprintPure, Category = "Patterplay|GameData")
	static TArray<FPatterGameDataField> GameDataFields(UPatterBundle* Bundle, const FString& Kind);

	/** One node's value for a field: its override if it has one, else the field's default. False when
	 *  neither is set. */
	UFUNCTION(BlueprintPure, Category = "Patterplay|GameData")
	static bool GameDataValue(const TArray<FPatterGameDataField>& Fields, const TArray<FPatterGameDataEntry>& Node, const FString& Name, FString& OutValue);

	/** A node's full gameData: every declared field resolved (override or default), then any override with
	 *  no declared field. Fields with no value are left out. */
	UFUNCTION(BlueprintPure, Category = "Patterplay|GameData")
	static TArray<FPatterGameDataEntry> EffectiveGameData(const TArray<FPatterGameDataField>& Fields, const TArray<FPatterGameDataEntry>& Node);
};
