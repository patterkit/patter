---
"@patterkit/ops": minor
"@patterkit/model": patch
---

Audio Folders take Ogg Vorbis (`.ogg`) takes as well as WAV and MP3, so `patter export` writes them into `patteraudio.json`. When one folder holds more than one format for a line, WAV wins, then OGG, then MP3.
