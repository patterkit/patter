// Keep the Markdown that ships in the Patterplay zips at one line per paragraph.
//
//   node scripts/unwrap-markdown.mjs            # rewrite the shipped files in place
//   node scripts/unwrap-markdown.mjs --check    # list hard-wrapped lines, exit 1 if any
//
// WHY: these files are read as plain text as often as rendered (TextEdit, Notepad, Unity's inspector,
// Godot's editor, straight out of the zip). Paragraphs broken by hand at about 100 columns sat beside
// paragraphs kept on one line, so a plain-text viewer showed some lines breaking mid-sentence and others
// wrapping at the window edge (Ian, 2026-11-23). One line per paragraph renders the same as Markdown and
// wraps evenly as plain text.
//
// Only prose is joined: paragraphs, list items, and blockquotes. Fenced code, tables, headings, HTML,
// link definitions, and indented code are left as they are, and so is a line ending in a hard break.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every .md file a Patterplay release zip carries (see the play-*.yml workflows). */
export const SHIPPED_MARKDOWN = [
  "packages/runtime/README.md",
  "packages/runtime/CHANGELOG.md",
  "packages/play-helpers/README.md",
  "examples/drop-in/README.md",
  "examples/tour-web/README.md",
  "ports/unity/Patterplay/README.md",
  "ports/unity/Patterplay/CHANGELOG.md",
  "ports/unity/Patterplay/Samples~/PlayThrough/README.md",
  "ports/unity/Patterplay/Samples~/TourDemo/README.md",
  "ports/unreal/Patterplay/README.md",
  "ports/unreal/Patterplay/CHANGELOG.md",
  "ports/unreal/PatterplayDemo/README.md",
  "ports/godot/addons/patterplay/README.md",
  "ports/godot/addons/patterplay/CHANGELOG.md",
];

const FENCE = /^\s*(```|~~~)/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+/;
/** Lines that open a block of their own, so never continue the line before. */
const BLOCK_START = /^\s*(#{1,6}(\s|$)|[-*+]\s|\d+[.)]\s|>|\||<|(-{3,}|\*{3,}|_{3,})\s*$|\[[^\]]+\]:\s)/;
const HARD_BREAK = /( {2,}|\\)$/;

/**
 * Join hard-wrapped prose. Returns the new text and the 1-based numbers of the lines that were
 * continuations (empty when the text is already one line per paragraph).
 */
export function unwrapMarkdown(text) {
  const lines = text.split("\n");
  const out = [];
  const joined = [];
  let fenced = false;
  /** The kind of the last line pushed, if it can be continued: "para", "list" or "quote". */
  let open = null;
  let listIndent = 0;

  lines.forEach((line, i) => {
    if (FENCE.test(line)) {
      fenced = !fenced;
      out.push(line);
      open = null;
      return;
    }
    if (fenced || line.trim() === "") {
      out.push(line);
      open = null;
      return;
    }
    const prev = out[out.length - 1];
    const canJoin = open && !HARD_BREAK.test(prev);

    if (open === "quote" && canJoin && /^\s*>/.test(line)) {
      const body = line.replace(/^\s*>\s?/, "");
      if (body.trim() !== "" && !BLOCK_START.test(body)) {
        out[out.length - 1] = `${prev} ${body.trim()}`;
        joined.push(i + 1);
        return;
      }
    }
    if ((open === "para" || open === "list") && canJoin && !BLOCK_START.test(line)) {
      const indent = line.match(/^\s*/)[0].length;
      // Four or more columns in from where a paragraph's text starts is indented code, not prose.
      const codeIndent = open === "list" ? listIndent + 4 : 4;
      if (indent < codeIndent) {
        out[out.length - 1] = `${prev} ${line.trim()}`;
        joined.push(i + 1);
        return;
      }
    }

    out.push(line);
    const item = LIST_ITEM.exec(line);
    if (item) {
      open = "list";
      listIndent = item[0].length;
    } else if (/^\s*>/.test(line)) {
      open = "quote";
    } else if (BLOCK_START.test(line) || /^ {4,}/.test(line) && open === null) {
      open = null;
    } else {
      open = open === "list" ? "list" : "para";
    }
  });

  return { text: out.join("\n"), joined };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let bad = 0;
  for (const rel of SHIPPED_MARKDOWN) {
    const file = resolve(root, rel);
    const before = readFileSync(file, "utf8");
    const { text, joined } = unwrapMarkdown(before);
    if (!joined.length) continue;
    if (check) {
      bad += joined.length;
      console.error(`${rel}: hard-wrapped at line${joined.length > 1 ? "s" : ""} ${joined.join(", ")}`);
    } else {
      writeFileSync(file, text);
      console.log(`${rel}: joined ${joined.length} line${joined.length > 1 ? "s" : ""}`);
    }
  }
  if (check && bad) {
    console.error("Run `node scripts/unwrap-markdown.mjs` to put each paragraph on one line.");
    process.exit(1);
  }
}
