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
    const held = new Map();         // KeyboardEvent.key -> code of every key down right now

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

    // where a pointer is in the picture, 0..1 both ways, or nothing when it is
    // on the letterbox beside it
    const positionOf = function(event) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || canvas.width === 0 || canvas.height === 0) {
            return undefined;
        }
        const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
        const drawnWidth = canvas.width * scale;
        const drawnHeight = canvas.height * scale;
        const left = rect.left + (rect.width - drawnWidth) / 2;
        const top = rect.top + (rect.height - drawnHeight) / 2;
        const x = (event.clientX - left) / drawnWidth;
        const y = (event.clientY - top) / drawnHeight;
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
        onPointerMove(event);
        push({"t": "down", "b": button});
    };
    const onPointerUp = function(event) {
        const button = BUTTONS[event.button];
        if (typeof button === "undefined") {
            return;
        }
        event.preventDefault();
        push({"t": "up", "b": button});
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
        for (const shortcut of shortcuts()) {
            const keys = shortcut["keys"];
            if (keys.length !== held.size || keys.some(function(key) { return held.has(key) === false; })) {
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
        held.set(event.key, event.code);
        push({"t": "key", "c": event.code, "d": true});
        checkShortcut();
    };
    const onKeyUp = function(event) {
        event.preventDefault();
        held.delete(event.key);
        push({"t": "key", "c": event.code, "d": false});
        checkShortcut();
    };

    // the window losing the keyboard is every key coming up, as far as the
    // host should know
    const onBlur = function() {
        for (const code of held.values()) {
            push({"t": "key", "c": code, "d": false});
        }
        held.clear();
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
        for (const code of held.values()) {
            push({"t": "key", "c": code, "d": false});
        }
        held.clear();
        cancelAnimationFrame(flushId);
        flush();
    };

    return {
        "enable": enable,
        "release": release,
        "isEnabled": function() {
            return isEnabled;
        }
    };
};

export { createInput, BUTTONS, builtinShortcuts };
export default { createInput, BUTTONS, builtinShortcuts };
