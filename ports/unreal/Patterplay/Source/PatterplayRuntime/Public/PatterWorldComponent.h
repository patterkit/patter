// The game's @world as a component you add in the editor (shown as "Patter World"): it owns one
// UPatterWorld, the container a story's @world reads and writes, so an actor in the level can hold the
// game's state and anything that makes an engine can find it there instead of being handed it in code.
//
//   UPatterWorld* World = UPatterWorldComponent::FindPatterWorld(GameStateActor);
//   World->SetBool(TEXT("has_key"), true);                                // the game fills it
//   UPatterEngine* Engine = UPatterEngine::CreateWithWorld(Bundle, World); // bound as "world"
//
// The world is made the first time anyone asks for it (GetPatterWorld), not at BeginPlay, so the game's
// Blueprint and a director that makes its engine in its own BeginPlay get the same object, whichever runs
// first. It's never saved with the level: the values are the game's, saved by the game, as for any bound
// container (play/world-properties).
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "PatterWorldComponent.generated.h"

class AActor;
class UPatterWorld;

UCLASS(ClassGroup = "Patterplay", Blueprintable, meta = (BlueprintSpawnableComponent, DisplayName = "Patter World"))
class PATTERPLAYRUNTIME_API UPatterWorldComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UPatterWorldComponent();

	// This component's world, made on the first call and the same object on every call after. Bind it with
	// UPatterEngine::CreateWithWorld, or under "world" in Create's HostScopes. (Not GetWorld: that's the
	// level the component is in.)
	UFUNCTION(BlueprintPure, Category = "Patterplay|World")
	UPatterWorld* GetPatterWorld();

	// The world of the first Patter World component on Actor, or null when Actor is null or has none. For a
	// component that makes an engine and wants the World on its own actor, or on one named in its Details.
	UFUNCTION(BlueprintPure, Category = "Patterplay|World")
	static UPatterWorld* FindPatterWorld(AActor* Actor);

private:
	// Made lazily by GetPatterWorld; Transient, as the values are the game's to save.
	UPROPERTY(Transient)
	TObjectPtr<UPatterWorld> PatterWorld;
};
