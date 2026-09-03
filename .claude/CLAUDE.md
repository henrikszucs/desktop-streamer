# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Desktop Streamer — an open source remote desktop / screen sharing application (web + Electron client, Node.js server). Very early stage; the architecture is actively being restructured, so verify a module against its source before trusting an assumption about it.

## Commands

`npm run server` and `npm run uninstall` are the only scripts; both accept `--help`, which is the authoritative list of their flags (`npm run server -- --help`). Arguments after `--` are forwarded. One rule covers every option that takes a value: a **short** option takes its value as the next argument (`-c ./conf/config.json`), a **long** one joined by an equals sign (`--configuration=./conf/config.json`). `getArg` in `common.js` is a plain reader and the caller names the form it wants (`isKeyValue`, `isInline`); `checkArg` beside it is what holds the CLI to the rule, refusing the wrong form by name at startup rather than letting it fall through to a default nobody asked for. It also catches what `getArg` cannot see on its own - a short option with nothing behind it, or with the next option behind it, where `-c --compile` would be read as a path called `--compile`.

`npm test` runs `tests/**/*.test.js` through Node's built-in runner (`node --test`, no dev dependencies — keep it that way). The tests covering build output skip themselves unless `./tmp/web` holds a build, so run `npm run server -- --compile --exit` first to exercise them. There is no linter and nothing type-checks. `dev/rollup/conf.mjs` is an ad hoc helper for vendoring third-party packages into a `libs/` folder, never part of a normal run.

The default config path is `./conf/config.json`; `conf/config.example.json` is a valid SQLite-backed starting point, and `conf/` is gitignored apart from it.

Only `ajv`, `uglify-js` and `ws` are actually imported. `better-sqlite3`, `knex`, `mysql2` and `nodemailer` are still in `dependencies` but nothing in the repo imports them — they are held for the persistence and email work in `dev/plans/`, and `better-sqlite3` is why a plain `npm install` builds a native addon. `electron` is deliberately *not* a dependency: the shell runs inside the prebuilt dist from `./bin`.

## Architecture

ESM (`"type": "module"`) throughout. The one exception is `src/client/electron/main.js`, which stays CommonJS because Electron loads it directly — `building.js` minifies that folder in script mode for exactly this reason.

### Server (`src/server/`)

`server.js` is a thin CLI entry: parse flags → `loadConfig` → `compileClients` → start HTTP → start WS → install SIGINT/SIGTERM handlers. Each stage prints a `doing...    done/failed/skipped` line to stdout; keep that reporting style when adding a stage. Both servers are singletons imported as instances, and shutdown stops WS before HTTP because WS may be an upgrade on the HTTP server's own listener. `session.js` is an empty placeholder.

