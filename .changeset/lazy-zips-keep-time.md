---
"@patterkit/ops": patch
---

Pack: `.patterpack` documents are now truly byte-reproducible. JSZip stamps
implicit folder entries with the wall clock regardless of the per-file `date`
option, so two packs of unchanged source could differ when they straddled a
DOS-time 2-second boundary; folder entries are no longer created.
