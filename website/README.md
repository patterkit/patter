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

## Extension sections

PatterKit's extensions (Patterstage first) are downloaded and licensed apart from Patter, and their docs
are written in their own repositories. `extensions.json` pins each one's version, and
`scripts/sync-extensions.mjs` copies that release's docs into `src/content/docs/<slug>/`, with a licence
banner on every page, a sidebar group after Patter's own, and a hash manifest that `check-docs.mjs`
holds them to. None of it is ever committed: every path it writes is git-ignored, and the sync refuses a
slug that isn't. With nothing pinned it writes nothing and the build is Patter's alone. The contract is
`design/extension-docs.md` in the private patterkit repo.

```sh
npm run extensions:sync     # what CI runs before the build
npm run extensions:clean    # remove every synced section
npm run extension:preview -- patterstage=../../patterstage/website   # sync a working folder, dev server
npm run extension:check -- patterstage=../../patterstage/website     # sync it, build, run the checks
```

The last two are what an extension's own `docs:preview` and `docs:check` call; both remove what they
synced when they finish.

## Deploy

`.github/workflows/website.yml` builds and deploys to GitHub Pages on every push to
`main` that touches `website/**` (and on demand). Enable Pages → "GitHub Actions" once
in the repo settings. The site serves at `https://patterkit.dev/`.

Docs are unversioned for now (tracks latest); see the strategy doc §8.
