// ---------------------------------------------------------------------------
// The docs faults that build clean.
//
// A port of the Storylets site's checker (storylets/website/scripts/check-docs.mjs)
// to this tree. Astro reports none of these, which is the reason the file
// exists: a green build is what every one of them looks like.
//
// 0. AN EDITED COPY OF THE SHARED CHROME. src/chrome/ is generated from
//    patterkit/site-chrome and hashed in its own manifest, so a change made
//    here is a change that the next sync silently throws away.
//
// 1. A BLANK LINE INSIDE A RAW <svg>. Markdown ends an HTML block at the first
//    blank line, so the rest of the diagram is re-parsed as prose and the page
//    renders half a picture followed by a paragraph of loose label text.
//
// 2. THE HOUSE STYLE (design/copy-house-style.md in patterkit, mirrored as
//    design/copy-house-style.md in the private patterkit repo). The rules that are cheap to hold mechanically and
//    that creep back silently:
//      - rule 3: no em-dash, no en-dash, and no spaced hyphen " - " standing in
//        for either, in prose;
//      - rule 23a's one failure mode: "it's" where "it is" was an object or a
//        clause end ("installing it's dropping", "how far along it's,"), which
//        a contraction pass makes and a reader trips on;
//      - rule 10: no "→ [Page]" / "&rarr; [Page]" closing a section;
//      - rule 14: the banned words ("at a glance", "under the hood", "simply",
//        "powerful", "blazing"...).
//    Prose only: front matter, fenced code, inline code, diagrams, HTML
//    comments and <script>/<style> blocks are stripped first, so a CLI output
//    or an on-screen string the docs quote is never flagged.
//
// 3. A WORD RUN INTO A LINK. Astro collapses a newline between text and an
//    adjacent inline element to NOTHING, so a legal line broken over three
//    source lines ships as "Made byIan Thomas". Checked in the output, because
//    the fault is what the collapsing did, not what the source looked like.
//
// 4. A DEAD INTERNAL LINK, or a live page with a dead anchor. Checked against
//    `dist/` rather than the source, because that is where the routing, the
//    slugs and the generated heading ids are all finally true.
//
// 5. A SIDEBAR ORPHAN. Starlight's sidebar here is an explicit list of slugs
//    in astro.config.mjs, so a page that is not in it is reachable only by a
//    link or a search. The 404 page is the one page that is meant to be.
//
// 6. THE SITE'S OWN STYLESHEETS (design-language.md section 4). "Captions are
//    words, not overlines": a tracked ALL-CAPS caption survives only where
//    uppercase is the domain's own convention, which on this site is the
//    screenplay character cue in the hero's sample script. And the three
//    decorations the family's sites do not use: a rotated
//    element, a radial gradient, a backdrop blur.
//
// Runs as `postbuild`, so `npm run build` is the whole gate and there is
// nothing separate to remember. Every message is file:line so it can be
// opened straight from the terminal.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const rel = (file) => relative(root, file);

/** Every file under `dir` whose name ends in one of `exts`. */
function walk(dir, exts) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

/** Blank a span of text but keep its newlines, so line numbers survive. */
const blank = (m) => m.replace(/[^\n]/g, " ");

const docsDir = join(root, "src/content/docs");
const docs = walk(docsDir, [".md", ".mdx"]);
const astro = [join(root, "src/pages/index.astro"), ...walk(join(root, "src/chrome"), [".astro"])];

// --- 0. the shared chrome is generated, not written here -----------------------
// src/chrome/ is rendered into this repository by patterkit/site-chrome, which keeps one
// source for the footer, the sign-up, the downloads list and the shared rules across the two
// public sites and the server's set. Every file it writes is hashed in manifest.json, so an
// edit made here, in the copy, fails this check in the commit that makes it. Staleness against
// the SOURCE is the other half, and only patterkit can see it: `node sync.mjs --check` there.
{
  const dir = join(root, "src/chrome");
  const EDITED = "src/chrome is generated from patterkit/site-chrome; do not edit it here";
  const manifestFile = join(dir, "manifest.json");
  if (!existsSync(manifestFile)) {
    problems.push(`src/chrome/manifest.json  missing: ${EDITED}`);
  } else {
    const listed = JSON.parse(readFileSync(manifestFile, "utf8")).files;
    for (const [name, digest] of Object.entries(listed)) {
      const file = join(dir, name);
      const found = existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null;
      if (found !== digest) problems.push(`src/chrome/${name}  ${found ? "edited" : "missing"}: ${EDITED}`);
    }
    for (const name of readdirSync(dir)) {
      if (name !== "manifest.json" && !(name in listed)) problems.push(`src/chrome/${name}  not in the manifest: ${EDITED}`);
    }
  }
}

