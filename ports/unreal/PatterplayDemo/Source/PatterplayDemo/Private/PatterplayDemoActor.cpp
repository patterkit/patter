#include "PatterplayDemoActor.h"
#include "PatterEngine.h"
#include "PatterBundle.h"

void APatterplayDemoActor::BeginPlay()
{
	Super::BeginPlay();

	if (!Bundle)
	{
		UE_LOG(LogTemp, Warning, TEXT("PatterplayDemo: assign a .patterc Bundle to play."));
		return;
	}

	UPatterEngine* Engine = UPatterEngine::Create(Bundle);
	if (!Engine) return;
	UPatterFlow* Flow = Engine->OpenFlow(TEXT("main"), TEXT("demo"));
	if (!Flow) return;

	for (int32 i = 0; i < 100; ++i)
	{
		FPatterStep Step = Flow->Advance();
		switch (Step.Type)
		{
			case EPatterStepType::Line:
			{
				const FString& Speaker = Step.CharacterName.IsEmpty() ? Step.Character : Step.CharacterName;
				UE_LOG(LogTemp, Display, TEXT("%s: %s"), *Speaker, *Step.Text);
				break;
			}
			case EPatterStepType::Text:
				UE_LOG(LogTemp, Display, TEXT("%s"), *Step.Text);
				break;
			case EPatterStepType::Choice:
				if (Step.Options.Num() > 0)
				{
					UE_LOG(LogTemp, Display, TEXT("> %s"), *Step.Options[0].Text);
					Flow->Choose(Step.Options[0].Id);
				}
				break;
			case EPatterStepType::End:
				UE_LOG(LogTemp, Display, TEXT("[end]  @gold = %g"), Engine->GetPropertyNumber(TEXT("@gold")));
				return;
			default:
				break;
		}
	}
}
