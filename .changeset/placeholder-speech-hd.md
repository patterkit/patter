---
"@patterkit/model": minor
"@patterkit/core": minor
"@patterkit/ops": minor
"@patterkit/cli": minor
---

**Placeholder Speech can use HD voices.** A project can choose Google's Chirp 3 HD voices, which read lines far more
naturally, in place of the Standard ones. They cost more on your own Google account, so they're opt-in: Standard stays
the default, and a project on Standard makes exactly the same files as before.

- `placeholderSpeech.tier` is `"standard"` (or absent) or `"hd"`. HD has its own frozen voice lists for every accent,
  30 voices each, and its files are 24 kHz.
- A character's own voice from the other tier is used as chosen, and `patter placeholder-speech` notes it, and notes
  when a run uses HD voices.
