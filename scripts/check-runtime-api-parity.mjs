// Verify the four Patterplay runtimes expose the SAME public API surface.
//
// Why this exists, and why the corpus is not enough:
//
//   The conformance corpus pins BEHAVIOUR - but only of the calls a corpus case actually makes. Its
//   scripts drive `advance` one beat at a time, so `advanceToStop` (JS-only for months) was never
//   called by any case and nothing noticed the three native ports lacked it. An API that no case
//   exercises can live on one runtime alone, indefinitely, with every gate green. The same shape bit
//   the Unreal BLUEPRINT wrapper, which lagged its own C++ core.
//
//   So: the corpus proves the runtimes AGREE about what they both do; this proves they both HAVE it.
//   Together they are the lockstep contract. (check-runtime-lockstep.mjs covers the third axis: that
//   they ship the same version number.)
//
// This is a presence check, not a signature check - it catches "the port never got this method",
// which is the failure that actually happens. Add every new public runtime API here IN THE SAME
// COMMIT that adds it; a member missing anywhere fails CI.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => (existsSync(resolve(root, rel)) ? readFileSync(resolve(root, rel), "utf8") : null);

/** The surfaces we hold to parity. `bp` (the Unreal Blueprint wrapper) is the API Unreal USERS see. */
const SURFACES = {
  js: { label: "JS (packages/runtime + play-helpers)", files: ["packages/runtime/src/engine.ts", "packages/runtime/src/describe.ts", "packages/play-helpers/src/bundle-inspector.ts", "packages/play-helpers/src/logger.ts", "packages/play-helpers/src/save.ts"] },
  unity: { label: "Unity (C#)", files: ["ports/unity/Patterplay/Runtime/Engine.cs", "ports/unity/Patterplay/Runtime/Flow.cs", "ports/unity/Patterplay/Runtime/BundleDescription.cs", "ports/unity/Patterplay/Editor/PatterBundleAssetEditor.cs", "ports/unity/Patterplay/Runtime/StateLogger.cs", "ports/unity/Patterplay/Runtime/Json/PatterSave.cs"] },
  godot: { label: "Godot (GDScript)", files: ["ports/godot/addons/patterplay/runtime/engine.gd", "ports/godot/addons/patterplay/runtime/flow.gd", "ports/godot/addons/patterplay/runtime/describe.gd", "ports/godot/addons/patterplay/editor/patter_bundle_inspector_plugin.gd", "ports/godot/addons/patterplay/runtime/logger.gd", "ports/godot/addons/patterplay/runtime/save.gd"] },
  unreal: { label: "Unreal (std C++ core)", files: ["ports/unreal/Patterplay/Source/PatterplayRuntime/Public/Patter/Engine.h", "ports/unreal/Patterplay/Source/PatterplayRuntime/Public/Patter/Describe.h", "ports/unreal/Patterplay/Source/PatterplayEditor/Private/PatterBundleDetails.cpp", "ports/unreal/Patterplay/Source/PatterplayRuntime/Public/Patter/StateLogger.h", "ports/unreal/Patterplay/Source/PatterplayRuntime/Public/Patter/Save.h"] },
  bp: { label: "Unreal (Blueprint wrapper)", files: ["ports/unreal/Patterplay/Source/PatterplayRuntime/Public/PatterEngine.h", "ports/unreal/Patterplay/Source/PatterplayRuntime/Public/PatterSave.h"] },
};

/** How a declaration of `name` looks in each language. */
const DECL = {
  js: (n) => new RegExp(`(^|\\n)\\s*(export\\s+function\\s+|get\\s+)?${n}\\s*[(<]`), // class method / getter / exported function
  unity: (n) => new RegExp(`\\b(public|internal)\\b[^;\\n]*\\b${n}\\s*[({=]`), // method or expression-bodied property
  godot: (n) => new RegExp(`\\n(static\\s+)?func\\s+${n}\\s*\\(`),
  unreal: (n) => new RegExp(`\\b${n}\\s*\\(`),
  bp: (n) => new RegExp(`\\b${n}\\s*\\(`),
};

