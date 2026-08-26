// Patterpad copies a handful of rules out of @wildwinter/app-shell's pane-shell.css instead of
// importing the file: it hand-rolls its own .topbar / .panes / .pane-* and taking the shell's
// stylesheet wholesale would give every one of them a second definition (design/to-storylets/
// pane-shell-not-shared.md). A copy is only honest while it matches, and it stopped matching within
// a day of being written - the arrows-not-chevrons ruling changed one font-size in the shell, and
// nothing here would have noticed.
//
// So: compare the mirrored rules against the INSTALLED shell, and fail loudly on drift. The fix is
// always the same - copy the shell's declarations over - and the check is what makes the copy safe.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shell = readFileSync(resolve(root, "node_modules/@wildwinter/app-shell/dist/pane-shell.css"), "utf8");
const mine = readFileSync(resolve(root, "packages/patterpad/src/renderer/src/shell.css"), "utf8");

const MIRRORED = [
  ".topbar.titlebar",
  ".topbar.titlebar-inset",
  ".shell-histnav",
  ".shell-histnav-btn",
  ".shell-histnav-btn:hover:not(:disabled)",
  ".shell-histnav-btn:disabled",
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const body = (css, sel) => {
  const m = new RegExp(`(^|})\\s*${esc(sel)}\\s*\\{([^}]*)\\}`, "m").exec(css);
  return m ? m[2].split(/\s+/).join(" ").trim().replace(/\s*;\s*$/, "") : null;
};

const drift = [];
for (const sel of MIRRORED) {
  const a = body(shell, sel);
  const b = body(mine, sel);
  if (a === null) drift.push(`${sel}: gone from the shell (was it renamed? drop the mirror or follow it)`);
  else if (b === null) drift.push(`${sel}: missing from Patterpad's shell.css`);
  else if (a.replace(/\s/g, "") !== b.replace(/\s/g, "")) {
    drift.push(`${sel}\n    shell: ${a}\n    ours : ${b}`);
  }
}

if (drift.length) {
  console.error("Patterpad's mirrored app-shell CSS has drifted from the installed shell:\n");
  for (const d of drift) console.error(`  ${d}`);
  console.error("\nCopy the shell's declarations into packages/patterpad/src/renderer/src/shell.css");
  console.error("(the block marked \"borrowed from app-shell's pane-shell.css\").");
  process.exit(1);
}
console.log(`Patterpad's mirrored shell CSS matches app-shell - ${MIRRORED.length} rules.`);
