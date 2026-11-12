// Type definitions for easy-control. src/build.js copies them to
// dist/easy-control.d.cts (require) and dist/easy-control.d.mts (import, which
// also has the default export).

/**
 * The `code` of the Errors easy-control throws or rejects with, beside the
 * TypeErrors and RangeErrors of wrong arguments.
 */
export type ErrorCode =
    /** No build for this platform and CPU, or it did not load: see `Platform.loadError`. */
    | "EASYCONTROL_UNSUPPORTED_PLATFORM"
    /**
     * Windows: the input was not taken (`SendInput` sent nothing, the pointer could not be read or
     * set): the secure desktop (a UAC prompt, the lock screen) is likely showing. See `Platform.getInputBlock()`.
     */
    | "EASYCONTROL_INPUT_BLOCKED"
    /** Windows: the gamepad driver is not installed; `Gamepad.installDriver()` installs it. */
    | "EASYCONTROL_DRIVER_MISSING"
    /** Windows: the installed gamepad driver is older than this version needs; `Gamepad.installDriver()` updates it. */
    | "EASYCONTROL_DRIVER_OUTDATED"
    /**
     * Windows: a newer driver is installed than the one still running (devices or the service from
     * before an update); destroy every gamepad and try again in a minute, or run `Gamepad.installDriver()`.
     */
    | "EASYCONTROL_DRIVER_RESTART_NEEDED"
    /** Windows: 4 virtual gamepads are plugged in already (XInput's limit). */
    | "EASYCONTROL_NO_SLOT"
    /** Windows: the gamepad service could not be started or did not answer. */
    | "EASYCONTROL_SERVICE_FAILED"
    /** The virtual gamepad could not be made; the message says why. */
    | "EASYCONTROL_CREATE_FAILED"
    /** Windows: the driver files are missing beside the addon (not unpacked from an asar archive?). */
    | "EASYCONTROL_SETUP_MISSING"
    /** Windows: the user declined the UAC prompt of the driver setup. */
    | "EASYCONTROL_SETUP_CANCELLED"
    /** Windows: the driver setup failed; its log is %ProgramData%\easy-control\gamepad-setup.log. */
    | "EASYCONTROL_SETUP_FAILED";

/** An Error with one of easy-control's codes. */
export interface EasyControlError extends Error {
    code: ErrorCode;
}

/** A mouse button. */
export type MouseButton = "left" | "middle" | "right" | "back" | "forward";

/** The pointer's position, in the coordinates of `Screen.list()`. */
export interface MousePosition {
    x: number;
    y: number;
}

/** The pointer's picture. */
export interface MouseIcon {
    /** In physical pixels; 0 while the pointer is hidden. */
    width: number;
    /** In physical pixels; 0 while the pointer is hidden. */
    height: number;
    /**
     * RGBA, 8 bits per channel, rows from the top, straight (not premultiplied) alpha;
     * `width * height * 4` bytes, empty while the pointer is hidden.
     */
    data: Uint8Array;
    /** The hot spot (the pixel that points), from the left, in physical pixels. */
    xOffset: number;
    /** The hot spot (the pixel that points), from the top, in physical pixels. */
    yOffset: number;
}

/**
 * The mouse. Coordinates are logical: on a 125% display, physical pixels divided by 1.25
 * (see the README); `getX`/`getY`, `setX`/`setY`/`setPosition` and `Screen.list()` share them.
 */
