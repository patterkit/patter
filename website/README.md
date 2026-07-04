# Patter website

The marketing + docs site: a **fully static** [Astro](https://astro.build) +
[Starlight](https://starlight.astro.build) build, deployed to **GitHub Pages**. No SSR,
no backend - the downloads list is read client-side from the public GitHub Releases API,
so it stays current without rebuilding.

It is **not** a workspace of the monorepo (it lives outside `packages/*` so the
`@patterkit/*` library build/publish never pulls in Astro). Install + run it on its own:

```sh
cd website
npm install
npm run dev      # local preview
npm run build    # static output in ./dist
```

## Layout

- `astro.config.mjs`: site config (`base: /patter`), the Patterpad theme + fonts, sidebar.
- `src/content/docs/**`: the docs (Markdown/MDX); `index.mdx` is the splash landing.
- `src/components/Downloads.astro`: the client-side GitHub Releases list.
- `src/styles/patter.css`: the warm Paper / Night palette + type set, carried to the web.

## Deploy

`.github/workflows/website.yml` builds and deploys to GitHub Pages on every push to
`main` that touches `website/**` (and on demand). Enable Pages → "GitHub Actions" once
in the repo settings. The site serves at `https://patterkit.dev/`.

Docs are unversioned for now (tracks latest); see the strategy doc §8.
