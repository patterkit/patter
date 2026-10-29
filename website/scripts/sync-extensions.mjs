// ---------------------------------------------------------------------------
// Copy each PatterKit extension's docs into this site as its own section.
//
//   node scripts/sync-extensions.mjs
//       every extension pinned in extensions.json, from its docs zip on the release
//   node scripts/sync-extensions.mjs --local patterstage=../patterstage/website
//       one extension from a working website/ folder instead (repeatable), for the
//       extension's own preview and check (scripts/preview-extension.mjs)
//   node scripts/sync-extensions.mjs --clean
//       remove everything a sync wrote, leaving the site as it is with nothing synced
//
// An extension is a PatterKit product built on Patter but downloaded and licensed apart from it:
// Patterstage first. Its pages are written in its own repository, beside its code, and ship as a
// zip on each public release. This site takes the pinned version, so the docs on patterkit.dev
// always match a release. The contract, with Ian's rulings, is patterkit/design/extension-docs.md.
//
// Patter is MIT, and an extension isn't, so two things matter more than anything else here:
//
//   - Nothing this writes is ever committed. Every path is git-ignored (an extension's slug gets
//     its line in .gitignore before its first sync, and the sync refuses one that hasn't), and a
//     slug with a tracked file under it is refused, so a section can't land on Patter's pages.
//   - Every page says it isn't Patter's. The sync adds Starlight's banner to each page's front
//     matter, naming the extension's licence, so no page can leave it out; the footer credit
//     changes on the same pages (site-chrome's extensions.mjs reads the generated file).
//
// What it writes:
//
//   src/content/docs/<slug>/          the pages, with the banner added
//   src/content/docs/<slug>/_assets/  the images, with the pages' links to them rewritten
//   public/<slug>/play/               the extension's play/ pages (a playable demo, say), served as
//                                     they are: single-file .html, built by the extension, no banner
//   src/extensions/generated.json     each section's name, licence, sidebar and downloads, read
//                                     by astro.config.mjs, the chrome and check-docs.mjs
//   src/extensions/manifest.json      a hash of every file above, so check-docs.mjs fails a
//                                     copy edited here (edit the extension's website/ instead)
//
// With nothing pinned and nothing local, it writes nothing, and the site builds exactly as it
// does without this script. A re-sync rewrites only what changed and removes what's gone, so a
// dev server watching the pages sees edits rather than a folder vanishing and coming back.
//
// Each extension's sidebar group starts closed (Starlight opens it on the extension's own pages), and
// the site tints it, its banner, and its trail home (src/styles/extensions.css, PageTitle.astro).
//
// No dependencies: the zip is read with node:zlib.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = "src/content/docs";
const OUT = "src/extensions";
const GENERATED = `${OUT}/generated.json`;
const MANIFEST = `${OUT}/manifest.json`;
const NOTE = "Written by scripts/sync-extensions.mjs from each extension's docs; never edited or committed here";
const ASSETS = "_assets";
const PUBLIC = "public";
const PLAY_LIMIT = 2 * 1024 * 1024; // a play page is one file with everything inlined; 2 MB is plenty

const sha = (data) => createHash("sha256").update(data).digest("hex");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

class SyncError extends Error {}
const fail = (message) => {
  throw new SyncError(message);
};

// --- where a section may go ---------------------------------------------------

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** A slug's folder must be git-ignored and hold nothing tracked: the pages are never committed. */
function checkSlugFolder(slug, under = DOCS) {
  const dir = `${under}/${slug}/`;
  try {
    if (git("ls-files", "--", dir).trim()) {
      fail(`${dir} holds pages tracked in this repository: an extension's slug can't share Patter's folder`);
    }
    git("check-ignore", "-q", dir);
  } catch (e) {
    if (e instanceof SyncError) throw e;
    fail(`${dir} isn't git-ignored: add it to website/.gitignore before syncing, so the extension's pages are never committed`);
  }
}

// --- reading an extension's website/ -------------------------------------------

/** A folder's files as a Map of posix relative path to contents. */
function readFolder(dir, prefix = "", files = new Map()) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) readFolder(path, `${prefix}${e.name}/`, files);
    else files.set(`${prefix}${e.name}`, readFileSync(path));
  }
  return files;
}

