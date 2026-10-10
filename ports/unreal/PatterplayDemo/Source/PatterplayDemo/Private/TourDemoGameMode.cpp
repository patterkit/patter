#include "TourDemoGameMode.h"
#include "TourDemoActor.h"
#include "EngineUtils.h"

void ATourDemoGameMode::BeginPlay()
{
	Super::BeginPlay();
	if (TActorIterator<ATourDemoActor>(GetWorld()))
		return; // the level already carries one (placed by hand) - use that
	GetWorld()->SpawnActor<ATourDemoActor>();
}
