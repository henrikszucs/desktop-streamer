"use strict";

// End-to-end test: easy-control sends real OS input to a window of this app,
// and the events the window receives are compared with what was sent.
//
//     npm run test:e2e
//
// It takes over the mouse and keyboard for a few seconds. Keys are only
// pressed while this window has the focus, so they cannot reach another app.

const { app, BrowserWindow, ipcMain, screen } = require("electron");
const os = require("node:os");
const path = require("node:path");

const Control = require(path.join(__dirname, "..", "..", "dist", "easy-control.cjs"));
const { Mouse, Keyboard, Gamepad, Screen } = Control;

const isWayland = os.platform() === "linux" && (
    process.env["EASY_CONTROL_BACKEND"] === "wayland" ||
    (process.env["EASY_CONTROL_BACKEND"] !== "x11" &&
        (Boolean(process.env["WAYLAND_DISPLAY"]) || process.env["XDG_SESSION_TYPE"] === "wayland"))
);

const EVENT_TIMEOUT = 1500;


//
// a minimal runner: Electron's main process has no test runner of its own
//
const tests = [];
const test = function(name, options, fn) {
    if (typeof options === "function") {
        fn = options;
        options = {};
    }
    tests.push({ "name": name, "skip": options["skip"], "fn": fn });
};

const runTests = async function() {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    for (const t of tests) {
        const skip = typeof t["skip"] === "function" ? t["skip"]() : t["skip"];
        if (skip) {
            skipped++;
            console.log("- " + t["name"] + " # SKIP " + skip);
            continue;
        }
        const start = Date.now();
        try {
            await t["fn"]();
            passed++;
            console.log("✔ " + t["name"] + " (" + (Date.now() - start) + "ms)");
        } catch (error) {
            failed++;
            console.log("✖ " + t["name"]);
            console.log("    " + String(error && error.stack || error).split("\n").join("\n    "));
        } finally {
            releaseAll();
        }
    }
    console.log("\ntests " + tests.length + " | pass " + passed + " | fail " + failed + " | skipped " + skipped);
    return failed;
};


//
// what the window reports
//
const events = [];
ipcMain.on("input", function(event, data) {
    data["time"] = Date.now();
    events.push(data);
});

// the first event after `mark` that matches, or throws after the timeout
const waitFor = async function(mark, description, predicate, timeout = EVENT_TIMEOUT) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        for (let i = mark; i < events.length; i++) {
            if (predicate(events[i])) {
                return events[i];
            }
        }
        await sleep(10);
    }
    const seen = events.slice(mark).filter(function(e) {
        return e["type"] !== "mousemove";
    }).slice(0, 10);
    throw new Error("Timed out waiting for " + description + "; got " + JSON.stringify(seen));
};

const sleep = function(ms) {
    return new Promise(function(resolve) {
        setTimeout(resolve, ms);
    });
};

const assert = function(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
};

const assertNear = function(actual, expected, tolerance, message) {
    assert(Math.abs(actual - expected) <= tolerance, message + ": " + actual + " is not within " + tolerance + " of " + expected);
};


//
// the window
//
let win = null;
let regions = null;     // screen rectangles of the page's regions

const call = function(code, isUserGesture = false) {
    return win.webContents.executeJavaScript(code, isUserGesture);
};

// a page region in the same coordinates as Mouse.setPosition
const toScreen = function(rect) {
    const content = win.getContentBounds();
    return { "x": content.x + rect.x, "y": content.y + rect.y, "width": rect.width, "height": rect.height };
};

const centre = function(rect) {
    return { "x": rect.x + rect.width / 2, "y": rect.y + rect.height / 2 };
};

// buttons and keys a failed test could leave down
const pressedButtons = new Set();
const pressedKeys = new Set();
const buttonDown = function(btn) {
    pressedButtons.add(btn);
    Mouse.buttonDown(btn);
};
const buttonUp = function(btn) {
    Mouse.buttonUp(btn);
    pressedButtons.delete(btn);
};
const keyDown = function(code) {
    pressedKeys.add(code);
    Keyboard.keyDown(code);
};
const keyUp = function(code) {
    Keyboard.keyUp(code);
    pressedKeys.delete(code);
};
const releaseAll = function() {
    for (const btn of pressedButtons) {
        buttonUp(btn);
    }
    for (const code of pressedKeys) {
        keyUp(code);
    }
};

// keys go to the focused window, so refuse to press any unless it is ours
const requireFocus = async function() {
    if (!win.isFocused() || !(await call("hasFocus()"))) {
        throw new Error("The test window has no keyboard focus, no key was sent (keep other windows from taking the focus)");
    }
};

const click = async function(point, btn = "left") {
    const mark = events.length;
    Mouse.setPosition(point.x, point.y);
    buttonDown(btn);
    buttonUp(btn);
    const up = await waitFor(mark, btn + " mouseup", function(e) {
        return e["type"] === "mouseup";
    });
    return { "mark": mark, "up": up };
};


