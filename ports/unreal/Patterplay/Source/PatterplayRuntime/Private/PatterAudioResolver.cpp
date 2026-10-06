#include "PatterAudioResolver.h"
#include "PatterAudio.h"

#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
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
	// A base that already ends in a separator is joined as it stands: trimming it turned a root such as
	// "/" into "", and the path lost its root.
	Audio->Base = BasePath;

	TSharedPtr<FJsonObject> Root;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(ManifestJson);
	if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
	{
		UE_LOG(LogTemp, Error, TEXT("Patterplay: not a valid patteraudio.json manifest"));
		return Audio; // empty resolver rather than null
	}

	const TSharedPtr<FJsonObject>* Clips;
	if (Root->TryGetObjectField(TEXT("clips"), Clips))
	{
		for (const TPair<FString, TSharedPtr<FJsonValue>>& KV : (*Clips)->Values)
		{
			const TSharedPtr<FJsonObject>* Clip;
			FString File;
			if (KV.Value->TryGetObject(Clip) && (*Clip)->TryGetStringField(TEXT("file"), File) && !File.IsEmpty())
			{
				Audio->Files.Add(KV.Key, File);
			}
		}
	}
	return Audio;
}

FString UPatterAudioResolver::Resolve(const FString& BeatId) const
{
	const FString* File = Files.Find(BeatId);
	if (!File) return FString();
	const bool bSeparated = Base.IsEmpty() || Base.EndsWith(TEXT("/")) || Base.EndsWith(TEXT("\\"));
	return Base + (bSeparated ? TEXT("") : TEXT("/")) + *File;
}
