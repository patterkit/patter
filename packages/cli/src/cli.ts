#!/usr/bin/env node
// The `patter` binary: a one-line shim so main.ts stays importable for tests.
import { main } from "./main.js";

process.exit(await main(process.argv.slice(2)));
