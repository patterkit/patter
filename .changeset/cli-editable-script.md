---
"@patterkit/cli": minor
---

Three commands for the editable script handoff. `patter export-editable` writes a `.docx` an editor outside Patter can change (with `--scene` repeatable, `--recipient`, `--status`, `--cast`, and `--all-notes`) and its handoff record. `patter import-editable` brings the file back as suggestions and comments, with `--dry-run`, `--direct` to accept clean changes, `--as` to credit untracked edits, and `--strict-quotes`; under lock-based version control it writes everything or nothing. `patter suggestions` lists open suggestions, clean or out of date, and `--accept-clean` accepts the clean ones.
