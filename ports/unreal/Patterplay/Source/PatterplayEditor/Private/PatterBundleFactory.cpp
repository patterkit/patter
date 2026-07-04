#include "PatterBundleFactory.h"
#include "PatterBundle.h"

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
	const FString Json(static_cast<int32>(BufferEnd - Buffer), Buffer);

	UPatterBundle* Bundle = NewObject<UPatterBundle>(InParent, InClass, InName, Flags);
	Bundle->Json = Json;
	if (!Bundle->Parse())
	{
		UE_LOG(LogTemp, Error, TEXT("Patterplay: '%s' is not a valid .patterc bundle."), *InName.ToString());
	}
	return Bundle;
}
