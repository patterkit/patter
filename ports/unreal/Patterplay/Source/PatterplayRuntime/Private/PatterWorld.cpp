#include "PatterWorld.h"
#include "Patter/Engine.h"

#include <vector>

/** Values in first-set order (Names() wants a stable order), keyed CASE-INSENSITIVELY: the
 *  compiler folds every property reference, so the story asks for "isnight" where the game wrote
 *  "isNight", exactly as the engine's own self-backed bag folds. The name as first written is kept
 *  for Names(). Beside them, the game's read-only names, and the slot the core's `get` pointer
 *  points into (it must stay valid until the next call on this scope). */
struct FPatterWorldImpl
{
	struct FEntry { std::string Key; std::string Name; patter::PatterValue Value; };
	std::vector<FEntry> Values;
	std::vector<std::string> ReadOnly;
	patter::PatterValue Slot;

	static std::string Fold(const std::string& Name) { return patter::toLower(Name); }

	const FEntry* Find(const std::string& Name) const
	{
		const std::string K = Fold(Name);
		for (const auto& E : Values) if (E.Key == K) return &E;
		return nullptr;
	}
	void Put(const std::string& Name, const patter::PatterValue& Value)
	{
		const std::string K = Fold(Name);
		for (auto& E : Values) if (E.Key == K) { E.Value = Value; return; }
		Values.push_back({ K, Name, Value });
	}
	bool IsReadOnly(const std::string& Name) const
	{
		const std::string K = Fold(Name);
		for (const auto& R : ReadOnly) if (R == K) return true;
		return false;
	}
};

namespace
{
	std::string Std(const FString& S) { return std::string(TCHAR_TO_UTF8(*S)); }
	FString Ue(const std::string& S) { return FString(UTF8_TO_TCHAR(S.c_str())); }

	FPatterValue ToUe(const patter::PatterValue& V)
	{
		FPatterValue Out;
		switch (V.kind)
		{
			case patter::PatterKind::Bool:   Out.Kind = EPatterValueKind::Boolean; Out.bBool = V.asBool(); break;
			case patter::PatterKind::Number: Out.Kind = EPatterValueKind::Number; Out.Number = V.asNumber(); break;
			case patter::PatterKind::Str:    Out.Kind = EPatterValueKind::String; Out.String = Ue(V.asString()); break;
			default:
				Out.Kind = EPatterValueKind::Flags;
				for (const std::string& F : V.asFlags()) Out.Flags.Add(Ue(F));
				break;
		}
		Out.Display = Ue(V.toDisplayString());
		return Out;
	}
}

UPatterWorld::UPatterWorld()
{
	Impl = MakePimpl<FPatterWorldImpl>();
}

// --- the host's writes ---------------------------------------------------------

void UPatterWorld::SetBool(const FString& Name, bool bValue) { HostSet(Std(Name), patter::PatterValue::Bool(bValue)); }
void UPatterWorld::SetNumber(const FString& Name, double Value) { HostSet(Std(Name), patter::PatterValue::Num(Value)); }
void UPatterWorld::SetString(const FString& Name, const FString& Value) { HostSet(Std(Name), patter::PatterValue::Str(Std(Value))); }
void UPatterWorld::SetFlags(const FString& Name, const TArray<FString>& Values)
{
	std::vector<std::string> Flags;
	Flags.reserve(static_cast<size_t>(Values.Num()));
	for (const FString& V : Values) Flags.push_back(Std(V));
	HostSet(Std(Name), patter::PatterValue::Flags(std::move(Flags)));
}

// --- reads ------------------------------------------------------------------------

bool UPatterWorld::Has(const FString& Name) const { return Impl->Find(Std(Name)) != nullptr; }

bool UPatterWorld::GetValue(const FString& Name, FPatterValue& OutValue) const
{
	const FPatterWorldImpl::FEntry* E = Impl->Find(Std(Name));
	if (!E) { OutValue = FPatterValue(); return false; }
	OutValue = ToUe(E->Value);
	return true;
}

