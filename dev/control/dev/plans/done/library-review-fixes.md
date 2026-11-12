# Plan: fixes and additions from the library review

Status: done, 2026-10-06. Covers the review of 2026-10-06, as the maintainer scoped it. What remains of the
release is done on GitHub: merging `ci-fix`, the `update-dist` pull request, and the `v0.10.0` tag.

## Progress

Verified:
- Windows x64 (dev machine): `npm test`, `test:types`, `test:native`, `test:e2e` (13/13, screens equal to
  Electron's to the pixel), `test:driver` (uninstall, install, service log, idle stop and restart).
- Linux x64 X11, in Docker under Xvfb: build, `npm ci`, `npm test` with `EASYCONTROL_TYPING_TEST=1` (the AltGr
  typing tests with a Hungarian layout), `test:types`, `test:native`.
- CI (`ci-fix` branch): every target built; tests green on Windows x64 and ARM64 (with the driver installed),
  macOS (ARM64 runner, x64 cross-built), Linux x64 on Node 22 and 24, Linux ARM64.

Not verified, as no CI runner or dev machine can:
- the Linux Wayland path of `type()` (AltGr, `unicodeFallback`) and Wayland output names: needs a compositor
  and uinput;
- the macOS virtual gamepad (macOS 26 and an entitled app) and the Accessibility prompt of
  `requestInputAccess()` (a person has to answer it).

Found on the way and fixed: Linux X11 reported no primary screen when none is set (Xvfb); the Linux keymap
lookup missed characters held as legacy keysyms (Hungarian `ő`); the loader failed on a build older than itself.
CI found: the Swift part used macOS 26 types outside availability checks once built for 10.15; macOS
`isKeySupported("KeyA")` was false (key code 0); macOS read the pointer before a posted move landed; Windows Server
has no `xinputhid.sys` (the XUSB device now goes without the filter there); uninstall left phantom HID devices.

Only Windows can be built and tested on the dev machine. macOS and Linux changes are checked through CI (phase 2),
so CI comes before the native work on those platforms.

## Scope

| # | Item | In this plan |
|---|---|---|
| 1 | Stale and missing prebuilt binaries, no CI | yes: CI builds and tests every target |
| 2 | macOS Accessibility permission is never checked | yes: `Platform.hasInputAccess()` / `requestInputAccess()` |
| 3 | Keys and buttons stay down when a session drops | yes: `releaseAll()` |
| 4 | `Gamepad.create()` blocks the event loop | yes |
| 5 | Version, changelog, Electron docs | yes |
| 6 | TLS private key in git (`dev/server.key`) | yes |
| 7 | Relative mouse movement | no: can be done in JS with `getX`/`setPosition`; its limit is documented (18) |
| 8 | Smooth (pixel) scrolling | no: can be done in JS by adding up deltas into notches |
| 9 | Screen `id` / `name` | yes |
| 10 | Gamepad `setState`, rumble to JS | no: the per-button and per-axis methods are enough |
| 11 | TypeScript definitions | yes |
| 12 | Easy check whether the platform is supported | yes: `Platform` |
| 13 | Scroll amount: negative on Linux, README defaults | yes: both arguments stay required |
| 14 | README wrong about `keyDown`/`SetLayout` | yes: docs only, the names stay |
| 15 | Linux `type()` cannot type AltGr characters | yes |
| 16 | `getIcon()` data differs per platform | yes |
| 17 | Screen size 1 px off Electron's | yes |
| 18 | Windows (and other) limits undocumented | yes |
| 19 | Old `dev/` leftovers | yes: removed |
| 20 | `npm run clean` deletes `.vscode/` and `package-lock.json` | yes: build output only |
| 21 | `index.js`: DEP0190 warning, dead code | yes |
| 22 | `package-lock.json` ignored | yes: committed |
| 23 | No `engines` field | yes |
| 24 | Gamepad service: debugger-only log, idle stop and ARM64 untested | yes |

---

## Phase 1: repository and documentation (any machine)

### 19 + 6. Remove the `dev/` leftovers, the TLS key with them

Nothing in the repository uses them; `test/` replaces the old test files.

- Removed: `dev/dev-server.js`, `dev/mime.js` (a 222 KB copy of mime-db), `dev/a.html`, `dev/a.png`,
  `dev/server.crt`, `dev/server.key` (6), `dev/test.js`, `dev/test/` (the old Electron test app, whose checks were
  switched off by an early `return`).
- `.gitignore`: drop `dev/test/*` and `!dev/test/resources/`; add `*.key` so a key is not committed again.
- `dev/` then holds only `plans/`.
- The key stays in the git history. If it was ever used for anything but a localhost dev server, rewriting the
  history (`git filter-repo`) is the maintainer's call; this plan does not do it.

### 20 + 21. `index.js`: clean only build output, no shell, no dead code

- `npm run clean` removes what the builds make and nothing else: `build/`, `build_swift/`, `tmp/`.
  `npm run clean -- --all` also removes `node_modules/` and `build_wdk/` (the WDK download cache). It never touches
  `.vscode/` or `package-lock.json`. The internal flag `--uninstall` becomes `--clean`, as it uninstalls nothing.
- node-gyp is run as `process.execPath` with `node_modules/node-gyp/bin/node-gyp.js` (found with
  `createRequire(...).resolve`), without a shell: no DEP0190 warning, and no dependence on `node-gyp` being on the
  PATH.
- The commented-out "test environment copy" blocks and the unused `path` import go.

### 22 + 23. Lockfile and `engines`

- `package-lock.json` is committed (removed from `.gitignore`), so node-gyp, Electron, esbuild and TypeScript are
  the same for everyone; CI installs with `npm ci`.
- `"engines": { "node": ">=22" }`: the oldest Node line still supported in October 2026. It concerns `node`
  only; Electron brings its own, and the addon uses Node-API, which every Electron version since 21 supports.
  CI runs the unit tests on Node 22 and 24.
- README, Building: building needs Node `^22.22.2`, `^24.15.0` or `>=26` (node-gyp 13), more than using does.

### 14. README: what keyDown and SetLayout really do

- `keyDown`/`keyUp` press a physical key by `KeyboardEvent.code` (a scan code); the layout decides which character
  that key makes, not which key is pressed. Say so, and that `type()` is the way to enter characters.
- `SetLayout` changes the layout of the window the input goes to (Windows), the input source (macOS), the XKB group
  (X11), and throws on Wayland. `GetLayout` returns: a KLID like `0000040E` (Windows), an input source ID like
  `com.apple.keylayout.US` (macOS), an XKB group name (Linux).
- `GetLayout`/`SetLayout` keep their names.

### 13 (docs). Scrolling

- README: `Mouse.scrollDown(amount, isHorizontal)`, both required; `amount` is whole notches (fractions are
  dropped), a negative amount scrolls the other way, 0 does nothing.

### 18. Document the limits

A "Limits" section in the README, per platform:

- **Windows**: input cannot reach windows of a process running as administrator unless the caller is too (UIPI);
  nothing reaches the secure desktop (UAC prompts, the lock screen, Ctrl+Alt+Del), so a remote user cannot approve
  a UAC prompt, `Gamepad.installDriver()`'s included; `Mouse.setPosition` moves the pointer with `SetCursorPos`,
  which applications reading Raw Input (many games, pointer-locked pages) do not see; `Keyboard.type` sends
  Unicode packets, which some games and remote-desktop clients ignore - `keyDown`/`keyUp` reach them; at most 4
  virtual gamepads (XInput); kernel anti-cheat may refuse virtual gamepads.
- **macOS**: input needs the Accessibility permission (see 2); the gamepad needs macOS 26 and an entitlement.
- **Linux**: what the Wayland section already says, linked from here; X11 coordinates are pixels.

### 5. Version, changelog, Electron

- Version 0.10.0: the Windows gamepad needs `Gamepad.installDriver()` once, and `Gamepad.create()` changes (4).
- `CHANGELOG.md`, starting with 0.10.0: the driver, the new APIs of this plan, the breaking changes.
- README, Electron: import from `"easy-control"` (not a path), and `asarUnpack` both `**/dist/*/*.node` and
  `**/dist/*/gamepad/**`, as the setup script and the driver files must be real files on disk.

---

## Phase 2: CI (item 1)

`.github/workflows/build.yml`, run on push and by hand:

| Job | Runner | Builds | Tests |
|---|---|---|---|
| windows | `windows-latest` | `win32-x64`, `win32-arm64` (cross), the gamepad driver for both | `npm test` (gamepad tests skip: no driver) |
| windows-arm | `windows-11-arm` | - | `npm test` against the arm64 build |
| macos | `macos-latest` (arm64) | `darwin-arm64`, `darwin-x64` (cross: `--arch x64`, and `swiftc -target x86_64-apple-macos10.15`) | `npm test` |
| linux | `ubuntu-latest` | `linux-x64` | `npm test` under `xvfb-run` (X11) |
| linux-arm | `ubuntu-24.04-arm` | `linux-arm64` | `npm test` under `xvfb-run` |

- GitHub's ARM64 runners (`windows-11-arm`, `ubuntu-24.04-arm`) are free for public repositories; for a private
  one, `linux-arm64` is cross-compiled on `ubuntu-latest` (`gcc-aarch64-linux-gnu` and arm64 X11 libraries) and
  the `windows-arm` test job is dropped.
- `index.js` takes `--arch` already; the macOS build needs the Swift step to follow it (binding.gyp action:
  `-target <arch>-apple-macos10.15`).
- Each job uploads its `dist/<target>/` as an artifact; a last job, run by hand, gathers them and opens a pull
  request that updates `dist/`. Binaries in git then always come from CI, never from someone's machine.
- Hosted Windows runners run as administrator without UAC prompts, so the `windows` and `windows-arm` jobs also
  run `npm run test:driver` and the gamepad unit tests with the driver installed: the ARM64 driver, service and
  setup script are then tested on ARM64 Windows (24).
- The loader's list of supported targets (12) is the list of these jobs' targets.
- Linux needs `libx11-dev libxtst-dev libxfixes-dev libxrandr-dev`; macOS tests that move the mouse may fail without
  the Accessibility permission on hosted runners - those tests skip when `Platform.hasInputAccess()` is false.

---

## Phase 3: JS layer

### 12 + 2. `Platform`

A fifth export, `Platform`, usable on every platform, also where no addon exists:

```js
import { Platform } from "easy-control";

Platform.target;               // "win32-x64"
Platform.supportedTargets;     // ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]
Platform.isSupported;          // the addon for this target is there and loaded
Platform.hasInputAccess();     // macOS: Accessibility permission; Linux Wayland: /dev/uinput writable; else true
await Platform.requestInputAccess();  // macOS: shows the system prompt, resolves with hasInputAccess();
                                      // elsewhere resolves with hasInputAccess() at once
```

- The loader (`src/easy-control.cjs`) no longer throws on import. When the target is not supported, or its `.node`
  is missing or fails to load, `Platform.isSupported` is false and every method of `Mouse`, `Keyboard`, `Gamepad`
  and `Screen` throws an Error with `code: "EASYCONTROL_UNSUPPORTED_PLATFORM"` and a message naming the target and
  the reason (missing file, or the load error). The stubs are made from one list of method names, the same the
  TypeScript definitions are checked against (11).
- macOS: `hasInputAccess` = `AXIsProcessTrusted()`, `requestInputAccess` = `AXIsProcessTrustedWithOptions` with
  `kAXTrustedCheckOptionPrompt`; README tells that Electron apps get the permission per app, `node` per terminal.
- Mouse and keyboard calls on macOS without the permission keep doing nothing (macOS gives no error), so the README
  says to check `Platform.hasInputAccess()` first.

### 11. TypeScript definitions

- `src/easy-control.d.ts`, written by hand, copied by `src/build.js` to `dist/easy-control.d.ts`, `.d.cts` and
  `.d.mts`; `package.json` gets `"types"` and a `types` condition in both `exports` branches.
- Covers every export, the error codes (as a string union), the gamepad button and axis indices (documented in
  JSDoc with the W3C names), `Screen.list()`'s objects with `id` and `name` (9).
- `npm run test:types`: `tsc --noEmit` over `test/types/usage.ts`, which uses every function (TypeScript as a dev
  dependency). A unit test checks that the runtime exports and the method list match the definitions.

---

## Phase 4: native, testable on Windows

### 3. `releaseAll()`

- `Keyboard.releaseAll()` and `Mouse.releaseAll()` release every key and button pressed through easy-control and
  not released yet. Each platform keeps the set of pressed keys and buttons (macOS already keeps the modifiers).
- The loader calls both on `process` `exit`, `SIGINT` and `SIGTERM`, so a closing app leaves nothing down (a crash
  still can).
- Tests: unit (the set empties; calling it with nothing down is harmless), e2e (a key held, `releaseAll`, a keyup
  arrives).

### 4. `Gamepad.create()` returns a Promise

- On every platform, so the API stays the same everywhere; the work runs in an `AsyncWorker` (Windows: starting the
  service, waiting for the devices; Linux: the uinput setup; macOS: the CoreHID device). The rejection carries the
  same `code`s as today's throw.
- Breaking change (CHANGELOG, 0.10.0); tests and the README move to `await Gamepad.create()`.
- `Gamepad.list()`, `destroy()` and the button and axis methods stay synchronous.

### 9. Screen `id` and `name`

`Screen.list()` objects get:

- `id`: a string, stable while the screen stays connected - Windows: the GDI device name (`\\.\DISPLAY1`, from
  `MONITORINFOEX`); macOS: the `CGDirectDisplayID` (the same number as Electron's `display.id` on macOS); Linux:
  the XRandR output name (`HDMI-1`) or the Wayland output's `name` (`xdg_output` / `wl_output` v4).
- `name`: the monitor's name for people - Windows: `DISPLAYCONFIG_TARGET_DEVICE_NAME.monitorFriendlyDeviceName`
  via `QueryDisplayConfig`; macOS: `NSScreen.localizedName`; Linux: the EDID name when XRandR or the compositor
  gives one, else the output name. Empty string when there is none.
- README: Electron's `display.id` equals `id` on macOS only; elsewhere match a capture source to a screen by bounds.
- Tests: unit (both are non-empty strings, ids are unique); e2e (macOS: `id` equals Electron's `display.id`).

### 17. Screen sizes as Electron rounds them

- Electron (Chromium, `ui/display/win/screen_win.cc`) scales a monitor's physical rectangle to DIPs as an enclosing
  rectangle: left and top rounded down, right and bottom rounded up. `LayoutMonitors()` in `screen.cpp` does
  `std::lround` of the size instead (1024 / 1.25 = 819.2 gives 819, Electron 820). Change it to Chromium's rules,
  read from its source for each step of the neighbour placement, not only the size.
- `LogicalToPhysical` already keeps a point on its monitor, so a coordinate in the extra fraction of a pixel lands
  on the last physical pixel.
- Tests: the layout math becomes a pure function (monitors in, logical rectangles out) in a header, with a small
  native test (`test/native/screen_layout.cpp`, built and run by `npm run test:native` on Windows) over fixed cases:
  one monitor at 100/125/150/175/200 %, two side by side and stacked at mixed scales, a monitor touching none -
  expected values taken from Electron on those set-ups. The e2e test drops its 1 px tolerance.

### 16 (Windows part). `getIcon()` data

The contract, the same on every platform, in the README and the TypeScript definitions:

- RGBA, 8 bits per channel, rows from the top, **straight (not premultiplied) alpha**.
- Size and `xOffset`/`yOffset` in physical pixels (the cursor as the screen shows it).
- While the pointer is hidden: `width` and `height` 0 and empty `data`, as `getIconId()` returns 0.

Windows: return the empty picture when `CURSOR_SHOWING` is not set; keep straight alpha (it is already); the
inverting pixels of monochrome cursors (the text I-beam) stay mid-grey, documented.

### 24. Gamepad service: a log, and the idle stop tested

- The service writes what it now sends only to the debugger also to `%ProgramData%\easy-control\gamepad-service.log`
  (pads plugged in and out, failures with their HRESULT, idle stop), at most 256 KB: when bigger, it is renamed to
  `.old` and a new one started. The setup script creates the folder with write access for the service only, and
  `uninstallDriver()` removes the logs with the rest.
- `npm run test:driver` gets a test for the idle stop: after the last pad is destroyed the service stops within
  its 60 s plus a margin, and the next `Gamepad.create()` starts it again.
- README, Windows gamepad driver: both log files and what they hold.

---

## Phase 5: native, macOS and Linux (checked in CI)

### 13. Negative scroll amounts on Linux

- X11: `amount < 0` presses the opposite button (`4`↔`5`, `6`↔`7`) `|amount|` times; Wayland: pass the signed
  amount to `REL_WHEEL`/`REL_HWHEEL` instead of returning when it is not positive.
- All platforms: a non-finite amount throws a `TypeError` (today `NaN` becomes 0 silently).
- Tests: unit (argument checks); e2e on Linux in CI (a negative `scrollDown` makes a wheel event the other way).

### 15. AltGr characters on Linux

- Look the character up on XKB levels 0-3 of the current group, not only 0-1: level 2 is AltGr, level 3 AltGr+Shift.
  Press `ISO_Level3_Shift` (found with `XKeysymToKeycode`, usually Right Alt) for levels 2 and 3, and Shift for 1
  and 3. Both on X11 and on Wayland (on Wayland the key goes through the virtual keyboard, as Shift does now).
- X11 keeps the spare-keycode fallback for characters on no level of the layout.
- Wayland fallback for those: Unicode entry (Ctrl+Shift+U, the hex code point, space), which GTK applications and
  IBus understand, as an opt-in, since in other applications it types or triggers shortcuts:
  `Keyboard.type(text, { "unicodeFallback": true })`. Without it, those characters are skipped and the call throws
  naming them, as today.
- Tests: unit on Linux in CI with a Hungarian layout (`setxkbmap hu` under Xvfb): `type("@[]{}")` into a test
  window reads back the same text.

### 16 (macOS and Linux parts). `getIcon()` data

- Linux: XFixes gives premultiplied ARGB; divide the colour channels by alpha (`c * 255 / a`, rounded) for
  `0 < a < 255`.
- macOS: draw the cursor image at the display's backing scale (the screen under the pointer), so Retina cursors
  come back at 2x with the hotspot scaled the same; `NSImage` sizes are points.
- Tests: unit on every platform: no pixel has a colour channel above its alpha when alpha is 0 (straight alpha
  with transparent pixels zeroed), and the picture is not empty while the pointer is shown.

### 9 (macOS and Linux parts)

As in phase 4; checked by the unit tests in CI.

### 2 (native part)

As in phase 3; `requestInputAccess` cannot be tested unattended - CI checks that `hasInputAccess()` returns a
boolean and that `requestInputAccess()` resolves.

---

## Phase 6: release

- CI builds every target; the gathering job's pull request updates `dist/`.
- README and CHANGELOG checked against the final API; `npm test`, `npm run test:types`, the e2e and driver tests
  on Windows; version 0.10.0 tagged.
- Move this plan to `dev/plans/done/`.

## Decisions taken in this plan (change before starting if wrong)

1. `Gamepad.create()` becomes async on every platform, rather than a second `createAsync()` beside it.
2. The Wayland Unicode-entry fallback is opt-in (`unicodeFallback`), not automatic.
3. The platform check is a new `Platform` export, which also carries the input-permission check.
4. The TLS key is removed from the current tree only; rewriting git history is left to the maintainer.
5. The old dev server goes with the key, rather than being kept and made to create its own certificate.
6. `engines` is `>=22`, the oldest supported Node line, not an older one the addon might still load in.
