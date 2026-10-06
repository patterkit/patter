// A test-only listener for UPatterEngine::OnError. A dynamic delegate binds only a UFUNCTION on a UObject
// (there is no AddLambda for one), and a UCLASS must live in a header for UHT to see it, so the
// Patterplay.Errors automation test binds this the way a Blueprint binds the event. Transient, hidden,
// and not Blueprintable: nothing outside the test can make or pick one. UHT cannot guard a UCLASS with
// WITH_DEV_AUTOMATION_TESTS, so it compiles into every configuration of THIS repo's builds; the release
// zip leaves out Private/Tests (play-unreal.yml), so it never reaches a game that installs the plugin.
#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "PatterTypes.h"
#include "PatterplayErrorsListener.generated.h"

UCLASS(Transient, NotBlueprintable, HideDropdown)
class UPatterplayErrorsListener : public UObject
{
	GENERATED_BODY()

public:
	/** Every error the bound engine reported, in order. */
	TArray<FPatterPlayError> Errors;

	UFUNCTION()
	void HandleError(const FPatterPlayError& Error) { Errors.Add(Error); }
};
