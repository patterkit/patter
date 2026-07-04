#include "PatterEngine.h"
#include "PatterBundle.h"
#include "PatterDebug.h"
#include "Patter/Engine.h"
#include "UObject/Package.h" // GetTransientPackage() - not transitively available in the Game target

namespace
{
	std::string Std(const FString& S) { return std::string(TCHAR_TO_UTF8(*S)); }
	FString Ue(const std::string& S) { return FString(UTF8_TO_TCHAR(S.c_str())); }

	EPatterPropertyType PropertyTypeFrom(const std::string& T)
	{
		if (T == "number") return EPatterPropertyType::Number;
		if (T == "string") return EPatterPropertyType::String;
		if (T == "flags") return EPatterPropertyType::Flags;
		if (T == "enum") return EPatterPropertyType::Enum;
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
			Out.Add(E);
		}
		return Out;
	}

	FPatterBeatInfo ConvertBeat(const patter::OutlineBeat& B)
	{
		FPatterBeatInfo Out;
		Out.Id = Ue(B.id);
		Out.Kind = BeatKindFrom(B.kind);
		Out.Character = Ue(B.character);
		Out.CharacterName = Ue(B.characterName);
		Out.Direction = Ue(B.direction);
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
		for (const patter::OutlineBeat& B : N.beats) Node.Beats.Add(ConvertBeat(B));
		Node.JumpTo = Ue(N.jumpTo);
		Node.JumpMode = Ue(N.jumpMode);

		const int32 MyIndex = Nodes.Add(Node);           // reserve this node's slot (index stays stable)
		TArray<int32> ChildIndices;
		for (const patter::OutlineNode& C : N.children) ChildIndices.Add(FlattenNode(C, Nodes));
		Nodes[MyIndex].ChildIndices = MoveTemp(ChildIndices);
		return MyIndex;
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
		if (S.hasCharacter) Out.Character = Ue(S.character);
		if (S.hasCharacterName) Out.CharacterName = Ue(S.characterName);
		if (S.hasDirection) Out.Direction = Ue(S.direction);
		// Game Data + tags cross the UObject boundary too: host events ride on Game Data (#116), so a
		// Blueprint host must be able to read them straight off the step (parity with the other ports).
		if (S.gameData) Out.GameData = ConvertGameData(*S.gameData);
		if (S.hasTags) for (const std::string& T : S.tags) Out.Tags.Add(Ue(T));
		for (const patter::ChoiceOption& O : S.options)
		{
			FPatterOption Opt;
			Opt.Id = Ue(O.id);
			Opt.bEligible = O.eligible;
			if (O.gameData) Opt.GameData = ConvertGameData(*O.gameData);
			if (O.prompt)
			{
				Opt.Text = Ue(O.prompt->text);
				Opt.Character = Ue(O.prompt->character);
				Opt.CharacterName = Ue(O.prompt->characterName);
				Opt.Direction = Ue(O.prompt->direction);
			}
			Out.Options.Add(Opt);
		}
		return Out;
	}
}

// ----- UPatterFlow ------------------------------------------------------------

void UPatterFlow::Init(UPatterEngine* InOwner, const FString& InId, patter::Flow* InFlow) { Owner = InOwner; Id = InId; Flow = InFlow; }

FPatterStep UPatterFlow::Advance()
{
	if (!Flow) return FPatterStep();
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

// ----- UPatterEngine ----------------------------------------------------------

UPatterEngine* UPatterEngine::Create(UPatterBundle* Bundle)
{
	if (!Bundle || !Bundle->Raw())
	{
		UE_LOG(LogTemp, Error, TEXT("Patterplay: Create called with a null/unparsed bundle"));
		return nullptr;
	}
	UPatterEngine* E = NewObject<UPatterEngine>(GetTransientPackage());
	E->BundleRef = Bundle;
	try { E->Engine = MakePimpl<patter::Engine>(*Bundle->Raw()); }
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); return nullptr; }
	return E;
}

UPatterFlow* UPatterEngine::OpenFlow(const FString& Id, const FString& Scene)
{
	if (!Engine) return nullptr;
	try
	{
		patter::Flow* F = Engine->openFlow(Std(Id), Std(Scene));
		UPatterFlow* Flow = NewObject<UPatterFlow>(this);
		Flow->Init(this, Id, F);
		WrappedFlows.Add(Flow); // so a live hot swap can re-bind the wrapper by id
		return Flow;
	}
	catch (const std::exception& Ex) { UE_LOG(LogTemp, Error, TEXT("Patterplay: %s"), UTF8_TO_TCHAR(Ex.what())); return nullptr; }
}

