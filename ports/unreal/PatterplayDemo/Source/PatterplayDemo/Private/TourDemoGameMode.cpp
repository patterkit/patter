#include "TourDemoGameMode.h"
#include "TourDemoActor.h"
#include "EngineUtils.h"

void ATourDemoGameMode::BeginPlay()
{
	Super::BeginPlay();
	for (TActorIterator<ATourDemoActor> It(GetWorld()); It; ++It)
		return; // the level already carries one (placed by hand) - use that
	GetWorld()->SpawnActor<ATourDemoActor>();
}
