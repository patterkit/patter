using UnrealBuildTool;

public class PatterplayRuntime : ModuleRules
{
	public PatterplayRuntime(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;

		// The pure C++ engine under Public/Patter is header-only std code; several files
		// define same-named file-local helpers. Keep this module out of unity (jumbo) builds
		// so each .cpp is its own translation unit.
		bUseUnity = false;

		// The engine uses the C++ standard library (std::string / std::map / ...). Allow exceptions
		// for its std::runtime_error / EvalError use.
		bEnableExceptions = true;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"Json",
		});

		// The live debug link (FPatterDebugLink) is a debug-only tool: pull in the WebSockets module
		// everywhere EXCEPT Shipping, where the client compiles to no-ops (#if !UE_BUILD_SHIPPING).
		if (Target.Configuration != UnrealTargetConfiguration.Shipping)
		{
			PrivateDependencyModuleNames.Add("WebSockets");
		}
	}
}
