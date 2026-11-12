# Plan: updates from the second library review

Status: done, 2026-10-06 - released as v0.12.0 (merged as #2, `dist/` from CI run 37511178212). Phase 6
(desktop-streamer) is the maintainer's, as a separate project, later - it pins easy-control v0.9.0, so it starts
from this release. Covers the review of 2026-10-06 (the second one
that day, after `library-review-fixes.md`), aimed at what a remote desktop (`desktop-streamer`) needs from the
library. Target release: 0.12.0.

## Progress

Verified:
- Windows x64 (dev machine, with the installed driver 2): build, `npm test` (60 pass), `test:types`, `test:native`,
  `test:e2e` (18/18: double click, `moveBy` under pointer lock, fractional `scroll`, Enter/Tab/Backspace from
  `type()`, `getLockState` following Caps Lock, `setState`, and rumble played by Chromium reaching `onRumble`
  through the driver-2 polling path).
- Linux x64 X11, in Docker (node:24-bookworm, privileged, uinput) under Xvfb: build without warnings in our
  sources, `npm test` (61 pass, the gamepad tests included), `test:types`, `test:native`.
- Wayland output listing against a headless Weston: right result, about 3 µs a call after the first (no round trips).
- Driver 3 on the dev machine: `npm run test:driver` run elevated, 7/7 (uninstall, install, service log, idle
  stop, and the three registry version cases: at `MIN_VERSION`, below it, and newer than the package - no setup
  started, the script refusing with exit code 2, `EASYCONTROL_DRIVER_RESTART_NEEDED`); then `npm test` and
  `test:e2e` (18/18) again on it, and five on-then-off rumble pulses made in microseconds all reported - the
  `WAIT_OUTPUT` path, which polling would miss.

- CI (run 37475796741, `898ae7c`): every target built and tested - Windows x64 and ARM64 (driver tests, the
  registry version cases included), macOS (arm64 built and tested, x64 cross-built: the Swift and Objective-C++
  changes compile), Linux x64 on Node 22 and 24 and ARM64 with uinput set up, so the gamepad tests and the
  rumble test from a force feedback client ran there. CI found two things: the rumble test picked another test
  file's pad by name (it moved into `gamepad.test.js`), and windows-arm tested with the loaders last committed
  to `dist/` (it now rebuilds them).

Not verified on a real desktop (what CI cannot do):
- macOS input reaching applications (the hosted runner has no Accessibility permission, so those tests skip):
  double click by click count, `moveBy` under pointer lock, pixel `scroll` (40 points a notch is Chromium's
  figure, not measured), `"secure-input"`, `getLockState`; and the gamepad's one-report `setState` (macOS 26
  and an entitled app).
- Wayland input (relative mouse, hi-res wheel): needs a real compositor.

Phase 7: `update-dist` run 37511178212 built and tested every target; GitHub does not let Actions open pull
requests in this repository, so its branch (`ci/update-dist`, on top of the merge) went into `main` by
fast-forward. Its win32-x64 build passed `npm test` on the dev machine - while it was locked, which showed the
pointer tests failing on the secure desktop now that `getX` throws there: they skip on it now, and a test checks
the `EASYCONTROL_INPUT_BLOCKED` error itself. The README got the error codes of `installDriver()`.

Departures from the plan:
- 12: `create.Gamepad` stays in the types - the type tests use it for `instanceof`, so removing it would break
  TypeScript users who do too.
- Phase 6: not done here - the maintainer takes desktop-streamer on as a separate project. It has no pointer lock
  and no gamepad passthrough yet, so `moveBy`, `setState` and `onRumble` need those features built there first.

Only Windows can be built and tested on the dev machine; macOS and Linux changes are checked through CI, as before.
What no CI runner can check (Wayland, macOS 26 gamepad, macOS prompts) is listed under "Not verifiable" per item.

## Scope

