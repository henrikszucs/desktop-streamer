"use strict";

// the lazy loader and the module cache
//
// every specifier below is a literal, on purpose: a built specifier works at
// runtime but hides every path from tests/assets.test.js, and a mistyped path
// is the one class of error the browser reports badly.

// a module is its code, its markup, its styles and its strings, pulled together
// in one round trip. "html", "css" and "localization" are left out when a module
// has none.
const routes = new Map([
    ["new", {
        "load": () => import("../ui/new/index.js"),
        "html": "/ui/new/view.html",
        "localization": "/ui/new/localization.json"
    }],
    ["downloads", {
        "load": () => import("../ui/downloads/index.js"),
        "html": "/ui/downloads/view.html"
    }],
    ["login", {
        "load": () => import("../ui/login/index.js"),
        "html": "/ui/login/view.html",
        "css": "/ui/login/view.css"
    }],
    ["services", {
        "load": () => import("../ui/services/index.js"),
        "html": "/ui/services/view.html"
    }],
    ["devices", {
        "load": () => import("../ui/devices/index.js"),
        "html": "/ui/devices/view.html",
        "css": "/ui/devices/view.css"
    }],
    ["shares", {
        "load": () => import("../ui/shares/index.js"),
        "html": "/ui/shares/view.html",
        "css": "/ui/shares/view.css"
    }],
    ["room", {
        "load": () => import("../ui/room/index.js"),
        "html": "/ui/room/view.html",
        "css": "/ui/room/view.css"
    }],
    ["menu", {
        "load": () => import("../ui/menu/index.js"),
        "html": "/ui/menu/view.html",
        "css": "/ui/menu/view.css"
    }],
    ["search", {
        "load": () => import("../ui/search/index.js"),
        "html": "/ui/search/view.html",
        "css": "/ui/search/view.css"
    }],
    ["settings", {
        "load": () => import("../ui/settings/index.js"),
        "html": "/ui/settings/view.html",
        "localization": "/ui/settings/localization.json"
    }],
    ["settings.appearance", {
        "load": () => import("../ui/settings/appearance/index.js"),
        "html": "/ui/settings/appearance/view.html",
        "css": "/ui/settings/appearance/view.css",
        "localization": "/ui/settings/appearance/localization.json"
    }],
    ["settings.audio", {
        "load": () => import("../ui/settings/audio/index.js"),
        "html": "/ui/settings/audio/view.html",
        "css": "/ui/settings/audio/view.css",
        "localization": "/ui/settings/audio/localization.json"
    }],
    ["settings.video", {
        "load": () => import("../ui/settings/video/index.js"),
        "html": "/ui/settings/video/view.html",
        "css": "/ui/settings/video/view.css",
        "localization": "/ui/settings/video/localization.json"
    }],
    ["settings.control", {
        "load": () => import("../ui/settings/control/index.js"),
        "html": "/ui/settings/control/view.html",
        "css": "/ui/settings/control/view.css",
        "localization": "/ui/settings/control/localization.json"
    }],
    ["settings.about", {
        "load": () => import("../ui/settings/about/index.js"),
        "html": "/ui/settings/about/view.html",
        "css": "/ui/settings/about/view.css",
        "localization": "/ui/settings/about/localization.json"
    }],
    ["account", {
        "load": () => import("../ui/account/index.js"),
        "html": "/ui/account/view.html",
        "localization": "/ui/account/localization.json"
    }],
    ["account.information", {
        "load": () => import("../ui/account/information/index.js"),
        "html": "/ui/account/information/view.html",
        "localization": "/ui/account/information/localization.json"
    }],
    ["account.sessions", {
        "load": () => import("../ui/account/sessions/index.js"),
        "html": "/ui/account/sessions/view.html",
        "css": "/ui/account/sessions/view.css",
        "localization": "/ui/account/sessions/localization.json"
    }],
    ["account.delete", {
        "load": () => import("../ui/account/delete/index.js"),
        "html": "/ui/account/delete/view.html",
        "css": "/ui/account/delete/view.css",
        "localization": "/ui/account/delete/localization.json"
    }],
    ["room-create", {
        "load": () => import("../ui/room-create/index.js"),
        "html": "/ui/room-create/view.html",
        "css": "/ui/room-create/view.css",
        "localization": "/ui/room-create/localization.json"
    }],
    ["room-request", {
        "load": () => import("../ui/room-request/index.js"),
        "html": "/ui/room-request/view.html",
        "css": "/ui/room-request/view.css",
        "localization": "/ui/room-request/localization.json"
    }],
    ["room-joining", {
        "load": () => import("../ui/room-joining/index.js"),
        "html": "/ui/room-joining/view.html",
        "localization": "/ui/room-joining/localization.json"
    }],
    ["room-settings", {
        "load": () => import("../ui/room-settings/index.js"),
        "html": "/ui/room-settings/view.html",
        "css": "/ui/room-settings/view.css"
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