//
// Screen
//
test("Screen.list matches Electron's screen API", function() {
    const ours = Screen.list();
    const displays = screen.getAllDisplays();
    const primaryId = screen.getPrimaryDisplay().id;
    assert(ours.length === displays.length, "screen count: " + ours.length + " vs Electron " + displays.length);
    // the same rectangles to the pixel, a size that does not divide by the
    // scale (1024 px / 1.25 = 819.2) included
    for (const display of displays) {
        const b = display.bounds;
        const match = ours.find(function(s) {
            return s["x"] === b.x && s["y"] === b.y && s["width"] === b.width && s["height"] === b.height;
        });
        assert(match, "no screen at " + JSON.stringify(b) + " in " + JSON.stringify(ours));
        assert(match["isPrimary"] === (display.id === primaryId), "isPrimary of screen at " + b.x + "," + b.y);
        assert(typeof match["id"] === "string" && match["id"].length > 0, "screen id " + JSON.stringify(match["id"]));
        assert(typeof match["name"] === "string", "screen name " + JSON.stringify(match["name"]));
        // macOS: the id is the CGDirectDisplayID, which Electron uses as display.id
        if (os.platform() === "darwin") {
            assert(match["id"] === String(display.id), "id " + match["id"] + " vs Electron's " + display.id);
        }
        // X11 reports pixels with scaleFactor 1, Electron its own UI scale
        if (os.platform() !== "linux") {
            assert(match["scaleFactor"] === display.scaleFactor, "scaleFactor " + match["scaleFactor"] + " vs Electron " + display.scaleFactor);
        }
    }
});


//
// Mouse
//
test("the pointer lands where it is set, and clicks arrive there", async function() {
    const pad = regions.pad;
    const points = [];
    for (const fx of [0.1, 0.5, 0.9]) {
        for (const fy of [0.15, 0.5, 0.85]) {
            points.push({ "x": Math.round(pad.x + pad.width * fx), "y": Math.round(pad.y + pad.height * fy) });
        }
    }
    for (const point of points) {
        const { mark, up } = await click(point);
        const down = await waitFor(mark, "mousedown", function(e) {
            return e["type"] === "mousedown";
        });
        for (const e of [down, up]) {
            assert(e["button"] === 0, e["type"] + " button " + e["button"]);
            assertNear(e["screenX"], point.x, 1.5, e["type"] + " screenX");
            assertNear(e["screenY"], point.y, 1.5, e["type"] + " screenY");
        }
        assertNear(Mouse.getX(), point.x, 1, "getX");
        assertNear(Mouse.getY(), point.y, 1, "getY");
    }
});

test("each button reports its DOM button number", async function() {
    const point = centre(regions.pad);
    const buttons = { "left": 0, "middle": 1, "right": 2, "back": 3, "forward": 4 };
    for (const [btn, number] of Object.entries(buttons)) {
        const mark = events.length;
        Mouse.setPosition(point.x, point.y);
        buttonDown(btn);
        const down = await waitFor(mark, btn + " mousedown", function(e) {
            return e["type"] === "mousedown";
        });
        buttonUp(btn);
        const up = await waitFor(mark, btn + " mouseup", function(e) {
            return e["type"] === "mouseup";
        });
        assert(down["button"] === number, btn + " mousedown button " + down["button"] + ", expected " + number);
        assert(up["button"] === number, btn + " mouseup button " + up["button"] + ", expected " + number);
    }
});

test("moving with a button held drags", async function() {
    const pad = regions.pad;
    const from = { "x": Math.round(pad.x + pad.width * 0.25), "y": Math.round(pad.y + pad.height * 0.5) };
    const to = { "x": Math.round(pad.x + pad.width * 0.75), "y": Math.round(pad.y + pad.height * 0.6) };
    const mark = events.length;
    Mouse.setPosition(from.x, from.y);
    buttonDown("left");
    await waitFor(mark, "mousedown", function(e) {
        return e["type"] === "mousedown";
    });
    Mouse.setPosition(to.x, to.y);
    await waitFor(mark, "mousemove with the left button held at the target", function(e) {
        return e["type"] === "mousemove" && (e["buttons"] & 1) === 1 &&
            Math.abs(e["screenX"] - to.x) <= 1.5 && Math.abs(e["screenY"] - to.y) <= 1.5;
    });
    buttonUp("left");
    const up = await waitFor(mark, "mouseup", function(e) {
        return e["type"] === "mouseup";
    });
    assertNear(up["screenX"], to.x, 1.5, "mouseup screenX");
    assertNear(up["screenY"], to.y, 1.5, "mouseup screenY");
});

