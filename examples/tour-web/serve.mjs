// Minimal dependency-free static server for the web tour demo.
//   node serve.mjs [port]
// Two layouts, detected automatically:
//   - the RELEASE ZIP carries a local ./assets folder (tour.patterc; no audio - playback is the
//     host's call), so everything serves from this folder alone;
//   - inside the PatterKit repo there is no local ./assets, so the shared tour assets serve
//     straight out of the repo (no copies):
//       /assets/tour.patterc  -> ../projects/patter-dist/tour.patterc
//       /assets/audio/*       -> ../projects/audio/*   (patteraudio.json + the scratch takes)

import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, normalize, join } from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));
const projects = fileURLToPath(new URL("../projects/", import.meta.url));
const localAssets = existsSync(join(root, "assets")); // the release-zip layout
const port = Number(process.argv[2] ?? 8093);
const types = {
  ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".map": "application/json", ".css": "text/css", ".svg": "image/svg+xml",
  ".patterc": "application/json", ".wav": "audio/wav", ".mp3": "audio/mpeg",
};

createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    let rel = normalize(url === "/" ? "/index.html" : url).replace(/^(\.\.[/\\])+/, "");
    // In the repo the shared assets live beside the tour project; the release zip carries them locally.
    let base = root;
    if (!localAssets) {
      if (rel.startsWith("/assets/tour.patterc")) { base = projects; rel = "patter-dist/tour.patterc"; }
      else if (rel.startsWith("/assets/audio/")) { base = projects; rel = join("audio", rel.slice("/assets/audio/".length)); }
    }
    const file = join(base, rel);
    if (!file.startsWith(base)) { res.writeHead(403).end("forbidden"); return; }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`tour-web demo: http://localhost:${port}/`));
