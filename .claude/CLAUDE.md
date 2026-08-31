# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Desktop Streamer — an open source remote desktop / screen sharing application (web + Electron client, Node.js server). Very early stage; the architecture is actively being restructured, so verify a module against its source before trusting an assumption about it.

## Commands

`npm run server` and `npm run uninstall` are the only scripts; both accept `--help`, which is the authoritative list of their flags (`npm run server -- --help`). Arguments after `--` are forwarded, and `--configuration` only parses as `--configuration=<path>` (the inline form) or as `-c <path>`.

`npm test` runs `tests/*.test.js` through Node's built-in runner (`node --test`, no dev dependencies — keep it that way). The tests covering build output skip themselves unless `./tmp/web` holds a build, so run `npm run server -- --compile --exit` first to exercise them. There is no linter and nothing type-checks. `dev/rollup/conf.mjs` is an ad hoc helper for vendoring third-party packages into a `libs/` folder, never part of a normal run.

The default config path is `./conf/config.json`; `conf/config.example.json` is a valid SQLite-backed starting point, and `conf/` is gitignored apart from it.

## Architecture

ESM (`"type": "module"`) throughout. The one exception is `src/client/electron/main.js`, which stays CommonJS because Electron loads it directly — `building.js` minifies that folder in script mode for exactly this reason.

### Server (`src/server/`)

`server.js` is a thin CLI entry: parse flags → `loadConfig` → `compileClients` → start HTTP → start WS → install SIGINT/SIGTERM handlers. Each stage prints a `doing...    done/failed/skipped` line to stdout; keep that reporting style when adding a stage. Both servers are singletons imported as instances, and shutdown stops WS before HTTP because WS may be an upgrade on the HTTP server's own listener. `session.js` is an empty placeholder.

- `config.js` — the Ajv (draft-07) JSON Schema is the source of truth for every accepted config field. Cross-field rules the schema cannot express live in `checkConstraints` (port collisions — WS may share the HTTPS port but nothing else may collide; `http.remote` and a local `ws` section are mutually exclusive). `loadConfig` resolves the SQLite path and **replaces `key`/`cert` paths with their file contents**, relative to the config file's own directory, so downstream code holds PEM text, not paths.
- `http.js` — a singleton `ServerHTTP` instance (exported as the instance, not the class). Serves `./tmp/web` and `./tmp/desktop`. Two request handlers: a streaming one, and a cache one chosen when `http.cache` is configured; both answer through the same `isRoutePath`, `isNotModified` and `fileHeaders`. The SPA fallback to `index.html` is for **routes only** — a path with a file extension, or one under `/src/`, `/ui/`, `/libs/` or `/media/`, 404s instead, or a mistyped `import()` specifier would arrive as HTML and fail with an opaque MIME error. Files carry `Cache-Control: no-cache` and a quoted `ETag`, and a matching `If-None-Match` (or `If-Modified-Since`) is answered 304. The cache is frequency-based, not LRU: a rolling access window re-scores every file by `accesses / size` every few seconds and swaps buffers in and out under the byte budget.
- `ws.js` — `ServerWS`: the realtime/signaling server, exported as the instance. It was cut back to the parts that make a connection usable — the socket lifecycle, a per-connection session id (`generateSessionId`, unique among the live `clients` Map), and a `handleAPI` answering three types: `ping` (connection test), `session-get`, `version-check` (against `getVersion()`). Everything else — the knex/MySQL/SQLite persistence, sign-in and account sessions, pair codes, joins and the WebRTC signaling relay — was removed and is planned in `dev/plans/`, with the previous implementation at commit `6c0d18a`. The old code also read a config shape (`ws.emails`, `ws.features.*`) that `config.js` no longer accepts, so do not paste it back untouched.
- `building.js` — the client build (see below).
- `zip.js` — a small zip reader and writer over `node:zlib`, the only thing that packs the desktop clients. `readZip` hands back every entry with its bytes **still deflated**, and `writeZip` streams a zip out of entries that are either copied over like that or given as `data`/`path` and deflated here, a few at a time on the thread pool. Plain zip only: it throws on zip64, on an encrypted entry, and when the output would pass 4 GB.
- `common.js` — shared helpers (`argGet`, `getVersion`, `setAbsolute`, `binarySearch`, `httpsGetText`/`httpsGetImage`). `serverScriptPath` points at `./src`, and every client path is derived from it.
- `communicator.js`, `mime.js` — vendored, see Licensing.

### Client build flow

**Nothing serves `src/client/web` directly.** `compileClients()` builds into `./tmp`, and the HTTP server only ever serves that output, so a change to the web client is invisible until you rebuild it — run `npm run server -- --compile` (a boot with an existing `tmp/web/index.html` and no `--compile` skips the build entirely).

The build minifies with `UglifyJS` for JS and **hand-written character scanners in `building.js`** for CSS/HTML — there is no minifier dependency for those. A file that fails to minify is copied verbatim with a warning rather than failing the build.

The desktop zips are packed by `zip.js`, not by a library: an Electron dist that is already a `.zip` is copied into the output entry by entry **without going through deflate again**, and only the files that are new — the web client, the Electron shell, the native libs — are compressed, in parallel through native `zlib`. That is what keeps a full compile at a few seconds instead of a minute and a half; the cost is about 1% on the size of the zip, because the dist keeps whatever compression it arrived with. JSZip was measured against this on `win32-x64` and dropped: it deflates through pako, in JavaScript on the main thread, which takes ~39 s on the 206 MB of native libs (~14 s at level 6, ~5 s at level 1) where `node:zlib` on four threads of the pool takes ~2.6 s — a full compile of ~42 s against ~4.5 s. Output:

