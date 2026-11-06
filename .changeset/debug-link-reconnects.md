---
"@patterkit/play-helpers": minor
---

The debug link reconnects. Until the game closes it, a socket that closes or never opens is tried again after 1 s,
doubling to 10 s, and back to 1 s once a hello goes; each new socket says hello again with the build and the open
flows. One line is logged when an open link is lost and one when it's back; a link that never opened logs nothing.
A link the editor closes with code 4000 (another game connected) stops. `DebugSocketLike`'s `close` listener now
takes the close event, for its code.
