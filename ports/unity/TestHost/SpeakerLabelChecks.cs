// A line's speaker label, from the port's own side. Only a pair the bundle overrides (the cast's
// qualifierLabels) reads a `speaker:<name>:<gameId>` string: one a locale still holds for a pair the project
// no longer overrides is left alone, and that pair follows the pattern. A save written before choice prompts
// carried their label has none, so on load each saved line prompt (the pending choice's options, and the
// prompt still to be spoken back) works it out again in the current locale, and the next save carries it.

using System;
using System.Linq;
using System.Text.Json;

namespace Patterkit.Patterplay.TestHost
{
    internal static partial class Program
    {
        private const string SpeakerLabelBundleJson = @"{""schema"":""patter/bundle@0"",""locales"":{""default"":""en"",""included"":[""en"",""fr""]},
""cast"":[{""name"":""PLAYER"",""displayName"":""You"",""qualifierLabels"":{""os"":""Your call""}},{""name"":""TAM""}],
""qualifiers"":[{""gameId"":""vo"",""name"":""V.O.""},{""gameId"":""os"",""name"":""O.S.""}],
""scenes"":{""s"":{""id"":""s"",""type"":""scene"",""name"":""S"",""gameId"":""s"",""blocks"":[{""id"":""b"",""type"":""block"",""name"":""B"",""gameId"":""b"",""children"":[
{""id"":""sn"",""type"":""snippet"",""beats"":[{""id"":""L_vo"",""kind"":""line"",""character"":""PLAYER"",""qualifier"":""vo""},{""id"":""L_tam"",""kind"":""line"",""character"":""TAM"",""qualifier"":""vo""},{""id"":""L_os"",""kind"":""line"",""character"":""PLAYER"",""qualifier"":""os""}]},
{""id"":""g"",""type"":""group"",""selector"":""choice"",""children"":[{""id"":""o"",""type"":""group"",""prompt"":{""id"":""P"",""kind"":""line"",""character"":""PLAYER"",""qualifier"":""vo""},""children"":[{""id"":""sn_ans"",""type"":""snippet"",""beats"":[{""id"":""ANS"",""kind"":""text""}],""jump"":{""to"":""END""}}]}]}]}]}},
""strings"":{
""en"":{""L_vo"":""Quiet."",""L_tam"":""Hm."",""L_os"":""Hello?"",""P"":""Wonder."",""ANS"":""Yes."",""speaker:PLAYER:vo"":""Stale label"",""speaker:TAM:vo"":""Stale too""},
""fr"":{""L_vo"":""Calme."",""L_tam"":""Hm."",""L_os"":""Allo ?"",""P"":""Songer."",""ANS"":""Oui."",""cast:PLAYER"":""Vous"",""speaker:pattern"":""{qualifier} : {name}"",""speaker:PLAYER:os"":""Ton appel"",""speaker:PLAYER:vo"":""Encore perime""}}}";

