// Imports a compiled .patterc file into a UPatterBundle asset.
#pragma once

#include "CoreMinimal.h"
#include "Factories/Factory.h"
#include "PatterBundleFactory.generated.h"

UCLASS()
class UPatterBundleFactory : public UFactory
{
	GENERATED_BODY()

public:
	UPatterBundleFactory();

	virtual UObject* FactoryCreateText(UClass* InClass, UObject* InParent, FName InName, EObjectFlags Flags,
		UObject* Context, const TCHAR* Type, const TCHAR*& Buffer, const TCHAR* BufferEnd, FFeedbackContext* Warn) override;
};
