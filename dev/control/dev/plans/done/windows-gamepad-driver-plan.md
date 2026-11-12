# Plan: own virtual gamepad driver for Windows

Status: done, 2026-10-06. Implemented and tested on Windows 11 (x64, Secure Boot); the ARM64 build
(`dist/win32-arm64/`) is cross-compiled and checked, but not yet run on ARM64 hardware. Replaces the ViGEmBus
backend of `Gamepad` on Windows. What remains of phase 4 is a release.

## As built

The design below held. Where the implementation differs from it:

- **Installer** is a PowerShell script (`src/native/windows-gamepad/setup/easy-control-gamepad-setup.ps1`), not an
  exe: `New-SelfSignedCertificate`, `Set-AuthenticodeSignature`, `pnputil` and `New-Service` do every step, and a
  script that runs elevated is easier to audit. It copies the driver and the service to Program Files before
  signing, so a LocalSystem service never runs from a user-writable `node_modules`.
- **Two INFs** with one DLL: the HID device must be `HIDClass`, and the XUSB device must be class `System` with
  Microsoft's `xinputhid` as upper filter and a `VID_045E&PID_028E&XI_00` hardware ID. Windows.Gaming.Input takes
  a device for an Xbox pad only then.
- **State channel to the HID device** is a feature report on a vendor-defined collection, not a custom IOCTL:
  hidclass sits at the top of a HID stack, so an IOCTL from an application never reaches a UMDF HID minidriver.
  The XUSB device takes `EASYCONTROL_IOCTL_SET_STATE` directly. The addon sends each change to both.
