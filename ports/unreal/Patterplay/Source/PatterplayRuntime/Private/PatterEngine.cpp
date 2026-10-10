#include "PatterEngine.h"
#include "PatterBundle.h"
#include "PatterDebug.h"
#include "PatterWorld.h"
#include "Patter/Engine.h"
#include "PatterConvert.h"
#include "UObject/Package.h" // GetTransientPackage() - not transitively available in the Game target

using namespace PatterConvert;

namespace
{
	EPatterPropertyType PropertyTypeFrom(const std::string& T)
	{
		if (T == "number") return EPatterPropertyType::Number;
		if (T == "string") return EPatterPropertyType::String;
		if (T == "flags") return EPatterPropertyType::Flags;
		if (T == "enum") return EPatterPropertyType::Enum;
		if (T == "quality") return EPatterPropertyType::Quality;
		return EPatterPropertyType::Boolean;
	}

	EPatterBeatKind BeatKindFrom(const std::string& K)
	{
		if (K == "text") return EPatterBeatKind::Text;
		if (K == "gameEvent") return EPatterBeatKind::GameEvent;
		return EPatterBeatKind::Line;
	}

	EPatterPropertyType ValueTypeOf(const patter::PatterValue& V)
	{
		if (V.isNumber()) return EPatterPropertyType::Number;
		if (V.isString()) return EPatterPropertyType::String;
		if (V.isFlags()) return EPatterPropertyType::Flags;
		return EPatterPropertyType::Boolean;
	}

	// One Game Data map -> the BP-facing entry rows (name / type / display value). Shared by the
	// structure-introspection beats and delivered steps.
	template <typename TPairs>
	TArray<FPatterGameDataEntry> ConvertGameData(const TPairs& Pairs)
	{
		TArray<FPatterGameDataEntry> Out;
		for (const auto& KV : Pairs)
		{
			FPatterGameDataEntry E;
			E.Name = Ue(KV.first);
			E.Type = ValueTypeOf(KV.second);
			E.Value = Ue(KV.second.toDisplayString());
			E.TypedValue = ToUeValue(KV.second);
			Out.Add(E);
		}
		return Out;
	}

	FPatterBeatInfo ConvertBeat(const patter::BeatInfo& B)
	{
		FPatterBeatInfo Out;
		Out.Id = Ue(B.id);
		Out.Kind = BeatKindFrom(B.kind);
		Out.Character = Ue(B.character);
		Out.CharacterName = Ue(B.characterName);
		Out.Direction = Ue(B.direction);
		Out.Qualifier = Ue(B.qualifier);
		Out.QualifierName = Ue(B.qualifierName);
		Out.PadAfter = B.padAfter;
		Out.bHasOwnPadAfter = B.hasOwnPadAfter;
		if (B.hasOwnPadAfter) Out.OwnPadAfter = B.ownPadAfter;
		Out.Text = Ue(B.text);
		Out.GameData = ConvertGameData(B.gameData);
		for (const std::string& T : B.tags) Out.Tags.Add(Ue(T));
		return Out;
	}

	// Flatten a node (and its subtree) into the block's flat Nodes array; return this node's index.
	// A group's children become ChildIndices into the same array (Blueprint can't nest a struct).
	int32 FlattenNode(const patter::OutlineNode& N, TArray<FPatterOutlineNode>& Nodes)
	{
		FPatterOutlineNode Node;
		Node.Type = Ue(N.type);
		Node.Id = Ue(N.id);
		for (const std::string& T : N.tags) Node.Tags.Add(Ue(T));
		Node.Selector = Ue(N.selector);
		Node.bHasPrompt = N.hasPrompt;
		if (N.hasPrompt) Node.Prompt = ConvertBeat(N.prompt);
		for (const patter::BeatInfo& B : N.beats) Node.Beats.Add(ConvertBeat(B));
		Node.JumpTo = Ue(N.jumpTo);
		Node.JumpMode = Ue(N.jumpMode);

		const int32 MyIndex = Nodes.Add(Node);           // reserve this node's slot (index stays stable)
		TArray<int32> ChildIndices;
		for (const patter::OutlineNode& C : N.children) ChildIndices.Add(FlattenNode(C, Nodes));
		Nodes[MyIndex].ChildIndices = MoveTemp(ChildIndices);
		return MyIndex;
	}

