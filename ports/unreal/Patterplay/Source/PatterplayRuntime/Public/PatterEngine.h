// Blueprint/C++ API over the engine: UPatterEngine wraps patter::Engine, UPatterFlow wraps
// a patter::Flow (owned by the engine). The std engine objects are held via Pimpl pointers.
#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "Templates/PimplPtr.h"
#include "PatterTypes.h"
#include "PatterStructure.h"
#include "PatterEngine.generated.h"

class UPatterBundle;
class UPatterEngine;
namespace patter { class Engine; class Flow; }

UCLASS(BlueprintType)
class PATTERPLAYRUNTIME_API UPatterFlow : public UObject
{
	GENERATED_BODY()

public:
	// Run until the next line / text / gameEvent / choice / end.
	UFUNCTION(BlueprintCallable, Category = "Patterplay")
	FPatterStep Advance();

	// Pick an eligible option by id; the next Advance() runs it.
	UFUNCTION(BlueprintCallable, Category = "Patterplay")
	void Choose(const FString& OptionId);

	UFUNCTION(BlueprintPure, Category = "Patterplay")
	bool IsEnded() const;

	// The flow's current scene id ("" before it enters one). Pass it to FPatterDebugLink::Observe.
	UFUNCTION(BlueprintPure, Category = "Patterplay")
	FString CurrentScene() const;

	// Advance repeatedly, collecting every beat played, until a choice or the end. The terminal
	// choice / end is returned in OutStop; the return value is what played on the way to it.
	UFUNCTION(BlueprintCallable, Category = "Patterplay")
	TArray<FPatterStep> AdvanceToStop(FPatterStep& OutStop);

	// Send this flow's cursor to an ADDRESS, exactly as an authored `go` jump would: the target scene's
	// onEntry runs, entering counts as a visit, and the callstack is REPLACED (pending call-returns
	// discarded). Scene/Block are host-facing Game IDs (or internal ids); Block is scene-scoped, so it is
	// looked up inside Scene. "END" ends the flow. HOST navigation, so it lands IMMEDIATELY: any beats
	// left in the snippet being delivered are abandoned, and a pending choice is dropped. An unstarted
	// flow starts here; an ended one resumes. Returns false - cursor untouched - if the address does not
	// resolve. It MOVES the cursor; it never resets the flow's state.
	UFUNCTION(BlueprintCallable, Category = "Patterplay")
	bool Goto(const FString& Scene, const FString& Block);

	// True once the engine has closed this flow (closed, dropped by Reset, or replaced by name). A closed
	// flow is inert: Advance reports the end and Goto refuses.
	UFUNCTION(BlueprintPure, Category = "Patterplay")
	bool IsClosed() const;

	void Init(UPatterEngine* InOwner, const FString& InId, patter::Flow* InFlow);
	// Live bundle refresh: point this wrapper at the flow of the SAME id inside a swapped engine
	// (nullptr when the flow did not survive - the wrapper then no-ops).
	void Rebind(patter::Flow* InFlow) { Flow = InFlow; }
	const FString& GetFlowId() const { return Id; }

private:
	UPROPERTY()
	TObjectPtr<UPatterEngine> Owner = nullptr;

	FString Id;                   // the flow's id, for re-binding after a hot swap
	patter::Flow* Flow = nullptr; // owned by the engine
};

UCLASS(BlueprintType)
class PATTERPLAYRUNTIME_API UPatterEngine : public UObject
{
	GENERATED_BODY()

public:
	// Construct a play-ready engine on a (parsed) bundle. Returns nullptr (and logs) on error.
	UFUNCTION(BlueprintCallable, Category = "Patterplay")
	static UPatterEngine* Create(UPatterBundle* Bundle);

	// Open (and start) a named flow at a scene (its id or gameId; empty = the first scene).
	UFUNCTION(BlueprintCallable, Category = "Patterplay")
	UPatterFlow* OpenFlow(const FString& Id, const FString& Scene);

	// "Play this address and give me everything it produced" - the one-call bark form. The NAMED flow is
	// reused if it already exists (moved with Goto) and opened at the address if not, then run to its next
	// stop. Reuse is the point: a flow owns its selector cursors, so a shuffle keeps its bag and a
	// "once each" list keeps its place from call to call. An empty array means the address had nothing
	// left to give. Contrast OpenFlow, which REPLACES a flow of the same name and so resets that state.
	UFUNCTION(BlueprintCallable, Category = "Patterplay")
	TArray<FPatterStep> RunFlow(const FString& FlowName, const FString& Scene, const FString& Block);

	UFUNCTION(BlueprintPure, Category = "Patterplay")
	float GetPropertyNumber(const FString& Ref) const;

	UFUNCTION(BlueprintPure, Category = "Patterplay")
	FString GetPropertyString(const FString& Ref) const;

	UFUNCTION(BlueprintPure, Category = "Patterplay")
	bool GetPropertyBool(const FString& Ref) const;

	UFUNCTION(BlueprintCallable, Category = "Patterplay")
	void SetPropertyNumber(const FString& Ref, float Value);

