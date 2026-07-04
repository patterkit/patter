// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// A fully STATIC build (Astro's default; no SSR adapter) for GitHub Pages, served at the custom domain
// patterkit.dev (site root; CI overrides nothing). The downloads page reads the public, CORS-enabled
// GitHub Releases API client-side, so it stays current with no rebuild.
export default defineConfig({
  site: "https://patterkit.dev",
  base: "/",
  // The localisation page moved from the flat Reference list into the role tracks; shipped plugin
  // READMEs link the old absolute URL, so keep it alive as a redirect (integrators were its audience).
  redirects: { "/localisation": "/play/localisation" },
  integrations: [
    starlight({
      title: "Patter",
      tagline: "Write branching narrative once. Play it everywhere.",
      customCss: ["./src/styles/patter.css"],
      // Every docs page ends with the license/author/home credit line (the landing page's footer
      // carries the same credit separately - it doesn't use Starlight chrome).
      components: { Footer: "./src/components/Footer.astro" },
      // Code blocks sit on the stage-black ground in BOTH site themes (a deliberate constant that reads
      // as "the runtime"). Force one dark syntax theme so the tokens always suit the dark background, and
      // pin the exact stage-black fill + hairline.
      expressiveCode: {
        themes: ["github-dark"],
        styleOverrides: { codeBackground: "#15201e", borderColor: "#2c3e3a" },
      },
      // PatterKit brand: square mark as the favicon, the wordmark as the header logo
      // (light/dark variants - the wordmark uses fixed dark ink that needs lightening
      // for the dark theme). replacesTitle swaps the plain "Patter" text for the mark.
      favicon: "/favicon.svg",
      logo: {
        light: "./src/assets/patterkit-wordmark.svg",
        dark: "./src/assets/patterkit-wordmark-dark.svg",
        replacesTitle: true,
        alt: "PatterKit",
      },
      // The warm Patterpad reading face + UI/mono set, carried to the web (typography-first).
      head: [
        {
          tag: "link",
          attrs: {
            rel: "stylesheet",
            href: "https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,600;6..72,700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap",
          },
        },
      ],
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/patterkit/patter" }],
      // Role-routed IA: newcomers/evaluators start at the top; writers, the project lead who sets
      // a project up, and the game developers who integrate a runtime each get their own track.
      sidebar: [
        {
          label: "Start here",
          items: ["getting-started", "download", "concepts", "architecture", "why"],
        },
        {
          label: "Writing in Patterpad",
          items: [
            // Reading path: learn to write, then structure, then logic; after that the
            // read-back / find / play / review layer; polish + tracking; reference last.
            "patterpad/overview",
            "patterpad/writing-surface",
            "patterpad/structure-and-branching",
            "patterpad/conditions-and-data",
            "patterpad/reading-and-focus",
            "search",
            "patterpad/playtesting",
            "patterpad/reviewing",
            "patterpad/publishing",
            "spell-check",
            "writing-status",
            "patterpad/shortcuts",
          ],
        },
        {
          label: "Running the project",
          items: ["production/overview", "production/tracking-and-reports", "production/coverage-testing", "production/audio", "production/localisation"],
        },
        {
          label: "Setting up a project",
          items: [
            "setup/overview",
            "patterpad/projects-and-settings",
            "setup/properties-and-data",
            "setup/cast",
            "setup/languages",
            "setup/version-control",
            "setup/building-and-shipping",
          ],
        },
        {
          label: "The Patter format",
          items: [
            "format/overview",
            "format/structure",
            "format/choices-and-logic",
            "format/gamedata-and-addressing",
          ],
        },
        {
          label: "Playing in your game",
          items: [
            "play/overview",
            "play/concepts",
            "play/javascript",
            "play/unity",
            "play/unreal",
            "play/godot",
            "play/engine",
            "play/integration",
            "play/localisation",
            "play/world-properties",
            "play/tags",
            "play/formatting",
            "play/closed-captions",
            "play/audio",
            "play/live-debug",
            "play/structure",
            "play/play-helpers",
            "compatibility",
          ],
        },
        { label: "Automation: the CLI", items: ["cli"] },
        { label: "Reference", items: ["specification", "licenses"] },
      ],
    }),
  ],
});
