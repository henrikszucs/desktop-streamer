# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Desktop Streamer — an open source remote desktop / screen sharing application (web + Electron client, Node.js server). Very early stage; the architecture is actively being restructured, so verify a module against its source before trusting an assumption about it.

## Commands

`npm run server` and `npm run uninstall` are the only scripts; both accept `--help`, which is the authoritative list of their flags (`npm run server -- --help`). Arguments after `--` are forwarded, and `--configuration` only parses as `--configuration=<path>` (the inline form) or as `-c <path>`.

There is no test runner, linter, or bundler — `tests/` exists but is empty, and nothing type-checks. `dev/rollup/conf.mjs` is an ad hoc helper for vendoring third-party packages into a `libs/` folder, never part of a normal run.

The default config path is `./conf/config.json`; `conf/config.example.json` is a valid SQLite-backed starting point, and `conf/` is gitignored apart from it.

## Architecture

ESM (`"type": "module"`) throughout. The one exception is `src/client/electron/main.js`, which stays CommonJS because Electron loads it directly — `building.js` minifies that folder in script mode for exactly this reason.

### Server (`src/server/`)

`server.js` is a thin CLI entry: parse flags → `loadConfig` → `compileClients` → start HTTP → install SIGINT/SIGTERM handlers. Each stage prints a `doing...    done/failed/skipped` line to stdout; keep that reporting style when adding a stage. **The WS server is not wired in yet** — `server.js` carries a `// TODO: start the WS server` where it belongs, so `ws.js` is currently reachable only by importing it directly. `session.js` is an empty placeholder.

- `config.js` — the Ajv (draft-07) JSON Schema is the source of truth for every accepted config field. Cross-field rules the schema cannot express live in `checkConstraints` (port collisions — WS may share the HTTPS port but nothing else may collide; `http.remote` and a local `ws` section are mutually exclusive). `loadConfig` resolves the SQLite path and **replaces `key`/`cert` paths with their file contents**, relative to the config file's own directory, so downstream code holds PEM text, not paths.
- `http.js` — a singleton `ServerHTTP` instance (exported as the instance, not the class). Serves `./tmp/web` and `./tmp/desktop`, falling back to `index.html` for unknown paths (SPA routing). Two request handlers: a streaming one, and a cache one chosen when `http.cache` is configured. The cache is frequency-based, not LRU: a rolling access window re-scores every file by `accesses / size` every few seconds and swaps buffers in and out under the byte budget.
- `ws.js` — `ServerWS`: the realtime/signaling server. All live state is in-memory `Map`s on the instance (`clients`, `sessions`, `subscriptions` per user field, `pairs` for pairing codes, `joins` + `joinsUser` index) with no external cache or session store, so it is single-process by construction. Persistence goes through `knex` to MySQL or SQLite (`better-sqlite3`), with the schema created on first boot. `handleAPI` is a ~1300-line switch that is the whole client-facing protocol surface. Google sign-in is verified by calling Google's tokeninfo endpoint over plain HTTPS (`httpsGetText` in `common.js`) — no client library.
- `building.js` — the client build (see below).
- `common.js` — shared helpers (`argGet`, `getVersion`, `setAbsolute`, `binarySearch`, `httpsGetText`/`httpsGetImage`). `serverScriptPath` points at `./src`, and every client path is derived from it.
- `communicator.js`, `mime.js` — vendored, see Licensing.

### Client build flow

**Nothing serves `src/client/web` directly.** `compileClients()` builds into `./tmp`, and the HTTP server only ever serves that output, so a change to the web client is invisible until you rebuild it — run `npm run server -- --compile` (a boot with an existing `tmp/web/index.html` and no `--compile` skips the build entirely).

The build minifies with `UglifyJS` for JS and **hand-written character scanners in `building.js`** for CSS/HTML — there is no minifier dependency for those. A file that fails to minify is copied verbatim with a warning rather than failing the build. Output:

- `tmp/web/` — the minified web client, plus a generated `config.json` and `version`. Both are listed in `GENERATED_FILES` and skipped when copying sources; `http.js` writes them again at boot with the download list of available client zips.
- `tmp/desktop/<os>-<arch>.zip` — an Electron dist from `./bin/<os>-<arch>[.zip]` with its `default_app.asar` stripped, repacked with the web client, the Electron shell, the matching `src/client/native/<os>-<arch>` libs, and `config.json` under `resources/app` (`Electron.app/Contents/Resources/app` on darwin). A target is only built when both a `bin/` dist and a matching native lib folder exist.

`./bin` and `./tmp` are gitignored (placeholder files aside) — the Electron dists are not in the repo.

### Client (`src/client/web/`, `src/client/electron/`)

Plain ES modules, no framework, no dev build step. `index.html` is a single-page shell holding every dialog/screen, toggled by `hide` classes and styled with the bundled `beercss`. `src/index.js` (~3800 lines) is essentially all client logic; `src/localization.js` holds the `en`/`hu` dictionary that drives `data-i18n` attributes. `config.json` is fetched at runtime and is server-generated — never hand-edit it.

Layout: `index.html` and `index.css` at the web root, ES modules under `src/`, every image and sound under `media/`, vendored browser libs under `libs/`. Assets are referenced by root-absolute path (`/media/icon.svg`, `/src/index.js`) — the build preserves the source layout, so a path that resolves in the sources resolves in `tmp/web`. The Electron shell serves the same tree over `local://`, so its own asset paths (`media/icon-32.png` for the tray) must track any move too.

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
