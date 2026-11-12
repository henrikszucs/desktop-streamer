# Plan: fixes from testing on a Mac

Status: done, as 0.14.0 - phase 3 against a stand-in for CoreHID only, as no machine at hand had the entitlement. Reviewed on 2026-11-06 (`/review-plan`, all four
sections). Covers the bugs found on 2026-11-05 by running the library on a real Mac for the first time
(MacBook M1, one display, macOS 27.2, Xcode 27.2, Hungarian layout). Target release: 0.14.0.

Testing a real virtual gamepad is out of scope, by decision: it needs an Apple-issued provisioning profile (an ad-hoc
signed entitlement gets the process killed at launch). So items 3 to 5 are checked against a stand-in for CoreHID
(item 0) and ship without having run on a real device; each says what that leaves open.

## Progress

Filled in as phases are done: what was verified where, what could not be verified.

2026-11-05, before any change (dist from CI run 37750863995):

- `npm test`: 59 pass, 1 fail, 24 skipped. The failure is item 1. It needs the pointer on a fraction when the test
  starts, which a real trackpad leaves it on: 3 of 3 fail from a fractional start, 3 of 3 pass from a whole point. CI
  could not catch it: the hosted runner has no Accessibility, so the pointer tests skip there. The same results from a local build of the sources on Xcode 27.2.
- `npm run test:e2e`: 18 pass, 1 skipped (the gamepad). `test:types`, `test:native` pass.

2026-11-05, prototypes in a scratch copy (nothing in this repo changed):

- Items 1 and 2, the design below: 20 of 20 runs of the full unit suite clean, e2e 18 of 18 twice, the failing test
  passes from a fractional start, `setPosition` 113 to 152 µs a call (the display list, on every call).
- Item 2: `CGCursorIsVisible` from another process reads 0 during `[NSCursor hide]` and 1 after, on macOS 27.2. But see
  the review's measurements below: it can also read 0 for a long time, and this is not understood yet.
- Item 6: a system-defined event flipped `output muted`, seen through `osascript`, and it was flipped back. The up and
  down keys were not tried: they would have been audible.
- Item 0: a copy of `GamepadImplement.swift` with CoreHID stubbed out builds; the 14 of the 19 tests of
  `gamepad.test.js` that apply pass, and all reports are right to the byte (17 buttons, 6 axes, `setState`, 20000
  reports in order, 3000 create/destroy cycles with no pad left behind).

2026-11-05, plan review, Architecture (decisions are in the items):

- Posted moves land late by little: median 0.1 ms, at most 18.3 ms over 150 moves with the CPU loaded at twice its core
  count (14.1 ms idle). So 100 ms has about 5x margin for a slower CI runner.
- The system-defined event of item 6 works off the main thread, so `keyDown` in a worker can use it.
- `CGCursorIsVisible` read 0 steadily, through at least 30 posted moves and addon moves, until a real hand moved the
  trackpad; then 1, and the kept design's `getIcon` was 0x0 until then, while the shipped build's gave a picture. The
  cause is unknown: hiding while typing is a guess, and typing during the check logged no return to 0.
- Costs, shipped / kept design, µs a call: `setPosition` 112-116 / 153-170, `moveBy` 134 / 167-179, `getPosition` 0.5 /
  0.3, `getIcon` 171-201 / 169-306, `getIconId` 142-180 / 157-186 (two runs each, noisy). `CGCursorIsVisible` 3.5,
  the display list with its bounds 20. The stress test 1.2 s; a stub build 10 s. At 1000 moves a second that is about
  15% of a core, up from 11%; accepted, and no display cache: the change callback needs a run loop, which plain Node
  does not run.
- CI's logs were not read: `gh` is not installed on this Mac. So the SDK CI compiles against is unknown; item 4 no longer
  needs it.

2026-11-07, phase 1 coded (1, and 2 without `CGCursorIsVisible`), on the Mac above; `dist/darwin-arm64` is a local build:

- The check of item 2 decided it: typing took `CGCursorIsVisible` to 0 at once, and through 7 s of `setPosition` in a
  circle it stayed 0, while the person at the Mac saw the pointer moving. A remote client would lose its cursor, so the
  call is out; only the alpha check is in.
- `npm test` from a fractional start, 5 of 5 runs: 65 pass, 24 skipped. `test:e2e` 20 pass, 1 skipped (the gamepad).
  `test:native` passes, with the new `point_clamp_test.cpp`; `test:types` passes. No build warnings in our sources.
