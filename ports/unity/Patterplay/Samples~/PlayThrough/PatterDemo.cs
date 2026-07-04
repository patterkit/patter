// Patterplay Unity demo: load the compiled demo bundle and play the flow, logging each
// step. Open the PlayThrough scene beside this file and press Play (or drop this on any
// GameObject and assign the imported demo.patterc to the Bundle field). Exercises the
// same API as the JS / Unreal / Godot demos.

using UnityEngine;

namespace Patterkit.Patterplay.Samples
{
    public sealed class PatterDemo : MonoBehaviour
    {
        [Tooltip("The imported demo.patterc (a PatterBundleAsset).")]
        public PatterBundleAsset Bundle;

        private void Start()
        {
            if (Bundle == null)
            {
                Debug.LogWarning("PatterDemo: assign a .patterc bundle to the Bundle field.");
                return;
            }

            var engine = Bundle.CreateEngine();
            PatterDebug.Register(engine);                  // so Window ▸ Patterplay ▸ Runtime State can watch it
            var flow = engine.OpenFlow("main", "demo");

            for (int i = 0; i < 100; i++)
            {
                var step = flow.Advance();
                switch (step.Type)
                {
                    case StepType.Line: Debug.Log($"{step.CharacterName ?? step.Character}: {step.Text}"); break;
                    case StepType.Text: Debug.Log(step.Text); break;
                    case StepType.Choice:
                    {
                        var pick = step.Options[0];        // the demo always takes the left path
                        Debug.Log($"> {pick.Prompt?.Text}");
                        flow.Choose(pick.Id);
                        break;
                    }
                    case StepType.End:
                        Debug.Log($"[end]  @gold = {engine.GetProperty("@gold")}");
                        return;
                }
            }
        }
    }
}
