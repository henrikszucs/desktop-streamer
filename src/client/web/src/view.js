"use strict";

// the contract every UI module keeps
//
//     export default class extends Screen {
//         static id = "devices";
//         static rootId = "screen-devices";
//
//         async mount(ctx) {}      // once, after the markup is in the DOM
//         open(params) {}          // shown
//         close() {}               // hidden
//         destroy() {}             // optional, release heavy state
//     };
//
// A module is a folder under /ui holding this script, its view.html, its
// view.css and its localization.json - the registry names the three beside the
// script and has them loaded before mount() runs.
//
// A screen also names the segment of the shell it opens in - "management", the
// navigation bars and the main surface, or "room", the whole window - and the
// router switches the chrome to match. The loading layer is over both of them
// and belongs to neither.
//
// ctx is the only way a module reaches anything outside itself:
// {"server", "conf", "setLocal", "resetUser", "localization", "router", "desktop", "ui"}. A module
// that has to talk upward dispatches an event on itself, nothing reaches into
// its fields.

const View = class extends EventTarget {
    static id = "";                 // the name the registry knows it by
    static mountPoint = "body";     // the element its markup is appended to
    static rootId = "";             // the id of its own markup, "" for none

    ctx = null;     // the shell, set by the registry before mount()
    el = null;      // its own root element, set by the registry before mount()

    async mount(ctx) {};
    open(params) {};
    close() {};

    // visually step aside without giving up whatever open() started, the pair
    // of dialogs of one flow use it to hand the screen to each other
    show() {
        this.open();
    };
    hide() {
        this.close();
    };

    destroy() {};
};

// a piece of markup that is on screen or is not: the screens, and the windows
// inside the settings and account dialogs
const Panel = class extends View {
    open(params) {
        this.el.classList.remove("hide");
    };
    close() {
        this.el.classList.add("hide");
    };
};

// a whole screen, mounted into the surface of the segment it belongs to
//
// A screen names its segment, the router puts the chrome of that segment on
// screen around it: "management" carries the two navigation bars and the main
// surface, "room" carries none and takes the whole window. See src/router.js.
const Screen = class extends Panel {
    static mountPoint = "#screen-main";
    static segment = "management";
};

// a dialog over the shared overlay
const Dialog = class extends View {
    static mountPoint = "body";
    static closeOnOverlay = true;
    static blurOverlay = false;

    onOverlayClick = () => {
        this.requestClose();
    };

    // what a click outside or a close button asks for, the router does the
    // closing so the dialog stack stays the one that knows what is open
    requestClose() {
        this.ctx["ui"].closeDialog(this.constructor.id);
    };

    open(params) {
        this.show();
    };
    close() {
        this.hide();
    };
    // the overlay is shared with the loading layer and with every other dialog,
    // so it is taken and given back by name rather than switched on and off -
    // a module loading while this dialog is open must not take it away
    show() {
        const overlay = this.ctx["ui"].overlay;
        overlay.take(this.constructor.id, this.constructor.blurOverlay === true);
        this.el.classList.add("active");
        if (this.constructor.closeOnOverlay === true) {
            overlay.el.addEventListener("click", this.onOverlayClick);
        }
    };
    hide() {
        const overlay = this.ctx["ui"].overlay;
        overlay.release(this.constructor.id);
        this.el.classList.remove("active");
        overlay.el.removeEventListener("click", this.onOverlayClick);
    };
};

export { View, Panel, Screen, Dialog };
export default { View, Panel, Screen, Dialog };
