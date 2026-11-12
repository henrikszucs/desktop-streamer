// Type-checked by `npm run test:types` (tsc --noEmit), never run: it uses
// every function through the package name, as an ES module user does, and
// the lines marked @ts-expect-error must stay errors.

import easyControl, { Mouse, Keyboard, Gamepad, Screen, Platform } from "easy-control";
import type { EasyControlError, ErrorCode, MouseIcon, MousePosition, ScreenInfo, DriverStatus, VirtualGamepad, LockState,
    GamepadState, RumbleEvent, InputBlock } from "easy-control";

const x: number = Mouse.getX();
const y: number = Mouse.getY();
const icon: MouseIcon = Mouse.getIcon();
const pixels: Uint8Array = icon.data;
const iconId: number = Mouse.getIconId();
Mouse.setX(x);
Mouse.setY(y);
Mouse.setPosition(x, y);
Mouse.moveBy(5, -3.5);
Mouse.moveByX(-2);
Mouse.moveByY(0.5);
const position: MousePosition = Mouse.getPosition();
const positionX: number = position.x + Mouse.getPosition().y;
Mouse.buttonDown("left");
Mouse.buttonUp("forward");
Mouse.releaseAll();
Mouse.scrollDown(1, false);
Mouse.scrollUp(-2, true);
Mouse.scroll(0, 0.25);
// @ts-expect-error: both moveBy arguments are required
Mouse.moveBy(1);
// @ts-expect-error: moveByX takes one distance
Mouse.moveByX(1, 0);
// @ts-expect-error: the distance is required
Mouse.moveByY();
// @ts-expect-error: scroll takes numbers, not a direction flag
Mouse.scroll(1, false);
// @ts-expect-error: not a button
Mouse.buttonDown("wheel");
// @ts-expect-error: both scroll arguments are required
Mouse.scrollDown(1);

Keyboard.keyDown("KeyA");
Keyboard.keyUp("KeyA");
Keyboard.releaseAll();
const isSupported: boolean = Keyboard.isKeySupported("Numpad5");
Keyboard.type("ő€");
Keyboard.type("日本", { unicodeFallback: true });
// @ts-expect-error: no such option
Keyboard.type("x", { fallback: true });
Keyboard.type("line\nnext\tcell");
const lockState: LockState = Keyboard.getLockState();
const isCapsLock: boolean = lockState.capsLock;
const layout: string = Keyboard.getLayout();
Keyboard.setLayout(layout);
Keyboard.SetLayout(Keyboard.GetLayout());

const status: DriverStatus = Gamepad.getDriverStatus();
const version: number | null = status.version;
const available: number | null = status.available;
if (status.isUpdateAvailable) {
    await Gamepad.installDriver();
}
await Gamepad.installDriver({ force: true });
// @ts-expect-error: no such option
await Gamepad.installDriver({ quiet: true });
try {
    const gamepad: VirtualGamepad = await Gamepad.create();
    gamepad.buttonDown(0);
    gamepad.buttonUp(0);
    gamepad.setAxis(4, 1);
    const state: GamepadState = { buttons: [true, 0.5, { pressed: true, value: 1 }, null], axes: [0, -1] };
    gamepad.setState(state);
    gamepad.setState({ axes: [0.5] });
    gamepad.onRumble = function(rumble: RumbleEvent) {
        const strength: number = rumble.strong + rumble.weak;
    };
    gamepad.onRumble = null;
    // @ts-expect-error: a listener or null
    gamepad.onRumble = 1;
    const isActive: boolean = gamepad.isActive();
    gamepad.destroy();
    const isOurs: boolean = gamepad instanceof Gamepad.create.Gamepad;
} catch (error) {
    const code: ErrorCode = (error as EasyControlError).code;
    const isRestartNeeded: boolean = code === "EASYCONTROL_DRIVER_RESTART_NEEDED" || code === "EASYCONTROL_INPUT_BLOCKED";
}
const gamepads: VirtualGamepad[] = Gamepad.list();
await Gamepad.uninstallDriver();
// @ts-expect-error: only Gamepad.create() makes one
new Gamepad.create.Gamepad();

const screens: ScreenInfo[] = Screen.list();
const first: { id: string, name: string, scaleFactor: number } = screens[0];

const target: string = Platform.target;
const targets: readonly string[] = Platform.supportedTargets;
const loadError: string | null = Platform.loadError;
if (Platform.isSupported && !Platform.hasInputAccess()) {
    const hasAccess: boolean = await Platform.requestInputAccess();
}
const block: InputBlock | null = Platform.getInputBlock();
if (block === "secure-desktop" || block === "elevated-window" || block === "secure-input" || block === "no-permission") {
    const reason: string = block;
}
// @ts-expect-error: read-only
Platform.isSupported = true;

const viaDefault: number = easyControl.Mouse.getX();
