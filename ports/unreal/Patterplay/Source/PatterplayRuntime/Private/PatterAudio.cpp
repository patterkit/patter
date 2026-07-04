#include "PatterAudio.h"

#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "UObject/Package.h" // GetTransientPackage() - not transitively available in the Game target

UPatterAudio* UPatterAudio::Load(const FString& ManifestJson, const FString& BasePath)
{
	UPatterAudio* Audio = NewObject<UPatterAudio>(GetTransientPackage());
	Audio->Base = BasePath;
	while (Audio->Base.EndsWith(TEXT("/")) || Audio->Base.EndsWith(TEXT("\\")))
	{
		Audio->Base = Audio->Base.LeftChop(1); // trim trailing slash(es); we add exactly one when joining
	}

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

FString UPatterAudio::Resolve(const FString& BeatId) const
{
	const FString* File = Files.Find(BeatId);
	if (!File) return FString();
	return Base.IsEmpty() ? *File : Base + TEXT("/") + *File;
}
