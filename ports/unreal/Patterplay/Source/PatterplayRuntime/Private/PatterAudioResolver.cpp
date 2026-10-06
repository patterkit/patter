#include "PatterAudioResolver.h"
#include "PatterAudio.h"

#include "PatterBundleLoader.h"
#include "PatterConvert.h"
#include "Patter/Audio.h"
#include "UObject/Package.h" // GetTransientPackage() - not transitively available in the Game target

UPatterAudioResolver* UPatterAudioResolver::Create(const FString& ManifestJson, const FString& BasePath)
{
	return Fill(NewObject<UPatterAudioResolver>(GetTransientPackage()), ManifestJson, BasePath);
}

UPatterAudio* UPatterAudio::Load(const FString& ManifestJson, const FString& BasePath)
{
	return static_cast<UPatterAudio*>(Fill(NewObject<UPatterAudio>(GetTransientPackage()), ManifestJson, BasePath));
}

UPatterAudioResolver* UPatterAudioResolver::Fill(UPatterAudioResolver* Audio, const FString& ManifestJson, const FString& BasePath)
{
	patter::AudioManifest Manifest;
	FString Error;
	if (!PatterLoadAudioManifest(ManifestJson, Manifest, Error))
	{
		UE_LOG(LogTemp, Error, TEXT("Patterplay: not a valid patteraudio.json manifest (%s)"), *Error);
	}
	// A bad manifest still gives a resolver, one with no takes, rather than null.
	Audio->Core = MakePimpl<patter::AudioResolver>(std::move(Manifest), PatterConvert::Std(BasePath));
	return Audio;
}

FString UPatterAudioResolver::Resolve(const FString& BeatId) const
{
	if (!Core) return FString();
	const std::optional<std::string> Path = Core->resolve(PatterConvert::Std(BeatId));
	return Path ? PatterConvert::Ue(*Path) : FString();
}