	FPatterOption ConvertOption(const patter::ChoiceOption& O)
	{
		FPatterOption Opt;
		Opt.Id = Ue(O.id);
		Opt.bEligible = O.eligible;
		if (O.gameData) Opt.GameData = ConvertGameData(*O.gameData);
		if (O.prompt)
		{
			FPatterChoicePrompt& P = Opt.Prompt;
			Opt.bHasPrompt = true;
			P.Kind = O.prompt->kind == "line" ? EPatterPromptKind::Line : EPatterPromptKind::Text;
			P.Text = Ue(O.prompt->text);
			P.bHasCharacter = O.prompt->hasCharacter;
			if (O.prompt->hasCharacter) P.Character = Ue(O.prompt->character);
			P.bHasCharacterName = O.prompt->hasCharacterName;
			if (O.prompt->hasCharacterName) P.CharacterName = Ue(O.prompt->characterName);
			P.bHasDirection = O.prompt->hasDirection;
			if (O.prompt->hasDirection) P.Direction = Ue(O.prompt->direction);
			P.bHasQualifier = O.prompt->hasQualifier;
			if (O.prompt->hasQualifier) P.Qualifier = Ue(O.prompt->qualifier);
			P.bHasQualifierName = O.prompt->hasQualifierName;
			if (O.prompt->hasQualifierName) P.QualifierName = Ue(O.prompt->qualifierName);
			P.PadAfter = O.prompt->padAfter;   // line padding: the prompt's resolved pause
			// The deprecated flat fields, filled as they were, for Blueprints that still read them.
			Opt.PromptKind = P.Kind;
			Opt.Text = P.Text;
			Opt.Character = P.Character;
			Opt.CharacterName = P.CharacterName;
			Opt.Direction = P.Direction;
		}
		return Opt;
	}

	FPatterStep Convert(const patter::StepResult& S)
	{
		FPatterStep Out;
		switch (S.type)
		{
			case patter::StepType::Line: Out.Type = EPatterStepType::Line; break;
			case patter::StepType::Text: Out.Type = EPatterStepType::Text; break;
			case patter::StepType::GameEvent: Out.Type = EPatterStepType::GameEvent; break;
			case patter::StepType::Choice: Out.Type = EPatterStepType::Choice; break;
			case patter::StepType::End: Out.Type = EPatterStepType::End; break;
		}
		Out.Id = Ue(S.id);
		Out.Text = Ue(S.text);
		Out.bHasCharacter = S.hasCharacter;
		if (S.hasCharacter) Out.Character = Ue(S.character);
		Out.bHasCharacterName = S.hasCharacterName;
		if (S.hasCharacterName) Out.CharacterName = Ue(S.characterName);
		Out.bHasDirection = S.hasDirection;
		if (S.hasDirection) Out.Direction = Ue(S.direction);
		Out.bHasQualifier = S.hasQualifier;
		if (S.hasQualifier) Out.Qualifier = Ue(S.qualifier);
		Out.bHasQualifierName = S.hasQualifierName;
		if (S.hasQualifierName) Out.QualifierName = Ue(S.qualifierName);
		Out.PadAfter = S.padAfter;   // line padding: set on a line or text step, 0 on the rest
		// Game Data + tags cross the UObject boundary too: host events ride on Game Data (#116), so a
		// Blueprint host must be able to read them straight off the step (parity with the other ports).
		if (S.gameData) Out.GameData = ConvertGameData(*S.gameData);
		if (S.hasTags) for (const std::string& T : S.tags) Out.Tags.Add(Ue(T));
		if (S.type == patter::StepType::Choice) Out.GroupId = Ue(S.groupId);
		for (const patter::ChoiceOption& O : S.options) Out.Options.Add(ConvertOption(O));
		return Out;
	}
}

// ----- UPatterFlow ------------------------------------------------------------

static FPatterLogEntry ConvertLogEntry(const patter::LogEntry& E);

void UPatterFlow::Init(UPatterEngine* InOwner, const FString& InId, const std::shared_ptr<patter::Flow>& InFlow) { Owner = InOwner; FlowId = InId; Flow = InFlow; }

void UPatterFlow::Close()
{
	if (Owner) Owner->CloseFlow(FlowId); // the engine finishes and drops it, then re-binds this wrapper
}

FPatterStep UPatterFlow::Advance()
{
	if (!Flow) return FPatterStep();
	// A content error no longer reaches here: the core plays through it and reports it (OnError), so the
	// flow carries on instead of ending. What can still arrive is a refusal of a different kind, such as a
	// jump cycle with nothing to deliver, which ends the step as it always did.
	try { return Convert(Flow->advance()); }
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); return FPatterStep(); }
}

void UPatterFlow::Choose(const FString& OptionId)
{
	if (!Flow) return;
	try { Flow->choose(Std(OptionId)); }
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); }
}

