// Where each Patterplay runtime's source says its own version: the constant game code reads at runtime, so an
// extension (Patterstage, Pattershot) can check it's running on a Patterplay it was built for. The manifests
// can't do that on every engine (Unreal's .uplugin and Godot's plugin.cfg declare no version ranges), so the
// version lives in code too.
//
// Shared by `bump:play`, which writes the version into each one beside the manifests, and the lockstep check,
// which fails when one differs from them. Each pattern's one capture group is the version.

export const VERSION_CONSTANTS = [
  { rel: "packages/runtime/src/version.ts", pattern: /^export const PATTERPLAY_VERSION = "([^"]*)";$/m },
  { rel: "ports/unity/Patterplay/Runtime/PatterplayVersion.cs", pattern: /^\s*public const string Current = "([^"]*)";$/m },
  { rel: "ports/unreal/Patterplay/Source/PatterplayRuntime/Public/Patter/Version.h", pattern: /^\s*inline constexpr const char\* PatterplayVersion = "([^"]*)";$/m },
  { rel: "ports/godot/addons/patterplay/runtime/patterplay_version.gd", pattern: /^const CURRENT := "([^"]*)"$/m },
];

/** The version a constant's source says, or undefined when the pattern isn't found. */
export function readVersionConstant(source, { pattern }) {
  return pattern.exec(source)?.[1];
}

/** The source with the constant set to `version`. Throws when the pattern isn't found. */
export function writeVersionConstant(source, { rel, pattern }, version) {
  const m = pattern.exec(source);
  if (!m) throw new Error(`${rel}: no Patterplay version constant found`);
  const line = m[0].replace(`"${m[1]}"`, `"${version}"`);
  return source.slice(0, m.index) + line + source.slice(m.index + m[0].length);
}