- The new tests fail where they should, `mouse.test.js` on the addons before: the 0.13.0 build fails 4 (the original
  failing test, fractions, `moveBy`'s fraction, the other axis's fraction); the rejected read-back design fails the
  stress test.
- Reads under `InputStateLock`, one worker moving and one reading for 2.5 s, 3 runs: median 0.4 µs, p99 13-14 µs, p99.9
  about 80 µs. One 20 ms wait, always about 22 ms in: the first post setting itself up. Waits of 2-6 ms now and then; a
  reader with nothing else running has those too, and one of 40 ms. Four workers, 3000 calls each: no errors.
- Costs now, µs a call: `setPosition` 169, `moveBy` 143, `getPosition` 0.3, `getIcon` 182, `getIconId` 186.
- Not verified: a second display (the rule is, in `test:native`); `buttonDown`'s new error (needs a window server giving
  no event). CI cannot run the pointer tests.

2026-11-07, phase 2 done (6), on the same Mac; `dist/darwin-arm64` is a local build, not committed:

- The new test first failed on the build before ("the press flips it"), then passed: a press and a second one, the
  `VolumeMute` alias, `keyDown` then `releaseAll` flipping once, a press from a worker. The settings came back.
- By hand, one press of each from volume 0 and muted: `AudioVolumeUp` gives 6 and unmuted, `AudioVolumeDown` 0 and muted.
- Two mute presses gave a focused window no key events; a control key gave it its 2.
- `npm test` 65 pass, 25 skipped (the volume test without its variable), `test:e2e` 20 pass, 1 skipped, `test:native`,
  `test:types`. No build warnings in `keyboard.cpp`. The x64 build is left to CI.

2026-11-07, phase 3 done (0, 3, 4, 5), on the same Mac, none of it on a real device:

- `npm run test:gamepad-stub`: `gamepad.test.js` 14 pass, 5 skipped (they do not apply); `reports.test.js` 14 pass, 10
  whole runs of it in a row. Written first and run on the code as it was: the trigger's bit, the button and axis
  disagreeing, `setState`'s explicit pressed, and a failed report all failed, as they should.
- Run them apart: the processes each number their pads from 1, so two sharing a log read each other's lines.
- A run taking 601 s, past its test's 60 s timeout, was the Mac: idle sleep from 09:13:00 to a dark wake at 09:23:03. Not
  a deadlock in the new lock: the same test took 1.6 s 18 times over. Keep a Mac awake for these (`caffeinate`).
- The real build: no warnings in our sources, and the `catch`'s warning is gone. `create()` rejects as before, now saying
  macOS 15. `npm test` 65 pass, 25 skipped; `test:e2e` 20 pass, 1 skipped; `test:native`, `test:types`, the volume test.
  The x64 Swift typechecks here; its build is left to CI, which is also the first sight of CI's SDK.
- Never run: the e2e gamepad test's new macOS expectations (`mapping` `""`, `axes[4]`, the trigger's bit), which rest on
  reading Chromium; a real device's reports; macOS 15.

2026-11-07, phase 4 coded: `npm run test:mac`, the one attempt at Accessibility on the hosted runner, 0.14.0 and its
changelog.

- `npm run test:mac` on the same Mac: unit 66 pass, 24 skipped, with the volume test; e2e 20 pass, 1 skipped; the gamepad
  against the stand-in 14 and 14 pass; native passes. Its first run failed one test, "dist loaders carry the version
  banner", until `npm run build:js` gave the loaders 0.14.0's: a local `dist/`, which CI rebuilds.

2026-11-07, CI's run of `cf18553`, the branch's first: every job passed (Windows x64 and ARM64, macOS, the three
Linux ones; `update-dist` skipped, as on any push).

- macOS: `hasInputAccess true, getInputBlock null` after the Accessibility step, and `npm test` 65 pass, 25 skipped, as
  on the Mac: the pointer tests ran there, the fraction, clamp and stress tests among them. Not known: whether the step
  granted it or the runner image now has it anyway; keep the step until a run says otherwise.
- The Swift part built against CI's SDK with `activate` not awaited in a `try`, and the x64 cross build passed.
- `test:gamepad-stub` ran in CI.

## Items

| # | What | Kind | Phase |
|---|------|------|-------|
| 1 | `setPosition` drops fractions | bug | 1 |
| 2 | `getIcon`/`getIconId` do not report a pointer hidden by a transparent picture | bug | 1 |
| 6 | The volume keys do not control the volume | bug | 2 |
| 0 | A stand-in for CoreHID, to test the gamepad without an entitlement | test | 3 |
| 3 | Trigger buttons and axes disagree; the docs and e2e expect the browser's standard mapping | bug | 3 |
| 4 | `create()` cannot report a failed activation; report errors are dropped | bug | 3 |
| 5 | The gamepad's macOS 26 requirement is too strict | bug | 3 |

