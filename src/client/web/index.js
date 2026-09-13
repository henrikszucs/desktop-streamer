"use strict";

// boot: the environment, the configuration, the shell, the UI, the connection
// - everything that touches the document is in ./ui/ui.js (see .claude/CLIENT.md)

// first-party dependencies
import { domReady } from "./src/env.js";
import { conf, confLoad, setLocal, resetLocal, getUser, setUser, resetUser } from "./src/conf.js";
import { desktop, initDesktop } from "./src/desktop.js";
import Server from "./src/server.js";
import { createJoins } from "./src/joins.js";
import { createAccount } from "./src/account.js";
import { createRoom } from "./src/room.js";
import localization from "./src/localization.js";
import Router from "./src/router.js";
import { applyScale, applyLocal, createUI, buildUI } from "./ui/ui.js";

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
    applyLocal(conf["local"], desktop);

    //
    // the shell
    //
    const server = new Server();

    // what every UI module reaches the rest of the application through, the ui
    // namespace and the router both close over it
    const ctx = {
        "server": server,
        "conf": conf,
        "joins": null,
        "account": null,
        "room": null,
        "localization": localization,
        "desktop": desktop,
        "setLocal": setLocal,
        "resetLocal": resetLocal,
        "getUser": getUser,
        "setUser": setUser,
        "resetUser": resetUser,
        "router": null,
        "ui": null
    };
    ctx["joins"] = createJoins(ctx);
    ctx["account"] = createAccount(ctx);

    // the live connection between this device and the other one. It is built
    // here rather than by the room screen because it outlives one: the host that
    // accepted a request is on its own screens while it holds one.
    ctx["room"] = createRoom(ctx);
    ctx["ui"] = createUI(ctx);
    const router = new Router(ctx);
    ctx["router"] = router;
    const loading = ctx["ui"].loading;

    // expose for debugging
    console.log(conf);
    globalThis.conf = conf;
    globalThis.localization = localization;
    globalThis.server = server;
    globalThis.room = ctx["room"];
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

        // who this client is comes first: the server holds that per socket, so
        // it is told again on every one, and the screen under the loading layer
        // has to be drawn as that user
        await ctx["account"].resume();

        // the remembered devices are presented before the screen is: a host is
        // only reachable on the joins it has connected, and nothing on screen
        // asks for that - it is what being remembered means
        ctx["joins"].connectAll();

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
