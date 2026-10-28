// Audio resolver (#206): map a beat id to the path of its winning audio take, from the `patteraudio.json`
// manifest Patterpad (or the CLI) emits next to the Audio Folders. It RESOLVES ONLY; playback stays yours
// (a USoundBase you load / stream from the returned path). The manifest already encodes the highest-rung
// winner per beat, so there is no folder search at runtime. BlueprintCallable so audio wiring can stay in
// Blueprint. Mirrors the JS createAudioResolver / Unity PatterAudioResolver / Godot PatterAudioResolver.
// The reading, the lookup, and the join are the std core's (Patter/Audio.h), which the corpus checks; this
// wraps it for Blueprint.
//
//   UPatterAudioResolver* Audio = UPatterAudioResolver::Create(ManifestJson, TEXT("Audio"));
//   FString Path = Audio->Resolve(Step.Id);   // full path, or empty when the beat has no recording
//
// Optional, for takes imported as sound assets: SoundAsset maps a beat's take to the asset the import made of
// it, and LoadSound loads it. Nothing else uses them (the runner never touches audio).
#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "UObject/SoftObjectPtr.h"
#include "Templates/PimplPtr.h"
#include "PatterAudioResolver.generated.h"

class USoundBase;

namespace patter { class AudioResolver; }

UCLASS(BlueprintType)
class PATTERPLAYRUNTIME_API UPatterAudioResolver : public UObject
{
	GENERATED_BODY()

public:
	// Parse a patteraudio.json manifest; BasePath is where you deployed the audio folder. Never returns
	// null (a bad manifest yields an empty resolver + a log), so Blueprint calls stay safe.
	UFUNCTION(BlueprintCallable, Category = "Patterplay|Audio")
	static UPatterAudioResolver* Create(const FString& ManifestJson, const FString& BasePath);

	// The full path of a beat's winning audio take, or empty when it has none.
	UFUNCTION(BlueprintPure, Category = "Patterplay|Audio")
	FString Resolve(const FString& BeatId) const;

	// Optional: the sound asset a beat's take became when the audio folder was imported under ContentRoot, as
	// a soft pointer, or a null one when the beat has no take. The manifest's file, without its extension,
	// under the root: with ContentRoot "VO" (or "/Game/VO"), vo/L1.wav is /Game/VO/vo/L1.L1. A root that
	// starts with "/" is kept as it is (a plugin's content, say). Characters an asset name can't hold become
	// "_", as the import makes them. Resolves only: load it yourself, asynchronously in a big game.
	UFUNCTION(BlueprintPure, Category = "Patterplay|Audio")
	TSoftObjectPtr<USoundBase> SoundAsset(const FString& BeatId, const FString& ContentRoot) const;

	// Optional: SoundAsset, loaded synchronously. Null when the beat has no take or the asset isn't there.
	UFUNCTION(BlueprintCallable, Category = "Patterplay|Audio")
	USoundBase* LoadSound(const FString& BeatId, const FString& ContentRoot) const;

protected:
	// Read a manifest into a resolver Create made.
	static UPatterAudioResolver* Fill(UPatterAudioResolver* Audio, const FString& ManifestJson, const FString& BasePath);

	// The core resolver (Pimpl: the std core stays out of this header). Null on an object nothing filled,
	// which resolves nothing.
	TPimplPtr<patter::AudioResolver> Core;
};
