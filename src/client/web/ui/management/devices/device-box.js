"use strict";

// one card in the devices grid. A repeated component, so its markup is a
// template literal here rather than a file of its own.

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
                                    Settings
                                </li>
                                <li class="btn-device-delete">
                                    <i>delete</i>
                                    Delete
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
                                    <i>play_arrow</i>
                                    <span>Connect</span>
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
    setOnline(isOnline=true) {
        if (isOnline) {
            this.connectBtn.classList.remove("secondary");
            this.connectBtn.classList.add("primary");
            this.connectBtn.disabled = false;
            this.connectBtn.children.item(0).innerHTML = "play_arrow";
            this.connectBtn.children.item(1).innerText = "Connect";
        } else {
            this.connectBtn.classList.remove("primary");
            this.connectBtn.classList.add("secondary");
            this.connectBtn.disabled = true;
            this.connectBtn.children.item(0).innerHTML = "pause";
            this.connectBtn.children.item(1).innerText = "Offline";
        }
    };
};

export { DeviceBox };
export default DeviceBox;