bool UPatterFlow::IsEnded() const { return Flow ? Flow->isEnded() : true; }

FString UPatterFlow::CurrentScene() const { return Flow ? Ue(Flow->currentScene()) : FString(); }

TArray<FPatterStep> UPatterFlow::AdvanceToStop(FPatterStep& OutStop)
{
	TArray<FPatterStep> Played;
	OutStop = FPatterStep();
	if (!Flow) return Played;
	try
	{
		patter::AdvanceToStopResult Res = Flow->advanceToStop();
		for (const patter::StepResult& S : Res.played) Played.Add(Convert(S));
		OutStop = Convert(Res.stop);
	}
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); }
	return Played;
}

bool UPatterFlow::Goto(const FString& Scene, const FString& Block)
{
	if (!Flow) return false;
	try { return Flow->gotoAddress(Std(Scene), Std(Block)); }
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); return false; }
}

void UPatterFlow::Reset(const FString& Scene, const FString& Block)
{
	if (!Flow) return;
	try { Flow->reset(Std(Scene), Std(Block)); }
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); }
}

bool UPatterFlow::IsClosed() const { return Flow ? Flow->isClosed() : true; }

TArray<FPatterOption> UPatterFlow::GetChoices() const
{
	TArray<FPatterOption> Out;
	if (!Flow) return Out;
	for (const patter::ChoiceOption& O : Flow->getChoices()) Out.Add(ConvertOption(O));
	return Out;
}

bool UPatterFlow::GetProperty(const FString& Ref, FPatterValue& OutValue) const
{
	OutValue = FPatterValue();
	if (!Flow) return false;
	try
	{
		const patter::PatterValue* V = Flow->getProperty(Std(Ref));
		if (!V) return false;
		OutValue = ToUeValue(*V);
		return true;
	}
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); return false; }
}

void UPatterFlow::SetProperty(const FString& Ref, const FPatterValue& Value)
{
	if (!Flow) return;
	try { Flow->setProperty(Std(Ref), FromUeValue(Value)); }
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); }
}

TArray<FPatterLogEntry> UPatterFlow::Log() const
{
	TArray<FPatterLogEntry> Out;
	if (!Flow) return Out;
	for (const patter::LogEntry& E : Flow->log()) Out.Add(ConvertLogEntry(E));
	return Out;
}

void UPatterFlow::ClearLog() { if (Flow) Flow->clearLog(); }

FString UPatterFlow::Interpolate(const FString& Text)
{
	if (!Flow) return Text;
	try { return Ue(Flow->interpolate(Std(Text))); }
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); return Text; }
}

FString UPatterFlow::StripCaptions(const FString& Text)
{
	return Flow ? Ue(Flow->stripCaptions(Std(Text))) : Text;
}

TMap<FString, int32> UPatterFlow::GetVisitCounts() const
{
	TMap<FString, int32> Out;
	if (Flow) for (const auto& KV : Flow->getVisitCounts()) Out.Add(Ue(KV.first), KV.second);
	return Out;
}

// ----- UPatterEngine ----------------------------------------------------------

UPatterEngine* UPatterEngine::Create(UPatterBundle* Bundle, UPatterWorld* World)
{
	return Build(Bundle, World, nullptr, FPatterEngineOptions());
}

UPatterEngine* UPatterEngine::CreateWithOptions(UPatterBundle* Bundle, const FPatterEngineOptions& Options, UPatterWorld* World)
{
	return Build(Bundle, World, nullptr, Options);
}

UPatterEngine* UPatterEngine::CreateWithRegistry(UPatterBundle* Bundle, const std::shared_ptr<patter::ScopeRegistry>& Registry,
	UPatterWorld* World, const FPatterEngineOptions& Options)
{
	if (!Registry)
	{
		UE_LOG(LogTemp, Error, TEXT("Patterplay: CreateWithRegistry called with a null registry"));
		return nullptr;
	}
	return Build(Bundle, World, Registry, Options);
}