- `tmp/web/` — the minified web client, plus a generated `config.json` and `version`. Both are listed in `GENERATED_FILES` and skipped when copying sources; `http.js` writes them again at boot with the download list of available client zips.
- `tmp/desktop/<os>-<arch>.zip` — an Electron dist from `./bin/<os>-<arch>[.zip]` with its `default_app.asar` stripped, repacked with the web client, the Electron shell, the matching `src/client/native/<os>-<arch>` libs, and `config.json` under `resources/app` (`Electron.app/Contents/Resources/app` on darwin). A target is only built when both a `bin/` dist and a matching native lib folder exist.

`./bin` and `./tmp` are gitignored (placeholder files aside) — the Electron dists are not in the repo.

### Client (`src/client/web/`, `src/client/electron/`)

Plain ES modules, no framework, no dev build step, no bundler — the loader is `import()`. The web root holds the four files the whole application starts from — `index.html`, `index.css`, `index.js` and `config.json` — and nothing else but the `src/`, `ui/`, `libs/` and `media/` folders. `index.html` is only the shell: the two navigation bars, the shared overlay, the loading dialog and the `<main id="screen-main">` the screens are mounted into. Everything else is a UI module under `ui/<name>/` holding its own `index.js`, `view.html`, `view.css` and `localization.json`, loaded and mounted the first time the router needs it. `config.json` is fetched at runtime and is server-generated — never hand-edit it.

- `index.js` (~230 lines) is boot plus the shell wiring, then it hands off to the router.
- `src/` — the core, functions only: `env.js` (browser/OS detection), `conf.js` (config.json + the IndexedDB local config), `desktop.js` + `desktop-native.js` (the Electron `require()` block, only imported under Electron), `server.js` (the `Server` transport class, ~700 lines, still the next file wanting this treatment), `localization.js` (the localization core plus the shell slice, the one dictionary that is code rather than data), `view.js` (the `View`/`Panel`/`Screen`/`Dialog` contract), `registry.js` (the route table and the module cache), `router.js` (path → module, history, the delegated click handler).
- `ui/` — one folder per screen or dialog. Nested folders are nested modules: the five settings windows and the three account windows load on demand inside their dialog.

The module contract: default-export one class extending `Screen`, `Dialog` or `Panel` with `static id`, `static rootId` (the id of its own markup) and `static mountPoint`, plus `mount(ctx)` / `open(params)` / `close()`. A module never imports its own markup or strings: the registry entry names its `view.html`, `view.css` and `localization.json`, fetches the three in parallel with the script, merges the dictionary slice and translates the fragment before it reaches the document. `ctx` — `{server, conf, setLocal, localization, router, desktop, ui}` — is the only way a module reaches anything outside itself; a module that has to talk upward dispatches an event on itself. Adding a screen means a folder, a line in the `registry.js` route table (**literal** `import()` specifiers only, so `tests/assets.test.js` can see them) and a `data-route` attribute in the markup — it never touches `index.js`.

Layout: `index.html`, `index.css`, `index.js` and `config.json` at the web root, the core under `src/`, the UI modules under `ui/`, every image and sound under `media/`, vendored browser libs under `libs/`. Assets are referenced by root-absolute path (`/media/icon.svg`, `/ui/new/view.html`) — the build preserves the source layout and walks it recursively, so a new module folder needs no build change and a path that resolves in the sources resolves in `tmp/web`. The Electron shell serves the same tree over `local://`, so its own asset paths (`media/icon-32.png` for the tray) must track any move too.

The Electron shell registers a privileged `local://` protocol that serves the bundled web app from the app path (so the desktop client reuses the web client verbatim), exposes a small IPC API to the renderer, and manages the tray plus a single-instance lock. Note the two known holes in `main.js`: the `local://` handler does not guard against paths escaping the bundle, and `ignore-certificate-errors` is switched on for debugging.

`src/client/native/<os>-<arch>/` holds prebuilt ffmpeg binaries and the `easy-control` input addon (ViGEmClient on Windows). Only `win32-x64` exists today, which is why it is the only buildable desktop target.

### `model/`

A `uv`-managed Python project (pinned to 3.14, Torch from a CUDA 13.2 index) for the video upscaling and frame-generation work: `upscale/`, `frame_gen_intra/`, `frame_gen_extra/`. Separate from the Node app; nothing in `src/` calls it yet.

## Code conventions

Follow the surrounding file: `"use strict"` at the top, imports grouped and commented as internal / third-party / first-party, `const name = function() {}` over declarations, bracket access with string keys for config and message objects (`conf["ws"]["port"]`), double quotes, 4-space indent, and a module footer exporting both named and default (`export { a, b }; export default { a, b };`).

## Licensing

AGPL-3.0-or-later. `src/server/communicator.js`, `src/server/mime.js`, and `src/client/web/libs/communicator/communicator.js` are vendored copies of the maintainer's own `easy-communicator` / `easy-mime`, re-licensed by the copyright holder as LGPL-3.0-or-later inside this repo — they are deliberately not npm dependencies, so edit the copies here and keep their SPDX headers. The server and browser `communicator.js` implement the same packetized, acknowledgment-based protocol over an abstract `sender` transport and must stay in sync; it backs the WebSocket signaling channel today and is intended for WebRTC data channels too.

## AI-assisted development

This repo references (see `README.md`):
- https://github.com/mattpocock/skills
- https://github.com/DeusData/codebase-memory-mcp
- https://playwright.dev/docs/getting-started-mcp