| # | Item | Kind | Phase |
|---|---|---|---|
| 1 | The streamer loads the `.node` directly, bypassing the loader | problem (streamer) | 6 |
| 2 | macOS double click arrives as two single clicks | bug | 2 |
| 3 | No relative mouse movement: pointer lock and games cannot be driven | feature | 3 |
| 4 | `type()` sends `\n`, `\t`, `\b` as characters, not as Enter, Tab, Backspace | bug | 1 |
| 5 | Blocked input is dropped silently; `getX`/`getY` return 0 on failure | problem | 4 |
| 6 | Scroll amounts are not bounded (X11 hangs on a huge amount, Windows overflows) | bug | 1 |
| 7 | A worker's exit releases the main thread's keys and buttons | bug | 1 |
| 8 | The Linux gamepad loses the input sent right after `create()` | bug | 1 |
| 9 | Wayland `setPosition` makes two compositor round trips per move | performance | 2 |
| 10 | Windows gamepad: two IOCTLs per button or axis change | performance | 5 |
| 11 | `type("")` throws | bug | 1 |
| 12 | `GetLayout`/`SetLayout` naming, `create.Gamepad` in the types | API | 1 |
| 13 | Driver install plants a local root certificate, UAC shows "Windows PowerShell" | trust | 7 (decision) |
| 14 | Smooth (fractional) scrolling | feature | 3 |
| 15 | Gamepad `setState` (whole state in one call) | feature | 5 |
| 16 | Gamepad rumble back to JS | feature | 5 |
| 17 | Lock key state (CapsLock, NumLock, ScrollLock) | feature | 4 |
| 18 | Why input is not landing (`Platform.getInputBlock()`) | feature | 4 |
| 19 | Touch and pen input | feature | not in this plan |
| 20 | Windows driver versions: required vs. available updates, checked against what runs | feature | 5 |

19 is left out: it is large (Windows `InjectSyntheticPointerInput`, a multitouch uinput device, nothing on macOS)
and only matters once tablets or phones are clients. It gets its own plan when they are.

---

## Phase 1: small fixes (Windows-testable, the rest in CI)

### 4. Control characters in `type()`

- Windows and macOS: `\n`, `\r` and `\r\n` (as one) press Enter, `\t` Tab, `\b` Backspace, `\x1b` Escape, as key
  presses by scan code (Windows, through `ScanCodeInput`) or key code (macOS: `kVK_Return`, `kVK_Tab`,
  `kVK_Delete`, `kVK_Escape`) - not as Unicode packets / key code 0, which apps reading `KeyboardEvent.code` see as
  `KeyA` on macOS.
- Linux already maps these (`CodepointToKeysym`); `\r\n` becomes one Enter there too (today two).
- Other C0 control characters stay as they are.
- Held modifiers: Enter goes without them, like the rest of `type()` (macOS sets flags 0 already; Windows sends no
  modifier events of its own, document that a held Ctrl applies).
- Tests: e2e types `"a\nb\tc"` into a `<textarea>` and checks the value and that `keydown` reported `Enter` and
  `Tab` codes.

### 6. Bounded scroll amounts

- `scrollDown`/`scrollUp` throw a `RangeError` for `|amount| > 10000` notches (more than any real wheel sends in one
  event). This removes the X11 loop hang (`mouse.cpp`, the per-notch loop) and the `amount * WHEEL_DELTA` overflow
  on Windows.
- Tests: unit (`1e9` and `-1e9` throw a `RangeError`; the unit tests never scroll, so the accepted side is left to
  e2e, which scrolls 20 notches and checks one or more wheel events in that direction).

### 7. Exit hook only on the main thread

- `src/easy-control.cjs`: `process.on("exit", releaseAll)` moves inside `if (isMainThread)`, like the signal hooks.
  The held-key and held-button sets are process-wide, so a worker ending must not empty them; the main thread's
  exit releases everything, the workers' presses included.
- Tests: unit - load the module in a worker and let it exit; the main thread's `process.listenerCount("exit")`
  is unchanged and a worker's `process.listenerCount("exit")` after loading is 0. (A behavioural test would need a
  key held across the worker's exit; the e2e window could watch for a stray `keyup`, if the listener check proves
  too indirect.)

### 8. Linux gamepad waits for the device

- `OpenPad` sleeps 200 ms after `UI_DEV_CREATE`, as the virtual mouse and keyboard do: it runs in the
  `AsyncWorker`, so the JS thread does not wait.
- Tests: the e2e gamepad test drops any wait it has before the first button.

### 11. `type("")` does nothing

- `type()` accepts the empty string and returns. `keyDown("")` and `keyUp("")` keep throwing.
- Tests: unit.

### 12. Names

- `Keyboard.getLayout()` and `Keyboard.setLayout()` are added; `GetLayout`/`SetLayout` stay as aliases of them,
  documented as the old names (no removal planned).
