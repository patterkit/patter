---
"@patterkit/ops": minor
---

`runReplace` also rewrites each node's own value for a gameData field declared `text` or `multiline` (family parity item 16, as Storyletter's replace covers string field values). Every `ReplaceHit` carries a `field`, `"text"` for the source prose or `field:<name>` for a gameData value, and `ReplaceOptions.onlyField` narrows `onlyId` to one of them. The plan's new `flows` holds the rewritten scenes, whose flow shard writes come last in `writes`. Other field types and declared defaults are never touched, and a field value stamps no `modifiedAt`, as it has no translations.