test("two quick clicks make a double click, two slow ones do not", async function() {
    const point = centre(regions.pad);
    Mouse.setPosition(point.x, point.y);
    await sleep(600);
    let mark = events.length;
    await click(point);
    await click(point);
    await waitFor(mark, "dblclick", function(e) {
        return e["type"] === "dblclick";
    });
    const downs = events.slice(mark).filter(function(e) {
        return e["type"] === "mousedown";
    });
    assert(downs.length === 2 && downs[1]["detail"] === 2, "the second mousedown's detail is " + (downs[1] && downs[1]["detail"]) + ", not 2");

    await sleep(900);
    mark = events.length;
    await click(point);
    await sleep(900);
    await click(point);
    await sleep(200);
    assert(!events.slice(mark).some(function(e) {
        return e["type"] === "dblclick";
    }), "two clicks 0.9 s apart made a double click");
});

// runs fn with the page's pointer locked, as a game holds it
const withPointerLock = async function(fn) {
    const point = centre(regions.pad);
    Mouse.setPosition(point.x, point.y);
    await sleep(50);
    let mark = events.length;
    const locked = await call("lockPointer()", true);
    assert(locked === true, "requestPointerLock failed: " + locked);
    await waitFor(mark, "pointer lock", function(e) {
        return e["type"] === "pointerlockchange" && e["isLocked"];
    });
    try {
        await fn();
    } finally {
        mark = events.length;
        await call("unlockPointer()");
        await waitFor(mark, "pointer unlock", function(e) {
            return e["type"] === "pointerlockchange" && !e["isLocked"];
        }).catch(function() {});
    }
};

// The movement a locked page reads from one call, summed: the pointer speed
// may scale it. With `isExpected` false, none is waited for (a fraction that
// does not make a count yet), only what arrives in a moment is summed.
const lockedMovement = async function(move, isExpected = true) {
    const mark = events.length;
    move();
    if (isExpected) {
        await waitFor(mark, "locked mousemove", function(e) {
            return e["type"] === "mousemove" && e["isLocked"];
        });
    }
    await sleep(100);
    let x = 0;
    let y = 0;
    let count = 0;
    for (const e of events.slice(mark)) {
        if (e["type"] === "mousemove" && e["isLocked"]) {
            x += e["movementX"];
            y += e["movementY"];
            count++;
        }
    }
    return { "x": x, "y": y, "count": count };
};

test("moveBy reaches a pointer-locked page as movement", async function() {
    await withPointerLock(async function() {
        const right = await lockedMovement(function() { Mouse.moveBy(40, 0); });
        assert(right.x > 0, "moveBy(40, 0): movementX " + right.x + " should be positive");
        const up = await lockedMovement(function() { Mouse.moveBy(0, -40); });
        assert(up.y < 0, "moveBy(0, -40): movementY " + up.y + " should be negative");
    });
});

test("moveByX and moveByY move a pointer-locked page along one axis, keeping the other's fraction", async function() {
    await withPointerLock(async function() {
        const right = await lockedMovement(function() { Mouse.moveByX(20); });
        assert(right.x > 0 && right.y === 0, "moveByX(20): movement " + right.x + "," + right.y + ", expected x > 0, y 0");
        const up = await lockedMovement(function() { Mouse.moveByY(-20); });
        assert(up.x === 0 && up.y < 0, "moveByY(-20): movement " + up.x + "," + up.y + ", expected x 0, y < 0");

        // 0.8 of a count kept for y; moveByX's fractions leave it alone
        for (let i = 0; i < 2; i++) {
            const none = await lockedMovement(function() { Mouse.moveBy(0, 0.4); }, false);
            assert(none.count === 0, "moveBy(0, 0.4) moved before a count was whole");
        }
        let x = 0;
        for (let i = 0; i < 3; i++) {
            const step = await lockedMovement(function() { Mouse.moveByX(0.4); }, i === 2);
            assert(step.y === 0, "moveByX(0.4) moved y by " + step.y);
            x += step.x;
        }
        assert(x > 0, "three moveByX(0.4) made no count");
        const kept = await lockedMovement(function() { Mouse.moveBy(0, 0.4); });
        assert(kept.y > 0 && kept.x === 0, "the y fraction was not kept: movement " + kept.x + "," + kept.y);
    });
});

test("setX and setY move the pointer along one axis", async function() {
    const pad = regions.pad;
    const start = { "x": Math.round(pad.x + pad.width * 0.3), "y": Math.round(pad.y + pad.height * 0.3) };
    Mouse.setPosition(start.x, start.y);
    await sleep(50);

    let mark = events.length;
    const x = start.x + 120;
    Mouse.setX(x);
    await waitFor(mark, "mousemove to x " + x, function(e) {
        return e["type"] === "mousemove" && Math.abs(e["screenX"] - x) <= 1.5 && Math.abs(e["screenY"] - start.y) <= 1.5;
    });

    mark = events.length;
    const y = start.y + 90;
    Mouse.setY(y);
    await waitFor(mark, "mousemove to y " + y, function(e) {
        return e["type"] === "mousemove" && Math.abs(e["screenX"] - x) <= 1.5 && Math.abs(e["screenY"] - y) <= 1.5;
    });
});

