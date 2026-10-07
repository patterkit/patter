// A name made safe to be a file or folder name: the one rule for every name Patterpad suggests on disk
// (an export's filename, New Project's folder), in main and in the renderer's preview of it alike.

/** `name` with the characters Windows or macOS forbid in a filename (`/ \ : * ? " < > |`) turned into
 *  single spaces, trimmed. A ':' matters on both: Windows refuses it, and macOS Finder shows it as '/'. */
export function fileSafeName(name: string): string {
  return name.replace(/[/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
}
