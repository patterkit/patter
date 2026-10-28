#include "PatterAudioResolver.h"
#include "PatterLog.h"

#include "PatterBundleLoader.h"
#include "PatterConvert.h"
#include "Patter/Audio.h"
#include "UObject/Package.h" // GetTransientPackage() - not transitively available in the Game target
#include "Misc/Paths.h"
#include "Sound/SoundBase.h"
#include "UObject/SoftObjectPath.h"

UPatterAudioResolver* UPatterAudioResolver::Create(const FString& ManifestJson, const FString& BasePath)
{
	return Fill(NewObject<UPatterAudioResolver>(GetTransientPackage()), ManifestJson, BasePath);
}

UPatterAudioResolver* UPatterAudioResolver::Fill(UPatterAudioResolver* Audio, const FString& ManifestJson, const FString& BasePath)
{
	patter::AudioManifest Manifest;
	FString Error;
	if (!PatterLoadAudioManifest(ManifestJson, Manifest, Error))
	{
		UE_LOG(LogPatterplay, Error, TEXT("Patterplay: not a valid patteraudio.json manifest (%s)"), *Error);
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

TSoftObjectPtr<USoundBase> UPatterAudioResolver::SoundAsset(const FString& BeatId, const FString& ContentRoot) const
{
	if (!Core) return TSoftObjectPtr<USoundBase>();
	const std::map<std::string, std::string>& Clips = Core->manifest().clips;
	const auto Clip = Clips.find(PatterConvert::Std(BeatId));
	if (Clip == Clips.end() || Clip->second.empty()) return TSoftObjectPtr<USoundBase>();

	// The take's file, relative to the audio folder, as path segments with the extension dropped.
	FString File = PatterConvert::Ue(Clip->second);
	File.ReplaceInline(TEXT("\\"), TEXT("/"));
	File = FPaths::GetBaseFilename(File, false);   // false: keep the folders
	TArray<FString> Segments;
	File.ParseIntoArray(Segments, TEXT("/"), true);
	if (Segments.Num() == 0) return TSoftObjectPtr<USoundBase>();
	// What the import makes of a name it can't use: each character the asset name (or a folder) can't hold
	// becomes "_", by the editor's own lists (ObjectTools::SanitizeObjectName and SanitizeObjectPath).
	for (int32 I = 0; I < Segments.Num(); ++I)
		for (const TCHAR* Bad = I == Segments.Num() - 1 ? INVALID_OBJECTNAME_CHARACTERS : INVALID_OBJECTPATH_CHARACTERS; *Bad; ++Bad)
			Segments[I].ReplaceCharInline(*Bad, TEXT('_'));

	FString Root = ContentRoot;
	Root.ReplaceInline(TEXT("\\"), TEXT("/"));
	while (Root.EndsWith(TEXT("/"))) Root.LeftChopInline(1);
	if (!Root.StartsWith(TEXT("/"))) Root = Root.IsEmpty() ? FString(TEXT("/Game")) : TEXT("/Game/") + Root;

	const FString Package = Root + TEXT("/") + FString::Join(Segments, TEXT("/"));
	return TSoftObjectPtr<USoundBase>(FSoftObjectPath(Package + TEXT(".") + Segments.Last()));
}

USoundBase* UPatterAudioResolver::LoadSound(const FString& BeatId, const FString& ContentRoot) const
{
	const TSoftObjectPtr<USoundBase> Asset = SoundAsset(BeatId, ContentRoot);
	return Asset.IsNull() ? nullptr : Asset.LoadSynchronous();
}
