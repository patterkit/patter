// ---------------------------------------------------------------------------
// Playable HTML export: a single self-contained `.html` file that plays the story in any browser, with
// no build step, no server, and no network - the whole thing (the Patterplay runtime, the compiled
// bundle, and a small player UI) is inlined. Hand one file to a stakeholder and it just works offline.
//
// It is a SOURCE-LANGUAGE artifact: only the project's default locale's strings are embedded (a
// stakeholder reading/playing the story doesn't need the translations), so it stays small and there's
// no language switcher. It builds from runExportFull regardless of the project's localisation mode, so
// the strings are always present even when the shipped bundle is IDs-only.
// ---------------------------------------------------------------------------

import { canonicalStringify } from "@patterkit/core";
import { runExportFull } from "./export.js";
import { PLAYABLE_RUNTIME_JS } from "./playable-runtime.js";
import type { LoadedProject } from "./load.js";

const esc = (s: string): string => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

/** The player UI + glue, inlined into the page. Reads `window.Patterplay` (the runtime) + `window.PATTER_BUNDLE`
 *  (the compiled story). Self-contained: render loop, choices, restart, save/load (localStorage), and a
 *  language switcher when the bundle carries more than one locale. */
const PLAYER_JS = String.raw`
(function () {
  var Engine = window.Patterplay.Engine;
  var BUNDLE = window.PATTER_BUNDLE;
  var startScene = (BUNDLE.start && BUNDLE.start.scene) || Object.keys(BUNDLE.scenes)[0];
  var SAVE_KEY = "patter.play." + ((BUNDLE.content && BUNDLE.content.hash) || "x");

  var stage = document.getElementById("stage");
  var controls = document.getElementById("controls");
  var engine, flow;

  // Stable per-character hue (same idea as the editor's colour-by-character), tinted for a light page.
  function hueOf(name) { var h = 0; for (var i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) % 360; return h; }
  function add(cls, html) { var d = document.createElement("div"); d.className = cls; d.innerHTML = html; stage.appendChild(d); return d; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }

  // Pacing: a source-only reader carries no audio, so each line is held on screen for a reading-length delay
  // (proportional to its word count) before the next appears, and every line fades in (see CSS). The Speed
  // control sets the reading pace (words/min); "Instant" drops the delay entirely. The choice is persisted.
  // A run token cancels an in-flight paced read the moment the player restarts, loads, or picks a choice.
  var SPEED_WPM = { slow: 300, normal: 500, fast: 800, instant: 0 }, runToken = 0;
  var speedKey = (function () { try { return localStorage.getItem("patter.playSpeed") || "normal"; } catch (e) { return "normal"; } })();
  if (SPEED_WPM[speedKey] === undefined) speedKey = "normal";
  function fakeDuration(text) {
    var wpm = SPEED_WPM[speedKey];
    if (!wpm) return 0; // "Instant" - reveal the next line immediately
    var words = String(text == null ? "" : text).trim().split(/\s+/).filter(Boolean).length;
    return Math.max(450, Math.round((words / wpm) * 60000)); // a beat needs to land
  }
  function scrollDown() { window.scrollTo(0, document.body.scrollHeight); }
  var speedSel = document.getElementById("speed");
  if (speedSel) {
    speedSel.value = speedKey; // a fresh fakeDuration() reads speedKey each line, so a change applies next line
    speedSel.onchange = function () { speedKey = speedSel.value; try { localStorage.setItem("patter.playSpeed", speedKey); } catch (e) {} };
  }

  function build() { engine = new Engine(BUNDLE); flow = engine.openFlow("main", { scene: startScene }); }

  function newGame() { stage.innerHTML = ""; controls.innerHTML = ""; build(); run(); }

  function run() {
    controls.innerHTML = "";
    var token = ++runToken;
    (function step() {
      if (token !== runToken) return; // superseded by a restart / load / choice pick
      var s = flow.advance();
      if (!s) { add("end", "The End"); return; } // defensive: a step should always be returned; never hard-crash
      if (s.type === "line") {
        var who = s.characterName || s.character || "";
        var dir = s.direction ? '<em class="dir">(' + esc(s.direction) + ')</em> ' : "";
        add("line", '<span class="who" style="color:hsl(' + hueOf(s.character || who) + ',55%,38%)">' + esc(who) + '</span>' + dir + esc(s.text));
        scrollDown(); setTimeout(step, fakeDuration(s.text));
      } else if (s.type === "text") {
        add("text", esc(s.text)); scrollDown(); setTimeout(step, fakeDuration(s.text));
      } else if (s.type === "choice") { renderChoice(s); }
      else if (s.type === "end") { add("end", "The End"); }
      else { step(); } // game-event beat: a host cue with no player-facing text - skip it, advance at once
    })();
  }

  function renderChoice(step) {
    var opts = step.options || [];
    if (!opts.length) { add("end", "The End"); return; }
    for (var i = 0; i < opts.length; i++) (function (opt, idx) {
      var b = document.createElement("button");
      b.className = "choice"; b.textContent = (opt.prompt && opt.prompt.text) || "(continue)";
      b.disabled = opt.eligible === false;
      b.style.animationDelay = (idx * 60) + "ms"; // gentle stagger so the options fade in one after another
      b.onclick = function () { flow.choose(opt.id); scrollDown(); run(); };
      controls.appendChild(b);
    })(opts[i], i);
    scrollDown();
  }

  document.getElementById("restart").onclick = newGame;
  document.getElementById("save").onclick = function () { try { localStorage.setItem(SAVE_KEY, JSON.stringify(engine.saveGame())); flash("Saved"); } catch (e) {} };
  document.getElementById("load").onclick = function () {
    var blob; try { blob = localStorage.getItem(SAVE_KEY); } catch (e) {}
    if (!blob) { flash("No save yet"); return; }
    engine = new Engine(BUNDLE);
    engine.loadGame(JSON.parse(blob)); flow = engine.getFlow("main");
    stage.innerHTML = ""; add("text", "(resumed from save)"); run();
  };
  function flash(msg) { var f = document.getElementById("flash"); f.textContent = msg; f.style.opacity = "1"; setTimeout(function () { f.style.opacity = "0"; }, 1100); }

  newGame();
})();
`;

