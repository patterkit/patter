#include "Modules/ModuleManager.h"
#include "Framework/Application/SlateApplication.h"
#include "Framework/Docking/TabManager.h"
#include "Widgets/Docking/SDockTab.h"
#include "WorkspaceMenuStructure.h"
#include "WorkspaceMenuStructureModule.h"

#include "SPatterStatePanel.h"

#define LOCTEXT_NAMESPACE "PatterplayEditor"

static const FName PatterStateTabName(TEXT("PatterplayRuntimeState"));

// The editor module registers a nomad tab (Window menu, under Tools) that hosts the Runtime State
// inspector for live Patterplay engines. The .patterc import factory is a self-registering UCLASS,
// so it needs nothing here beyond the module existing.
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
	}

	virtual void ShutdownModule() override
	{
		if (FSlateApplication::IsInitialized())
		{
			FGlobalTabmanager::Get()->UnregisterNomadTabSpawner(PatterStateTabName);
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