UPatterEngine* UPatterEngine::Build(UPatterBundle* Bundle, UPatterWorld* World, const std::shared_ptr<patter::ScopeRegistry>& Registry,
	const FPatterEngineOptions& Options)
{
	if (!Bundle || !Bundle->Raw())
	{
		UE_LOG(LogTemp, Error, TEXT("Patterplay: Create called with a null/unparsed bundle"));
		return nullptr;
	}
	// A bound world is an external scope in the registry, read and written through the container; the
	// core keeps the binding for its whole life, hot swaps included.
	patter::EngineOptions Opts;
	if (World) Opts.hostScopes["world"] = World->MakeHostScope();
	Opts.registry = Registry;
	Opts.hasSeed = Options.bUseSeed;
	Opts.seed = static_cast<double>(Options.Seed);
	Opts.locale = Std(Options.Locale);
	Opts.replayPromptOnChoose = Options.bReplayPromptOnChoose;
	Opts.closedCaptions = Options.bClosedCaptions;
	Opts.log = Options.bLog;
	UPatterEngine* E = NewObject<UPatterEngine>(GetTransientPackage());
	E->BundleRef = Bundle;
	E->WorldRef = World;
	// The core's callback raises the Blueprint event. It holds the engine weakly: the callback lives in the
	// core's creation options, which a hot swap hands on to the replacement core.
	TWeakObjectPtr<UPatterEngine> Weak(E);
	Opts.onDryChoice = [Weak](const std::string& GroupId)
	{
		if (UPatterEngine* Self = Weak.Get()) Self->OnDryChoice.Broadcast(Ue(GroupId));
	};
	// A content error the core played through: always a Warning in the log, so a content bug is never
	// silent, and the Blueprint event for a game or tool that wants to act on it.
	Opts.onError = [Weak](const patter::PlayError& Err)
	{
		UE_LOG(LogTemp, Warning, TEXT("Patterplay: %s on %s in flow '%s' failed, played through: %s"),
			UTF8_TO_TCHAR(Err.kind.c_str()), UTF8_TO_TCHAR(Err.node.c_str()), UTF8_TO_TCHAR(Err.flow.c_str()), UTF8_TO_TCHAR(Err.message.c_str()));
		UPatterEngine* Self = Weak.Get();
		if (!Self) return;
		FPatterPlayError Out;
		Out.Flow = Ue(Err.flow);
		Out.Kind = Err.kind == "effect" ? EPatterPlayErrorKind::Effect
			: Err.kind == "best-match" ? EPatterPlayErrorKind::BestMatch
			: EPatterPlayErrorKind::Condition;
		Out.Node = Ue(Err.node);
		Out.Source = Ue(Err.source);
		Out.Message = Ue(Err.message);
		Self->OnError.Broadcast(Out);
	};
	try { E->Engine = std::make_shared<patter::Engine>(*Bundle->Raw(), Opts); }
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); return nullptr; }
	E->TapTrace();
	return E;
}

void UPatterEngine::TapTrace()
{
	// Held weakly, like the other callbacks. Only a bound event pays for the entry's conversion.
	TWeakObjectPtr<UPatterEngine> Weak(this);
	Engine->onTrace([Weak](const std::string&, const patter::LogEntry& Entry)
	{
		UPatterEngine* Self = Weak.Get();
		if (Self && Self->OnTrace.IsBound()) Self->OnTrace.Broadcast(ConvertLogEntry(Entry));
	});
}

UPatterWorld* UPatterEngine::GetBoundWorld() const { return WorldRef; }

UPatterFlow* UPatterEngine::OpenFlow(const FString& Id, const FString& Scene, const FString& Block, bool bUseSeed, int64 Seed)
{
	if (!Engine) return nullptr;
	try
	{
		const int64_t SeedValue = static_cast<int64_t>(Seed);
		Engine->openFlow(Std(Id), Std(Scene), Std(Block), bUseSeed ? &SeedValue : nullptr);
		UPatterFlow* Flow = NewObject<UPatterFlow>(this);
		Flow->Init(this, Id, Engine->flowPtr(Std(Id))); // an OWNING handle: see UPatterFlow::Flow
		// A reopen REPLACES: the core has closed the flow this name used to mean, so its wrapper
		// leaves the list. Kept, the next re-bind by id would point it at this new flow.
		WrappedFlows.RemoveAll([&Id](const TWeakObjectPtr<UPatterFlow>& Weak) { return !Weak.IsValid() || Weak->Id() == Id; });
		WrappedFlows.Add(Flow); // so a live hot swap can re-bind the wrapper by id
		return Flow;
	}
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); return nullptr; }
}

TArray<UPatterFlow*> UPatterEngine::Flows()
{
	TArray<UPatterFlow*> Out;
	if (!Engine) return Out;
	for (patter::Flow* F : Engine->flows())
		if (UPatterFlow* Wrapper = GetFlow(Ue(F->id()))) Out.Add(Wrapper);
	return Out;
}

