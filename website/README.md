# dialogmapper website

The public site, built with Vite and React and deployed to GitHub Pages by
`.github/workflows/deploy-website.yml` on every push to `main`.

```bash
npm install
npm run dev      # local preview
npm run build    # type-check and build into dist/
npm run check    # load every page of dist/ in a browser and report what is broken
```

## What is generated, and why

Two things on this site come from the tool rather than from a person, because
both are the kind of thing that rots silently.

```bash
npm run shots        # screenshots, by driving the real binary
npm run reference    # the CLI reference, from the binary's own --help
```

**`scripts/screenshots.mjs`** seeds a map about a four-day week, starts a real
server, and photographs the canvas, a close-up of one branch, the details panel,
the open-questions filter, the search palette and the phone view. Every image on
the site comes from there. A hand-drawn mockup is wrong the first time a node
style changes and nobody notices.

**`scripts/reference.mjs`** parses `dialogmapper --help` and every subcommand's
help into `src/generated/cli.json`. A hand-written command reference is wrong
within about two releases, because nobody re-reads their own docs.

Both default to the `dialogmapper` binary in the repository root; set
`DIALOGMAPPER_BIN` to point at another one. **Run them after any change to the
UI or the CLI**, then commit what they produce.

## Checking

`npm run check` loads every route in a real browser and fails on: a route that
renders the not-found page, an image that did not load, a link to a route that
does not exist, a JavaScript error, a 4xx, or horizontal overflow at 380px wide.

It needs a build first — it serves `dist/`, not the dev server, so it checks what
actually ships.

## Notes on the shape of it

**Hash routing** (`#/how-to/workshop`), and no router library. Hashes because
the site is built with `base: './'` and therefore works from any path — a
project page, a custom domain, or a local file — where real paths would need the
base baked in at build time plus a 404.html rewrite, and would break silently the
day the URL changes. No library because seven static routes do not need 60kB of
one.

**Content lives in the page components.** There is no CMS and no markdown
pipeline; the pages are TSX because most of them interleave prose with keyboard
chips, terminal blocks and tree diagrams, which is more awkward in markdown than
it is worth.

**One accent colour, and four that mean something.** The IBIS node colours are
shared with the app, so a reader who has seen the canvas recognises them.
Everything else is greys, and there are deliberately few of them.