- `easy-control.d.ts`: `Gamepad.create` is typed as a plain `() => Promise<VirtualGamepad>`. The runtime keeps
  `create.Gamepad` (removing it is not worth a breaking change) but the types do not advertise it.
- The loader's `API` list, the stubs, the `.d.ts`, `test/types/` and the README follow.

---

## Phase 2: macOS and Wayland mouse (CI)

### 2. macOS click count

- `SendButton` keeps the last press: button, time, position. A press of the same button within
  `[NSEvent doubleClickInterval]` and within 4 points of the last one counts up (2, 3, ...); otherwise 1. The count
  is set with `kCGMouseEventClickState` on the down event and on its matching up event. A move further than 4 points
  or a different button resets it.
- `MoveTo`'s drag events carry the count of the press that started the drag.
- Tests: e2e on every platform - two clicks 50 ms apart give a `dblclick` and `mousedown.detail === 2`; two clicks
  600 ms apart do not. (Windows and X11 should pass already; the test guards them.)
- Not verifiable in CI if the runner lacks Accessibility: the e2e test skips there like the other input tests.

### 9. Wayland screen layout without round trips

- `ListWaylandOutputs` keeps its connection's output list current without a round trip per call: on each call it
  flushes, reads what the compositor has sent without blocking (`wl_display_prepare_read`, `poll` with timeout 0,
  `wl_display_read_events`, `wl_display_dispatch_pending`), and only makes the two round trips on the first call or
  after a reconnect. Output add, remove, mode and xdg-output changes are events, so the list stays right.
- `MoveTo` (absolute pointer) and `Screen.list()` both use it.
- Not verifiable: no Wayland runner. Check by hand on a GNOME and a sway session before release, or say in the
  CHANGELOG it is untested there.

---

## Phase 3: new mouse functions

### 3. `Mouse.moveBy(dx, dy)`

Relative movement, what pointer-locked pages (`movementX`/`movementY`) and games read:

```js
Mouse.moveBy(dx, dy);   // integers, mouse counts; fractions are kept and added to the next call
```

- Windows: `SendInput` with `MOUSEEVENTF_MOVE` (no `ABSOLUTE`). Raw Input readers get the counts as they are; the
  visible pointer moves by them after the system's pointer speed and "Enhance pointer precision".
- macOS: a `kCGEventMouseMoved` (or the drag event while a button is held) at the current position plus the delta,
  clamped to the displays, with `kCGMouseEventDeltaX`/`DeltaY` set to the delta, so apps that have detached the
  cursor (`CGAssociateMouseAndMouseCursorPosition(false)`, which pointer lock does) still read the movement.
  `MoveTo` gets the delta fields set too (new position minus the last), so absolute moves also report movement.
- X11: `XTestFakeRelativeMotionEvent`.
- Wayland: a third uinput device, "easy-control virtual mouse", with `REL_X`/`REL_Y` and `BTN_LEFT` (so udev counts it
  as a mouse; buttons still go through the absolute pointer). A compositor gives a locked pointer only relative
  motion, which an absolute device never makes. After `moveBy`, `getX`/`getY` fall back to XWayland's idea of the
  position (the compositor applies acceleration, so the position is not known); documented.
- A value outside ±100000 throws a `RangeError`; non-finite throws a `TypeError`.
- Tests: unit (argument checks); e2e - a pointer-locked element (`requestPointerLock` from a click the test makes)
  receives `mousemove` with `movementX`/`movementY` of the right sign and roughly the right size (acceleration makes
  it inexact on Windows and macOS; the test checks sign and non-zero, and equality on X11).
- Not verifiable: Wayland (no runner).

### 14. Smooth scrolling: `Mouse.scroll(x, y)`

```js
Mouse.scroll(x, y);     // in wheel notches, fractions included; positive x right, positive y down
                        // (the signs of WheelEvent.deltaX/deltaY). 0 on an axis does nothing.
```

- `scrollDown`/`scrollUp` stay as they are (whole notches); `scroll` is the one for pixel-based sources. README:
  a browser's `deltaMode` 0 (pixels) is about 100 px a notch in Chromium on Windows, so `deltaY / 100`.
- Windows: `mouseData = round(y * 120)` (`WHEEL_DELTA` is 120, and smaller values are allowed and used by precise
  touchpads); the remainder below one unit is kept per axis for the next call.
- macOS: `kCGScrollEventUnitPixel` with `kCGScrollWheelEventIsContinuous` set; pixels per notch measured in the e2e
  test so that `scroll(0, 1)` scrolls as far as `scrollDown(1, false)` in Chromium.
