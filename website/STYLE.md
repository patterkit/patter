<!-- Copy of design/copy-house-style.md in the patterkit design repo. Edit the canonical file and re-copy. -->

# Public-facing copy: the house style

Applies to every string a user reads: app UI strings (labels, tooltips, notes, toasts, dialogs,
empty states, menu items), the docs sites, landing pages, release notes and README files, in both
Patter and Storylet Studio and in the shared shell. It does not apply to design notes, decision
records or code comments. The rules come from `design-language.md` section 4 ("Plain declarative
prose, and a cadence rule") and the 2026-09 family UI review (`design/ui-review-2026-09/`).

Copies of this file live at `website/STYLE.md` in the two public repos. This one is canonical.

## Sentences

1. One idea per sentence. A sentence that needs a colon to hold two ideas is two sentences.
2. A colon introduces a list that follows, a quoted line, or the definition of a term in a
   glossary-style list ("**order**: the sequence the cards are dealt in" is fine, and stays a
   colon). It is not a hinge inside a running sentence. "Hands: the places on the board" becomes
   "A hand is a place on the board." Cap: two colon-joined sentences per page section, none in a
   page's first paragraph, none in an app string. Never fix a colon by swapping it for a full
   stop; rewrite the sentence or leave it.
3. No em-dash, no en-dash, and no spaced hyphen " - " standing in for either. Use a comma, a full
   stop, or brackets. (Lint: `/\s-\s/` outside code and list markers.)
4. A semicolon sits only between two full clauses, and rarely. Never to chain list items.
5. Avoid the "not X, Y" turn and the balanced double clause ("A, and B") as a habit. Once a page
   is a flourish; every paragraph is a cadence.
6. Three items when three is the real count. Do not pad to three or cut to three. Watch for
   tricolons ("A, B, and C") as a rhythm.
7. The Oxford comma is on, everywhere.

## Paragraphs and lists

8. A bullet is for parallel items of the same kind. A run of "**Name.** Explanation." bullets is a
   list of paragraphs wearing dots; write the paragraphs. Cap: one bold-lead list per page, and no
   page where every list is bold-lead. A glossary ("**term**: definition", one line each) is not a
   bold-lead list and does not count.
9. A bullet item is a full sentence with a full stop, or a bare noun phrase with nothing. Never
   both in one list.
10. No "→ [Page]" or "&rarr; [Page]" closing a section. Link the noun inside the sentence that
    needs it. A section that exists only to point elsewhere is cut. A list of pages, one per line
    as "[Page](/url/): what it covers", is a legitimate index and keeps its colons; do not turn
    it into "[Page] covers…" sentences or flatten it into a paragraph.
11. Tables have a header in every column. A two-column table with an empty header is a definition
    list; write "**term**: definition" items or a real `<dl>`.
12. Headings are sentence case. A noun phrase, an imperative, or a question all work; "Why not
    just a number?" is a natural heading and stays. Avoid "X at a glance" and "The short version".
    A heading that starts "The " should earn it.
13. Admonitions: at most one per page, never titled with a question, never as the page's second
    paragraph.

## Words

14. Banned: at a glance, the short version, under the hood, batteries-included, just works, no
    lock-in, battle-tested, first-class, seamless, effortless, simply, quickstart (say "Getting
    started"), powerful, robust, lightweight, blazing.
15. "Tested to match" and "indie-first, but team-ready" are taglines. One site each, or neither.
16. Menu paths use "▸" and the menu's own casing: File ▸ New Project… . Never "→" for a path.
17. "·" appears only in a figcaption or an exit-code line. Never between two bold nouns in prose,
    never joining metadata in an app string.
18. UK English throughout, spelling and vocabulary: licence (noun), notarised, localise, colour,
    recognise. Code identifiers keep their own spelling (`color` in CSS). (Lint: `license(?!d\b)`,
    `notarized`, `organiz`.)
19. Product terms are capitalised as the app shows them (Game Data, the Board, Live Link); nothing
    else is.

## Openers and descriptions

20. A page does not open "**Product** is the app where you…". Open on what the reader is about to
    do, or on the one thing they must know.
21. The frontmatter description is one sentence under 160 characters, with a verb, that a search
    result could show. Not an inventory of the page's nouns.
22. The first paragraph has no bold, no link list, no colon (rule 2).

## Voice

23. Second person, present tense, on every page. "We" is the team building the tool, used only
    when a decision is being explained; "I" only on the licensing and newsletter copy.
23a. Contractions are the default where a person would say one: "there's", "you're", "won't",
    "it's", "they've", "can't". "There is", "will not" and "cannot" read as stiff. Expand only
    for emphasis. A plain register is not a formal one.
24. Keep the asides ("wearing that hat on a Friday afternoon"). One per page is a voice; three is
    a bit.
25. A guide page and a reference page do not share a body. A catalogue of features ending in a
    sales paragraph is two pages.

## App strings in particular

26. Explanatory copy is short and rare. A settings row wants a label and, at most, one plain grey
    sentence under it. Teaching belongs in Help and the docs, not under every control. Where a
    note only restates the label, delete it.
27. Tooltips start with a capital. A command tooltip is a fragment ("Close (Esc)", "Move up"); an
    explanation is a sentence with a full stop. Never lowercase-first.
28. In-window buttons, tabs and section captions are sentence case ("World properties", "Add
    condition"). Native menu items follow the platform (Title Case on macOS).
29. A destructive button names the object: "Delete scene", "Remove language", not "Delete" or
    "OK". Cancel is "Cancel".
30. Confirmations end with what undo does, in one agreed sentence: "You can undo this."
31. Toasts: a confirmation is a past-tense fragment with no stop ("Voice script exported");
    an advisory or a failure is a sentence with a stop and, where there is one, the next step.
32. Placeholders are plain words ("Property name", "The Tavern"), never angle-bracketed stubs.
    A placeholder that demonstrates a format keeps the format ("group-name").
33. Key hints come from the shell helper, never a hard-coded "⌘" or "Cmd+".
34. Diagnostics name what the author can see (a title, a gameId), never an internal id, except a
    dangling reference written `(id …)`.
35. Empty states are one plain sentence naming the missing thing and the action that fills it.

## The read-aloud test

Take six strings from one window, or six sentences from one page, and read them aloud. If they
share a rhythm, rewrite until they do not.
