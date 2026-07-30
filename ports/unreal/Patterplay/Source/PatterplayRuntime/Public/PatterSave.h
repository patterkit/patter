// Blueprint/C++ save helper: the whole game as a tagged patter/save@0 JSON string, and back.
// A thin veneer over the std core's Patter/Save.h so Blueprint-only games can save and load
// without touching C++ - the parity of Unity's PatterSave and play-helpers' save.ts. Loading
// accepts the envelope or a bare version-2 snapshot; a foreign blob returns false untouched.
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
	/** Serialise the whole game (shared state, visits, every live flow) to a tagged JSON string. */
	UFUNCTION(BlueprintCallable, Category = "Patterplay|Save")
	static FString SaveStateToJson(UPatterEngine* Engine);

	/** Parse + restore a SaveStateToJson string (or a bare pre-envelope snapshot). False = refused, engine untouched. */
	UFUNCTION(BlueprintCallable, Category = "Patterplay|Save")
	static bool LoadStateFromJson(UPatterEngine* Engine, const FString& Json);
};