- Wayland: `REL_WHEEL_HI_RES`/`REL_HWHEEL_HI_RES` (120 per notch, kernel 5.0+) plus `REL_WHEEL`/`REL_HWHEEL` each
  time the hi-res total crosses a whole notch, as real hi-res mice send both.
- X11: XTest has buttons only: the fractions add up per axis and a button 4-7 press goes when a whole notch is
  reached.
- Same bounds as 6 (±10000 notches).
- Tests: unit (arguments); e2e - `scroll(0, 0.5)` twice gives wheel events that add up to about one notch's
  `deltaY`, `scroll(0.5, 0)` horizontal likewise; on X11 the first half gives nothing and the second one notch.

---

## Phase 4: knowing what reaches the system

### 18. `Platform.getInputBlock()`

```js
Platform.getInputBlock();
// null when input sent now should arrive, else why not:
//   "secure-desktop"   Windows: UAC prompt, lock or sign-in screen, Ctrl+Alt+Del
//   "elevated-window"  Windows: the foreground window belongs to a process of higher integrity (UIPI)
//   "secure-input"     macOS: a password field or app has turned on secure keyboard entry (keys are dropped,
//                      the mouse still works)
//   "no-permission"    macOS: no Accessibility permission; Wayland: /dev/uinput not writable
```

- Windows: `OpenInputDesktop` - failing with access denied, or a desktop whose name is not `Default`, is
  `secure-desktop`. Else `GetForegroundWindow` -> its process -> `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` ->
  token integrity level, compared with this process's: higher is `elevated-window`.
- macOS: `!AXIsProcessTrusted()` is `no-permission`; `IsSecureEventInputEnabled()` is `secure-input`.
- Linux: `no-permission` as `hasInputAccess()` says; otherwise null (X11 and Wayland have no equivalents).
- Cheap enough to poll about once a second; the streamer shows the reason to the peer.
- Tests: unit (returns null or one of the strings; null on CI runners with access). The elevated case is checked
  by hand: an elevated Notepad in front, then the call.

### 5. No silent failures

- Windows: when `SendInput` returns 0 (it does for the secure desktop; UIPI drops are not reported by it, hence 18),
  the call throws an Error with `code: "EASYCONTROL_INPUT_BLOCKED"`. Likewise `SetCursorPos` failing in `MoveTo`.
- `getX`/`getY` throw the same error when the position cannot be read (Windows `GetCursorPos` fails on the secure
  desktop), instead of returning 0.
- macOS and Linux: the failures they can see (event creation, uinput write) already throw; no change.
- `ErrorCode` in the `.d.ts` gets `EASYCONTROL_INPUT_BLOCKED`; the README says to poll `getInputBlock()` rather
  than rely on catching each call.
- This can throw where calls used to pass: noted in the CHANGELOG as a behaviour change.
- Tests: hard to provoke unattended; the unit test checks the error code is in the types, the secure-desktop case
  is checked by hand (lock screen with a timer-driven call from a scheduled task, or UAC prompt open).

### 17. `Keyboard.getLockState()`

```js
Keyboard.getLockState();   // { capsLock: boolean, numLock: boolean, scrollLock: boolean }
```

So the streamer can bring the host's lock keys in line with the peer's (press CapsLock once when they differ).

- Windows: `GetKeyState(VK_CAPITAL/VK_NUMLOCK/VK_SCROLL) & 1`. `GetKeyState` follows the calling thread's input
  queue, and Node's thread has no message loop: verify first that it sees changes made in other applications. If
  it does not, read the foreground window's thread state with `AttachThreadInput` + `GetKeyboardState`.
- macOS: `CGEventSourceFlagsState(kCGEventSourceStateHIDSystemState) & kCGEventFlagMaskAlphaShift` for CapsLock;
  NumLock and ScrollLock are always false (Mac keyboards have none).
- Linux: `XkbGetIndicatorState` (X11, and XWayland on Wayland), indicator names `Caps Lock`, `Num Lock`,
  `Scroll Lock` looked up with `XkbGetNamedIndicator`.
- Tests: unit (shape and types); e2e - CapsLock pressed through `keyDown`/`keyUp` flips `capsLock`, pressed again
  flips it back (leaves the machine as it was).

---

## Phase 5: gamepad

### 20. Driver version control (first: rumble builds on it)

