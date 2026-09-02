"use strict";

// boot, the shell, then the router
//
// Everything the UI shows lives in a module under ./ui, loaded when the router
// first needs it. What is left here is what is on screen before any of them is:
// the two navigation bars, the shared overlay, the loading dialog, and the ctx
// every module reaches the outside world through.

// first-party dependencies
import { browser, width, sizeS, sizeM, domReady } from "./src/env.js";
import { conf, confLoad, setLocal } from "./src/conf.js";
import { desktop, initDesktop } from "./src/desktop.js";
import Server from "./src/server.js";
import localization from "./src/localization.js";
import registry from "./src/registry.js";
import Router from "./src/router.js";

// every UI module, built and mounted before the router runs
//
// The client is a small enough tree of modules that loading them one at a time
// buys nothing and costs a wait on the first click of each, so the whole UI is
// in the document before anything asks for a piece of it. It is also what the
// router needs: it puts a segment on screen by hiding the [data-segment] chrome
// of the other one, and it can only hide what is already there.
//
// A module that mounts into the markup of another one has to follow it, and the
// registry id says which: "settings" carries the markup "settings.appearance"
// mounts into, so the ids are built one dot-depth at a time.
//
// A module that cannot be built is logged and skipped rather than left to take
// the boot down with it - the rest of the UI is still worth having.
const buildUI = async function(router) {
    const ids = registry.ids();
    const depthOf = function(id) {
        return id.split(".").length;
    };
    const depths = [...new Set(ids.map(depthOf))].sort();

    for (const depth of depths) {
        const level = ids.filter(function(id) {
            return depthOf(id) === depth;
        });
        await Promise.all(level.map(async function(id) {
            try {
                await router.load(id);
            } catch (error) {
                console.error("Cannot build UI module " + id + ":", error);
            }
        }));
    }
};

const main = async function() {
    // the Electron modules, if this is running under the desktop shell
    await initDesktop();

    // wait for local conf load and DOM ready
    const val = await Promise.all([confLoad, domReady]);
    conf["local"] = val[0];

    // load local UI conf
    globalThis.ui("theme", conf["local"]["color"]);
    setTimeout(() => {
        let mode = conf["local"]["mode"];
        if (mode === "auto") {
            mode = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        }
        globalThis.ui("mode", mode);
    }, 1);

    let lang = conf["local"]["lang"];
    if (lang === "auto") {
        lang = (navigator.language || navigator.userLanguage).substring(0,2);
    }
    if (localization.supportedLanguages.indexOf(lang) === -1) {
        lang = "en";
    }
    localization.setLang(lang);
    localization.translate(lang);
    if (desktop.isAvailable) {
        desktop.ipcRenderer.invoke("api", "set-lang", lang);
        desktop.ipcRenderer.send("api", "set-tray", conf["local"]["minimizing"]);
    }

    //
    // the shell
    //
    const overlayEl = document.getElementById("dialog-overlay");
    const loadingEl = document.getElementById("dialog-loading");

    // the shared overlay, under the loading layer and under every dialog
    //
    // Both of them raise it, both of them take it down, and they overlap: a
    // dialog that opens its first window asks the router for a module, and the
    // loading layer handed back at the end of that load would take the overlay
    // out from under the dialog that is still open. So the overlay is held by
    // name as well, and it is on screen while anything holds it - blurred while
    // anything holding it asked for the blur. It starts held by the loading
    // layer, which is the state the markup is written in.
    const overlayHolders = new Map([["loading", true]]);
    const applyOverlay = function() {
        if (overlayHolders.size === 0) {
            overlayEl.classList.remove("active");
            overlayEl.classList.remove("blur");
            return;
        }
        overlayEl.classList.add("active");
        overlayEl.classList.toggle("blur", [...overlayHolders.values()].includes(true));
    };
    const overlay = {
        "el": overlayEl,
        "take": function(holder, isBlurred=false) {
            overlayHolders.set(holder, isBlurred);
            applyOverlay();
        },
        "release": function(holder) {
            overlayHolders.delete(holder);
            applyOverlay();
        }
    };

    // the loading layer, over both segments of the shell
    //
    // Two things ask for it and they overlap: the connection, which holds it
    // from boot until the server answers and takes it back the moment it drops,
    // and a module that is slow to arrive. A screen that finishes loading while
    // the socket is down must not hand the layer back, so every holder is named
    // and the layer is on screen while any of them holds it. It starts held by
    // the connection, which is the state the markup is written in.
    const loadingHolders = new Set(["connection"]);
    const loading = {
        "open": function(holder="connection") {
            loadingHolders.add(holder);
            loadingEl.classList.add("active");
            overlay.take("loading", true);
        },
        "close": function(holder="connection") {
            loadingHolders.delete(holder);
            if (loadingHolders.size > 0) {
                return;
            }
            loadingEl.classList.remove("active");
            overlay.release("loading");
        },
        // what replaces the layer rather than waits for it: the version
        // mismatch is terminal, so it takes the layer off whoever holds it and
        // leaves the overlay to the dialog that replaces it
        "dismiss": function() {
            loadingHolders.clear();
            loadingEl.classList.remove("active");
            overlay.release("loading");
        }
    };

    const server = new Server();

    // what every UI module reaches the rest of the application through
    const ctx = {
        "server": server,
        "conf": conf,
        "localization": localization,
        "desktop": desktop,
        "setLocal": setLocal,
        "router": null,
        "ui": {
            "overlay": overlay,
            "loading": loading,
            "env": {"browser": browser, "width": width, "sizeS": sizeS, "sizeM": sizeM},
            "navigate": function(path) { return ctx["router"].navigate(path); },
            "openDialog": function(id, params, isNested) { return ctx["router"].openDialog(id, params, isNested); },
            "closeDialog": function(id) { return ctx["router"].closeDialog(id); },
            "closeDialogs": function() { return ctx["router"].closeDialogs(); },
            "loadModule": function(id) { return ctx["router"].load(id); }
        }
    };
    const router = new Router(ctx);
    ctx["router"] = router;

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
