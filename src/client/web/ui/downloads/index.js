"use strict";

// the desktop client downloads, chosen in two steps: the operating system, then
// the architecture that operating system was built for
//
// The list comes from the generated index.json this client was served with, so
// it names exactly the zips this build wrote beside it (see buildConfFile in
// src/server/building.js). A server that built none shows the empty state and
// offers nothing - the second step only ever offers the architectures the
// operating system picked in the first one actually has.

// first-party dependencies
import { Screen } from "../../src/view.js";

// The build names its targets after the folders in ./bin, which follow node's
// own platform and architecture names, while the markup and the detection below
// were written with the names a user reads. Every spelling of the same thing is
// listed here, mapped onto the one name the screen holds it under, so a zip is
// never dropped for the name it carries.
const OS_NAMES = new Map([
    ["win32", "win32"],
    ["darwin", "darwin"],
    ["macos", "darwin"],
    ["linux", "linux"]
]);
const ARCH_NAMES = new Map([
    ["x64", "x64"],
    ["x86", "x86"],
    ["ia32", "x86"],
    ["arm64", "arm64"],
    ["arm32", "arm32"],
    ["arm", "arm32"],
    ["armv7l", "arm32"]
]);

// the button behind each of those names
const OS_BUTTONS = new Map([
    ["win32", "download-win32"],
    ["darwin", "download-macos"],
    ["linux", "download-linux"]
]);
const ARCH_BUTTONS = new Map([
    ["x64", "download-x64"],
    ["x86", "download-x86"],
    ["arm64", "download-arm64"],
    ["arm32", "download-arm32"]
]);

const DownloadScreen = class extends Screen {
    static id = "downloads";
    static rootId = "screen-downloads";

    // os -> arch -> the file name of the zip, so the download never has to put
    // the name back together out of the two halves it was split by
    clients = new Map();
    selectedOs = "";
    selectedArch = "";

    // the zips this server built, from the configuration it was served with
    clientList() {
        const clients = this.ctx["conf"]["clients"];
        if (Array.isArray(clients) === false) {
            return [];
        }
        return clients;
    };

    async mount(ctx) {
        // convert client list to map
        const clients = this.clientList();
        for (const client of clients) {
            const name = client.slice(0, client.lastIndexOf("."));
            const parts = name.split("-");
            if (parts.length !== 2) {
                continue;
            }
            const os = OS_NAMES.get(parts[0]);
            const arch = ARCH_NAMES.get(parts[1]);
            if (os === undefined || arch === undefined) {
                continue;   // nothing on this screen could select it
            }
            let archs = this.clients.get(os);
            if (archs === undefined) {
                archs = new Map();
                this.clients.set(os, archs);
            }
            archs.set(arch, client);
        }

        // get important elements
        this.choice = document.getElementById("download-choice");
        this.empty = document.getElementById("download-empty");
        this.downloadFinish = document.getElementById("download-finish");
        this.osButtons = new Map();
        for (const [os, id] of OS_BUTTONS) {
            this.osButtons.set(os, document.getElementById(id));
        }
        this.archButtons = new Map();
        for (const [arch, id] of ARCH_BUTTONS) {
            this.archButtons.set(arch, document.getElementById(id));
        }

        // hide the operating systems this server has no client for
        for (const [os, button] of this.osButtons) {
            if (this.clients.has(os) === true) {
                button.classList.remove("hide");
            } else {
                button.classList.add("hide");
            }
        }

        // set event listeners
        for (const [os, button] of this.osButtons) {
            button.addEventListener("click", () => {
                this.displayChoice(os, undefined);
            });
        }
        for (const [arch, button] of this.archButtons) {
            button.addEventListener("click", () => {
                this.displayChoice(undefined, arch);
            });
        }
        this.downloadFinish.addEventListener("click", () => {
            this.download();
        });

        // selection and initialization
        this.displayChoice(this.getOS(), this.getArch());
    };

    open(params) {
        this.displayChoice(undefined, undefined);
        super.open(params);
    };
    close() {
        this.displayChoice(undefined, undefined);
        super.close();
    };

    // the choice, kept on something this server actually built: an unknown or
    // unbuilt os or architecture falls back to the first one there is
    displayChoice(os, arch) {
        // a server with no desktop client at all has nothing to choose from
        if (this.clients.size === 0) {
            this.choice.classList.add("hide");
            this.empty.classList.remove("hide");
            this.downloadFinish.disabled = true;
            return;
        }
        this.choice.classList.remove("hide");
        this.empty.classList.add("hide");
        this.downloadFinish.disabled = false;

        // select OS
        os = OS_NAMES.get(os);
        arch = ARCH_NAMES.get(arch);
        if (os === undefined || this.clients.has(os) === false) {
            os = this.selectedOs;
        }
        if (this.clients.has(os) === false) {
            os = this.clients.keys().next().value;
        }
        const archs = this.clients.get(os);
        this.selectedOs = os;
        for (const [name, button] of this.osButtons) {
            if (name === os) {
                button.classList.remove("border");
            } else {
                button.classList.add("border");
            }
        }

        // select architecture, out of the ones this os was built for
        if (arch === undefined || archs.has(arch) === false) {
            arch = this.selectedArch;
        }
        if (archs.has(arch) === false) {
            arch = archs.keys().next().value;
        }
        this.selectedArch = arch;
        for (const [name, button] of this.archButtons) {
            if (archs.has(name) === false) {
                button.classList.add("hide");
                button.classList.add("border");
                continue;
            }
            button.classList.remove("hide");
            if (name === arch) {
                button.classList.remove("border");
            } else {
                button.classList.add("border");
            }
        }
    };

    // the zips sit at the root of the HTTP server, next to the web client
    //
    // The browser is served by that server, so a root absolute URL reaches them
    // - the route the screen sits on is not part of the path. The desktop shell
    // is served by its own local:// protocol instead, so it has to be told where
    // the server is, and hands the link to the system browser.
    download() {
        const archs = this.clients.get(this.selectedOs);
        if (archs === undefined) {
            return;
        }
        const file = archs.get(this.selectedArch);
        if (file === undefined) {
            return;
        }

        const desktop = this.ctx["desktop"];
        if (desktop.isAvailable === false) {
            window.open(new URL("/" + file, location.href).href, "_blank");
            return;
        }
        const http = this.ctx["conf"]["http"];
        const port = (http["port"] === 443) ? "" : (":" + http["port"]);
        desktop.ipcRenderer.invoke("api", "open-external", "https://" + http["domain"] + port + "/" + file);
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
