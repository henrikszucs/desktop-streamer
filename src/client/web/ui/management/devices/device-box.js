"use strict";

// one card in the devices grid. A repeated component, so its markup is a
// template literal here rather than a file of its own - which is also why its
// strings carry data-localization but nothing translates them on their own: the
// card is built long after the module it belongs to was translated, so the
// screen hands each one to translate() as it builds it.

const DeviceBox = class extends EventTarget {
    constructor(joinId="", peerCode="") {
        super();
        const div = document.createElement("div");
        const html = `
            <div class="s12 m6 l3">
                <article class="padding devices-article">
                    <div class="max bold">
                        <span class="device-name">Default name</span>
                        <button class="circle transparent">
                            <i>more_vert</i>
                            <menu class="left no-wrap">
                                <li class="btn-device-settings">
                                    <i>settings</i>
                                    <span data-localization="devices.settings">Settings</span>
                                </li>
                                <li class="btn-device-delete">
                                    <i>delete</i>
                                    <span data-localization="devices.delete">Delete</span>
                                </li>
                            </menu>
                        </button>
                    </div>
                    <a class="wave">
                        <img class="responsive" src="/media/wallpaper.png">
                    </a>
                    <div class="small-padding">
                        <nav>
                            <div>
                                <button class="primary btn-device-connect">
                                    <i class="device-connect-icon">play_arrow</i>
                                    <span class="device-connect-label" data-localization="devices.connect">Connect</span>
                                    <span class="device-offline-label hide" data-localization="devices.offline">Offline</span>
                                </button>
                            </div>
                        </nav>
                    </div>
                </article>
            </div>
        `.trim();
        div.innerHTML = html;
        this.el = div.firstChild;

        this.joinId = joinId;
        this.peerCode = peerCode;

        this.nameEl = this.el.querySelector(".device-name");
        this.connectBtn = this.el.querySelector(".btn-device-connect");
        this.connectIcon = this.el.querySelector(".device-connect-icon");
        this.connectLabel = this.el.querySelector(".device-connect-label");
        this.offlineLabel = this.el.querySelector(".device-offline-label");
        this.settingsBtn = this.el.querySelector(".btn-device-settings");
        this.deleteBtn = this.el.querySelector(".btn-device-delete");

        this.connectBtn.addEventListener("click", () => {
            this.dispatchEvent(new CustomEvent("connect", {"detail": {"joinId": this.joinId, "peerCode": this.peerCode}}));
        });

        this.settingsBtn.addEventListener("click", () => {
            this.dispatchEvent(new CustomEvent("settings", {"detail": {"joinId": this.joinId, "peerCode": this.peerCode}}));
        });

        this.deleteBtn.addEventListener("click", () => {
            this.dispatchEvent(new CustomEvent("delete", {"detail": {"joinId": this.joinId}}));
        });

    };
    setName(name="") {
        this.nameEl.textContent = name;
    };
    // the two labels are both in the markup and one of them is hidden, so the
    // state of the button costs no string here - the card was translated once
    setOnline(isOnline=true) {
        this.connectBtn.classList.toggle("primary", isOnline === true);
        this.connectBtn.classList.toggle("secondary", isOnline === false);
        this.connectBtn.disabled = (isOnline === false);
        this.connectIcon.textContent = (isOnline === true ? "play_arrow" : "pause");
        this.connectLabel.classList.toggle("hide", isOnline === false);
        this.offlineLabel.classList.toggle("hide", isOnline === true);
    };
};

export { DeviceBox };
export default DeviceBox;