bool UPatterEngine::GetProperty(const FString& Ref, FPatterValue& OutValue) const
{
	OutValue = FPatterValue();
	if (!Engine) return false;
	try
	{
		const patter::PatterValue* V = Engine->getProperty(Std(Ref));
		if (!V) return false;
		OutValue = ToUeValue(*V);
		return true;
	}
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); return false; }
}

void UPatterEngine::SetProperty(const FString& Ref, const FPatterValue& Value)
{
	if (!Engine) return;
	try { Engine->setProperty(Std(Ref), FromUeValue(Value)); }
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); }
}

TMap<FString, int32> UPatterEngine::GetVisitCounts() const
{
	TMap<FString, int32> Out;
	if (Engine) for (const auto& KV : Engine->getVisitCounts()) Out.Add(Ue(KV.first), KV.second);
	return Out;
}

FString UPatterEngine::Locale() const { return Engine ? Ue(Engine->locale()) : FString(); }

bool UPatterEngine::IsSourceDebug() const { return Engine && Engine->isSourceDebug(); }

bool UPatterEngine::ClosedCaptions() const { return Engine ? Engine->closedCaptions() : true; }

FString UPatterEngine::SceneAddress(const FString& SceneId) const { return Engine ? Ue(Engine->sceneAddress(Std(SceneId))) : FString(); }

FString UPatterEngine::BlockAddress(const FString& BlockId) const { return Engine ? Ue(Engine->blockAddress(Std(BlockId))) : FString(); }

TArray<FString> UPatterEngine::TagsForScene(const FString& SceneRef) const
{
	TArray<FString> Out;
	if (!Engine) return Out;
	try { for (const std::string& T : Engine->tagsForScene(Std(SceneRef))) Out.Add(Ue(T)); }
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); }
	return Out;
}

TArray<FString> UPatterEngine::TagsForBlock(const FString& SceneRef, const FString& BlockRef) const
{
	TArray<FString> Out;
	if (!Engine) return Out;
	try { for (const std::string& T : Engine->tagsForBlock(Std(SceneRef), Std(BlockRef))) Out.Add(Ue(T)); }
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); }
	return Out;
}

TArray<FPatterGameDataEntry> UPatterEngine::GameDataForScene(const FString& SceneRef) const
{
	if (!Engine) return {};
	try { return ConvertGameData(Engine->gameDataForScene(Std(SceneRef))); }
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); return {}; }
}

TArray<FPatterGameDataEntry> UPatterEngine::GameDataForBlock(const FString& SceneRef, const FString& BlockRef) const
{
	if (!Engine) return {};
	try { return ConvertGameData(Engine->gameDataForBlock(Std(SceneRef), Std(BlockRef))); }
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); return {}; }
}

TArray<FPatterStep> UPatterEngine::RunFlow(const FString& FlowName, const FString& Scene, const FString& Block)
{
	TArray<FPatterStep> Played;
	if (!Engine) return Played;
	try
	{
		for (const patter::StepResult& S : Engine->runFlow(Std(FlowName), Std(Scene), Std(Block))) Played.Add(Convert(S));
	}
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); }
	return Played;
}

TArray<FString> UPatterEngine::TagsForBeat(const FString& BeatId) const
{
	TArray<FString> Out;
	if (!Engine) return Out;
	for (const std::string& T : Engine->tagsForBeat(Std(BeatId))) Out.Add(Ue(T));
	return Out;
}

TArray<FString> UPatterEngine::GetCast() const
{
	TArray<FString> Out;
	if (!Engine) return Out;
	for (const std::string& N : Engine->getCast()) Out.Add(Ue(N));
	return Out;
}

TArray<FString> UPatterEngine::CastForScene(const FString& SceneRef) const
{
	TArray<FString> Out;
	if (!Engine) return Out;
	for (const std::string& N : Engine->castForScene(Std(SceneRef))) Out.Add(Ue(N));
	return Out;
}

TArray<FString> UPatterEngine::CastForBlock(const FString& SceneRef, const FString& BlockRef) const
{
	TArray<FString> Out;
	if (!Engine) return Out;
	for (const std::string& N : Engine->castForBlock(Std(SceneRef), Std(BlockRef))) Out.Add(Ue(N));
	return Out;
}

void UPatterEngine::SetLocale(const FString& Locale)
{
	if (!Engine) return;
	try { Engine->setLocale(Std(Locale)); }
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); }
}

void UPatterEngine::SetClosedCaptions(bool bOn)
{
	if (Engine) Engine->setClosedCaptions(bOn);
}

double UPatterEngine::GetPropertyNumber(const FString& Ref) const
{
	if (!Engine) return 0.0;
	const patter::PatterValue* V = Engine->getProperty(Std(Ref));
	return (V && V->isNumber()) ? V->n : 0.0;
}

