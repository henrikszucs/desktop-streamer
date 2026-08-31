# Modular client UI

Restructure `src/client/web` the way `src/server` is structured: one module per
responsibility, each owning its own code, markup, styles and strings, loaded and
executed when the UI actually needs it instead of all at boot.

## What is there now

| file | lines | built |
| --- | --- | --- |
| `src/index.js` | 3805 | 72 KB minified |
| `index.html` | 981 | 175 `id=`, 107 `data-i18n` |
| `index.css` | 569 | 8 KB minified |
| `src/localization.js` | 655 | 125 dictionary entries |

`src/index.js` holds all of it: browser and OS detection, the IndexedDB local
configuration, the `Server` transport class (700 lines), seventeen UI classes,
and a 500-line `main()` that wires them together. It runs 196
`document.getElementById` calls and attaches 133 listeners before the first
paint, because every screen and every dialog is constructed at boot whether or
not it is ever opened. `SettingsDialog` alone is ~1000 lines and builds five
sub-windows (appearance, audio, video, control, about) on the way in.

The markup for all of it already exists in `index.html` and is toggled with
`hide` and `active` classes, so the DOM is fully built at boot too.

## What this buys, honestly

**Not download size.** The whole client is 72 KB minified next to 146 KB of
beercss (86 KB of stylesheet, 60 KB of script). Splitting it might save 40 KB on
first paint. That is not the reason to do this.

**Maintainability.** A 3805-line file with seventeen classes in it has no seams.
Every change means reading past everything else, and two people cannot touch two
screens without meeting in the same file.

**Startup work.** 196 element lookups, 133 listeners and seventeen constructors
run before anything is on screen, for a visitor who is going to click one thing.

**Isolation.** `LoginScreen` reaches for the module-level `server` binding
directly. `main()` reaches into the fields of every class it builds
(`roomRequestDialog.info`, `newScreen.displayJoinError`). Nothing can be moved,
tested or reasoned about on its own. A module contract fixes that, and it is
worth doing even for the parts that stay eagerly loaded.

## The enabling fact

`buildFolder` in `src/server/building.js` walks the client folder **recursively**
and preserves the source layout, minifying per file. New files and new folders
under `src/client/web` need **no build change at all** - they are picked up,
minified and served at the same path they have in the sources. UglifyJS handles
everything this plan needs: class fields, `import()`, `import.meta.url`,
top-level await, private fields and static blocks (verified against the pinned
version).

So the loader is the one the browser already has: `import()` returns a promise,
caches by URL, and evaluates once. No bundler, no framework, no dev build step -
which is the constraint this repo already holds itself to.

## The module contract

Every UI module default-exports one class with the same shape:

```
export default class extends View {
    static id = "devices";

    async mount(ctx) {}      // once, after the markup is in the DOM
    open(params) {}          // shown
    close() {}               // hidden
    destroy() {}             // optional, release heavy state
};
```

`mount` runs once and does what the constructors do today: find elements, attach
listeners. `open` and `close` stay exactly what they are now - the existing
classes already have them, so most of the conversion is mechanical.

`ctx` is the only way a module reaches anything outside itself:

```
{"server": server, "conf": conf, "i18n": i18n, "router": router,
 "desktop": desktop, "ui": ui}
```

No module-level singleton reached across a file boundary. This is the part that
matters most; the laziness is a consequence of it, not the point of it.

Modules that need to talk upward keep the existing `EventTarget` pattern -
`NewScreen` dispatching `join` and `create` is the right shape already. What they
must stop doing is letting `main()` reach into their fields.

## Target layout

This is what landed, with the folder names it landed under: the core sits
directly in `src/` rather than in a `core/` inside it, `ui/` is a sibling of
`src/` at the web root, and the strings of a module are a `localization.json`
the registry fetches rather than a script the module imports.

```
src/client/web/
    index.html                  the shell: nav, overlay, loading dialog, mount points
    index.css                   shell styles and the shared bits
    index.js                    boot, then hand off to the router
    config.json                 server-generated, fetched at runtime
    src/
        env.js                  browser and OS detection
        conf.js                 config.json fetch + the IndexedDB local config
        desktop.js              the Electron require() block, loaded only under Electron
        server.js               the Server class
        localization.js         localization core (get, translate, putParameters)
        registry.js             the lazy loader and the module cache
        router.js               path to module, history, popstate
        view.js                 the View base class
    ui/
        new/                index.js, view.html, view.css, localization.json
        downloads/
        login/
        services/
        devices/
        shares/
        room/
        settings/           its five sub-windows are modules of their own
        account/
        menu/
        room-create/
        room-request/
        room-joining/
```

The split follows what is already there - the seventeen classes, and the
`/* Settings dialog */`-style section comments in `index.css`, map onto these
folders almost one to one.

## Loading

`registry.js` keeps a table of **literal** specifiers:

```
const routes = new Map([
    ["new",       () => import("../ui/new/index.js")],
    ["downloads", () => import("../ui/downloads/index.js")],
    ["devices",   () => import("../ui/devices/index.js")]
]);
```

Not `import("../ui/" + id + "/index.js")`. A built specifier works at runtime but
hides every path from `tests/assets.test.js`, whose `relativeImports` scanner
already matches `import(` with a literal argument. Keep the paths scannable.

Loading a module pulls its three files at once, so there is no serial round trip:

```
const [mod, html] = await Promise.all([
    entry.loader(),
    fetch(base + "/view.html").then((res) => res.text()),
    loadStylesheet(base + "/view.css")     // resolves on the load event of the link
]);
```

Wait for the stylesheet before the first `open()`, or the markup paints unstyled.

The router owns `openedScreen` and `openedDialog` - today they are locals inside
`main()` - and does load, mount, open, closing the previous one first.

