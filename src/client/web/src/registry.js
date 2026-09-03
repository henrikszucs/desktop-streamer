"use strict";

// the lazy loader and the module cache. Every specifier below is a literal on
// purpose: a built one would hide every path from tests/assets.test.js.

// a module is its code, markup, styles and strings in one round trip, the three
// left out when it has none. An id is not a path, it is what the shell knows.
const routes = new Map([
    // the loading layer, over both segments: the boot and the connection,
    // and the one dialog that replaces it rather than waiting behind it
    ["version", {
        "load": () => import("../ui/loading/version/index.js"),
        "html": "/ui/loading/version/view.html",
        "localization": "/ui/loading/version/localization.json"
    }],

    // the management segment: the chrome first, mounted before the first
    // navigation, then the screens the bars lead to and the dialogs over them
    ["nav-top", {
        "load": () => import("../ui/management/nav-top/index.js"),
        "html": "/ui/management/nav-top/view.html",
        "css": "/ui/management/nav-top/view.css"
    }],
    ["nav-left", {
        "load": () => import("../ui/management/nav-left/index.js"),
        "html": "/ui/management/nav-left/view.html"
    }],
    ["menu", {
        "load": () => import("../ui/management/menu/index.js"),
        "html": "/ui/management/menu/view.html",
        "css": "/ui/management/menu/view.css"
    }],
    ["search", {
        "load": () => import("../ui/management/search/index.js"),
        "html": "/ui/management/search/view.html",
        "css": "/ui/management/search/view.css"
    }],
    ["new", {
        "load": () => import("../ui/management/new/index.js"),
        "html": "/ui/management/new/view.html",
        "css": "/ui/management/new/view.css",
        "localization": "/ui/management/new/localization.json"
    }],
    ["downloads", {
        "load": () => import("../ui/management/downloads/index.js"),
        "html": "/ui/management/downloads/view.html",
        "css": "/ui/management/downloads/view.css",
        "localization": "/ui/management/downloads/localization.json"
    }],
    ["login", {
        "load": () => import("../ui/management/login/index.js"),
        "html": "/ui/management/login/view.html",
        "css": "/ui/management/login/view.css",
        "localization": "/ui/management/login/localization.json"
    }],
    ["services", {
        "load": () => import("../ui/management/services/index.js"),
        "html": "/ui/management/services/view.html",
        "localization": "/ui/management/services/localization.json"
    }],
    ["devices", {
        "load": () => import("../ui/management/devices/index.js"),
        "html": "/ui/management/devices/view.html",
        "css": "/ui/management/devices/view.css",
        "localization": "/ui/management/devices/localization.json"
    }],
    ["shares", {
        "load": () => import("../ui/management/shares/index.js"),
        "html": "/ui/management/shares/view.html",
        "css": "/ui/management/shares/view.css",
        "localization": "/ui/management/shares/localization.json"
    }],
    ["settings", {
        "load": () => import("../ui/management/settings/index.js"),
        "html": "/ui/management/settings/view.html",
        "localization": "/ui/management/settings/localization.json"
    }],
    ["settings.appearance", {
        "load": () => import("../ui/management/settings/appearance/index.js"),
        "html": "/ui/management/settings/appearance/view.html",
        "css": "/ui/management/settings/appearance/view.css",
        "localization": "/ui/management/settings/appearance/localization.json"
    }],
    ["settings.audio", {
        "load": () => import("../ui/management/settings/audio/index.js"),
        "html": "/ui/management/settings/audio/view.html",
        "css": "/ui/management/settings/audio/view.css",
        "localization": "/ui/management/settings/audio/localization.json"
    }],
    ["settings.video", {
        "load": () => import("../ui/management/settings/video/index.js"),
        "html": "/ui/management/settings/video/view.html",
        "css": "/ui/management/settings/video/view.css",
        "localization": "/ui/management/settings/video/localization.json"
    }],
    ["settings.control", {
        "load": () => import("../ui/management/settings/control/index.js"),
        "html": "/ui/management/settings/control/view.html",
        "css": "/ui/management/settings/control/view.css",
        "localization": "/ui/management/settings/control/localization.json"
    }],
    ["settings.about", {
        "load": () => import("../ui/management/settings/about/index.js"),
        "html": "/ui/management/settings/about/view.html",
        "css": "/ui/management/settings/about/view.css",
        "localization": "/ui/management/settings/about/localization.json"
    }],
    ["account", {
        "load": () => import("../ui/management/account/index.js"),
        "html": "/ui/management/account/view.html",
        "localization": "/ui/management/account/localization.json"
    }],
    ["account.information", {
        "load": () => import("../ui/management/account/information/index.js"),
        "html": "/ui/management/account/information/view.html",
        "localization": "/ui/management/account/information/localization.json"
    }],
    ["account.sessions", {
        "load": () => import("../ui/management/account/sessions/index.js"),
        "html": "/ui/management/account/sessions/view.html",
        "css": "/ui/management/account/sessions/view.css",
        "localization": "/ui/management/account/sessions/localization.json"
    }],
    ["account.delete", {
        "load": () => import("../ui/management/account/delete/index.js"),
        "html": "/ui/management/account/delete/view.html",
        "css": "/ui/management/account/delete/view.css",
        "localization": "/ui/management/account/delete/localization.json"
    }],

    // the room segment: the screen that takes the whole window, and the
    // dialogs of the flows that lead into it
    ["room", {
        "load": () => import("../ui/room/index.js"),
        "html": "/ui/room/view.html",
        "css": "/ui/room/view.css"
    }],
    ["room-create", {
        "load": () => import("../ui/room/create/index.js"),
        "html": "/ui/room/create/view.html",
        "css": "/ui/room/create/view.css",
        "localization": "/ui/room/create/localization.json"
    }],
    ["room-request", {
        "load": () => import("../ui/room/request/index.js"),
        "html": "/ui/room/request/view.html",
        "css": "/ui/room/request/view.css",
        "localization": "/ui/room/request/localization.json"
    }],
    ["room-joining", {
        "load": () => import("../ui/room/joining/index.js"),
        "html": "/ui/room/joining/view.html",
        "localization": "/ui/room/joining/localization.json"
    }],
    ["room-settings", {
        "load": () => import("../ui/room/settings/index.js"),
        "html": "/ui/room/settings/view.html",
        "css": "/ui/room/settings/view.css"
    }]
]);