test("scrolling sends wheel events in the right direction", async function() {
    const point = centre(regions.pad);
    Mouse.setPosition(point.x, point.y);
    await sleep(50);

    // the summed wheel deltas of one scroll call
    const scroll = async function(fn, amount, isHorizontal) {
        const mark = events.length;
        fn(amount, isHorizontal);
        await waitFor(mark, "wheel event", function(e) {
            return e["type"] === "wheel";
        });
        await sleep(150);   // let every notch of the call arrive
        let deltaX = 0;
        let deltaY = 0;
        for (const e of events.slice(mark)) {
            if (e["type"] === "wheel") {
                deltaX += e["deltaX"];
                deltaY += e["deltaY"];
            }
        }
        return { "deltaX": deltaX, "deltaY": deltaY };
    };

    const down = await scroll(Mouse.scrollDown, 1, false);
    assert(down.deltaY > 0, "scrollDown: deltaY " + down.deltaY + " should be positive");
    const up = await scroll(Mouse.scrollUp, 1, false);
    assert(up.deltaY < 0, "scrollUp: deltaY " + up.deltaY + " should be negative");
    const right = await scroll(Mouse.scrollDown, 1, true);
    assert(right.deltaX > 0, "horizontal scrollDown: deltaX " + right.deltaX + " should be positive (right)");
    const left = await scroll(Mouse.scrollUp, 1, true);
    assert(left.deltaX < 0, "horizontal scrollUp: deltaX " + left.deltaX + " should be negative (left)");

    const negative = await scroll(Mouse.scrollDown, -1, false);
    assert(negative.deltaY < 0, "scrollDown(-1): deltaY " + negative.deltaY + " should be negative (up)");

    const three = await scroll(Mouse.scrollDown, 3, false);
    assert(three.deltaY > down.deltaY, "3 notches (" + three.deltaY + ") should scroll further than 1 (" + down.deltaY + ")");
});

test("scroll takes fractions of a notch, which add up", async function() {
    const point = centre(regions.pad);
    Mouse.setPosition(point.x, point.y);
    await sleep(50);

    // the wheel deltas of calls made one after another, summed
    const sum = async function(calls) {
        const mark = events.length;
        for (const [x, y] of calls) {
            Mouse.scroll(x, y);
            await sleep(30);
        }
        await waitFor(mark, "wheel event", function(e) {
            return e["type"] === "wheel";
        });
        await sleep(150);
        let deltaX = 0;
        let deltaY = 0;
        for (const e of events.slice(mark)) {
            if (e["type"] === "wheel") {
                deltaX += e["deltaX"];
                deltaY += e["deltaY"];
            }
        }
        return { "deltaX": deltaX, "deltaY": deltaY };
    };

    const notch = await sum([[0, 1]]);
    assert(notch.deltaY > 0, "scroll(0, 1): deltaY " + notch.deltaY + " should be positive (down)");
    const halves = await sum([[0, 0.5], [0, 0.5]]);
    assert(halves.deltaY > notch.deltaY * 0.5 && halves.deltaY < notch.deltaY * 2,
        "two half notches (" + halves.deltaY + ") should scroll about as far as one (" + notch.deltaY + ")");
    const up = await sum([[0, -0.5], [0, -0.5]]);
    assert(up.deltaY < 0, "negative y: deltaY " + up.deltaY + " should be negative (up)");
    const right = await sum([[0.5, 0], [0.5, 0]]);
    assert(right.deltaX > 0, "positive x: deltaX " + right.deltaX + " should be positive (right)");
    const left = await sum([[-1, 0]]);
    assert(left.deltaX < 0, "negative x: deltaX " + left.deltaX + " should be negative (left)");
});

test("macOS: a click does not move the pointer off a fraction", { "skip": os.platform() !== "darwin" && "macOS only" }, async function() {
    const point = centre(regions.pad);
    const x = Math.floor(point.x) + 0.3;
    const y = Math.floor(point.y) + 0.7;
    let mark = events.length;
    Mouse.setPosition(x, y);
    await waitFor(mark, "the move", function(e) {
        return e["type"] === "mousemove";
    });
    mark = events.length;
    buttonDown("left");
    buttonUp("left");
    await waitFor(mark, "the release", function(e) {
        return e["type"] === "mouseup";
    });
    await sleep(150);
    assertNear(Mouse.getX(), x, 0.01, "x");
    assertNear(Mouse.getY(), y, 0.01, "y");
});

