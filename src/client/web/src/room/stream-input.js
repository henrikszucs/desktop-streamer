"use strict";

// the peer's mouse and keyboard, turned into messages for the host. It listens
// on the canvas the picture is drawn on, maps a pointer to where it is *in the
// picture* (the canvas letterboxes, so its rectangle is not the picture's),
// and hands out small events the host applies with easy-control - see
// stream.js for the other end and .claude/CLIENT.md, "The stream".
//
// Events out, batched per animation frame so a fast mouse is one message:
//     {"t": "move", "x": 0..1, "y": 0..1}
//     {"t": "down" | "up", "b": "left" | "middle" | "right" | "back" | "forward"}
//     {"t": "scroll", "x": lines, "y": lines}
//     {"t": "key", "c": KeyboardEvent.code, "d": isDown}
//
// The way out is a shortcut held for its delay - Escape for a second in a
// browser, five under the desktop shell, and whatever the settings added -
// because every key the peer presses goes to the host, this one included, so
// a key alone cannot mean "stop": holding it is what does. It lets go of the
// innermost thing: the fullscreen while there is one, the keyboard and the
// mouse otherwise. `onHold(delay)` says a hold has started and `onHold(null)`
// that it ended, either way, so the screen can draw the wait.

const BUTTONS = ["left", "middle", "right", "back", "forward"];

// where the picture sits inside the canvas element, in the element's own
// pixels. The canvas is drawn `object-fit: contain`, so the picture is centred
// in it with a letterbox on two sides and the element's rectangle is not the
// picture's. `size` is the picture the decoder is producing, which the element
// cannot be asked for: its surface belongs to the worker from the moment it is
// transferred (`transferControlToOffscreen`), and the width and height the
// element still reports are the ones it was born with. The room screen draws
// the host's pointer over the same box - see ui/room/index.js.
const pictureBox = function(canvas, size) {
    const rect = canvas.getBoundingClientRect();
    const width = Number(size?.["width"]) || 0;
    const height = Number(size?.["height"]) || 0;
    if (rect.width === 0 || rect.height === 0 || width === 0 || height === 0) {
        return undefined;
    }
    const scale = Math.min(rect.width / width, rect.height / height);
    const drawnWidth = width * scale;
    const drawnHeight = height * scale;
    return {
        "left": (rect.width - drawnWidth) / 2,
        "top": (rect.height - drawnHeight) / 2,
        "width": drawnWidth,
        "height": drawnHeight,
        "rect": rect
    };
};

// how many lines one notch of the wheel is worth on the host, whichever unit
// the browser reported the wheel in
const WHEEL_LINE = 100;

// the shortcuts every client has, before the settings add any
const builtinShortcuts = function(isDesktop) {
    if (isDesktop === true) {
        return [{"delay": 5, "keys": ["Escape"]}];
    }
    return [{"delay": 1, "keys": ["Escape"]}, {"delay": 1, "keys": ["F11"]}];
};

