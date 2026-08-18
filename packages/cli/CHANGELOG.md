# @patterkit/cli

## 0.2.1

### Patch Changes

- Updated dependencies [2d596c0]
  - @patterkit/ops@0.3.1

## 0.2.0

### Minor Changes

- f5645f5: `unpack --merge` checks that the returned pack, the base pack and the target project are the same project

  Every `.patterpack` manifest has always carried `project.id`, and nothing read it. Pointing a merge at an unrelated project's pack therefore merged by id, matched almost nothing, and produced a mountain of conflicts that read as though the other author had rewritten the whole project.

  `runUnpackMerge` now returns a `ProvenanceCheck` (`{ returned?, base?, target?, ok }`) comparing the three ids, and `patter unpack --merge` prints a warning before its writes when they disagree. It **warns and never refuses**: an id can legitimately differ across a fork or a reissue. A document with no readable manifest still merges, since an id that cannot be read cannot disagree.

  This is the weak half of pack provenance. It cannot detect the wrong _revision_ of the right project, which needs a content hash the format does not yet carry.

### Patch Changes

- Updated dependencies [f5645f5]
  - @patterkit/ops@0.3.0

## 0.1.7

### Patch Changes

- Updated dependencies [d488e49]
- Updated dependencies [4cbaa5a]
  - @patterkit/ops@0.2.3

## 0.1.6

### Patch Changes

- @patterkit/core@0.1.5
- @patterkit/ops@0.2.2

## 0.1.5

### Patch Changes

- Updated dependencies [087ceca]
- Updated dependencies [178967e]
  - @patterkit/ops@0.2.1
  - @patterkit/core@0.1.4

## 0.1.4

### Patch Changes

- Updated dependencies [34429f0]
- Updated dependencies [c61c146]
  - @patterkit/ops@0.2.0
  - @patterkit/core@0.1.3

## 0.1.3

### Patch Changes

- Updated dependencies [001c1d5]
  - @patterkit/ops@0.1.3
  - @patterkit/core@0.1.2

## 0.1.2

### Patch Changes

- @patterkit/core@0.1.1
- @patterkit/ops@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [34bdd67]
  - @patterkit/ops@0.1.1
