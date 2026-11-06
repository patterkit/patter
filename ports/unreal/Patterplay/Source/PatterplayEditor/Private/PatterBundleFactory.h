// Imports a compiled .patterc file into a UPatterBundle asset, and reimports it from the file the asset
// remembers (its AssetImportData). Both tell the editor's import subsystem, so other plugins hear a
// bundle's import as they hear any asset's (UImportSubsystem::OnAssetPostImport).
#pragma once

#include "CoreMinimal.h"
#include "Factories/Factory.h"
#include "EditorReimportHandler.h"
#include "PatterBundleFactory.generated.h"

class UPatterBundle;

UCLASS()
class UPatterBundleFactory : public UFactory, public FReimportHandler
{
	GENERATED_BODY()

public:
	UPatterBundleFactory();

	virtual UObject* FactoryCreateText(UClass* InClass, UObject* InParent, FName InName, EObjectFlags Flags,
		UObject* Context, const TCHAR* Type, const TCHAR*& Buffer, const TCHAR* BufferEnd, FFeedbackContext* Warn) override;

	//~ FReimportHandler
	virtual bool CanReimport(UObject* Obj, TArray<FString>& OutFilenames) override;
	virtual void SetReimportPaths(UObject* Obj, const TArray<FString>& NewReimportPaths) override;
	virtual EReimportResult::Type Reimport(UObject* Obj) override;
	virtual int32 GetPriority() const override;

private:
	void BroadcastPostImport(UPatterBundle* Bundle);
};