Today one number, `EASYCONTROL_PAD_VERSION` (2) in `common/easycontrol_pad.h`, is compiled into the addon, the
service and the setup script; the setup writes it to `HKLM\SOFTWARE\easy-control\Gamepad` `Version`, and the addon
refuses an installed version below its own. That has four gaps:

- **Every change forces a reinstall.** Bumping the number for anything (a new optional feature, a service fix) makes
  every machine report `EASYCONTROL_DRIVER_OUTDATED` - a UAC prompt for every user, even where the old driver would
  do.
- **No "an update is available".** An app cannot tell "works, but a newer driver is in this package" from "up to
  date", so it cannot offer an optional update.
- **The registry is the only source.** It says what the setup wrote, not what runs: a driver still loaded from
  before an update (its devices not restarted), or a service binary of another version, go unnoticed. The service
  already answers its version on the pipe (`response.Version`), but the addon never looks at it; the driver has
  no way to say its version at all.
- **Several apps share one driver.** The driver is per machine, and apps embedding different easy-control versions
  use it together. Nothing stops an older app's `installDriver()` replacing a newer driver (a downgrade), which can
  break the newer app.

#### The numbers

`common/easycontrol_pad.h`:

```c
// the version of this driver, service and setup: bumped for any change to them
#define EASYCONTROL_PAD_VERSION 3
// the oldest installed version the addon of this build works with; raised only
// when the addon needs something older drivers do not have
#define EASYCONTROL_PAD_MIN_VERSION 2
```

The rule that makes this work, written into the header: **a newer driver and service serve every older addon.**
Existing IOCTL codes, pipe commands, struct layouts and their meanings never change; new ones are added. Then any
installed version from `MIN_VERSION` up works, and only `MIN_VERSION` decides "must update".

- The pipe already carries the client's version (`request.Version`, ignored today). The service answers with the
  response layout that version knows, so a response can grow fields later without breaking old addons, which check
  `read == sizeof(response)`.
- What a driver can do is told by its version, not by trying: the addon keeps a table of "from version N: feature
  X" (3: the rumble wait IOCTL, see 16).

#### What runs reports its version

- **Driver**: a new `EASYCONTROL_IOCTL_GET_VERSION` on the XUSB device returns `{ Version, Features }`. A v2 driver
  answers it with `STATUS_INVALID_DEVICE_REQUEST`, which the addon reads as version 2.
- **Service**: as now, `response.Version` on every answer; the addon now checks it.
- **Setup**: as now, the registry `Version`, written last, so a half-done install has none. It stays the source for
  `getDriverStatus()`, which must stay cheap and synchronous (it must not start the service).

`Gamepad.create()` compares all three. Service or driver older than the registry says means the update has not
taken effect (old devices or a running old service). Then it rejects with a new code,
`EASYCONTROL_DRIVER_RESTART_NEEDED`: the message says to destroy every pad and try again (the service stops after a
minute idle and the devices are made again). `installDriver()` fixes it too.

#### The bundled version

The addon and the `gamepad/` folder are built separately (`npm run build` and `npm run build:gamepad`), so the
addon's compiled number is not proof of what lies beside it. `build-gamepad-win.js` writes
`dist/<target>/gamepad/version.json` (`{ "version": 3 }`); the addon reads it to learn what `installDriver()` would
install. A unit test (and CI) checks that it equals the addon's compiled `EASYCONTROL_PAD_VERSION`.

#### The API

```js
Gamepad.getDriverStatus();
// {
//     isInstalled: true,
//     version: 2,                 // installed (registry); null when none
//     required: 2,                // EASYCONTROL_PAD_MIN_VERSION: below it, create() rejects (OUTDATED)
//     available: 3,               // in this package's gamepad/ folder; null when the folder is missing
//     isOutdated: false,          // version < required: installDriver() is needed
//     isUpdateAvailable: true     // version < available: installDriver() would bring new features or fixes
// }
// macOS and Linux: { isInstalled: true, version: null, required: null, available: null,
//                    isOutdated: false, isUpdateAvailable: false }
```

- `required` changes meaning from "this build's version" to "the oldest that works". It was always the version
  `isOutdated` compared against; the CHANGELOG says so.
- `installDriver()` refuses to downgrade. When the installed version is newer than the bundled one, it resolves at
  once without a UAC prompt: the installed one serves this addon by the rule above. `installDriver({ force: true })`
  installs the bundled one anyway (repair, or testing). Equal versions reinstall, as today (a repair).
