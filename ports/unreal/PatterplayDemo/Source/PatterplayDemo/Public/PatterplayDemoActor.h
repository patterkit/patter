// Patterplay Unreal demo: assign a compiled .patterc (UPatterBundle) and on BeginPlay it
// plays the flow, logging each step. The shared API demo, in Unreal.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "PatterplayDemoActor.generated.h"

class UPatterBundle;

UCLASS()
class PATTERPLAYDEMO_API APatterplayDemoActor : public AActor
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Patterplay")
	TObjectPtr<UPatterBundle> Bundle = nullptr;

protected:
	virtual void BeginPlay() override;
};
