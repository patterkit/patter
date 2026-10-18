---
"@patterkit/core": minor
---

Game data is checked by the family's rules. A field declaration: an enum or flags field lists its values, a quality field's ladder follows the shared quality rule, and a given default fits its type (an enum's may be `""`, none chosen). Every node's values: each fits its field, by `valueFits` from `@wildwinter/expr`; a quality value off its ladder is an `invalid-gamedata-value` error whose `offLadder` names the stages to offer instead. A key no field declares is left alone. A property's default is checked by the same `valueFits`.
