"use strict";

// path to module, history, popstate - and the one delegated click handler that
// every navigation in the shell goes through
//
// the router owns what is open: one segment, one screen inside it, and a stack
// of dialogs over that. Adding a screen is a route below plus a [data-route]
// attribute in the markup, it never touches the boot code.

// first-party dependencies
import registry from "./registry.js";

// the shell is two segments, and the loading layer over both of them:
//
//     loading                 boot, and every time the connection drops
//     management              the navigation bars and the main surface
//         new                 create a connection
//         devices, shares     manage the existing ones
//         services
//         downloads           get the desktop client
//         login
//     room                    the stream, the whole window, no chrome
//
// A segment is the layer above the screens: the chrome that is on screen while
// any of its own screens is. Which chrome belongs to which segment is an
// attribute in the markup ([data-segment]), and a screen names the segment it
// opens in (static segment, see src/view.js) - neither is listed here. The
// loading layer is not a segment: it covers whichever one is open and gives it
// back untouched, see the loading holders in index.js.
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

    //
    // loading
    //
    // the module, with the loading layer if it does not arrive quickly. It is
    // taken under the "module" name, so a connection that drops while a screen
    // is still on its way keeps the layer when this one gives it back.
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

    //
    // segments
    //
    // the chrome of a segment: every [data-segment] element of the shell is on
    // screen for its own segment and hidden for the others, so a new piece of
    // chrome is an attribute in the markup and no change here. The body carries
    // the open one as a class, for the styles that follow the segment rather
    // than the screen.
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

    // the segment a route opens in, without loading it: the module is the one
    // that knows for certain, this is what the shell can say before it arrives
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

    // both hand back the promise of the screen being open, so a caller that has
    // to know the route is on screen - the boot, lifting the loading layer off
    // it - can wait for it
    loadPath() {
        const path = this.routeOf(window.location.pathname);
        window.history.replaceState({}, "", "/" + path.join("/"));
        return this.openScreen(path[0], {"path": path.slice(1)});
    };

    navigate(path) {
        window.history.pushState({}, "", "/" + path);
        return this.loadPath();
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

export { Router, SEGMENTS, SCREEN_ROUTES, DEEP_ROUTES, DEFAULT_ROUTE, DEFAULT_SEGMENT };
export default Router;
