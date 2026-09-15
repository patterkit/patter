// A scene's name, kept in step everywhere the renderer shows it (#73).
//
// Renaming a scene edits the open document (its title is the edit surface) and the save carries it to
// disk, where the main process picks it up. But the renderer shows scene names from its OWN copy of the
// project, taken when the project opened, and nothing wrote a rename back into that copy. So the Scenes
// list kept the old name until a restart reloaded the project - and so did everything else reading the
// copy: the overview's scene index, the Start scene pickers, the Delete scene dialog, and the jump
// targets handed to every other scene. The jump list inside the renamed scene was right all along only
// because it reads the live document instead.
//
// The fix is to write the name back into the copy the moment it changes, so every reader is right
// rather than each one being patched; the one reader already painted on screen (the Scenes list row)
// is relabelled in place.

/** The slice of the opened project this touches: its scenes' ids and names. */
export interface SceneNames { scenes: Array<{ id: string; name: string }> }

/**
 * Write a scene's current name into the renderer's copy of the project. Returns true when it changed
 * something, so the caller repaints only then. A blank name is ignored (the title reverts a blank
 * commit to the old name itself), as is an unknown scene or no project.
 */
export function adoptSceneName(project: SceneNames | null | undefined, sceneId: string | null | undefined, name: string): boolean {
  const next = name.trim();
  if (!project || !sceneId || !next) return false;
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene || scene.name === next) return false;
  scene.name = next;
  return true;
}

/**
 * Relabel one scene's row in the Scenes list, in place. Only the scene's own label changes: its block
 * rows share the `.nav-item-name` class, so the label is found through the scene's `.nav-item` button
 * (block rows are `.nav-block`), and every other scene is left alone.
 */
export function relabelNavScene(navList: ParentNode, sceneId: string, name: string): void {
  for (const row of navList.querySelectorAll<HTMLElement>(".nav-scene")) {
    if (row.dataset["id"] !== sceneId) continue;
    const label = row.querySelector<HTMLElement>(".nav-item")?.querySelector<HTMLElement>(".nav-item-name");
    if (label) label.textContent = name;
  }
}
