// Blueprint/C++ save helper: the whole game as a tagged patter/save@0 JSON string, and back.
// A thin veneer over the std core's Patter/Save.h so Blueprint-only games can save and load
// without touching C++ - the parity of Unity's PatterSave and play-helpers' save.ts.
//
// The save is version 3: cursors, visits, and selectors, plus every property value when the engine
// made its own registry (UPatterEngine::Create). An engine built on the game's registry
// (CreateWithRegistry) leaves the values to the game, which saves that registry once. Loading
// accepts version 3 or a version 2 save (its values move into the registry), each inside the
// envelope. Anything else (a foreign blob, a bare snapshot with no envelope, a version other than
// exactly 2 or 3, a save with no flows) returns false with the engine untouched.
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
	static FString SerializeState(UPatterEngine* Engine);

	/** Parse + restore a SerializeState string. False = refused (and logged), engine untouched. */
	UFUNCTION(BlueprintCallable, Category = "Patterplay|Save")
	static bool DeserializeState(UPatterEngine* Engine, const FString& Json);

	/** The name SerializeState had before it took the name every runtime uses; goes in a later release. */
	UFUNCTION(BlueprintCallable, Category = "Patterplay|Save", meta = (DeprecatedFunction, DeprecationMessage = "Use SerializeState, the name every Patterplay runtime uses."))
	static FString SaveStateToJson(UPatterEngine* Engine) { return SerializeState(Engine); }

	/** The name DeserializeState had before it took the name every runtime uses; goes in a later release. */
	UFUNCTION(BlueprintCallable, Category = "Patterplay|Save", meta = (DeprecatedFunction, DeprecationMessage = "Use DeserializeState, the name every Patterplay runtime uses."))
	static bool LoadStateFromJson(UPatterEngine* Engine, const FString& Json) { return DeserializeState(Engine, Json); }
};
