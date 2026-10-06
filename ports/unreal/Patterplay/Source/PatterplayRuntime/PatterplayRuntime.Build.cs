using UnrealBuildTool;

public class PatterplayRuntime : ModuleRules
{
	public PatterplayRuntime(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;

		// The UObject layer's shared conversions live once, in Private/PatterConvert.h, so the module
		// builds in unity (jumbo) mode like any other: no two files define the same file-local helper.

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
