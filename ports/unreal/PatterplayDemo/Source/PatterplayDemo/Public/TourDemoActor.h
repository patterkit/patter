// The Unreal tour demo: play the interactive Patter tour with a real UI. A Slate overlay shows
// the transcript in reading order and the player CLICKS the choices - an actual playthrough,
// not a table read. Non-choice beats auto-advance on a timer (a voiced line holds for its take).
//
// It needs no setup: the TourDemoGameMode (this project's default game mode) spawns one on Play,
// and with no Bundle asset assigned it loads Demos/tour.patterc straight from disk
// (UPatterBundle::LoadFromString), so pressing Play in a fresh checkout/unzip just works.
// You can also place the actor in your own level and assign an imported bundle instead.
//
// Audio files are NOT bundled (playback is your platform call); point AudioRoot at any Patter
// audio folder to hear each line's winning take via the patteraudio.json resolver (UPatterAudio).
// Inside the PatterKit repo the shared scratch takes are picked up automatically.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "TourDemoActor.generated.h"

class UPatterBundle;
class UPatterEngine;
class UPatterFlow;
class UPatterAudio;
class UAudioComponent;
class SScrollBox;
class SVerticalBox;
class SWidget;

UCLASS()
class PATTERPLAYDEMO_API ATourDemoActor : public AActor
{
	GENERATED_BODY()

public:
	ATourDemoActor();

	// Optional: an imported tour.patterc (a UPatterBundle asset). Empty = load BundleFile from disk.
	UPROPERTY(EditAnywhere, Category = "Patterplay")
	UPatterBundle* Bundle = nullptr;

	// The .patterc to load when no Bundle asset is assigned. Relative to the project directory.
	UPROPERTY(EditAnywhere, Category = "Patterplay")
	FString BundleFile = TEXT("Demos/tour.patterc");

	// Optional: a Patter audio folder (holds patteraudio.json + takes). Absolute, or relative to
	// the project directory. Empty = try the PatterKit repo's shared takes, else play silently.
	UPROPERTY(EditAnywhere, Category = "Patterplay")
	FString AudioRoot;

	// Play each line's winning take as it steps.
	UPROPERTY(EditAnywhere, Category = "Patterplay")
	bool bPlayAudio = true;

	// Seconds between auto-advanced beats (a voiced line waits for its clip instead).
	UPROPERTY(EditAnywhere, Category = "Patterplay", meta = (ClampMin = "0.1"))
	float StepDelay = 0.8f;

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;

private:
	void BuildUi();
	void StartTour();                    // fresh engine + flow, clear the transcript, step
	void Step();                         // advance once; queue the next step (or wait at a choice)
	void OnChoose(const FString& OptionId, const FString& OptionText);
	void AddLine(const FString& Speaker, const FString& Text, const FLinearColor& Colour);
	void ShowChoices(const struct FPatterStep& S);
	void ClearChoices();
	// Fire the beat's winning take, if the manifest resolves one; returns its duration (0 = none).
	float PlayClip(const FString& BeatId);

	UPROPERTY() UPatterBundle* LoadedBundle = nullptr;   // keeps a disk-loaded bundle alive
	UPROPERTY() UPatterEngine* Engine = nullptr;
	UPROPERTY() UPatterFlow* Flow = nullptr;
	UPROPERTY() UPatterAudio* Audio = nullptr;
	UPROPERTY() UAudioComponent* Voice = nullptr;

	TSharedPtr<SWidget> RootWidget;
	TSharedPtr<SScrollBox> Transcript;
	TSharedPtr<SVerticalBox> ChoiceBox;
	FTimerHandle StepTimer;
};
