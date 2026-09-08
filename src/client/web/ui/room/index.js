"use strict";

// the room as the peer sees it. The bar under the stream is the peer's half of
// the connection - what it hears, what it drives, and how much of the line the
// host is allowed to spend on it - and every control here ends in the same
// settings object and the same `settings` event. Nothing carries that to a host
// yet; the stream itself is dev/plans/ws-pairing-joins.md.

// first-party dependencies
import { Screen } from "../../src/view.js";

// what the peer allows the stream to cost, in Mbps. Steps rather than a slider:
// these are the numbers the resolutions below are priced against, so every step
// is the one that buys the next picture rather than a figure nothing answers to.
const BANDWIDTHS = [1, 2, 4, 8, 16, 30, 50];

// and what each picture costs to send. This table is the whole cap: a
// resolution the line cannot carry is refused here, because asking for one is
// not paid in sharpness but in a picture that arrives late and in pieces.
const RESOLUTIONS = [
    {"id": "360p", "height": 360, "bandwidth": 1},
    {"id": "480p", "height": 480, "bandwidth": 2},
    {"id": "720p", "height": 720, "bandwidth": 4},
    {"id": "1080p", "height": 1080, "bandwidth": 8},
    {"id": "1440p", "height": 1440, "bandwidth": 16},
    {"id": "2160p", "height": 2160, "bandwidth": 30}
];

// the entry that takes whatever the line allows and follows it down when the
// bandwidth moves - which is what a peer that has not thought about it wants
const AUTO = "auto";

// the entry an id stands for, or nothing for AUTO, which is not one of them
const resolutionOf = function(id) {
    return RESOLUTIONS.find(function(resolution) {
        return resolution["id"] === id;
    });
};

// what the bar opens on: the room is joined before anybody has an opinion about
// it, and 8 Mbps is a picture at 1080p rather than a choice to make first
const DEFAULT_BANDWIDTH = 8;

// how long the other device is given before the wait stops claiming to be one.
// Nothing here retries - ICE has already spent this long trying - so what the
// clock changes is what the dialog says, not what it does. It is generous on
// purpose: a phone waking a radio up can take a while to gather anything.
const CONNECT_TIMEOUT = 20000;

