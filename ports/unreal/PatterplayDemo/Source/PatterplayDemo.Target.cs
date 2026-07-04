using UnrealBuildTool;

public class PatterplayDemoTarget : TargetRules
{
	public PatterplayDemoTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("PatterplayDemo");
	}
}