bool UPatterWorld::GetBool(const FString& Name) const
{
	const FPatterWorldImpl::FEntry* E = Impl->Find(Std(Name));
	return E && E->Value.isBool() ? E->Value.asBool() : false;
}

double UPatterWorld::GetNumber(const FString& Name) const
{
	const FPatterWorldImpl::FEntry* E = Impl->Find(Std(Name));
	return E && E->Value.isNumber() ? E->Value.asNumber() : 0.0;
}

FString UPatterWorld::GetString(const FString& Name) const
{
	const FPatterWorldImpl::FEntry* E = Impl->Find(Std(Name));
	return E ? Ue(E->Value.toDisplayString()) : FString();
}

TArray<FString> UPatterWorld::GetFlags(const FString& Name) const
{
	TArray<FString> Out;
	const FPatterWorldImpl::FEntry* E = Impl->Find(Std(Name));
	if (E && E->Value.isFlags()) for (const std::string& F : E->Value.asFlags()) Out.Add(Ue(F));
	return Out;
}

TArray<FString> UPatterWorld::Names() const
{
	TArray<FString> Out;
	for (const auto& E : Impl->Values) Out.Add(Ue(E.Name));
	return Out;
}

// --- the game's policy ---------------------------------------------------------

void UPatterWorld::SetReadOnly(const FString& Name, bool bReadOnly)
{
	const std::string K = FPatterWorldImpl::Fold(Std(Name));
	auto& RO = Impl->ReadOnly;
	for (auto It = RO.begin(); It != RO.end(); ++It)
	{
		if (*It == K)
		{
			if (!bReadOnly) RO.erase(It);
			return;
		}
	}
	if (bReadOnly) RO.push_back(K);
}

bool UPatterWorld::IsReadOnly(const FString& Name) const { return Impl->IsReadOnly(Std(Name)); }

// --- C++ seam ---------------------------------------------------------------------

bool UPatterWorld::Get(const std::string& Name, patter::PatterValue& OutValue) const
{
	const FPatterWorldImpl::FEntry* E = Impl->Find(Name);
	if (!E) return false;
	OutValue = E->Value;
	return true;
}

void UPatterWorld::HostSet(const std::string& Name, const patter::PatterValue& Value)
{
	Impl->Put(Name, Value);
	OnChanged.Broadcast(Ue(Name), ToUe(Value), false);
}

void UPatterWorld::StorySet(const std::string& Name, const patter::PatterValue& Value)
{
	if (Impl->IsReadOnly(Name))
	{
		// The wrapper's guarded calls (Advance, Choose, SetProperty*) catch this, log it, and the step
		// fails; the story's write never lands. Worded to say whose rule it was.
		throw patter::EvalError("@world." + Name + " is the game's alone: a story tried to set it");
	}
	Impl->Put(Name, Value);
	OnChanged.Broadcast(Ue(Name), ToUe(Value), true);
}

patter::HostScope UPatterWorld::MakeHostScope()
{
	// Weak: a game that drops its world while an engine still holds the scope must read unset, not
	// crash. The core's `get` contract is a pointer valid until the next call on this scope, which the
	// slot inside the world satisfies without the core knowing where the value came from.
	TWeakObjectPtr<UPatterWorld> Weak(this);
	patter::HostScope S;
	S.get = [Weak](const std::string& Name) -> const patter::PatterValue*
	{
		UPatterWorld* W = Weak.Get();
		if (!W) return nullptr;
		const FPatterWorldImpl::FEntry* E = W->Impl->Find(Name);
		if (!E) return nullptr;
		W->Impl->Slot = E->Value;
		return &W->Impl->Slot;
	};
	S.set = [Weak](const std::string& Name, const patter::PatterValue& Value)
	{
		if (UPatterWorld* W = Weak.Get()) W->StorySet(Name, Value);
	};
	return S;
}
