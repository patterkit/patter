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
		// Kept on the asset as well as logged: the details panel shows it, so a bad export is
		// diagnosed where somebody is looking rather than in a log they have to think to open.
		LoadError = Error;
		return false;
	}
	LoadError.Empty();
	Bundle = MoveTemp(NewBundle);
	return true;
}

void UPatterBundle::PostLoad()
{
	Super::PostLoad();
	if (!Json.IsEmpty()) Parse();
}
