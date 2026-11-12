"use strict";

// The window the input lands on: it reports every mouse, wheel and key event
// it receives to the main process, which compares them with what it sent.

const { ipcRenderer } = require("electron");

const text = document.getElementById("text");

const report = function(event) {
    ipcRenderer.send("input", event);
};

for (const type of ["mousedown", "mouseup", "mousemove"]) {
    window.addEventListener(type, function(event) {
        // no middle-click autoscroll, no back/forward navigation
        if (type !== "mousemove" && event.button !== 0) {
            event.preventDefault();
        }
        report({
            "type": type,
            "button": event.button,
            "buttons": event.buttons,
            "detail": event.detail,
            "screenX": event.screenX,
            "screenY": event.screenY,
            "movementX": event.movementX,
            "movementY": event.movementY,
            "isLocked": document.pointerLockElement !== null
        });
    }, true);
}
window.addEventListener("dblclick", function(event) {
    report({ "type": "dblclick", "button": event.button });
}, true);
document.addEventListener("pointerlockchange", function() {
    report({ "type": "pointerlockchange", "isLocked": document.pointerLockElement !== null });
});
window.addEventListener("auxclick", function(event) {
    event.preventDefault();
});
window.addEventListener("contextmenu", function(event) {
    event.preventDefault();
});

window.addEventListener("wheel", function(event) {
    event.preventDefault();
    report({
        "type": "wheel",
        "deltaX": event.deltaX,
        "deltaY": event.deltaY
    });
}, { "passive": false });

for (const type of ["keydown", "keyup"]) {
    window.addEventListener(type, function(event) {
        // keys pressed outside the text box do nothing (no tab focus moves,
        // no scrolling); in it, typed text goes in
        if (document.activeElement !== text) {
            event.preventDefault();
        }
        report({
            "type": type,
            "code": event.code,
            "key": event.key,
            "shiftKey": event.shiftKey,
            "ctrlKey": event.ctrlKey,
            "repeat": event.repeat
        });
    }, true);
}

// called by the main process through executeJavaScript

// client rectangles of the regions the main process aims at
globalThis.regions = function() {
    const rect = function(id) {
        const r = document.getElementById(id).getBoundingClientRect();
        return { "x": r.left, "y": r.top, "width": r.width, "height": r.height };
    };
    return { "pad": rect("pad"), "cross": rect("cross"), "text": rect("text") };
};

globalThis.hasFocus = function() {
    return document.hasFocus();
};

globalThis.focusText = function() {
    text.value = "";
    text.focus();
    return document.activeElement === text;
};

globalThis.blurText = function() {
    text.blur();
    return document.activeElement !== text;
};

globalThis.readText = function() {
    return text.value;
};

// pointer lock, as a game or a 3D page takes it (needs a user gesture: the
// main process calls this with one)
globalThis.lockPointer = function() {
    const result = document.getElementById("pad").requestPointerLock();
    return Promise.resolve(result).then(function() {
        return true;
    }, function(error) {
        return String(error);
    });
};

globalThis.unlockPointer = function() {
    document.exitPointerLock();
    return true;
};

// rumble on a pad, as a game does through the Gamepad API
globalThis.playRumble = function(index, strong, weak, duration) {
    const pad = navigator.getGamepads()[index];
    if (!pad || !pad.vibrationActuator) {
        return Promise.resolve("no vibrationActuator");
    }
    return pad.vibrationActuator.playEffect("dual-rumble", {
        "startDelay": 0,
        "duration": duration,
        "strongMagnitude": strong,
        "weakMagnitude": weak
    }).then(String, String);
};

// the pads Chromium sees, as plain data
globalThis.readGamepads = function() {
    return Array.from(navigator.getGamepads()).filter(Boolean).map(function(gp) {
        return {
            "index": gp.index,
            "id": gp.id,
            "mapping": gp.mapping,
            "buttons": gp.buttons.map(function(b) {
                return { "pressed": b.pressed, "value": b.value };
            }),
            "axes": Array.from(gp.axes)
        };
    });
};

report({ "type": "ready" });