export interface Mouse {
    /** Throws when the position cannot be read (Windows: the secure desktop, `EASYCONTROL_INPUT_BLOCKED`). */
    getX(): number;
    /** Throws when the position cannot be read (Windows: the secure desktop, `EASYCONTROL_INPUT_BLOCKED`). */
    getY(): number;
    /**
     * Both coordinates from one read, so they belong to the same moment; cheaper than `getX()`
     * and `getY()`. Throws when the position cannot be read, as they do.
     */
    getPosition(): MousePosition;
    /** The pointer's picture; empty while it is hidden. */
    getIcon(): MouseIcon;
    /**
     * A number that changes when the pointer's shape does; 0 while it is hidden on Windows and macOS,
     * on macOS when its picture has nothing to see (CSS `cursor: none`); a pointer hidden any other way
     * keeps its picture there (Linux cannot tell: XFixes reports no hidden state). Cheap on Windows and Linux (poll it, call
     * `getIcon` when it changes); a hash of the picture on macOS.
     */
    getIconId(): number;
    setX(x: number): void;
    setY(y: number): void;
    /** Moves the pointer in one step. */
    setPosition(x: number, y: number): void;
    /**
     * Moves by a distance in mouse counts, as a mouse does: what pointer-locked pages
     * (`movementX`/`movementY`) and games read, which `setPosition` never makes. The system's
     * pointer speed and acceleration apply to the visible pointer. Fractions are added to the
     * next call. At most 100000 either way.
     */
    moveBy(dx: number, dy: number): void;
    /** `moveBy(dx, 0)`: moves horizontally only; the vertical fraction kept for the next call stays. */
    moveByX(dx: number): void;
    /** `moveBy(0, dy)`: moves vertically only; the horizontal fraction kept for the next call stays. */
    moveByY(dy: number): void;
    buttonDown(button: MouseButton): void;
    buttonUp(button: MouseButton): void;
    /**
     * Releases every button `buttonDown` pressed and `buttonUp` did not release; also done when the process ends.
     * Every button is tried; those that could not be released stay held for the next call, and the first
     * failure is thrown (Windows: `EASYCONTROL_INPUT_BLOCKED` on the secure desktop).
     */
    releaseAll(): void;
    /**
     * Scrolls down, or right when `isHorizontal` is true. `amount` is in wheel notches:
     * a fraction is dropped, a negative amount scrolls the other way, 0 does nothing.
     */
    scrollDown(amount: number, isHorizontal: boolean): void;
    /**
     * Scrolls up, or left when `isHorizontal` is true. `amount` is in wheel notches:
     * a fraction is dropped, a negative amount scrolls the other way, 0 does nothing.
     */
    scrollUp(amount: number, isHorizontal: boolean): void;
    /**
     * Scrolls by wheel notches, fractions included (touchpads, a browser's pixel wheel events):
     * positive `x` right, positive `y` down, as `WheelEvent.deltaX`/`deltaY`. What the platform
     * cannot send yet (X11 takes whole notches only) is added to the next call. At most 10000 either way.
     */
    scroll(x: number, y: number): void;
}

/**
 * A physical key, by its `KeyboardEvent.code` value: `"KeyA"`, `"ShiftLeft"`, `"Numpad5"`, ...
 * (https://developer.mozilla.org/docs/Web/API/UI_Events/Keyboard_event_code_values).
 */
export type KeyCode = string;

/** Options of `Keyboard.type`. */
export interface TypeOptions {
    /** Linux Wayland: enter characters the layout has no key for with Ctrl+Shift+U (GTK, IBus). Default false; ignored elsewhere. */
    unicodeFallback?: boolean;
}

/** The lock keys, whether each is on. */
export interface LockState {
    capsLock: boolean;
    /** Always false on macOS, whose keyboards have none. */
    numLock: boolean;
    /** Always false on macOS, whose keyboards have none. */
    scrollLock: boolean;
}