// --- 1. blank lines inside a raw <svg> -------------------------------------
for (const file of docs) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/<svg\b[\s\S]*?<\/svg>/g)) {
    if (!/\n[ \t]*\n/.test(m[0])) continue;
    const line = text.slice(0, m.index).split("\n").length;
    problems.push(
      `${rel(file)}:${line}  blank line inside <svg> - markdown will end the HTML ` +
      `block there and render the rest of the diagram as prose`,
    );
  }
}

// --- 2. the house style, in prose ------------------------------------------
/** The prose of a docs page or an Astro page: everything a reader sees as words. */
const prose = (text, file) => {
  let t = text
    .replace(/^---[\s\S]*?\n---\n/, blank)          // front matter
    .replace(/```[\s\S]*?```/g, blank)              // fenced code
    .replace(/`[^`\n]*`/g, blank)                   // inline code
    .replace(/<svg\b[\s\S]*?<\/svg>/g, blank)       // diagrams
    .replace(/<!--[\s\S]*?-->/g, blank);            // HTML comments
  if (extname(file) === ".astro") {
    t = t
      .replace(/^---[\s\S]*?\n---\n/, blank)        // the component script (a second front matter)
      .replace(/<script\b[\s\S]*?<\/script>/g, blank)
      .replace(/<style\b[\s\S]*?<\/style>/g, blank)
      .replace(/\{[^{}\n]*\}/g, blank);             // JSX expressions: code, not copy
  }
  return t;
};

// Rule 3. A spaced hyphen is checked after the list marker is taken off the
// front of the line, and a table's separator row ("| --- | --- |") is skipped.
const LIST_MARKER = /^\s*(?:[-*+]|\d+\.)\s+/;
const SPACED_HYPHEN = /\s-\s/;
// Rule 23a's slip. (No end-of-line case: markdown is hard-wrapped, so "what
// it's" at a line end is usually "what it's for" continuing on the next line.)
// The gerund list is verbs, not every -ing word: "the thing it's about" is fine.
const SLIP = /\b(it's|there's)[,;:)]|\b(installing|dropping|keeping|making|using|running|reading|writing|opening|closing|bumping|adding|playing|dealing|editing|loading|saving|calling|putting|taking|leaving|having|doing|seeing|finding|getting|giving|pressing|clicking|choosing|picking|asking|checking|testing|publishing|exporting|importing|renaming|deleting|moving|dragging) it's\b|\bit's what makes\b/;
// Rule 10. The arrow footer, in either spelling, before a markdown link or an anchor.
const ARROW_FOOTER = /(→|&rarr;)\s*(\[|<a\b)/;
// Rule 14, verbatim. "seamless" and "effortless" take their adverbs with them.
const BANNED = /\b(at a glance|the short version|under the hood|batteries-included|just works|no lock-in|battle-tested|first-class|seamless(?:ly)?|effortless(?:ly)?|simply|quickstart|powerful|robust|lightweight|blazing)\b/i;

for (const file of [...docs, ...astro]) {
  const text = readFileSync(file, "utf8");
  const source = text.split("\n");                  // the line as written, for the message
  const lines = prose(text, file).split("\n");      // the line as read, for the rules
  lines.forEach((raw, i) => {
    const where = `${rel(file)}:${i + 1}`;
    const shown = source[i].trim().slice(0, 80);
    if (/—/.test(raw)) problems.push(`${where}  em-dash (house style rule 3): ${shown}`);
    if (/–/.test(raw)) problems.push(`${where}  en-dash (house style rule 3): ${shown}`);
    const l = raw.replace(LIST_MARKER, "");
    if (SPACED_HYPHEN.test(l) && !/^\s*\|?\s*-+\s*\|/.test(l)) {
      problems.push(`${where}  spaced hyphen " - " standing in for a dash (house style rule 3): ${shown}`);
    }
    if (SLIP.test(l)) problems.push(`${where}  "it's" where "it is" was an object or clause end: ${shown}`);
    if (ARROW_FOOTER.test(l)) problems.push(`${where}  "→ [Page]" section footer (house style rule 10): link the noun in the sentence`);
    const b = l.match(BANNED);
    if (b) problems.push(`${where}  banned word "${b[1]}" (house style rule 14)`);
  });
}

// --- 5. sidebar orphans ------------------------------------------------------
// The sidebar in astro.config.mjs names every page by slug. A docs page whose
// slug is quoted nowhere in that file is an orphan. (Every string literal in
// the config is taken, which is looser than parsing the sidebar array and
// exactly as good: a slug quoted anywhere in the config is a slug somebody
// meant to route to.)
{
  const config = readFileSync(join(root, "astro.config.mjs"), "utf8");
  const quoted = new Set([...config.matchAll(/["'`]([^"'`\n]+)["'`]/g)].map((m) => m[1]));
  for (const file of docs) {
    const slug = relative(docsDir, file).replace(/\.mdx?$/, "").replace(/\/index$/, "");
    if (slug === "404") continue;                   // the one page that is meant to be unlisted
    if (!quoted.has(slug)) problems.push(`${rel(file)}  not in the sidebar (astro.config.mjs): reachable only by link or search`);
  }
}

// --- 6. the site's own stylesheets -------------------------------------------
// Comments are blanked first, so a comment may still say "uppercase" to
// explain why the rule beneath it does not.
const OVERLINE_ALLOWED = new Set([
  ".pt-cue", // the screenplay character cue in the landing page's sample script: uppercase is the form's own convention
]);
const styleSources = [
  ...walk(join(root, "src/styles"), [".css"]).map((file) => ({ file, css: readFileSync(file, "utf8"), offset: 0 })),
  ...walk(join(root, "src/chrome"), [".css"]).map((file) => ({ file, css: readFileSync(file, "utf8"), offset: 0 })),
  // The <style> blocks inside the Astro components are the same class of rule.
  ...astro.flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => ({
      file, css: m[1], offset: text.slice(0, m.index).split("\n").length - 1,
    }));
  }),
];
for (const { file, css, offset } of styleSources) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, blank);
  const lineOf = (index) => offset + src.slice(0, index).split("\n").length;
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, " ");
    const body = m[2];
    if (/text-transform:\s*uppercase/.test(body) && /letter-spacing/.test(body) && !OVERLINE_ALLOWED.has(selector)) {
      problems.push(`${rel(file)}:${lineOf(m.index + m[1].length)}  tracked uppercase caption on ${selector} (captions are words, not overlines; design-language.md section 4)`);
    }
  }
  src.split("\n").forEach((line, i) => {
    for (const [re, why] of [
      [/\brotate\(/, "a rotated element"],
      [/radial-gradient\(/, "a radial gradient"],
      [/backdrop-filter\s*:/, "a backdrop blur"],
    ]) {
      if (re.test(line)) problems.push(`${rel(file)}:${offset + i + 1}  ${why} (not in the family's site style)`);
    }
  });
}

// --- the built site: 3 and 4 need dist/ --------------------------------------
const dist = join(root, "dist");
if (!existsSync(dist)) {
  console.error("check-docs: no dist/ - run the build first");
  process.exit(1);
}

// --- 3. text run into an adjacent link -------------------------------------
// A letter or a `&middot;` hard against `<a ` is never deliberate in prose.
for (const file of walk(dist, [".html"])) {
  const html = readFileSync(file, "utf8");
  for (const m of html.matchAll(/([A-Za-z0-9]|&middot;|&nbsp;)<a\s/g)) {
    const ctx = html.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, " ");
    problems.push(`${relative(dist, file)}  text run into a link: ...${ctx}...`);
  }
}

