// gameData read helpers for Blueprint: sparse overrides resolved against each node type's declared
// field defaults (merge-at-read), as the JS runtime's gameDataFields, gameDataValue, and
// effectiveGameData, Unity's GameDataHelpers, and Godot's PatterBundle helpers do. A step, an option,
// or a scene or block hands over only the values its author overrode; these fill in the rest.
//
// Patter extension values follow the same rule (patterkit design/proposals/patter-storylet-extensions.md,
// "At runtime"), with each value as JSON text, since it may be a record, a map or a list: ExtensionDecls,
// ExtensionsOf, GetEffectiveExtensionValues, FindExtensionValue and ExtensionValueToScalar.
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

	/** The type's name as the bundle writes it: text, number, boolean, enum, flags or quality, and for a
	 *  Patter extension field also reference, record, map or list (which Type reads as String). */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString TypeName;

	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	bool bHasDefault = false;

	/** The default as a display string, as an FPatterGameDataEntry carries its value. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString Default;

	/** The default itself, typed, as an FPatterGameDataEntry's TypedValue. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FPatterValue TypedDefault;

	/** The default as strict JSON text. For a Patter extension field of a structured type (record, map,
	 *  list) this is the only form of it, and Default and TypedDefault are left empty. */
	UPROPERTY(BlueprintReadOnly, Category = "Patterplay")
	FString DefaultJson;

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

	/** One Patter extension's declarations for a node kind (project, scene, block, snippet, line, text,
	 *  gameEvent or option), every default resolved, each default in DefaultJson (and in Default and
	 *  TypedDefault as well when it is a scalar). Empty when the bundle has no such extension or it declares
	 *  nothing for the kind. A quality field's declaration goes to StageIndex, CompareStages and NextStage. */
	UFUNCTION(BlueprintPure, Category = "Patterplay|Extensions")
	static TArray<FPatterGameDataField> ExtensionDecls(UPatterBundle* Bundle, const FString& Extension, const FString& Kind);

	/** A node's Patter extension values read off the bundle, raw, by the name a game already holds: project
	 *  (no address); scene by id or gameId; block as "scene/block", each by id or gameId; snippet, line,
	 *  text, gameEvent and option (a group directly inside a choice) by node id. Empty when the node has
	 *  none, the address names nothing, it names a node of another kind, or the kind is unknown. */
	UFUNCTION(BlueprintPure, Category = "Patterplay|Extensions")
	static TArray<FPatterExtensionValues> ExtensionsOf(UPatterBundle* Bundle, const FString& Kind, const FString& Address);

	/** One extension's values on a node with every field the extension declares for that node kind filled
	 *  in from its default where the node sets none (a structured default arrives whole), then any value with
	 *  no declaration, as it is: the extension counterpart of EffectiveGameData. Extensions is the node's raw
	 *  list, as a step, an option, the outline or ExtensionsOf hands it over. An extension the bundle doesn't
	 *  carry declares nothing. */
	UFUNCTION(BlueprintPure, Category = "Patterplay|Extensions")
	static TArray<FPatterExtensionEntry> GetEffectiveExtensionValues(UPatterBundle* Bundle, const FString& Kind, const FString& Extension,
		const TArray<FPatterExtensionValues>& Extensions);

	/** One extension field's value, as JSON text, in OutJson: the entry named Field under Extension in a
	 *  node's list. False when the node sets none (pass the list through GetEffectiveExtensionValues first to
	 *  see the default instead). */
	UFUNCTION(BlueprintPure, Category = "Patterplay|Extensions")
	static bool FindExtensionValue(const TArray<FPatterExtensionValues>& Extensions, const FString& Extension, const FString& Field, FString& OutJson);

	/** One extension value as a Patter value, when it is one: a boolean, a number, a string, or a list of
	 *  strings (as flags). False for a record, a map, any other list, null, or text that isn't JSON. */
	UFUNCTION(BlueprintPure, Category = "Patterplay|Extensions")
	static bool ExtensionValueToScalar(const FString& Json, FPatterValue& OutValue);

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