const RoomScreen = class extends Screen {
    static id = "room";
    static mountPoint = "#room-main";
    static rootId = "screen-room";
    static segment = "room";

    // whether the other device is still being waited for. It is the room's own
    // state and not the shell's: a server that goes away is the loading layer
    // over this whole segment, a host that does not answer is only this.
    isConnecting = false;

    // whether this screen is the one on the surface: the connection outlives it
    // and says so whether anybody is looking or not
    isOpen = false;

    // the wait, and the clock that decides what it says
    loadingView = null;
    connectTimeoutId = -1;

    // the stage and the bar over it, all taken in mount()
    video = null;
    bar = null;
    relayChip = null;
    audioBtn = null;
    audioIcon = null;
    audioTooltip = null;
    controlBtn = null;
    controlIcon = null;
    controlTooltip = null;
    bandwidthBtn = null;
    bandwidthLabel = null;
    bandwidthMenu = null;
    resolutionBtn = null;
    resolutionLabel = null;
    resolutionMenu = null;
    fullscreenIcon = null;
    fullscreenTooltip = null;

    // the whole of what this bar decides, and what the `settings` event carries
    settings = {
        "isAudio": true,
        "isControl": false,
        "bandwidth": DEFAULT_BANDWIDTH,
        "resolution": AUTO
    };

    async mount(ctx) {
        this.video = document.getElementById("room-video");

        this.audioBtn = document.getElementById("btn-room-audio");
        this.audioIcon = document.getElementById("btn-room-audio-icon");
        this.audioTooltip = document.getElementById("btn-room-audio-tooltip");
        this.controlBtn = document.getElementById("btn-room-control");
        this.controlIcon = document.getElementById("btn-room-control-icon");
        this.controlTooltip = document.getElementById("btn-room-control-tooltip");
        this.bandwidthBtn = document.getElementById("btn-room-bandwidth");
        this.bandwidthLabel = document.getElementById("room-bandwidth-label");
        this.bandwidthMenu = document.getElementById("room-bandwidth-menu");
        this.resolutionBtn = document.getElementById("btn-room-resolution");
        this.resolutionLabel = document.getElementById("room-resolution-label");
        this.resolutionMenu = document.getElementById("room-resolution-menu");
        this.fullscreenIcon = document.getElementById("btn-room-fullscreen-icon");
        this.fullscreenTooltip = document.getElementById("btn-room-fullscreen-tooltip");
        this.relayChip = document.getElementById("room-relay");
        this.bar = this.el.querySelector(".room-bar");

        this.audioBtn.addEventListener("click", () => {
            this.setAudio(this.settings["isAudio"] === false);
        });
        this.controlBtn.addEventListener("click", () => {
            this.setControl(this.settings["isControl"] === false);
        });
        document.getElementById("btn-room-fullscreen").addEventListener("click", () => {
            this.toggleFullscreen();
        });
        document.addEventListener("fullscreenchange", () => {
            this.drawFullscreen();
        });

        // leaving is asked about rather than done - see requestLeave() below
        document.getElementById("btn-room-leave").addEventListener("click", () => {
            this.requestLeave();
        });

        // what the wait is for. The connection is the shell's, not this
        // screen's: it is negotiated from the moment the server says there is a
        // room, which is before this screen is on it - see src/room.js.
        ctx["room"].addEventListener("connected", this.onRoomConnected);
        ctx["room"].addEventListener("closed", this.onRoomClosed);

        this.buildBandwidthMenu();
        this.buildResolutionMenu();
        this.setAudio(this.settings["isAudio"]);
        this.setControl(this.settings["isControl"]);
        this.drawBandwidth();
        this.drawResolution();
        this.drawFullscreen();
    };

    //
    // the two menus
    //
    // both are built from the tables above rather than written into the markup,
    // so a price that changes changes in one place
    buildBandwidthMenu() {
        this.bandwidthMenu.innerHTML = "";
        for (const bandwidth of BANDWIDTHS) {
            const item = document.createElement("li");
            item.appendChild(this.buildCheck());
            item.appendChild(this.buildText(this.bandwidthText(bandwidth)));
            item.addEventListener("click", () => {
                this.blur(this.bandwidthBtn);
                this.setBandwidth(bandwidth);
            });
            this.bandwidthMenu.appendChild(item);
            item.dataset["bandwidth"] = String(bandwidth);
        }
    };

    buildResolutionMenu() {
        const localization = this.ctx["localization"];
        this.resolutionMenu.innerHTML = "";

        const entries = [{"id": AUTO}, ...RESOLUTIONS];
        for (const entry of entries) {
            const item = document.createElement("li");
            item.appendChild(this.buildCheck());
            item.appendChild(this.buildText(entry["id"] === AUTO ? localization.get("room.resolution.auto") : entry["id"]));

            // what the entry would cost, shown on the ones the line cannot pay
            // for: an entry that is greyed with no reason beside it says nothing
            const need = document.createElement("span");
            need.className = "room-menu-need";
            if (entry["id"] !== AUTO) {
                need.innerText = this.bandwidthText(entry["bandwidth"]);
            }
            item.appendChild(need);

            item.addEventListener("click", () => {
                this.blur(this.resolutionBtn);
                this.setResolution(entry["id"]);
            });
            this.resolutionMenu.appendChild(item);
            item.dataset["resolution"] = entry["id"];
        }
    };

    // the mark of the entry in force. It is in every row and hidden in all but
    // one, so choosing does not move the text of the rows beside it.
    buildCheck() {
        const icon = document.createElement("i");
        icon.className = "room-menu-check";
        icon.innerText = "check";
        return icon;
    };

    buildText(text) {
        const span = document.createElement("span");
        span.className = "max";
        span.innerText = text;
        return span;
    };

    bandwidthText(bandwidth) {
        return this.ctx["localization"].putParameters(
            this.ctx["localization"].get("room.bandwidth.value"),
            new Map([["value", String(bandwidth)]])
        );
    };

    // a beercss menu stands while its holder has the focus, so a choice is only
    // taken once the holder gives it up - the router does the same for a route
    blur(holder) {
        holder?.blur?.();
    };

    //
    // the cap
    //
    // the best picture this bandwidth pays for. Every resolution below it is
    // allowed, everything above it is not - and there is always one, since the
    // smallest costs the least the bar can be set to.
    cap() {
        let allowed = RESOLUTIONS[0];
        for (const resolution of RESOLUTIONS) {
            if (resolution["bandwidth"] <= this.settings["bandwidth"]) {
                allowed = resolution;
            }
        }
        return allowed;
    };

    // the one that was chosen by name, or nothing for the entry that has no name
    // of its own
    chosen() {
        return resolutionOf(this.settings["resolution"]);
    };

    // and what is actually asked for: `auto` is the cap, and a named one is
    // never above it, because setBandwidth brings it down when the cap moves
    resolution() {
        return this.chosen() ?? this.cap();
    };

    //
    // the controls
    //
    setAudio(isAudio) {
        this.settings["isAudio"] = (isAudio === true);
        this.video.muted = (isAudio !== true);

        const localization = this.ctx["localization"];
        this.audioIcon.innerText = (isAudio === true ? "volume_up" : "volume_off");
        this.audioBtn.classList.toggle("active", isAudio === true);
        this.audioTooltip.innerText = localization.get(isAudio === true ? "room.audio.mute" : "room.audio.unmute");
        this.emit();
    };

    // the keyboard and the mouse of the host. Nothing is sent yet - what this
    // marks is what the peer is asking for when the relay lands.
    setControl(isControl) {
        this.settings["isControl"] = (isControl === true);

        const localization = this.ctx["localization"];
        this.controlIcon.innerText = (isControl === true ? "hand_gesture" : "hand_gesture_off");
        this.controlBtn.classList.toggle("active", isControl === true);
        this.controlTooltip.innerText = localization.get(isControl === true ? "room.control.release" : "room.control.take");
        this.emit();
    };

    // the line, and the cap that hangs off it: a picture the new bandwidth
    // cannot carry is not left standing on screen, it is brought down to the one
    // that fits and the peer is told which - the alternative is a resolution
    // that is set to something it is not being sent at
    setBandwidth(bandwidth) {
        this.settings["bandwidth"] = bandwidth;

        const chosen = this.chosen();
        if (typeof chosen !== "undefined" && chosen["bandwidth"] > bandwidth) {
            const cap = this.cap();
            this.settings["resolution"] = cap["id"];

            const localization = this.ctx["localization"];
            this.ctx["ui"].snackbar.show(localization.putParameters(localization.get("room.resolution.lowered"), new Map([
                ["from", chosen["id"]],
                ["to", cap["id"]]
            ])));
        }

        this.drawBandwidth();
        this.drawResolution();
        this.emit();
    };

    // a resolution over the cap is not refused here with a message: the entry
    // that would ask for one is inert and carries what it would cost, so this is
    // only ever reached for one the line can pay for
    setResolution(id) {
        const wanted = resolutionOf(id);
        if (typeof wanted !== "undefined" && wanted["bandwidth"] > this.settings["bandwidth"]) {
            return;
        }
        this.settings["resolution"] = id;
        this.drawResolution();
        this.emit();
    };

    toggleFullscreen() {
        if (document.fullscreenElement === null) {
            this.el.requestFullscreen?.().catch(function(error) {
                console.error("Cannot open fullscreen:", error);
            });
            return;
        }
        document.exitFullscreen?.().catch(function(error) {
            console.error("Cannot leave fullscreen:", error);
        });
    };

    //
    // what the bar shows of all that
    //
    drawBandwidth() {
        this.bandwidthLabel.innerText = this.bandwidthText(this.settings["bandwidth"]);
        for (const item of this.bandwidthMenu.children) {
            const isCurrent = (item.dataset["bandwidth"] === String(this.settings["bandwidth"]));
            item.classList.toggle("active", isCurrent);
            item.children.item(0).classList.toggle("room-menu-unchecked", isCurrent === false);
        }
    };

    drawResolution() {
        const localization = this.ctx["localization"];
        const cap = this.cap();
        const isAuto = (this.settings["resolution"] === AUTO);

        // the label says what is being asked for, and for `auto` what that comes
        // out as - a bar that only said "auto" would never say what is on screen
        this.resolutionLabel.innerText = (isAuto === true
            ? localization.putParameters(localization.get("room.resolution.autoValue"), new Map([["value", cap["id"]]]))
            : this.resolution()["id"]);

        for (const item of this.resolutionMenu.children) {
            const id = item.dataset["resolution"];
            const entry = resolutionOf(id);
            const isBlocked = (typeof entry !== "undefined" && entry["bandwidth"] > this.settings["bandwidth"]);
            const isCurrent = (id === this.settings["resolution"]);

            item.classList.toggle("active", isCurrent);
            item.classList.toggle("room-menu-blocked", isBlocked);
            item.children.item(0).classList.toggle("room-menu-unchecked", isCurrent === false);

            // the price is what says why an entry is greyed, so it is only
            // beside the ones that are
            item.children.item(2).classList.toggle("hide", isBlocked === false);
        }
    };

    drawFullscreen() {
        const isFullscreen = (document.fullscreenElement !== null);
        this.fullscreenIcon.innerText = (isFullscreen === true ? "fullscreen_exit" : "fullscreen");
        this.fullscreenTooltip.innerText = this.ctx["localization"].get(isFullscreen === true ? "room.fullscreen.exit" : "room.fullscreen.enter");
    };

    // what the stream is asked for, for whoever wires one to this screen: the
    // event on every change, and the same object on demand
    emit() {
        this.dispatchEvent(new CustomEvent("settings", {"detail": this.getSettings()}));
    };

    getSettings() {
        const resolution = this.resolution();
        return {
            "isAudio": this.settings["isAudio"],
            "isControl": this.settings["isControl"],
            "bandwidth": this.settings["bandwidth"],
            "isAutoResolution": (this.settings["resolution"] === AUTO),
            "resolution": resolution["id"],
            "height": resolution["height"]
        };
    };

    // the other end is there: the picture is what is missing now, not the path
    // to it, so the room comes out from under its own wait
    onRoomConnected = (event) => {
        this.drawRelay(event.detail?.["isRelay"] === true);
        this.setConnecting(false);
    };

    // what is carrying this room, and it is only said when it is the slow one:
    // a direct connection is what everybody expects, and an indicator for the
    // expected thing is one more light to learn to ignore
    drawRelay(isRelay) {
        this.relayChip.classList.toggle("hide", isRelay !== true);
        this.bar.classList.toggle("room-bar-relayed", isRelay === true);
    };

    // and it is not there any more. The wait comes back rather than the screen
    // going: what happens next is the peer's to decide, and the quit button in
    // it is the way out - see ui/room/loading/.
    onRoomClosed = (event) => {
        if (this.isOpen === false) {
            return;
        }
        if (event.detail?.["reason"] === "left") {
            return;     // this side left it, and is on its way out already
        }

        // the connection is over and nothing is trying for another one, so the
        // wait it goes back to says so rather than turning a bar for ever
        this.drawRelay(false);
        this.setConnecting(true, true);
        this.ctx["ui"].snackbar.show(this.ctx["localization"].get("room.connection.lost"), true);
    };

    //
    // waiting for the other device
    //
    // the room is on screen under it, because what is waited for is the picture
    // and not the room. Nothing reports one yet (dev/plans/ws-pairing-joins.md).
    async setConnecting(isConnecting, isFailed = false) {
        this.isConnecting = (isConnecting === true);
        clearTimeout(this.connectTimeoutId);
        this.connectTimeoutId = -1;

        if (this.isConnecting === false) {
            this.loadingView = null;
            this.ctx["ui"].closeDialog("room-loading");
            return;
        }

        // a wait that is still one is given its clock: what runs out is the
        // claim that something is happening, not the connection itself
        if (isFailed === false) {
            this.connectTimeoutId = setTimeout(() => {
                this.loadingView?.setFailed?.(true);
            }, CONNECT_TIMEOUT);
        }

        const view = await this.ctx["ui"].openDialog("room-loading", {"isFailed": isFailed});

        // it arrived while the dialog was still loading, so the wait is over
        // before it was ever on screen
        if (this.isConnecting === false) {
            this.ctx["ui"].closeDialog("room-loading");
            return;
        }
        this.loadingView = view ?? null;

        // the same listener twice is not two listeners - it is one function on
        // one target, so re-opening the wait does not stack them
        view?.addEventListener("quit", this.onQuit);
    };

    // the way out of a wait that is not ending: no question is asked, because
    // the host that would have to answer one is the thing that is not answering
    onQuit = () => {
        this.leave();
    };

    //
    // leaving
    //
    // the button asks, and only the answer acts: a room is left by mistake with
    // one click otherwise, and the way back in is a request somebody has to
    // answer
    async requestLeave() {
        const view = await this.ctx["ui"].openDialog("room-exit", {});
        view?.addEventListener("done", this.onExitDone, {"once": true});
    };

    onExitDone = (event) => {
        if (event.detail?.["isConfirmed"] !== true) {
            return;
        }
        this.leave();
    };

    leave() {
        // the connection goes with the room: the other end is told through the
        // server rather than left negotiating with a screen that is gone
        this.ctx["room"].leave();
        this.ctx["ui"].navigate("new");
    };

    // and the same question for the window itself. The two shells ask it in
    // their own way and neither is this application's dialog: a browser tab is
    // held by `beforeunload` and answers with the browser's own wording, and
    // Electron cancels a close silently when a renderer holds it that way, so
    // the desktop shell is handed the question and asks it natively - see
    // set-close-guard in src/client/electron/main.js.
    setCloseGuard(isGuarded) {
        const desktop = this.ctx["desktop"];
        if (desktop.isAvailable === true) {
            const localization = this.ctx["localization"];
            desktop.ipcRenderer.invoke("api", "set-close-guard", isGuarded === false ? null : {
                "title": localization.get("room.system.title"),
                "message": localization.get("room.system.question"),
                "confirm": localization.get("room.system.confirm"),
                "cancel": localization.get("room.system.cancel")
            });
            return;
        }
        if (isGuarded === true) {
            window.addEventListener("beforeunload", this.onBeforeUnload);
            return;
        }
        window.removeEventListener("beforeunload", this.onBeforeUnload);
    };

    // the browser asks it, in its own words: the text of this dialog has not
    // been the page's to write for years, only whether there is one
    onBeforeUnload = (event) => {
        event.preventDefault();
        event.returnValue = "";
        return "";
    };

    open(params) {
        super.open(params);
        this.isOpen = true;
        this.setCloseGuard(true);

        // A room is entered *for* something, and either the path or the flow
        // says so - see CLIENT.md, "The room". A connection that is already up
        // is not waited for: the socket that reopened this screen is not the one
        // carrying it.
        const joinId = params?.["path"]?.[0];
        const isEntered = (params?.["isConnecting"] === true || (typeof joinId === "string" && joinId !== ""));
        this.drawRelay(this.ctx["room"].isRelay());
        this.setConnecting(isEntered === true && this.ctx["room"].isConnected() === false);
    };
    close() {
        this.isOpen = false;
        this.setConnecting(false);
        // the guard belongs to being in the room, not to the way it was left:
        // the router closes this screen for a navigation, a dropped connection
        // and the leave above alike
        this.setCloseGuard(false);
        super.close();
    };
};

export { RoomScreen, BANDWIDTHS, RESOLUTIONS, AUTO, DEFAULT_BANDWIDTH };
export default RoomScreen;
