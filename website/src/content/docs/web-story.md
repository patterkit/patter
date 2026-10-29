---
title: Make an interactive story for the web
description: Write a branching story in Patterpad and play it on a web page you build and style yourself, from a folder on your computer, with no server and no build step.
sidebar:
  label: Your story on the web
---

This page builds the smallest useful web player for a Patter story: a page that shows your story a
passage at a time and offers the reader a button for each choice. It's one HTML file of under 100 lines
and one stylesheet, and you can restyle every part of it.

You don't need a web server, a build tool, or Node.js. The page plays when you double-click it, and the
same folder uploads as it is to itch.io or any web host.

You need [Patterpad](/download/) and a text editor. Knowing a little HTML and CSS helps when you come to
restyle the page, but you can copy everything here as it is.

## 1. Write a short story

In Patterpad, choose **File ▸ New Project…** and pick the **Starter project**. It opens on a scene
called `Start` with one line of text, so it plays straight away.

Write your opening as **text**: prose with no speaker, the part of a gamebook the reader reads. Then
give the reader a decision: on a blank line, type **`/`** and follow on with a **Choice**. Give it two options
with the **+ option** control. Each option has a **prompt**, the words on the reader's button, and
**content**, the passage they get when they pick it.

A shape that works well for a first story:

- an opening passage;
- a choice of two or three options, each with a passage of its own;
- in each option, a [jump](/patterpad/structure-and-branching/#jumps-and-diverts) on to another block
  or scene, or to `END` to finish there.

Characters can speak too. Press **Tab** on a line to give it a speaker, and the page shows their name
beside what they say.

Press **`⌘P`** (`Ctrl+P` on Windows and Linux) to play the story in Patterpad as you go.
[The writing surface](/patterpad/writing-surface/) and
[Structure and branching](/patterpad/structure-and-branching/) cover the rest. If you'd rather start
from a finished story, **Help ▸ Open an Example** opens **The Night Ferry**, a short branching story
that suits this page well.

## 2. Publish it for the web

Choose **Publish ▸ Publish for Web…** and make a new folder for it, say `my-story`. Patterpad writes
four files into it:

```
index.html      a ready-made page
style.css       its look
story.js        your story
patterplay.js   the engine for the ready-made page
```

Double-click `index.html` and your story plays in the browser. That page is the
[ready-made player](/patterpad/publishing/#make-it-yours-publish-for-web). Next you replace it with
your own.

The file that matters here is **`story.js`**: your whole story as a single JavaScript statement,
`window.PATTER_BUNDLE = …`. A page reads it with a plain `<script>` tag, and that's why none of this
needs a server: most browsers won't let a page opened from your disk load a data file, but it will always
run a script that sits beside it.

## 3. Get the drop-in engine

Your page plays the story with **`patterplay.min.js`**, the Patterplay runtime and its helpers in one
self-contained file. Get it from the [Download page](/download/), under Patterplay (it's also inside
the JavaScript runtime's zip), and save it into `my-story`.

:::tip[Or load it from a CDN]
If the page will always be online, you can skip the download and load the drop-in from a CDN instead:

```html
<script src="https://unpkg.com/@patterkit/play-helpers/dist/patterplay.min.js"></script>
```

A copy in the folder works offline as well, so this page uses one.
:::

## 4. Write the page

Replace `index.html` in `my-story` with this:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My Story</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>My Story</h1>
    <div id="story"></div>
    <div id="choices"></div>
  </main>

  <script src="patterplay.min.js"></script>
  <script src="story.js"></script>
  <script>
    const { Engine, Runner } = window.Patterplay;
    const runner = new Runner(new Engine(window.PATTER_BUNDLE));

    const story = document.getElementById("story");
    const choices = document.getElementById("choices");

    // Add a paragraph to the story and scroll it into view.
    function say(text, className) {
      const p = document.createElement("p");
      p.className = className;
      p.textContent = text;
      story.appendChild(p);
      p.scrollIntoView({ behavior: "smooth", block: "end" });
    }

    // Show a button under the story. Clicking it clears the buttons and runs `then`.
    function button(label, then, disabled) {
      const b = document.createElement("button");
      b.textContent = label;
      b.disabled = disabled;
      b.onclick = () => { choices.innerHTML = ""; then(); };
      choices.appendChild(b);
    }

    // A character speaks.
    runner.on("line", (step) => {
      say(step.speakerLabel ? `${step.speakerLabel}: ${step.text}` : step.text, "line");
      runner.next();
    });

    // Narration. Action (a stage direction) is shown in its own style.
    runner.on("text", (step) => {
      say(step.text, step.action ? "action" : "narration");
      runner.next();
    });

    // A cue for the game. This page has nothing to do, so it carries on.
    runner.on("gameEvent", () => runner.next());

    // The reader chooses. An option they can't take yet is shown greyed out.
    runner.on("choice", (step) => {
      for (const option of step.options) {
        const label = option.prompt ? option.prompt.text : "Continue";
        button(label, () => {
          say(label, "chosen");
          runner.choose(option.id);
        }, !option.eligible);
      }
    });

    // The end, and a way to play again.
    runner.on("ended", () => {
      say("The End", "end");
      button("Play again", () => { story.innerHTML = ""; runner.begin(); });
    });

    runner.begin();
  </script>
</body>
</html>
```

And replace `style.css` with this:

```css
body {
  margin: 0;
  background: #f6f1e7;
  color: #2b2620;
  font: 18px/1.6 Georgia, serif;
}

main {
  max-width: 36rem;
  margin: 0 auto;
  padding: 2rem 1rem 4rem;
}

h1 { font-weight: normal; }

.action { font-style: italic; color: #6b6156; }
.chosen { color: #8a5a2b; font-style: italic; }
.chosen::before { content: "> "; }
.end { text-align: center; letter-spacing: 0.2em; text-transform: uppercase; }

#choices { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1.5rem; }

button {
  font: inherit;
  text-align: left;
  padding: 0.6rem 1rem;
  border: 1px solid #8a5a2b;
  border-radius: 6px;
  background: #fffaf2;
  color: inherit;
  cursor: pointer;
}

button:hover { background: #f1e4cf; }
button:disabled { opacity: 0.45; cursor: not-allowed; }
```

Double-click `index.html`. Your story plays from the top, stops at each choice, and offers to play
again at the end.

`my-story` now holds five files. Your page uses `index.html`, `style.css`, `story.js`, and
`patterplay.min.js`. The ready-made page's `patterplay.js` is still there; yours doesn't use it, and
it does no harm.

## How it works

The page hands the story to a **[runner](/play/runner/)**, which plays it a beat at a time and tells the
page about each one as an event:

| Event | What it is | What this page does |
|---|---|---|
| `line` | a character speaking | shows the line with their name, then asks for the next beat |
| `text` | narration, or action in a scene where characters speak | shows it, then asks for the next beat |
| `gameEvent` | a cue for a game, such as a sound | nothing; asks for the next beat |
| `choice` | the reader decides | a button for each option; a click calls `runner.choose(id)` |
| `ended` | the story is over | "The End" and a Play again button |

Nothing moves on until the page calls **`runner.next()`**, or **`runner.choose(id)`** at a choice. This
page calls `next()` straight away, so the story runs on until it reaches a choice, which suits a
gamebook. **`runner.begin()`** starts the story at your project's start scene, and calling it again
starts a new game.

Everything else about the story, its choices, conditions, memory, and jumps, plays exactly as it did
in Patterpad's Play window, because it's the same engine.

## Make it yours

**Restyle it.** Every paragraph carries a class, so `style.css` decides how each kind looks:
`.narration`, `.line`, `.action`, `.chosen` (the option the reader picked), and `.end`; add a rule for
any of them. Change the
fonts, the colours, the width, or the buttons. Put a title image, a credit, or a link to your other
work in `index.html`.

**One passage at a time.** To have the reader click on through the story rather than see it all up to
the next choice, offer a Continue button instead of calling `next()` straight away:

```js
runner.on("line", (step) => {
  say(step.speakerLabel ? `${step.speakerLabel}: ${step.text}` : step.text, "line");
  button("Continue", () => runner.next());
});
```

Do the same in the `text` handler.

**Show the speaker differently.** `step.speakerLabel` is the speaker's display name (with any
[qualifier](/setup/cast/#speaker-qualifiers), such as `TAM (O.S.)`), and `step.character` is their
name in the cast. Use `step.character` as a class to give each character a colour of their own.

**Bold and italic.** If you turn on formatting for the project (**Project Settings ▸ General**), text can arrive with `<b>` and `<i>`
tags in it. [Formatting markup](/play/formatting/) explains how to draw them.

**Keep writing.** Your `index.html` and `style.css` are safe from now on: **Publish for Web** to the
same folder refreshes `story.js` (and its own `patterplay.js`) and leaves the page and stylesheet you
wrote alone. Write, publish, and refresh the browser.

## Bonus: add voice-over

Every line carries a stable **id**, and a recording named after that id plays with it. Select a line in
Patterpad and click the **#id** in the inspector header to copy it.

Make an `audio` folder in `my-story` and put each recording in it, named after its line's id:
`audio/L_x1ca8a0l.mp3`, and so on. Lines with no recording are fine; they carry straight on.

In `index.html`, replace the `line` handler with this:

```js
// Recordings live in the audio folder, each named after its line's id.
let voice = null;

function stopVoice() {
  if (voice) { voice.onended = null; voice.pause(); voice = null; }
}

// Play a line's recording, then carry on. A line with no recording carries on at once.
function playVoice(id) {
  stopVoice();
  voice = new Audio(`audio/${id}.mp3`);
  voice.onended = () => runner.next();
  voice.play().catch(() => runner.next());
}

// A character speaks.
runner.on("line", (step) => {
  say(step.speakerLabel ? `${step.speakerLabel}: ${step.text}` : step.text, "line");
  playVoice(step.id);
});
```

The story now waits for each recording to finish before it moves on. Two more small changes finish it
off:

- Browsers won't play sound until the reader has clicked something, so start with a button. Replace
  the last line, `runner.begin();`, with `button("Begin", () => runner.begin());`.
- Stop the voice when the reader starts again: make the Play again button
  `button("Play again", () => { stopVoice(); story.innerHTML = ""; runner.begin(); });`.

If your recordings are `.wav` files, change `.mp3` to `.wav`.

:::note[Recording in Patterpad]
Patterpad's [Audio Folders](/production/audio/) keep each line's takes in a folder per recording
stage (`scratch/`, `recorded/`, `final/`), named after the line's id in the same way. Copy the takes you
want into `my-story/audio`. On a page you serve from a web host, the
[audio resolver](/play/audio/#the-built-in-resolver-optional) can pick the best take for each line from
those folders for you. It reads a small manifest file, which a page opened straight from your disk
isn't allowed to load, so this page keeps to one folder.
:::

## Put it online

The folder is the whole game.

- **itch.io:** zip `my-story` and upload the zip as an HTML game. itch.io looks for `index.html`.
- **Any web host**, such as Neocities or GitHub Pages: upload the folder's files and share the link.

## Where next

- [The runner](/play/runner/): everything the runner does, in all four runtimes.
- [JavaScript and web](/play/javascript/): the drop-in in more depth, with saving and loading.
- [Save/load and Game Data](/play/integration/): remember the reader's place, and read your own data
  off each beat (a picture to show, a sound to play).
- [The Engine API](/play/engine/): the full detail beneath the runner.
