---
"@patterkit/cli": patch
---

In a Plastic SCM workspace, writing a file the workspace has already checked out no longer fails as locked, and an unchanged file is checked out before it is written rather than only made writable (`@wildwinter/simple-vc-lib` 0.5.1).
