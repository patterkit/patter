#include "Modules/ModuleManager.h"
#include "Framework/Application/SlateApplication.h"
#include "Framework/Docking/TabManager.h"
#include "Widgets/Docking/SDockTab.h"
#include "WorkspaceMenuStructure.h"
#include "WorkspaceMenuStructureModule.h"
#include "PropertyEditorModule.h"

#include "PatterBundleDetails.h"
#include "SPatterStatePanel.h"

#define LOCTEXT_NAMESPACE "PatterplayEditor"

static const FName PatterStateTabName(TEXT("PatterplayRuntimeState"));
static const FName PatterBundleClassName(TEXT("PatterBundle"));

// The editor module registers two things: a nomad tab (Window menu, under Tools) hosting the Runtime
// State inspector for LIVE engines, and the details customisation that turns a selected .patterc
// asset into the bundle inspector - the static read of what game code may call. The .patterc import
// factory is a self-registering UCLASS, so it needs nothing here beyond the module existing.
class FPatterplayEditorModule : public IModuleInterface
{
public:
	virtual void StartupModule() override
	{
		FGlobalTabmanager::Get()->RegisterNomadTabSpawner(
			PatterStateTabName,
			FOnSpawnTab::CreateRaw(this, &FPatterplayEditorModule::SpawnStateTab))
			.SetDisplayName(LOCTEXT("RuntimeStateTitle", "Patterplay Runtime State"))
			.SetTooltipText(LOCTEXT("RuntimeStateTip", "Watch and edit the @patter properties of live Patterplay engines."))
			.SetGroup(WorkspaceMenu::GetMenuStructure().GetToolsCategory());

		FPropertyEditorModule& PropertyEditor =
			FModuleManager::LoadModuleChecked<FPropertyEditorModule>("PropertyEditor");
		PropertyEditor.RegisterCustomClassLayout(
			PatterBundleClassName,
			FOnGetDetailCustomizationInstance::CreateStatic(&FPatterBundleDetails::MakeInstance));
		PropertyEditor.NotifyCustomizationModuleChanged();
	}

	virtual void ShutdownModule() override
	{
		if (FSlateApplication::IsInitialized())
		{
			FGlobalTabmanager::Get()->UnregisterNomadTabSpawner(PatterStateTabName);
		}
		if (FModuleManager::Get().IsModuleLoaded("PropertyEditor"))
		{
			FPropertyEditorModule& PropertyEditor =
				FModuleManager::GetModuleChecked<FPropertyEditorModule>("PropertyEditor");
			PropertyEditor.UnregisterCustomClassLayout(PatterBundleClassName);
			PropertyEditor.NotifyCustomizationModuleChanged();
		}
	}

private:
	TSharedRef<SDockTab> SpawnStateTab(const FSpawnTabArgs&)
	{
		return SNew(SDockTab)
			.TabRole(ETabRole::NomadTab)
			[
				SNew(SPatterStatePanel)
			];
	}
};

#undef LOCTEXT_NAMESPACE

IMPLEMENT_MODULE(FPatterplayEditorModule, PatterplayEditor);
