"use strict";

// the shell layer: everything boot needs a document for, and the build that
// mounts the module tree - the one file in ./ui that is not a module

// first-party dependencies
import { browser, width, sizeS, sizeM, getDisplay, getDisplayKind, getRootFontSize } from "../src/env.js";
import localization from "../src/localization.js";
import registry from "../src/registry.js";
import { createLoading } from "./loading/loading.js";

// the size of the UI, from the display it is read on: every length in the shell
// is a rem, so the root font size is the size of the whole UI
const applyScale = function() {
    const display = getDisplay();
    const kind = getDisplayKind(display);
    document.documentElement.style.fontSize = getRootFontSize(display, kind) + "px";
    return {"display": display, "kind": kind};
};

// the theme, then the mode a tick later - beercss derives the mode from the
// theme it just built, so the two cannot be set in one go
const applyTheme = function(local) {
    globalThis.ui("theme", local["color"]);
    setTimeout(() => {
        let mode = local["mode"];
        if (mode === "auto") {
            mode = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        }
        globalThis.ui("mode", mode);
    }, 1);
};

// the language of the shell: "auto" follows the browser, anything unsupported
// falls back to English, and the resolved one goes back to the desktop shell
const applyLanguage = function(local) {
    let lang = local["lang"];
    if (lang === "auto") {
        lang = (navigator.language || navigator.userLanguage).substring(0, 2);
    }
    if (localization.supportedLanguages.indexOf(lang) === -1) {
        lang = "en";
    }
    localization.setLang(lang);
    localization.translate(lang);
    return lang;
};

// the ctx["ui"] namespace. ctx is handed in before its router is there, so
// every call below reads ctx["router"] at the time of the call, not now.
const createUI = function(ctx) {
    const overlayEl = document.getElementById("dialog-overlay");

    // the shared overlay, held by name because the loading layer and the dialogs
    // overlap - on screen while anything holds it, blurred if any holder asked
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

    // the loading layer, over both segments - see ./loading/loading.js
    const loading = createLoading(overlay);

    // the "permissions" block of the conf-get answer, asked as a question rather
    // than read as a value - a missing flag has not arrived, it is not a default
    const permissions = {
        "get": function(name) {
            return ctx["conf"]["remote"]?.["permissions"]?.[name] === true;
        },
        "isAuth": function() {
            return permissions.get("isAuth");
        },
        "isGuest": function() {
            return true;
        },
        // a guest permission, answered for whoever this client is
        "allows": function(name) {
            return permissions.isGuest() === false || permissions.get(name) === true;
        }
    };

    return {
        "overlay": overlay,
        "loading": loading,
        "permissions": permissions,
        "env": {"browser": browser, "width": width, "sizeS": sizeS, "sizeM": sizeM},
        "navigate": function(path) { return ctx["router"].navigate(path); },
        "openDialog": function(id, params, isNested) { return ctx["router"].openDialog(id, params, isNested); },
        "closeDialog": function(id) { return ctx["router"].closeDialog(id); },
        "closeDialogs": function() { return ctx["router"].closeDialogs(); },
        "loadModule": function(id) { return ctx["router"].load(id); }
    };
};

// every UI module, mounted before the router runs, one dot-depth of the registry
// id at a time so a module lands after the one it mounts into
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

export { applyScale, applyTheme, applyLanguage, createUI, buildUI };
export default { applyScale, applyTheme, applyLanguage, createUI, buildUI };
