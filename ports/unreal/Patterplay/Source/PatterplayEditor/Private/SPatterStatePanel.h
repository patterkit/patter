// The "Patterplay Runtime State" editor panel: lists engines registered via PatterDebug and, for
// each, its shared @patter properties with type-aware editors (toggle / number / text / enum / flags)
// and a reset-to-default button. The Slate parity of the Unity PatterStateWindow / Godot state panel.
#pragma once

#include "CoreMinimal.h"
#include "Widgets/SCompoundWidget.h"

class SVerticalBox;
class UPatterEngine;
struct FPatterPropertyRow;

class SPatterStatePanel : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SPatterStatePanel) {}
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	virtual ~SPatterStatePanel() override;

private:
	// Repopulate the whole list from the current registry. Cheap: run only when the set of engines or
	// property refs changes; steady-state value updates ride on the per-widget bound getters.
	void Rebuild();

	// A fingerprint of the engine list + each engine's property refs (values excluded), used to detect
	// when a Rebuild() is actually needed.
	FString Signature() const;

	// One property's row: label, a type-aware editor, and a reset-to-default button.
	TSharedRef<SWidget> BuildRow(TWeakObjectPtr<UPatterEngine> Engine, const FPatterPropertyRow& Row);

	EActiveTimerReturnType OnRefresh(double InCurrentTime, float InDeltaTime);

	TSharedPtr<SVerticalBox> Body;
	FString LastSignature;
	FDelegateHandle ChangedHandle;

	// Enum option lists must outlive their SComboBox; rebuilt whenever the panel is.
	TArray<TSharedRef<TArray<TSharedPtr<FString>>>> EnumSources;
};
