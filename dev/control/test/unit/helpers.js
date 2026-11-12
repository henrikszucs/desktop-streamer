"use strict";

import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

export const rootPath = path.join(import.meta.dirname, "..", "..");
export const distPath = path.join(rootPath, "dist");
export const platformDir = os.platform() + "-" + os.arch();

const require = createRequire(import.meta.url);

// the module as a CommonJS user gets it, through the dist loader
export const Control = require(path.join(distPath, "easy-control.cjs"));
export const { Mouse, Keyboard, Gamepad, Screen, Platform } = Control;

// why input would not arrive now (the lock screen, ...); null when it would
export const inputBlock = Platform.getInputBlock();

// input tests need the permission to send input (macOS Accessibility, ...),
// and nothing in its way (Windows: the secure desktop, where the pointer
// cannot even be read)
export const skipNoInputAccess = (!Platform.hasInputAccess() && "no permission to send input here (Platform.hasInputAccess())") ||
    (inputBlock !== null && "input is blocked here: " + inputBlock + " (Platform.getInputBlock())");

// Linux sessions where the X11 calls go through XWayland or are missing
export const isWayland = os.platform() === "linux" && (
    process.env["EASY_CONTROL_BACKEND"] === "wayland" ||
    (process.env["EASY_CONTROL_BACKEND"] !== "x11" &&
        (Boolean(process.env["WAYLAND_DISPLAY"]) || process.env["XDG_SESSION_TYPE"] === "wayland"))
);
export const isX11 = os.platform() === "linux" && !isWayland;

// true when the point lies on one of the screens
export const isOnScreen = function(screens, x, y) {
    return screens.some(function(s) {
        return x >= s["x"] && x < s["x"] + s["width"] && y >= s["y"] && y < s["y"] + s["height"];
    });
};

// the largest step a logical coordinate can snap by: one physical pixel
export const pixelTolerance = function(screens) {
    let tolerance = 1;
    for (const s of screens) {
        tolerance = Math.max(tolerance, 1 / s["scaleFactor"]);
    }
    return tolerance + 1e-6;
};