- The setup script checks too, as it can be run by hand: `install` with an older package than the installed one
  exits with a distinct code (and logs why) unless given `-Force`. `status` also reports the bound driver
  package's `DriverVer` (`pnputil /enum-drivers`, matched by our INF names) next to the registry value.
- README, Windows gamepad driver: the three numbers; that the driver is shared by every app on the machine, newer
  serving older; that an install unplugs every app's pads (the setup stops the service). The sample code offers the
  optional update when `isUpdateAvailable` is true, not only on `EASYCONTROL_DRIVER_MISSING`/`OUTDATED`.

#### Tests

- Unit: the new fields' types; `isOutdated === version < required`, `isUpdateAvailable === version < available`;
  `available` equals `version.json`, which equals the compiled version.
- `npm run test:driver` (administrator; CI runs as one, locally it asks):
  - after the install: `version === available`, `isUpdateAvailable` false, and `create()` succeeds. The service's
    and the driver's reported versions (through a small test-only export, or the service log line
    `started, version N` and a new driver trace) equal the registry's.
  - registry `Version` set to `MIN_VERSION`: `isOutdated` false, `isUpdateAvailable` true, `create()` works.
  - set below `MIN_VERSION`: `isOutdated` true, `create()` rejects with `EASYCONTROL_DRIVER_OUTDATED`.
  - set above `available`: `installDriver()` resolves without starting the setup (checked by the setup log getting
    no new line), and `create()` rejects with `EASYCONTROL_DRIVER_RESTART_NEEDED`, since the running parts report
    the real, lower version.
  - the registry value is put back after each case.
- Upgrade path, by hand before release: install the 0.11.0 driver (v2), use a pad from a 0.12.0 app (works:
  `MIN_VERSION` 2), see `isUpdateAvailable`, run `installDriver()`, use the pad again.

### 15. `gamepad.setState(state)`

```js
gamepad.setState({
    buttons: [...],   // up to 17: booleans, numbers 0..1, or GamepadButton-like { pressed, value }
    axes: [...]       // up to 6: numbers -1..1
});
// missing entries keep their value; a browser Gamepad from navigator.getGamepads() can be passed as it is
```

- Buttons 6 and 7 (the triggers) take the analog `value` when given an object or a number, so a browser gamepad's
  triggers pass through as analog; they and axes 4/5 drive the same trigger, the last one written wins.
- Windows: one `DeviceIoControl` and one `HidD_SetFeature` per call instead of per change (10).
- Linux: all changed events, then one `SYN_REPORT`, in one `write`.
- macOS: one report.
- The per-button and per-axis methods stay.
- Tests: unit (argument checks: lengths, ranges, types); e2e gamepad test - one `setState` call shows every button
  and axis in `navigator.getGamepads()`.

### 16. Rumble to JS

```js
gamepad.onRumble = function({ strong, weak }) { ... };   // 0..1 each; 0, 0 when it stops. null to stop listening.
```

The streamer forwards it to the peer, whose browser plays it with `vibrationActuator.playEffect("dual-rumble")`.