        private static void RunSpeakerLabelChecks()
        {
            int before = _fails;
            Bundle bundle;
            using (var doc = JsonDocument.Parse(SpeakerLabelBundleJson)) bundle = ParseBundle(doc.RootElement);

            // A pair the bundle doesn't override ignores the `speaker:` string a locale holds for it.
            var flow = new Engine(bundle).OpenFlow("main", "s");
            var vo = flow.Advance();
            Check("speaker label: a stale speaker string for a pair not overridden is ignored", vo.SpeakerLabel == "You (V.O.)", $"got {vo.SpeakerLabel}");
            var tam = flow.Advance();
            Check("speaker label: the token stands in for a name the cast doesn't give", tam.SpeakerLabel == "TAM (V.O.)", $"got {tam.SpeakerLabel}");
            var os = flow.Advance();
            Check("speaker label: an overridden pair shows its own label", os.SpeakerLabel == "Your call", $"got {os.SpeakerLabel}");

            // In a translated locale: the stale string still ignored, the pattern translated, the override translated.
            var fr = new Engine(bundle, new EngineOptions { Locale = "fr" }).OpenFlow("main", "s");
            var frVo = fr.Advance();
            Check("speaker label: a stale translated speaker string is ignored too", frVo.SpeakerLabel == "V.O. : Vous", $"got {frVo.SpeakerLabel}");
            fr.Advance();
            var frOs = fr.Advance();
            Check("speaker label: an overridden pair's translation", frOs.SpeakerLabel == "Ton appel", $"got {frOs.SpeakerLabel}");

            // The step info reads the source locale, whatever the active one.
            var frEngine = new Engine(bundle, new EngineOptions { Locale = "fr" });
            var info = frEngine.GetBeatSequence().First(f => f.Beat.Id == "L_vo").Beat;
            Check("speaker label: the step info is at the source locale, a stale string ignored", info.SpeakerLabel == "You (V.O.)", $"got {info.SpeakerLabel}");

            // An older save: its pending choice prompt carries no label, so loading works it out in the current locale.
            var engine = new Engine(bundle);
            var stop = engine.OpenFlow("main", "s").AdvanceToStop().Stop;
            if (stop == null || stop.Type != StepType.Choice) { Fail("speaker-label", "choice", "the fixture did not stop at its choice"); return; }
            string json = PatterSave.SerializeState(engine);
            string aged = new System.Text.RegularExpressions.Regex(",\"speakerLabel\":\"[^\"]*\"").Replace(json, "");
            if (aged == json) { Fail("speaker-label", "envelope", "no prompt speakerLabel in the save to strip; the check would prove nothing"); return; }
            var loaded = new Engine(bundle);
            PatterSave.DeserializeState(loaded, aged);
            var prompt = loaded.GetFlow("main").GetChoices().Single().Prompt;
            Check("speaker label: an older saved prompt re-resolves its label", prompt.SpeakerLabel == "You (V.O.)", $"got {prompt.SpeakerLabel}");
            Check("speaker label: the re-saved prompt carries its label again", PatterSave.SerializeState(loaded) == json, PatterSave.SerializeState(loaded));
            var loadedFr = new Engine(bundle, new EngineOptions { Locale = "fr" });
            PatterSave.DeserializeState(loadedFr, aged);
            var promptFr = loadedFr.GetFlow("main").GetChoices().Single().Prompt;
            Check("speaker label: an older saved prompt re-resolves in the current locale", promptFr.SpeakerLabel == "V.O. : Vous", $"got {promptFr.SpeakerLabel}");

            // An older save taken between Choose and the next Advance: the prompt still to be spoken back carries
            // no label, so loading works it out too, and the replay shows it.
            var replaying = new Engine(bundle, new EngineOptions { ReplayPromptOnChoose = true });
            var rf = replaying.OpenFlow("main", "s");
            rf.AdvanceToStop();
            rf.Choose("o");
            json = PatterSave.SerializeState(replaying);
            aged = new System.Text.RegularExpressions.Regex(",\"speakerLabel\":\"[^\"]*\"").Replace(json, "");
            if (aged == json) { Fail("speaker-label", "envelope", "no pending prompt speakerLabel in the save to strip; the check would prove nothing"); return; }
            var replayLoaded = new Engine(bundle, new EngineOptions { ReplayPromptOnChoose = true, Locale = "fr" });
            PatterSave.DeserializeState(replayLoaded, aged);
            var replayed = replayLoaded.GetFlow("main").Advance();
            Check("speaker label: an older save works out the label of a prompt still to be spoken back",
                replayed.Id == "P" && replayed.SpeakerLabel == "V.O. : Vous", $"got {replayed.Id} with {replayed.SpeakerLabel}");

            if (_fails == before) Console.WriteLine("  [speaker-label] a stale speaker string for a pair not overridden is ignored; an older saved prompt, pending or to be spoken back, re-resolves its label");
        }
    }
}
