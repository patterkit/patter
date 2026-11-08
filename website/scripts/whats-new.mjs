// ---------------------------------------------------------------------------
// The What's new page, generated from the changelogs before each build.
//
//   node scripts/whats-new.mjs
//
// It writes src/content/docs/whats-new.md (git-ignored) from the same material Patterpad's own What's
// New dialog shows, by the same rules (app-shell's changelog.ts; the writing rule is patterkit
// design/changelog-writing.md): for each release, every entry's preview, which is its bold lede and the
// rest of its first paragraph in whole sentences up to about forty words, Breaking entries first and
// marked, the fixes the same way under "Fixed", and a link to the full release notes on GitHub. A release
// that only carries another ("Patterplay 0.46.0 inside", "Nothing changed in the runtime") is one line
// rather than a heading. Patterpad first, then the Patterplay runtimes, whose four CHANGELOGs share one
// version; the JS runtime's stands for the set. A `### Highlights` section replaces the automatic list for
// its version, and a `### Announcement` entry is shown above it, as in the dialog.
//
// The changelogs keep the Keep a Changelog shape:
//
//   ## [0.47.0] - 2026-11-06
//   ### Added
//   - **Audio folders now take Ogg Vorbis recordings**, so a line's take can be ...
//     - a nested point, left to the full notes
//
// Only versioned, dated sections count; the runtime file's older Changesets entries below are skipped.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "src/content/docs/whats-new.md");
const SHOWN = 8; // releases per product; the rest are on GitHub
const REPO = "https://github.com/patterkit/patter";
/** About how many words of an entry the page shows (app-shell's PREVIEW_WORDS). */
export const PREVIEW_WORDS = 40;
const HEADLINE_SECTIONS = ["Breaking", "Added", "Changed", "Removed"];
/** A lede that only says a version went by (app-shell's CARRIER). */
const CARRIER = /\b\d+\.\d+\.\d+ inside\b|^nothing changed in the runtime\b/i;

const SOURCES = [
  {
    heading: "Patterpad",
    blurb: "The desktop editor. Its What's New dialog (Help menu) shows the same list in the app.",
    file: "../packages/patterpad/CHANGELOG.md",
    tag: (v) => `v${v}`,
  },
  {
    heading: "Patterplay",
    blurb: "The four runtimes (JavaScript, Unity, Unreal, Godot) share one version and move together; each runtime's zip carries its own notes.",
    file: "../packages/runtime/CHANGELOG.md",
    tag: (v) => `play-js-v${v}`,
  },
];

/** The versioned sections of a changelog, newest first as the file has them. */
export function parseChangelog(text) {
  const versions = [];
  let v = null;
  let section = null;
  let nested = false;
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const h2 = /^## \[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/.exec(raw);
    if (h2) {
      v = /^\d+\.\d+\.\d+/.test(h2[1]) && h2[2] ? { version: h2[1], date: h2[2], sections: new Map() } : null;
      if (v) versions.push(v);
      section = null;
      continue;
    }
    if (!v) continue;
    const h3 = /^### (\w+)/.exec(raw);
    if (h3) {
      section = h3[1];
      if (!v.sections.has(section)) v.sections.set(section, []);
      continue;
    }
    if (!section) continue;
    const entries = v.sections.get(section);
    if (/^- /.test(raw)) {
      entries.push(raw.slice(2).trim());
      nested = false;
    } else if (/^\s+- /.test(raw)) {
      nested = true; // a nested point, left to the full notes
    } else if (/^\s+\S/.test(raw) && entries.length && !nested) {
      entries[entries.length - 1] += " " + raw.trim(); // the entry carries on over the line
    }
  }
  return versions;
}

const words = (s) => s.split(/\s+/).filter(Boolean).length;

/** The sentences of a paragraph, each with its closing quote or bracket. A stop inside `code`, or one not
 *  followed by a space (a version number, a filename), doesn't end a sentence. */