test("macOS: a picture with nothing to see counts as hidden, one with a pixel to see does not", { "skip": os.platform() !== "darwin" && "macOS only" }, async function() {
    const point = centre(regions.pad);
    const shapeOf = async function(cursor) {
        await call("document.getElementById(\"pad\").style.cursor = " + JSON.stringify(cursor));
        // the shape changes once the window has seen a move
        const mark = events.length;
        Mouse.setPosition(point.x + 5, point.y + 5);
        await waitFor(mark, "the move away", function(e) {
            return e["type"] === "mousemove";
        });
        const markBack = events.length;
        Mouse.setPosition(point.x, point.y);
        await waitFor(markBack, "the move back", function(e) {
            return e["type"] === "mousemove";
        });
        await sleep(150);
        return { "id": Mouse.getIconId(), "icon": Mouse.getIcon() };
    };
    const onePixel = "url(\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'>" +
        "<rect width='1' height='1' fill='red'/></svg>\") 0 0, auto";
    try {
        const before = await shapeOf("default");
        assert(before.icon.width > 0 && before.id !== 0, "the arrow has a picture and an id");

        const hidden = await shapeOf("none");
        assert(hidden.icon.width === 0 && hidden.icon.height === 0 && hidden.icon.data.length === 0,
            "cursor: none gives a " + hidden.icon.width + "x" + hidden.icon.height + " picture of " + hidden.icon.data.length + " bytes");
        assert(hidden.id === 0, "cursor: none gives id " + hidden.id);

        const pixel = await shapeOf(onePixel);
        assert(pixel.icon.width > 0 && pixel.id !== 0,
            "one pixel to see gives a " + pixel.icon.width + "x" + pixel.icon.height + " picture and id " + pixel.id);

        const after = await shapeOf("default");
        assert(after.id === before.id, "the arrow's id came back as " + after.id + ", it was " + before.id);
    } finally {
        await call("document.getElementById(\"pad\").style.cursor = \"\"");
    }
});

test("getIcon and getIconId follow the pointer shape", { "skip": isWayland && "Wayland shows only XWayland pointer shapes" }, async function() {
    const arrowPoint = centre(regions.pad);
    const crossPoint = centre(regions.cross);

    // the shape changes once the window has seen the move
    const shapeAt = async function(point) {
        // from a step away, so there is a move even if the pointer is there;
        // each move is waited for, as moves the window has not seen yet merge
        const moveTo = async function(x, y) {
            const mark = events.length;
            Mouse.setPosition(x, y);
            await waitFor(mark, "mousemove to " + x + "," + y, function(e) {
                return e["type"] === "mousemove" && Math.abs(e["screenX"] - x) <= 1.5 && Math.abs(e["screenY"] - y) <= 1.5;
            });
        };
        await moveTo(point.x + 5, point.y + 5);
        await moveTo(point.x, point.y);
        await sleep(150);
        return { "id": Mouse.getIconId(), "icon": Mouse.getIcon() };
    };

    const arrow = await shapeAt(arrowPoint);
    const cross = await shapeAt(crossPoint);
    const arrowAgain = await shapeAt(arrowPoint);

    for (const shape of [arrow, cross]) {
        assert(shape.id > 0, "getIconId is 0 while a pointer is shown");
        assert(shape.icon.width > 0 && shape.icon.height > 0, "getIcon is empty");
        assert(shape.icon.data.length === shape.icon.width * shape.icon.height * 4, "getIcon data length");
    }
    assert(arrow.id !== cross.id, "getIconId did not change between the arrow and the crosshair (" + arrow.id + ")");
    assert(arrowAgain.id === arrow.id, "getIconId of the arrow changed: " + arrow.id + " then " + arrowAgain.id);
    assert(Buffer.compare(Buffer.from(arrow.icon.data), Buffer.from(cross.icon.data)) !== 0 ||
        arrow.icon.xOffset !== cross.icon.xOffset || arrow.icon.yOffset !== cross.icon.yOffset,
        "getIcon returned the same picture for the arrow and the crosshair");
});


//
// Keyboard
//
const keysToTest = [];
for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    keysToTest.push("Key" + letter);
}
for (let digit = 0; digit <= 9; digit++) {
    keysToTest.push("Digit" + digit);
}
keysToTest.push(
    "Space", "Enter", "Backspace", "Tab", "Escape",
    "Minus", "Equal", "BracketLeft", "BracketRight", "Semicolon", "Quote", "Backquote",
    "Backslash", "Comma", "Period", "Slash",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown",
    "Insert", "Delete",
    "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight",
    "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F12",
    "Numpad0", "Numpad5", "Numpad9", "NumpadAdd", "NumpadSubtract", "NumpadMultiply",
    "NumpadDivide", "NumpadDecimal", "NumpadEnter"
);
// not pressed: Alt and F10 open the window menu, Meta the start menu or
// launcher, and CapsLock, NumLock and ScrollLock would stay toggled

