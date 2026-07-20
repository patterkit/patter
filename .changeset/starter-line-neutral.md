---
"@patterkit/ops": patch
---
`runInit`'s starter line no longer tells the writer to edit a file and run a command. The scaffolded scene's one text beat is story content the writer replaces, but it read `Welcome to <name>. Edit scenes/start.patterflow, then run: patter play` - meaningless to someone who created the project in Patterpad and is typing straight into the editor, and redundant for `patter init`, which already prints its own next step on the terminal. It now reads `Welcome to <name>. This is the first line of your story - replace it with your own.`, which suits every front-end.