/** The keyboard. */
export interface Keyboard {
    /** Presses a physical key, the same one whatever the layout; the layout decides what it types. Throws when the key is not supported. */
    keyDown(code: KeyCode): void;
    keyUp(code: KeyCode): void;
    /**
     * Releases every key `keyDown` pressed and `keyUp` did not release; also done when the process ends.
     * Every key is tried; those that could not be released stay held for the next call, and the first
     * failure is thrown (Windows: `EASYCONTROL_INPUT_BLOCKED` on the secure desktop).
     */
    releaseAll(): void;
    /** Whether this platform can press the key. */
    isKeySupported(code: KeyCode): boolean;
    /**
     * Enters text as it is, whatever the layout. `"\n"` (and `"\r\n"`), `"\t"`, `"\b"` and `"\x1b"` press
     * Enter, Tab, Backspace and Escape. An empty string does nothing. On Linux a character is typed with the key that
     * makes it, Shift and AltGr included; one the layout has no key for goes on a spare key (X11)
     * or, on Wayland, throws once the rest is typed - unless `unicodeFallback` enters it with
     * Ctrl+Shift+U, which GTK and IBus applications understand (others type stray characters).
     */
    type(text: string, options?: TypeOptions): void;
    /** Which lock keys are on, so a remote session can bring them in line with the other side's. */
    getLockState(): LockState;
    /**
     * The current layout, as the platform names it: a KLID like `"0000040E"` (Windows),
     * an input source ID like `"com.apple.keylayout.US"` (macOS), an XKB group name (Linux).
     */
    getLayout(): string;
    /**
     * Switches the layout (throws on Wayland). It changes what keys type, not which keys `keyDown` presses.
     * Only to a layout the user has: an unknown one throws "Layout not found". On Windows it switches the
     * window the input goes to, and throws `EASYCONTROL_INPUT_BLOCKED` when there is none (the secure
     * desktop) and an Error when that window does not take the request (an elevated one).
     */
    setLayout(layout: string): void;
    /** The same as `getLayout`, by its old name. */
    GetLayout(): string;
    /** The same as `setLayout`, by its old name. */
    SetLayout(layout: string): void;
}

/** A button of `VirtualGamepad.setState`: pressed or not, a value 0-1, or a browser `GamepadButton`. */
export type GamepadButtonState = boolean | number | { pressed?: boolean; value?: number } | null | undefined;

/**
 * `VirtualGamepad.setState`'s argument; a browser `Gamepad` (from `navigator.getGamepads()`) fits.
 * Missing, `null` and `undefined` entries keep their value; entries past 17 buttons and 6 axes are ignored.
 */
export interface GamepadState {
    /** Buttons 0-16 (see `buttonDown`); 6 and 7, the triggers, take their analog `value`. */
    buttons?: readonly GamepadButtonState[];
    /** Axes 0-5, -1..1 (see `setAxis`); 4 and 5 drive the triggers too, and win over buttons 6 and 7. */
    axes?: readonly (number | null | undefined)[];
}

/** What a game set the rumble motors to; both 0 when it stops. */
export interface RumbleEvent {
    /** The strong (low frequency) motor, 0-1. */
    strong: number;
    /** The weak (high frequency) motor, 0-1. */
    weak: number;
}

/**
 * A virtual gamepad. Buttons and axes follow the W3C Standard Gamepad layout
 * (`navigator.getGamepads()`), so a browser gamepad's indices can be passed as they are.
 */
export declare class VirtualGamepad {
    private constructor();
    /** False once destroyed; its other methods then throw. */
    isActive(): boolean;
    /** Unplugs it. */
    destroy(): void;
    /**
     * Presses a button, 0-16: 0 A, 1 B, 2 X, 3 Y, 4 left shoulder, 5 right shoulder,
     * 6 left trigger (fully), 7 right trigger (fully), 8 back/select, 9 start, 10 left stick,
     * 11 right stick, 12 D-pad up, 13 down, 14 left, 15 right, 16 home/guide.
     */
    buttonDown(button: number): void;
    buttonUp(button: number): void;
    /**
     * Sets an axis, 0-5, to -1..1: 0 left stick x (-1 left), 1 left stick y (-1 up),
     * 2 right stick x, 3 right stick y, 4 left trigger, 5 right trigger (-1 released, 1 pulled).
     */
    setAxis(axis: number, value: number): void;
    /** Many buttons and axes in one report: once per frame, rather than a call per change. */
    setState(state: GamepadState): void;
    /**
     * Called (on the JS thread) when a game sets the rumble motors, and with 0, 0 when it stops;
     * `null` for none. Windows and Linux; on macOS never called. It does not keep the process alive.
     */
    onRumble: ((rumble: RumbleEvent) => void) | null;
}

/**
 * The Windows gamepad driver's state; elsewhere there is nothing to install, so it reports one installed.
 * The driver is shared by every app on the machine, and a newer one serves older apps too.
 */