float UPatterEngine::GetPropertyNumber(const FString& Ref) const
{
	if (!Engine) return 0.f;
	const patter::PatterValue* V = Engine->getProperty(Std(Ref));
	return (V && V->isNumber()) ? static_cast<float>(V->n) : 0.f;
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

void UPatterEngine::SetPropertyNumber(const FString& Ref, float Value)
{
	if (Engine) Engine->setProperty(Std(Ref), patter::PatterValue::Num(Value));
}

void UPatterEngine::SetPropertyBool(const FString& Ref, bool bValue)
{
	if (Engine) Engine->setProperty(Std(Ref), patter::PatterValue::Bool(bValue));
}

void UPatterEngine::SetPropertyString(const FString& Ref, const FString& Value)
{
	if (Engine) Engine->setProperty(Std(Ref), patter::PatterValue::Str(Std(Value)));
}

FString UPatterEngine::GetBuildId() const
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
		// The wrapper swaps IN PLACE (this UObject + every flow handle stay valid), so it mirrors the
		// core's hotSwap here rather than calling it: snapshot, fresh core on the new bundle, restore,
		// carry the presentation state that isn't save state, then re-bind each flow wrapper by id.
		const patter::SaveGame Snapshot = Engine->saveGame();
		const std::string Locale = Engine->locale();
		const bool bCaptions = Engine->closedCaptions();
		Engine = MakePimpl<patter::Engine>(*NewBundle->Raw());
		Engine->loadGame(Snapshot);
		Engine->setLocale(Locale);
		Engine->setClosedCaptions(bCaptions);
		BundleRef = NewBundle;
		StringsBundleRef = nullptr;
		for (const TWeakObjectPtr<UPatterFlow>& Weak : WrappedFlows)
			if (UPatterFlow* Wrapper = Weak.Get())
				Wrapper->Rebind(Engine->getFlow(Std(Wrapper->GetFlowId())));
		return true;
	}
	catch (const std::exception& Ex)
	{
		// The old core is already gone (the pimpl was reassigned before the restore threw), so the
		// wrappers must not keep dangling flow pointers: null them, and they no-op from here on.
		UE_LOG(LogTemp, Error, TEXT("Patterplay: hot swap failed - %s"), UTF8_TO_TCHAR(Ex.what()));
		for (const TWeakObjectPtr<UPatterFlow>& Weak : WrappedFlows)
			if (UPatterFlow* Wrapper = Weak.Get()) Wrapper->Rebind(nullptr);
		return false;
	}
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
	Engine->setProperty(Std(Ref), patter::PatterValue::Flags(std::move(Flags)));
}

TArray<FPatterPropertyRow> UPatterEngine::ListProperties() const
{
	TArray<FPatterPropertyRow> Out;
	if (!Engine) return Out;
	for (const patter::PropertyRow& R : Engine->listProperties())
	{
		FPatterPropertyRow Row;
		Row.Ref = Ue(R.ref);
		Row.Type = PropertyTypeFrom(R.type);
		Row.Value = Ue(R.value.toDisplayString());
		Row.Default = Ue(R.def.toDisplayString());
		Row.bIsDefault = R.value.valueEquals(R.def);
		for (const std::string& V : R.values) Row.Values.Add(Ue(V));
		Out.Add(Row);
	}
	return Out;
}

TArray<FPatterOutlineScene> UPatterEngine::GetOutline() const
{
	TArray<FPatterOutlineScene> Out;
	if (!Engine) return Out;
	for (const patter::OutlineScene& S : Engine->listOutline())
	{
		FPatterOutlineScene Scene;
		Scene.Id = Ue(S.id);
		Scene.GameId = Ue(S.gameId);
		Scene.Name = Ue(S.name);
		for (const std::string& T : S.tags) Scene.Tags.Add(Ue(T));
		for (const patter::OutlineBlock& B : S.blocks)
		{
			FPatterOutlineBlock Block;
			Block.Id = Ue(B.id);
			Block.GameId = Ue(B.gameId);
			Block.Name = Ue(B.name);
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
	for (const patter::OutlineFlatBeat& F : Engine->beatSequence())
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
