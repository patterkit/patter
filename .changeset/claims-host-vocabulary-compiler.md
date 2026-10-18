---
"@patterkit/compiler": patch
---

A Patter extension's claim may leave out an enum's or flags' `values`, or a quality's `stages` (`@wildwinter/toolkit` 0.2.1): the project's gameData field is then the vocabulary. The extension pass checks a claimed field's values against the claim over the project's declaration (`effectiveClaim`), so a value the field declares passes and one it doesn't is an error, and the claim's value help may describe values the field doesn't declare. A claim on a field declared with another type is still an error, and one on a field the project doesn't declare still a warning. Depends on `@wildwinter/toolkit` ^0.2.1.
