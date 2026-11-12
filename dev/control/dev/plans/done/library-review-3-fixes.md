# Plan: fixes from the third library review

Status: done, released as 0.13.0 - all but 2 (macOS Caps Lock from the system), which waits for a check on a Mac
and moves to a later release. Covers the review of 2026-10-07 (bugs, efficiency, simplification) and one addition asked for
with it: `Mouse.moveByX(dx)` / `Mouse.moveByY(dy)`. Target release: 0.13.0 (new API, no breaking change except
the `SetLayout` ones in Decisions 4, gamepad indices that are not integers (item 8) and the uniform argument error
messages (14)).

## Progress

Filled in as phases are done: what was verified where, measurements (11, 12), what could not be verified.

2026-10-07, phase 1 done (13, 1, 6, 8, 11, 10's Windows part, 14's shared part; also moved ahead: `RequireDisplay`
into `platform.h` (14, Linux part) and the `getIconId` docs (10, Linux part)).

- Windows x64 (dev machine, driver 3 installed): build without warnings, `npm test` 67 pass (9 skipped: no secure
  desktop showing, Linux/X11/Wayland only, the driver-missing and UAC cases), `test:types`, `test:native` (the new
  `release_all_test.cpp` 8/8), `test:e2e` 19/19 (the new `moveByX`/`moveByY` test with its kept-fraction steps;
  `releaseAll` with three keys and two buttons held), `test:driver` run elevated 9/9 (the two new ones: ten
  `create()` calls right after `sc stop`, 2.7 s for all ten; a disabled service rejects in 0.8 s; the start type
  put back).
- Linux x64 X11 in Docker (node:24-bookworm, privileged, uinput) under Xvfb: build without warnings in our
  sources, `npm test` 67 pass, `test:types`, `test:native`.
- 11, measured on the dev machine (1 monitor, 1280x1024 at 125%), 10000 calls each, before / after one layout per
  call: `getX` 2.0 / 2.0 µs, `getX` + `getY` 4.0 / 4.0 µs, `getPosition` - / 2.5 µs, `setPosition` 6.5 / 7.4-7.9 µs
  (noise between runs), `setX` 8.5 / 7.5 µs. Far below the 20 µs of step 3, which is therefore not done: no layout is
  kept between calls (Decisions 8). Each further monitor adds a `GetMonitorInfo` and a `GetDpiForMonitor`; a
  machine with several monitors was not at hand to measure.
- Messages: the argument helpers' are "Expected N argument(s)", "Argument N must be a string / a boolean / a
  finite number / an integer", "Argument 1 must not be empty"; the button name's "Argument 1 must be 'left',
  'middle', 'right', 'back' or 'forward'". The gamepad's range messages and `setState`'s `buttons[i]` ones stay.
- Not verified: the by-hand checks of 1 and 10 (lock screen, an elevated foreground window), Wayland's
  `PointerMoveBy` change (no runner), macOS (CI builds it at the next push).