// --- 4. dead internal links in the built site ------------------------------
/** The set of `id` anchors a built page offers. */
const anchors = (html) => new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

const pageFor = (urlPath) => {
  const clean = decodeURIComponent(urlPath).replace(/\/$/, "");
  // A literal file first: `/badges/x.svg` and the like are static assets copied
  // out of `public/`, and are perfectly good link targets that are not pages.
  for (const candidate of [join(dist, clean), join(dist, clean, "index.html"), join(dist, `${clean}.html`)]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
};

for (const file of walk(dist, [".html"])) {
  const html = readFileSync(file, "utf8");
  const from = relative(dist, file);
  for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
    const href = m[1];
    // Off-site, in-page-only and non-navigational hrefs are not ours to check.
    if (/^(https?:|mailto:|tel:|#|\/\/)/.test(href)) continue;
    if (!href.startsWith("/")) continue;
    const [path, hash] = href.split("#");
    const target = pageFor(path.split("?")[0]);
    if (!target) {
      problems.push(`${from}  -> ${href}  (no such page)`);
      continue;
    }
    if (hash && target.endsWith(".html") && !anchors(readFileSync(target, "utf8")).has(hash)) {
      problems.push(`${from}  -> ${href}  (page exists, anchor does not)`);
    }
  }
}

if (problems.length > 0) {
  console.error(`\ncheck-docs: ${problems.length} problem(s)\n`);
  for (const p of [...new Set(problems)].sort()) console.error(`  ${p}`);
  console.error("");
  process.exit(1);
}
console.log("check-docs: ok");