// The public runtime API. One row per member; the value is that runtime's spelling, or `null` where
// the member genuinely does not belong on that surface (with a reason - never use null to paper over
// a gap). C++ uses `gotoAddress` because `goto` is a reserved word.
const API = [
  // --- playing a flow -------------------------------------------------------
  { on: "Flow", js: "advance", unity: "Advance", godot: "advance", unreal: "advance", bp: "Advance" },
  { on: "Flow", js: "advanceToStop", unity: "AdvanceToStop", godot: "advance_to_stop", unreal: "advanceToStop", bp: "AdvanceToStop" },
  { on: "Flow", js: "getChoices", unity: "GetChoices", godot: "get_choices", unreal: "getChoices", bp: null,
    why: "Blueprint reads the options off the choice step instead" },
  { on: "Flow", js: "choose", unity: "Choose", godot: "choose", unreal: "choose", bp: "Choose" },
  { on: "Flow", js: "isEnded", unity: "IsEnded", godot: "is_ended", unreal: "isEnded", bp: "IsEnded" },
  { on: "Flow", js: "currentScene", unity: "CurrentScene", godot: "current_scene", unreal: "currentScene", bp: "CurrentScene" },

  // --- host navigation ------------------------------------------------------
  { on: "Flow", js: "goto", unity: "Goto", godot: "goto", unreal: "gotoAddress", bp: "Goto" },
  { on: "Flow", js: "close", unity: "Close", godot: "close", unreal: "close", bp: null,
    why: "engine-managed; Blueprint sees it through IsClosed" },
  { on: "Flow", js: "isClosed", unity: "IsClosed", godot: "is_closed", unreal: "isClosed", bp: "IsClosed" },
  { on: "Engine", js: "runFlow", unity: "RunFlow", godot: "run_flow", unreal: "runFlow", bp: "RunFlow" },

  // --- flow lifecycle -------------------------------------------------------
  { on: "Engine", js: "openFlow", unity: "OpenFlow", godot: "open_flow", unreal: "openFlow", bp: "OpenFlow" },
  { on: "Engine", js: "getFlow", unity: "GetFlow", godot: "get_flow", unreal: "getFlow", bp: null,
    why: "OpenFlow hands back the UPatterFlow the caller keeps" },
  { on: "Engine", js: "closeFlow", unity: "CloseFlow", godot: "close_flow", unreal: "closeFlow", bp: null,
    why: "not yet surfaced to Blueprint" },
  { on: "Engine", js: "reset", unity: "Reset", godot: "reset", unreal: "reset", bp: null,
    why: "not yet surfaced to Blueprint" },

  // --- state ----------------------------------------------------------------
  { on: "Engine", js: "getProperty", unity: "GetProperty", godot: "get_property", unreal: "getProperty", bp: null,
    why: "Blueprint has typed accessors (GetPropertyNumber / String / Bool)" },
  { on: "Engine", js: "setProperty", unity: "SetProperty", godot: "set_property", unreal: "setProperty", bp: null,
    why: "Blueprint has typed setters" },
  { on: "Engine", js: "listProperties", unity: "ListProperties", godot: "list_properties", unreal: "listProperties", bp: "ListProperties" },
  { on: "Engine", js: "saveGame", unity: "SaveGame", godot: "save_game", unreal: "saveGame", bp: null,
    why: "Blueprint saves via the PatterSave helper" },
  { on: "Engine", js: "loadGame", unity: "LoadGame", godot: "load_game", unreal: "loadGame", bp: null,
    why: "Blueprint loads via the PatterSave helper" },

  // --- addressing + introspection ------------------------------------------
  { on: "Engine", js: "sceneAddress", unity: "SceneAddress", godot: "scene_address", unreal: "sceneAddress", bp: null,
    why: "not yet surfaced to Blueprint" },
  { on: "Engine", js: "blockAddress", unity: "BlockAddress", godot: "block_address", unreal: "blockAddress", bp: null,
    why: "not yet surfaced to Blueprint" },
  { on: "Engine", js: "getOutline", unity: "GetOutline", godot: "get_outline", unreal: "listOutline", bp: "GetOutline" },
  { on: "Engine", js: "getBeatSequence", unity: "GetBeatSequence", godot: "get_beat_sequence", unreal: "beatSequence", bp: "GetBeatSequence" },
  { on: "Engine", js: "tagsForBeat", unity: "TagsForBeat", godot: "tags_for_beat", unreal: "tagsForBeat", bp: "TagsForBeat" },
  { on: "Engine", js: "tagsForScene", unity: "TagsForScene", godot: "tags_for_scene", unreal: "tagsForScene", bp: null,
    why: "not yet surfaced to Blueprint" },
  { on: "Engine", js: "tagsForBlock", unity: "TagsForBlock", godot: "tags_for_block", unreal: "tagsForBlock", bp: null,
    why: "not yet surfaced to Blueprint" },

  // --- the bundle inspector (from-storylets/patterplay-bundle-inspector) ----
  //
  // A BUNDLE-level function on every surface, deliberately not an Engine method: it answers what a
  // game may call on an imported asset, with nothing running. Spelled as a free function where the
  // language has them and as a static on a holder where it does not.
  { on: "Bundle", js: "describeBundle", unity: "Describe", godot: "describe_bundle", unreal: "describeBundle", bp: null,
    why: "the Unreal view is an IDetailCustomization in C++; no Blueprint node consumes a description" },
  //
  // And the VIEW that draws it, one idiom probe per engine. These are not one member under four
  // names: each is the hook its engine actually offers, which is the point - the summary is shared,
  // the way you reach it is the engine's own. A missing row here means an engine got the data and
  // no way to look at it, which is exactly how this work could rot.
  { on: "BundleView", js: "createBundleInspector", unity: "OnInspectorGUI", godot: null, unreal: "CustomizeDetails", bp: null,
    why: "Godot's view is OFF since 0.4.4 (#45): its inspector needs the .patterc imported as a Resource, and "
       + "that stopped the source file shipping in an export, which broke every existing project's build. The "
       + "code is still in addons/patterplay/editor, unregistered, and this row goes back to `_can_handle` when "
       + "an export-safe design is proven against a real exported build. Unreal: the details customisation IS "
       + "the view; a Blueprint node would be a second surface for the same read" },

  // --- save envelope + state logger (dev tools; parity brief B1/B2) ---------
  { on: "Save", js: "serializeState", unity: "SerializeState", godot: "serialize_state", unreal: "serializeState", bp: "SaveStateToJson" },
  { on: "Save", js: "deserializeState", unity: "DeserializeState", godot: "deserialize_state", unreal: "deserializeState", bp: "LoadStateFromJson" },
  { on: "Logger", js: "snapshotState", unity: "SnapshotState", godot: "snapshot_state", unreal: "snapshotState", bp: null,
    why: "dev tool; Blueprint users watch state in the editor panel" },
  { on: "Logger", js: "diffState", unity: "DiffState", godot: "diff_state", unreal: "diffState", bp: null,
    why: "dev tool; Blueprint users watch state in the editor panel" },
  { on: "Logger", js: "createStateLogger", unity: "CreateStateLogger", godot: null, unreal: null, bp: null,
    godotWhy: true, why: "Godot: PatterStateLogger.new() IS the constructor; Unreal: patter::StateLogger(engine, sink, label) likewise; Blueprint as above" },

  // --- live refresh + presentation -----------------------------------------
  { on: "Engine", js: "setLocale", unity: "SetLocale", godot: "set_locale", unreal: "setLocale", bp: "SetLocale" },
  { on: "Engine", js: "setClosedCaptions", unity: "SetClosedCaptions", godot: "set_closed_captions", unreal: "setClosedCaptions", bp: "SetClosedCaptions" },
  { on: "Engine", js: "replaceStrings", unity: "ReplaceStrings", godot: "replace_strings", unreal: "replaceStrings", bp: null,
    why: "Blueprint refreshes through the debug link" },
];

