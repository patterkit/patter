using UnrealBuildTool;

public class PatterplayDemoEditorTarget : TargetRules
{
	public PatterplayDemoEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("PatterplayDemo");
	}
}