FString UPatterEngine::GetPropertyString(const FString& Ref) const
{
	if (!Engine) return FString();
	const patter::PatterValue* V = Engine->getProperty(Std(Ref));
	return V ? Ue(V->toDisplayString()) : FString();
}

bool UPatterEngine::GetPropertyBool(const FString& Ref) const
{
	if (!Engine) return false;
	const patter::PatterValue* V = Engine->getProperty(Std(Ref));
	return (V && V->isBool()) ? V->b : false;
}

// A refused write (a scope the game lent with no setter, an @scene ref) is logged like every other
// guarded call here, never thrown through Blueprint.
void UPatterEngine::SetPropertyNumber(const FString& Ref, double Value)
{
	if (!Engine) return;
	try { Engine->setProperty(Std(Ref), patter::PatterValue::Num(Value)); }
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); }
}

void UPatterEngine::SetPropertyBool(const FString& Ref, bool bValue)
{
	if (!Engine) return;
	try { Engine->setProperty(Std(Ref), patter::PatterValue::Bool(bValue)); }
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); }
}

void UPatterEngine::SetPropertyString(const FString& Ref, const FString& Value)
{
	if (!Engine) return;
	try { Engine->setProperty(Std(Ref), patter::PatterValue::Str(Std(Value))); }
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); }
}

FString UPatterEngine::BuildId() const
{
	return (BundleRef && BundleRef->Raw()) ? Ue(BundleRef->Raw()->contentHash) : FString();
}

FString UPatterEngine::ApplyLiveBundle(UPatterBundle* NewBundle)
{
	if (!Engine || !NewBundle || !NewBundle->Raw()) return TEXT("error");
	const patter::Bundle* Current = (BundleRef && BundleRef->Raw()) ? BundleRef->Raw() : nullptr;
	const bool bSameStructure = Current
		&& !Current->structureHash.empty()
		&& Current->structureHash == NewBundle->Raw()->structureHash;
	if (bSameStructure) { ReplaceStrings(NewBundle); return TEXT("text"); }
	return HotSwap(NewBundle) ? TEXT("structure") : TEXT("error");
}

void UPatterEngine::ReplaceStrings(UPatterBundle* NewBundle)
{
	if (!Engine || !NewBundle || !NewBundle->Raw()) return;
	Engine->replaceStrings(*NewBundle->Raw());
	StringsBundleRef = NewBundle; // the core now points into this bundle's tables: keep it alive
}

bool UPatterEngine::HotSwap(UPatterBundle* NewBundle)
{
	if (!Engine || !NewBundle || !NewBundle->Raw()) return false;
	try
	{
		// The wrapper swaps IN PLACE (this UObject + every flow handle stay valid) around the core's own
		// hotSwap: the old core hands every property bag to the replacement on the same registry (the
		// same world stays bound), the cursors carry across, and so do locale and captions. Then each
		// flow wrapper re-binds by id. The old core is released and inert once the swap starts.
		std::unique_ptr<patter::Engine> Next = Engine->hotSwap(*NewBundle->Raw());
		Engine = std::shared_ptr<patter::Engine>(std::move(Next));
		BundleRef = NewBundle;
		StringsBundleRef = nullptr;
		RebindFlows(); // the swap rebuilt the flows; the same re-bind the load path needs
		TapTrace();
		return true;
	}
	catch (const std::exception& Ex)
	{
		// The core falls back on a fresh engine itself when the restore fails, so reaching here means no
		// replacement could be built at all. The old core has already released its flows: re-bind, and
		// every wrapper reads as closed rather than dangling. (A swap refused because a checkpoint is open
		// lands here too, before anything changed: the re-bind then finds every flow where it was.)
		UE_LOG(LogTemp, Error, TEXT("Patterplay: hot swap failed - %s"), UTF8_TO_TCHAR(Ex.what()));
		RebindFlows();
		return false;
	}
}

UPatterFlow* UPatterEngine::GetFlow(const FString& FlowName)
{
	if (!Engine) return nullptr;
	std::shared_ptr<patter::Flow> F = Engine->flowPtr(Std(FlowName));
	if (!F) return nullptr; // not open: null, not an inert wrapper nobody asked for
	// Hand back the wrapper we already made for THIS flow, so a Blueprint that fetches twice gets one
	// object rather than two views of it. Matched by the flow it holds, not by id: after a reopen the
	// old wrapper carries the same id and the closed flow.
	for (const TWeakObjectPtr<UPatterFlow>& Weak : WrappedFlows)
		if (UPatterFlow* Wrapper = Weak.Get())
			if (Wrapper->Flow == F) return Wrapper;
	UPatterFlow* Flow = NewObject<UPatterFlow>(this);
	Flow->Init(this, FlowName, F);
	WrappedFlows.Add(Flow);
	return Flow;
}