- `config.js` — the Ajv (draft-07) JSON Schema is the source of truth for every accepted config field. Cross-field rules the schema cannot express live in `checkConstraints` (port collisions — WS may share the HTTPS port but nothing else may collide; `http.remote` and a local `ws` section are mutually exclusive). `loadConfig` resolves the SQLite path and **replaces `key`/`cert` paths with their file contents**, relative to the config file's own directory, so downstream code holds PEM text, not paths. The schema still **requires** `ws.database` and accepts `ws.email`/`ws.auth`, but no server code reads them today — only `auth.<provider>.clientId` reaches a client, through `buildPublicConf`. A `ws` section that shares the HTTPS port likewise still has to carry a `key`/`cert` pair that is never used, because the HTTP server's listener is the one the upgrade is added to.
- `http.js` — a singleton `ServerHTTP` instance (exported as the instance, not the class). Serves `./tmp/web` and `./tmp/desktop`. Two request handlers: a streaming one, and a cache one chosen when `http.cache` is configured; both answer through the same `isRoutePath`, `isNotModified` and `fileHeaders`. The SPA fallback to `index.html` is for **routes only** — a path with a file extension, or one under `/src/`, `/ui/`, `/libs/` or `/media/`, 404s instead, or a mistyped `import()` specifier would arrive as HTML and fail with an opaque MIME error. Files carry `Cache-Control: no-cache` and a quoted `ETag`, and a matching `If-None-Match` (or `If-Modified-Since`) is answered 304. The cache is frequency-based, not LRU: a rolling access window re-scores every file by `accesses / size` every few seconds and swaps buffers in and out under the byte budget.
- `ws.js` — `ServerWS`: the realtime/signaling server, exported as the instance. It was cut back to the parts that make a connection usable — the socket lifecycle, a per-connection session id (`generateSessionId`, unique among the live `clients` Map), and a `handleAPI` answering four types: `conf-get` (the public half of the configuration, built once by `buildPublicConf` — ICE servers, the `permissions` block and the public auth client ids, never key material, SMTP credentials, OAuth secrets or database settings; the browser client stays offline until this one answers). `permissions` answers `guestAllowShare`, `guestAllowJoin`, `isAuth` (any sign-in at all) and `isGoogleAuth` for every client whether the config sets them or not, so the client gates features on the answer rather than on a default of its own; `guestAllowRelay`, `userRegister` (whether an unknown account may be created at sign-in) and `userRegisterRelay` stay server-side, `ping` (connection test), `session-get`, `version-check` (against `getVersion()`). A call it does not serve is *answered* `{"success": false, "error": ...}` rather than aborted — aborting an incoming message sends nothing back, so the caller would sit out its whole interaction timeout. Everything else — the knex/MySQL/SQLite persistence, sign-in and account sessions, pair codes, joins and the WebRTC signaling relay — was removed and is planned in `dev/plans/`, with the previous implementation at commit `6c0d18a`. The old code also read a config shape (`ws.emails`, `ws.features.*`) that `config.js` no longer accepts, so do not paste it back untouched.
- `building.js` — the client build (see below).
- `zip.js` — a small zip reader and writer over `node:zlib`, the only thing that packs the desktop clients. `readZip` hands back every entry with its bytes **still deflated**, and `writeZip` streams a zip out of entries that are either copied over like that or given as `data`/`path` and deflated here, a few at a time on the thread pool. Plain zip only: it throws on zip64, on an encrypted entry, and when the output would pass 4 GB.
- `common.js` — shared helpers (`argGet`, `getVersion`, `generateId`, `binarySearch`, `isDirEmpty`, `setAbsolute`, `httpsGetText`/`httpsGetImage`). `serverScriptPath` points at `./src`, and every client path is derived from it.
- `localization.js` — **dead code**: an old fork of the client localization module that still calls `document.querySelectorAll` and still exports `load`/`translateHTML` where `src/client/web/src/localization.js` has since moved to `add`/`translate`. Nothing on the server imports it. `localization.json` beside it is *not* dead — it holds the account-deletion email strings the removed email code used, and `tests/localization.test.js` still checks its language coverage.
- `communicator.js`, `mime.js` — vendored, see Licensing.

### Client build flow

**Nothing serves `src/client/web` directly.** `compileClients()` builds into `./tmp`, and the HTTP server only ever serves that output, so a change to the web client is invisible until you rebuild it — run `npm run server -- --compile` (a boot with an existing `tmp/web/index.html` and no `--compile` skips the build entirely).

The build minifies with `UglifyJS` for JS and **hand-written character scanners in `building.js`** for CSS/HTML — there is no minifier dependency for those. A file that fails to minify is copied verbatim with a warning rather than failing the build.

The desktop zips are packed by `zip.js`, not by a library: an Electron dist that is already a `.zip` is copied into the output entry by entry **without going through deflate again**, and only the files that are new — the web client, the Electron shell, the native libs — are compressed, in parallel through native `zlib`. That is what keeps a full compile at a few seconds instead of a minute and a half; the cost is about 1% on the size of the zip, because the dist keeps whatever compression it arrived with. JSZip was measured against this on `win32-x64` and dropped: it deflates through pako, in JavaScript on the main thread, which takes ~39 s on the 206 MB of native libs (~14 s at level 6, ~5 s at level 1) where `node:zlib` on four threads of the pool takes ~2.6 s — a full compile of ~42 s against ~4.5 s. Output:

- `tmp/web/` — the minified web client, plus a generated `index.json`. It is listed in `GENERATED_FILES` and skipped when copying sources; `buildConfFile` is the only thing that writes it, for the web client and every desktop zip in one go, and **nothing rewrites it at boot** — a client is only ever handed the config of the build it is part of, so it cannot fail its version check against the server it was built by. Change an address in the configuration and the clients see it at the next `--compile`, not at the next boot. It is the only generated file — `version`; an `http` and a `ws` section each holding the `domain` and `port` that server is reached at (the two are configured apart and may differ); and `clients`, the `<os>-<arch>.zip` names this compile is about to write, which is what the downloads screen offers.
- `tmp/desktop/<os>-<arch>.zip` — an Electron dist from `./bin/<os>-<arch>[.zip]` with its `default_app.asar` stripped, repacked with the web client, the Electron shell, the matching `src/client/native/<os>-<arch>` libs, and `index.json` under `resources/app` (`Electron.app/Contents/Resources/app` on darwin). A target is only built when both a `bin/` dist and a matching native lib folder exist.

`./bin` and `./tmp` are gitignored (placeholder files aside) — the Electron dists are not in the repo.

### Client (`src/client/web/`, `src/client/electron/`)

Plain ES modules, no framework, no dev build step, no bundler — the loader is `import()`. The web root holds the four files the whole application starts from — `index.html`, `index.css`, `index.js` and `index.json` — and nothing else but the `src/`, `ui/`, `libs/` and `media/` folders. `index.html` holds four elements and nothing else: the shared overlay, the loading dialog, and one surface per segment — `<main id="screen-main" data-segment="management">` and `<main id="room-main" data-segment="room">`, the second starting hidden. That is what has to exist before the first module can be fetched. The two surfaces are the same beercss grid area and the router hides one of them, so the room takes the whole window once the bars are off screen. Every bar, screen and dialog, the two navigation bars included, is a UI module mounted at runtime. **They are all built at boot, not lazily**: `buildUI` in `ui/ui.js` walks the whole `registry.ids()` list before the router runs — one dot-depth at a time, so `settings` is mounted before the `settings.appearance` that mounts into its markup, and a module that throws is logged and skipped rather than taking the boot with it. The tree is small enough that per-module laziness only bought a wait on the first click of each, and the router needs the chrome in the document anyway to be able to hide it. The UI is two segments and a layer over them — `management`, which owns that chrome and the screens the bars lead to (`new`, `devices`, `shares`, `services`, `downloads`, `login`), and `room`, which mounts into its own surface and takes the whole window; the loading dialog covers whichever segment is open, from boot until the server answers and again the moment the connection drops. A piece of shell chrome names its segment with `data-segment`, the router puts the open segment's chrome on screen and takes the rest off, so new chrome needs no router change. Everything else is a UI module under `ui/<layer>/<name>/` holding its own `index.js`, `view.html`, `view.css` and `localization.json`, all four fetched in one round trip when the module is built — `ui/ui.js`, the shell layer the modules are mounted by, is the one file in `ui/` that is not one of them. `index.json` is fetched at runtime and is server-generated — never hand-edit it.