const sources = Object.fromEntries(
  Object.entries(SURFACES).map(([key, s]) => [key, s.files.map(read).filter((t) => t !== null).join("\n")]),
);

for (const [key, s] of Object.entries(SURFACES)) {
  if (!sources[key]) {
    console.error(`check-runtime-api-parity: cannot read any source for ${s.label} - paths moved?`);
    process.exit(2);
  }
}

const missing = [];
for (const row of API) {
  for (const key of Object.keys(SURFACES)) {
    const name = row[key];
    if (name == null) continue; // deliberately absent here (see `why`)
    if (!DECL[key](name).test(sources[key])) {
      missing.push(`  ${row.on}.${row.js}  ->  MISSING from ${SURFACES[key].label} (expected \`${name}\`)`);
    }
  }
}

if (missing.length) {
  console.error("Patterplay runtime API parity FAILED - the four runtimes must expose the same surface:\n");
  console.error(missing.join("\n"));
  console.error(`
Fix by implementing the member on the runtime(s) above, in this commit. If it genuinely does not
belong there, set that column to null in scripts/check-runtime-api-parity.mjs with a \`why\`.`);
  process.exit(1);
}

console.log(`Patterplay runtime API parity OK - ${API.length} members across ${Object.keys(SURFACES).length} surfaces.`);
