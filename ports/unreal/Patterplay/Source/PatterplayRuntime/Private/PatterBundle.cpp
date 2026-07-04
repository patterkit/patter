#include "PatterBundle.h"
#include "PatterBundleLoader.h"
#include "Patter/Bundle.h"
#include "UObject/Package.h" // GetTransientPackage() - not transitively available in the Game target

UPatterBundle* UPatterBundle::LoadFromString(const FString& InJson)
{
	UPatterBundle* B = NewObject<UPatterBundle>(GetTransientPackage());
	B->Json = InJson;
	return B->Parse() ? B : nullptr;
}

bool UPatterBundle::Parse()
{
	TPimplPtr<patter::Bundle> NewBundle = MakePimpl<patter::Bundle>();
	FString Error;
	if (!PatterLoadBundle(Json, *NewBundle, Error))
	{
		UE_LOG(LogTemp, Error, TEXT("Patterplay: failed to parse bundle - %s"), *Error);
		return false;
	}
	Bundle = MoveTemp(NewBundle);
	return true;
}

void UPatterBundle::PostLoad()
{
	Super::PostLoad();
	if (!Json.IsEmpty()) Parse();
}
