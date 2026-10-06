// The name UPatterAudioResolver had before it took the name every Patterplay runtime uses. A subclass, so
// code and Blueprints that hold a UPatterAudio keep working for now; it goes in a later release.
#pragma once

#include "CoreMinimal.h"
#include "PatterAudioResolver.h"
#include "PatterAudio.generated.h"

UCLASS(BlueprintType, meta = (DeprecationMessage = "Use UPatterAudioResolver, the name every Patterplay runtime uses."))
class PATTERPLAYRUNTIME_API UPatterAudio : public UPatterAudioResolver
{
	GENERATED_BODY()

public:
	UFUNCTION(BlueprintCallable, Category = "Patterplay|Audio", meta = (DeprecatedFunction, DeprecationMessage = "Use UPatterAudioResolver::Create, the name every Patterplay runtime uses."))
	static UPatterAudio* Load(const FString& ManifestJson, const FString& BasePath);
};