2026-10-07, phase 2 done (5's Linux part, 3, 4, 9, 12).

- Linux x64 X11 in Docker under Xvfb: build without warnings in our sources, `npm test` 73 pass (the new X11
  tests: Caps Lock with the US and Hungarian layouts and borrowed `éÉ`; the second of `us,hu` active typing `ő` from
  its own key; a layout without a third level; running out of spare keys; two workers typing borrowed characters
  at once while a third times `moveBy`/`getX` under 20 ms; four workers reading the pointer, its icon, the layout
  and the screens with nothing on stderr), `test:types`, `test:native` (the new `scroll_math_test.cpp`). Against
  the phase 1 code, the Caps Lock, spare-key and two-worker tests fail, as they should.
- Windows x64: build without warnings, `npm test` 68 pass (the X11 tests skip), `test:native`.
- Found by the spare-key test, and there before (the phase 1 code lost five of the first six): of several keys
  borrowed in one call, some reached the test window as no symbol - its Xlib refreshes the keymap lazily, and
  borrowings between presses raced with that. Every key a call needs is now borrowed (one `XSync`) before the
  first press; 19 of 19 arrive, in one call or many. `XkbGetKeySyms` of a borrowed key failed (BadAlloc for a key
  that had no symbols): the map is read back with `XkbGetUpdatedMap(XkbKeySymsMask)`. The X server gives a
  `{lower, upper}` key the ALPHABETIC type itself, so no `XkbChangeTypesOfKey` is needed (checked with a probe:
  type index 2, mask Shift+Lock).
- 12, measured in Docker (Xvfb, US layout), before / after: `type()` of 2000 characters 3.4 / 3.4 ms (sending the
  keys dominates), `type("a")` 0.07 / 0.12 ms, `type("A")` 0.07 / 0.13 ms. Under the 2x of Decisions 12: the map is
  made per call, not kept between calls.
- Xvfb has 19 spare keycodes (US layout); the README says "about 20".
- CI installs `x11-xserver-utils` for `xmodmap`, which the spare-key test counts the spare keys with.
- Not verified: Wayland (the Caps Lock note in the README, `type()` and the wheel through XWayland and uinput: no
  runner; the wheel arithmetic is, by `test:native`).
- CI (run 37590340067, `2c1a7ea`): Windows x64, Linux x64 (Node 22, 24) and ARM64 with the new X11 tests, macOS
  (phases 1 and 2 compile there) passed. Windows ARM64 failed one test: "create() fails fast when the service
  cannot be started" ran past its 60 s timeout, cancelled before its assertions - the PowerShell calls around it
  take tens of seconds on that runner (the registry version tests 45 s each). Its timeout is now 5 minutes.
  The next run (37592420608, `5325066`) passed on every target.

2026-10-07, phase 3 coded (5's macOS part, 7, 14's Swift helper); 2 not started: no Mac to check on first
(Decisions 10).

- 7: `createGamepad` takes the id first (serial number `"EasyControl<id>"`), makes the device, and waits outside
  `SwiftCode.lock` on a semaphore the activating `Task` signals (5 s); `-1` unavailable, `-2` activation failed (its
  error's description passed out in an `NSMutableString`), `-3` timeout, the device torn down on both. Only an
  active pad goes into `gamepads`. `withDevice` serves the six lookups.
- 5: `InputStateLock` (a recursive mutex in `platform.h`) around `PostMove`, the macOS `SendButton`, the scroll
  flags and `PostKey`.
- Tests: a macOS test that `create()` names its failure ("macOS 26" before Darwin 25, else one of the three); the
  worker stress test gets a macOS-only case pressing modifiers and buttons from four workers (skipped where
  Accessibility is granted, as real input would go out).
- Verified: Windows builds and its tests pass (these are macOS-only paths); CI (run 37606414437, `6b565bb`) built and
  tested every target, macOS included, so the Swift and the Objective-C++ compile and the macOS tests pass. The job
  logs need signing in, so whether the macOS `create()` test ran or skipped there is not known. Not verifiable in
  CI: an activated pad (macOS 26 and the entitlement).

2026-10-07, phase 4 (release 0.13.0).

- By hand on the dev machine (Windows 11), with a script holding F13 and acting the moment
  `Platform.getInputBlock()` turned `"secure-desktop"` after Win+L: `releaseAll()` threw `EASYCONTROL_INPUT_BLOCKED`,
  and a second call threw again - the key was kept (the old code emptied its set at the first failure); after the
  unlock `releaseAll()` worked, and once more found nothing held. `setLayout` threw `EASYCONTROL_INPUT_BLOCKED` ("no
  foreground window") on the lock screen and worked after. Windows itself had let go of F13 at the desktop switch
  (`GetAsyncKeyState` false after the unlock), easy-control's set still held it until `releaseAll`. A first try
  was too slow: Windows Hello's face unlock ended the lock within about 2 s, so the script acts at once now.
- Not done: `setLayout` with an elevated window in front (the access error) - the elevated window was not in front
  while the check ran, and the release went ahead without it.
- 2 stays out of this release (Decisions 10): no Mac with Accessibility to check posted Caps Lock presses on; the
  CHANGELOG does not list it.
- Version 0.13.0; `dist/` gets every target's build from CI's update-dist run.

2026-10-07: the plan was checked against the code (no change made to the code). Every line reference and every
claim about today's behaviour held; corrected from that check: the exit hook (1), the Wayland `PointerMoveBy` change
(13), the `StartService` error codes and the idle stop's missing STOP_PENDING (6), the pipe error and `SetLayout`
case (10), `TypeUnicodeEntry`, borrowed keys and ties under Caps Lock (3), the Swift details (7), the `dlopen`
statics (5), the `spawn` failure wording (14).

2026-10-07, second check of the plan: the macOS Caps Lock read is verified on a Mac before it is built on, with
IOKit's lock state as the way if posted presses do not move it (2, Decisions 10); the XKB lookup carries the group
and applies the clients' Lock case rule, and borrowed keys get the ALPHABETIC type instead of Caps Lock being
unlocked around them (3, Decisions 9); the pipe closed by the idle stop right after connecting is retried (6); a late
activation is torn down (7); `2**32` as an index (8); the lock order and the whole-call lock of `type()` (5); which
handle `SetLayout` picks (10); the `moveByX` fraction test, the units of the scroll test, the loader test of the
exit hook, `parseArgs` strictness, Decisions 6's reason.

2026-10-07, review of the plan (architecture, code quality, tests, performance), decided with the user: `type()`
holds a typing mutex and the X lock only per Xlib step (5, Decisions 3); failures carry their code through an
`InputError` core, the `releaseAll` loop is a pure helper tested by `test:native` (1); nothing is frozen, the exit
hook keeps its own references instead (1, 14, Decisions 7); macOS `createGamepad()` tells its three failures apart
(7); `SetLayout` throws without a foreground window or when the post fails (10); the map of 3 skips modifiers the
layout lacks (3); the argument helpers own uniform messages (14); the stress test types from two workers at once and
times the pointer (5); a disabled service fails fast (6); short `type()` calls are measured too (12); the monitor
count goes with 11's measurement.

The review read the JS loader and types, the build scripts, `binding.gyp`, every native module and the gamepad
service; `driver.c`, the setup script, `build-gamepad-win.js` and the e2e tests were not reviewed in depth. Nothing
was run: every item below is from reading the code, and each says how it is to be checked.

Only Windows can be built and tested on the dev machine; Linux X11 also in Docker (as in the last plan), macOS
through CI only.

## Scope

| # | Item | Kind | Phase |
|---|---|---|---|
| 1 | `releaseAll()` forgets the keys/buttons after the first failed release | bug | 1 |
| 2 | macOS: the Caps Lock flag starts `false`, whatever the real state | bug | 3 |
| 3 | Linux: `type()` with Caps Lock on types upper case (one change with 12) | bug | 2 |
| 4 | X11: `type()` drops characters silently when no spare keycode is left | bug | 2 |
| 5 | Linux: one Xlib `Display*` used from several threads; unsynchronized statics (macOS, Linux) | bug | 2, 3 |
| 6 | Windows: `create()` fails after 10 s when it meets the service's idle stop | bug | 1 |
| 7 | macOS gamepad: `create()` resolves before activation; shared serial number; unlocked `initialized` | bug | 3 |
| 8 | Gamepad indices accept `NaN` and fractions | bug | 1 |
| 9 | Wayland `scroll()`: truncating division delays the low-resolution notch | bug | 2 |
| 10 | Small: `SetLayout` side effect and string widening, pipe error text, `BundledVersion` race, `getIconId` doc | bug | 1, 2 |
| 11 | Windows: the monitor layout is recomputed on every coordinate conversion; `Mouse.getPosition()` | performance, API | 1 |
| 12 | Linux: `FindKey` scans the keymap for every character (one change with 3) | performance | 2 |
| 13 | `Mouse.moveByX(dx)` / `Mouse.moveByY(dy)` | feature | 1 |
| 14 | Simplification: `binding.gyp`, duplicate link pragmas, `RequireDisplay`, argument helpers, `Init` helper, `ReadCursor` cleanup, Swift lock helper, `index.js`, the exit hook's own references | quality | 1, 2, 3 |

---

## Phase 1: Windows-testable (and the shared code)

### 13. `Mouse.moveByX(dx)` / `Mouse.moveByY(dy)`

Movement along one axis, beside `moveBy`, as `setX`/`setY` are beside `setPosition`:

```js
Mouse.moveByX(dx);   // the same as Mouse.moveBy(dx, 0)
Mouse.moveByY(dy);   // the same as Mouse.moveBy(0, dy)
```

- Native, in `mouse.cpp`: `moveBy`'s body moves into `static void MoveBy(Napi::Env, double dx, double dy)`;
  `moveBy`, `moveByX` and `moveByY` parse their arguments and call it. The other axis's kept fraction is left as it
  is (`TakeWhole` adds 0 to it).
- Same checks as `moveBy`: a non-finite value is a `TypeError`, beyond ±100000 a `RangeError`; one argument
  required.
- Platforms: nothing new on Windows, macOS and X11. Windows sends `MOUSEEVENTF_MOVE` with one delta 0; macOS posts
  the move with one delta field 0; X11 `XTestFakeRelativeMotionEvent(dx, 0)`. Wayland: `VirtualInput::PointerMoveBy`
  (`uinput.cpp:228-234`) sends `REL_X` and `REL_Y` always; it is changed to leave a zero axis out of the report, so
  `moveByX` sends one `REL_X` event - and `moveBy(dx, 0)` too from now on.
- Follows in: the loader's `API` list (and so the stand-ins and the loader test "every API member is a function,
  and there are no others"), `easy-control.d.ts` (JSDoc pointing to `moveBy`), `test/types/usage.cts` and `.mts`,
  README (Mouse section next to `moveBy`, and "Linux: X11 and Wayland", which says what `moveBy` does there: "moveBy
  and moveByX/moveByY"), CHANGELOG.
- Tests: unit - argument checks as for `moveBy` (none, a string, `Infinity`, ±100001); with input access, from the
  middle of the primary screen as the `moveBy` test starts, `moveByX(20)` moves `getX()` right and leaves `getY()`
  within `pixelTolerance`, `moveByY(-20)` moves up and leaves `getX()`. e2e - a pointer-locked element gets
  `movementX > 0, movementY == 0` from `moveByX(20)`, and `movementX == 0, movementY < 0` from `moveByY(-20)`;
  fractions, read as `movement*` there (one count is not reliably a pixel under the pointer speed settings):
  `moveBy(0, 0.4)` twice (nothing), `moveByX(0.4)` three times (`movementX == 1` on the third, `movementY == 0`
  throughout), then `moveBy(0, 0.4)` once (`movementY == 1` now: the y fraction was kept, not touched).
- Not verifiable: Wayland (no runner), as for `moveBy`.

### 1. `releaseAll()` keeps what it could not release

`mouse.cpp:984-995`, `keyboard.cpp:922-933`

- Today the set is emptied first and the loop returns on the first failed `SendKey`/`SendButton`: the rest is never
  sent and no longer tracked, so neither a later `releaseAll()` nor the exit hook can release them.
- Change: try every key/button; those that fail go back into the set; after the loop, one error is thrown (the
  first failure's, with its code, which on Windows is `EASYCONTROL_INPUT_BLOCKED`).
- `SendKey`/`SendButton` become a core that returns an `InputError { code, message }` (empty when it worked) and a
  thin wrapper that throws it, so the error's code survives and the platform branches stay in one copy.
  `platform.h` gets `ThrowInputError(env, error)`, which `ThrowInputBlocked` uses too; `PressKey`/`PressButton`
  call the throwing wrapper as today.
- The loop is a pure helper, `ReleaseEach(std::set<std::string>&, send)` in `src/native/release_all.h`, that both
  `releaseAll`s call: it tries every entry, puts the failed ones back and returns the first `InputError`.
- Linux Wayland: a failed write drops the virtual device (`uinput.cpp` `Send`), and the kernel releases what that
  device held; the key going back into the set is then released on the new device later, which is harmless.
- The loader's exit hook calls `Keyboard.releaseAll()` and `Mouse.releaseAll()` in one `try`: when the first
  throws, the mouse buttons are never released (already so today; Decisions 5 makes the throw deliberate). Each
  gets its own `try`. The hook also takes the two functions at load time (`const releaseKeys =
  addon.Keyboard.releaseAll`, the same for the mouse) instead of looking them up at exit: the namespaces it reads
  are the objects the app gets, so an app replacing `Keyboard.releaseAll` would otherwise change what the hook
  calls (Decisions 7). Loader tests, each in a child process (the hook is only registered on a main thread):
  `require.extensions[".node"]` gives a fake addon whose `Keyboard.releaseAll` throws and whose `Mouse.releaseAll`
  writes a marker to stdout; the loader is loaded, the process exits, the marker is there. And with the real
  addon, `Keyboard.releaseAll` replaced after load by one writing a marker; at exit the marker is not there.
- Tests: `test:native` - `release_all_test.cpp` over `ReleaseEach` with a fake send: every send works (the set
  ends empty, no error); the second of three fails (all three tried, only the second back in the set, its error
  returned); all fail (the set unchanged, the first error returned, its code kept). e2e - three keys and two
  buttons held, one `releaseAll()` each, every keyup and mouseup arrives (today's e2e tests hold one). The failure
  path on a real system is not provokable unattended: by hand on Windows, with a key held, lock the
  screen and have a scheduled task call `releaseAll()` (it throws `EASYCONTROL_INPUT_BLOCKED`); unlock, call it
  again, the key's keyup arrives - as the secure-desktop checks of 0.12.0 were done.

### 6. The gamepad service started again when it was stopping

`gamepad_win.cpp:192-233`

- `isStarted` allows one `StartService`; when the service is in its idle stop, `ERROR_SERVICE_ALREADY_RUNNING`
  counts as started, the service exits, and the loop waits out its 10 s.
- The idle stop (`service.cpp` `RunPipeServer`) never reports `SERVICE_STOP_PENDING`: the SCM sees RUNNING until
  `ServiceMain` reports STOPPED, so `StartService` answers `ERROR_SERVICE_ALREADY_RUNNING` all through the shutdown.
- Change: while the pipe is missing (`ERROR_FILE_NOT_FOUND`), call `StartService` again at most every 500 ms until
  the deadline; `ERROR_SERVICE_ALREADY_RUNNING` (running or stopping) and `ERROR_SERVICE_DATABASE_LOCKED` are waited
  on, not failures. (`ERROR_SERVICE_CANNOT_ACCEPT_CTRL` is `ControlService`'s, `StartService` does not return it.)
- The other side of the idle stop (`service.cpp:339-361`): a client connecting just as the stop is decided is
  connected and then closed, as `WaitForMultipleObjects` reports `stopEvent` first; its `CreateFileW` succeeded and
  `TransactNamedPipe` fails. When the CREATE transaction fails with `ERROR_PIPE_NOT_CONNECTED`, `ERROR_BROKEN_PIPE`
  or `ERROR_NO_DATA`, `WinPadCreate` closes the handle and connects again (through the start loop above) once,
  within the same deadline.
- Client side only: the service, driver and setup do not change, so `EASYCONTROL_PAD_VERSION` stays 3.
- Tests: `test:driver` (administrator) - with no pad plugged in, `sc stop` the service (it returns once the service
  reports stop-pending) and call `create()` at once: it resolves (today it rejects after 10 s with
  `EASYCONTROL_SERVICE_FAILED`). Ten times in a row. The idle stop itself is already tested; `sc stop` is not quite
  its path (it reports STOP_PENDING, the idle stop does not), but both end in `ERROR_SERVICE_ALREADY_RUNNING` with
  the pipe gone, which is what the retry handles - without the 60 s wait. And what must not be retried: the
  service's start type set to disabled (`sc config ... start= disabled`), `create()` rejects with
  `EASYCONTROL_SERVICE_FAILED` within 2 s, not after the 10 s; the start type read before and put back in a
  `finally` (and an `after` hook). The closed-after-connect retry is not provokable unattended (a window of
  microseconds); by reading.

### 8. Gamepad indices are integers

`gamepad.cpp:639`, `gamepad.cpp:682`

- `buttonDown`, `buttonUp`, `setAxis`: an index that is not an integer (`NaN`, `1.5`, `Infinity`) is a `TypeError`;
  today `Int32Value()` makes `NaN` button 0 and `1.7` button 1, and wraps `2**32 + 1` to button 1. Through the
  `RequireIndex` helper of 14, which checks the double before converting. An integer out of range stays a
  `RangeError` with today's messages, so the existing assertions hold.
- Tests: unit (with a pad, in the existing "reject bad indices" test): `NaN`, `1.5`, `-0.5`, `Infinity` as a
  button or axis index throw `TypeError`; `2**32` and `2**32 + 1` throw `RangeError`. These run where a pad can be
  made (CI Windows with the driver, Linux).

### 11. Coordinates without the layout work on every call; `Mouse.getPosition()`

`screen.cpp:131-190`

- `PhysicalToLogical`/`LogicalToPhysical` enumerate the monitors, ask each one's DPI and lay them out on every call;
  `getX()` + `getY()` does it twice, `setX`/`setY` twice more.
- Most of the cost is likely the system calls (`EnumDisplayMonitors`, `GetMonitorInfo` and `GetDpiForMonitor` per
  monitor), not the layout arithmetic, so a cache that still calls `ListMonitors()` to check itself would save
  little. Hence, in this order:
  1. Measure: 10000 `getX()` and 10000 `setPosition()` on the dev machine, time per call and the number of
     monitors, into the progress section. The cost grows with each monitor (`GetDpiForMonitor` per monitor), so
     the 20 µs of step 3 is judged for a few monitors, not only the dev machine's.
  2. One layout per call: `PhysicalToLogical`/`LogicalToPhysical` take a layout made by the caller, and `setX`,
     `setY` and the new `getPosition()` make it once for their read and their move (today `setX` makes it twice).
  3. Only if a call still costs more than about 20 µs: keep the layout between calls and make it again when
     `GetSystemMetrics(SM_CMONITORS)`, the virtual screen's rectangle (`SM_XVIRTUALSCREEN` ... `SM_CYVIRTUALSCREEN`)
     or the primary monitor's DPI (`GetDpiForSystem` does not follow changes, so `GetDpiForMonitor` of the primary)
     differ from when it was made - cheap reads, which catch connecting, moving and rescaling monitors in practice
     but not a scale change of a secondary monitor alone; that case also gets a 1 s age limit. Under a mutex
     (worker threads). Decisions 8.
- `Mouse.getPosition()` → `{ x, y }`: both from one read, so they belong to the same moment and cost one layout;
  `getX`/`getY` stay. On every platform (macOS and Linux read both at once already). Loader `API` list, `.d.ts`,
  type tests, README, CHANGELOG.
- Tests: unit - `getPosition()` returns two finite numbers within `pixelTolerance` of `getX()`/`getY()` while the
  pointer is still, and throws `EASYCONTROL_INPUT_BLOCKED` on the secure desktop like `getX`; the existing
  `setPosition`/`setX`/`setY` tests over every screen cover step 2. If step 3 is done, by hand: a loop calling
  `getPosition()` while a secondary monitor's scale is changed in Settings, and while a monitor is unplugged; the
  values are right again within the 1 s limit.

### 10 (Windows part). Small fixes

- `SetLayout` (`keyboard.cpp:1360`): switch only to layouts the user has: the HKL of
  `GetKeyboardLayoutList` whose `LayoutName()` is the KLID asked for, posted with `WM_INPUTLANGCHANGEREQUEST` as
  today; a KLID not among them throws "Layout not found" (the macOS and Linux message) instead of
  `LoadKeyboardLayoutW(KLF_ACTIVATE)` adding it to the user's language list. The KLIDs are compared ignoring case
  (`LayoutName()` gives upper-case hex, `LoadKeyboardLayoutW` took either). Several handles can have the same KLID
  (the US layout under English and under Hungarian): the one in the foreground window's current language wins,
  else the first in the list. The string is converted with
  `MultiByteToWideChar`, not widened byte by byte. Behaviour change, see Decisions 4.
- The two silent no-ops of `SetLayout` throw: no foreground window (the secure desktop, focus changing; today
  `PostMessageW(NULL, ...)` posts to the calling thread's own queue) throws `EASYCONTROL_INPUT_BLOCKED` as the
  other input calls there, before any handle is picked; `PostMessageW` failing (UIPI, an elevated foreground
  window: `ERROR_ACCESS_DENIED`) throws with `WinErrorText(GetLastError())`. Behaviour change, Decisions 4.
- The pipe's short-read error (`gamepad_win.cpp:358-363`): when `TransactNamedPipe` succeeded but the answer is short
  or its magic wrong, `GetLastError()` is 0, so the message says what happened ("answered N bytes, expected M" / bad
  magic); when the call failed, it keeps `WinErrorText(GetLastError())`.
- `BundledVersion()` (`gamepad_win.cpp:74-94`): `static const int version =
  ReadBundledVersion();` - thread-safe initialization, shorter.
- Tests: unit - `SetLayout` with a valid KLID that is not installed (picked from the registry's `Keyboard Layouts`,
  not in `GetKeyboardLayoutList`) throws and leaves the list unchanged; the rest is covered by the existing tests.
  By hand, with the lock-screen check of 1: `SetLayout` of an installed KLID from a scheduled task on the lock
  screen throws `EASYCONTROL_INPUT_BLOCKED`; with an elevated window (an administrator console) in the foreground,
  it throws the access error.

### 14 (shared part). Simplification

- `binding.gyp`: the six shared sources, `NAPI_DISABLE_CPP_EXCEPTIONS` and the `node-addon-api` include move to the
  target; each condition keeps only its extra sources, defines and flags. Drop `-Wbad-function-cast` (C only, g++
  warns on every file) and `-Winline`.
- Libraries linked in one place: the `#pragma comment(lib, ...)` lines in `gamepad_win.cpp`, `keyboard.cpp` and
  `screen.cpp` go; `binding.gyp` keeps the list (it already has them all).
- `src/native/args.h`: `RequireArgs(info, n)`, `RequireString`, `RequireFinite`, `RequireIndex(info, i, count)`,
  each throwing the `TypeError`/`RangeError` and returning false. `ParseKey`, `ParseButton`, `ParseCoordinate`,
  `ParsePair`, `type()`'s and the gamepad's checks use them. The helpers own their messages, the same everywhere
  ("Expected 2 arguments", "Argument 1 must be a finite number", ...) instead of today's mix ("Expected 2
  argument", "Button index expected", "Axis index and direction expected"); the messages that carry the bounds
  ("Button index out of range (0-16)") or a path (`buttons[0]`) keep them. The error types do not change. The two
  tests matching a message exactly (`gamepad.test.js:149`, `:155`) follow; CHANGELOG: argument error messages are
  uniform.
- `Init` functions: a helper `SetFunction(obj, "getX", Mouse::getX)` that also names the function
  (`Napi::Function::New(env, fn, name)`), so stack traces show `getX` instead of an anonymous function.
- Windows `ReadCursor` (`mouse.cpp:379-504`): the bitmaps and the DC are held
  by a small guard that frees them on every path; `GetDIBits` results are checked (a failure returns the empty
  picture).
- `index.js`: `util.parseArgs` instead of `getArg` (in every supported Node, `engines` is >=22; strict, so an
  unknown flag is now an error instead of being ignored); one `copyFile` for every platform; the ViGEm and `.a` cleanup of
  pre-0.10 builds goes; `spawn`'s `"error"` event rejects (today there is no listener, so a failed spawn ends the
  build with an unhandled `"error"` event instead of the build's own message).
- Loader: the stand-ins are no longer frozen, so they behave like the addon's namespaces, which stay unfrozen: an
  app's test doubles (`jest.spyOn(Mouse, "getX")`) work on every runner, supported or not. The exit hook does not
  depend on it (it keeps its own references, 1). Decisions 7.
- Tests: everything still builds without new warnings on Windows and in CI; `npm test`, `test:types`, `test:native`,
  `test:e2e` pass unchanged; the loader test checks a stand-in's function can be replaced.

---

## Phase 2: Linux (Docker X11 here, the rest in CI)

### 5 (Linux part). Xlib from several threads

`platform.h:130-136`

- The addon is loaded in workers, and they share one `Display*`; Xlib without `XInitThreads` is not safe for two
  threads at once, and calling `XInitThreads` from an addon is too late when the host used Xlib before.
- Change: `platform.h` gets an `XDisplayLock` (a `std::lock_guard` over one process-wide `std::recursive_mutex`)
  held around every use of `XGetMainDisplay()`'s display: mouse, keyboard, screen, access - around each step that
  calls Xlib, not around whole calls. `XGetMainDisplay()` itself opens the display under it (today two threads can
  both see `nullptr` and open two). The `getIconId` statics are under it too. The Wayland connection and the
  uinput devices have their own mutexes already.
- `type()` takes a `typingMutex` of its own for the whole call, so two calls at once take turns: it guards what a
  call keeps across its steps - the spare keycodes, the borrowed list, `KeysymToCodepoint`'s `dlopen` statics
  (`keyboard.cpp:661-671`; only `type()` calls it). Within the call, the X lock is taken per Xlib step (reading the
  keymap and state, each key's XTest event, each borrow and its `XSync`, the give-back) and is not held during the
  25 ms wait for the borrowed keys, so other threads' `getX`/`moveBy`/`getIcon` do not wait for a text being typed.
  The keymap read at the start can go stale if `setLayout` runs during the call, as it can when the user switches
  layouts while typing today.
- Lock order: `typingMutex`, then the X lock, then `VirtualInput`'s `deviceMutex` (taken under the X lock by
  `type()` on Wayland); no path may take a lock earlier in that order while holding a later one - in particular the
  screen list's XRandR fallback on Wayland is not called with the Wayland connection's mutex held. Written beside
  the locks in `platform.h`; every path checked while adding the guards.
- Tests: unit - four workers call `getX`, `getIcon`, `getLayout`, `Screen.list` 2000 times each at once; no crash,
  no Xlib error on stderr. Beside them (X11, the test window of `typing-x11.test.js`): two workers `type()`
  different characters that are not on the layout (borrowed keys) at the same time, ten times each; the window gets
  exactly the characters of both (as a multiset; the order between the workers is free), so no spare keycode was
  borrowed twice. A third worker calls `moveBy` and `getX` in a loop meanwhile; its slowest call stays under 20 ms,
  so the X lock is not held through the 25 ms wait. Run in Docker under Xvfb and in CI.

### 3. `type()` with Caps Lock on

`keyboard.cpp:807-837`

- Done together with 12, by one change: the characters are found by what each key *types now*, not by the
  keysym on a level. `type()` reads the keymap once (`XkbGetMap`) and the locked modifiers once (`XkbGetState`,
  already made at line 1110: `state.locked_mods`), then for every keycode and each of the four modifier sets it
  can hold - none, Shift, AltGr, Shift+AltGr (AltGr's modifier from `XkbKeysymToModifiers(XK_ISO_Level3_Shift)`) -
  asks `XkbTranslateKeyCode(keycode, XkbBuildCoreState(held | locked, group))` what it types - the group as
  `FindKey` passes it today (`state.group`), or a user with two layouts gets the first one's characters.
  `XkbTranslateKeyCode` applies the key type: what Caps Lock does on letters of ALPHABETIC types, and Num Lock on
  the keypad. The rest of Caps Lock is the clients' (Xlib's `XLookupString`, xkbcommon): when Lock is locked and
  the key's type does not use it (not in the `mods_rtrn` the call gives back), they upper-case the keysym. The map
  does the same (`XConvertCase`, the upper one), so it holds what the application receives, also on keys whose
  type ignores Lock (some AltGr levels, some national keys). The fewest modifiers win, as today's lowest level
  does; among keys with the same modifiers the lowest keycode wins (with Num Lock on, `1` is on the top row and on
  the keypad, both without modifiers: the top row, as today).
- Modifier sets the layout cannot hold are skipped when the map is built, as `TapCharacter` skips their levels
  today (`keyboard.cpp:829`): the Shift sets when there is no `Shift_L` keycode, the AltGr sets when there is no
  `ISO_Level3_Shift` keycode or `XkbKeysymToModifiers` gives it no modifier (mask 0, where the AltGr sets would
  equal the plain ones and characters would be pressed with a needless AltGr, or with keycode 0).
- `TapAtLevel` becomes `TapWithModifiers` (Shift and/or AltGr held), unchanged otherwise.
- `TypeUnicodeEntry` (`keyboard.cpp:843`) needs `u` at level 0 today; with Caps Lock on, the new map has `u` only
  with Shift. It takes the key of `u` or `U` with whatever modifiers the map gives (Ctrl+Shift+U starts the entry
  either way), else the Wayland fallback would stop working whenever Caps Lock is on.
- Borrowed keys (X11): a character put on a spare keycode as `{keysym, keysym}` comes out upper case with Caps Lock
  on, by the clients' rule above (the key's type, ONE_LEVEL or TWO_LEVEL, does not use Lock). A cased character
  is borrowed as `{lower, upper}` with the ALPHABETIC type (`XkbChangeTypesOfKey`, `XkbAlphabeticIndex`), so the
  key behaves as a letter key: no modifier types the lower case with Caps Lock off, Shift with it on - looked up
  in the map like any key. An uncased one stays `{keysym, keysym}`. Caps Lock is never unlocked around the taps
  (that would flash the LED and race with the real keyboard). The type goes back with the keysyms at the end.
- Wayland: the locked modifiers come from XWayland, which learns them from the compositor only while one of its
  windows has focus, so they can be stale; said in the README next to the `getLockState()` note. Not verifiable
  (no runner).
- Tests: unit (X11, as `typing-x11.test.js`) - Caps Lock turned on with `keyDown`/`keyUp("CapsLock")`, then
  `type("aB1@")` into the test window reads back `aB1@`, with the US and the Hungarian layout, and `type("éÉ")` on
  the US layout (borrowed keys) reads back `éÉ`; with `us,hu` as two groups and the second active, `type("ő")`
  types it from the Hungarian keys (no borrowed key); Caps Lock turned off again at the end, also on failure. On a
  layout with no third level (`setxkbmap us` without an `lv3` option), `type("aA")` reads back `aA` and no event has
  keycode 0. The existing typing tests pass unchanged.

### 4. No silent drops on X11

`keyboard.cpp:1178-1180`

- A character with no spare keycode left goes into `missing`, as on Wayland, and the call throws at the end naming
  them ("Not on the current keyboard layout and no spare key left, not typed: U+..."), after typing the rest.
- Tests: unit (X11) - type more distinct characters not on the layout than there are spare keycodes (count them in
  the test with `xmodmap -pke`); the call throws, the message names the last ones, the first ones arrived.

### 9. Wayland wheel notches by floor division

`mouse.cpp:1171-1172`

- `notches = floorDiv(total + wheel, 120) - floorDiv(total, 120)`, so a notch goes exactly when the total crosses
  a multiple of 120 in either direction.
- The arithmetic moves into a pure function in a header (`scroll_math.h`), with the `% (120 * 1000)` wrap of the
  total, tested by `test:native` on every platform; in 120ths of a notch, as the function takes them: `+60, -120`
  gives a notch of -1 on the second call; `+120` gives +1; 240 calls of `+60` give 120 notches; totals across the
  wrap (from `119999` up, from `-119999` down) give the same notches as without it.
- Not verifiable on a real compositor (no runner); the unit of the math is.

### 12. `FindKey` from a map built once per call

`keyboard.cpp:767-787`

- The map of 3: `type()` builds `codepoint → (keycode, modifiers)` once per call (one pass over every keycode and
  the four modifier sets), and `TapCharacter`/`TypeUnicodeEntry` look characters up in it. Control characters keep
  their keysym lookup (Return, Tab, BackSpace, Escape at no modifiers).
- Borrowed keys (X11) are put in the map when borrowed, so a repeated character finds its key there.
- The keymap from `XkbGetMap` is held by a guard that frees it (`XkbFreeKeyboard`) on every path.
- Measure, in Docker, before and after, into the progress section: `type()` of 2000 characters, and 1000 calls of
  `type("a")`. Today's `FindKey` reads Xlib's client-side keymap (no round trip); the map costs an `XkbGetMap`
  round trip and about 4 x 248 `XkbTranslateKeyCode` calls per call, so a caller typing one character per call (a
  streamer forwarding keystrokes) can get slower while long texts get faster. If a one-character call is more
  than about 2x today's: the map is kept between calls, keyed by the group and the locked modifiers, with an age
  limit (as 11), so a `setxkbmap` is picked up.
- Tests: the existing typing tests (Hungarian layout, borrowed key) pass unchanged.

### 10 (Linux part). `getIconId` doc

- The `.d.ts` and README say `getIconId()` is 0 while the pointer is hidden on Windows and macOS; Linux cannot tell
  (XFixes reports no hidden state).

### 14 (Linux part)

- `RequireDisplay` (in `mouse.cpp` and `keyboard.cpp` today) moves to `platform.h`, next to `XGetMainDisplay`.

---

## Phase 3: macOS (CI)

### 2. The Caps Lock flag from the system

`keyboard.cpp:572`, `keyboard.cpp:607-610`

- `isCapsLockOn` is today a guess from easy-control's own presses, starting `false`. Reading the system's state
  instead (`CGEventSourceFlagsState(kCGEventSourceStateHIDSystemState) & kCGEventFlagMaskAlphaShift`, what
  `getLockState()` reads) only works if easy-control's own posted presses change that state - and Caps Lock
  presses posted with `CGEventPost` are widely reported not to toggle the real lock. If they do not, every press
  would read "off" and post "on": Caps Lock could no longer be turned off. So, first:
  1. On a Mac with Accessibility: post a Caps Lock press with today's code, read the HIDSystem flag and
     `getLockState()`, look at the LED. Result into the progress section. Decisions 10.
  2. If the flag follows the posted press: as above, the state is read before each Caps Lock press is applied and
     the flags-changed event carries the opposite of what was read; `UpdateModifierFlags` reads it the same way.
     Two presses faster than the system takes the first can read a stale state; accepted (a remote Caps Lock is
     pressed by a person).
  3. If it does not: a Caps Lock press sets the real lock with IOKit - `IOHIDSetModifierLockState(connection,
     kIOHIDCapsLockState, !current)` on an `IOHIDSystem` connection (`IOServiceOpen`, `kIOHIDParamConnectType`;
     IOKit is linked already), `current` from `IOHIDGetModifierLockState` - then posts the flags-changed event as
     today with the new state; `UpdateModifierFlags` and `getLockState()` read it from there. Whether that call
     needs a permission besides Accessibility is checked in the same session.
- Without a Mac, nothing of this is built: the item waits, and the CHANGELOG does not list it.
- Tests: e2e (skips without Accessibility, as the other macOS input tests) - turn Caps Lock on, press `KeyA` with
  `keyDown`/`keyUp`, the page reads `"A"` and `getModifierState("CapsLock")` true; turn it off again, `KeyA` reads
  `"a"` and `getLockState().capsLock` is false. Not verifiable in CI (no Accessibility on hosted runners): on the
  Mac of step 1, before release.

### 5 (macOS part). Shared state under a lock

- `heldModifiers`, `isCapsLockOn`, `ModifierFlags()`, `PressedButtons()` and the click-count statics (`clickButton`,
  `clickTime`, `clickPoint`, `clickCount`) are read and written under one mutex in `platform.h`.
- Tests: the worker stress test of phase 2 runs on macOS too (without Accessibility the events are dropped, the
  bookkeeping still runs).

### 7. macOS gamepad: created means activated

`GamepadImplement.swift`

- `createGamepad()` waits for `activate(delegate:)` (a semaphore the `Task` signals, at most 5 s); `OpenPad`
  already runs off the JS thread, so `create()` then rejects with `EASYCONTROL_CREATE_FAILED` instead of resolving
  with a pad that never works. It tells the failures apart, and `OpenPad` (`gamepad.cpp:284-288`) gives each its
  message: -1 unavailable (today's message: macOS 26 and the entitlement), -2 the activation failed (with the
  error's description where Swift has one), -3 the activation did not finish within 5 s. Today's single message
  would send an entitled macOS 26 user looking for the wrong cause. The wait happens outside
  `SwiftCode.lock` (the device is added to `gamepads` only once active), so a slow activation does not hold up the
  other pads' calls. On a timeout the pad is torn down (`destroy()`: `pumpTask` cancelled, the device let go), so an
  activation finishing after the 5 s does not leave a device that `create()` rejected.
- `initialized` is only written under `SwiftCode.lock` (the `Task` reports through the semaphore instead).
- Each pad gets its own serial number: `"EasyControl"` + the pad id. The id is taken from `nextId` (under the lock)
  before the device is made; today it is assigned after.
- 14: the six `SwiftCode` methods that look a pad up (all but `createGamepad`) use one
  `withDevice(_ id:, _ body:) -> Bool` helper for the lock and lookup.
- Not verifiable in CI (macOS 26 and the entitlement): CI checks it builds; the create-rejects path is checked on the
  runner, where `HIDVirtualDevice` is unavailable and `create()` must reject (an existing test), now also with the
  unavailable message (matched on "macOS 26"), not the activation ones.

---

## Phase 4: release

- CI builds every target; the `update-dist` run updates `dist/` (or a local build, as before).
- README (Mouse: `moveByX`, `moveByY`, `getPosition`; Keyboard: `SetLayout` only to installed layouts on Windows,
  Caps Lock and `type()` on Wayland; `getIconId` on Linux; Linux section: `moveByX`/`moveByY` with `moveBy`),
  `.d.ts`, CHANGELOG 0.13.0:
  - Added: `Mouse.moveByX`, `Mouse.moveByY`, `Mouse.getPosition`.
  - Fixed: 1-9 (2 only if done, see there), the `SetLayout` string, the pipe error message, `getIconId` docs.
  - Behaviour changes: `SetLayout` on Windows (Decisions 4); gamepad indices that are not integers throw;
    argument error messages are uniform (the error types are unchanged); the stand-ins of an unsupported platform
    are no longer frozen (Decisions 7).
  - No driver change: `EASYCONTROL_PAD_VERSION` stays 3, no reinstall.
- On Windows: `npm test`, `test:types`, `test:native`, `test:e2e`, `test:driver`. Docker: X11 tests, the worker
  stress test and the Caps Lock typing test. By hand: the `releaseAll` and `SetLayout` lock-screen checks of 1 and
  10; macOS Caps Lock (2)
  on a Mac with Accessibility, else 2 moves to a later release.
- Progress section of this plan: what was verified where, the measurements of 11 and 12, what was not verifiable.
- Version 0.13.0; move this plan to `dev/plans/done/`.

## Decisions taken in this plan (change before starting if wrong)

1. `moveByX`/`moveByY` are native functions sharing `moveBy`'s code, not JS wrappers in the loader, so the stand-ins,
   the API list and the type tests treat them like every other function.
2. `Mouse.getPosition()` is added (one read for both coordinates); `getX`/`getY` stay.
3. Thread safety is a process-wide lock around Xlib and around the macOS shared state, rather than documenting
   "use from one thread only". The X lock is held per Xlib step; `type()` takes turns through a typing mutex of its
   own, rather than holding the X lock for the whole call, so other threads' pointer calls do not wait for a text.
4. Windows `SetLayout` switches only to layouts the user has installed and throws for others, instead of installing
   them into the user's language list as a side effect. This can break a caller relying on that side effect. It also
   throws when there is no foreground window or the request cannot be posted, instead of doing nothing.
5. `releaseAll()` throws once after trying everything, rather than not throwing at all. The error is the first
   failure's, code included.
6. The pre-0.10 file cleanup in `index.js` is dropped: those files are not tracked in git, so the published
   package never has them, and on an old local checkout they sit unused beside the addon (the build does not clean
   `dist/`; they can be deleted by hand).
7. Nothing is frozen: the stand-ins are unfrozen to behave like the addon's namespaces, rather than the addon's
   being frozen like the stand-ins, which would break apps' test doubles (`jest.spyOn(Mouse, "getX")`). What
   freezing would protect - the exit hook calling what an app put in `Keyboard.releaseAll` - is done by the hook
   keeping its own references from load time.
8. Coordinate caching (11) goes only as far as the measurement asks: one layout per call always; a cache kept
   between calls only above about 20 µs a call, with the invalidation and 1 s age limit described there.
9. Linux `type()` finds characters by what keys type now (`XkbTranslateKeyCode` with the locked modifiers and the
   group, plus the clients' Lock case rule), one change for both Caps Lock (3) and speed (12), rather than a Caps
   Lock special case beside today's level search. Borrowed cased characters get the ALPHABETIC key type rather
   than Caps Lock being unlocked around them.
10. macOS Caps Lock (2) is built only after it is checked on a Mac whether posted presses move the system's lock
    state; if they do not, presses set it through IOKit. Without that check, 2 waits for a later release rather
    than shipping a change that could leave Caps Lock impossible to turn off.
11. Errors that are only provokable by hand get their logic tested where it can be: the `releaseAll` loop as a pure
    helper under `test:native` (1), as the screen layout and the scroll arithmetic are.
12. The keymap of 12 is read per call unless short calls measure more than about 2x slower; only then is it kept
    between calls (as Decisions 8 for 11).
