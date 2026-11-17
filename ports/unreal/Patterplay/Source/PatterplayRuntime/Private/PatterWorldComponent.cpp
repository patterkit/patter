#include "PatterWorldComponent.h"
#include "PatterWorld.h"
#include "GameFramework/Actor.h"

UPatterWorldComponent::UPatterWorldComponent()
{
	PrimaryComponentTick.bCanEverTick = false;
}

UPatterWorld* UPatterWorldComponent::GetPatterWorld()
{
	// Lazy, so there's no ordering to get right: whoever asks first makes it, and everyone after gets the
	// same object. Outered to the component, so it lives as long as the component does.
	if (!PatterWorld) PatterWorld = NewObject<UPatterWorld>(this);
	return PatterWorld;
}

UPatterWorld* UPatterWorldComponent::FindPatterWorld(AActor* Actor)
{
	if (!Actor) return nullptr;
	UPatterWorldComponent* Component = Actor->FindComponentByClass<UPatterWorldComponent>();
	return Component ? Component->GetPatterWorld() : nullptr;
}
