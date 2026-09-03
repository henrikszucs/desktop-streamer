"use strict";

// the contract every UI module keeps - a folder under /ui with this script, its
// view.html, view.css and localization.json. See .claude/CLIENT.md and CLAUDE.md.

const View = class extends EventTarget {
    static id = "";                 // the name the registry knows it by
    static mountPoint = "body";     // the element its markup is appended to
    static rootId = "";             // the id of its own markup, "" for none

    ctx = null;     // the shell, set by the registry before mount()
    el = null;      // its own root element, set by the registry before mount()

    async mount(ctx) {};
    open(params) {};
    close() {};

    // step aside without giving up what open() started, so the two dialogs of
    // one flow can hand the screen to each other
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

// a whole screen, mounted into the surface of its segment - it names the segment
// and the router puts that chrome on screen around it
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

    // what a click outside or a close button asks for - the router does the
    // closing, so the dialog stack stays the one that knows what is open
    requestClose() {
        this.ctx["ui"].closeDialog(this.constructor.id);
    };

    open(params) {
        this.show();
    };
    close() {
        this.hide();
    };
    // the overlay is taken and given back by name, not switched on and off - a
    // module loading while this dialog is open must not take it away
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