void UPatterEngine::CloseFlow(const FString& FlowName)
{
	if (!Engine) return;
	try { Engine->closeFlow(Std(FlowName)); } // refused while a checkpoint is open
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); return; }
	RebindFlows(); // the flow is gone; its wrapper must stop pointing at a map entry that is not there
}

void UPatterEngine::Reset()
{
	if (!Engine) return;
	try { Engine->reset(); } // refused while a checkpoint is open
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); return; }
	RebindFlows(); // every flow went with it
}

void UPatterEngine::Checkpoint()
{
	if (!Engine) return;
	try { OpenCheckpoint = std::make_shared<patter::Checkpoint>(Engine->checkpoint()); }
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); }
}

void UPatterEngine::Rollback()
{
	if (!Engine) return;
	try
	{
		// With none held, the core is handed an empty checkpoint, which it refuses as not the open one.
		Engine->rollback(OpenCheckpoint ? *OpenCheckpoint : patter::Checkpoint());
		OpenCheckpoint.reset();
	}
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); return; }
	RebindFlows(); // a flow opened inside the checkpoint is closed and gone: its wrapper reads as closed
}

void UPatterEngine::Commit()
{
	if (!Engine) return;
	try
	{
		Engine->commit(OpenCheckpoint ? *OpenCheckpoint : patter::Checkpoint());
		OpenCheckpoint.reset();
	}
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); }
}

bool UPatterEngine::InCheckpoint() const { return Engine && Engine->inCheckpoint(); }

void UPatterEngine::RebindFlows()
{
	WrappedFlows.RemoveAll([](const TWeakObjectPtr<UPatterFlow>& Weak) { return !Weak.IsValid(); });
	if (!Engine) // no core: nothing to point at, and a stale pointer is the thing we are here to avoid
	{
		for (const TWeakObjectPtr<UPatterFlow>& Weak : WrappedFlows)
			if (UPatterFlow* Wrapper = Weak.Get()) Wrapper->Rebind(nullptr);
		return;
	}
	for (const TWeakObjectPtr<UPatterFlow>& Weak : WrappedFlows)
		if (UPatterFlow* Wrapper = Weak.Get())
			Wrapper->Rebind(Engine->flowPtr(Std(Wrapper->Id())));
	// A wrapper whose flow did not survive (closed, reset, not in the save) is closed for good: it
	// leaves the list, so a later re-bind cannot revive it on the next flow opened under its name.
	WrappedFlows.RemoveAll([](const TWeakObjectPtr<UPatterFlow>& Weak) { return !Weak.IsValid() || Weak->IsClosed(); });
}

TArray<FString> UPatterEngine::GetPropertyFlags(const FString& Ref) const
{
	TArray<FString> Out;
	if (!Engine) return Out;
	const patter::PatterValue* V = Engine->getProperty(Std(Ref));
	if (V && V->isFlags()) for (const std::string& S : V->f) Out.Add(Ue(S));
	return Out;
}

void UPatterEngine::SetPropertyFlags(const FString& Ref, const TArray<FString>& Values)
{
	if (!Engine) return;
	std::vector<std::string> Flags;
	Flags.reserve(Values.Num());
	for (const FString& V : Values) Flags.push_back(Std(V));
	try { Engine->setProperty(Std(Ref), patter::PatterValue::Flags(std::move(Flags))); }
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); }
}

