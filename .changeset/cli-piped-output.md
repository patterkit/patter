---
"@patterkit/cli": patch
---

Piped output is no longer cut short: on macOS, `-o -` and `--json` output stopped at 64 KB when stdout was a pipe, because the process exited before the pipe drained.
