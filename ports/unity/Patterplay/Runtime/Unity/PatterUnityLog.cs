// Content errors in a Unity game land in the Console. The core runtime has no UnityEngine, so with no
// EngineOptions.OnError it reports a content error it played through (a condition that failed, an effect
// that was skipped) on standard error, which Unity's Console never shows. This points the core's default
// at Debug.LogWarning as soon as the package loads, in play mode and in the editor alike, so the warning
// is where a Unity developer looks. A game that sets EngineOptions.OnError gets its own handler instead,
// and one that wants something else for every engine can set Engine.DefaultOnError itself.

using UnityEngine;

namespace Patterkit.Patterplay
{
    public static class PatterUnityLog
    {
        /// <summary>Report one content error as a Console warning. The handler the Unity layer installs as
        /// <see cref="Engine.DefaultOnError"/>; hand it to <see cref="EngineOptions.OnError"/> to keep the
        /// warning while also doing something of your own.</summary>
        public static void LogWarning(PlayError error) => Debug.LogWarning("[Patterplay] " + error);

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void Install() => Engine.DefaultOnError = LogWarning;

#if UNITY_EDITOR
        // Engines built outside play mode (an editor tool, a test) report to the Console too.
        [UnityEditor.InitializeOnLoadMethod]
        private static void InstallInEditor() => Install();
#endif
    }
}