- `index.js` (~100 lines) is boot alone, in five stages: the environment (`applyScale`, `initDesktop`, DOM ready), the configuration (local conf, then `applyTheme`/`applyLanguage`), the shell (the `ctx` it builds `createUI` and the `Router` around), the whole UI through `buildUI`, then the connection — and the loading layer only lifts once `loadPath` has the route on screen under it. Everything boot does to the document lives in `ui/ui.js`: `applyScale` (the root font size, from the display — every length in the shell is a rem, so that one number is the size of the whole UI; it is set again on a resize), `applyTheme` and `applyLanguage` (the local appearance and language settings), `createUI` (the shared overlay and the rest of the `ctx["ui"]` namespace, closing over a `ctx` whose `router` is filled in after) and `buildUI`. The loading layer itself is `createLoading` in `ui/loading/loading.js`, which `createUI` hands the overlay to.
- `src/` — the core, functions only: `env.js` (browser/OS detection, plus the display metrics `applyScale` is built on — `getDisplay`/`getDisplayKind`/`getRootFontSize`. A CSS inch is 96 px by definition, so `screen.width / 96` is the *apparent* size the platform believes in, already divided by the viewing distance it assumes; a phone and a monitor come out right on their own and only a television does not, so a set is scaled and everything else keeps 16px. A set is identified by its user agent alone — `pointer: none` + `hover: none` is what a browser with no input device reports too, headless Chrome at 1280×720 included, so the guess only ever goes towards the desk size), `conf.js` (index.json + the IndexedDB local config), `desktop.js` (the Electron `require()` block, only evaluated under the desktop shell), `server.js` (the `Server` transport class, cut back with `ws.js` to the socket lifecycle and `conf-get`), `localization.js` (the localization core plus the shell slice — the loading layer and the `main.*` strings the two bars share with the menu dialog — the one dictionary that is code rather than data), `view.js` (the `View`/`Panel`/`Screen`/`Dialog` contract), `registry.js` (the route table and the module cache), `router.js` (the `SEGMENTS` table, path → module, history, the delegated click handler).
- The client is always a user: it starts as the **guest**, and signing in adds an account beside it rather than replacing it. Every user's records are rows of the one `user` table in the local IndexedDB, keyed by the id of the user they belong to; the guest is the row under the **empty id** (`GUEST_ID` in `src/conf.js`, reached through `getUser`/`setUser`/`resetUser`), since a client is only ever one guest and the empty key collides with no account. The `configuration` table is not a user's row, which is why a guest reset leaves the theme and the language alone. There is no signed out state and no second menu for one — `ui/management/nav-top/` keeps one user menu - the switch-account submenu, the account dialog and the sign out - whose avatar and check follow the current user, and its sign out means `resetUser("")` (forget the guest's local connections) for the guest and a server session for an account. Nothing carries accounts yet, so the switch-account submenu is the guest alone until `setAccounts()` is handed a list.
- `ui/` — three folders, one per layer of the shell, and `ui.js` over them: `loading/` (the layer over both segments — `loading.js` and the `version/` dialog that replaces it), `management/` (the two bars, the `menu`/`search` dialogs of the small layout, the screens the bars lead to, and the `settings`/`account` dialogs), `room/` (the room screen's own files, and the `create`, `joining`, `request` and `settings` dialogs of the flows into it). Below that, one folder per screen or dialog, and a nested folder is a nested module mounting into its parent's markup: the five settings windows land in `#settings-windows`, the three account windows in `#account-windows`, which is why the build order follows the dot-depth of the registry id. **A registry id is not its path**: `room-create` lives at `ui/room/create/`, and the id is what the shell, the markup and the router know it by.

The module contract: default-export one class extending `Screen`, `Dialog` or `Panel` with `static id`, `static rootId` (the id of its own markup) and `static mountPoint` — plus `static segment` for a screen that does not belong to `management` — and `mount(ctx)` / `open(params)` / `close()`. A module never imports its own markup or strings: the registry entry names its `view.html`, `view.css` and `localization.json`, fetches the three in parallel with the script, merges the dictionary slice and translates the fragment before it reaches the document. `ctx` — `{server, conf, setLocal, resetUser, localization, router, desktop, ui}` — is the only way a module reaches anything outside itself; a module that has to talk upward dispatches an event on itself. Adding a screen means a folder under the layer it belongs to, a line in the `registry.js` route table (**literal** `import()` specifiers only, so `tests/assets.test.js` can see them) and a `data-route` attribute in the markup — it never touches `index.js`.

Layout: `index.html`, `index.css`, `index.js` and `index.json` at the web root, the core under `src/`, the UI modules under `ui/`, every image and sound under `media/`, vendored browser libs under `libs/`. Assets are referenced by root-absolute path (`/media/icon.svg`, `/ui/management/new/view.html`) — the build preserves the source layout and walks it recursively, so a new module folder needs no build change and a path that resolves in the sources resolves in `tmp/web`. The Electron shell serves the same tree over `local://`, so its own asset paths (`media/icon-32.png` for the tray) must track any move too.

The Electron shell registers a privileged `local://` protocol that serves the bundled web app from the app path (so the desktop client reuses the web client verbatim), exposes a small IPC API to the renderer, and manages the tray plus a single-instance lock. Note the two known holes in `main.js`: the `local://` handler does not guard against paths escaping the bundle, and `ignore-certificate-errors` is switched on for debugging.

`src/client/native/<os>-<arch>/` holds prebuilt ffmpeg binaries and the `easy-control` input addon (ViGEmClient on Windows). Only `win32-x64` exists today, which is why it is the only buildable desktop target.

### `model/`

A `uv`-managed Python project (pinned to 3.14, Torch from a CUDA 13.2 index) for the video upscaling and frame-generation work: `upscale/`, `frame_gen_intra/`, `frame_gen_extra/`. Separate from the Node app; nothing in `src/` calls it yet.

## Known server defects

None outstanding. The six that stood here were fixed together; what follows is
what each one taught, so the shape does not come back.

- **A request handler must not throw.** `httpRedirectHandler` read
  `req.headers.host.split(":")`, and an HTTP/1.0 request carries no `Host`: the
  `TypeError` was an uncaught exception in a handler, which ends the process,
  from the one port that is open in plaintext. The header is also attacker
  text, so it is matched against `HOST_NAME` before it reaches a `Location` and
  `http.domain` stands in for anything missing or malformed.
- **A promise started ahead of its `await` needs a handler now, not later.**
  `writeZip` runs up to `CONCURRENCY` deflates in front of the writer. Parked in
  `pending[]` bare, one that rejected early was an unhandled rejection and took
  the process with it, which is what made the `try`/`catch` around
  `writeDistZip` unreachable for the failures it exists for. They are settled
  into `{value}`/`{error}` on creation and re-thrown in the writer's order, and
  a `finally` drains whatever is still in flight.
- **Never build over the name something is served from.** `writeDistZip` writes
  `<target>.zip.part` and renames onto the target only once the zip is whole,
  removing the part file on failure; `compileClients` still catches and moves on
  to the next target, but a half-written client is no longer offered as a
  client.
- **`--help` is a promise.** The usage line advertised `-c, --configuration
  <path>` while `argGet` was inline-only, so `--configuration ./x` matched
  nothing and silently booted the default configuration. The CLI now has one
  rule per form (see Commands above), `--help` states it, and `checkArg` fails
  the run on the wrong form instead of falling back.
- **Closing the connections is not closing the server.** `ws.js` `stop()` calls
  `wsServer.close()`, so in shared-port mode the `upgrade` listener comes off
  the HTTP server rather than staying on it; the `wsHttpServer` close sits
  outside the `wsServer !== null` branch, so a `start()` that failed between
  creating that listener and assigning `wsServer` no longer leaks the port.
- **A cache index is a claim about a disk that keeps changing.** `buildCache`
  is re-run by every `refreshCache` from a fresh listing rather than walked
  once at boot: a file created since (a `view.css` added to a UI module and
  compiled in) used to 404 for the life of the process, and a deleted one went
  on being answered out of memory. Access history survives a rebuild, since it
  belongs to the file rather than to the scan. Beside it: a 304 carries
  `notModifiedHeaders` and so no `Content-Length` for a body that is not
  coming, `isDownloadable` gives both request handlers the same rule for
  `tmp/desktop`, and `refreshCache` admits a file only if it fits the byte
  budget instead of stepping over it with the last one.

## Code conventions

Follow the surrounding file: `"use strict"` at the top, imports grouped and commented as internal / third-party / first-party, `const name = function() {}` over declarations, bracket access with string keys for config and message objects (`conf["ws"]["port"]`), double quotes, 4-space indent, and a module footer exporting both named and default (`export { a, b }; export default { a, b };`).

## Licensing

AGPL-3.0-or-later. `src/server/communicator.js`, `src/server/mime.js`, and `src/client/web/libs/communicator/communicator.js` are vendored copies of the maintainer's own `easy-communicator` / `easy-mime`, re-licensed by the copyright holder as LGPL-3.0-or-later inside this repo — they are deliberately not npm dependencies, so edit the copies here and keep their SPDX headers. The server and browser `communicator.js` implement the same packetized, acknowledgment-based protocol over an abstract `sender` transport and must stay in sync; it backs the WebSocket signaling channel today and is intended for WebRTC data channels too.

## AI-assisted development

This repo references (see `README.md`):
- https://github.com/mattpocock/skills
- https://github.com/DeusData/codebase-memory-mcp
- https://playwright.dev/docs/getting-started-mcp
