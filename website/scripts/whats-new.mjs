// ---------------------------------------------------------------------------
// The What's new page, generated from the changelogs before each build.
//
//   node scripts/whats-new.mjs
//
// It writes src/content/docs/whats-new.md (git-ignored) from the same material Patterpad's own What's
// New dialog shows (app-shell's changelog.ts reads the same file by the same rules): for each release,
// the lead of every Added, Changed and Removed entry, the count of fixes, and a link to the full release
// notes on GitHub. Patterpad first, then the Patterplay runtimes, whose four CHANGELOGs share one version;
// the JS runtime's stands for the set. A `### Highlights` section replaces the automatic list for its
// version, and a `### Announcement` entry is shown above it, as in the dialog.
//
// The changelogs keep the Keep a Changelog shape:
//
//   ## [0.47.0] - 2026-11-06
//   ### Added
//   - **Audio Folders take Ogg Vorbis.** A line's take can now be ...
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

/** An entry's lead: the bold opening, then the rest of its first sentence, links and code kept. */
export function lead(entry) {
  const m = /^\*\*(.+?)\*\*\s*(.*)$/.exec(entry);
  if (!m) return firstSentence(entry);
  const [, bold, rest] = m;
  if (/[.!?]$/.test(bold)) return `**${bold}**`;
  const gap = /^[,;:]/.test(rest) ? "" : " ";
  return `**${bold}**${gap}${firstSentence(rest)}`.trim();
}

function firstSentence(s) {
  // Up to the first full stop that ends a sentence (not inside a version number, a filename or `code`).
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "`") depth ^= 1;
    if (depth) continue;
    if ((c === "." || c === "!" || c === "?") && (i + 1 === s.length || /\s/.test(s[i + 1])) && !/[\d`]/.test(s[i - 1] ?? "")) {
      return s.slice(0, i + 1);
    }
  }
  return s;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const prettyDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

export function render(sources) {
  const out = [];
  out.push("---");
  out.push("title: What's new");
  out.push("description: Each release of Patterpad and the Patterplay runtimes, newest first, with a link to its full notes.");
  out.push("sidebar:");
  out.push("  label: What's new");
  out.push("---");
  out.push("");
  out.push("Each release, newest first, in the words its changelog uses. Patterpad shows the same list in its What's New");
  out.push(`dialog. The full notes, with every fix, are on [GitHub Releases](${REPO}/releases); the installers and`);
  out.push("runtime zips are on the [Download](/download/) page, and what a version number promises is on");
  out.push("[Versions and compatibility](/compatibility/).");
  out.push("");
  for (const src of sources) {
    out.push(`## ${src.heading}`);
    out.push("");
    out.push(src.blurb);
    out.push("");
    for (const v of src.versions.slice(0, SHOWN)) {
      out.push(`### ${v.version} (${prettyDate(v.date)})`);
      out.push("");
      for (const a of v.sections.get("Announcement") ?? []) {
        out.push(`:::tip[${lead(a).replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")}]`);
        out.push(a.replace(/^\*\*(.+?)\*\*\s*/, ""));
        out.push(":::");
        out.push("");
      }
      const highlights = v.sections.get("Highlights");
      const shown = highlights?.length
        ? highlights
        : ["Added", "Changed", "Removed"].flatMap((k) => v.sections.get(k) ?? []);
      for (const e of shown) out.push(`- ${lead(e)}`);
      const fixes = (v.sections.get("Fixed") ?? []).length;
      const notes = `[Full release notes](${REPO}/releases/tag/${src.tag(v.version)})`;
      if (fixes) out.push(`- ${fixes === 1 ? "One fix" : `${fixes} fixes`}. ${notes}.`);
      else out.push(`- ${notes}.`);
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
