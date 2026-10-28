// ---------------------------------------------------------------------------
// A game scope renamed in Project Settings ▸ Game scopes (`@player` to `@hero`), carried through every
// reference in the project, as Storyletter's renameScope carries one (Ian's ruling of 2026-10-28, patterkit
// design/hands-on-fixes-code-review-2026-10.md section 4):
//
//   - conditions on any node
//   - set effects (a scene's onEntry, a snippet's onEnter and onExit): the target and the value
//   - interpolation slots in every locale's strings, `{@player.hp}` to `{@hero.hp}`
//
// Each reference keeps its property name and takes the new token. An expression is rewritten in the
// author's own text where that reads back as the renamed tree, and written back from the tree only where it
// doesn't. A string literal that happens to hold `@player.` is left alone.
//
// Pure over copies of the scenes and strings: mutates them in place and reports what changed, for the
// settings save to write in the same batch (one undo step), as the stage rename beside it does.
//
// Also the save's own check of the scope names (the tab's rules, `scopeTokenProblem` in settings-world.ts).
// ---------------------------------------------------------------------------

import { parse, unparse } from "@wildwinter/expr";
import type { Dialect, ExprNode } from "@wildwinter/expr";
import { walkNodes } from "@patterkit/model";
import type { Effect, HostScopeSpec, LocaleFile, Scene } from "@patterkit/model";

const TOKEN = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Patter's own scopes: never a game's. */
const PATTER_OWN = ["patter", "scene", "flow"];
/** A slot's body when it is a bare reference (the dialect's `BARE_REF`). */
const BARE_REF = /^@[A-Za-z0-9_.]+$/;

/** Why the save refuses these scopes, or undefined. A malformed token, one of Patter's own, or the same
 *  token twice would compile into a project no expression can read the way it was meant. */
export function hostScopesProblem(scopes: readonly HostScopeSpec[]): string | undefined {
  const seen = new Set<string>();
  for (const s of scopes) {
    if (!TOKEN.test(s.token)) return `@${s.token} can't name a scope: a scope's name is letters, digits and _, and doesn't start with a digit.`;
    if (PATTER_OWN.includes(s.token)) return `@${s.token} is Patter's own scope, so the game can't provide it.`;
    if (seen.has(s.token)) return `There is more than one @${s.token} scope.`;
    seen.add(s.token);
  }
  return undefined;
}

/** `dialect` with each of `tokens` known as a scope, for reading text after a rename. */
export function withScopes(dialect: Dialect, tokens: Iterable<string>): Dialect {
  const extra = [...new Set(tokens)].filter((t) => !dialect.scopes.some((s) => s.token === t));
  return extra.length ? { ...dialect, scopes: [...dialect.scopes, ...extra.map((token) => ({ token }))] } : dialect;
}

/** `src` with every `@from.` outside a string literal written `@to.`, for every rename at once (so a swap
 *  of two tokens swaps them). */
function renameInText(src: string, renames: ReadonlyMap<string, string>): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const before = i > 0 ? src[i - 1]! : "";
    const head = c === "@" && !/[A-Za-z0-9_@.]/.test(before) ? /^[A-Za-z_][A-Za-z0-9_]*(?=\.)/.exec(src.slice(i + 1))?.[0] : undefined;
    const to = head !== undefined ? renames.get(head) : undefined;
    if (head !== undefined && to !== undefined) {
      out += `@${to}`;
      i += head.length + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * One expression (or a set effect's target) with each reference into a renamed scope (old token -> new,
 * all at once) moved to its new token, or undefined when it names none (or won't parse). `dialect` reads
 * the text as it is, `after` as it will be.
 */
export function renameScopesInExpression(src: string, renames: ReadonlyMap<string, string>, dialect: Dialect, after: Dialect = withScopes(dialect, renames.values())): string | undefined {
  let ast: ExprNode;
  try { ast = parse(src, dialect); } catch { return undefined; }
  let hits = 0;
  const walk = (n: ExprNode): ExprNode => {
    switch (n.kind) {
      case "scopedvar": {
        const to = renames.get(n.scope);
        if (to === undefined) return n;
        hits++;
        return { ...n, scope: to };
      }
      case "binary": return { ...n, left: walk(n.left), right: walk(n.right) };
      case "unary": return { ...n, operand: walk(n.operand) };
      case "call": return { ...n, args: n.args.map(walk) };
      default: return n;
    }
  };
  const next = walk(ast);
  if (hits === 0) return undefined;
  const text = renameInText(src, renames);
  try {
    if (JSON.stringify(parse(text, after)) === JSON.stringify(next)) return text;
  } catch { /* fall through to the tree */ }
  return unparse(next, after);
}

/** A localised string with each `{@from.x}` slot written `{@to.x}`, for every rename at once; escaped
 *  braces and other text kept exactly. The dialect's own reading of a slot: `{{` and `}}` are literal, and
 *  only a `{ ... }` whose trimmed body is a bare `@` reference is one. */
export function renameScopesInString(text: string, renames: ReadonlyMap<string, string>): string {
  if (!text.includes("{")) return text;
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if ((c === "{" || c === "}") && text[i + 1] === c) { out += c + c; i += 2; continue; }
    if (c === "{") {
      const close = text.indexOf("}", i + 1);
      if (close !== -1) {
        const raw = text.slice(i, close + 1);
        const inner = raw.slice(1, -1).trim();
        const parts = inner.slice(1).split(".");
        const to = BARE_REF.test(inner) && parts.length === 2 ? renames.get(parts[0]!) : undefined;
        out += to !== undefined ? raw.replace(`@${parts[0]}.`, `@${to}.`) : raw;
        i = close + 1;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

/** Every expression a scene holds: conditions, and each set effect's target and value. */
function sceneSites(scene: Scene): Array<{ get: () => string | undefined; set: (src: string) => void }> {
  const sites: Array<{ get: () => string | undefined; set: (src: string) => void }> = [];
  const effects = (list: Effect[] | undefined): void => {
    for (const e of list ?? []) {
      sites.push({ get: () => e.target, set: (src) => { e.target = src; } });
      sites.push({ get: () => e.value, set: (src) => { e.value = src; } });
    }
  };
  effects(scene.onEntry);
  for (const block of scene.blocks) {
    walkNodes(block.children, (node) => {
      if (typeof node.condition === "string") sites.push({ get: () => node.condition, set: (src) => { node.condition = src; } });
      if (node.type === "snippet") { effects(node.onEnter); effects(node.onExit); }
    });
  }
  return sites;
}

/** Carry scope renames (old token -> new) into one scene's expressions. Mutates it; returns how many
 *  expressions changed. `dialect` is the project's before the renames. */
export function renameScopesInScene(scene: Scene, renames: ReadonlyMap<string, string>, dialect: Dialect): number {
  const after = withScopes(dialect, renames.values());
  let count = 0;
  for (const site of sceneSites(scene)) {
    const src = site.get();
    if (src === undefined) continue;
    const next = renameScopesInExpression(src, renames, dialect, after);
    if (next === undefined) continue;
    site.set(next);
    count++;
  }
  return count;
}

/** Carry scope renames into every string of one locale file. Mutates it; true when any changed. */
export function renameScopesInLocale(loc: LocaleFile, renames: ReadonlyMap<string, string>): boolean {
  let changed = false;
  for (const [id, text] of Object.entries(loc.strings)) {
    const next = renameScopesInString(text, renames);
    if (next !== text) { loc.strings[id] = next; changed = true; }
  }
  return changed;
}