const STYLE = String.raw`
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f6f1e7; color: #2b2620; font: 18px/1.65 Georgia, "Times New Roman", serif; }
  .wrap { max-width: 42rem; margin: 0 auto; padding: 1.5rem 1.25rem 6rem; }
  header { display: flex; align-items: baseline; gap: 0.75rem; border-bottom: 1px solid #e0d7c5; padding-bottom: 0.75rem; margin-bottom: 1.25rem; }
  h1 { font-size: 1.15rem; margin: 0; font-weight: 600; }
  header .by { color: #9a8f78; font-size: 0.8rem; font-family: ui-sans-serif, system-ui, sans-serif; margin-left: auto; }
  #stage > div { margin: 0.55rem 0; animation: fade 0.45s ease-out both; }
  @keyframes fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { #stage > div, .choice { animation: none; } }
  .line .who { font-weight: 700; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 0.8rem; letter-spacing: 0.02em; text-transform: uppercase; margin-right: 0.4rem; }
  .line .dir { color: #9a8f78; font-style: italic; }
  .text { color: #4a4334; }
  .end { color: #9a8f78; font-style: italic; text-align: center; margin-top: 1.5rem; }
  #controls { margin: 1.25rem 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .choice { font: 1rem Georgia, serif; text-align: left; background: #fff; border: 1px solid #d9cfbb; border-radius: 8px; padding: 0.55rem 0.8rem; cursor: pointer; transition: border-color .15s, background .15s; animation: fade 0.4s ease-out both; }
  .choice:hover:not(:disabled) { border-color: #b8956a; background: #fffaf0; }
  .choice:disabled { color: #b8af9b; cursor: default; }
  .bar { position: fixed; bottom: 0; left: 0; right: 0; background: rgba(246,241,231,0.94); border-top: 1px solid #e0d7c5; backdrop-filter: blur(4px); }
  .bar .inner { max-width: 42rem; margin: 0 auto; padding: 0.6rem 1.25rem; display: flex; gap: 0.5rem; align-items: center; }
  .bar button { font: 0.85rem ui-sans-serif, system-ui, sans-serif; background: #fff; border: 1px solid #d9cfbb; border-radius: 6px; padding: 0.3rem 0.7rem; cursor: pointer; }
  .bar button:hover { border-color: #b8956a; }
  .bar .speedlabel { font: 0.8rem ui-sans-serif, system-ui, sans-serif; color: #9a8f78; display: flex; align-items: center; gap: 0.3rem; }
  .bar #speed { font: 0.85rem ui-sans-serif, system-ui, sans-serif; background: #fff; border: 1px solid #d9cfbb; border-radius: 6px; padding: 0.3rem 0.4rem; cursor: pointer; color: #2b2620; }
  .bar #speed:hover { border-color: #b8956a; }
  #flash { margin-left: auto; color: #9a8f78; font: 0.8rem ui-sans-serif, system-ui, sans-serif; opacity: 0; transition: opacity .2s; }
`;