test("keyDown and keyUp arrive with the same KeyboardEvent.code", async function() {
    await call("blurText()");
    await requireFocus();
    const wrong = [];
    for (const code of keysToTest) {
        await requireFocus();
        const mark = events.length;
        keyDown(code);
        keyUp(code);
        try {
            const down = await waitFor(mark, code + " keydown", function(e) {
                return e["type"] === "keydown";
            });
            const up = await waitFor(mark, code + " keyup", function(e) {
                return e["type"] === "keyup";
            });
            if (down["code"] !== code || up["code"] !== code) {
                wrong.push(code + " arrived as " + down["code"] + "/" + up["code"]);
            }
        } catch (error) {
            wrong.push(code + ": " + error.message);
        }
    }
    assert(wrong.length === 0, wrong.length + " of " + keysToTest.length + " keys wrong:\n" + wrong.join("\n"));
});

test("a held modifier applies to the next key", async function() {
    await call("blurText()");
    await requireFocus();
    for (const [modifier, flag] of [["ShiftLeft", "shiftKey"], ["ControlLeft", "ctrlKey"]]) {
        const mark = events.length;
        keyDown(modifier);
        keyDown("KeyK");
        keyUp("KeyK");
        keyUp(modifier);
        const down = await waitFor(mark, "KeyK keydown", function(e) {
            return e["type"] === "keydown" && e["code"] === "KeyK";
        });
        assert(down[flag] === true, modifier + " held, but KeyK keydown has " + flag + " " + down[flag]);
        await waitFor(mark, modifier + " keyup", function(e) {
            return e["type"] === "keyup" && e["code"] === modifier;
        });
        const after = events.length;
        keyDown("KeyK");
        keyUp("KeyK");
        const plain = await waitFor(after, "KeyK keydown", function(e) {
            return e["type"] === "keydown" && e["code"] === "KeyK";
        });
        assert(plain[flag] === false, modifier + " released, but KeyK keydown still has " + flag);
    }
});

test("Keyboard.releaseAll releases every key still held down", async function() {
    await call("blurText()");
    await requireFocus();
    const mark = events.length;
    const held = ["KeyJ", "ShiftLeft", "Digit7"];
    for (const code of held) {
        Keyboard.keyDown(code);
        await waitFor(mark, code + " keydown", function(e) {
            return e["type"] === "keydown" && e["code"] === code;
        });
    }
    Keyboard.releaseAll();
    for (const code of held) {
        await waitFor(mark, code + " keyup from releaseAll", function(e) {
            return e["type"] === "keyup" && e["code"] === code;
        });
    }
    // nothing left to release
    const after = events.length;
    Keyboard.releaseAll();
    await sleep(150);
    assert(!events.slice(after).some(function(e) {
        return e["type"] === "keyup";
    }), "a second releaseAll released something again");
});

test("Mouse.releaseAll releases every button still held down", async function() {
    const point = centre(regions.pad);
    const mark = events.length;
    Mouse.setPosition(point.x, point.y);
    // the DOM's button numbers
    const held = { "left": 0, "right": 2 };
    for (const [btn, number] of Object.entries(held)) {
        Mouse.buttonDown(btn);
        await waitFor(mark, btn + " mousedown", function(e) {
            return e["type"] === "mousedown" && e["button"] === number;
        });
    }
    Mouse.releaseAll();
    for (const [btn, number] of Object.entries(held)) {
        await waitFor(mark, btn + " mouseup from releaseAll", function(e) {
            return e["type"] === "mouseup" && e["button"] === number;
        });
    }
});

test("type enters text regardless of the keyboard layout", async function() {
    // Wayland types only what the current layout has keys for
    const sample = isWayland ? "Hello World 123" : "Hello, World! 123 ő€ß 日本 😀";
    assert(await call("focusText()"), "the text box did not take the focus");
    await requireFocus();
    Keyboard.type(sample);
    const end = Date.now() + 3000;
    let value = "";
    while (Date.now() < end) {
        value = await call("readText()");
        if (value === sample) {
            break;
        }
        await sleep(25);
    }
    await call("blurText()");
    assert(value === sample, "typed " + JSON.stringify(sample) + ", the text box has " + JSON.stringify(value));
});

