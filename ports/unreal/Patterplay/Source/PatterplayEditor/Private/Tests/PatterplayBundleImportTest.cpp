// The .patterc importer as other plugins see it: an import is broadcast on the editor's import subsystem
// (UImportSubsystem::OnAssetPostImport), the asset keeps its source file (AssetImportData), and a
// reimport reads that file again and is broadcast too. Patterstage's editor makes a bundle's mouth cues
// on that broadcast, and Make Mouth Cues reimports a bundle not imported this session.
//
// The bundle is deliberately not valid JSON: a broken bundle still imports (and carries its LoadError),
// which keeps this test about the importer, not the bundle format. Its two errors are expected.
//
// Headless:
//   <UE>/Engine/Binaries/Mac/UnrealEditor PatterplayDemo.uproject \
//     -ExecCmds="Automation RunTests Patterplay.BundleImport; Quit" -unattended -nullrhi -nosplash

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "PatterBundle.h"
#include "../PatterBundleFactory.h"
#include "Editor.h"
#include "EditorFramework/AssetImportData.h"
#include "HAL/FileManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Subsystems/ImportSubsystem.h"
#include "UObject/Package.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPatterplayBundleImportTest,
	"Patterplay.BundleImport",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::ProductFilter)

bool FPatterplayBundleImportTest::RunTest(const FString& Parameters)
{
	UImportSubsystem* Import = GEditor ? GEditor->GetEditorSubsystem<UImportSubsystem>() : nullptr;
	if (!TestNotNull(TEXT("the editor's import subsystem"), Import))
	{
		return false;
	}

	// Each import and the reimport parse a broken bundle: the loader's error, then the factory's.
	AddExpectedErrorPlain(TEXT("failed to parse bundle"), EAutomationExpectedErrorFlags::Contains, 2);
	AddExpectedErrorPlain(TEXT("is not a valid .patterc bundle"), EAutomationExpectedErrorFlags::Contains, 2);

	TArray<UObject*> Heard;
	const FDelegateHandle Handle = Import->OnAssetPostImport.AddLambda(
		[&Heard](UFactory*, UObject* Created) { if (Cast<UPatterBundle>(Created)) Heard.Add(Created); });

	const FString Dir = FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::AutomationTransientDir(), TEXT("PatterBundleImport")));
	const FString Source = FPaths::Combine(Dir, TEXT("import-test.patterc"));
	FFileHelper::SaveStringToFile(TEXT("{ first, not json"), *Source);

	UPatterBundleFactory* Factory = NewObject<UPatterBundleFactory>();
	bool bCanceled = false;
	UObject* Imported = Factory->ImportObject(UPatterBundle::StaticClass(), GetTransientPackage(),
		TEXT("PatterBundleImportTest"), RF_Transient, Source, nullptr, bCanceled);
	UPatterBundle* Bundle = Cast<UPatterBundle>(Imported);

	bool bOk = TestNotNull(TEXT("the import made a bundle"), Bundle);
	if (Bundle)
	{
		TestEqual(TEXT("the import is broadcast once"), Heard.Num(), 1);
		TestTrue(TEXT("the broadcast names the bundle"), Heard.Num() == 1 && Heard[0] == Bundle);
		TestEqual(TEXT("the bundle holds the file's text"), Bundle->Json, FString(TEXT("{ first, not json")));
		TestFalse(TEXT("a broken bundle says why"), Bundle->LoadError.IsEmpty());
		if (TestNotNull(TEXT("the bundle has import data"), Bundle->AssetImportData.Get()))
		{
			TestEqual(TEXT("it keeps its source file"),
				FPaths::ConvertRelativePathToFull(Bundle->AssetImportData->GetFirstFilename()), Source);
		}

		TArray<FString> Paths;
		TestTrue(TEXT("it can be reimported"), Factory->CanReimport(Bundle, Paths));
		TestEqual(TEXT("from its source file"), Paths.Num() == 1 ? FPaths::ConvertRelativePathToFull(Paths[0]) : FString(), Source);

		FFileHelper::SaveStringToFile(TEXT("{ second, still not json"), *Source);
		TestEqual(TEXT("the reimport succeeds"), Factory->Reimport(Bundle), EReimportResult::Succeeded);
		TestEqual(TEXT("the reimport read the file again"), Bundle->Json, FString(TEXT("{ second, still not json")));
		TestEqual(TEXT("the reimport is broadcast too"), Heard.Num(), 2);

		UPatterBundle* NoSource = NewObject<UPatterBundle>(GetTransientPackage(), NAME_None, RF_Transient);
		TestEqual(TEXT("a bundle with no source file can't be reimported"), Factory->Reimport(NoSource), EReimportResult::Failed);
	}

	Import->OnAssetPostImport.Remove(Handle);
	IFileManager::Get().DeleteDirectory(*Dir, false, true);
	return bOk;
}

#endif
