#!/usr/bin/env node
// The `patter` binary: a one-line shim so main.ts stays importable for tests.
import { main } from "./main.js";

// exitCode, never process.exit: on macOS a pipe is written asynchronously, and exiting at once drops
// whatever stdout has not drained yet (piped output stopped at 64 KB). Node exits once it has.
process.exitCode = await main(process.argv.slice(2));
