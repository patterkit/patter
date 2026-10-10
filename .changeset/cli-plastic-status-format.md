---
"@patterkit/cli": patch
---

In a Plastic SCM workspace, a file already checked out is now recognised as checked out, so writing it again no longer fails as locked by your own checkout (`@wildwinter/simple-vc-lib` 0.5.2, which reads `cm status` in the format `cm` actually prints).
