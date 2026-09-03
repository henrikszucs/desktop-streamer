"use strict";

// boot: the environment, the configuration, the shell, the UI, the connection
// - everything that touches the document is in ./ui/ui.js (see .claude/CLIENT.md)

// first-party dependencies
import { domReady } from "./src/env.js";
import { conf, confLoad, setLocal, resetUser } from "./src/conf.js";
import { desktop, initDesktop } from "./src/desktop.js";
import Server from "./src/server.js";
import localization from "./src/localization.js";
import Router from "./src/router.js";
import { applyScale, applyTheme, applyLanguage, createUI, buildUI } from "./ui/ui.js";

const main = async function() {
    // the environment - the size of the UI first, before anything is drawn at
    // the wrong one
    applyScale();
    window.addEventListener("resize", applyScale);

    // the Electron modules, if this is running under the desktop shell
    await initDesktop();

    // wait for local conf load and DOM ready
    const val = await Promise.all([confLoad, domReady]);
    conf["local"] = val[0];

    //
    // the configuration, applied
    //
    applyTheme(conf["local"]);
    const lang = applyLanguage(conf["local"]);
    if (desktop.isAvailable) {
        desktop.ipcRenderer.invoke("api", "set-lang", lang);
        desktop.ipcRenderer.send("api", "set-tray", conf["local"]["minimizing"]);
    }

    //
    // the shell
    //
    const server = new Server();

    // what every UI module reaches the rest of the application through, the ui
    // namespace and the router both close over it
    const ctx = {
        "server": server,
        "conf": conf,
        "localization": localization,
        "desktop": desktop,
        "setLocal": setLocal,
        "resetUser": resetUser,
        "router": null,
        "ui": null
    };
    ctx["ui"] = createUI(ctx);
    const router = new Router(ctx);
    ctx["router"] = router;
    const loading = ctx["ui"].loading;

    // expose for debugging
    console.log(conf);
    globalThis.conf = conf;
    globalThis.localization = localization;
    globalThis.server = server;
    globalThis.desktop = desktop;
    globalThis.router = router;

    //
    // the UI, then the connection
    //
    await buildUI(router);

    router.start();
    server.connect("wss://" + conf["ws"]["domain"] + ":" + conf["ws"]["port"]);

    // the route is opened under the loading layer, which lifts once it is there
    const switchOnline = async function() {
        router.closeDialogs();
        await router.loadPath();
        loading.close();
    };
    if (server.isOnline) {
        switchOnline();
    }
    server.addEventListener("online", switchOnline);
    // the layer comes back over whichever segment is open, the screen below it
    // is left alone so it is still there when the socket returns
    server.addEventListener("offline", function() {
        router.closeDialogs();
        loading.open();
    });
    server.addEventListener("version-mismatch", function(event) {
        router.openDialog("version", event.detail);
    });
};
main();