Not in this plan: a key held with `keyDown` does not repeat (1 keydown in 900 ms, and the README does not promise
it); layout switching and several displays (nothing to check them on here, see "Not verifiable" under each item).

---

## Phase 1: the pointer

### 1. `setPosition` drops fractions

`src/native/mouse.cpp`

`PostMove` posts the move, then warps there so that a read straight after is right (`mouse.cpp:251`). The warp
truncates to whole points, and it comes last, so `setPosition(300.3, 300.7)` stays at `(300, 300)`. On a 2x screen half
of the physical pixels cannot be reached, and a position read after a trackpad move cannot be set back, which is the
failing test. A posted event alone keeps the fraction, but reaches the pointer a moment later.

- Warp first, then post: the pointer moves at once, and the post brings the fraction.
- For 100 ms after a move (a named constant), reads return the move's target instead of asking the system, as the system still shows the
  whole point, or a move still on its way. One helper for this; both `GetPosition` and the click location in
  `buttonDown` (`mouse.cpp:913`) use it. A click must, or it moves the pointer back to the whole point.
- Clamp to the displays ourselves, in `PostMove`, for every caller. With the warp no longer last, nothing corrects a
  posted event off every screen, and reading the position back gives its raw `99999`.

```cpp
// the point itself when on a screen, else the nearest point of the nearest screen
static CGPoint ClampToDisplays(CGPoint point) {
    // for each of CGGetActiveDisplayList: CGRectContainsPoint(CGDisplayBounds(d), point) returns it as it is;
    // otherwise keep the closest of min(max(p, min), max - 1) on both axes
}

// in PostMove, clamped before the InputStateLock is taken; warp, these fields and the post all under it, so that
// the pair cannot interleave with another worker's
CGWarpMouseCursorPosition(target);
hasLastMove = true; lastMoveTarget = target; lastMoveTime = now;

// GetPosition and buttonDown; false when the system cannot tell, and both then throw
static bool CurrentPointer(CGPoint& pointer) {
    InputStateLock lock;
    if (hasLastMove && now - lastMoveTime < 100 ms) { pointer = lastMoveTarget; return true; }
    hasLastMove = false;
    // CGEventCreate(NULL): false when it gives NULL, else its location
}
```

- The fields are guarded by `InputStateLock`, no new lock. It is held for one event at a time (`Keyboard.type` does not
  hold it across a string), so a read usually waits for one post at most; measured under Progress.
- `buttonDown` throws when the position cannot be read. Today (`mouse.cpp:911-917`) it falls back to `CGPointZero`,
  which posts a real click at the top left of the screen, on the Apple menu. Not testable: it takes a window server that
  gives no event.

- `MoveBy`'s clamp to the union of the displays (`mouse.cpp:825`) goes, with `DisplaysBounds` if nothing else uses it:
  `PostMove` clamps, and to a real screen, not into a gap between screens.
- `ClampToDisplays`'s rule is pure code in a header of its own, taking the rectangles, as `screen_layout.h` is, and
  `test/native/` tests it on layouts no machine here has: side by side, a screen left of the primary (negative
  coordinates), stacked, of different heights with a gap, a point exactly on an edge.
- Tried and rejected, so that nobody tries them again:
  - Remembering what the warp gave and returning the target while the system still shows that: the moves still on
    their way land after a later warp and end it early.
  - Clearing the remembered target as soon as the system shows it: for a whole-point target the warp shows it at once,
    while an older move is still on its way.
  - Warping, then reading back to see where the system clamped to, and posting that: under load (the test files run
    in parallel) the read returns the old position, and the pointer is sent back there. 5 of 12 full suite runs failed
    (`setY moved y: 100 is not within 1.000001 of 140`); with `ClampToDisplays`, 0 of 20. The shipped code never had
    this: 12 of 12 clean. Run the suite repeatedly for this item: once proves nothing.

Behaviour changes, for the changelog: fractions are kept; off every screen `setPosition` ends at `1439`, as `moveBy`
does, not at the system's `1439.984`; reads for 100 ms after a move do not see the hand on the mouse, nor do they in
another process see the fraction yet; `buttonDown` throws when the position cannot be read, instead of clicking at the
top left of the screen.

