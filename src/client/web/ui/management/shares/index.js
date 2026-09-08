"use strict";

// what this client shares out: the joins it holds the host side of, and the
// connection it is hosting right now. The host answers nothing here - a device
// that comes back is answered by the request dialog wherever the shell happens
// to be - so this screen lists them, says which are online, and lets one be
// forgotten for good.
//
// **A share is not only a record.** A pairing the host did not ask to remember
// leaves no row anywhere, and it is still this device being shared out for as
// long as it stands - so the live room is drawn beside the records, from
// ctx["room"] rather than from ctx["joins"], and goes when it goes. Without it
// the one flow that shares nothing *but* the moment would show nothing here at
// all.
//
// It is also where a connection *arrives*. Every way one is made ends in the
// same room-open on the host, so this screen listens for that one message
// rather than being sent here by each flow in turn - which is the only way the
// unsupervised join is covered at all, since nothing on the host is asked about
// that one and there is no dialog of its own for it to end in.

// first-party dependencies
import { Screen } from "../../../src/view.js";
import { ShareBox } from "./share-box.js";

// how long a room is given to find the connection it is about. A pairing that
// was just remembered is written from the accept answer, and that answer and
// this push cross on the same socket - so the record is a moment behind the
// room rather than missing, and the change that stores it is what ends this
// wait rather than the clock.
const RECORD_WAIT = 3000;

