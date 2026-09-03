// The GAME's @world container, bound to an engine at UPatterEngine::Create.
//
// @world is the game's state, not the story's: the engine reads and writes it through the host and
// never carries it in a save (play/world-properties). Without one the engine self-backs @world from
// the declared defaults, which is fine for a run that never leaves the engine; bind one when the
// game, the story and anything else (the Storylet Engine's UStoryletWorld, say) share values.
//
// Two read-only ideas meet here and stay distinct. A `writable: false` DECLARATION is the story's
// promise, checked by the compiler and refused by the engine whether or not a world is bound.
// SetReadOnly here is the GAME's policy: a name the story may read but this game will not let it
// write, refused with an error the wrapper's guarded calls turn into a failed step and a log line,
// never a crash. The host's own Set* calls are bound by neither.
//
// Same shape as the Storylet Engine's UStoryletWorld (typed Set*/Get*, Names, SetReadOnly, an
// OnChanged that tells host writes from story writes), so a project running both reads one API
// (from-storylets/unreal-wrapper-host-scopes, 2026-09-03).
#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "Templates/PimplPtr.h"
#include "PatterTypes.h"

#include <string>

#include "PatterWorld.generated.h"

namespace patter { struct HostScope; struct PatterValue; }
struct FPatterWorldImpl;

/** Fired on every change to a bound world: the host's own writes (bFromStory false) and the story's
 *  effect writes (true). */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FPatterWorldChanged,
	const FString&, Name, const FPatterValue&, Value, bool, bFromStory);

UCLASS(BlueprintType)
class PATTERPLAYRUNTIME_API UPatterWorld : public UObject
{
	GENERATED_BODY()

public:
	UPatterWorld();

	// --- the host's writes (never refused) ---------------------------------------

	UFUNCTION(BlueprintCallable, Category = "Patterplay|World")
	void SetBool(const FString& Name, bool bValue);
	UFUNCTION(BlueprintCallable, Category = "Patterplay|World")
	void SetNumber(const FString& Name, double Value);
	UFUNCTION(BlueprintCallable, Category = "Patterplay|World")
	void SetString(const FString& Name, const FString& Value);
	UFUNCTION(BlueprintCallable, Category = "Patterplay|World")
	void SetFlags(const FString& Name, const TArray<FString>& Values);

	// --- reads (the type's default when the name is unset) ----------------------

	UFUNCTION(BlueprintCallable, Category = "Patterplay|World")
	bool Has(const FString& Name) const;
	UFUNCTION(BlueprintCallable, Category = "Patterplay|World")
	bool GetValue(const FString& Name, FPatterValue& OutValue) const;
	UFUNCTION(BlueprintCallable, Category = "Patterplay|World")
	bool GetBool(const FString& Name) const;
	UFUNCTION(BlueprintCallable, Category = "Patterplay|World")
	double GetNumber(const FString& Name) const;
	UFUNCTION(BlueprintCallable, Category = "Patterplay|World")
	FString GetString(const FString& Name) const;
	UFUNCTION(BlueprintCallable, Category = "Patterplay|World")
	TArray<FString> GetFlags(const FString& Name) const;
	/** Every name with a value, in first-set order, as first written (names match case-insensitively). */
	UFUNCTION(BlueprintCallable, Category = "Patterplay|World")
	TArray<FString> Names() const;

	// --- the game's policy ---------------------------------------------------------

	/** Refuse story writes to this name (the game's alone: a clock, a flag the story only reads).
	 *  The host's own writes still land. */
	UFUNCTION(BlueprintCallable, Category = "Patterplay|World")
	void SetReadOnly(const FString& Name, bool bReadOnly);
	UFUNCTION(BlueprintCallable, Category = "Patterplay|World")
	bool IsReadOnly(const FString& Name) const;

	UPROPERTY(BlueprintAssignable, Category = "Patterplay|World")
	FPatterWorldChanged OnChanged;

	// --- C++ seam (Blueprint never sees these) ------------------------------------

	/** The host scope handed to the core; weak on this object, so a world the game dropped reads as
	 *  unset rather than dangling. The core's `get` pointer stays valid until the next call, which a
	 *  slot inside this object guarantees. */
	patter::HostScope MakeHostScope();
	/** A read in core terms; false when unset. */
	bool Get(const std::string& Name, patter::PatterValue& OutValue) const;
	/** The host's write in core terms (never refused; fires OnChanged with bFromStory false). */
	void HostSet(const std::string& Name, const patter::PatterValue& Value);
	/** The story's write: throws patter::EvalError when the name is read-only here; otherwise lands
	 *  and fires OnChanged (bFromStory true). */
	void StorySet(const std::string& Name, const patter::PatterValue& Value);

private:
	TPimplPtr<FPatterWorldImpl> Impl;
};
