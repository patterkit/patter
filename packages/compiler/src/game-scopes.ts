// ---------------------------------------------------------------------------
// Shared game scopes (patterkit/design/shared-scopes.md): what the compiler makes of a game's
// `game-scopes/` folder, once the loader has read and merged it.
//
// Two kinds of scope come out of the folder:
//   - the project's HOST scopes, as today, except that the shared file wins where it declares the
//     same token: `game.scopes.json` is the source of the game's own scopes, and the project keeps
//     a synced copy of the ones it declares. `@world` from `game.scopes.json` joins them even when
//     the project doesn't declare it, because a standalone engine self-backs `@world` from the
//     bundle. These are strict (errors) and ship in the bundle's scopeRegistry.
//   - everything else in the folder (another engine's `@story`, a game scope such as `@player` the
//     project doesn't declare): EXTERNAL, as the family's other engines are, but checked from their
//     files. Every finding about one is a warning, never an error, because the other project may be a
//     save behind on someone's branch. Never bundled: `externalScopes` names them, and the game
//     registers them.
// Patter's own token (`patter`) is never read back from the folder: the project knows its own
// properties better than the file it last wrote.
// ---------------------------------------------------------------------------

import { GAME_SCOPES_DIR, GAME_SCOPES_FILE } from "@wildwinter/scoperegistry/scopes";
import type { MergedScopes } from "@wildwinter/scoperegistry/scopes";
import type { ScopeRegistrySpec, ScopeSpec } from "@wildwinter/scoperegistry";
import type { HostScopeRegistry, HostScopeSpec, ProjectFile } from "@patterkit/model";
import { hostScopesToSpec } from "@patterkit/dialect";

/** Patter's own game-wide token: the one scope Patter writes to the folder and never reads back. */
export const PATTER_SCOPE = "patter";

/** Something the folder says about the project's host scopes: a warning, anchored to a scopes file. */
export interface HostScopeNote {
  token: string;
  /** The scopes file it concerns, by name (`game.scopes.json`). */
  file: string;
  message: string;
}

/** A project's scopes once its game's folder is taken into account. */
export interface ProjectScopes {
  /** The host scopes the compile treats as the project's: validated strictly, baked into the bundle. */
  host?: HostScopeRegistry;
  /** Every other scope the folder declares, checked with warnings and never bundled. */
  external: ScopeSpec[];
  /** Where the project's host scopes and the folder disagree. */
  notes: HostScopeNote[];
}

/** A scopes-file scope as a host scope (the shapes match; `purpose` rides along as it does from World properties). */
function asHostScope(s: ScopeSpec): HostScopeSpec {
  return {
    token: s.token,
    ...(s.writable !== undefined ? { writable: s.writable } : {}),
    ...(s.declarations ? { declarations: s.declarations.map((d) => ({ ...d })) } : {}),
  };
}

/** Whether two host scopes declare the same thing, ignoring authoring notes (`purpose`). */
function sameScope(a: HostScopeSpec, b: HostScopeSpec): boolean {
  const norm = (s: HostScopeSpec): string => JSON.stringify(hostScopesToSpec({ version: 1, scopes: [s] }));
  return norm(a) === norm(b);
}

/**
 * The project's host scopes and the folder's other scopes, from a project and its game's merged
 * scopes. With no folder the host scopes are the project's own, untouched (the same object, so a
 * bundle's hash doesn't move), and there is nothing external.
 */
export function projectScopes(project: ProjectFile, merged?: MergedScopes): ProjectScopes {
  const own = project.scopeRegistry;
  if (!merged) return { host: own, external: [], notes: [] };

  const notes: HostScopeNote[] = [];
  const hosted: HostScopeSpec[] = [];
  const bundled = new Set<string>();
  let changed = false;
  const shared = (token: string): ScopeSpec | undefined =>
    token === PATTER_SCOPE ? undefined : merged.spec.scopes.find((s) => s.token === token);

  for (const h of own?.scopes ?? []) {
    const s = shared(h.token);
    const who = merged.owners.get(h.token);
    if (!s || !who) { hosted.push(h); bundled.add(h.token); continue; }
    if (who.fileName === GAME_SCOPES_FILE) {
      // The game's own scope: the shared file is the source, the project's copy the fallback.
      const fromFile = asHostScope(s);
      hosted.push(fromFile); bundled.add(h.token); changed = true;
      if (!sameScope(h, fromFile)) {
        notes.push({ token: h.token, file: who.fileName,
          message: `@${h.token} in World properties differs from ${GAME_SCOPES_DIR}/${who.fileName}, and the shared file wins: `
            + `saving Project Settings in Patterpad brings the project's copy up to date` });
      }
    } else {
      // Another tool's scope imported for checking: the folder has that tool's own file now.
      changed = true;
      notes.push({ token: h.token, file: who.fileName,
        message: `@${h.token} is declared in ${GAME_SCOPES_DIR}/${who.fileName}; remove it from World properties` });
    }
  }

  // `@world` from the game's file reaches the bundle even when the project doesn't declare it: a
  // standalone engine self-backs it from these defaults (the one place a shared file reaches a bundle).
  const world = shared("world");
  if (world && merged.owners.get("world")?.fileName === GAME_SCOPES_FILE && !bundled.has("world")) {
    hosted.push(asHostScope(world)); bundled.add("world"); changed = true;
  }

  const external = merged.spec.scopes.filter((s) => s.token !== PATTER_SCOPE && !bundled.has(s.token));
  const host = !changed ? own : hosted.length ? { version: own?.version ?? 1, scopes: hosted } : undefined;
  return { host, external, notes };
}

/**
 * The folder's scopes that a compile treats as external, given the host spec it is using: every merged
 * scope except Patter's own and the host spec's tokens. Empty with no folder.
 */
export function externalGameScopes(strict: ScopeRegistrySpec | undefined, merged?: MergedScopes): ScopeSpec[] {
  if (!merged) return [];
  const hostTokens = new Set((strict?.scopes ?? []).map((s) => s.token));
  return merged.spec.scopes.filter((s) => s.token !== PATTER_SCOPE && !hostTokens.has(s.token));
}