- **Windows.Gaming.Input** (which Chromium uses for Xbox pads) needed more than XInput: protocol 1.3, a pending
  input request (`0x8000E3AC`) answered on change and every 50 ms, and two more requests. The layouts follow
  [HIDMaestro](https://github.com/hifihedgehog/HIDMaestro) (MIT), credited in `driver.c`.
- **Minimum** Windows 10 1903 (10.0.18362): the `.Filters` INF section needs it (InfVerif).
- **Build** needs only Visual Studio's C++ tools: `npm run build:gamepad` takes the UMDF headers and stub library,
  InfVerif and Inf2Cat from Microsoft's WDK NuGet package (into `build_wdk/`).

- **ARM64**: `npm run build -- --arch arm64` and `npm run build:gamepad` cross-compile on x64 (Visual Studio's
  "MSVC ARM64 build tools"; the UMDF library comes from the ARM64 WDK NuGet package).

Verified: install and upgrade with one UAC prompt each; uninstall leaves nothing behind (`npm run test:driver`); `XInputGetState` and WGI `Gamepad` readings; Chromium
`navigator.getGamepads()` with the `standard` mapping for all 17 buttons and 6 axes (`npm run test:e2e`); several
pads at once; a killed process's pads gone within 1 s.

## Why

Windows has no API that lets a desktop process plug in a gamepad that games see:

- **ViGEmBus**, today's backend, was retired and archived in November 2023. It still loads but will get no fixes,
  and it is a separate download users must find and install (`Gamepad.create()` throws
  `ViGEmBus driver is not installed`).
- **`InputInjector.InjectGamepadInput`** (WinRT) needs the `inputInjectionBrokered` restricted capability, which only
  packaged (MSIX) apps can declare, and only reaches Windows.Gaming.Input. It is not visible to XInput, DirectInput or
  browsers.
- **Virtual HID Framework (VHF)** is the documented way to make a virtual HID device, but it is *kernel mode only*.

So easy-control has to ship its own driver, and the JS side has to be able to offer to install it.

## Goals

1. `Gamepad.create()` on Windows works without any third-party driver.
2. The virtual gamepad is visible to **XInput** (most PC games), **DirectInput/Raw Input**, **Windows.Gaming.Input /
   GameInput**, **SDL**, and the **browser Gamepad API** with the `standard` mapping. Each consumer must see **one**
   controller, not a duplicate.
3. Installing it is one call from JS (`Gamepad.installDriver()`), with one UAC prompt. No test-signing mode, no reboot,
   no paid certificate needed to start.
4. After install, a **non-elevated** process can create and destroy gamepads. A crashed process does not leave a
   gamepad plugged in.
5. The JS API stays as it is: `create`, `list`, `isActive`, `buttonDown/Up`, `setAxis`, `destroy`, with the W3C
   Standard Gamepad indices.

Out of scope for v1: force feedback / rumble back to JS, impersonating DualShock/DualSense, anti-cheat evasion
(kernel anti-cheat can and may detect virtual devices; that is fine).

## Options considered

| Option | Kernel code | Signing needed | XInput | Verdict |
|---|---|---|---|---|
| Keep ViGEmBus | no (3rd party) | none for us | yes | Retired; separate install; no future |
| KMDF virtual USB bus emulating an Xbox 360 pad (the ViGEm design; xusb22.sys binds to it) | **yes** | EV certificate + Partner Center attestation signing (Windows 10 1607+ loads no new kernel driver not signed by Microsoft) | yes, natively | Most compatible, but costs money every year, a kernel driver to keep safe (and HVCI-compatible), and a Microsoft submission for every release |
| KMDF + VHF HID source driver | **yes** | same as above | no (HID only) | Kernel cost without XInput |
| **UMDF2 HID minidriver + user-mode XUSB interface** | **no** | Catalog signature trusted on the machine. UMDF needs no Microsoft signature, so a certificate made locally at install time works | yes, via a companion device registering the XUSB interface | **Chosen** |

The chosen design is the one [HIDMaestro](https://github.com/hifihedgehog/HIDMaestro) (MIT) shows working on stock
Windows 10/11 x64 and ARM64 with Secure Boot on: "Pure user-mode UMDF2, loaded by a locally trusted self-signed
certificate", "no test-signing boot mode", and XInput "from a companion device that registers the XUSB interface".
It is the proof that the approach works. We write our own, smaller driver with HIDMaestro as a reference, and keep it
as a fallback dependency if our spike fails.

## Architecture

```
 node process (non-admin)                 easy-control-gamepad service (LocalSystem)
 ┌──────────────────────────┐  named pipe  ┌───────────────────────────────────────┐
 │ easy-control.node        │─────────────▶│ create / destroy on request           │
 │  Gamepad.create()        │  "create"    │ SwDeviceCreate(...)  ── one per pad   │
 │  gamepad.buttonDown(0)   │◀─────────────│ holds HSWDEVICE; pipe closed (client  │
 │                          │  device path │ exit or crash) → SwDeviceClose        │
 └───────────┬──────────────┘              └───────────────────────────────────────┘
             │ CreateFile(device interface) + DeviceIoControl(SET_STATE)
             ▼
 ┌───────────────────────────────────────────────────────────────────────────────┐
 │ SWD\EasyControl\Pad_N   UMDF2 driver easycontrol_gamepad.dll (WUDFHost.exe)   │
 │  ├─ HID minidriver under mshidumdf.sys → HID gamepad collection               │
 │  │     → DirectInput, Raw Input, WGI/GameInput, SDL, Chromium (non-XInput)    │
 │  └─ companion: registers GUID_DEVINTERFACE_XUSB, answers XInput's IOCTLs      │
 │        → XInput (XInputGetState etc.), Chromium on Windows                    │
 └───────────────────────────────────────────────────────────────────────────────┘
```

### 1. The driver: `easycontrol_gamepad.dll` (UMDF2)

Start from Microsoft's
[vhidmini2](https://github.com/microsoft/Windows-driver-samples/tree/main/hid/vhidmini2) UMDF2 sample: a HID
minidriver installed as a lower filter under `mshidumdf.sys`, with `MsHidUmdf.inf` as a dependency.

- **HID personality.** A HID report descriptor for a gamepad with 4 int16 stick axes (X, Y, Rx, Ry), 2 separate
  8-bit triggers (Z, Rz), a hat switch for the D-pad, and 11 buttons (A, B, X, Y, LB, RB, Back, Start, LS, RS,
  Guide). One input report holds the whole state.
- **XUSB personality.** A second device (hardware ID `EasyControl\XusbPad`) served by the same DLL registers the
  device interface `GUID_DEVINTERFACE_XUSB` `{EC87F1E3-C13B-4100-B5F7-8B84D54260CB}`. That interface is how
  `XInput1_4.dll` finds controllers. The driver answers XInput's IOCTLs (get information, capabilities, state, set
  state/vibration, battery, LED). These IOCTLs are undocumented. Their codes and buffer layouts come from the
  source of [OpenXInput](https://github.com/Nemirtingas/OpenXInput), a reverse-engineered re-implementation of the
  XInput library, and must be checked against `XInput1_4.dll` on Windows 10 and 11 in the spike.
- **One controller, not two.** The HID device of an XInput pad is enumerated with an `&IG_00` part in its device
  path, as Microsoft's "XINPUT compatible HID device" is. Chromium and SDL skip HID devices with `IG_` and use XInput
  for them. Both devices share one `ContainerId`, so WGI/GameInput merge them. This is the duplicate-device problem
  [DsHidMini](https://github.com/nefarius/DsHidMini/discussions/106) ran into with `xinputhid.sys`, and that
  HIDMaestro solves this way. It is validated in phase 2.
- **State input.** A custom device interface (`GUID_DEVINTERFACE_EASYCONTROL_PAD`, new GUID) with one IOCTL,
  `IOCTL_EASYCONTROL_SET_STATE`, taking the whole state struct (below). The driver keeps the last state, completes
  the pending HID read with a new input report, and answers XInput's get-state from the same struct. The interface's
  security descriptor (INF `Security=` or `DEVPKEY_Device_Security` at creation) lets interactive users open it, so
  the node process needs no elevation to feed it.
- Shared state struct (versioned, also the pipe/IOCTL ABI):

  ```c
  typedef struct {
      UINT32 version;          // EASYCONTROL_PAD_STATE_VERSION
      UINT32 buttons;          // bit i = W3C standard button i (0-16), triggers 6/7 excluded
      INT16  axes[4];          // W3C axes 0-3, -32768..32767, +Y down (as W3C)
      UINT8  triggers[2];      // W3C axes 4-5 mapped 0..255 (or buttons 6/7 → 0/255)
  } EASYCONTROL_PAD_STATE;
  ```

  The driver converts it to XUSB (Y up, `wButtons` bits) and to the HID report. The W3C→XUSB table already in
  `src/native/gamepad.cpp` (`XUSB_GAMEPAD_*`, inverted Y, trigger scaling) moves into the driver.

### 2. The broker: `easy-control-gamepad` service

`SwDeviceCreate` needs administrator rights, and UMDF drivers cannot be bus drivers that create their own children,
so a non-admin process cannot plug in a device on its own. A small Windows service does it:

- Runs as LocalSystem, start type *demand*. The addon starts it through the SCM; the service's DACL lets
  interactive users start it. It stops itself when idle for 60 s.
- Listens on `\\.\pipe\easy-control-gamepad`, with a DACL for interactive users. Messages: `create` → the device
  instance ID and interface path; `destroy <id>`.
- Per pad it calls `SwDeviceCreate` under one grouping node (`SWD\EasyControl`, as the API docs recommend instead of
  many root children): the HID device, plus the XUSB companion for the Xbox persona.
- Keeps each `HSWDEVICE` per pipe connection. When the client disconnects (`destroy`, process exit or crash), it
  calls `SwDeviceClose`, and PnP removes the device. This is goal 4.
- Caps at 4 XInput pads (XInput has 4 slots); `create()` beyond that throws `No free slot for another virtual
  controller`, as ViGEm does today.

### 3. The installer: `easy-control-driver.exe`

One native exe, run elevated, shipped in `dist/win32-x64/driver/` (and `win32-arm64`):

- `install`:
  1. Creates a per-machine self-signed code-signing certificate (EKU code signing only, not a CA,
     subject `CN=easy-control local driver signer <machine guid>`). It signs `easycontrol_gamepad.cat` with
     `SignerSignEx2` (mssign32.dll, present on every Windows; signtool is not). The catalog itself is made at build
     time by `inf2cat`.
  2. Adds the certificate to `LocalMachine\Root` and `LocalMachine\TrustedPublisher`, then **deletes the private
     key**, so the certificate can never sign anything else.
  3. Installs the driver package (`DiInstallDriverW` / `pnputil /add-driver ... /install`).
  4. Installs the broker service (`CreateService`) with its DACLs.
  5. Writes the installed version to `HKLM\SOFTWARE\easy-control\Gamepad`.
- `uninstall`: removes all pads, the service, the driver package (`pnputil /delete-driver oemNN.inf /uninstall`),
  and the certificate from both stores.
- `status`: prints JSON (installed version, service state); the addon can also read the registry itself.

Upgrade = `install` over an older version: the same steps with a new certificate, then the old certificate is
removed.

**Later, optional: attestation-signed package.** With an EV certificate and a Partner Center account, the same
package can be attestation-signed by Microsoft. Then step 1-2 (touching the Root store) go away. The code path stays
the same; only the shipped `.cat` changes. Decide after v1 based on user feedback about the root-store step.

### 4. The addon and JS API

`src/native/gamepad.cpp` (Windows branch) drops ViGEm and talks to the service and the driver:

- `Gamepad.create()`: ensure the service is running, then `create` over the pipe. Open the returned interface path
  and keep the pipe and the device handle in the `Gamepad` object. Throws errors that say why, with `error.code`:
  - `EASYCONTROL_DRIVER_MISSING`: not installed (the app can offer `installDriver()`)
  - `EASYCONTROL_DRIVER_OUTDATED`: older than the addon's ABI `version`
  - `EASYCONTROL_NO_SLOT`: 4 XInput pads already plugged in
- `buttonDown/Up`, `setAxis`: update the cached `EASYCONTROL_PAD_STATE` and send it with `DeviceIoControl`, as today
  `vigem_target_x360_update` sends the whole `XUSB_REPORT`.
- `destroy()`: `destroy` over the pipe, then close both handles. The `Release()` / per-environment list logic stays.

New, Windows only (other platforms: resolve `{ installed: true }` / no-op, so callers need no platform checks):

```js
Gamepad.getDriverStatus();   // { installed: boolean, version: string|null, required: string, isOutdated: boolean }
await Gamepad.installDriver();    // runs easy-control-driver.exe install elevated (one UAC prompt), resolves when done,
                                  // rejects with code EASYCONTROL_INSTALL_CANCELLED if the user declines UAC
await Gamepad.uninstallDriver();
```

`installDriver` uses `ShellExecuteExW` with the `runas` verb on the bundled exe, from an async worker, so Node does
not block while UAC is up. The exe path is found next to the `.node` (as `ViGEmClient.dll` is found today), which
also works in Electron apps that unpack native modules from asar.

The usage flow for an app (desktop-streamer):

```js
try {
    pad = Gamepad.create();
} catch (error) {
    if (error.code === "EASYCONTROL_DRIVER_MISSING" && await askUser("Install the virtual gamepad driver?")) {
        await Gamepad.installDriver();
        pad = Gamepad.create();
    }
}
```

## Repository layout

```
src/native/windows-gamepad/
    driver/        easycontrol_gamepad.vcxproj, .inf, Driver.c, Hid.c, Xusb.c, descriptor.h
    service/       easy-control-gamepad-service.vcxproj, Service.cpp
    installer/     easy-control-driver.vcxproj, Install.cpp, Sign.cpp
    common/        pad_state.h (the shared ABI), guids.h, ioctl.h
dist/win32-x64/driver/     easycontrol_gamepad.{inf,cat,dll}, easy-control-gamepad-service.exe, easy-control-driver.exe
dist/win32-arm64/...       the same for ARM64
```

- These are built with MSBuild + the WDK (UMDF2 needs it; node-gyp cannot build drivers). A new script,
  `npm run build:driver`, runs MSBuild for x64 and ARM64, `inf2cat`, and copies into `dist/`. As with the `.node`
  files, the build outputs are committed, so a normal `npm run build` does not need the WDK.
- `binding.gyp`: Windows drops `ViGEmClient.lib` and links `cfgmgr32`/`advapi32` only (the addon needs no
  `swdevice`, the service does).
- Removed: `src/native/inc/ViGEm/`, `dist/win32-x64/ViGEmClient.*`, and the unused 27 MB
  `src/native/vjoy_driver/`. README: the ViGEmBus note becomes the install section.
- Licensing: the driver, service and installer are our code under the package's LGPL-3.0-only. If any HIDMaestro
  code is reused, keep its MIT notice next to it, as `ViGEmClient.LICENSE` is kept today.

## Phases

### Phase 0 — spike: does the trust chain work? (go/no-go, ~2 days)

On a clean Windows 11 VM with Secure Boot on and **no** test signing, and on Windows 10 22H2:

1. Build vhidmini2 UMDF2 unchanged.
2. Self-signed certificate → Root + TrustedPublisher, sign the `.cat` with `SignerSignEx2`, delete the key, install.
3. Plug it in with `SwDeviceCreate` from an elevated test exe; close the handle; check that the device is gone.
4. Check: it loads without the "unsigned driver" dialog, works with HVCI / Memory Integrity on, and how Smart App
   Control and Defender react.

No-go → fall back to depending on HIDMaestro's driver, or to the KMDF + attestation route (needs budget for the EV
certificate).

### Phase 1 — HID gamepad (~1 week)

Driver with the gamepad HID descriptor and the state IOCTL; the service; the installer; the addon client. Pass when
`joy.cpl`, Raw Input, WGI `RawGameController` and Chromium's `navigator.getGamepads()` all see the pad, and all 17
buttons and 6 axes move there.

### Phase 2 — XInput (~1 week)

XUSB companion device and `IG_` HID path. Pass when:
- `XInputGetState` returns the state for every button and axis, and slots 0-3 fill up and free up as pads come and go.
- Chromium shows **one** pad with `mapping === "standard"` (the e2e test in `test/e2e/main.cjs` already checks every
  button, stick and trigger through it).
- WGI shows one `Gamepad` (not also a `RawGameController`), and SDL3 / Steam see one Xbox 360 controller.
- One real game each through XInput and through SDL behaves.

### Phase 3 — JS install API, tests, CI (~3 days)

- `getDriverStatus` / `installDriver` / `uninstallDriver`, error codes, README.
- `test/unit/gamepad.test.js`: the existing lifecycle tests run as they are once the driver is installed. Add a test
  that `create()` throws with `code === "EASYCONTROL_DRIVER_MISSING"` when it is not.
- `test/e2e`: the existing gamepad test; add an XInput check (a small `XInputGetState` call through a test-only export
  of the addon, or a tiny helper exe).
- CI: GitHub's `windows-latest` runners have admin rights. A job builds the driver, runs `easy-control-driver.exe
  install`, runs `npm test` and `npm run test:e2e` (headed session), then `uninstall`.
- Crash test: kill -9 the node process with 2 pads plugged in → both disappear within 1 s.

### Phase 4 — release (~2 days)

ARM64 build, remove ViGEm, version bump (breaking on Windows: new driver), migration note: "ViGEmBus is no longer
used; run `Gamepad.installDriver()` once".

### Later

- Rumble: the XUSB set-state IOCTL and HID output reports reach the driver. Forward them to JS as
  `gamepad.on("vibration", ({ weak, strong }) => ...)` so a streamer can send them to the remote browser
  (`GamepadHapticActuator`).
- Attestation-signed package (see installer).
- More personas (DualShock 4 / DualSense HID descriptors) if a game needs them.

## Risks

| Risk | Mitigation |
|---|---|
| Adding a certificate to `LocalMachine\Root` worries users or security tools | Per-machine certificate with code-signing EKU only, private key deleted right after signing, removed on uninstall, explained in the UAC/installer text. Later: attestation signing removes the step |
| Smart App Control / WDAC policies block a locally signed driver | Detect at install, report clearly; enterprise users need attestation signing or an allow rule |
| XInput IOCTLs are undocumented and may change | Pin to `XInput1_4.dll` behaviour on Windows 10 22H2 and 11 24H2+, test in CI on each; HIDMaestro and OpenXInput track the same interface |
| Duplicate controllers (HID + XInput) in some API | `IG_` path + shared `ContainerId`; phase 2 checks each API explicitly |
| Microsoft's VID/PID (045E:028E) for the Xbox persona | ViGEm did the same for years; it is what makes games treat it as an Xbox 360 pad. Alternative: a free open-source PID under VID 0x1209 ([pid.codes](https://pid.codes)) for the HID side, as XInput does not look at VID/PID |
| Service attack surface (LocalSystem, pipe) | The pipe only accepts `create`/`destroy` with no arguments from the client; strict DACL; a fuzz test on the pipe parser |
| Kernel anti-cheat flags virtual pads | Accepted, out of scope (same with ViGEm) |

## Decisions needed from the maintainer

1. Accept the local-trust installer for v1 (no cost), or budget an EV certificate + Partner Center for attestation
   signing from the start?
2. Xbox persona VID/PID: Microsoft's 045E:028E (maximum compatibility) or our own under pid.codes?
3. Keep ViGEmBus as a fallback backend for one release (used if installed and our driver is not), or drop it at once?
4. Own driver (this plan) or depend on HIDMaestro's driver and only write the addon client? The latter is faster but
   ties Windows gamepad support to another single-maintainer project, as ViGEm did.

## References

- Microsoft: [Virtual HID Framework (kernel mode only)](https://learn.microsoft.com/en-us/windows-hardware/drivers/hid/virtual-hid-framework--vhf-),
  [vhidmini2 UMDF2 sample](https://github.com/microsoft/Windows-driver-samples/tree/main/hid/vhidmini2),
  [Creating UMDF HID minidrivers](https://learn.microsoft.com/en-us/windows-hardware/drivers/wdf/creating-umdf-hid-minidrivers),
  [Driver signing policy](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/kernel-mode-code-signing-policy--windows-vista-and-later-),
  [Driver signing options / attestation](https://learn.microsoft.com/en-us/windows-hardware/drivers/dashboard/driver-signing-offerings),
  [SwDeviceCreate](https://learn.microsoft.com/en-us/windows/win32/api/swdevice/nf-swdevice-swdevicecreate),
  [InputInjector.InjectGamepadInput](https://learn.microsoft.com/en-us/uwp/api/windows.ui.input.preview.injection.inputinjector.injectgamepadinput)
- [ViGEm end-of-life statement](https://docs.nefarius.at/projects/ViGEm/End-of-Life/)
- [HIDMaestro](https://github.com/hifihedgehog/HIDMaestro): user-mode UMDF2 virtual controllers with XInput, MIT
- [DsHidMini](https://github.com/nefarius/DsHidMini) and its
  [XInput compatibility notes](https://github.com/nefarius/DsHidMini/discussions/106)
- [OpenXInput](https://github.com/Nemirtingas/OpenXInput): a reverse-engineered re-implementation of the XInput
  library; its source shows the device IOCTLs XInput sends