- Windows: games set rumble with `XInputSetState`, which reaches the driver's XUSB device as `XUSB_IOCTL_SET_STATE`.
  The installed v2 driver already keeps the motor values (`context->Output`) and hands them out through
  `EASYCONTROL_IOCTL_GET_OUTPUT`, which nothing calls yet. So rumble works on every installed driver, picked by
  version (20):
  - v2: a thread per pad polls `GET_OUTPUT` every 16 ms and reports changes. Cheap (one IOCTL), but up to 16 ms
    late and a short pulse between two polls can be missed.
  - v3: a new `EASYCONTROL_IOCTL_WAIT_OUTPUT` the driver holds until the output changes (an inverted call: the addon
    keeps one outstanding, on its pad's thread, cancelled on `destroy()`). No delay, nothing missed.
  - `MIN_VERSION` stays 2, so no machine is forced to reinstall; v3 shows as `isUpdateAvailable`.
  DirectInput force feedback on the HID device (the PID usage page) is left out: XInput is what games use for
  rumble.
- Linux: the uinput device declares `EV_FF` with `FF_RUMBLE` and `ff_effects_max`; the fd is opened `O_RDWR`, and a
  thread per pad reads `EV_UINPUT` upload/erase requests (`UI_BEGIN_FF_UPLOAD`/`UI_END_FF_UPLOAD`, ...) and
  `EV_FF` play/stop events, turning them into strong/weak values.
- macOS: the CoreHID device is a generic HID gamepad with no rumble report games use; `onRumble` is accepted and
  never called. Documented.
- Delivery: a `Napi::ThreadSafeFunction` per pad, released on `destroy()`; it must not keep the process alive
  (`Unref`).
- Tests: Windows - `XInputSetState` from the test (through a tiny native helper, or `test:driver`'s PowerShell with
  a P/Invoke) makes `onRumble` fire with the values set. Linux - an `EVIOCSFF` + play on the event device from the
  test (needs read access to `/dev/input/event*`; CI under sudo). The v2 polling path is checked by hand with the
  0.11.0 driver installed (the upgrade-path check of 20).

---

## Phase 6: desktop-streamer (in `../desktop-streamer`, after 0.12.0 is in `dist/`)

### 1. Load through the loader

- `src/server/building.js` (`nativeFolders`): copy `dist/easy-control.cjs` and `dist/<target>/` keeping the layout
  the loader expects (`libs/easy-control/easy-control.cjs`, `libs/easy-control/<target>/easy-control.node`, and the
  `gamepad/` folder on Windows) instead of flattening the target folder.
- `src/client/web/src/desktop.js`: `require(".../libs/easy-control/easy-control.cjs")`; use `Platform.isSupported`
  / `loadError` to say why control is not available.
- Release held input itself: the module runs in a renderer, where `process.on("exit")` is unreliable. Call
  `Mouse.releaseAll()` and `Keyboard.releaseAll()` when the peer leaves or the room closes, and on `beforeunload`.
- `src/client/web/src/room/cursor.js`: drop the "one of two pictures, depending on the build" handling; the format
  is the same everywhere since 0.10.0.
- Use the new functions: `moveBy` while the peer has pointer lock, `scroll(x, y)` for wheel events,
  `getInputBlock()` polled about once a second and shown to the peer, `getLockState()` to sync CapsLock and NumLock
  when control starts, `setState` and `onRumble` for gamepads.

---

## Phase 7: release

- CI builds every target; the gathering job's pull request updates `dist/`.
- README (every new function, the Limits section with `getInputBlock()`), `.d.ts`, CHANGELOG (0.12.0: Added, Fixed,
  Behaviour changes - `EASYCONTROL_INPUT_BLOCKED` throws, `getDriverStatus().required` now means the oldest
  working version, `installDriver()` no longer downgrades). The driver goes to v3 but no reinstall is required.
- On Windows: `npm test`, `test:types`, `test:native`, `test:e2e`, `test:driver`.
- Version 0.12.0; move this plan to `dev/plans/done/`.

## Decisions taken in this plan (change before starting if wrong)

1. Smooth scrolling is a new `Mouse.scroll(x, y)` in fractional notches with WheelEvent signs; `scrollDown`/
   `scrollUp` keep dropping fractions, so nothing that uses them changes.
2. Relative movement is `Mouse.moveBy(dx, dy)` in mouse counts, with a separate relative uinput device on Wayland.
3. Blocked input throws `EASYCONTROL_INPUT_BLOCKED` (Windows) rather than the functions returning `false`;
   `getInputBlock()` is the way to check ahead.
4. Rumble is a single `onRumble` property per pad, not an EventEmitter, as the pad is a native class.
5. Driver versions (20): newer drivers must serve older addons, so the addon needs only a minimum version
   (`EASYCONTROL_PAD_MIN_VERSION`), and new driver features are optional updates found by version. Rumble polls on
   v2 and waits on v3, so 0.12.0 forces no reinstall. `installDriver()` does not downgrade without `force`.
   The alternative, an exact-match version, is simpler but forces a UAC prompt on every machine for each driver
   change and breaks apps that share the driver.
6. `GetLayout`/`SetLayout` stay as aliases forever; no deprecation warning.
7. Scroll and move bounds are `RangeError`s (±10000 notches, ±100000 counts), not silent clamping.
8. Not in this plan, left to the maintainer:
   - `"private": true` in `package.json` (npm publishing).
   - 13, the driver's trust model: getting the UMDF driver attestation-signed through Microsoft Partner Center (no
     local root certificate, no signing step in the setup), and a small signed setup `.exe` so the UAC prompt names
     easy-control instead of Windows PowerShell. Both need a code signing certificate (EV for Partner Center).
   - 19, touch and pen input.
