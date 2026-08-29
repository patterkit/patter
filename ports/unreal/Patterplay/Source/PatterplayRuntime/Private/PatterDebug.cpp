#include "PatterDebug.h"
#include "PatterEngine.h"
#include "PatterDebugLink.h"

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

	TArray<TWeakPtr<FPatterDebugLink>>& LinkRegistry()
	{
		static TArray<TWeakPtr<FPatterDebugLink>> Links;
		return Links;
	}

	void PruneLinks()
	{
		LinkRegistry().RemoveAll([](const TWeakPtr<FPatterDebugLink>& L) { return !L.IsValid(); });
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

void FPatterDebug::RegisterLink(const TSharedPtr<FPatterDebugLink>& Link)
{
	if (!Link.IsValid()) return;
	PruneLinks();
	for (const TWeakPtr<FPatterDebugLink>& L : LinkRegistry())
	{
		if (L.Pin() == Link) return;
	}
	LinkRegistry().Add(Link);
	ChangedDelegate().Broadcast();
}

void FPatterDebug::UnregisterLink(const TSharedPtr<FPatterDebugLink>& Link)
{
	const int32 Removed = LinkRegistry().RemoveAll([&Link](const TWeakPtr<FPatterDebugLink>& L) { return !L.IsValid() || L.Pin() == Link; });
	if (Removed > 0) ChangedDelegate().Broadcast();
}

TArray<TSharedPtr<FPatterDebugLink>> FPatterDebug::Links()
{
	PruneLinks();
	TArray<TSharedPtr<FPatterDebugLink>> Out;
	for (const TWeakPtr<FPatterDebugLink>& L : LinkRegistry())
	{
		if (TSharedPtr<FPatterDebugLink> Pinned = L.Pin()) Out.Add(Pinned);
	}
	return Out;
}

#else // UE_BUILD_SHIPPING - no-op registry.

void FPatterDebug::Register(UPatterEngine*, const FString&) {}
void FPatterDebug::Unregister(UPatterEngine*) {}
TArray<FPatterDebug::FEntry> FPatterDebug::List() { return {}; }
void FPatterDebug::RegisterLink(const TSharedPtr<FPatterDebugLink>&) {}
void FPatterDebug::UnregisterLink(const TSharedPtr<FPatterDebugLink>&) {}
TArray<TSharedPtr<FPatterDebugLink>> FPatterDebug::Links() { return {}; }

FPatterDebug::FOnRegistryChanged& FPatterDebug::OnChanged()
{
	static FOnRegistryChanged Delegate;
	return Delegate;
}

#endif