Tests (`test/unit/mouse.test.js`):

- A fraction set is read back within 0.01, straight away and after 150 ms (`300.3, 300.7`, and `.25`, `.5`, `.75`).
- `setPosition` off each edge and corner stays on a screen, straight away and after 150 ms; the other axis keeps its
  fraction (`-500, 300.5` gives `0, 300.5`).
- `moveBy` keeps a fraction (`600.5` by 10 and back) and past an edge stays on a screen.
- e2e: a click after a fractional `setPosition` leaves the pointer on the fraction.
- A stress test: 4000 `setPosition` calls to far-apart whole points, each read straight back, within 1. Measured on
  scratch builds: the rejected read-back design gets 927 of 4000 wrong idle and 169 loaded; the kept design and the
  shipped build none. It replaces repeating the suite as the guard against this race.

Not verifiable here: the real warp on several displays. The rule is tested (`test/native/`); by hand with a second
display when one is at hand. Open, but it does not hold up the release.

### 2. `getIcon`/`getIconId` do not report a hidden pointer

`src/native/mouse.cpp`, `ReadCursor`

The README promises 0x0 and an id of 0 while the pointer is hidden, but macOS's branch (`mouse.cpp:529`) only gives up
when `currentSystemCursor` is nil, which it is not then: during `[NSCursor hide]` it returns the 56x80 arrow. With CSS
`cursor:none` the picture is a real cursor, 2x2 and fully transparent, with an id that is not 0.

- After reading it, return false when every pixel's alpha is 0. That covers `cursor:none`, and hiding by a transparent
  cursor generally. `getIconId` follows from `ReadCursor`.
- `CGCursorIsVisible` is not used, checked by hand: it stays 0 after typing, through posted moves, while the pointer can
  be seen moving. A remote session moves the pointer by posted moves only, so a client going by it would lose its
  cursor. So a real `[NSCursor hide]` stays unreported on macOS, and the README and the types say so. No test of it, as
  there is nothing to report.

Tests:

- e2e: over `cursor:none`, on macOS, `getIcon` is 0x0 with empty data and `getIconId` 0; the same shape as before gives
  the same id after. A cursor of one opaque pixel in an otherwise transparent picture does not count as hidden. Check
  on Windows whether it can run there too.

---

## Phase 2: the keyboard

### 6. The volume keys do not control the volume

`src/native/keyboard.cpp`

`AudioVolumeUp`, `AudioVolumeDown`, `AudioVolumeMute` and their `Volume*` aliases are sent as ordinary key events
(`kVK_VolumeUp`, `keyboard.cpp:276`). They reach the focused window as keys, and `isKeySupported` says true, but
`output muted` does not change. They change the volume on Windows and Linux, and a remote session needs them to here.
macOS takes these keys as system-defined events:

```swift
NSEvent.otherEvent(with: .systemDefined, location: .zero,
    modifierFlags: NSEvent.ModifierFlags(rawValue: down ? 0xa00 : 0xb00),
    timestamp: 0, windowNumber: 0, context: nil, subtype: 8,
    data1: (key << 16) | ((down ? 0xa : 0xb) << 8), data2: -1)!.cgEvent!.post(tap: .cghidEventTap)
```

In the Objective-C++ use the SDK's names, not these numbers: `NX_KEYTYPE_SOUND_UP`, `NX_KEYTYPE_SOUND_DOWN`,
`NX_KEYTYPE_MUTE` (`IOKit/hidsystem/ev_keymap.h`), `NX_SUBTYPE_AUX_CONTROL_BUTTONS`, `NX_KEYDOWN`, `NX_KEYUP`
(`IOLLEvent.h`). A nil event returns false, as `PostKey` does for a key event it cannot make.

- In `PostKey` (`keyboard.cpp:595`), a branch on these three key codes, which the `Volume*` aliases share, posts this instead, in
  Objective-C++ as `mouse.cpp` already is. Held keys stay in the same bookkeeping, so `releaseAll` releases them.
- A window no longer sees them as keys, as it does not for the real ones. The README says nothing on this now: add it.

Tests:

- `test/unit/keyboard.test.js`, only with `EASYCONTROL_VOLUME_TEST=1`, as it changes a setting of the machine: reads
  `osascript -e 'get volume settings'`, presses `AudioVolumeMute`, sees `output muted` flip, and puts it back in a
  `finally`. With the volume at 0 it is silent; the test sets 0 first and restores it after. It prints the original
  settings first, so that a test killed halfway can be undone by hand, and skips where the output has no software
  volume (`output muted:missing value`). Also: `keyDown` then `releaseAll` flips it once, and it works from a worker.
