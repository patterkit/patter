---
"@patterkit/model": minor
"@patterkit/core": minor
"@patterkit/ops": minor
"@patterkit/cli": minor
---

**Placeholder Speech: hear a scene before anyone records it.** A project can turn on stand-in speech for every
spoken line, made by Google's Text-to-Speech from the line's words into one recording status's folder, below
scratch, so any real voice clip is heard instead. It sounds like a stand-in on purpose: Google's Standard voices only,
16 kHz, trimmed of silence.

- The project file gains `placeholderSpeech` (the status, the key file's path, the accent, and whether the speech
  stays out of version control), and each cast member an optional `placeholderVoice`. With no voice chosen, a
  hash of the name picks one, narrowed by a gender of male or female; `keepPlaceholderVoices` keeps a renamed
  character's voice.
- `patter placeholder-speech` makes it from the command line, with the key from the project or
  `GOOGLE_APPLICATION_CREDENTIALS`, so a build machine can hold the one key: `--scene`, `--dry-run`, `--force`,
  and `--soft` (no key is a note, not a failure). A key is a service account's JSON key or a person's gcloud sign-in
  (`gcloud auth application-default login`, billed to its quota project), found where gcloud keeps it when nothing
  else names a key. The work is `planPlaceholderSpeech` and `runPlaceholderSpeech`
  in ops, shared with Patterpad.
- **Voice clips are stamped `PTRK`, no longer `DINK`.** The text hash a voice clip was made from is now written to
  a `PTRK` chunk. `DINK`, from Dink and earlier Patterpads, is still read, so existing voice clips keep their
  out-of-date flag. Placeholder Speech adds `PTPS`, a hash of the whole request, so a changed voice remakes a
  line. The stamp helpers are in core (`textHash`, `readTextStamp`, `withStamps`).
- **The audio manifest names only voice clips whose line is in the project.** A deleted line's voice clip, or a cut
  line's, is left out straight away, and a manifest is still written when every one is left out.
- **`patter export --audio-manifest-out <file>`** writes a shipping manifest to a build folder, and
  `--no-placeholder-speech` leaves Placeholder Speech out of it, so the development manifest beside the audio keeps
  it.
- The report counts lines still to record, with placeholder-only lines among them, when Placeholder Speech is on.
