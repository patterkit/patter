// Blueprint/C++ save helper: the whole game as a tagged patter/save@0 JSON string, and back.
// A thin veneer over the std core's Patter/Save.h so Blueprint-only games can save and load
// without touching C++ - the parity of Unity's PatterSave and play-helpers' save.ts.
//
// The save is version 4: cursors, visits, and selectors, plus every property value when the engine
// made its own registry (UPatterEngine::Create). An engine built on the game's registry
// (CreateWithRegistry) leaves the values to the game, which saves that registry once. A pending choice
// keeps which options it offered, not their text, so a load shows them in the loading engine's
// language. Loading accepts version 4, or version 3 (written before 1.0), inside the envelope. Anything
// else (a foreign blob, a bare snapshot with no envelope, a version other than exactly 3 or 4, a save
// with no flows) returns false with the engine untouched. A flow whose saved place has gone from this
// build resumes at the nearest safe point and is reported through UPatterEngine::OnError (Save).
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
};
