# Patter plugins

A design proposal, not yet built. Nothing here describes how Patter or Patterpad behave today, except where it
says "exists".

## Summary

Tools built on Patter need data and controls of their own: Patterstage's dialogue types, Pattershot's staging,
Pattersync's binding from snippet to animation. Today the only place for that data is gameData, which works but
shows up in Patterpad as unexplained fields, holds only scalars, and lives in the same shards as the writing.

This proposal adds a **plugin system** with one rule:

**Patter knows that plugin data exists, and its shape, but never its meaning.**

The pieces:

- **Plugin shards.** Each plugin's data lives in its own shards, keyed by node id, beside the flow and locale
  shards. Patter's core, the CLI, the compiler and the merge preserve it losslessly, whether or not the plugin is
  installed.
- **A declarative manifest** (tier 1), committed in the project: the plugin's fields and their types, where they
  appear in Patterpad, their labels and help, simple validation, and what compiles into the bundle. A manifest can
  also claim existing gameData fields and give them proper controls without moving them.
- **View plugins** (tier 2): a sandboxed web view in Patterpad for UI a manifest can't describe, such as
  Pattershot's performance sheet. It reads the project and writes only its own namespace.
- **A runtime accessor** in Patterplay, on all four runtimes, returning a plugin's data for a node.

## Why

- **Patterstage's settings deserve native controls.** `dialogueType` and the rest are gameData today: a writer sees
  a bare field with no explanation. A manifest gives them a proper control, a description, and validation, with no
  data migration.
- **Some data doesn't fit gameData.** Pattershot needs performance per character per line: a map keyed by cast
  token, holding records. gameData's field types are scalars (`text`, `multiline`, `number`, `boolean`, `enum`).
- **Some UI doesn't fit an inspector.** Pattershot's staging is a grid on a timeline, edited in a dedicated sheet.
- **Patter's core should stay Patter's.** Staging, dialogue management and animation sync are not part of the
  dialogue format, and shouldn't become part of it.

### Alternatives considered

| Option | For | Against |
|---|---|---|
| gameData only (today) | No work | Unexplained fields; scalars only; no custom UI; shares shards with the writing |
| A separate tool over Patter's data | No change to Patter; independent releases. Storyletter shows a paired tool works well for a different shape of work | Staging happens line by line beside the writing, so constant switching; two apps editing one project |
| **A plugin system** | Native controls in Patterpad; structured data; clean merges; Patter's core stays generic | A real feature to design and maintain |

A view plugin written as a web component keeps most of the separate tool's flexibility: Patterpad is one host, and
the same component could run standalone or in an engine editor's web view.

## Plugin data

### Shards

Each plugin has a shard per scene, plus one for the project:

```
plugins/<plugin-id>/<scene>.patterplug     data on that scene's nodes, keyed by node id
plugins/<plugin-id>/project.patterplug     project-wide data (a cast-pair table, a shot library)
```

The shards follow Patter's existing rules: UTF-8, JSON with comments and trailing commas, readable, line-by-line,
formatted by `patter format`, and nothing compiled. Keeping a plugin's data out of `.patterflow` and `.patterloc`
means a writer's rewrite and a staging pass touch different files.

A node's entry may hold data for any node kind the manifest allows: scene, block, group, snippet, beat, option.
Stable ids keep the data attached when a node moves or its text changes.

### The type system

The manifest's types are what let Patter merge, validate and present data it does not understand:

| Type | Holds | Merges |
|---|---|---|
| Scalar: `text`, `multiline`, `number`, `boolean`, `enum` | One value | Three-way: one side's change wins; two different changes clash |
| Reference: `cast`, `scene`, `block`, `snippet`, `line` | A cast token or a node id | As a scalar; validated to exist |
| `record` | Named fields, each typed | Field by field |
| `map` | Entries keyed by a cast token or a string, each typed | Key by key; then by the value's own type |
| `list` with an `id` field | Items with stable ids | Union by id; each item by its own type; order as with snippets |
| `list` without ids | Plain values | Whole: two different changes clash |

For example, Pattershot's per-line performance is a `map` keyed by `cast`, each value a `record` of `expression`,
`gesture` and `look`. Two people changing different characters' expressions on the same line merge cleanly; two
people changing the same character's expression to different values clash.

### Merge

Yes: Patter has to understand enough of plugin data to merge it, and the type system is exactly that much.
Patter already merges by node id, combines edits to different fields of one node, and records a real clash in a
`.patterconflict` file rather than leaving markers. Plugin shards join that:

1. **By node id**, as the flow already merges: entries for different nodes never clash.
2. **Within a node, by the manifest's types**, as in the table above.
3. **A real clash** keeps our side provisionally and is recorded in `.patterconflict`, so `patter validate` stops an
   unresolved merge from being built or shipped, as it does today.
4. **Without the manifest** (a plugin removed from the project, or a manifest that can't be read), a node's whole
   entry is merged as one value: different nodes still merge cleanly, and two changes to the same node's entry
   clash.
5. **A node deleted on one side while its plugin data is changed on the other** follows the format's existing rule
   for a deleted node. Data left without a node is kept and reported by `patter validate`, never silently dropped.

The merge reads the manifest from the project, not from what is installed, so the merge driver, the CLI and CI give
the same result on every machine.

## The manifest (tier 1)

A manifest is declarative: no code runs. It lives in the project, pinned by plugin id and version, so everyone on a
team sees the same controls and validation:

```
plugins/<plugin-id>/plugin.patterplug
```

It declares:

- **Identity**: id, name, version, and a link to its docs.
- **Fields**, by node kind, with the types above, defaults, and enum options with a description each.
- **Placement**: which inspector section a field appears in, its order, and its grouping.
- **Labels and help**: a name and a sentence or two for each field and each enum option, shown beside the control.
  This is the cure for unexplained gameData.
- **Validation**: required fields, ranges, references that must exist ("`to` must be a cast member in this
  scene"). `patter validate` and Patterpad both run it.
- **Compilation**: whether each field is compiled into the bundle for the runtime, or editor-only and stripped at
  export, as `.patterx` already is.
- **Claims on gameData fields**: a manifest can present a field that already lives in gameData (Patterstage's
  `dialogueType`) with its own control, description and validation, without moving the data. Existing projects
  need no migration.

Patterpad presents a plugin's fields as native controls in the inspector. A project that names a plugin whose
manifest is missing opens with a warning, and the data stays untouched.

## View plugins (tier 2)

For UI a manifest can't describe, a plugin provides a view: a web component Patterpad hosts in a sandboxed web
view, beside the script or in its own panel.

The host API is narrow:

- **Read** the project: scenes, the current snippet and selection, the cast, gameData, and other plugins' data.
- **Write only its own namespace**, through the host, as edits Patterpad can undo, save and lock like any other.
- **Read audio**: takes and their lengths from the audio index, and estimates for lines without audio.
- **Talk to a running game** over the existing debug link, through messages in the plugin's own namespace.
- **No filesystem, no network by default**, and no access to Node.

Tier 2 runs code, so it needs trust. View plugins are installed in Patterpad per machine, never run from a
project folder on open, and Patterpad asks before enabling one the first time. The project pins which version it
expects, and Patterpad warns on a mismatch.

## At runtime

The compiler carries each plugin's compiled fields into the bundle. Patterplay exposes them, on JavaScript, C#,
C++ and GDScript alike, through one accessor:

```ts
engine.pluginData("pattershot", nodeId);   // the node's entry, as plain values, or null
```

Values arrive as each runtime's plain data (objects and arrays, dictionaries, maps), with defaults from the
manifest filled in, as gameData's are today. Patter never interprets them: Patterstage, Pattershot and Pattersync
do.

## The CLI

`patter validate` runs each manifest's validation, reports orphaned plugin data and unknown plugins, and treats a
leftover `.patterconflict` in a plugin shard as it does any other. `patter format` formats plugin shards. The merge
driver and merge tool handle them as above. Export strips editor-only fields.

## First plugins

| Plugin | Tier | Adds |
|---|---|---|
| Patterstage | 1 | Native controls for dialogue type, advance mode and its other settings, claimed from existing gameData |
| Pattersync | 1 | A snippet's bound sequence; a line's lock-to-picture flag |
| Pattershot | 1 and 2 | Per-character performance, `to`, staging profiles, moments; the performance sheet |

Patterstage is the proving ground: it needs only tier 1, and it improves an existing product the day it ships.

## Phasing

1. **Plugin shards and the runtime accessor**: the format, the compiler, Patterplay on four runtimes, and the merge
   with the type system.
2. **Tier 1 manifests in Patterpad and the CLI**, proven on Patterstage's existing fields.
3. **Tier 2 view plugins**, proven on Pattershot's performance sheet.

## Open questions

- Should a manifest be able to declare a new beat kind (Pattershot's moment), or does that stay a core format
  change? A beat kind changes how a flow plays, so it probably belongs in Patter itself.
- How a view plugin's undo history interleaves with the script's.
- Whether plugins can read each other's data (useful: Pattershot reading Patterstage's dialogue type) and whether
  that needs declaring.
- How plugin fields appear in Patterpad's search and coverage views.
- A place to publish plugins, or only local installs at first.
