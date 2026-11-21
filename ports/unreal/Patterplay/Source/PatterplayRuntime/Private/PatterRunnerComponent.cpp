#include "PatterRunnerComponent.h"
#include "PatterBundle.h"
#include "PatterEngine.h"
#include "PatterLog.h"
#include "PatterWorld.h"
#include "PatterWorldComponent.h"
#include "GameFramework/Actor.h"

// The same rules as the std core's patter::Runner (Patter/Runner.h), played through the Blueprint wrappers so
// the engine's own handling carries over: OpenFlow delivers the Setup reports held since the engine was
// built, a flow's wrapper re-binds across a load or a hot swap, and the steps arrive as FPatterStep.

UPatterRunnerComponent::UPatterRunnerComponent()
{
	PrimaryComponentTick.bCanEverTick = false;
}

void UPatterRunnerComponent::BeginPlay()
{
	Super::BeginPlay();
	if (!Bundle || Engine) return;
	// The World named in Details, else a Patter World on the runner's own actor (which a Blueprint's
	// defaults can't name).
	UPatterWorld* PatterWorld = UPatterWorldComponent::FindPatterWorld(World);
	if (!PatterWorld && !World) PatterWorld = UPatterWorldComponent::FindPatterWorld(GetOwner());
	const AActor* Owner = GetOwner();
	const FString Who = FString::Printf(TEXT("Patter Runner '%s'"), Owner ? *Owner->GetActorNameOrLabel() : *GetName());
	if (World && !PatterWorld)
	{
		// An actor that can't be the World: said, whatever the story reads, as it's a set-up mistake.
		UE_LOG(LogPatterplay, Warning, TEXT("%s: World is set to '%s', which has no Patter World, so @world plays from its declared defaults. Add a Patter World to it, or set World to the actor that has one."),
			*Who, *World->GetActorNameOrLabel());
	}
	else if (!PatterWorld && Bundle->DeclaresWorld())
	{
		// An empty World is said out loud: the story's @world would otherwise play its declared defaults and
		// never see the game, silently.
		UE_LOG(LogPatterplay, Warning, TEXT("%s: the story reads @world, but no World is set, so @world plays from its declared defaults and won't see your game. Set World to your game's Patter World."), *Who);
	}
	SetEngine(UPatterEngine::CreateWithWorld(Bundle, PatterWorld), FlowId);
}

void UPatterRunnerComponent::SetEngine(UPatterEngine* InEngine, const FString& InFlowId)
{
	Engine = InEngine;
	FlowId = InFlowId;
}

UPatterFlow* UPatterRunnerComponent::GetFlow() const
{
	return Engine ? Engine->GetFlow(FlowId) : nullptr;
}

FString UPatterRunnerComponent::Begin(const FString& Scene, const FString& Block)
{
	if (!Engine) return Refuse(TEXT("Begin: no engine; call SetEngine first"));
	UPatterFlow* Flow = GetFlow();
	if (!Flow || Flow->IsClosed())
	{
		FString Refusal;
		if (!Engine->OpenFlowOrRefuse(FlowId, Scene, Block, Refusal)) return Refuse(TEXT("Begin: ") + Refusal, true);
	}
	else if (Scene.IsEmpty())
	{
		if (!Block.IsEmpty()) return Refuse(TEXT("Begin: a block needs its scene"));
		Flow->Reset(FString(), FString());
		if (!Flow->GetLastError().IsEmpty()) return Refuse(TEXT("Begin: ") + Flow->GetLastError(), true);
	}
	else if (!Flow->Goto(Scene, Block))
	{
		if (!Flow->GetLastError().IsEmpty()) return Refuse(TEXT("Begin: ") + Flow->GetLastError(), true);
		FString Address = Scene;
		if (!Block.IsEmpty()) Address += TEXT(" / ") + Block;
		return Refuse(TEXT("Begin: address not found: ") + Address);
	}
	Queued = 0;
	return Next();
}

FString UPatterRunnerComponent::Next()
{
	if (!GetFlow()) return Refuse(FString::Printf(TEXT("Next: flow '%s' isn't open; call Begin() first"), *FlowId));
	++Queued;
	if (bDelivering) return FString();   // a handler asked: played once the event it is in returns
	bDelivering = true;
	LastError.Reset();
	FString Refusal;
	bool bLogged = false;   // the flow's wrapper logs a refusal of its own
	while (Queued > 0)
	{
		--Queued;
		UPatterFlow* Flow = GetFlow();
		if (!Flow) { Refusal = FString::Printf(TEXT("Next: flow '%s' was closed while it played"), *FlowId); break; }
		const FPatterStep Step = Flow->Advance();
		// The wrapper reports a refused advance as an empty End and keeps why: not the flow's end, so not
		// delivered as one.
		if (!Flow->GetLastError().IsEmpty()) { Refusal = TEXT("Next: ") + Flow->GetLastError(); bLogged = true; break; }
		Deliver(Step);
	}
	bDelivering = false;
	Queued = 0;
	return Refusal.IsEmpty() ? FString() : Refuse(Refusal, bLogged);
}

FString UPatterRunnerComponent::Choose(const FString& OptionId)
{
	UPatterFlow* Flow = GetFlow();
	if (!Flow) return Refuse(FString::Printf(TEXT("Choose: flow '%s' isn't open; call Begin() first"), *FlowId));
	Flow->Choose(OptionId);
	if (!Flow->GetLastError().IsEmpty()) return Refuse(TEXT("Choose: ") + Flow->GetLastError(), true);
	return Next();
}

void UPatterRunnerComponent::Stop()
{
	Queued = 0;
}

void UPatterRunnerComponent::Rebind(UPatterEngine* NewEngine)
{
	if (!NewEngine) UE_LOG(LogPatterplay, Warning, TEXT("Patterplay: runner '%s' rebound to no engine"), *FlowId);
	Engine = NewEngine;
}

FString UPatterRunnerComponent::Refuse(const FString& Message, bool bLogged)
{
	LastError = Message;
	if (!bLogged) UE_LOG(LogPatterplay, Error, TEXT("Patterplay: runner '%s': %s"), *FlowId, *Message);
	return Message;
}

void UPatterRunnerComponent::Deliver(const FPatterStep& Step)
{
	switch (Step.Type)
	{
		case EPatterStepType::Line: OnLine.Broadcast(Step); return;
		case EPatterStepType::Text: OnText.Broadcast(Step); return;
		case EPatterStepType::GameEvent: OnGameEvent.Broadcast(Step); return;
		case EPatterStepType::Choice: OnChoice.Broadcast(Step.GroupId, Step.Options); return;
		case EPatterStepType::End: OnEnded.Broadcast(Step.EndReason); return;
	}
}