/** The story narrowed to the source language, plus the page title and the safely-embeddable JSON. */
function sourceStory(loaded: LoadedProject): { title: string; lang: string; bundleJson: string } {
  const full = runExportFull(loaded);
  // Narrow to the source language only - a playable handed to a stakeholder reads in one language.
  const def = full.locales?.default ?? Object.keys(full.strings)[0] ?? "en";
  const bundle = { ...full, locales: { default: def, included: [def] }, strings: { [def]: full.strings[def] ?? {} } };
  const title = loaded.project.project.name?.trim() || "A Patter story";
  // Embed the bundle as JSON with every `<` escaped, so it can't break out of a <script> element.
  const bundleJson = canonicalStringify(bundle, { trailingComma: false }).replace(/</g, "\\u003c");
  return { title, lang: def, bundleJson };
}

/** The page shell shared by the single-file and split publishes: `head` carries the style
 *  (inline or a <link>), `tail` carries the scripts (inline or <script src>). */
function page(title: string, lang: string, head: string, tail: string): string {
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
${head}
</head>
<body>
<div class="wrap">
  <header>
    <h1>${esc(title)}</h1>
    <span class="by">Patter</span>
  </header>
  <main id="stage"></main>
  <div id="controls"></div>
</div>
<div class="bar"><div class="inner">
  <button id="restart">↺ Restart</button>
  <button id="save">Save</button>
  <button id="load">Load</button>
  <label class="speedlabel">Speed
    <select id="speed" title="Reading speed: how long each line is held before the next appears">
      <option value="slow">Slow</option>
      <option value="normal">Normal</option>
      <option value="fast">Fast</option>
      <option value="instant">Instant</option>
    </select>
  </label>
  <span id="flash"></span>
</div></div>
${tail}
</body>
</html>
`;
}

/** Build a single self-contained playable HTML document for the loaded project. Pure: returns the file's
 *  text; the caller writes it. One file to email anyone; it plays offline in any browser. */
export function runExportHtml(loaded: LoadedProject): string {
  const { title, lang, bundleJson } = sourceStory(loaded);
  return page(title, lang, `<style>${STYLE}</style>`,
    `<script>${PLAYABLE_RUNTIME_JS}</script>
<script>window.PATTER_BUNDLE=${bundleJson};</script>
<script>${PLAYER_JS}</script>`);
}

/** The Publish-for-Web split (Inky-style): the same page as four files. `index.html` + `style.css`
 *  are the writer's HARNESS - published once, then left alone so their customisations survive;
 *  `story.js` + `patterplay.js` are refreshed on every publish. The story is a plain script-tag
 *  ASSIGNMENT (no fetch), so the folder still plays straight from disk with no server. */
export interface WebExport {
  /** The harness page: markup only, linking the other three files. Published once. */
  indexHtml: string;
  /** The look of the page, separated so it's approachable to edit. Published once. */
  styleCss: string;
  /** The Patterplay runtime + this page's player glue. Refreshed on every publish. */
  patterplayJs: string;
  /** The compiled story as `window.PATTER_BUNDLE = …`. Refreshed on every publish. */
  storyJs: string;
}

export function runExportWeb(loaded: LoadedProject): WebExport {
  const { title, lang, bundleJson } = sourceStory(loaded);
  return {
    indexHtml: page(title, lang, `<link rel="stylesheet" href="style.css" />`,
      // The story must load first (patterplay.js reads window.PATTER_BUNDLE as it starts).
      `<script src="story.js"></script>
<script src="patterplay.js"></script>`),
    styleCss: `${STYLE.trim()}\n`,
    patterplayJs: `${PLAYABLE_RUNTIME_JS}\n${PLAYER_JS}`,
    storyJs: `window.PATTER_BUNDLE=${bundleJson};\n`,
  };
}