/** A zip's files as a Map of path to contents: stored and deflated entries, no zip64. */
export function readZip(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) fail("the docs zip has no central directory: not a zip, or truncated");
  const files = new Map();
  let p = buf.readUInt32LE(end + 16);
  for (let n = buf.readUInt16LE(end + 10); n > 0; n--) {
    if (buf.readUInt32LE(p) !== 0x02014b50) fail("the docs zip's central directory is damaged");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLength = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLength);
    p += 46 + nameLength + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (name.endsWith("/")) continue;
    // A name that climbs out of the folder is never written anywhere.
    if (name.startsWith("/") || name.includes("\\") || posix.normalize(name).startsWith("..")) fail(`the docs zip holds an unsafe path: ${name}`);
    if (size === 0xffffffff) fail("the docs zip is zip64, which this reader doesn't take");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method === 0) files.set(name, Buffer.from(data));
    else if (method === 8) files.set(name, inflateRawSync(data));
    else fail(`the docs zip uses compression method ${method} for ${name}`);
  }
  // docs.json belongs at the root; a zip made of the folder rather than its contents is taken too.
  if (!files.has("docs.json") && files.has("website/docs.json")) {
    return new Map([...files].filter(([k]) => k.startsWith("website/")).map(([k, v]) => [k.slice("website/".length), v]));
  }
  return files;
}

async function download(ext) {
  const tag = ext.tag ?? `${ext.id}-v${ext.version}`;
  const url = `https://github.com/${ext.repo}/releases/download/${tag}/${ext.id}-docs-${ext.version}.zip`;
  const res = await fetch(url);
  if (!res.ok) fail(`${ext.id}: HTTP ${res.status} for ${url}`);
  return { files: readZip(Buffer.from(await res.arrayBuffer())), tag };
}

// --- building a section -----------------------------------------------------------

/** The page slug of a file under pages/: its path without the extension, and `x/index` as `x`. */
const pageSlug = (path) => path.replace(/\.mdx?$/, "").replace(/(^|\/)index$/, "");

function checkDocsJson(id, docs) {
  const where = `${id}: docs.json`;
  if (docs.id !== id) fail(`${where} says its id is "${docs.id}"`);
  if (!docs.name) fail(`${where} has no name`);
  if (!/^[a-z][a-z0-9-]*$/.test(docs.slug ?? "")) fail(`${where} needs a slug of lower-case letters, digits and hyphens`);
  if (!docs.tagPrefix) fail(`${where} has no tagPrefix`);
  for (const key of ["name", "page", "summary"]) if (!docs.licence?.[key]) fail(`${where} has no licence.${key}`);
  if (!Array.isArray(docs.groups) || !docs.groups.length) fail(`${where} has no groups`);
  for (const g of docs.groups) if (!g.label || !Array.isArray(g.items) || !g.items.length) fail(`${where} has a group with no label or no items`);
}

/**
 * Every relative link in a page that reaches into assets/, rewritten to the copy in _assets/:
 * Markdown links and images, and an .mdx page's imports. Astro processes those; it leaves a raw
 * HTML `src` as written, which would point at a folder that isn't there once the page is served,
 * so a relative one is refused.
 */
