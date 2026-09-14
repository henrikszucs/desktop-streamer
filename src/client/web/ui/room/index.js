"use strict";

// the room as the peer sees it. The bar under the stream is the peer's half of
// the connection - what it hears, what it drives, and how much of the line the
// host is allowed to spend on it - and every control here ends in the same
// settings object and the same `settings` event, which ctx["stream"] carries
// to the host. The picture itself is the stream's: this screen hands it the
// canvas once and draws the bar from what it reports.

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

// how many pictures a second the host is asked for. It is not priced against
// the line the way a resolution is: the encoder holds the bitrate it was given
// and spends it across however many frames there are, so a higher rate costs
// sharpness inside the same budget rather than bytes the line has not got -
// which is the peer's trade to make, and the picture says how it went.
const FRAMERATES = [24, 30, 45, 60, 120];
const DEFAULT_FRAMERATE = 30;

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
    canvas = null;
    stage = null;
    exitRing = null;
    bar = null;
    relayBtn = null;
    relayIcon = null;
    relayTooltip = null;
    statsEl = null;
    audioBtn = null;
    audioIcon = null;
    audioTooltip = null;
    controlBtn = null;
    controlIcon = null;
    controlTooltip = null;
    bandwidthBtn = null;
    bandwidthLabel = null;
    bandwidthMenu = null;
    screenBtn = null;
    screenLabel = null;
    screenMenu = null;
    resolutionBtn = null;
    resolutionLabel = null;
    resolutionMenu = null;
    framerateBtn = null;
    framerateLabel = null;
    framerateMenu = null;
    fullscreenIcon = null;
    fullscreenTooltip = null;

    // the whole of what this bar decides, and what the `settings` event carries.
    // No screenIndex until the peer chose one: the host shows its primary
    // display until it is asked for another.
    settings = {
        "isAudio": true,
        "isControl": false,
        "bandwidth": DEFAULT_BANDWIDTH,
        "resolution": AUTO,
        "framerate": DEFAULT_FRAMERATE,
        "screenIndex": undefined
    };

    // what the host said it has (the stream's "share" event): its displays,
    // and which of them the picture is of. The menu is drawn from this and
    // nothing else, so a host with one display gets no menu at all.
    screens = [];
    screenIndex = undefined;

    // whether the relay is there for this user at all - asked of the room,
    // which answers for the guest and for an account alike
    isRelayAllowed = false;

    // what the host has to offer besides the picture (the "share" message):
    // sound, and a keyboard and mouse to take. A button for what it has not
    // got is greyed, and nothing until a share has said.
    isAudioAvailable = false;
    isControlAvailable = false;

    // the exit ring's clock, while a shortcut is held
    holdFrameId = -1;

    async mount(ctx) {
        this.canvas = document.getElementById("room-canvas");
        this.stage = document.getElementById("room-stage");
        this.exitRing = document.getElementById("room-exit-ring");
        this.statsEl = document.getElementById("room-stats");

        this.audioBtn = document.getElementById("btn-room-audio");
        this.audioIcon = document.getElementById("btn-room-audio-icon");
        this.audioTooltip = document.getElementById("btn-room-audio-tooltip");
        this.controlBtn = document.getElementById("btn-room-control");
        this.controlIcon = document.getElementById("btn-room-control-icon");
        this.controlTooltip = document.getElementById("btn-room-control-tooltip");
        this.bandwidthBtn = document.getElementById("btn-room-bandwidth");
        this.bandwidthLabel = document.getElementById("room-bandwidth-label");
        this.bandwidthMenu = document.getElementById("room-bandwidth-menu");
        this.screenBtn = document.getElementById("btn-room-screen");
        this.screenLabel = document.getElementById("room-screen-label");
        this.screenMenu = document.getElementById("room-screen-menu");
        this.resolutionBtn = document.getElementById("btn-room-resolution");
        this.resolutionLabel = document.getElementById("room-resolution-label");
        this.resolutionMenu = document.getElementById("room-resolution-menu");
        this.framerateBtn = document.getElementById("btn-room-framerate");
        this.framerateLabel = document.getElementById("room-framerate-label");
        this.framerateMenu = document.getElementById("room-framerate-menu");
        this.fullscreenIcon = document.getElementById("btn-room-fullscreen-icon");
        this.fullscreenTooltip = document.getElementById("btn-room-fullscreen-tooltip");
        this.relayBtn = document.getElementById("btn-room-relay");
        this.relayIcon = document.getElementById("btn-room-relay-icon");
        this.relayTooltip = document.getElementById("btn-room-relay-tooltip");
        this.bar = this.el.querySelector(".room-bar");

        // the switch between the two paths - see toggleRelay()
        this.relayBtn.addEventListener("click", () => {
            this.toggleRelay();
        });

        this.audioBtn.addEventListener("click", () => {
            if (this.isAudioAvailable === true) {
                this.setAudio(this.settings["isAudio"] === false);
            }
        });
        this.controlBtn.addEventListener("click", () => {
            if (this.isControlAvailable === true) {
                this.setControl(this.settings["isControl"] === false);
            }
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
        // room, which is before this screen is on it - see src/room/room.js.
        ctx["room"].addEventListener("connected", this.onRoomConnected);
        ctx["room"].addEventListener("closed", this.onRoomClosed);
        ctx["room"].addEventListener("direct", this.onRoomDirect);

        // the picture: the stream draws on this canvas from now on, and says
        // once a second what it is drawing. The control it takes back on the
        // peer's shortcut is drawn here as the button letting go.
        ctx["stream"].attach(this.canvas);
        ctx["stream"].addEventListener("stats", this.onStreamStats);
        ctx["stream"].addEventListener("control", this.onStreamControl);
        ctx["stream"].addEventListener("share", this.onStreamShare);
        ctx["stream"].addEventListener("hold", this.onStreamHold);

        this.buildBandwidthMenu();
        this.buildResolutionMenu();
        this.buildFramerateMenu();
        this.buildScreenMenu();
        this.setAudio(this.settings["isAudio"]);
        this.setControl(this.settings["isControl"]);
        this.drawBandwidth();
        this.drawResolution();
        this.drawFramerate();
        this.drawScreen();
        this.drawFullscreen();
        this.drawAvailable();
        this.drawRelay(false);
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

    // the host's displays, one row each, from what the host last said it has.
    // Rebuilt on every "share" rather than once, since a display can be
    // plugged in or pulled while the room stands, and the host says so at its
    // next restart.
    buildScreenMenu() {
        this.screenMenu.innerHTML = "";
        for (let index = 0; index < this.screens.length; index++) {
            const item = document.createElement("li");
            item.appendChild(this.buildCheck());
            item.appendChild(this.buildText(this.screenText(index)));
            item.addEventListener("click", () => {
                this.blur(this.screenBtn);
                this.setScreen(index);
            });
            this.screenMenu.appendChild(item);
            item.dataset["screen"] = String(index);
        }
    };

    buildFramerateMenu() {
        this.framerateMenu.innerHTML = "";
        for (const framerate of FRAMERATES) {
            const item = document.createElement("li");
            item.appendChild(this.buildCheck());
            item.appendChild(this.buildText(this.framerateText(framerate)));
            item.addEventListener("click", () => {
                this.blur(this.framerateBtn);
                this.setFramerate(framerate);
            });
            this.framerateMenu.appendChild(item);
            item.dataset["framerate"] = String(framerate);
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

    framerateText(framerate) {
        return this.ctx["localization"].putParameters(
            this.ctx["localization"].get("room.framerate.value"),
            new Map([["value", String(framerate)]])
        );
    };

    // a display by its place in the host's list, counted from one, and the
    // primary one said to be: the numbers are the host's own order, which is
    // the one thing the peer and the host can both point at
    screenText(index) {
        const screen = this.screens[index];
        const key = (screen?.["isPrimary"] === true ? "room.screen.primary" : "room.screen.value");
        return this.ctx["localization"].putParameters(
            this.ctx["localization"].get(key),
            new Map([["value", String(index + 1)]])
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

        const localization = this.ctx["localization"];
        this.audioIcon.innerText = (isAudio === true ? "volume_up" : "volume_off");
        this.audioBtn.classList.toggle("active", isAudio === true && this.isAudioAvailable === true);
        this.audioTooltip.innerText = localization.get(isAudio === true ? "room.audio.mute" : "room.audio.unmute");
        this.emit();
    };

    // the keyboard and the mouse of the host: taken on the canvas by the
    // stream, and given back either here or by holding the exit shortcut on
    // the canvas itself (see src/room/stream-input.js), which lands in
    // onStreamControl below
    setControl(isControl) {
        this.settings["isControl"] = (isControl === true);

        const localization = this.ctx["localization"];
        this.controlIcon.innerText = (isControl === true ? "hand_gesture" : "hand_gesture_off");
        this.controlBtn.classList.toggle("active", isControl === true && this.isControlAvailable === true);
        this.controlTooltip.innerText = localization.get(isControl === true ? "room.control.release" : "room.control.take");
        this.el.classList.toggle("room-controlling", isControl === true);
        this.ctx["stream"].setControl(isControl === true);
        this.emit();
    };

    onStreamControl = (event) => {
        if (event.detail?.["isControl"] === false && this.settings["isControl"] === true) {
            this.setControl(false);
        }
    };

    // what the line is doing. It is only drawn while a picture is being
    // received: a reading of nothing is not a reading.
    onStreamStats = (event) => {
        const stats = event.detail ?? {};
        if (stats["role"] !== "peer" || this.isOpen === false) {
            return;
        }
        const kbps = stats["receivedKbps"] ?? 0;
        const mbps = (kbps >= 1000 ? (kbps / 1000).toFixed(1) + " Mbps" : kbps + " kbps");
        this.statsEl.innerText = (stats["fps"] ?? 0) + " fps · " + mbps
            + ((stats["dropped"] ?? 0) > 0 ? " · " + stats["dropped"] + " dropped" : "");
    };

    // the host started or stopped sharing: a host that stops while the room
    // stands leaves the last picture and says so. What it is sharing comes
    // with the start - its displays, and which the picture is of - and the
    // bar's screen entry is drawn from that: shown for more than one, and
    // marking the one the host reports rather than the one that was asked
    // for, since the host is the one that knows.
    onStreamShare = (event) => {
        const info = event.detail;
        this.screens = (Array.isArray(info?.["screens"]) ? info["screens"] : []);
        this.screenIndex = (Number.isInteger(info?.["screenIndex"]) ? info["screenIndex"] : undefined);
        this.buildScreenMenu();
        this.drawScreen();
        this.setAvailable(info?.["isAudio"] === true, info?.["isControl"] === true);

        if (this.isOpen === false) {
            return;
        }
        if (info === null) {
            this.statsEl.innerText = "";
            this.ctx["ui"].snackbar.show(this.ctx["localization"].get("room.share.ended"));
        }
    };

    // what the host has to offer, from its "share" message. A keyboard taken
    // from a host that then says it has none is let go here, since the host
    // has stopped listening for it either way.
    setAvailable(isAudio, isControl) {
        this.isAudioAvailable = (isAudio === true);
        this.isControlAvailable = (isControl === true);
        if (this.isControlAvailable === false && this.settings["isControl"] === true) {
            this.setControl(false);
        }
        this.drawAvailable();
    };

    // the tooltip says why a greyed tool is greyed, and what a live one does.
    // A greyed tool is never lit: the sound is "on" by default, and a lit
    // button that cannot be pressed reads as a setting rather than a refusal.
    drawAvailable() {
        const localization = this.ctx["localization"];
        this.audioBtn.classList.toggle("room-tool-off", this.isAudioAvailable === false);
        this.controlBtn.classList.toggle("room-tool-off", this.isControlAvailable === false);
        this.audioBtn.classList.toggle("active", this.settings["isAudio"] === true && this.isAudioAvailable === true);
        this.controlBtn.classList.toggle("active", this.settings["isControl"] === true && this.isControlAvailable === true);
        this.audioTooltip.innerText = localization.get(this.isAudioAvailable === false ? "room.audio.none"
            : (this.settings["isAudio"] === true ? "room.audio.mute" : "room.audio.unmute"));
        this.controlTooltip.innerText = localization.get(this.isControlAvailable === false ? "room.control.none"
            : (this.settings["isControl"] === true ? "room.control.release" : "room.control.take"));
    };

    // the exit shortcut being held: the ring fills over the delay, and goes
    // the moment the hold ends - by firing or by a key changing
    onStreamHold = (event) => {
        cancelAnimationFrame(this.holdFrameId);
        this.holdFrameId = -1;
        const delay = event.detail?.["delay"];
        if (typeof delay !== "number" || delay <= 0) {
            this.exitRing.classList.add("hide");
            return;
        }
        const start = performance.now();
        const tick = () => {
            const progress = Math.min(100, (performance.now() - start) / delay * 100);
            this.exitRing.style.setProperty("--p", String(progress));
            this.holdFrameId = (progress < 100 ? requestAnimationFrame(tick) : -1);
        };
        this.exitRing.style.setProperty("--p", "0");
        this.exitRing.classList.remove("hide");
        this.holdFrameId = requestAnimationFrame(tick);
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

    setFramerate(framerate) {
        if (FRAMERATES.includes(framerate) === false) {
            return;
        }
        this.settings["framerate"] = framerate;
        this.drawFramerate();
        this.emit();
    };

    // which of the host's displays to show. The label does not move yet: the
    // host restarts its encoder on the new one and says so in its next
    // "share", which is what the bar draws - so what is marked is what is on
    // screen, and a display the host cannot open is never claimed to be.
    setScreen(index) {
        if (Number.isInteger(index) === false || index < 0 || index >= this.screens.length) {
            return;
        }
        this.settings["screenIndex"] = index;
        this.emit();
    };

    // the stage alone goes fullscreen - the picture, and none of the bar - so
    // the way out is the exit shortcut: the browser's own Escape, or the hold
    // (src/room/stream-input.js) while the keyboard is the host's, which lets
    // the fullscreen go first and the keyboard on a second hold
    toggleFullscreen() {
        if (document.fullscreenElement === null) {
            this.stage.requestFullscreen?.().catch(function(error) {
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

    // the entry is only there when there is a choice to make
    drawScreen() {
        const isChoice = (this.screens.length > 1);
        this.screenBtn.classList.toggle("hide", isChoice === false);
        if (isChoice === false) {
            return;
        }
        const current = (Number.isInteger(this.screenIndex) ? this.screenIndex : 0);
        this.screenLabel.innerText = this.screenText(current);
        for (const item of this.screenMenu.children) {
            const isCurrent = (item.dataset["screen"] === String(current));
            item.classList.toggle("active", isCurrent);
            item.children.item(0).classList.toggle("room-menu-unchecked", isCurrent === false);
        }
    };

    drawFramerate() {
        this.framerateLabel.innerText = this.framerateText(this.settings["framerate"]);
        for (const item of this.framerateMenu.children) {
            const isCurrent = (item.dataset["framerate"] === String(this.settings["framerate"]));
            item.classList.toggle("active", isCurrent);
            item.children.item(0).classList.toggle("room-menu-unchecked", isCurrent === false);
        }
    };

    drawFullscreen() {
        const isFullscreen = (document.fullscreenElement !== null);
        this.fullscreenIcon.innerText = (isFullscreen === true ? "fullscreen_exit" : "fullscreen");
        this.fullscreenTooltip.innerText = this.ctx["localization"].get(isFullscreen === true ? "room.fullscreen.exit" : "room.fullscreen.enter");
    };

    // what the stream is asked for: the event on every change, the same object
    // on demand, and the stream told - it carries the settings to the host
    // when there is one and keeps them for the next one otherwise
    emit() {
        const settings = this.getSettings();
        this.ctx["stream"]?.setSettings(settings);
        this.dispatchEvent(new CustomEvent("settings", {"detail": settings}));
    };

    getSettings() {
        const resolution = this.resolution();
        return {
            "isAudio": this.settings["isAudio"],
            "isControl": this.settings["isControl"],
            "bandwidth": this.settings["bandwidth"],
            "isAutoResolution": (this.settings["resolution"] === AUTO),
            "resolution": resolution["id"],
            "height": resolution["height"],
            "framerate": this.settings["framerate"],
            "screenIndex": this.settings["screenIndex"]
        };
    };

    // the other end is there: the picture is what is missing now, not the path
    // to it, so the room comes out from under its own wait
    onRoomConnected = (event) => {
        this.drawRelay(event.detail?.["isRelay"] === true);
        this.setConnecting(false);
    };

    // what is carrying this room, and the switch: the server (lit), the two
    // devices with the server there behind them (plain), or the two devices
    // with nothing behind them for this user (disabled) - so a peer on a line
    // that keeps dropping can see whether there is a fallback, and take it. A
    // direct path being tried again from the relay turns the icon meanwhile.
    // The permission is asked of the room every time, since who this client is
    // can change between two rooms.
    drawRelay(isRelay) {
        const localization = this.ctx["localization"];
        const room = this.ctx["room"];
        this.isRelayAllowed = (room.isRelayAllowed() === true);
        const isOn = (isRelay === true);
        const isTrying = (isOn === true && room.isTryingDirect?.() === true);
        const isOff = (isOn === false && this.isRelayAllowed === false);

        this.relayIcon.innerText = (isTrying === true ? "sync" : (isOn === true ? "cloud" : "cloud_off"));
        this.relayBtn.classList.toggle("room-relay-on", isOn);
        this.relayBtn.classList.toggle("room-relay-trying", isTrying);
        this.relayBtn.disabled = isOff;
        this.relayTooltip.innerText = localization.get(isTrying === true ? "room.relay.trying"
            : (isOn === true ? "room.relay.on" : (isOff === true ? "room.relay.off" : "room.relay.direct")));
    };

    // the switch itself: off the relay by trying the direct path again, or
    // onto it. Only while the room stands - the wait before that has its own
    // clock, which is what decides the path the first time.
    toggleRelay() {
        const room = this.ctx["room"];
        if (room.isConnected() !== true) {
            return;
        }
        if (room.isRelay() === true) {
            room.useDirect();
        } else {
            room.useRelay();
        }
        this.drawRelay(room.isRelay());
    };

    // a retry started or ended: the button says which, and a retry that did
    // not make it is said in words, since the button just looks as it did
    onRoomDirect = (event) => {
        this.drawRelay(this.ctx["room"].isRelay());
        if (event.detail?.["isTrying"] === false && this.isOpen === true) {
            this.ctx["ui"].snackbar.show(this.ctx["localization"].get("room.relay.failed"), true);
        }
    };

    // and it is not there any more. The wait comes back rather than the screen
    // going: what happens next is the peer's to decide, and the quit button in
    // it is the way out - see ui/room/loading/.
    onRoomClosed = (event) => {
        // the display chosen was chosen of *this* host: the next one is shown
        // from its primary display like any first time
        this.settings["screenIndex"] = undefined;
        this.screens = [];
        this.screenIndex = undefined;
        this.buildScreenMenu();
        this.drawScreen();
        this.emit();
        this.setAvailable(false, false);

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
        this.statsEl.innerText = "";

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
        // the keyboard and the mouse go back with the screen: nothing off it
        // should be driving the host
        if (this.settings["isControl"] === true) {
            this.setControl(false);
        }
        this.onStreamHold({"detail": {"delay": null}});
        this.setConnecting(false);
        // the guard belongs to being in the room, not to the way it was left:
        // the router closes this screen for a navigation, a dropped connection
        // and the leave above alike
        this.setCloseGuard(false);
        super.close();
    };
};

export { RoomScreen, BANDWIDTHS, RESOLUTIONS, FRAMERATES, AUTO, DEFAULT_BANDWIDTH, DEFAULT_FRAMERATE };
export default RoomScreen;
