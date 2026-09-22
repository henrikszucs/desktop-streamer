"use strict";

// the clipboard of *this* machine, whichever shell the client is in, and the
// two questions a room asks of it: what has been copied here since the last
// time it was asked, and what the other machine has copied. Both ends of a
// room run one of these - the host over the Electron clipboard, the peer over
// the browser's or its own Electron one - so nothing above it knows which
// shell it is in. See .claude/CLIENT.md, "The clipboard".
//
// What the two ends are known to hold is kept here as `seen`: a text put on
// this clipboard *because the other end sent it* is not news to send back, and
// an echo between two watchers is otherwise the whole of what they do.

// how much text crosses. The relay answers a `room-data` call of at most 64 KB
// (DATA_MAX in the server's rooms group) and a JSON string escapes as it goes,
// so the cap is on the text rather than on the message, low enough that the
// worst escaping still fits.
const MAX_LENGTH = 24 * 1024;

const createClipboard = function(ctx) {
    // the desktop shell's, when there is one: synchronous, always readable,
    // and the only one a host in a background window has at all
    const native = (ctx?.["desktop"]?.["isAvailable"] === true ? ctx["desktop"]["clipboard"] ?? null : null);

    // what both ends are known to hold, and a write the browser refused for
    // want of focus - kept for the next gesture rather than lost
    let seen = null;
    let pending = null;

    const web = function() {
        const api = (typeof navigator !== "undefined" ? navigator["clipboard"] ?? null : null);
        return (typeof api?.["readText"] === "function" && typeof api?.["writeText"] === "function" ? api : null);
    };

    // the text on it now, or nothing when this shell will not say - a browser
    // refuses without focus or without the permission, and that is an answer
    // rather than an error to report every time it is asked
    const readLocal = async function() {
        try {
            if (native !== null) {
                return String(native["readText"]() ?? "");
            }
            const api = web();
            if (api === null) {
                return null;
            }
            return String(await api["readText"]() ?? "");
        } catch (error) {
            return null;
        }
    };

    const writeLocal = async function(text) {
        try {
            if (native !== null) {
                native["writeText"](text);
                return true;
            }
            const api = web();
            if (api === null) {
                return false;
            }
            await api["writeText"](text);
            return true;
        } catch (error) {
            return false;
        }
    };

    return {
        // whether there is a clipboard to share at all. A browser that does
        // not hand the page one is what the bar greys its button for.
        "isAvailable": function() {
            return (native !== null || web() !== null);
        },

        // what is on it now is not news: the switch being turned on must not
        // overwrite the other machine with something copied long before it
        "prime": async function() {
            seen = await readLocal();
        },

        // what has been copied here since the last asking, or nothing. The
        // error is the reason there is nothing rather than a second kind of
        // nothing: a refusal is worth saying once, an unchanged clipboard is
        // not.
        "take": async function() {
            const text = await readLocal();
            if (text === null) {
                return {"text": null, "error": "refused"};
            }
            if (text === "" || text === seen) {
                return {"text": null, "error": ""};
            }
            if (text.length > MAX_LENGTH) {
                seen = text;    // asking again every tick would say it every tick
                return {"text": null, "error": "too-large"};
            }
            seen = text;
            return {"text": text, "error": ""};
        },

        // what the other machine copied, onto this one. `seen` moves first, so
        // the watch on this side does not report it straight back.
        "put": async function(text) {
            if (typeof text !== "string" || text.length > MAX_LENGTH) {
                return {"isDone": false, "error": "too-large"};
            }
            seen = text;
            const isDone = await writeLocal(text);
            pending = (isDone === true ? null : text);
            return {"isDone": isDone, "error": (isDone === true ? "" : "pending")};
        },

        // the write a browser refused, tried again. The peer clicking back on
        // the picture is the gesture it was waiting for.
        "flush": async function() {
            if (pending === null) {
                return true;
            }
            const text = pending;
            const isDone = await writeLocal(text);
            if (isDone === true) {
                pending = null;
            }
            return isDone;
        },

        // a new room knows nothing of what the last one put where
        "forget": function() {
            seen = null;
            pending = null;
        }
    };
};

export { createClipboard, MAX_LENGTH };
export default { createClipboard, MAX_LENGTH };
