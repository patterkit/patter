// A compiled .patterc imported as a UObject asset. Holds the bundle JSON (serialised into
// the asset) and a parsed patter::Bundle (Pimpl - the engine's std model stays out of UE
// headers). Create() a UPatterEngine on it to play.
#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "Templates/PimplPtr.h"
#include "PatterBundle.generated.h"

namespace patter { struct Bundle; }

UCLASS(BlueprintType)
class PATTERPLAYRUNTIME_API UPatterBundle : public UObject
{
	GENERATED_BODY()

public:
	// The compiled .patterc JSON (serialised into the asset; re-parsed on load).
	UPROPERTY()
	FString Json;

	// Why the most recent Parse() failed, persisted so a BROKEN bundle still imports and carries its
	// own diagnosis in the details panel, instead of importing as an asset that silently does nothing.
	// Empty when the parse was clean.
	UPROPERTY()
	FString LoadError;

	// Parse a transient bundle from a JSON string. Returns nullptr (and logs) on a parse error.
	UFUNCTION(BlueprintCallable, Category = "Patterplay")
	static UPatterBundle* LoadFromString(const FString& InJson);

	// (Re)parse Json into the cached patter::Bundle. Called by the importer and PostLoad.
	bool Parse();

	virtual void PostLoad() override;

	// The parsed bundle (engine-side); valid after a successful Parse(). May be null.
	const patter::Bundle* Raw() const { return Bundle.Get(); }

private:
	TPimplPtr<patter::Bundle> Bundle;
};
