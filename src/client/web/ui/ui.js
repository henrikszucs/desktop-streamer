"use strict";

// the shell layer: what is on screen before any UI module is, and what puts
// them all there
//
// index.js is boot - the environment, the configuration, the connection - and
// everything it needs a document for lives here: the local appearance and
// language settings, the shared overlay, the ctx["ui"] namespace every module
// reaches the shell through, and the build that mounts the whole module tree
// before the router runs.
//
// The modules themselves sit under the layer of the shell they belong to, and
// this file is the only thing in ./ui that is not one of them:
//
//     ./loading           the layer over both segments, and the version dialog
//     ./management        the two bars, the screens they lead to, the dialogs
//     ./room              the stream, and the dialogs of the flows into it

// first-party dependencies
import { browser, width, sizeS, sizeM } from "../src/env.js";
import localization from "../src/localization.js";
import registry from "../src/registry.js";
import { createLoading } from "./loading/loading.js";

//
// the local configuration, applied to the document
//
// beercss is asked for the theme first and the mode a tick later: the mode is
// derived from the theme it just built, so the two cannot be set in one go.
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

// the language of the shell, resolved against what the client actually has:
// "auto" follows the browser, anything unsupported falls back to English. The
// resolved one is handed back because the desktop shell has to be told too.
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

//
// the shell
//
// the ctx["ui"] namespace: the overlay, the loading layer, the environment a
// module lays itself out against, and the router calls a module makes without
// holding the router itself. ctx is handed in before its router is there, so
// every call below reads ctx["router"] at the time of the call, not now.
const createUI = function(ctx) {
    const overlayEl = document.getElementById("dialog-overlay");

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

    // the loading layer, over both segments, holding the overlay it is
    // shown over - see ./loading/loading.js
    const loading = createLoading(overlay);

    // what this server would let this client do: the "permissions" block of the
    // conf-get answer, asked as a question rather than read as a value
    //
    // The server answers every flag for every client whether its configuration
    // sets it or not (see buildPublicConf in src/server/ws.js), so a flag that
    // is not there is an answer that has not arrived rather than a default of
    // the client's own - and nothing but the loading layer is on screen until
    // it has, so "not yet" and "no" are the same thing to a module.
    //
    // The guest flags are the permissions of the user this client is, so they
    // only hold while it is the guest. Nothing carries accounts yet
    // (dev/plans/ws-accounts.md) and the client is only ever the guest, which
    // makes isGuest() the one place that has to learn about them later.
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

export { applyTheme, applyLanguage, createUI, buildUI };
export default { applyTheme, applyLanguage, createUI, buildUI };