const SharesScreen = class extends Screen {
    static id = "shares";
    static rootId = "screen-shares";

    isOpen = false;

    // build() asks for the records, and asking changes them - who is online is
    // part of what comes back - so the change it makes itself is not one to
    // rebuild for
    isBuilding = false;

    // and a change that arrived while it was building anyway. Only the room's
    // are held: a room does not move because this screen asked something, so
    // answering one cannot start a build that asks for another.
    isPending = false;

    async mount(ctx) {
        this.areaUser = document.getElementById("screen-shares-user");
        this.areaGuest = document.getElementById("screen-shares-guest");
        this.area = document.getElementById("shares-area");
        this.area2 = document.getElementById("shares-area-2");

        // a card is only right while what it was built from is: a device that
        // arrives or goes, a name that was changed in the dialog over this
        // screen, a connection that was deleted from it
        ctx["joins"].addEventListener("change", this.onSharesChange);

        // and the live one is a card too, so the room's edges - and the name it
        // is given in the dialog over this screen - are the same kind of change
        // to this grid as a record's are
        ctx["room"].addEventListener("connecting", this.onRoomChange);
        ctx["room"].addEventListener("closed", this.onRoomChange);
        ctx["room"].addEventListener("name", this.onRoomChange);

        // and a connection that has just been made is this screen's business
        // wherever the host happens to be standing - see below
        ctx["server"].addEventListener("room-open", this.onRoomOpen);
    };

    onSharesChange = () => {
        if (this.isOpen === false || this.isBuilding === true) {
            return;
        }
        this.build();
    };

    // the room going while the grid was being built is a card that would stand
    // there after the connection under it is gone, so it is built again rather
    // than dropped the way a record's own change is
    onRoomChange = () => {
        if (this.isOpen === false) {
            return;
        }
        if (this.isBuilding === true) {
            this.isPending = true;
            return;
        }
        this.build();
    };

    //
    // a connection was just made
    //
    // the host is brought to its own list with that connection's settings open
    // on it, because naming it is the one thing worth doing to a connection the
    // moment it is made. A pairing the host did not remember carries no join
    // id: it leaves nothing behind to name or to forget, so that host stays
    // where it is.
    onRoomOpen = async (event) => {
        const detail = event.detail ?? {};
        if (detail["isHost"] !== true) {
            return;     // the peer goes into the room instead - see ui/room/joining/
        }
        const joinId = detail["joinId"] ?? "";

        // the record the settings will be about, where there is one to wait for.
        // A pairing the host did not remember carries no join id - the room is
        // the whole of it - and the dialog is opened on the room instead.
        const record = (joinId === "" ? undefined : await this.recordOf(joinId));

        // the screen first: opening one closes every dialog over it, so the
        // settings would go with the navigation the other way round
        await this.ctx["ui"].navigate("shares");

        // a join that never arrived is the one case with nothing to open: the
        // card is not on the screen either, so it is said here rather than left
        // as a navigation that did half of what it was for
        if (joinId !== "" && typeof record === "undefined") {
            console.warn("The join " + joinId + " did not arrive, so its settings are not opened");
            return;
        }
        this.ctx["ui"].openDialog("connection", (joinId === ""
            ? {"joinId": "", "isLive": true}
            : {"joinId": joinId}));
    };

    // the record a room is about, waited for rather than asked once: it may
    // still be being written when the room arrives, and joins says so with a
    // change of its own
    recordOf(joinId) {
        const joins = this.ctx["joins"];
        const record = joins.get(joinId);
        if (typeof record !== "undefined") {
            return Promise.resolve(record);
        }
        return new Promise(function(resolve) {
            const onChange = function() {
                const stored = joins.get(joinId);
                if (typeof stored === "undefined") {
                    return;
                }
                clearTimeout(timeoutId);
                joins.removeEventListener("change", onChange);
                resolve(stored);
            };
            const timeoutId = setTimeout(function() {
                joins.removeEventListener("change", onChange);
                resolve(undefined);
            }, RECORD_WAIT);
            joins.addEventListener("change", onChange);
        });
    };

    async build() {
        this.isBuilding = true;
        try {
            do {
                this.isPending = false;
                await this.buildCards();
            } while (this.isPending === true && this.isOpen === true);
        } finally {
            this.isBuilding = false;
            this.isPending = false;
        }
    };

    async buildCards() {
        const ctx = this.ctx;
        const room = ctx["room"];

        // the connection standing right now, and the record it is on when it is
        // on one - a remembered device that is connected is one card that says
        // so, not a second card beside its own
        const isSharing = (room.isSharing() === true);
        const liveJoinId = (isSharing === true ? room.getJoinId() : "");

        let records = [];
        try {
            records = await ctx["joins"].list(true);
        } catch (error) {
            console.error(error);
            return;
        }

        // and only now: the grid emptied before the answer arrives is a screen
        // that blinks on every rebuild, and one that stays empty when the call
        // fails
        this.area2.innerHTML = "";

        const localization = ctx["localization"];
        for (const record of records) {
            const box = new ShareBox(record["joinId"], record["joinCode"]);

            // a card is built long after this module was translated, so it is
            // handed over on its own - the labels in it are markup like any other
            localization.translate(localization.getLang(), box.el);
            box.setName((record["name"] ?? "") !== "" ? record["name"] : localization.get("shares.unnamed"));
            box.setTag("live", liveJoinId !== "" && record["joinId"] === liveJoinId);
            box.setTag("online", record["isOnline"] === true);
            box.setTag("offline", record["isOnline"] !== true);

            // a device that may come and go without anybody being asked is worth
            // saying so on the card, since nothing else will ever mention it
            box.setUnattended(record["isUnsupervised"] === true);

            // forgetting one goes both ways and cannot be undone, so it is
            // asked about first - see confirm() in ui/ui.js
            box.addEventListener("delete", async function(event) {
                const isConfirmed = await ctx["ui"].confirm({"message": "confirm.deleteJoin"});
                if (isConfirmed === false) {
                    return;
                }
                await ctx["joins"].remove(event.detail["joinId"]);
                box.el.remove();
            });

            // the name and the delete of one connection, in one place. The grid
            // follows what it did through the change above rather than being
            // told twice.
            box.addEventListener("settings", function(event) {
                ctx["ui"].openDialog("connection", {"joinId": event.detail["joinId"]});
            });
            this.area2.appendChild(box.el);
        }

        // and the one that is nothing but the connection. It goes first: it is
        // the only card on this screen that is about right now.
        if (isSharing === true && liveJoinId === "") {
            this.area2.prepend(this.buildLiveCard());
        }
    };

    // a share with no record behind it. It carries the same menu as every other
    // card, and both entries mean here what they mean there - as much as they
    // can of a connection that is kept nowhere: the name stands for as long as
    // the connection does, and deleting a share that *is* only a connection is
    // ending it.
    buildLiveCard() {
        const ctx = this.ctx;
        const localization = ctx["localization"];
        const box = new ShareBox();

        localization.translate(localization.getLang(), box.el);
        const name = ctx["room"].getName();
        box.setName(name !== "" ? name : localization.get("shares.live-name"));

        // and only the one chip: "online" beside it would be the connection
        // saying twice over that it is there
        box.setTag("live", true);

        box.addEventListener("settings", function() {
            ctx["ui"].openDialog("connection", {"joinId": "", "isLive": true});
        });
        box.addEventListener("delete", async function() {
            const isConfirmed = await ctx["ui"].confirm({"message": "confirm.endRoom", "confirm": "confirm.end"});
            if (isConfirmed === true) {
                ctx["room"].leave();
            }
        });
        return box.el;
    };

    open(params) {
        this.area.innerHTML = "";
        this.area2.innerHTML = "";
        this.isOpen = true;

        super.open(params);

        // there is no account either, so the area that lists its shares stays
        // out of the way
        this.areaUser.classList.add("hide");
        this.areaGuest.classList.remove("hide");

        this.build();
    };
    close() {
        this.isOpen = false;
        this.area.innerHTML = "";
        this.area2.innerHTML = "";
        super.close();
    };
};

export { SharesScreen, RECORD_WAIT };
export default SharesScreen;