	UFUNCTION(BlueprintCallable, Category = "Patterplay")
	void SetPropertyBool(const FString& Ref, bool bValue);

	UFUNCTION(BlueprintCallable, Category = "Patterplay")
	void SetPropertyString(const FString& Ref, const FString& Value);

	// The compiled bundle's build hash (content.hash). Pass it to FPatterDebugLink so Patterpad's live
	// link can tell whether the running game matches the currently open project (in-sync vs stale).
	UFUNCTION(BlueprintPure, Category = "Patterplay")
	FString GetBuildId() const;

	// Live bundle refresh (editor pushes over the live link, or any bundle you loaded yourself).
	// Applies IN PLACE - this engine object and every UPatterFlow handle stay valid:
	//   - same structureHash  -> tier 1: the string tables swap, nothing else is touched ("text").
	//   - changed structure   -> tier 2: the whole run carries across via save/load, content drift
	//     resolved per the shared corpus rules; flow wrappers re-bind by id ("structure").
	// Returns "text" / "structure", or "error" when the new bundle is null/unparsed (engine untouched).
	UFUNCTION(BlueprintCallable, Category = "Patterplay|LiveLink")
	FString ApplyLiveBundle(UPatterBundle* NewBundle);

	// Tier 1 only: swap the string tables from a bundle whose structure is unchanged. Prefer
	// ApplyLiveBundle, which picks the right tier itself.
	UFUNCTION(BlueprintCallable, Category = "Patterplay|LiveLink")
	void ReplaceStrings(UPatterBundle* NewBundle);

	// Tier 2 only: rebuild on the new bundle with the run carried over (save -> fresh core -> load,
	// locale + captions preserved). Prefer ApplyLiveBundle. Returns false on a null/unparsed bundle.
	UFUNCTION(BlueprintCallable, Category = "Patterplay|LiveLink")
	bool HotSwap(UPatterBundle* NewBundle);

	UFUNCTION(BlueprintPure, Category = "Patterplay")
	TArray<FString> GetPropertyFlags(const FString& Ref) const;

	UFUNCTION(BlueprintCallable, Category = "Patterplay")
	void SetPropertyFlags(const FString& Ref, const TArray<FString>& Values);

	// The shared @patter properties, each with type / value / default / enum values, for a live state
	// inspector (the editor's Runtime State window, or your own debug UI). Per-flow @local properties
	// are excluded. Read fresh, so a SetProperty is reflected next call.
	UFUNCTION(BlueprintCallable, Category = "Patterplay|Debug")
	TArray<FPatterPropertyRow> ListProperties() const;

	// The authored structure as a nested tree: scenes -> blocks -> children (groups + snippets, groups
	// preserved) -> a snippet's beats, each carrying its static data. Static (no flow). For editor / dev
	// tooling that builds against the writer's structure, e.g. a Sequencer of subsequences per beat.
	// A beat's accumulated author tags (its own plus every ancestor's), the same value its step carries.
	UFUNCTION(BlueprintPure, Category = "Patterplay")
	TArray<FString> TagsForBeat(const FString& BeatId) const;

	// Switch language live, mid-game: subsequent beats render in the new locale. No state changes.
	UFUNCTION(BlueprintCallable, Category = "Patterplay")
	void SetLocale(const FString& Locale);

	// Closed captions: when off, cue spans are stripped from dialogue line text. No state changes.
	UFUNCTION(BlueprintCallable, Category = "Patterplay")
	void SetClosedCaptions(bool bOn);

	UFUNCTION(BlueprintCallable, Category = "Patterplay|Structure")
	TArray<FPatterOutlineScene> GetOutline() const;

	// Every beat in document order, flattened through groups, each with the scene / block / snippet it
	// belongs to and its static data. The linear view of GetOutline.
	UFUNCTION(BlueprintCallable, Category = "Patterplay|Structure")
	TArray<FPatterFlatBeat> GetBeatSequence() const;

	// Publish this engine to the editor's Runtime State inspector under an optional label. Call after
	// Create; it unregisters itself automatically when destroyed. (Parity with PatterDebug.Register.)
	UFUNCTION(BlueprintCallable, Category = "Patterplay|Debug")
	void RegisterForDebug(const FString& Label);

	UFUNCTION(BlueprintCallable, Category = "Patterplay|Debug")
	void UnregisterForDebug();

	patter::Engine* Raw() const { return Engine.Get(); }

	virtual void BeginDestroy() override;

private:
	UPROPERTY()
	TObjectPtr<UPatterBundle> BundleRef = nullptr;

	// Tier-1 refresh: the core points its string tables INTO this bundle, so it must outlive the
	// swap (the structural bundle above still owns the nodes).
	UPROPERTY()
	TObjectPtr<UPatterBundle> StringsBundleRef = nullptr;

	// Every wrapper handed out by OpenFlow, so a hot swap can re-bind them by id.
	TArray<TWeakObjectPtr<UPatterFlow>> WrappedFlows;

	TPimplPtr<patter::Engine> Engine;
};
