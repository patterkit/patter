// A small UMG example for the Patter Runner component: one line at a time, a Continue button that calls
// Next, and a button per option that calls Choose. Built in C++ (the widget tree is constructed in
// RebuildWidget, so no Widget Blueprint is needed) and bound to the runner's events. Sample code for this
// demo: the runner itself has no UI, and a game shows its beats however it likes. TourDemoActor uses it
// when bUseUmgExample is on.
//
//   UTourRunnerWidget* Widget = CreateWidget<UTourRunnerWidget>(PlayerController);
//   Widget->AddToViewport();
//   Widget->Bind(Runner);   // then Runner->Begin()

#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "Components/Button.h"
#include "PatterTypes.h"
#include "TourRunnerWidget.generated.h"

class UPatterRunnerComponent;
class UTextBlock;
class UVerticalBox;

// A button that chooses one option: UButton's click carries nothing, so the option rides on the button.
UCLASS()
class PATTERPLAYDEMO_API UTourChoiceButton : public UButton
{
	GENERATED_BODY()

public:
	void Offer(UPatterRunnerComponent* InRunner, const FString& InOptionId);

private:
	UFUNCTION()
	void HandleClicked();

	UPROPERTY()
	TObjectPtr<UPatterRunnerComponent> Runner = nullptr;

	FString OptionId;
};

UCLASS()
class PATTERPLAYDEMO_API UTourRunnerWidget : public UUserWidget
{
	GENERATED_BODY()

public:
	// Listen to a runner's events. Call before Begin, so the first beat is shown.
	void Bind(UPatterRunnerComponent* InRunner);

protected:
	virtual TSharedRef<SWidget> RebuildWidget() override;

private:
	UFUNCTION()
	void HandleBeat(const FPatterStep& Step);

	UFUNCTION()
	void HandleChoice(const FString& GroupId, const TArray<FPatterOption>& Options);

	UFUNCTION()
	void HandleEnded(EPatterFlowEndReason Reason);

	UFUNCTION()
	void HandleContinue();

	void Show(const FString& Speaker, const FString& Text);

	UPROPERTY()
	TObjectPtr<UPatterRunnerComponent> Runner = nullptr;

	UPROPERTY()
	TObjectPtr<UTextBlock> SpeakerText = nullptr;

	UPROPERTY()
	TObjectPtr<UTextBlock> LineText = nullptr;

	UPROPERTY()
	TObjectPtr<UButton> ContinueButton = nullptr;

	UPROPERTY()
	TObjectPtr<UVerticalBox> ChoiceList = nullptr;
};
