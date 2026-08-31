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

// the modules pulled in while nothing is waiting for them, so the first click
// on one of them is not the first time the browser hears about it
const PREFETCH = ["downloads", "settings", "devices", "shares", "menu", "login",
    "room-create", "room-request", "room-joining", "account"];

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
    const overlay = document.getElementById("dialog-overlay");
    const loadingEl = document.getElementById("dialog-loading");
    const loading = {
        "open": function() {
            loadingEl.classList.add("active");
            overlay.classList.add("blur");
            overlay.classList.add("active");
        },
        "close": function() {
            loadingEl.classList.remove("active");
            overlay.classList.remove("blur");
            overlay.classList.remove("active");
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
    // the user menu of the top bar, on screen whatever the route is
    //
    const userBtn = document.getElementById("btn-user");
    const menuLoggedOut = document.getElementById("btn-user-menu-logged-out");
    const menuLoggedIn = document.getElementById("btn-user-menu-logged-in");
    server.addEventListener("user-data", function(event) {
        if (event.detail.type === "picture") {
            userBtn.src = event.detail.value;
        }
    });
    server.addEventListener("login", async function() {
        userBtn.src = await server.getUserData("picture");
        menuLoggedIn.classList.remove("hide");
        menuLoggedOut.classList.add("hide");
        router.loadPath();
    });
    server.addEventListener("logout", function() {
        userBtn.src = "/media/guest.svg";
        menuLoggedIn.classList.add("hide");
        menuLoggedOut.classList.remove("hide");
        router.loadPath();
    });
    document.getElementById("btn-logout").addEventListener("click", async function() {
        await server.logout();
    });

    //
    // the shares badge of the left bar
    //
    const badgeShares = document.getElementById("badge-shares");
    server.addEventListener("share-start", function() {
        badgeShares.classList.remove("hide");
    });
    server.addEventListener("share-end", function() {
        badgeShares.classList.add("hide");
    });

    //
    // the left bar, wide or narrow
    //
    const menuBtn = document.getElementById("btn-menu-left");
    let isMenuMax = false;
    const switchMenu = function(isMax = isMenuMax) {
        const btnDownload = document.getElementById("btn-download");
        const btnShares = document.getElementById("btn-shares");
        if (isMax) {
            menuBtn.parentElement.parentElement.classList.add("max");
            btnDownload.classList.add("primary");
            btnDownload.children[0].classList.remove("primary");
            // fix point in shares
            if (btnShares.children.item(0).tagName !== "DIV") {
                const icon = btnShares.children.item(0);
                const badge = btnShares.children.item(1);
                const div = document.createElement("div");
                div.prepend(badge);
                div.prepend(icon);
                btnShares.prepend(div);
            }
        } else {
            menuBtn.parentElement.parentElement.classList.remove("max");
            btnDownload.classList.remove("primary");
            btnDownload.children[0].classList.add("primary");

            // fix point in shares
            if (btnShares.children.item(0).tagName === "DIV") {
                const div = btnShares.children.item(0);
                const icon = div.children.item(0);
                const badge = div.children.item(1);
                div.remove();
                btnShares.prepend(badge);
                btnShares.prepend(icon);
            }
        }
    };
    if (sizeS < width) {
        isMenuMax = (width >= sizeM);
        switchMenu();
    }
    menuBtn.addEventListener("click", function() {
        isMenuMax = !isMenuMax;
        switchMenu();
    });
    window.addEventListener("resize", function() {
        if (sizeS < window.innerWidth && router.isDialogOpen("menu") === true) {
            router.closeDialog("menu");
        }
    });

    // the desktop client is already the download
    if (desktop.isAvailable) {
        document.getElementById("btn-download").classList.add("hide");
    }

    //
    // the connection, and the UI that depends on what the server supports
    //
    router.start();
    server.connect("wss://" + conf["ws"]["domain"] + ":" + conf["ws"]["port"]);

    const switchOnline = function() {
        const serverConf = conf["ws"]["remote"];

        const hasServices = typeof serverConf["serviceSharing"] !== "undefined";
        for (const el of document.querySelectorAll("[data-route=\"services\"]")) {
            if (hasServices) {
                el.classList.remove("hide");
            } else {
                el.classList.add("hide");
            }
        }

        loading.close();
        router.closeDialogs();
        router.loadPath();
        router.prefetch(PREFETCH);
    };
    if (server.isOnline) {
        switchOnline();
    }
    server.addEventListener("online", switchOnline);
    server.addEventListener("offline", function() {
        router.closeDialogs();
        loading.open();
    });
};
main();
