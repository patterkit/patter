---
"@patterkit/play-helpers": patch
---

The debug link announces a flow the host never opened. `flowOpened` was the host's job and nothing
could check it, so a game that opened a flow and forgot to announce it left Patterpad's follow list
short - and the omission outlived a reconnect, because the link's hello carries its own flow set.
A flow the link has not seen now announces itself the first time it is observed; `flowOpened` still
lists a flow before its first step, and `flowClosed` is still the only thing that ends one.
