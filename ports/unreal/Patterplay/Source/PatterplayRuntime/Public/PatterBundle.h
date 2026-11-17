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

#if WITH_EDITORONLY_DATA
	// The .patterc it was imported from, as a Sound Wave keeps its source: after an editor restart the
	// asset still knows its file, and Reimport works from the Content Browser.
	UPROPERTY(VisibleAnywhere, Instanced, Category = "ImportSource")
	TObjectPtr<class UAssetImportData> AssetImportData;
#endif

	// Parse a transient bundle from a JSON string. Returns nullptr (and logs) on a parse error.
	UFUNCTION(BlueprintCallable, Category = "Patterplay")
	static UPatterBundle* LoadFromString(const FString& InJson);

	// True when the story declares @world (the bundle's scope registry has a scope with the token "world",
	// matched case-sensitively, as binding is): it then has game state to read, and an engine made with no
	// World bound plays @world from its declared defaults. For a component that makes an engine from a
	// bundle set in Details, to warn when its World is empty. False for a bundle that isn't parsed.
	UFUNCTION(BlueprintPure, Category = "Patterplay")
	bool DeclaresWorld() const;

	// (Re)parse Json into the cached patter::Bundle. Called by the importer and PostLoad.
	bool Parse();

	virtual void PostLoad() override;
	virtual void PostInitProperties() override;

	// The parsed bundle (engine-side); valid after a successful Parse(). May be null.
	const patter::Bundle* Raw() const { return Bundle.Get(); }

private:
	TPimplPtr<patter::Bundle> Bundle;
};
