// The sample project's default game mode (wired in Config/DefaultEngine.ini): pressing Play in
// ANY level spawns one ATourDemoActor, so the demo needs no setup at all - open the project,
// press Play, click the choices. A level that already holds a TourDemoActor keeps its own.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "TourDemoGameMode.generated.h"

UCLASS()
class PATTERPLAYDEMO_API ATourDemoGameMode : public AGameModeBase
{
	GENERATED_BODY()

protected:
	virtual void BeginPlay() override;
};
