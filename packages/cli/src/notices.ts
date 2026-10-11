// What `patter licences` prints besides the fonts: Patter's own licence, and, in a standalone binary,
// the notices of every library compiled into it. The standalone build embeds both files and hands their
// paths over (scripts/build-standalone.mjs). The npm build reads the LICENSE beside its dist/, and its
// libraries install from npm beside it, each with its own licence file.

import { readFileSync } from "node:fs";

let embedded: { licence?: string; libraries?: string } = {};

/** Read Patter's licence and the library notices from these files: for a build that embeds them. */
export function useEmbeddedNotices(paths: { licence: string; libraries: string }): void {
  embedded = { ...paths };
}

/** Patter's own licence (MIT). */
export function patterLicence(): string {
  return readFileSync(embedded.licence ?? new URL("../LICENSE", import.meta.url), "utf8").trim();
}

/** The notices of the libraries compiled into this build, or undefined when they install beside it. */
export function libraryNotices(): string | undefined {
  return embedded.libraries === undefined ? undefined : readFileSync(embedded.libraries, "utf8").trim();
}
