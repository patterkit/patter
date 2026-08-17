// CSS + webfont side-effect imports carry no types - declare them so tsc doesn't flag them.
declare module "*.css";
declare module "@fontsource/*";
declare module "@fontsource-variable/*";

// Vite's `?raw` modifier hands back the file's text as the default export. The preview harness loads
// its fixtures and dictionaries that way. Ambient, so it covers every directory in this program.
declare module "*?raw" {
  const content: string;
  export default content;
}
