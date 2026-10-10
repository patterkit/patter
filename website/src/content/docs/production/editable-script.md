---
title: Sending the script to an editor
description: Export an editable script for someone outside Patter to change in Word, Google Docs, or OnlyOffice, then bring their changes back as suggestions to review.
sidebar:
  label: Sending to an editor
---

Script editors, producers, and outside reviewers usually have Word or Google Docs, not Patterpad. The
**editable script** lets you send them the script as an ordinary Word document, let them change the words
and leave comments in the tool they know, and bring their work back into the project as **suggestions**
you accept or reject. Nothing in the script changes until someone accepts a suggestion.

If the person you're sending to does have Patterpad, a [Patterpack](/patterpad/overview/) is the richer
way to share the whole project.

## Exporting

Choose **Review ▸ Export Editable Script…**.

1. Pick **This scene** or **Whole project**. Each shows how many lines it holds, and the dialog remembers
   your choice for next time.
2. Optionally say **who it's for**. Their name goes on the front page, and their edits are credited to
   them when they don't use Track Changes.
3. Choose what rides along:
   - **Include all notes**: every classed documentation note. Without it, only notes of the **Editors**
     class are shown (add one from a line's Notes; it's there for exactly this).
   - **Show writing status**: each line's status beside it.
   - **Add a cast page**: the speaking characters, with their notes, before the script.
4. Save the `.docx` and send it.

Patter also writes a small **handoff record** into the project, in `handoffs/`, holding exactly what was
sent. Commit it with the rest of the project: it's what the returned file is checked against, so any
teammate can bring it back.

## What the editor sees

The document reads like the [readable script](/patterpad/publishing/): scene and block headings, speaker
names (with any speaker qualifier, `TAM (O.S.)`), conditions, choices, jumps, and game events, so the editor
can follow the story. The **words of
every line sit in a shaded box**, with a small grey marker like `[#K7Q2M]` beside it. A front page
explains the rules in plain terms:

- Change the words inside the shaded boxes; that's all that can be edited.
- Leave the boxes and their grey markers where they are. To cut a line, delete its words but keep the box.
- Comment on anything else (a heading, a condition, a speaker) rather than editing it.
- Comment freely, or type a note inside a box like `[[this]]`.
- Keep `{@name}` placeholders as they are; the game fills them in.

It works in **Word** (desktop and the web), **Google Docs** (upload it to Drive and open it),
**OnlyOffice**, and **Apple Pages**. Track Changes (or Google's Suggesting mode)
is up to the editor: their changes come through either way, since each line is compared with what was
sent. With it on, each change is credited to the person who made it; without it, to whoever you sent the
file to.

## Bringing it back

Choose **Review ▸ Reimport Editable Script…** and pick the returned `.docx`. Patterpad reads it and shows
what it holds before writing anything: the handoff it belongs to, how many lines changed, how many are
unchanged or out of date, how many comments there are, and anything that needs your attention, each with
**Go to**.

- **Edits by** names who untracked changes are credited to. It starts as the person you sent it to.
- **Treat quote style changes as edits** is off by default: Word and Google Docs swap straight and curly
  quotes as you type, and that isn't the editor's doing.

Then choose:

- **Import as suggestions**: every change waits for your review.
- **Import, applying clean changes**: changes to lines nobody has touched since you sent the file go
  straight in; anything out of date still arrives as a suggestion.

Under lock-based version control (Perforce, or SVN with locking), the import checks out every file it
needs first. If someone else holds one, **nothing is written**, and the dialog says who holds what.

### What becomes what

- **Changed words** become a suggestion, credited to whoever made the tracked change (several editors on
  one line are all credited).
- **A box emptied**, or deleted with Track Changes on, becomes a suggestion to **cut** the line.
- **A speaker changed** to one of your cast becomes a suggestion to reassign the line; a **direction**
  added or changed becomes a suggestion too, and so does a
  [speaker qualifier](/setup/cast/#speaker-qualifiers) added, changed, or removed in the cue
  (`TAM (O.S.)`). The cue is matched against your cast first, so a character whose name has brackets
  in it is still read as that character; a bracket that isn't one of your qualifiers is flagged.
- **Comments** from Word or Google Docs become comment threads on the line or node they were on, with
  their replies. Inline `[[notes]]` become comments as well.
- **A line that changed in the project since you sent it** still gets its suggestion, shown as out of
  date, so you can weigh it against the newer text.

Nothing the editor wrote is thrown away. Anything that can't be a suggestion becomes a comment quoting
their words: changed `{@…}` placeholders, a copied box, text typed outside the boxes, an edit to a
heading or condition, or a speaker who isn't in the cast. A returned file with more than a quarter of its
lines missing is refused, since it's probably not the one that was sent.

Bringing back a second version of the same file replaces that handoff's suggestions still waiting for
review, rather than adding a second set.

## Reviewing the suggestions

Each suggestion shows on its line in the editor, as a [suggested rewrite](/patterpad/reviewing/) does:
the old words and the new, or the speaker, direction, or cut it proposes, and which handoff it came from.

To work through a whole file at once, choose **Review ▸ Review Suggestions…**. The search window's
**Suggestions** tab lists every open suggestion, filtered by handoff, with **Accept** and **Reject** on
each and the line one click away. **Accept all clean** accepts every suggestion shown that still applies;
out-of-date ones stay open for you to look at in the editor.

## From the command line

The same round trip is in the [CLI](/cli/#sharing--merging):

```bash
patter export-editable my-game.patter -o for-sam.docx --recipient "Sam"
patter import-editable returned.docx my-game.patter --dry-run
patter import-editable returned.docx my-game.patter
patter suggestions my-game.patter --accept-clean
```
