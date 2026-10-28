// ---------------------------------------------------------------------------
// The name the identity box OFFERS (Storyletter's `offeredIdentity`, matched for app parity: the hands-on
// review's step 6, Q20). A suggestion only: never stored, never used as an author, and typed over freely.
// ---------------------------------------------------------------------------

import { homedir } from "node:os";
import { GitProvider, currentUserAsync } from "@wildwinter/simple-vc-lib";

/**
 * What version control thinks the author is called. With a project open, that working copy's system says
 * (git's user.name there, a Perforce or Plastic account), since git's name can be per-repository. With none
 * open, which is when the box first asks, git is asked from the home folder, where it reads the machine's
 * own (global) user.name: asking from the app's own folder found no version control there, so a packaged
 * app came back empty. Null when nothing can say.
 */
export async function offeredIdentity(dir: string | undefined): Promise<string | null> {
  try {
    if (dir !== undefined) return (await currentUserAsync(dir)) ?? null;
    return (await new GitProvider().currentUserAsync(homedir())) ?? null;
  } catch { return null; } // a suggestion is never worth failing a dialog over
}
