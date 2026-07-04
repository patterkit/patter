// Audio resolver (#206): map a beat id to the path of its winning audio take, from the `patteraudio.json`
// manifest Patterpad (or the CLI) emits next to the Audio Folders. It RESOLVES ONLY; playback stays yours
// (a USoundBase you load / stream from the returned path). The manifest already encodes the highest-rung
// winner per beat, so there is no folder search at runtime. BlueprintCallable so audio wiring can stay in
// Blueprint. Mirrors the JS createAudioResolver / Unity PatterAudioResolver / Godot PatterAudio.
//
//   UPatterAudio* Audio = UPatterAudio::Load(ManifestJson, TEXT("Audio"));
//   FString Path = Audio->Resolve(Step.Id);   // full path, or empty when the beat has no recording
#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "PatterAudio.generated.h"

UCLASS(BlueprintType)
class PATTERPLAYRUNTIME_API UPatterAudio : public UObject
{
	GENERATED_BODY()

public:
	// Parse a patteraudio.json manifest; BasePath is where you deployed the audio folder. Never returns
	// null (a bad manifest yields an empty resolver + a log), so Blueprint calls stay safe.
	UFUNCTION(BlueprintCallable, Category = "Patterplay|Audio")
	static UPatterAudio* Load(const FString& ManifestJson, const FString& BasePath);

	// The full path of a beat's winning audio take, or empty when it has none.
	UFUNCTION(BlueprintPure, Category = "Patterplay|Audio")
	FString Resolve(const FString& BeatId) const;

private:
	FString Base;
	TMap<FString, FString> Files;
};
