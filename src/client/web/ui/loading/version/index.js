"use strict";

// the version mismatch
//
// The client and the server are one build: this is what is left on screen when
// they are not. It is terminal - nothing takes it back off - so it replaces the
// loading layer rather than waiting behind it, and a click outside does not
// close it.

// first-party dependencies
import { Dialog } from "../../../src/view.js";

const VersionDialog = class extends Dialog {
    static id = "version";
    static rootId = "dialog-version";
    static closeOnOverlay = false;
    static blurOverlay = true;

    open(params) {
        const ctx = this.ctx;
        const localization = ctx["localization"];

        document.getElementById("version-numbers").innerText = localization.putParameters(
            localization.get("version.numbers"),
            new Map([["client", params["client"]], ["server", params["server"]]])
        );

        // the desktop client is the one that can be replaced: point it at the
        // HTTP server it was built against, which serves the matching download.
        // A browser tab has nothing to install, so it keeps the message it was
        // translated with and the user is sent to whoever runs the server.
        if (ctx["desktop"].isAvailable) {
            const http = ctx["conf"]["http"];
            const port = (http["port"] === 443) ? "" : (":" + http["port"]);
            const url = "https://" + http["domain"] + port + "/downloads";

            const link = document.getElementById("version-download-link");
            link.innerText = url;
            link.href = url;
            link.addEventListener("click", function(event) {
                event.preventDefault();
                ctx["desktop"].ipcRenderer.invoke("api", "open-external", url);
            });

            document.getElementById("version-message").innerText = localization.get("version.desktop");
            document.getElementById("version-download").classList.remove("hide");
        }

        // nothing is going to hand the loading layer back after this
        ctx["ui"].loading.dismiss();
        super.open(params);
    };
};

export { VersionDialog };
export default VersionDialog;
