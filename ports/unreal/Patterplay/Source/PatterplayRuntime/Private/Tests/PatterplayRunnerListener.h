// A test-only listener for UPatterRunnerComponent's events, written down as kind:id the way the JS runner
// test writes them. A dynamic delegate binds only a UFUNCTION on a UObject, and a UCLASS must live in a
// header for UHT to see it, so the Patterplay.Runner automation test binds this the way a Blueprint binds
// the events. Like PatterplayErrorsListener, it compiles into this repo's builds and the release zip leaves
// it out (Private/Tests).
#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "PatterTypes.h"
#include "PatterRunnerComponent.h"
#include "PatterplayRunnerListener.generated.h"

UCLASS(Transient, NotBlueprintable, HideDropdown)
class UPatterplayRunnerListener : public UObject
{
	GENERATED_BODY()

public:
	/** Every event the runner raised, in order, as kind:id. */
	TArray<FString> Seen;

	/** The last line's speaker label and text, as "label: text". */
	FString LastSpeech;

	/** Each beat's handler calls Next itself. */
	bool bNextOnBeat = false;

	/** A line's handler asks for Next, then Stop. */
	bool bStopAfterLine = false;

	/** Not empty: the choice's handler chooses this option. */
	FString ChooseOnChoice;

	/** How deep the handlers nest: 1 when a handler's own Next never re-enters one. */
	int32 Depth = 0;
	int32 Deepest = 0;

	void Listen(UPatterRunnerComponent* InRunner)
	{
		Runner = InRunner;
		Runner->OnLine.AddDynamic(this, &UPatterplayRunnerListener::HandleLine);
		Runner->OnText.AddDynamic(this, &UPatterplayRunnerListener::HandleText);
		Runner->OnGameEvent.AddDynamic(this, &UPatterplayRunnerListener::HandleGameEvent);
		Runner->OnChoice.AddDynamic(this, &UPatterplayRunnerListener::HandleChoice);
		Runner->OnEnded.AddDynamic(this, &UPatterplayRunnerListener::HandleEnded);
	}

	FString Last() const { return Seen.Num() > 0 ? Seen.Last() : FString(); }

	UFUNCTION()
	void HandleLine(const FPatterStep& Step)
	{
		LastSpeech = Step.SpeakerLabel + TEXT(": ") + Step.Text;
		Beat(TEXT("line:"), Step);
		if (bStopAfterLine) { Runner->Next(); Runner->Stop(); }
	}

	UFUNCTION()
	void HandleText(const FPatterStep& Step) { Beat(TEXT("text:"), Step); }

	UFUNCTION()
	void HandleGameEvent(const FPatterStep& Step) { Beat(TEXT("gameEvent:"), Step); }

	UFUNCTION()
	void HandleChoice(const FString& GroupId, const TArray<FPatterOption>& Options)
	{
		TArray<FString> Ids;
		for (const FPatterOption& Option : Options) Ids.Add(Option.Id);
		Seen.Add(TEXT("choice:") + FString::Join(Ids, TEXT(",")));
		if (!ChooseOnChoice.IsEmpty()) Runner->Choose(ChooseOnChoice);
	}

	UFUNCTION()
	void HandleEnded(EPatterEndReason Reason)
	{
		// As the JS runner test writes it: "ended", or "ended:ran-dry".
		Seen.Add(Reason == EPatterEndReason::RanDry ? TEXT("ended:ran-dry") : TEXT("ended"));
	}

private:
	UPatterRunnerComponent* Runner = nullptr;

	void Beat(const TCHAR* Kind, const FPatterStep& Step)
	{
		++Depth;
		Deepest = FMath::Max(Deepest, Depth);
		Seen.Add(Kind + Step.Id);
		if (bNextOnBeat) Runner->Next();
		--Depth;
	}
};
