#include "PatterDebug.h"
#include "PatterEngine.h"

// The live-engine registry is a debug-only affordance (it feeds the editor's Runtime State inspector,
// which itself lives in the editor-only module). Strip its work from Shipping builds so nothing holds
// engine references there; the API stays present as no-ops so callers compile unchanged.
#if !UE_BUILD_SHIPPING

namespace
{
	TArray<FPatterDebug::FEntry>& Registry()
	{
		static TArray<FPatterDebug::FEntry> Entries;
		return Entries;
	}

	FPatterDebug::FOnRegistryChanged& ChangedDelegate()
	{
		static FPatterDebug::FOnRegistryChanged Delegate;
		return Delegate;
	}

	// Drop entries whose engine has been GC'd. Returns true if anything was removed.
	bool Prune()
	{
		return Registry().RemoveAll([](const FPatterDebug::FEntry& E) { return !E.Engine.IsValid(); }) > 0;
	}
}

void FPatterDebug::Register(UPatterEngine* Engine, const FString& Label)
{
	if (!Engine) return;
	Prune();
	for (FEntry& E : Registry())
	{
		if (E.Engine.Get() == Engine) { E.Label = Label; ChangedDelegate().Broadcast(); return; }
	}
	Registry().Add(FEntry{ Engine, Label });
	ChangedDelegate().Broadcast();
}

void FPatterDebug::Unregister(UPatterEngine* Engine)
{
	const int32 Removed = Registry().RemoveAll([Engine](const FEntry& E) { return E.Engine.Get() == Engine; });
	if (Removed > 0) ChangedDelegate().Broadcast();
}

TArray<FPatterDebug::FEntry> FPatterDebug::List()
{
	Prune();
	return Registry();
}

FPatterDebug::FOnRegistryChanged& FPatterDebug::OnChanged()
{
	return ChangedDelegate();
}

#else // UE_BUILD_SHIPPING - no-op registry.

void FPatterDebug::Register(UPatterEngine*, const FString&) {}
void FPatterDebug::Unregister(UPatterEngine*) {}
TArray<FPatterDebug::FEntry> FPatterDebug::List() { return {}; }

FPatterDebug::FOnRegistryChanged& FPatterDebug::OnChanged()
{
	static FOnRegistryChanged Delegate;
	return Delegate;
}

#endif
