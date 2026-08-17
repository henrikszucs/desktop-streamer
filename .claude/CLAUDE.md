# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Desktop Streamer — an open source remote desktop / screen sharing application (web + Electron client, Node.js server). Very early stage; architecture is still being explored and may change significantly.

## Commands

```bash
# Install deps
npm install

# Run the server (reads conf/conf.json by default)
npm run server

# Run with a custom config path
npm run server -- --configuration=./conf.json

# Force (re)compile the Electron client bundles from ./bin into ./tmp
npm run server -- --compile

# Validate a config and exit without starting listeners
npm run server -- --configuration=./conf.json --compile --exit

# Uninstall (removes package-lock.json, node_modules, tmp)
npm run uninstall
# ...also remove ./bin
npm run uninstall -- --bin
```

There is no test runner, linter, or bundler wired into `npm` yet — none of these exist in the repo currently. Web client code runs directly as native ES modules (no build step); `dev/rollup/conf.mjs` is a standalone helper only used ad hoc to vendor third-party packages into `libs/` folders, not part of the normal workflow.

The project is `"type": "module"` (ESM) throughout; Electron's `main.js` is the exception and stays CommonJS (`require`) since it's loaded directly by Electron.

## Architecture

The single npm package contains three runtime pieces plus supporting folders:

- `src/server/server.js` — the server. One large file that: validates/normalizes the JSON config (`processConf`), serves the web client over HTTPS (with an optional in-memory LRU-ish file cache keyed by access frequency), runs a WebSocket server for the realtime protocol, persists to MySQL via `knex` (schema for `users`, `users_google`, `sessions`, `delete`, `joins` is created on first boot if missing), sends account-deletion emails via `nodemailer`, and verifies Google OAuth2 sign-in by calling Google's tokeninfo endpoint directly (no client library). All live state (connected clients, sessions, pub/sub subscriptions per field, pairing codes, join records) is held in in-memory `Map`/`Set` structures on the `Server` instance — there is no external cache/session store.
- `src/client/web/` — the browser client. Plain ES modules, no framework, no build step; `index.html` is a single-page shell containing every dialog/screen (home, downloads, login, services, devices, shares, active room) toggled via `hide` classes, styled with the bundled `beercss` (Material Design) library. `index.js` (~3800 lines) holds essentially all client logic. `conf.js` and `version` are generated/overwritten by the server at boot and at compile time, not hand-edited. `localization.js` drives `data-i18n` attributes for `en`/`hu`.
- `src/client/electron/` — thin Electron shell. `main.js` registers a privileged `local://` custom protocol that serves the bundled web app from the app path (so the Electron client reuses `src/client/web/` verbatim), exposes a small IPC API (`path-exe`, `path-app`, `set-tray`, `set-lang`) to the renderer, and manages a system tray / single-instance lock.
- `src/client/native/<os>-<arch>/` — prebuilt native dependencies bundled per platform target: ffmpeg binaries/DLLs and a native input-control addon (`easy-control`, built on ViGEmClient on Windows). Only `win32-x64` exists today.
- `model/` — placeholder for a future AI video upscaling model; currently empty (just an unpopulated `pyproject.toml`).
- `dev/` — developer-only assets: a MySQL+phpMyAdmin Docker setup for local DB testing, the rollup vendoring helper, notes on producing the prebuilt Electron `bin/` distributions, and misc one-off scripts. Not part of the app runtime.

### Client compilation flow

`compileClients()` in `server.js` (triggered by `--compile` or an empty `./tmp`) takes prebuilt Electron distributions from `./bin/<os>-<arch>[.zip]`, strips the default Electron `default_app.asar`, and repackages each as a zip under `./tmp/` containing: the Electron shell (`src/client/electron`), the web client (`src/client/web`), the matching native libs for that OS/arch, and a generated `conf.js` describing the WS endpoint. These zips are what `npm run server` serves for the "Download client" screen in the web UI. `./bin` and `./tmp` are both gitignored — the source Electron distributions are not checked into the repo.

### Realtime protocol

`src/client/web/libs/communicator/communicator.js` is a browser-side copy of the `easy-communicator` protocol (the server depends on the published `easy-communicator` npm package for the same protocol). It implements a packetized, acknowledgment-based messaging layer over an abstract `sender` transport (send/invoke/receive, with time-sync and side-negotiation handshakes) that both the WebSocket signaling channel and, later, WebRTC data channels are expected to use.

### Config

The server config format (see `README.md` for the annotated example) is JSON with top-level `http` and `ws` sections; `processConf` in `server.js` is the authoritative source of truth for every accepted field, required vs. optional, and cross-field constraints (e.g. WS port can't collide with the HTTP redirect port, at least one of `http`/`ws` must be set). The default `conf/conf.json` certs/passwords in the README are for testing only and must be replaced for real deployments.

## AI-assisted development

This repo uses project-specific Claude Code skills/MCP servers referenced in `README.md`:
- https://github.com/mattpocock/skills
- https://github.com/DeusData/codebase-memory-mcp
- https://playwright.dev/docs/getting-started-mcp
