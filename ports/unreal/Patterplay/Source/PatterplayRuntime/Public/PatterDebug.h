// A tiny registry so the editor's "Runtime State" window can watch live engines during play. In
// your game, after creating an engine, call PatterDebug::Register (or UPatterEngine::RegisterForDebug)
// so the window can list it, read its @patter properties, and edit them. Parity with the Unity /
// Godot PatterDebug registries.
#pragma once

#include "CoreMinimal.h"
#include "UObject/WeakObjectPtr.h"

class UPatterEngine;

class PATTERPLAYRUNTIME_API FPatterDebug
{
public:
	// A registered live engine plus the label the window shows for it.
	struct FEntry
	{
		TWeakObjectPtr<UPatterEngine> Engine;
		FString Label;
	};

	// Fired whenever the registry changes so an open window can refresh its engine list.
	DECLARE_MULTICAST_DELEGATE(FOnRegistryChanged);

	static void Register(UPatterEngine* Engine, const FString& Label);
	static void Unregister(UPatterEngine* Engine);

	// Live engines, stalest weak pointers pruned. Safe to call from the editor tick.
	static TArray<FEntry> List();

	static FOnRegistryChanged& OnChanged();
};
