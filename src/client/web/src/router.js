"use strict";

// path to module, history, popstate, and the one delegated click handler every
// navigation goes through - it owns one segment, one screen, a dialog stack

// first-party dependencies
import registry from "./registry.js";

// the two segments of the shell. Which chrome belongs to one is [data-segment]
// in the markup and a screen names its own, so neither is listed here.
const SEGMENTS = new Map([
    ["management", {
        "screens": ["new", "downloads", "login", "services", "devices", "shares"],
        "deep": [],
        "default": "new"
    }],
    ["room", {
        "screens": [],
        "deep": ["room"],
        "default": ""
    }]
]);

// the segment a screen the shell knows nothing else about opens in
const DEFAULT_SEGMENT = "management";

// the paths the shell answers, in the order loadPath checks them
const segmentRoutes = function(key) {
    const routes = [];
    for (const segment of SEGMENTS.values()) {
        routes.push(...segment[key]);
    }
    return routes;
};
const SCREEN_ROUTES = segmentRoutes("screens");
const DEEP_ROUTES = segmentRoutes("deep");
const DEFAULT_ROUTE = SEGMENTS.get(DEFAULT_SEGMENT)["default"];

// a module that takes longer than this to arrive gets the loading layer
const LOADING_DELAY = 150;

const Router = class extends EventTarget {
    ctx = null;

    segmentId = "";
    screenId = "";
    screen = null;
    dialogs = [];       // [{"id", "view"}], the innermost dialog last

    #navigation = 0;    // the newest navigation wins over the one still loading

    constructor(ctx) {
        super();
        this.ctx = ctx;
    };

    // the module, with the loading layer if it is slow - taken by name so a
    // connection that drops meanwhile keeps the layer when this one lets go
    async load(id) {
        if (registry.isLoaded(id) === true) {
            return await registry.load(id, this.ctx);
        }
        const timeoutId = setTimeout(() => {
            this.ctx["ui"].loading.open("module");
        }, LOADING_DELAY);
        try {
            return await registry.load(id, this.ctx);
        } finally {
            clearTimeout(timeoutId);
            this.ctx["ui"].loading.close("module");
        }
    };

    // the chrome of a segment: every [data-segment] element is shown for its own
    // and hidden for the rest, and body carries the open one as a class
    setSegment(id) {
        if (this.segmentId === id) {
            return;
        }
        const previous = this.segmentId;
        this.segmentId = id;

        for (const el of document.querySelectorAll("[data-segment]")) {
            if (el.getAttribute("data-segment") === id) {
                el.classList.remove("hide");
            } else {
                el.classList.add("hide");
            }
        }
        if (previous !== "") {
            document.body.classList.remove("segment-" + previous);
        }
        document.body.classList.add("segment-" + id);

        this.dispatchEvent(new CustomEvent("segment", {"detail": {"id": id, "previous": previous}}));
    };

    // the segment a route opens in, without loading it - the module knows for
    // certain, this is what the shell can say before it arrives
    segmentOf(id) {
        for (const [segmentId, segment] of SEGMENTS) {
            if (segment["screens"].includes(id) === true || segment["deep"].includes(id) === true) {
                return segmentId;
            }
        }
        return DEFAULT_SEGMENT;
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

        // the chrome first, so the screen opens into the segment it belongs to
        this.setSegment(view.constructor.segment || DEFAULT_SEGMENT);
        view.open(params);

        this.setNavigationState(id);
        this.dispatchEvent(new CustomEvent("screen", {"detail": {"id": id}}));
    };

    // the nav entries that mark the screen they lead to
    setNavigationState(id) {
        const marks = document.querySelectorAll("[data-route][data-route-active]");
        for (const mark of marks) {
            const className = mark.getAttribute("data-route-active");
            if (mark.getAttribute("data-route") === id) {
                mark.classList.add(className);
            } else {
                mark.classList.remove(className);
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
        if (path[0] === "services" && typeof this.ctx["conf"]["remote"]?.["serviceSharing"] === "undefined") {
            path = [""];
        }
        if (path[0] === "") {
            path = [DEFAULT_ROUTE];
        }
        return path;
    };

    // both hand back the promise of the screen being open, so boot can wait for
    // the route before it lifts the loading layer off it
    loadPath() {
        const path = this.routeOf(window.location.pathname);
        window.history.replaceState({}, "", "/" + path.join("/"));
        return this.openScreen(path[0], {"path": path.slice(1)});
    };

    navigate(path) {
        window.history.pushState({}, "", "/" + path);
        return this.loadPath();
    };

    // one delegated handler for every [data-route] and [data-dialog] in the shell
    // and in every module, so adding a screen wires no buttons by hand
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

    // a beercss menu stays open until its holder loses focus, and a submenu hangs
    // on an <li> that holds none - the walk up reaches the element that does
    blurMenu(el) {
        let menu = el.closest("menu");
        while (menu !== null && typeof menu !== "undefined") {
            const holder = menu.parentElement;
            holder?.blur?.();
            menu = holder?.closest?.("menu") ?? null;
        }
    };
};

export { Router, SEGMENTS, SCREEN_ROUTES, DEEP_ROUTES, DEFAULT_ROUTE, DEFAULT_SEGMENT };
export default Router;