static FPatterLogEntry ConvertLogEntry(const patter::LogEntry& E)
{
	const auto Verdicts = [](const std::vector<std::pair<std::string, bool>>& List)
	{
		TArray<FPatterLogConsidered> Out;
		for (const auto& C : List)
		{
			FPatterLogConsidered Item;
			Item.Id = Ue(C.first);
			Item.bEligible = C.second;
			Out.Add(Item);
		}
		return Out;
	};
	FPatterLogEntry Row;
	Row.Type = Ue(E.type);
	Row.Seq = E.seq;
	Row.Flow = Ue(E.flow);
	Row.Scene = Ue(E.scene);
	Row.Group = Ue(E.group);
	Row.Selector = Ue(E.selector);
	Row.Order = Ue(E.order);
	Row.Exhaust = Ue(E.exhaust);
	Row.Children = Verdicts(E.children);
	Row.Picked = Ue(E.picked);
	Row.Options = Verdicts(E.options);
	Row.Option = Ue(E.option);
	Row.To = Ue(E.to);
	Row.Mode = Ue(E.mode);
	Row.Target = Ue(E.target);
	if (E.type == "write") Row.Value = Ue(E.value.toDisplayString());
	Row.bHasPrev = E.hasPrev;
	if (E.hasPrev) Row.Prev = Ue(E.prev.toDisplayString());
	Row.Kind = Ue(E.kind);
	Row.Node = Ue(E.node);
	Row.Source = Ue(E.source);
	Row.Message = Ue(E.message);
	// The deprecated fields, filled as they were, for Blueprints that still read them.
	Row.Subject = !Row.Group.IsEmpty() ? Row.Group : !Row.To.IsEmpty() ? Row.To : !Row.Target.IsEmpty() ? Row.Target : Row.Node;
	Row.Considered = Row.Children.Num() ? Row.Children : Row.Options;
	Row.Detail = !Row.Mode.IsEmpty() ? Row.Mode : Row.Message;
	return Row;
}

TArray<FPatterLogEntry> UPatterEngine::Log() const
{
	TArray<FPatterLogEntry> Out;
	if (!Engine) return Out;
	for (const patter::LogEntry& E : Engine->log()) Out.Add(ConvertLogEntry(E));
	return Out;
}

void UPatterEngine::ClearLog()
{
	if (Engine) Engine->clearLog();
}

TArray<FPatterPropertyRow> UPatterEngine::ListProperties() const
{
	TArray<FPatterPropertyRow> Out;
	if (!Engine) return Out;
	for (const patter::PropertyRow& R : Engine->listProperties())
	{
		FPatterPropertyRow Row;
		Row.Path = Ue(R.path);
		Row.Name = Ue(R.name);
		Row.Type = PropertyTypeFrom(R.type);
		Row.Value = Ue(R.value.toDisplayString());
		Row.Default = Ue(R.defaultValue.toDisplayString());
		Row.bIsDefault = R.value.valueEquals(R.defaultValue);
		// optional on the shared row: absent and empty mean the same thing to a UI.
		if (R.values) for (const std::string& V : *R.values) Row.Values.Add(Ue(V));
		if (R.stages) for (const std::string& V : *R.stages) Row.Stages.Add(Ue(V));
		Row.bWritable = R.writable;
		Out.Add(Row);
	}
	return Out;
}

TArray<FPatterOutlineScene> UPatterEngine::GetOutline() const
{
	TArray<FPatterOutlineScene> Out;
	if (!Engine) return Out;
	for (const patter::OutlineScene& S : Engine->getOutline())
	{
		FPatterOutlineScene Scene;
		Scene.Id = Ue(S.id);
		Scene.GameId = Ue(S.gameId);
		Scene.Name = Ue(S.name);
		Scene.GameData = ConvertGameData(S.gameData);
		for (const std::string& T : S.tags) Scene.Tags.Add(Ue(T));
		for (const patter::OutlineBlock& B : S.blocks)
		{
			FPatterOutlineBlock Block;
			Block.Id = Ue(B.id);
			Block.GameId = Ue(B.gameId);
			Block.Name = Ue(B.name);
			Block.GameData = ConvertGameData(B.gameData);
			for (const std::string& T : B.tags) Block.Tags.Add(Ue(T));
			for (const patter::OutlineNode& N : B.children) Block.RootIndices.Add(FlattenNode(N, Block.Nodes));
			Scene.Blocks.Add(Block);
		}
		Out.Add(Scene);
	}
	return Out;
}

TArray<FPatterFlatBeat> UPatterEngine::GetBeatSequence() const
{
	TArray<FPatterFlatBeat> Out;
	if (!Engine) return Out;
	for (const patter::FlatBeat& F : Engine->getBeatSequence())
	{
		FPatterFlatBeat Flat;
		Flat.SceneId = Ue(F.sceneId);
		Flat.BlockId = Ue(F.blockId);
		Flat.SnippetId = Ue(F.snippetId);
		Flat.Beat = ConvertBeat(F.beat);
		Out.Add(Flat);
	}
	return Out;
}

void UPatterEngine::RegisterForDebug(const FString& Label)
{
	FPatterDebug::Register(this, Label.IsEmpty() ? GetName() : Label);
}

void UPatterEngine::UnregisterForDebug()
{
	FPatterDebug::Unregister(this);
}

void UPatterEngine::BeginDestroy()
{
	FPatterDebug::Unregister(this);
	Super::BeginDestroy();
}
