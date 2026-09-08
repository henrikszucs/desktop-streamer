"use strict";

// the wait for the *other device*, which is not the wait for the server: the
// shell's own loading layer covers a dropped connection and sits over this one.
// It decides nothing - the button dispatches `quit` and the room screen leaves,
// the way `room-exit` hands its answer back.

// first-party dependencies
import { Dialog } from "../../../src/view.js";

const RoomLoadingDialog = class extends Dialog {
    static id = "room-loading";
    static rootId = "dialog-room-loading";

    // there is nothing behind it to click back to: the room under it is not
    // usable until this wait ends one way or the other
    static closeOnOverlay = false;
    static blurOverlay = true;

    title = null;
    subtitle = null;
    progress = null;

    async mount(ctx) {
        this.title = document.getElementById("room-loading-title");
        this.subtitle = document.getElementById("room-loading-subtitle");
        this.progress = document.getElementById("room-loading-progress");

        document.getElementById("btn-room-loading-quit").addEventListener("click", () => {
            this.dispatchEvent(new CustomEvent("quit"));
        });
    };

    // A wait that is not going to end is not a wait, and a bar that goes on
    // moving over one says the opposite of what is true. Nothing here retries -
    // there is no second attempt to draw - so the button below it becomes the
    // only thing left to do.
    setFailed(isFailed) {
        const localization = this.ctx["localization"];
        this.title.innerText = localization.get(isFailed === true ? "room.loading.failedTitle" : "room.loading.title");
        this.subtitle.innerText = localization.get(isFailed === true ? "room.loading.failed" : "room.loading.subtitle");
        this.progress.classList.toggle("hide", isFailed === true);
    };

    open(params) {
        super.open(params);
        this.setFailed(params?.["isFailed"] === true);
    };
};

export { RoomLoadingDialog };
export default RoomLoadingDialog;
