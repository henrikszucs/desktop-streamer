"use strict";

// boot
//
// Five stages and nothing else: the environment, the configuration, the shell,
// the UI, then the connection. Everything that touches the document - the
// appearance and language settings, the overlay, the loading layer, the
// ctx["ui"] namespace and the build that mounts every module - lives in
// ./ui/ui.js, and every screen and dialog in a module under ./ui.

// first-party dependencies
import { domReady } from "./src/env.js";
import { conf, confLoad, setLocal, resetUser } from "./src/conf.js";
import { desktop, initDesktop } from "./src/desktop.js";
import Server from "./src/server.js";
import localization from "./src/localization.js";
import Router from "./src/router.js";
import { applyTheme, applyLanguage, createUI, buildUI } from "./ui/ui.js";

const main = async function() {
    //
    // the environment
    //
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

    // what every UI module reaches the rest of the application through. The ui
    // namespace and the router both close over ctx, so each is filled in as
    // soon as it exists and neither has to be built before the other.
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

    // the route is opened under the loading layer and the layer lifts off it
    // once it is there, so the first thing on screen is the screen itself
    const switchOnline = async function() {
        router.closeDialogs();
        await router.loadPath();
        loading.close();
    };
    if (server.isOnline) {
        switchOnline();
    }
    server.addEventListener("online", switchOnline);
    // the connection is gone, so nothing on either segment can be acted on:
    // the layer comes back over whichever one is open, and the screen below it
    // is left alone so it is still there when the socket comes back
    server.addEventListener("offline", function() {
        router.closeDialogs();
        loading.open();
    });
    server.addEventListener("version-mismatch", function(event) {
        router.openDialog("version", event.detail);
    });
};
main();
