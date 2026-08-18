---
"@patterkit/ops": minor
"@patterkit/cli": minor
---

`unpack --merge` checks that the returned pack, the base pack and the target project are the same project

Every `.patterpack` manifest has always carried `project.id`, and nothing read it. Pointing a merge at an unrelated project's pack therefore merged by id, matched almost nothing, and produced a mountain of conflicts that read as though the other author had rewritten the whole project.

`runUnpackMerge` now returns a `ProvenanceCheck` (`{ returned?, base?, target?, ok }`) comparing the three ids, and `patter unpack --merge` prints a warning before its writes when they disagree. It **warns and never refuses**: an id can legitimately differ across a fork or a reissue. A document with no readable manifest still merges, since an id that cannot be read cannot disagree.

This is the weak half of pack provenance. It cannot detect the wrong *revision* of the right project, which needs a content hash the format does not yet carry.