test("type presses Enter, Tab and Backspace for their characters", async function() {
    assert(await call("focusText()"), "the text box did not take the focus");
    await requireFocus();
    let mark = events.length;
    Keyboard.type("ab\bc\r\nd");
    const enter = await waitFor(mark, "Enter keydown", function(e) {
        return e["type"] === "keydown" && e["code"] === "Enter";
    });
    await waitFor(mark, "Backspace keydown", function(e) {
        return e["type"] === "keydown" && e["code"] === "Backspace";
    });
    const end = Date.now() + 3000;
    let value = "";
    while (Date.now() < end && value !== "ac\nd") {
        value = await call("readText()");
        await sleep(25);
    }
    assert(value === "ac\nd", "the text box has " + JSON.stringify(value) + ", not \"ac\\nd\" (one Enter for \\r\\n)");
    assert(events.slice(mark).filter(function(e) {
        return e["type"] === "keydown" && e["code"] === "Enter";
    }).length === 1, "\\r\\n pressed Enter more than once");

    // outside the text box, so the Tab moves no focus
    await call("blurText()");
    mark = events.length;
    Keyboard.type("\t");
    await waitFor(mark, "Tab keydown", function(e) {
        return e["type"] === "keydown" && e["code"] === "Tab";
    });
});

test("getLockState follows Caps Lock", { "skip": isWayland && "the lock state comes from XWayland" }, async function() {
    await requireFocus();
    const before = Keyboard.getLockState()["capsLock"];
    const toggle = async function() {
        keyDown("CapsLock");
        keyUp("CapsLock");
        await sleep(150);
    };
    await toggle();
    try {
        assert(Keyboard.getLockState()["capsLock"] === !before, "Caps Lock was " + before + " and is still " + Keyboard.getLockState()["capsLock"]);
    } finally {
        await toggle();
    }
    assert(Keyboard.getLockState()["capsLock"] === before, "Caps Lock is not back to " + before);
});


//
// Gamepad
//
// set by probeGamepad() before the tests run
let gamepadReason = "";
const probeGamepad = async function() {
    try {
        (await Gamepad.create()).destroy();
    } catch (error) {
        gamepadReason = "no virtual gamepad: " + error.message;
    }
};

// the pad Chromium shows for our virtual one, found by the index it took
const findPad = async function(before, gamepad) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
        // Chromium exposes gamepads only after a button press
        gamepad.buttonDown(0);
        await sleep(50);
        gamepad.buttonUp(0);
        await sleep(100);
        const pads = await call("readGamepads()");
        const pad = pads.find(function(p) {
            return !before.includes(p["index"]);
        });
        if (pad) {
            return pad["index"];
        }
    }
    throw new Error("Chromium never showed the virtual gamepad");
};

const readPad = async function(index) {
    const pads = await call("readGamepads()");
    return pads.find(function(p) {
        return p["index"] === index;
    });
};

// polls until the pad shows the expected state or the time is up
const waitForPad = async function(index, description, predicate) {
    const end = Date.now() + EVENT_TIMEOUT;
    let pad = null;
    while (Date.now() < end) {
        pad = await readPad(index);
        if (pad && predicate(pad)) {
            return pad;
        }
        await sleep(20);
    }
    throw new Error("Gamepad never showed " + description + "; last state " + JSON.stringify(pad && { "buttons": pad.buttons.map((b) => b.value), "axes": pad.axes }));
};

