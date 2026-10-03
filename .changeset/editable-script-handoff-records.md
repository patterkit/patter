---
"@patterkit/ops": minor
---

Editable script handoff records, the file side. `handoffs/<id>.json` records are read (`readHandoffs`, `readHandoff`) and written (`handoffWrite`), with the markers that tie a returned document's lines back to them (`issueMarkerCodes`, `formatMarker`, `readMarker`: Crockford base32 with a check character, read leniently). A `.patterpack` now carries the project's open handoff records; unpacking writes them, and a merge-unpack adds the other side's reimports to a record the project already has.