function rewriteAssets(text, pagePath, where) {
  const raw = /\bsrc=["'](?![a-z]+:|\/|#)/i.exec(text.replace(/```[\s\S]*?```/g, ""));
  if (raw) fail(`${where} has a relative HTML src: use a Markdown image (![alt](../assets/x.png)), or import the image in an .mdx page`);
  const from = posix.dirname(`pages/${pagePath}`);
  const outDir = posix.dirname(pagePath);
  return text.replace(/(\]\(\s*<?|\bfrom\s+["']|\bimport\s+["'])([^)"'\s>]+)/g, (whole, lead, target) => {
    if (/^([a-z]+:|\/|#)/i.test(target)) return whole;
    const resolved = posix.normalize(posix.join(from, target));
    if (!resolved.startsWith("assets/")) return whole;
    let out = posix.relative(outDir, `${ASSETS}/${resolved.slice("assets/".length)}`);
    if (!out.startsWith(".")) out = `./${out}`;
    return lead + out;
  });
}

/** The page with the banner in its front matter. A page may not set its own. */
function addBanner(text, where, banner) {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!fm) fail(`${where} has no front matter`);
  if (!/^title:/m.test(fm[1])) fail(`${where} has no title`);
  const own = /^(slug|banner):/m.exec(fm[1]);
  if (own) fail(`${where} sets ${own[1]}: the path is the slug, and the sync adds the banner`);
  // A JSON string is a valid YAML double-quoted scalar, so the banner needs no YAML escaping.
  return `---\n${fm[1]}\nbanner:\n  content: ${JSON.stringify(banner)}\n---\n${text.slice(fm[0].length)}`;
}

/** One extension's section: the files to write and its entry in the generated file. */
function buildSection(ext, files, version) {
  const id = ext.id;
  if (!files.has("docs.json")) fail(`${id}: no docs.json at the top of its website folder`);
  const docs = JSON.parse(files.get("docs.json").toString("utf8"));
  checkDocsJson(id, docs);
  const { slug, name, licence } = docs;
  checkSlugFolder(slug);

  const pages = [...files.keys()].filter((k) => k.startsWith("pages/") && /\.mdx?$/.test(k)).map((k) => k.slice("pages/".length));
  const slugs = new Map(pages.map((p) => [pageSlug(p), p]));
  const listed = docs.groups.flatMap((g) => g.items);
  for (const item of listed) if (!slugs.has(item)) fail(`${id}: docs.json lists "${item}", which isn't a page`);
  const twice = listed.filter((item, i) => listed.indexOf(item) !== i);
  if (twice.length) fail(`${id}: docs.json lists ${twice.map((t) => `"${t}"`).join(", ")} more than once`);
  for (const s of slugs.keys()) if (!listed.includes(s)) fail(`${id}: pages/${slugs.get(s)} isn't in docs.json's groups`);
  if (docs.groups[0].items[0] !== "overview") fail(`${id}: the first item of the first group must be "overview"`);
  if (!slugs.has(licence.page)) fail(`${id}: the licence page "${licence.page}" isn't a page`);
  // play/ holds single-file pages and nothing else: a folder, an image or a script there would be
  // served as a stranger, so it's refused, named, as the other mistakes are.
  const play = [...files.keys()].filter((k) => k.startsWith("play/"));
  for (const path of play) {
    if (!/^play\/[^/]+\.html$/.test(path)) fail(`${id}: ${path} isn't a page directly under play/, which holds single-file .html pages only`);
    const size = files.get(path).length;
    if (size > PLAY_LIMIT) fail(`${id}: ${path} is ${(size / 1024 / 1024).toFixed(1)} MB, over the ${PLAY_LIMIT / 1024 / 1024} MB a play page may be`);
  }
  if (play.length) checkSlugFolder(slug, PUBLIC);
  const hasDownload = slugs.has("download");
  if (!hasDownload) console.warn(`sync-extensions: ${id} has no download page yet (required before launch); the banner leaves its link out`);

  const banner =
    `${esc(name)} is a separate download from Patter, under <a href="/${slug}/${licence.page}/">${esc(licence.name)}</a> rather than Patter's MIT licence. ` +
    esc(licence.summary) +
    (hasDownload ? ` <a href="/${slug}/download/">Download ${esc(name)}</a>.` : "");

  const out = new Map();
  for (const page of pages) {
    const text = files.get(`pages/${page}`).toString("utf8").replace(/\r\n/g, "\n");
    out.set(`${DOCS}/${slug}/${page}`, Buffer.from(rewriteAssets(addBanner(text, `${id}: pages/${page}`, banner), page, `${id}: pages/${page}`)));
  }
  for (const [path, data] of files) {
    if (path.startsWith("assets/")) out.set(`${DOCS}/${slug}/${ASSETS}/${path.slice("assets/".length)}`, data);
    if (play.includes(path)) out.set(`${PUBLIC}/${slug}/${path}`, data);
  }

  const entry = {
    id,
    name,
    slug,
    version,
    licence,
    // Closed unless the page is in it (Starlight opens a collapsed group holding the current
    // page); the groups inside it stay open, so opening it shows the whole outline.
    sidebar: { label: name, collapsed: true, items: docs.groups.map((g) => ({ label: g.label, items: g.items.map((i) => `${slug}/${i}`) })) },
  };
  if (docs.downloads?.sections) {
    if (!ext.repo) fail(`${id}: docs.json has downloads, but extensions.json names no repo to read them from`);
    entry.downloads = { repo: ext.repo, sections: docs.downloads.sections };
  }
  return { out, entry };
}

// --- the sync -------------------------------------------------------------------

const readJson = (path) => (existsSync(join(root, path)) ? JSON.parse(readFileSync(join(root, path), "utf8")) : null);

/** Remove the files the last sync wrote and no longer writes, then any folder they leave empty. */
function prune(previous, keep) {
  const dirs = new Set();
  for (const path of Object.keys(previous?.files ?? {})) {
    if (keep.has(path)) continue;
    rmSync(join(root, path), { force: true });
    for (let d = posix.dirname(path); d.startsWith(`${DOCS}/`) || d.startsWith(`${PUBLIC}/`) || d === OUT; d = posix.dirname(d)) dirs.add(d);
  }
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    try {
      rmdirSync(join(root, d));
    } catch {
      // not empty: something still there is the next sync's, or a stranger check-docs will name
    }
  }
}

/**
 * Sync the site's extension sections. `local` maps an extension id to a website/ folder to read
 * instead of its pinned release; `clean` removes every section and writes nothing.
 */
export async function syncExtensions({ local = new Map(), clean = false } = {}) {
  const previous = readJson(MANIFEST);
  if (clean) {
    prune(previous, new Set());
    rmSync(join(root, OUT), { recursive: true, force: true });
    return [];
  }

  const listed = readJson("extensions.json")?.extensions ?? [];
  for (const id of local.keys()) {
    if (!listed.some((e) => e.id === id)) console.warn(`sync-extensions: ${id} isn't in extensions.json; syncing it locally anyway, with no downloads repo`);
  }
  const wanted = [...listed.filter((e) => local.has(e.id) || e.version), ...[...local.keys()].filter((id) => !listed.some((e) => e.id === id)).map((id) => ({ id }))];

  const files = new Map();
  const entries = [];
  for (const ext of wanted) {
    let source;
    let version;
    if (local.has(ext.id)) {
      const dir = local.get(ext.id);
      if (!existsSync(join(dir, "docs.json"))) fail(`${ext.id}: no docs.json in ${dir}`);
      source = readFolder(dir);
      version = "local";
    } else {
      const got = await download(ext);
      source = got.files;
      version = ext.version;
      const prefix = JSON.parse(source.get("docs.json")?.toString("utf8") ?? "{}").tagPrefix;
      if (prefix && got.tag !== `${prefix}${version}`) fail(`${ext.id}: released as ${got.tag}, but its docs.json says tags are ${prefix}<version>`);
    }
    const { out, entry } = buildSection(ext, source, version);
    if (entries.some((e) => e.slug === entry.slug)) fail(`${ext.id}: the slug "${entry.slug}" is already another extension's`);
    for (const [k, v] of out) files.set(k, v);
    entries.push(entry);
  }

  if (!entries.length) {
    prune(previous, new Set());
    rmSync(join(root, OUT), { recursive: true, force: true });
    return entries;
  }

  files.set(GENERATED, Buffer.from(JSON.stringify({ note: NOTE, extensions: entries }, null, 2) + "\n"));
  prune(previous, new Set(files.keys()));
  for (const [path, data] of files) {
    const file = join(root, path);
    if (existsSync(file) && readFileSync(file).equals(data)) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  }
  const manifest = {
    note: NOTE,
    slugs: entries.map((e) => e.slug),
    files: Object.fromEntries([...files].map(([k, v]) => [k, sha(v)])),
  };
  writeFileSync(join(root, MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
  return entries;
}

/** `--local id=dir`, repeatable; a relative dir is taken from where the command was run. */
export function parseLocal(args, from = process.cwd()) {
  const local = new Map();
  args.forEach((arg, i) => {
    const spec = arg === "--local" ? args[i + 1] : arg.startsWith("--local=") ? arg.slice("--local=".length) : null;
    if (spec == null) return;
    const at = spec.indexOf("=");
    if (at < 1) fail(`--local wants id=dir, not "${spec}"`);
    local.set(spec.slice(0, at), resolve(from, spec.slice(at + 1)));
  });
  return local;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    const entries = await syncExtensions({ local: parseLocal(args, process.env.INIT_CWD ?? process.cwd()), clean: args.includes("--clean") });
    if (args.includes("--clean")) console.log("sync-extensions: removed every synced section");
    else if (!entries.length) console.log("sync-extensions: no extension pinned or local; nothing to sync");
    else for (const e of entries) console.log(`sync-extensions: ${e.name} ${e.version} -> ${relative(root, join(root, DOCS, e.slug))}/`);
  } catch (e) {
    if (!(e instanceof SyncError)) throw e;
    console.error(`sync-extensions: ${e.message}`);
    process.exit(1);
  }
}