- By hand: `AudioVolumeUp` and `AudioVolumeDown` move the volume. They can be audible, so no test does.
- Press only the mute key in any test: an earlier run pressed the `Volume*` aliases by accident, past a skip list
  written for `Audio*`.

---

## Phase 3: the gamepad, without a device

### 0. A stand-in for CoreHID

New: `test/gamepad-stub/` (`corehid-stub.swift`, `run.js`, `reports.test.js`), `npm run test:gamepad-stub`, a macOS step
in `build.yml`.

No machine here or in CI can make a real pad, so the 8 unit tests and the e2e test that need one have never run on
macOS, and items 3 and 4 could not be checked at all.

- `run.js` copies `src/`, `test/`, `binding.gyp`, `index.js` and `package.json` to a temporary directory, links
  `node_modules`, replaces `import CoreHID` in the copy of `GamepadImplement.swift` with the stub, builds there with
  `node index.js`, and runs the tests there. Nothing in `src/` changes for the tests, and `dist/` is not touched.
- The stub has the SDK's names and shapes (`HIDVirtualDevice`, `Properties`, `HIDVirtualDeviceDelegate`,
  `HIDReportType`, `HIDReportID`): `HIDVirtualDevice` an `actor`, `activate(delegate:)` not throwing, as they are there.
  It writes `new`, `active`, `report <serial> <hex>` and `gone` lines to the file in `EC_STUB_LOG`.
  `EC_STUB_MODE` chooses a failure: `nil` (no device), `hang` (activation), `report-fails:N` (item 4: the first N
  reports fail, each logged as `report-failed`). No failure of `activate`: the real one has none.
- It runs `test/unit/gamepad.test.js` as it is, then `reports.test.js`: the descriptor parses to 13 bytes with the
  usages expected; every button sets its bit alone; each axis lands in its field; `setState` is one report, keeps what
  is null, and sends nothing on an error; 20000 reports arrive in order; pads stay apart; `destroy` lets the device go;
  each failure mode gives its message.

What this cannot catch: the stub agreeing with us and not with Apple. The real signatures stay checked by the normal
build, against the SDK.

### 3. Trigger buttons and axes disagree; the docs and e2e expect the standard mapping

`src/native/GamepadImplement.swift`, `src/native/gamepad.cpp`, `test/e2e/main.cjs`, `README.md`

Chromium's source (main; Electron 44's own version not read) gives a pad with no mapping `GamepadMapping::kNone`, and
`0x1209:0x0001` is in neither its ID list nor its macOS mapping table. In such a pad usages `0x30-0x35` are `axes[0-5]`,
and `buttons[i].value` is only ever 0 or 1, from the button's own bit: an axis feeds no button. So in a browser on
macOS:

- `mapping` is not `"standard"`, which `main.cjs:774` asserts, and the comment on `reportDescriptor` is wrong in saying
  browsers fall back to that layout: they use the order, not the mapping.
- `main.cjs:800-809` expects `buttons[6].value` to follow axis 4, and it will not.
- `setAxis(4, 1)` leaves button 6 unpressed, and `buttonDown(6)` then `setAxis(4, -1)` leaves it pressed (both seen in
  the reports). The README says axes 4 and 5 "drive the same triggers".

Changes:

- One Swift function, `setTrigger(index, value, isPressed)`, sets a trigger's analog value and bit together, and every
  path goes through it. `buttonDown`/`buttonUp` on 6 and 7 pass 255 or 0. `setAxis` on 4 and 5 passes pressed when the
  trigger is at 128 of 255 or more, the 0.5 that `ParseButtons` uses for a number. `(value + 32768) / 256`, written twice
  today, goes into it.
- `SetState`'s button path (`gamepad.cpp:844-852`) makes one bridge call, `setTrigger`, in place of two: the explicit
  `isPressed`, so `{ pressed: true, value: 0.25 }` stays pressed. Axes in the same `setState` come after and win, as the
  README says.
- Keep the IDs. Taking another device's IDs to get a mapping is what the comment there already rejects, and could not
  be checked here.
- e2e, on macOS: expects `mapping` to be `""`, `buttons[6].pressed` and `axes[4]` to follow the trigger; elsewhere as it
  is. The README's macOS note says all this: analog triggers are `axes[4]` and `axes[5]`, `buttons[6].value` is 0 or 1.
