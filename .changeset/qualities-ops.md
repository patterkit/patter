---
"@patterkit/ops": minor
---

`renameGameDataStage` carries a quality game-data field's stage rename into every node of its type that holds the old name. The stage-literal rewrite and the gate count are now the kernel's (`renameStageInExpression` and `stageGateCount` from `@wildwinter/expr`, shared with Storyletter); `stageGateCount` counts each gate, two in one condition being two. A node's `gameData` merges per key, so two writers setting different fields on one node both land. Coverage proposes, for a quality gate, the stages either side of it in ladder order (`stagesEitherSide`), not every stage sorted by name.