// id -> the promise of its mounted instance, so a module is built once per page
const modules = new Map();

// href -> the promise of its link element, module styles stay for the page
const styles = new Map();

// resolves on the load event of the link, or the markup paints unstyled
const loadStylesheet = function(href) {
    let pending = styles.get(href);
    if (typeof pending !== "undefined") {
        return pending;
    }
    pending = new Promise(function(resolve, reject) {
        const link = document.createElement("link");
        link.setAttribute("rel", "stylesheet");
        link.setAttribute("href", href);
        link.addEventListener("load", function() {
            resolve();
        }, {"once": true});
        link.addEventListener("error", function() {
            reject(new Error("Cannot load stylesheet " + href));
        }, {"once": true});
        document.head.appendChild(link);
    });
    styles.set(href, pending);
    return pending;
};

const loadMarkup = async function(href) {
    const res = await fetch(href);
    if (res.ok === false) {
        throw new Error("Cannot load markup " + href + " (" + res.status + ")");
    }
    return await res.text();
};

// the slice of the dictionary a module ships, data beside its markup rather
// than a second script to parse
const loadDictionary = async function(href) {
    const res = await fetch(href);
    if (res.ok === false) {
        throw new Error("Cannot load localization " + href + " (" + res.status + ")");
    }
    return await res.json();
};

// code, markup, styles and strings at once, so a module costs one round trip
const build = async function(id, entry, ctx) {
    const [module, markup, dictionary] = await Promise.all([
        entry["load"](),
        typeof entry["html"] === "undefined" ? "" : loadMarkup(entry["html"]),
        typeof entry["localization"] === "undefined" ? null : loadDictionary(entry["localization"]),
        typeof entry["css"] === "undefined" ? undefined : loadStylesheet(entry["css"])
    ]);

    const Module = module["default"];
    const view = new Module();

    // the strings first, so the markup is translated before it is on screen
    if (dictionary !== null) {
        ctx["localization"].add(dictionary);
    }
    if (markup !== "") {
        const template = document.createElement("template");
        template.innerHTML = markup.trim();
        ctx["localization"].translate(ctx["localization"].getLang(), template.content);

        const target = document.querySelector(Module.mountPoint);
        if (target === null) {
            throw new Error("No mount point " + Module.mountPoint + " for UI module " + id);
        }
        target.appendChild(template.content);
    }

    view.ctx = ctx;
    if (Module.rootId !== "") {
        view.el = document.getElementById(Module.rootId);
    }
    await view.mount(ctx);
    return view;
};

// the mounted instance of a module, built on the first call and cached after
const load = function(id, ctx) {
    let pending = modules.get(id);
    if (typeof pending !== "undefined") {
        return pending;
    }
    const entry = routes.get(id);
    if (typeof entry === "undefined") {
        return Promise.reject(new Error("No such UI module: " + id));
    }
    pending = build(id, entry, ctx);
    modules.set(id, pending);
    return pending;
};

// already built, so it can be reached without waiting
const isLoaded = function(id) {
    return modules.has(id);
};

const has = function(id) {
    return routes.has(id);
};

const ids = function() {
    return [...routes.keys()];
};

export { routes, load, isLoaded, has, ids, loadStylesheet };
export default { routes, load, isLoaded, has, ids, loadStylesheet };
