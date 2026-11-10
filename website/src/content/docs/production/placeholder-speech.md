---
title: Placeholder Speech
description: Hear every spoken line in a stand-in voice before anyone records it, made from the line's words, and replaced by any real take.
sidebar:
  label: Placeholder Speech
---

**Placeholder Speech** gives every spoken line a stand-in voice, made from its words, so you can hear a scene,
time it, and play it in your game before anyone records a line. Google's Text-to-Speech makes it, on a key your
team provides.

It sounds like a stand-in on purpose. It uses Google's plainer voices at a low sample rate, so nobody mistakes it
for the finished thing, and any real take replaces it: a scratch take, a recorded take, or a final one is always
heard instead.

## Turning it on

Placeholder Speech needs [Audio Folders](/production/audio/#recording-status). In **Project Settings ▸
Placeholder Speech**:

1. Tick **Generate Placeholder Speech**. Patterpad adds a **placeholder** stage to your recording ladder, just
   above **missing**, so its folder is `placeholder/` under your audio root. (If your ladder already has a stage
   called placeholder, it uses that.)
2. Set the **Google Cloud key file** (see [getting a key](#getting-a-key)).
3. Choose an **accent**, if your project's language doesn't name one. A project written in `en` could be British,
   American, Australian, or Indian English, so it asks.

Then carry on writing. A moment after you move off a line you've edited, its speech is made in the background,
with a strip at the bottom of the window while it works. Lines still waiting when you close Patterpad are made
next time you open the project.

To make a whole scene or the project at once, use **Production ▸ Make Placeholder Speech for This Scene** or
**…for the Project**. The project one says how many lines it will make first.

## Voices

Each character's voice is in **Project Settings ▸ Cast**: open a character's details to see **Placeholder
Speech voice**, with **Hear** to listen to it. With no voice chosen, the character's name picks one, so everyone
has a voice from the start, and each character always gets the same one.

A character's [grammatical gender](/production/localisation/) narrows the pick when it's **male** or **female**:
if the name picked a voice of the other kind, it moves to one that fits. Characters whose voice already fits keep
it. Renaming a character keeps their voice.

Change a voice, a gender, or the accent and Patterpad offers to make that character's lines again. If you'd
rather wait, **Make Placeholder Speech** does it later.

## What it means for the rest of the project

- **A line with only placeholder speech is still to record.** The recording script and **Production Information**
  count it as still to record, the scratch recorder's **Next needed** stops at it, and the inspector offers
  **● Record** on it as it does on a line with nothing.
- **Editing a line makes its speech again**, on its own. It isn't flagged for re-record, since nobody needs to do
  anything. If Google sends a clip cut short (it happens now and then), **Make again** in the inspector asks for it
  again.
- **Your game plays it** like any other take, through the [audio manifest](/production/audio/#getting-the-audio-into-your-game),
  so a development build can be heard all the way through. For a release, leave the placeholder folder out of
  what you package and write a shipping manifest without it:
  `patter export --audio-manifest-out build/patteraudio.json --no-placeholder-speech`.
- **Its files are WAV, 16 kHz, trimmed of silence** at each end, as scratch takes are, so lines are timed by their
  speech and not by Google's pauses.
- **A file you put in the placeholder folder yourself is never touched.** Placeholder Speech marks its own files,
  and only remakes or removes those. The settings page lists any it didn't make.

## Getting a key

Placeholder Speech uses a **service account key**: a small `.json` file from Google Cloud that lets Patterpad ask
for speech on your project's account. One person usually makes it, and the team shares the file.

1. Sign in to the [Google Cloud console](https://console.cloud.google.com/) and **create a project** for your game.
2. **Set up billing** on it. Text-to-Speech has a free monthly allowance, and the plainer voices Placeholder Speech
   uses go a long way within it, but Google needs a billing account first. Set a **budget alert** in Billing while
   you're there, so you hear about it before anything is charged.
3. In **APIs & Services**, **enable the Cloud Text-to-Speech API**.
4. In **IAM & Admin ▸ Service Accounts**, **create a service account**. It needs no role.
5. On the service account, open **Keys ▸ Add key ▸ Create new key**, choose **JSON**, and save the file.

**Keep the key out of version control.** A key committed to a repository can be copied by anyone who sees it (and
Google disables keys it finds in public ones). Put it in a folder outside your project, such as `.patter` in your
home folder, and point Patterpad at it with **Choose…**. Patterpad stores the path, never the key:

- A path under your home folder is stored as `~/…`, which works on Windows, macOS, and Linux, so a team that keeps
  the key in the same place on every computer shares one setting.
- A path relative to the project works too, for a team that keeps the key beside its checkouts.
- If the path is empty, or the file isn't on a computer, Patterpad uses the standard
  `GOOGLE_APPLICATION_CREDENTIALS` environment variable instead.

The settings page says whether the key works on this computer, and which Google project and account it belongs
to. If the key sits inside your project's folder, it says so.

### Without a key

A teammate whose computer has no key gets one quiet note per session, never an error. Their saves aren't held up,
and they hear the speech others made and committed. To stop the note on a computer that's never meant to make
speech, untick **Production ▸ Make Placeholder Speech on This Computer**.

A team can also keep the key on one build machine only, and make the speech there with
[`patter placeholder-speech`](/cli/#patter-placeholder-speech-path).

## Keeping it out of version control

Speech is made from the script, so it can always be made again. To save repository space, tick **Keep Placeholder
Speech out of version control**: the speech is then written straight to disk and never added, and its folder
tells git to ignore it. Each computer with a key makes its own; a teammate without one hears none.
