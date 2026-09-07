# Modular client UI — done

Restructuring `src/client/web` the way `src/server` is structured: one module
per responsibility, each owning its own code, markup, styles and strings. **All
four phases landed**, so this file is a record rather than a plan; the reasoning
that outlived it is in [`.claude/CLIENT.md`](../../.claude/CLIENT.md) and the
layout and module contract are in [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md).

What it started from: a 3805-line `src/index.js` holding browser detection, the
local configuration, a 700-line `Server` class and seventeen UI classes, plus a
981-line `index.html` that built every screen and dialog at boot. What it landed
as: the four files at the web root, the core under `src/`, one folder per module
under `ui/`, and `import()` as the loader — no bundler, no framework, no dev
build step.

The two server-side changes it asked for landed with it, both in
`src/server/http.js`: the SPA fallback now answers `index.html` for **routes
only** (a mistyped `import()` specifier 404s instead of arriving as HTML with an
opaque MIME error), and both request handlers send the same `Cache-Control` and
`ETag` and answer 304 on a match. The two tests that scanned a hardcoded file
list now walk the tree — `tests/assets.test.js` also checks that every registry
specifier resolves, which is why they must stay **literal**.

Two things it planned and the code did not keep:

- **Per-module laziness.** `buildUI` mounts every module before the router runs.
  The tree is small enough that deferring only bought a wait on the first click
  of each, and the router needs the chrome in the document to be able to hide it.
- **`core/`.** The core sits directly in `src/`, `ui/` is its sibling at the web
  root, and a module's strings are a `localization.json` the registry fetches
  rather than a script it imports.

The one decision left open: whether `Server` splits when the account calls in
[ws-accounts.md](ws-accounts.md) put more into it. It is transport, not UI.
