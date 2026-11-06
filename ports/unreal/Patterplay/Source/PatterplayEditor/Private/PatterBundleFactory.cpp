#include "PatterBundleFactory.h"
#include "PatterBundle.h"
#include "PatterLog.h"
#include "Editor.h"
#include "EditorFramework/AssetImportData.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Subsystems/ImportSubsystem.h"

UPatterBundleFactory::UPatterBundleFactory()
{
	bEditorImport = true;
	bText = true;
	SupportedClass = UPatterBundle::StaticClass();
	Formats.Add(TEXT("patterc;Patter compiled bundle"));
}

UObject* UPatterBundleFactory::FactoryCreateText(UClass* InClass, UObject* InParent, FName InName, EObjectFlags Flags,
	UObject* Context, const TCHAR* Type, const TCHAR*& Buffer, const TCHAR* BufferEnd, FFeedbackContext* Warn)
{
	if (GEditor)
	{
		if (UImportSubsystem* Import = GEditor->GetEditorSubsystem<UImportSubsystem>())
		{
			Import->BroadcastAssetPreImport(this, InClass, InParent, InName, Type);
		}
	}

	const FString Json(static_cast<int32>(BufferEnd - Buffer), Buffer);

	UPatterBundle* Bundle = NewObject<UPatterBundle>(InParent, InClass, InName, Flags);
	Bundle->Json = Json;
	if (!Bundle->Parse())
	{
		UE_LOG(LogPatterplay, Error, TEXT("Patterplay: '%s' is not a valid .patterc bundle."), *InName.ToString());
	}
	// The source file, so the asset knows it after a restart and Reimport works. Empty when the text
	// didn't come from a file (an import from a string, a test).
	const FString Source = GetCurrentFilename();
	if (Bundle->AssetImportData && !Source.IsEmpty())
	{
		Bundle->AssetImportData->Update(Source);
	}
	BroadcastPostImport(Bundle);
	return Bundle;
}

bool UPatterBundleFactory::CanReimport(UObject* Obj, TArray<FString>& OutFilenames)
{
	const UPatterBundle* Bundle = Cast<UPatterBundle>(Obj);
	if (!Bundle || !Bundle->AssetImportData)
	{
		return false;
	}
	Bundle->AssetImportData->ExtractFilenames(OutFilenames);
	return true;
}

void UPatterBundleFactory::SetReimportPaths(UObject* Obj, const TArray<FString>& NewReimportPaths)
{
	UPatterBundle* Bundle = Cast<UPatterBundle>(Obj);
	if (Bundle && Bundle->AssetImportData && NewReimportPaths.Num() == 1)
	{
		Bundle->AssetImportData->UpdateFilenameOnly(NewReimportPaths[0]);
	}
}

EReimportResult::Type UPatterBundleFactory::Reimport(UObject* Obj)
{
	UPatterBundle* Bundle = Cast<UPatterBundle>(Obj);
	if (!Bundle || !Bundle->AssetImportData)
	{
		return EReimportResult::Failed;
	}
	const FString Source = Bundle->AssetImportData->GetFirstFilename();
	FString Json;
	if (Source.IsEmpty() || !FPaths::FileExists(Source) || !FFileHelper::LoadFileToString(Json, *Source))
	{
		UE_LOG(LogPatterplay, Warning, TEXT("Patterplay: can't reimport '%s': its .patterc ('%s') can't be read."),
			*Bundle->GetName(), *Source);
		return EReimportResult::Failed;
	}
	// As an import does: the text goes in whatever it is, and a broken bundle carries its LoadError.
	Bundle->Modify();
	Bundle->Json = MoveTemp(Json);
	if (!Bundle->Parse())
	{
		UE_LOG(LogPatterplay, Error, TEXT("Patterplay: '%s' is not a valid .patterc bundle."), *Bundle->GetName());
	}
	Bundle->AssetImportData->Update(Source);
	Bundle->MarkPackageDirty();
	BroadcastPostImport(Bundle);
	return EReimportResult::Succeeded;
}

int32 UPatterBundleFactory::GetPriority() const
{
	return ImportPriority;
}

void UPatterBundleFactory::BroadcastPostImport(UPatterBundle* Bundle)
{
	if (GEditor)
	{
		if (UImportSubsystem* Import = GEditor->GetEditorSubsystem<UImportSubsystem>())
		{
			Import->BroadcastAssetPostImport(this, Bundle);
		}
	}
}
