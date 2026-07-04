// ---------------------------------------------------------------------------
// Audio resolver (#206): map a beat id to the path/URL of its winning audio
// take, using the `patteraudio.json` manifest Patterpad (or the CLI) emits next
// to the Audio Folders. It RESOLVES ONLY - playback stays yours (Web Audio, an
// <audio> element, etc.), which can't be portable across platforms anyway.
//
// The manifest already encodes the highest-rung "winner" per beat, so there's no
// folder search at runtime. Deploy your audio folder somewhere your game can read
// (e.g. under /public), fetch the manifest once, and:
//
//   const audio = createAudioResolver(manifestJson, "audio");   // base = where the folder is served
//   const src = audio.resolve(step.id);   // "audio/final/L1.wav", or null when the beat has no recording
//   if (src) new Audio(src).play();
// ---------------------------------------------------------------------------

export interface AudioResolver {
  /** The full path/URL of a beat's winning audio take, or null when it has none. */
  resolve(beatId: string): string | null;
}

interface AudioManifest {
  schema?: string;
  clips?: Record<string, { file: string; status?: string }>;
}

/**
 * Build an audio resolver from a `patteraudio.json` manifest string plus the base path/URL its files live
 * under (wherever you deployed the audio folder). `resolve(beatId)` joins the base with the winning clip's
 * relative path, or returns null when the beat has no recording. Never throws on a missing beat.
 */
export function createAudioResolver(manifestJson: string, basePath: string): AudioResolver {
  const manifest = JSON.parse(manifestJson) as AudioManifest;
  const clips = manifest.clips ?? {};
  const base = basePath.replace(/[/\\]+$/, ""); // trim trailing slash(es); we add exactly one when joining
  return {
    resolve(beatId: string): string | null {
      const clip = clips[beatId];
      if (!clip || !clip.file) return null;
      return base ? `${base}/${clip.file}` : clip.file;
    },
  };
}