- The comment on `reportDescriptor` says what is true.

Tests: `reports.test.js` for each case above, and that `setState({ buttons: [..., { pressed: true, value: 0.25 }] })`
gives the bit and 64.

Not verifiable, and left as it is: the report queue has no limit, and only a real device shows how fast it drains.
Heavy `setAxis` use on a slow device would lag and grow; the README already advises one `setState` per frame. Limiting
it could drop a release and leave a button stuck.

Not verifiable: a browser really showing this. It rests on reading Chromium's source, and its device blocklist was not
read. The e2e test stays skipped here.

### 4. `create()` cannot report a failed activation; report errors are dropped

`src/native/GamepadImplement.swift`, `src/native/gamepad.cpp`, `CHANGELOG.md`, `README.md`

In the SDK `activate(delegate:)` neither throws nor returns anything, and the `catch` is unreachable
(`GamepadImplement.swift:239-240`, a compiler warning in every macOS build). So `-2` can never happen, and `-3` hardly:
0.13.0's "created means activated" means only that the call returned. And `try?` drops every `dispatchInputReport`
error, so `buttonDown` reports success for a report that failed, and "Failed to update gamepad state" never happens.

- Remove the `do`/`catch`, the `-2` path in `OpenPad` (`gamepad.cpp:288-294`) and in the bridge's comment, and the
  regex's "activating it failed" (`gamepad.test.js`). If CI's SDK still throws, its build fails and says so: then a
  `try`, with a comment.
- Keep the 5 s wait: awaiting an actor can still not come back.
- A report that fails sets a flag, the next that succeeds clears it. `sendReport` always queues its report first, then
  returns false if the flag is set: the call after a failure throws "Failed to update gamepad state", and that report
  still goes, so the pad recovers by itself. `setState` is covered, as `endUpdate` goes through `sendReport`.
- The pump task writes the flag and the JS thread reads it, and `SwiftCode.lock` does not cover the pump: a small lock of
  its own, per device.
- Docs: `create()` resolving means the system took the device. Fix the changelog's wording in the next entry, not the
  old one.
- Rejected: checking the device through `HIDDeviceClient(deviceReference:)` after the activation. If it returned nil on
  a healthy pad, every `create()` would fail, and nothing here could tell.

Tests: `report-fails:N` in `reports.test.js`. After waiting for each `report-failed` line, as failures come
asynchronously: `buttonDown`, `setAxis` and `setState` each throw, then calls work again once reports do.

Decided (2026-11-05): a failed report throws, so that a failure is visible rather than silent.

Not verifiable: whether a real device's first reports can fail just after the activation. If so, an app sees an
exception for a report that used to be lost without a word; that is accepted. The changelog lists it under behaviour
changes.

### 5. The gamepad's macOS 26 requirement is too strict

`src/native/GamepadImplement.swift`, `src/native/gamepad.cpp`, `README.md`, `test/unit/gamepad.test.js`

The SDK marks `HIDVirtualDevice`, its `Properties` and its delegate `@available(macOS 15, *)`; only the
`hidDevice` property, which is not used, is 26. The addon checks for 26, with no reason in its history (5cf1e8f only
added the `@available` the compiler asked for), and README, message and tests all say 26.

Decided (2026-11-05): lower it to 15.

- Everywhere: `@available`, `#available`, the message in `OpenPad`, the comments, the README (`README.md:195`,
  `README.md:464`), and in `gamepad.test.js` Darwin `< 25` to `< 24` (line 58) with the two `/macOS 26/` regexes after
  it.
- What goes wrong on 15 should be a rejected `create()` at worst: `-weak_framework CoreHID` keeps the addon loading.

Not verifiable: neither version on a real device, and macOS 15 not at all here.

---

## Phase 4: release

- One commit per phase, so that any can be reverted alone: phase 3 has not run on a real device.
- CI builds every target; the `update-dist` run updates `dist/`.
- New: `npm run test:mac`, every suite that needs real input on a Mac: `npm test`, `test:e2e`, and with its variable the
  volume test. Run it on a Mac before each release, and record the result here: the hosted runner has no
  Accessibility and does not run e2e, so nothing else runs these.
- One time-boxed attempt to grant Accessibility on the hosted runner, through its permissions database, in the CI job
  only. If it works, these tests run on every push; if not, or if an image update breaks it, drop it and keep `test:mac`.
- `test:types`, `test:native`, `test:gamepad-stub`.
- `package.json` to 0.14.0, `CHANGELOG.md`, and this plan to `dev/plans/done/`.