function sentences(s) {
  const out = [];
  let start = 0;
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "`") code = !code;
    if (code || !/[.!?]/.test(c)) continue;
    let j = i + 1;
    while (j < s.length && /["”’)]/.test(s[j])) j++;
    if (j === s.length || /\s/.test(s[j])) {
      out.push(s.slice(start, j).trim());
      start = j;
      i = j - 1;
    }
  }
  const tail = s.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/** An entry's preview: the bold lede, then the rest of its first paragraph in whole sentences up to about
 *  `cap` words, links and code kept. An entry with no lede shows its first sentence. */
export function lead(entry, cap = PREVIEW_WORDS) {
  const m = /^\*\*(.+?)\*\*\s*(.*)$/.exec(entry);
  if (!m) return sentences(entry)[0] ?? entry;
  const [, bold, after] = m;
  const boldIsSentence = /[.!?:]["”’)]*$/.test(bold);
  let rest = "";
  let count = words(bold);
  const parts = sentences(after.replace(/:$/, "."));
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    const completes = i === 0 && !boldIsSentence; // a bold phrase is finished by its first sentence
    if (!completes && count + words(s) > cap) break; // and the preview ends at the first sentence that won't fit
    rest = rest ? `${rest} ${s}` : s;
    count += words(s);
  }
  if (!rest) return `**${bold}**`;
  const gap = /^[,;:.)]/.test(rest) ? "" : " ";
  return `**${bold}**${gap}${rest}`;
}

/** The bold lede alone, plain. */
const ledeOf = (entry) => (/^\*\*(.+?)\*\*/.exec(entry)?.[1] ?? entry).replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const prettyDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

/** True when the version's only entries say another release is inside it, and there's nothing else to say. */
export function isCarrier(v) {
  const shown = HEADLINE_SECTIONS.flatMap((k) => v.sections.get(k) ?? []);
  return !(v.sections.get("Highlights")?.length) && !(v.sections.get("Announcement")?.length)
    && !(v.sections.get("Fixed")?.length) && shown.length > 0 && shown.every((e) => CARRIER.test(ledeOf(e)));
}

export function render(sources) {
  const out = [];
  out.push("---");
  out.push("title: What's new");
  out.push("description: Each release of Patterpad and the Patterplay runtimes, newest first, with a link to its full notes.");
  out.push("sidebar:");
  out.push("  label: What's new");
  out.push("---");
  out.push("");
  out.push("Each release, newest first: what changed and what it means for you, in the words its changelog uses.");
  out.push("Patterpad shows the same list in its What's New dialog. The full notes, with every detail, are on");
  out.push(`[GitHub Releases](${REPO}/releases); the installers and runtime zips are on the [Download](/download/)`);
  out.push("page, and what a version number promises is on [Versions and compatibility](/compatibility/).");
  out.push("");
  for (const src of sources) {
    out.push(`## ${src.heading}`);
    out.push("");
    out.push(src.blurb);
    out.push("");
    for (const v of src.versions.slice(0, SHOWN)) {
      const notes = `[Full release notes](${REPO}/releases/tag/${src.tag(v.version)})`;
      if (isCarrier(v)) {
        // Only another release inside this one: the version, what it carried, and the link, on one line.
        const carried = HEADLINE_SECTIONS.flatMap((k) => v.sections.get(k) ?? []).map((e) => lead(e)).join(" ");
        out.push(`**${v.version}** (${prettyDate(v.date)}). ${carried} ${notes}.`);
        out.push("");
        continue;
      }
      out.push(`### ${v.version} (${prettyDate(v.date)})`);
      out.push("");
      for (const a of v.sections.get("Announcement") ?? []) {
        out.push(`:::tip[${ledeOf(a)}]`);
        out.push(a.replace(/^\*\*(.+?)\*\*\s*/, ""));
        out.push(":::");
        out.push("");
      }
      const highlights = v.sections.get("Highlights");
      const shown = highlights?.length
        ? highlights.map((e) => lead(e))
        : HEADLINE_SECTIONS.flatMap((k) => (v.sections.get(k) ?? []).map((e) => (k === "Breaking" ? `Breaking: ${lead(e)}` : lead(e))));
      for (const line of shown) out.push(`- ${line}`);
      const fixed = v.sections.get("Fixed") ?? [];
      if (fixed.length) {
        if (shown.length) out.push("");
        out.push("Fixed:");
        out.push("");
        for (const e of fixed) out.push(`- ${lead(e)}`);
      }
      out.push("");
      out.push(`${notes}.`);
      out.push("");
    }
    if (src.versions.length > SHOWN) {
      out.push(`Earlier ${src.heading} releases are on [GitHub Releases](${REPO}/releases).`);
      out.push("");
    }
  }
  return out.join("\n");
}

if (process.argv[1] && join(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sources = SOURCES.map((s) => ({ ...s, versions: parseChangelog(readFileSync(join(root, s.file), "utf8")) }));
  for (const s of sources) if (!s.versions.length) throw new Error(`whats-new: no dated releases found in ${s.file}`);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, render(sources) + "\n");
  console.log(`whats-new: wrote ${sources.map((s) => `${s.heading} ${s.versions[0].version}`).join(", ")}`);
}
