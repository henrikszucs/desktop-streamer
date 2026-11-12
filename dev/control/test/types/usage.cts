// Type-checked by `npm run test:types` (tsc --noEmit), never run: what a
// CommonJS user gets from require("easy-control").

import easyControl = require("easy-control");

const { Mouse, Keyboard, Gamepad, Screen, Platform } = easyControl;

Mouse.setPosition(Mouse.getX(), Mouse.getY());
const position: easyControl.MousePosition = Mouse.getPosition();
Mouse.moveByX(position.x - Mouse.getX());
Mouse.moveByY(0);
Keyboard.keyDown("KeyA");
Keyboard.keyUp("KeyA");
const gamepad: Promise<easyControl.VirtualGamepad> = Gamepad.create();
const screens: easyControl.ScreenInfo[] = Screen.list();
const isSupported: boolean = Platform.isSupported;

// @ts-expect-error: CommonJS has no default export
easyControl.default;
