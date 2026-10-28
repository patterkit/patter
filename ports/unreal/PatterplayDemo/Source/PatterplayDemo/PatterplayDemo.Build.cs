using UnrealBuildTool;

public class PatterplayDemo : ModuleRules
{
	public PatterplayDemo(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"Slate",
			"SlateCore",
			"UMG",   // the UMG example widget (TourRunnerWidget)
			"PatterplayRuntime",
		});
	}
}
