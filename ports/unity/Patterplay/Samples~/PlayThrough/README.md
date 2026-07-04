# Play-through demo

The shared Patterplay API demo, in Unity. Plays a small flow (a line, a narrated
beat, a two-option choice, an effect, and `{@ref}` interpolation) and logs each step.

## Run it

1. Import this sample (Package Manager ▸ Patterplay ▸ Samples ▸ *Play-through demo*).
2. Open the **`PlayThrough`** scene beside this file and press **Play** - the transcript
   appears in the Console. The scene already holds a wired-up `PatterDemo` with
   `demo.patterc` assigned (or add the component to any GameObject yourself).

Open **Window ▸ Patterplay ▸ Runtime State** during play to watch and edit `@gold` live.

The same flow (`demo.patterc`) is played by the JS demo in
[`examples/demo`](https://github.com/patterkit/patter/tree/main/examples/demo), so the
runtimes can be compared side by side.