## Markup, styles and strings

**Markup** moves out of `index.html` into a `view.html` fragment per module,
injected into a mount point on first `mount()`. The build minifies `.html` with
the existing `minifyMarkup` scanner automatically - verify it handles a fragment
with no `<html>` wrapper, it is a character scanner so it should.

The alternative is a template literal inside `index.js` - one fewer request, and
`DeviceBox` in the current code already does exactly that. Use that for small
repeated components (the device and share boxes) and files for screens and
dialogs, where the markup runs 50-200 lines and is worth having in an `.html`
file with the editor tooling that comes with it.

**Styles** move into `view.css` per module, injected as a `<link>` on first mount
and never removed. `index.css` keeps only the shell and the shared utilities
(`.hide`, the nav fixes, the media queries).

**Strings** split the same way. `localization.js` becomes the core (`get`,
`translate`, `putParameters`, `setLang`) and each module ships its own slice,
merged into the dictionary on mount. Two changes are needed in the core:

- `translate()` walks `document.querySelectorAll("[data-i18n]")` once at boot. It
  needs a root parameter - `translate(lang, root = document)` - so a freshly
  injected fragment can be translated on mount.
- `supportedLanguages` is computed once from the whole dictionary at module load.
  With slices arriving later it has to come from the core slice instead, or be an
  explicit list.

## What stays eager

Lazy-loading everything is worse than lazy-loading the right things.

- the shell: nav, overlay, loading dialog
- `core/env.js`, `core/conf.js`, `core/i18n.js` - needed before the first paint
- `core/server.js` - the socket should be opening while the UI loads
- `ui/new` - it is the default route, so deferring it only delays first paint.
  Import it statically from the entry, or prefetch it before the router runs.

Everything else loads on first navigation. Prefetch the rest on
`requestIdleCallback` once the app is online, so the first click on Settings is
not the first time the browser hears about it.

The module map caches per page load, so only the first visit to a screen pays.
Show the existing `LoadingDialog` if a load takes longer than ~150 ms.

## Two server-side changes this needs

Both are small, and both turn a class of failure that would be mysterious into
one that is obvious.

**1. The SPA fallback swallows 404s.** `httpsRequestHandler` and
`httpsRequestHandlerWithCache` in `src/server/http.js` answer *any* unknown path
with `index.html` and status 200. A mistyped `import()` specifier therefore does
not 404 - the browser gets HTML with `Content-Type: text/html` and fails the
import with an opaque MIME error. With one client file that never came up; with
forty it will come up weekly. Fall back only for paths that look like routes: no
file extension, and not under `/src/`, `/libs/` or `/media/`.

**2. Nothing is cacheable.** The streaming handler sends
`Cache-Control: no-cache, no-store, must-revalidate` and an `ETag`; the cache
handler sends neither `Cache-Control` nor `ETag`. Neither handler reads
`If-None-Match` or `If-Modified-Since`, so nothing ever answers 304 and every
asset is downloaded in full on every load. Splitting one file into forty
multiplies the request count against a server that refuses to let anything be
reused. Answer 304 on a matching `ETag`, and give the two handlers the same
headers.

## Staging

Not one commit. There is no behavioural test coverage of the client at all, so
each phase has to be small enough to check by hand.

**Phase 1 - move, do not change.** Split `src/index.js` into `core/` and `ui/`
files. Everything still statically imported from `index.js`, everything still
constructed eagerly, markup and CSS untouched. Pure file moves plus imports and
exports. This is the phase that gets the 3805-line file down to something
navigable, and it is the safest one.

**Phase 2 - the contract.** Introduce `View`, `ctx` and `mount()`. Stop modules
reaching for module-level globals; stop `main()` reaching into module fields.
Still eager. `main()` should come out of this as boot plus a wiring table.

**Phase 3 - the router and the registry.** Replace the if-else chain in
`loadPath()` and the two-listeners-per-screen wiring with a route table and one
delegated `[data-route]` click handler. Every screen currently needs two buttons
wired by hand - `btn-devices` and `btn-devices-2`, the side menu and the bottom
bar - and a delegated handler removes about 60 lines and means adding a screen no
longer touches `main()`. Switch to `import()`. Fix the server fallback first.

**Phase 4 - markup, styles and strings.** Move `view.html`, `view.css` and the
dictionary slices out one module at a time, starting with a leaf like `downloads`
and finishing with `settings`.

## Tests to update

Both of these scan a **hardcoded list of files**, so after a split they would
keep passing while checking almost nothing. Fix them in phase 1, before the files
move.

- `tests/assets.test.js` - checks `["index.html", "src/index.js", "index.css"]`.
  Make it walk `src/client/web` and check every `.js`, `.html` and `.css` it
  finds. Its two scanners (`rootAbsoluteRefs`, `relativeImports`) already do the
  right thing per file.
- `tests/localization.test.js` - reads `data-i18n` keys from `index.html` only.
  Make it walk the tree the same way. The regex `data-i18n="([^"]+)"` matches
  inside a JS template literal too, so it keeps working for markup that stays
  in `.js`.

Worth adding: a test that every specifier in a registry table resolves to a file
that exists. It is the one class of error the browser reports badly.

## Decisions to make first

1. **Fragment files or template literals** for screen markup. The plan above says
   files for screens and dialogs, literals for repeated components. Pick one rule
   and hold to it.
2. **How far the settings dialog splits.** Its five sub-windows already have
   `open` and `close` and a `changeWindow` that is a small router of its own.
   They are the clearest case for nested lazy modules, and also the most work.
3. **Whether `Server` splits too.** It is 700 lines and its `handleIncoming` is a
   200-line switch over server events. It is transport, not UI, so it is out of
   scope here - but it is the next file that will want this treatment, and it
   will be easier once `ctx` exists.