export interface DriverStatus {
    isInstalled: boolean;
    /** The installed driver's version; null when none is installed or not on Windows. */
    version: number | null;
    /** The oldest version this easy-control works with; null when not on Windows. */
    required: number | null;
    /** The version `installDriver()` would install (in this package); null when its files are missing or not on Windows. */
    available: number | null;
    /** An older driver than `required` is installed: `create()` rejects until `installDriver()` updates it. */
    isOutdated: boolean;
    /** An older driver than `available` is installed: it works, `installDriver()` would bring new features or fixes. */
    isUpdateAvailable: boolean;
}

/** Options of `Gamepad.installDriver`. */
export interface InstallDriverOptions {
    /** Install this package's driver even over a newer one (which otherwise stays: it serves this version too). */
    force?: boolean;
}

/** Virtual gamepads. */
export interface Gamepad {
    /** The gamepads made and not yet destroyed. */
    list(): VirtualGamepad[];
    /**
     * Plugs in a new virtual gamepad. Rejects with an `EasyControlError` saying why it cannot:
     * on Windows `EASYCONTROL_DRIVER_MISSING` when the driver must be installed first.
     * `create.Gamepad` is the class, for `instanceof`.
     */
    create: (() => Promise<VirtualGamepad>) & { readonly Gamepad: typeof VirtualGamepad };
    getDriverStatus(): DriverStatus;
    /**
     * Windows: installs or updates the driver behind one UAC prompt. A newer installed driver stays
     * (resolving at once, no prompt) unless `force`. Elsewhere resolves at once.
     */
    installDriver(options?: InstallDriverOptions): Promise<void>;
    /** Windows: removes the driver behind one UAC prompt. Elsewhere resolves at once. */
    uninstallDriver(): Promise<void>;
}

/** A screen, in the same logical coordinates as the mouse. */
export interface ScreenInfo {
    /**
     * Stable while the screen stays connected: the GDI device name (`"\\.\DISPLAY1"`, Windows),
     * the CGDirectDisplayID (macOS, equal to Electron's `display.id` there), the output name (Linux).
     */
    id: string;
    /** The monitor's name for people; `""` when the system has none. */
    name: string;
    isPrimary: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
    /** Physical pixels per logical pixel (1.25 for 125%); always 1 on X11. */
    scaleFactor: number;
}

/** The screens. */
export interface Screen {
    list(): ScreenInfo[];
}

/**
 * Why input sent now would not arrive (`Platform.getInputBlock()`):
 * - `"secure-desktop"`: Windows - a UAC prompt, the lock or sign-in screen, Ctrl+Alt+Del
 * - `"elevated-window"`: Windows - the foreground window belongs to a process run as administrator (UIPI)
 * - `"secure-input"`: macOS - a password field has turned on secure keyboard entry (keys are dropped, the mouse works)
 * - `"no-permission"`: macOS - no Accessibility permission; Wayland - /dev/uinput is not writable
 */
export type InputBlock = "secure-desktop" | "elevated-window" | "secure-input" | "no-permission";

/** The platform easy-control runs on. Works also where there is no build. */
export interface Platform {
    /** `"<platform>-<arch>"` of this process, e.g. `"win32-x64"`. */
    readonly target: string;
    /** The targets easy-control has builds for. */
    readonly supportedTargets: readonly string[];
    /** The build for this target is there and loaded; when false, every other function throws `EASYCONTROL_UNSUPPORTED_PLATFORM`. */
    readonly isSupported: boolean;
    /** Why `isSupported` is false; null when it is true. */
    readonly loadError: string | null;
    /**
     * Whether input sent now reaches applications: macOS needs the Accessibility permission,
     * Wayland a writable /dev/uinput. False where there is no build.
     */
    hasInputAccess(): boolean;
    /**
     * macOS: shows the system prompt pointing to the Accessibility settings, and resolves with the
     * access there is now (false until the user allows it). Elsewhere resolves with `hasInputAccess()`.
     */
    requestInputAccess(): Promise<boolean>;
    /** Null when input sent now should arrive, else why not. Cheap enough to poll about once a second. */
    getInputBlock(): InputBlock | null;
}

export declare const Mouse: Mouse;
export declare const Keyboard: Keyboard;
export declare const Gamepad: Gamepad;
export declare const Screen: Screen;
export declare const Platform: Platform;
