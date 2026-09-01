"use strict";

// path to module, history, popstate - and the one delegated click handler that
// every navigation in the shell goes through
//
// the router owns what is open: one screen, and a stack of dialogs over it.
// Adding a screen is a route below plus a [data-route] attribute in the markup,
// it never touches the boot code.

// first-party dependencies
import registry from "./registry.js";

// the paths the shell answers, in the order loadPath checks them
const SCREEN_ROUTES = ["new", "downloads", "login", "services", "devices", "shares"];
const DEEP_ROUTES = ["room"];
const DEFAULT_ROUTE = "new";

// a module that takes longer than this to arrive gets the loading dialog
const LOADING_DELAY = 150;

const Router = class extends EventTarget {
    ctx = null;

    screenId = "";
    screen = null;
    dialogs = [];       // [{"id", "view"}], the innermost dialog last

    #navigation = 0;    // the newest navigation wins over the one still loading

    constructor(ctx) {
        super();
        this.ctx = ctx;
    };

    //
    // loading
    //
    // the module, with the loading dialog if it does not arrive quickly
    async load(id) {
        if (registry.isLoaded(id) === true) {
            return await registry.load(id, this.ctx);
        }
        const timeoutId = setTimeout(() => {
            this.ctx["ui"].loading.open();
        }, LOADING_DELAY);
        try {
            return await registry.load(id, this.ctx);
        } finally {
            clearTimeout(timeoutId);
            this.ctx["ui"].loading.close();
        }
    };

    // pull the modules in while nothing is waiting for them, so the first click
    // on a screen is not the first time the browser hears about it
    prefetch(ids) {
        const idle = globalThis.requestIdleCallback || function(fn) {
            return setTimeout(fn, 1000);
        };
        idle(async () => {
            for (const id of ids) {
                if (registry.isLoaded(id) === true) {
                    continue;
                }
                try {
                    await registry.load(id, this.ctx);
                } catch (error) {
                    console.error("Cannot prefetch UI module " + id + ":", error);
                }
            }
        });
    };

    //
    // screens
    //
    async openScreen(id, params) {
        const navigation = ++this.#navigation;
        let view;
        try {
            view = await this.load(id);
        } catch (error) {
            console.error("Cannot open screen " + id + ":", error);
            return;
        }
        if (navigation !== this.#navigation) {
            return;     // a newer navigation took over while this one loaded
        }

        this.closeDialogs();
        this.screen?.close?.();
        this.screen = view;
        this.screenId = id;
        view.open(params);

        this.setNavigationState(id, view.constructor.hidesNav === true);
        this.dispatchEvent(new CustomEvent("screen", {"detail": {"id": id}}));
    };

    // the nav entries that mark the screen they lead to, and the two bars the
    // room screen takes the window from
    setNavigationState(id, hidesNav) {
        const marks = document.querySelectorAll("[data-route][data-route-active]");
        for (const mark of marks) {
            const className = mark.getAttribute("data-route-active");
            if (mark.getAttribute("data-route") === id) {
                mark.classList.add(className);
            } else {
                mark.classList.remove(className);
            }
        }
        for (const nav of [document.getElementById("nav-top"), document.getElementById("nav-left")]) {
            if (hidesNav === true) {
                nav.classList.add("hide");
            } else {
                nav.classList.remove("hide");
            }
        }
    };

    //
    // dialogs
    //
    // isNested keeps whatever is open below, for the second dialog of one flow
    async openDialog(id, params, isNested=false) {
        if (isNested === false) {
            this.closeDialogs();
        }
        let view;
        try {
            view = await this.load(id);
        } catch (error) {
            console.error("Cannot open dialog " + id + ":", error);
            return;
        }
        this.dialogs.push({"id": id, "view": view});
        view.open(params);
        return view;
    };

    closeDialog(id) {
        for (let i = this.dialogs.length - 1; i > -1; i--) {
            if (this.dialogs[i]["id"] !== id) {
                continue;
            }
            const entry = this.dialogs.splice(i, 1)[0];
            entry["view"].close();
            return;
        }
    };

    closeDialogs() {
        while (this.dialogs.length > 0) {
            this.dialogs.pop()["view"].close();
        }
    };

    isDialogOpen(id) {
        return this.dialogs.some(function(entry) {
            return entry["id"] === id;
        });
    };

    // the dialog of a flow steps aside for the next one and comes back after
    showDialog(id) {
        for (const entry of this.dialogs) {
            if (entry["id"] === id) {
                entry["view"].show();
            }
        }
    };
    hideDialog(id) {
        for (const entry of this.dialogs) {
            if (entry["id"] === id) {
                entry["view"].hide();
            }
        }
    };

    //
    // the URL
    //
    // the path the location holds, normalized to a route the shell can answer
    routeOf(pathname) {
        let path = (pathname || "/").slice(1).split("/");
        if (SCREEN_ROUTES.includes(path[0]) === true) {
            path = [path[0]];
        } else if (DEEP_ROUTES.includes(path[0]) === true) {
            path = [path[0], path[1]];
        } else {
            path = [""];
        }

        // a route that is not there for this client falls back to the default
        if (path[0] === "services" && typeof this.ctx["conf"]["ws"]["remote"]?.["serviceSharing"] === "undefined") {
            path = [""];
        }
        if (path[0] === "") {
            path = [DEFAULT_ROUTE];
        }
        return path;
    };

    loadPath() {
        const path = this.routeOf(window.location.pathname);
        window.history.replaceState({}, "", "/" + path.join("/"));
        this.openScreen(path[0], {"path": path.slice(1)});
    };

    navigate(path) {
        window.history.pushState({}, "", "/" + path);
        this.loadPath();
    };

    //
    // wiring
    //
    // one delegated handler for every [data-route] and [data-dialog] in the
    // shell and in every module, so adding a screen wires no buttons by hand
    start() {
        document.addEventListener("click", (event) => {
            const routeEl = event.target.closest?.("[data-route]");
            if (routeEl !== null && typeof routeEl !== "undefined") {
                this.blurMenu(routeEl);
                this.navigate(routeEl.getAttribute("data-route"));
                return;
            }
            const dialogEl = event.target.closest?.("[data-dialog]");
            if (dialogEl !== null && typeof dialogEl !== "undefined") {
                this.blurMenu(dialogEl);
                this.openDialog(dialogEl.getAttribute("data-dialog"), {});
            }
        });
        window.addEventListener("popstate", () => {
            this.loadPath();
        });
    };

    // a beercss menu stays open until whatever holds it loses the focus
    blurMenu(el) {
        const menu = el.closest("menu");
        if (menu === null) {
            return;
        }
        menu.parentElement?.blur?.();
    };
};

export { Router, SCREEN_ROUTES, DEEP_ROUTES, DEFAULT_ROUTE };
export default Router;
