// The thin runner as a component (shown as "Patter Runner"): the flow API turned from pull to push, for
// straightforward games. Start a conversation, and the runner hands each beat to the game as an event; the
// game shows it however it likes and calls Next when it's ready. A choice waits for Choose. Nothing else:
// no timing, no auto-advance, no UI, no audio. OnLine carries the step with its beat id, so a game plays
// the recording however it likes (UPatterAudioResolver resolves it, if you want it). The same runner as
// the std core's patter::Runner (Patter/Runner.h) and every other Patterplay runtime's.
//
//   Runner->SetEngine(Engine, TEXT("main"));
//   Runner->OnLine.AddDynamic(this, &AMyActor::ShowLine);        // then Runner->Next() on each click
//   Runner->OnChoice.AddDynamic(this, &AMyActor::OfferChoice);   // then Runner->Choose(OptionId)
//   Runner->OnEnded.AddDynamic(this, &AMyActor::CloseDialogue);
//   Runner->Begin();                                              // the project's start scene
//
// A fuller dialogue manager for more complex games, Patterstage, is coming.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "PatterTypes.h"
#include "PatterRunnerComponent.generated.h"

class UPatterEngine;
class UPatterFlow;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FPatterRunnerStepEvent, const FPatterStep&, Step);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FPatterRunnerChoiceEvent, const FString&, GroupId, const TArray<FPatterOption>&, Options);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FPatterRunnerEndedEvent);

// Plays one flow, a beat at a time, as events. Every delivered beat (a line, a text or a game event) waits
// for Next; a choice waits for Choose. Handlers may call Next or Choose themselves: the runner finishes the
// event it is delivering first, so a long run never deepens the stack.
//
// The runner keeps no state a save needs: the engine's save and load stay the one way to save. After a
// load, call Next to carry on. A hot swap on the same UPatterEngine (HotSwap, ApplyLiveBundle) needs
// nothing; a game that builds a new UPatterEngine hands it to Rebind.
//
// Blueprint can't catch what the core throws, so Begin, Next and Choose return why they were refused ("" when
// they weren't), keep it in GetLastError, and log it to LogPatterplay.
UCLASS(ClassGroup = "Patterplay", meta = (BlueprintSpawnableComponent, DisplayName = "Patter Runner"))
class PATTERPLAYRUNTIME_API UPatterRunnerComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UPatterRunnerComponent();

	// The id of the flow the runner plays, opened on the first Begin.
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Patterplay")
	FString FlowId = TEXT("main");

	// A line beat: the step, with its beat id, speaker and text. Call Next when the game is ready for more.
	UPROPERTY(BlueprintAssignable, Category = "Patterplay")
	FPatterRunnerStepEvent OnLine;

	// A text beat (narration, or action for whoever stages the scene). Call Next to go on.
	UPROPERTY(BlueprintAssignable, Category = "Patterplay")
	FPatterRunnerStepEvent OnText;

	// A game-event beat: its cue rides on the step's Game Data. Call Next to go on.
	UPROPERTY(BlueprintAssignable, Category = "Patterplay")
	FPatterRunnerStepEvent OnGameEvent;

	// A choice: its group and options. Call Choose with an eligible option's id.
	UPROPERTY(BlueprintAssignable, Category = "Patterplay")
	FPatterRunnerChoiceEvent OnChoice;

	// The flow has ended. Begin begins again.
	UPROPERTY(BlueprintAssignable, Category = "Patterplay")
	FPatterRunnerEndedEvent OnEnded;

	// The engine to play on and the flow's id. Changes nothing in the engine: the flow opens on Start.
	UFUNCTION(BlueprintCallable, Category = "Patterplay")
	void SetEngine(UPatterEngine* InEngine, const FString& InFlowId = TEXT("main"));

	UFUNCTION(BlueprintPure, Category = "Patterplay")
	UPatterEngine* GetEngine() const { return Engine; }

	// The flow the runner plays, looked up by id each time, or null before the first Begin.
	UFUNCTION(BlueprintCallable, Category = "Patterplay")
	UPatterFlow* GetFlow() const;

	// Start a conversation at a scene (and block), and deliver its first beat. The first Begin opens the flow.
	// A later one moves the same flow there, as an authored jump does, so visit counts, variations and the
	// flow's own properties carry on through the playthrough. With no scene, the story starts from the
	// beginning, at the project's start scene: the first time opens the flow there, and a later time resets
	// it, forgetting the flow's own state, as a new game does. An address that doesn't resolve is refused
	// before anything changes.
	UFUNCTION(BlueprintCallable, Category = "Patterplay", meta = (AdvancedDisplay = "Block", ReturnDisplayName = "Refusal"))
	FString Begin(const FString& Scene = TEXT(""), const FString& Block = TEXT(""));

	// Deliver the next beat, the pending choice, or the end. Refused before the first Begin.
	UFUNCTION(BlueprintCallable, Category = "Patterplay", meta = (ReturnDisplayName = "Refusal"))
	FString Next();

	// Pick an option of the pending choice, then deliver what it leads to. Refused as the flow's Choose is
	// (no choice pending, an unknown option, or one that isn't eligible), and before the first Begin.
	UFUNCTION(BlueprintCallable, Category = "Patterplay", meta = (ReturnDisplayName = "Refusal"))
	FString Choose(const FString& OptionId);

	// Stop delivering: any Next a handler asked for is dropped, and nothing more is delivered until the game
	// asks. The flow stays where it is, open and saveable, and OnEnded isn't raised; Next carries on from
	// there and Begin begins elsewhere.
	UFUNCTION(BlueprintCallable, Category = "Patterplay")
	void Stop();

	// Play on a replacement engine, under the same flow id.
	UFUNCTION(BlueprintCallable, Category = "Patterplay")
	void Rebind(UPatterEngine* NewEngine);

	// Why the last Begin, Next or Choose was refused; empty when it wasn't.
	UFUNCTION(BlueprintPure, Category = "Patterplay")
	FString GetLastError() const { return LastError; }

private:
	UPROPERTY(Transient)
	TObjectPtr<UPatterEngine> Engine = nullptr;

	FString LastError;

	// Next calls asked for while an event was being delivered, played once it returns.
	int32 Queued = 0;
	bool bDelivering = false;

	// A refusal: kept in LastError, logged unless the engine's or flow's wrapper already logged it, and returned.
	FString Refuse(const FString& Message, bool bLogged = false);
	void Deliver(const FPatterStep& Step);
};
