// Vite's `?raw` import modifier hands back the file's text as the default export. It carries no types
// of its own, so declare it here rather than referencing `vite/client`, which would pull a whole
// ambient environment in behind it. Mirrors renderer/src/env.d.ts in packages/patterpad.
declare module "*?raw" {
  const content: string;
  export default content;
}
