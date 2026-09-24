// Blueprint/C++ save helper: the whole game as a tagged patter/save@0 JSON string, and back.
// A thin veneer over the std core's Patter/Save.h so Blueprint-only games can save and load
// without touching C++ - the parity of Unity's PatterSave and play-helpers' save.ts.
//
// The save is version 3: cursors, visits, and selectors, plus every property value when the engine
// made its own registry (UPatterEngine::Create). An engine built on the game's registry
// (CreateWithRegistry) leaves the values to the game, which saves that registry once. Loading
// accepts version 3, a version 2 save (its values move into the registry), or a bare snapshot from
// before the envelope; a foreign blob returns false untouched.
#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "PatterSave.generated.h"

class UPatterEngine;

UCLASS()
class PATTERPLAYRUNTIME_API UPatterSave : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** Serialise the whole game (every live flow, visits, and the engine's own registry's values) to a tagged JSON string. */
	UFUNCTION(BlueprintCallable, Category = "Patterplay|Save")
	static FString SaveStateToJson(UPatterEngine* Engine);

	/** Parse + restore a SaveStateToJson string (or a bare pre-envelope snapshot). False = refused, engine untouched. */
	UFUNCTION(BlueprintCallable, Category = "Patterplay|Save")
	static bool LoadStateFromJson(UPatterEngine* Engine, const FString& Json);
};