test("a virtual gamepad shows up in navigator.getGamepads with every button and axis", { "skip": function() { return gamepadReason; } }, async function() {
    const before = (await call("readGamepads()")).map(function(p) {
        return p["index"];
    });
    const gamepad = await Gamepad.create();
    try {
        const index = await findPad(before, gamepad);
        const pad = await readPad(index);
        // macOS: a generic HID gamepad, for which a browser knows no mapping. In
        // the same order, but the analog triggers are axes 4 and 5, and a
        // button's value is 0 or 1. Not seen working: it takes an entitlement.
        const isMac = os.platform() === "darwin";
        const expectedMapping = isMac ? "" : "standard";
        assert(pad["mapping"] === expectedMapping, "mapping is \"" + pad["mapping"] + "\", not \"" + expectedMapping + "\" (" + pad["id"] + ")");

        // buttons 6 and 7 are the triggers, driven by axes 4 and 5 below
        for (let btn = 0; btn < 17; btn++) {
            if (btn === 6 || btn === 7) {
                continue;
            }
            gamepad.buttonDown(btn);
            await waitForPad(index, "button " + btn + " pressed", function(p) {
                return p.buttons[btn].pressed;
            });
            gamepad.buttonUp(btn);
            await waitForPad(index, "button " + btn + " released", function(p) {
                return !p.buttons[btn].pressed;
            });
        }

        for (let axis = 0; axis < 4; axis++) {
            for (const value of [-1, -0.5, 0.5, 1, 0]) {
                gamepad.setAxis(axis, value);
                await waitForPad(index, "axis " + axis + " at " + value, function(p) {
                    return Math.abs(p.axes[axis] - value) <= 0.1;
                });
            }
        }

        // a trigger axis from -1 (released) to 1 (pulled) is button value 0 to 1
        for (const [axis, btn] of [[4, 6], [5, 7]]) {
            for (const value of [1, 0, -1]) {
                gamepad.setAxis(axis, value);
                const expected = (value + 1) / 2;
                await waitForPad(index, "trigger axis " + axis + " at " + value, function(p) {
                    return isMac
                        ? Math.abs(p.axes[axis] - value) <= 0.1 && p.buttons[btn].pressed === (value >= 0)
                        : Math.abs(p.buttons[btn].value - expected) <= 0.1;
                });
            }
        }

        // setState: buttons, an analog trigger and axes in one call
        gamepad.setState({ "buttons": [true, false, true, false, false, false, { "pressed": true, "value": 0.5 }], "axes": [0.5, -0.5] });
        await waitForPad(index, "setState's buttons, trigger and axes", function(p) {
            const isTriggerRight = isMac ? p.buttons[6].pressed && Math.abs(p.axes[4]) <= 0.1 : Math.abs(p.buttons[6].value - 0.5) <= 0.1;
            return p.buttons[0].pressed && !p.buttons[1].pressed && p.buttons[2].pressed &&
                isTriggerRight && Math.abs(p.axes[0] - 0.5) <= 0.1 && Math.abs(p.axes[1] + 0.5) <= 0.1;
        });
        gamepad.setState({ "buttons": [false, false, false, false, false, false, 0], "axes": [0, 0] });
        await waitForPad(index, "setState's release", function(p) {
            const isTriggerReleased = isMac ? !p.buttons[6].pressed && p.axes[4] <= -0.9 : p.buttons[6].value <= 0.1;
            return !p.buttons[0].pressed && !p.buttons[2].pressed && isTriggerReleased && Math.abs(p.axes[0]) <= 0.1;
        });

        // rumble: Chromium plays it on the pad as a game would
        if (os.platform() !== "darwin") {
            const rumbles = [];
            gamepad.onRumble = function(rumble) {
                rumbles.push(rumble);
            };
            const played = call("playRumble(" + index + ", 1, 0.5, 300)", true);
            const end = Date.now() + 3000;
            while (Date.now() < end && !rumbles.some(function(r) { return r.strong > 0.5; })) {
                await sleep(20);
            }
            assert(rumbles.some(function(r) {
                return r.strong > 0.5 && r.weak > 0.2;
            }), "onRumble never got the rumble Chromium played (" + await played + "): " + JSON.stringify(rumbles));
            await played;
            const stopEnd = Date.now() + 3000;
            while (Date.now() < stopEnd && !(rumbles.length > 0 && rumbles[rumbles.length - 1].strong === 0)) {
                await sleep(20);
            }
            assert(rumbles[rumbles.length - 1].strong === 0 && rumbles[rumbles.length - 1].weak === 0,
                "the rumble never stopped: " + JSON.stringify(rumbles));
            gamepad.onRumble = null;
        }

        gamepad.destroy();
        const end = Date.now() + EVENT_TIMEOUT;
        while (Date.now() < end && await readPad(index)) {
            await sleep(20);
        }
        assert(!(await readPad(index)), "the gamepad is still listed after destroy");
    } finally {
        gamepad.destroy();
    }
});


//
// start
//
const main = async function() {
    await app.whenReady();
    const startX = Mouse.getX();
    const startY = Mouse.getY();

    const workArea = screen.getPrimaryDisplay().workArea;
    win = new BrowserWindow({
        "x": workArea.x + 40,
        "y": workArea.y + 40,
        "width": Math.min(1000, workArea.width - 80),
        "height": Math.min(700, workArea.height - 80),
        "alwaysOnTop": true,
        "autoHideMenuBar": true,
        "show": false,
        "webPreferences": {
            "nodeIntegration": true,
            "contextIsolation": false,
            "backgroundThrottling": false
        }
    });
    win.setMenu(null);
    const ready = waitFor(0, "the window to load", function(e) {
        return e["type"] === "ready";
    }, 15000);
    await win.loadFile(path.join(__dirname, "index.html"));
    await ready;
    win.show();
    win.focus();

    // a click on the window makes it the foreground one, where focus() alone
    // may not be allowed to
    const page = await call("regions()");
    regions = {
        "pad": toScreen(page.pad),
        "cross": toScreen(page.cross),
        "text": toScreen(page.text)
    };
    await sleep(300);
    await click(centre(regions.pad)).catch(function() {});
    await sleep(200);

    console.log("easy-control e2e on " + os.platform() + "-" + os.arch() + ", Electron " + process.versions.electron +
        (isWayland ? ", Wayland" : "") + "\n");
    let failed = 1;
    try {
        await probeGamepad();
        failed = await runTests();
    } finally {
        releaseAll();
        Mouse.setPosition(startX, startY);
        app.exit(failed > 0 ? 1 : 0);
    }
};

// a hung test must not keep the mouse and keyboard taken
setTimeout(function() {
    console.log("✖ e2e timed out");
    releaseAll();
    app.exit(1);
}, 180000).unref();

main().catch(function(error) {
    console.error(error);
    releaseAll();
    app.exit(1);
});