const createInput = function(canvas, ctx, send, onRelease, onHold = function() {}) {
    let isEnabled = false;
    let queue = [];
    let flushId = -1;
    let shortcutTimerId = -1;
    // every key down right now, by the physical key: the name moves with
    // Shift ("a" down, "A" up), and it is what a shortcut is written in
    const held = new Map();         // KeyboardEvent.code -> KeyboardEvent.key
    const downButtons = new Set();  // the mouse buttons down right now
    let picture = null;             // the size of the picture being drawn

    const shortcuts = function() {
        const own = (ctx["conf"]["local"]?.["exitShortcuts"] ?? []).filter(function(shortcut) {
            return Array.isArray(shortcut?.["keys"]) && shortcut["keys"].length > 0;
        });
        return [...builtinShortcuts(ctx["desktop"]?.isAvailable === true), ...own];
    };

    const flush = function() {
        flushId = -1;
        if (queue.length === 0) {
            return;
        }
        const events = queue;
        queue = [];
        send({"kind": "input", "events": events});
    };

    const push = function(event) {
        // a move replaces the move before it: the host only wants the newest
        if (event["t"] === "move" && queue.length > 0 && queue[queue.length - 1]["t"] === "move") {
            queue[queue.length - 1] = event;
        } else {
            queue.push(event);
        }
        if (flushId === -1) {
            flushId = requestAnimationFrame(flush);
        }
    };

    // where a pointer is in the picture, 0..1 both ways, or nothing while
    // there is no picture to be in
    const positionOf = function(event) {
        const box = pictureBox(canvas, picture);
        if (typeof box === "undefined") {
            return undefined;
        }
        const x = (event.clientX - box["rect"].left - box["left"]) / box["width"];
        const y = (event.clientY - box["rect"].top - box["top"]) / box["height"];
        return {
            "x": Math.min(1, Math.max(0, x)),
            "y": Math.min(1, Math.max(0, y))
        };
    };

    const onPointerMove = function(event) {
        const position = positionOf(event);
        if (typeof position === "undefined") {
            return;
        }
        push({"t": "move", "x": position["x"], "y": position["y"]});
    };
    const onPointerDown = function(event) {
        const button = BUTTONS[event.button];
        if (typeof button === "undefined") {
            return;
        }
        event.preventDefault();
        canvas.focus?.();
        // the release is the canvas's wherever it happens - over the bar, or
        // outside the window - or the host is left holding the button
        try {
            canvas.setPointerCapture(event.pointerId);
        } catch (error) {
            // a pointer that is already gone cannot be captured
        }
        onPointerMove(event);
        downButtons.add(button);
        push({"t": "down", "b": button});
    };
    const onPointerUp = function(event) {
        const button = BUTTONS[event.button];
        if (typeof button === "undefined") {
            return;
        }
        event.preventDefault();
        downButtons.delete(button);
        push({"t": "up", "b": button});
    };
    const releaseButtons = function() {
        for (const button of downButtons) {
            push({"t": "up", "b": button});
        }
        downButtons.clear();
    };
    // a pointer the browser takes away mid-press (a gesture, a device gone)
    // says nothing about which button, so it is every button coming up
    const onPointerCancel = function() {
        releaseButtons();
    };
    const onWheel = function(event) {
        event.preventDefault();
        const unit = (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? WHEEL_LINE : 1);
        push({
            "t": "scroll",
            "x": Math.round(event.deltaX / unit * 10) / 10,
            "y": Math.round(event.deltaY / unit * 10) / 10
        });
    };
    const onContextMenu = function(event) {
        event.preventDefault();
    };

    // the shortcut clock: it starts when the keys held are exactly one
    // shortcut's, and a key changing stops it
    const checkShortcut = function() {
        const wasHolding = (shortcutTimerId !== -1);
        clearTimeout(shortcutTimerId);
        shortcutTimerId = -1;
        const names = new Set(held.values());
        for (const shortcut of shortcuts()) {
            const keys = shortcut["keys"];
            if (keys.length !== held.size || keys.some(function(key) { return names.has(key) === false; })) {
                continue;
            }
            const delay = Math.max(0.2, Number(shortcut["delay"]) || 1) * 1000;
            shortcutTimerId = setTimeout(function() {
                shortcutTimerId = -1;
                onHold(null);
                if (document.fullscreenElement !== null) {
                    document.exitFullscreen?.().catch?.(function() {});
                    return;
                }
                release();
                onRelease();
            }, delay);
            onHold(delay);
            return;
        }
        if (wasHolding === true) {
            onHold(null);
        }
    };

    const onKeyDown = function(event) {
        event.preventDefault();
        if (event.repeat === true) {
            return;
        }
        held.set(event.code || event.key, event.key);
        push({"t": "key", "c": event.code, "d": true});
        checkShortcut();
    };
    const onKeyUp = function(event) {
        event.preventDefault();
        held.delete(event.code || event.key);
        push({"t": "key", "c": event.code, "d": false});
        checkShortcut();
    };

    // the window losing the keyboard is every key and button coming up, as
    // far as the host should know
    const onBlur = function() {
        for (const code of held.keys()) {
            push({"t": "key", "c": code, "d": false});
        }
        held.clear();
        releaseButtons();
        checkShortcut();
    };

    const enable = function() {
        if (isEnabled === true) {
            return;
        }
        isEnabled = true;
        canvas.tabIndex = 0;
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("pointercancel", onPointerCancel);
        canvas.addEventListener("wheel", onWheel, {"passive": false});
        canvas.addEventListener("contextmenu", onContextMenu);
        canvas.addEventListener("keydown", onKeyDown);
        canvas.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);
        canvas.focus?.();
    };

    const release = function() {
        if (isEnabled === false) {
            return;
        }
        isEnabled = false;
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerCancel);
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("contextmenu", onContextMenu);
        canvas.removeEventListener("keydown", onKeyDown);
        canvas.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("blur", onBlur);
        if (shortcutTimerId !== -1) {
            clearTimeout(shortcutTimerId);
            shortcutTimerId = -1;
            onHold(null);
        }

        // whatever is still down comes up, so the host is not left holding a key
        for (const code of held.keys()) {
            push({"t": "key", "c": code, "d": false});
        }
        held.clear();
        releaseButtons();
        cancelAnimationFrame(flushId);
        flush();
    };

    return {
        // the picture the host is sending, as the decoder reports it: what a
        // pointer is mapped into, and the only thing that says where the
        // letterbox around it is
        "setPicture": function(size) {
            picture = (typeof size === "undefined" || size === null ? null : {...size});
        },
        "enable": enable,
        "release": release,
        "isEnabled": function() {
            return isEnabled;
        }
    };
};

export { createInput, pictureBox, BUTTONS, builtinShortcuts };
export default { createInput, pictureBox, BUTTONS, builtinShortcuts };
