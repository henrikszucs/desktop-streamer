"use strict";

// the desktop client downloads: the operating systems and the architectures the
// server actually built a client for, picked out of conf["http"]["clients"]

// first-party dependencies
import { Screen } from "../../src/view.js";

const DownloadScreen = class extends Screen {
    static id = "downloads";
    static rootId = "screen-downloads";

    async mount(ctx) {
        // convert client list to map
        this.clients = new Map();
        for (let client of ctx["conf"]["http"]["clients"]) {
            client = client.slice(0, client.lastIndexOf("."));
            client = client.split("-");
            let clientSet = this.clients.get(client[0]);
            if (clientSet === undefined) {
                const newClientSet = new Set();
                this.clients.set(client[0], newClientSet);
                clientSet = newClientSet;
            }
            clientSet.add(client[1]);
        }

        // get important elements
        this.downloadWindows = document.getElementById("download-win32");
        this.downloadMacos = document.getElementById("download-macos");
        this.downloadLinux = document.getElementById("download-linux");
        this.downloadx64 = document.getElementById("download-x64");
        this.downloadx86 = document.getElementById("download-x86");
        this.downloadArm64 = document.getElementById("download-arm64");
        this.downloadArm32 = document.getElementById("download-arm32");
        this.downloadFinish = document.getElementById("download-finish");

        // selection and initialization
        if (this.clients.has("win32") === false) {
            this.downloadWindows.classList.add("hide");
        }
        if (this.clients.has("macos") === false) {
            this.downloadMacos.classList.add("hide");
        }
        if (this.clients.has("linux") === false) {
            this.downloadLinux.classList.add("hide");
        }
        this.lastOsChoice = this.downloadWindows;
        this.lastArchChoice = this.downloadx64;
        this.selectedOs = "win32";
        this.selectedArch = "x64";
        this.displayChoice(this.getOS(), this.getArch());

        // set event listeners
        this.downloadWindows.addEventListener("click", () => {
            this.displayChoice("win32");
        });
        this.downloadMacos.addEventListener("click", () => {
            this.displayChoice("macos");
        });
        this.downloadLinux.addEventListener("click", () => {
            this.displayChoice("linux");
        });

        this.downloadx86.addEventListener("click", () => {
            this.displayChoice(undefined, "x86");
        });
        this.downloadx64.addEventListener("click", () => {
            this.displayChoice(undefined, "x64");
        });
        this.downloadArm64.addEventListener("click", () => {
            this.displayChoice(undefined, "arm64");
        });
        this.downloadArm32.addEventListener("click", () => {
            this.displayChoice(undefined, "arm32");
        });

        this.downloadFinish.addEventListener("click", () => {
            const file = this.selectedOs + "-" + this.selectedArch + ".zip";
            console.log("Download client:", file);
            window.open(location.href + file, "_blank");
        });
    };

    open(params) {
        this.displayChoice(undefined, undefined);
        super.open(params);
    };
    close() {
        this.displayChoice(undefined, undefined);
        super.close();
    };

    displayChoice(os, arch) {
        // select OS
        if (os === undefined) {
            os = this.selectedOs;
        }
        let osSet = this.clients.get(os);

        if (osSet === undefined) {
            const iterator = this.clients.entries();
            const value = iterator.next();
            os = value.value[0];
            osSet = value.value[1];
        }
        let newOsChoice = null;
        if (os === "win32") {
            newOsChoice = this.downloadWindows;
        } else if (os === "macos") {
            newOsChoice = this.downloadMacos;
        } else if (os === "linux") {
            newOsChoice = this.downloadLinux;
        }
        this.lastOsChoice.classList.add("border");
        newOsChoice.classList.remove("border");
        this.lastOsChoice = newOsChoice;
        this.selectedOs = os;

        if (osSet.has("x64") === false) {
            this.downloadx64.classList.add("hide");
        } else {
            this.downloadx64.classList.remove("hide");
        }
        if (osSet.has("x86") === false) {
            this.downloadx86.classList.add("hide");
        } else {
            this.downloadx86.classList.remove("hide");
        }
        if (osSet.has("arm64") === false) {
            this.downloadArm64.classList.add("hide");
        } else {
            this.downloadArm64.classList.remove("hide");
        }
        if (osSet.has("arm32") === false) {
            this.downloadArm32.classList.add("hide");
        } else {
            this.downloadArm32.classList.remove("hide");
        }


        // select architecture
        if (arch === undefined) {
            arch = this.selectedArch;
        }
        if (osSet.has(arch) === false) {
            const iterator = osSet.values();
            arch = iterator.next().value;
        }
        let newArchChoice = null;
        if (arch === "x64") {
            newArchChoice = this.downloadx64;
        } else if (arch === "x86") {
            newArchChoice = this.downloadx86;
        } else if (arch === "arm64") {
            newArchChoice = this.downloadArm64;
        } else if (arch === "arm32") {
            newArchChoice = this.downloadArm32;
        }
        if (newArchChoice !== this.lastArchChoice) {
            this.lastArchChoice.classList.add("border");
            newArchChoice.classList.remove("border");
            this.lastArchChoice = newArchChoice;
            this.selectedArch = arch;
        }

    };
    indexOf(array, value) {
        for (let i = 0; i < array.length; i++) {
            if (value.indexOf(array[i]) !== -1) {
                return i;
            }
        }
        return -1;
    };
    getArch() {
        const userAgent = window.navigator.userAgent;
        const x64Platforms = ["x86_64", "AMD64", "x64"];
        const x86Platforms = ["i386", "i686", "x86"];
        const arm64Platforms = ["arm64", "aarch64"];
        const arm32Platforms = ["armv7l", "armv6l", "arm"];

        let arch = "unknown";

        if (this.indexOf(x64Platforms, userAgent) !== -1) {
            arch = "x64";
        } else if (this.indexOf(x86Platforms, userAgent) !== -1) {
            arch = "x86";
        } else if (this.indexOf(arm64Platforms, userAgent) !== -1) {
            arch = "arm64";
        } else if (this.indexOf(arm32Platforms, userAgent) !== -1) {
            arch = "arm32";
        }
        return arch;
    };
    getOS() {
        const userAgent = window.navigator.userAgent;
        const platform = window.navigator?.userAgentData?.platform || window.navigator.platform;
        const macosPlatforms = ["macOS", "Macintosh", "MacIntel", "MacPPC", "Mac68K"];
        const windowsPlatforms = ["Win32", "Win64", "Windows", "WinCE"];
        const iosPlatforms = ["iPhone", "iPad", "iPod"];
        let os = "unknown";

        if (macosPlatforms.indexOf(platform) !== -1) {
            os = "macos";
        } else if (iosPlatforms.indexOf(platform) !== -1) {
            os = "ios";
        } else if (windowsPlatforms.indexOf(platform) !== -1) {
            os = "win32";
        } else if (/Android/.test(userAgent)) {
            os = "android";
        } else if (/Linux/.test(platform)) {
            os = "linux";
        }

        return os;
    };
};

export { DownloadScreen };
export default DownloadScreen;
