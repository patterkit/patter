using UnrealBuildTool;

public class PatterplayEditor : ModuleRules
{
	public PatterplayEditor(ReadOnlyTargetRules Target) : base(Target)
	{
		// The state panel's Load path parses save JSON via the std core, which reports foreign
		// blobs with std::runtime_error (Patter/Save.h) - same setting as the runtime module.
		bEnableExceptions = true;

		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"UnrealEd",
			"PatterplayRuntime",
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"Slate",
			"SlateCore",
			"InputCore",
			"WorkspaceMenuStructure",
			"DesktopPlatform",   // native Save/Load file dialogs on the state panel
		});
	}
}
