// Audio resolver (#206): map a beat id to the path of its winning audio take, using the
// `patteraudio.json` manifest Patterpad (or the CLI) emits next to the Audio Folders. It RESOLVES ONLY;
// playback stays yours (an AudioSource + a clip you load from the returned path). The manifest already
// encodes the highest-rung winner per beat, so there is no folder search at runtime. Mirrors the JS
// createAudioResolver. Uses Newtonsoft (the Unity .patterc loader's JSON), so it lives in the Json asmdef.
//
//   var audio = new PatterAudioResolver(manifestJson, Path.Combine(Application.streamingAssetsPath, "audio"));
//   string path = audio.Resolve(step.Id);   // full path, or null when the beat has no recording

using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace Patterkit.Patterplay
{
    public sealed class PatterAudioResolver
    {
        private readonly Dictionary<string, string> _files = new Dictionary<string, string>();
        private readonly string _base;

        /// <summary>Parse a patteraudio.json manifest; `basePath` is where you deployed the audio folder.</summary>
        public PatterAudioResolver(string manifestJson, string basePath)
        {
            _base = (basePath ?? "").TrimEnd('/', '\\');
            var root = JObject.Parse(manifestJson);
            if (root["clips"] is JObject clips)
            {
                foreach (var kv in clips)
                {
                    var file = (string)kv.Value?["file"];
                    if (!string.IsNullOrEmpty(file)) _files[kv.Key] = file;
                }
            }
        }

        /// <summary>The full path of a beat's winning audio take, or null when it has none. Never throws.</summary>
        public string Resolve(string beatId)
        {
            if (beatId == null || !_files.TryGetValue(beatId, out var file)) return null;
            return _base.Length > 0 ? _base + "/" + file : file;
        }
    }
}
