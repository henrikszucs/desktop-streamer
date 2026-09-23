"use strict";

// the shell layer: everything boot needs a document for, and the build that
// mounts the module tree - the one file in ./ui that is not a module

// third-party dependencies - the same modules index.html starts fetching, so
// ui() and the palette generator are there before a theme is applied
import "../libs/beercss/beer.min.js";
import "../libs/beercss/material-dynamic-colors.min.js";

// first-party dependencies
import { width, sizeS, sizeM, getDisplay, getDisplayKind, getRootFontSize } from "../src/env.js";
import localization from "../src/localization.js";
import { pickName } from "../src/appname.js";
import { buildPalette } from "../src/appearance.js";
import registry from "../src/registry.js";
import { createLoading } from "./loading/loading.js";

// the dictionary slices no module brings, each beside what uses it: the
// application's name (the title and the desktop shell), the loading layer of
// index.html, and the chrome of the management segment its modules share - the
// registry adds each module's own. The room's lines are the room module's.
const LEVEL_DICTIONARIES = [
    "/ui/localization.json",
    "/ui/loading/localization.json",
    "/ui/management/localization.json"
];

// a slice that fails is logged and skipped, as a module is, so boot goes on
// with the markup's own text where its lines would have been
const loadDictionaries = function() {
    return Promise.all(LEVEL_DICTIONARIES.map(function(url) {
        return localization.load(url).catch(function(error) {
            console.error(error);
        });
    }));
};

// the size of the UI, from the display it is read on: every length in the shell
// is a rem, so the root font size is the size of the whole UI
const applyScale = function() {
    const display = getDisplay();
    const kind = getDisplayKind(display);
    document.documentElement.style.fontSize = getRootFontSize(display, kind) + "px";
    return {"display": display, "kind": kind};
};

// the paint cache the script in index.html reads first: {color, mode, light,
// dark, lang} - see CLIENT.md, "The theme is painted before any module runs"
const PAINT_KEY = "appearance";

const readJSON = function(text) {
    try {
        const value = JSON.parse(text);
        return (typeof value === "object" && value !== null ? value : null);
    } catch (error) {
        return null;
    }
};

// the meta is read once, being the build's and never changing; the cache is read
// every time, since another tab or window writes it too
let built;

const readBuilt = function() {
    if (typeof built === "undefined") {
        built = readJSON(document.querySelector("meta[name=appearance]")?.content ?? "");
    }
    return built;
};

const readCached = function() {
    try {
        return readJSON(localStorage.getItem(PAINT_KEY));
    } catch (error) {
        return null;
    }
};

// fields merged into the cache, so the theme and the language keep each other's
const writeCached = function(fields) {
    try {
        localStorage.setItem(PAINT_KEY, JSON.stringify({...readCached(), ...fields}));
    } catch (error) {
        // a browser with no storage paints the server's default next time
    }
};

const isPaint = function(paint) {
    return typeof paint?.["light"] === "string" && typeof paint?.["dark"] === "string";
};

// the painted palette of this colour, if there is one to reuse
const findPaint = function(color) {
    return [readCached(), readBuilt()].find(function(paint) {
        return isPaint(paint) && String(paint["color"]).toLowerCase() === String(color).toLowerCase();
    }) ?? null;
};

// one build per colour in flight, however many calls are waiting on it - a
// failed one is dropped, so the next call tries again
const building = new Map();

const buildPaint = function(color) {
    const key = String(color).toLowerCase();
    if (building.has(key) === false) {
        building.set(key, buildPalette(color).finally(function() {
            building.delete(key);
        }));
    }
    return building.get(key);
};

// the palette and the mode, drawn at once; before the first, beercss holds no
// palette, and a mode set alone would wipe the one index.html painted
let isDrawn = false;

const drawTheme = function(paint, mode) {
    globalThis.ui("theme", {"light": paint["light"], "dark": paint["dark"]});
    globalThis.ui("mode", mode);
    isDrawn = true;
};

// the mode, on the palette already on screen - before the first draw that is
// the one index.html painted, handed to beercss so it is not wiped
const drawMode = function(mode) {
    const painted = (isDrawn === true ? null : [readCached(), readBuilt()].find(isPaint) ?? null);
    if (painted !== null) {
        drawTheme(painted, mode);
    } else {
        globalThis.ui("mode", mode);
    }
};

// only the latest call draws, so a colour still being built never lands over
// one picked after it
let themeCount = 0;

const applyTheme = async function(local) {
    // the values as they are now - the object is the live configuration
    const color = local["color"];
    const localMode = local["mode"];
    let mode = localMode;
    if (mode === "auto") {
        mode = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    const count = ++themeCount;
    let paint = findPaint(color);
    if (paint === null) {
        // the mode is switched at once, a failed build leaves it standing
        drawMode(mode);
        try {
            paint = await buildPaint(color);
        } catch (error) {
            if (count === themeCount) {
                console.error("Cannot apply the theme:", error);
            }
            return;
        }
        if (count !== themeCount) {
            return;
        }
    }
    drawTheme(paint, mode);
    writeCached({"color": color, "mode": localMode, "light": paint["light"], "dark": paint["dark"]});
};

// the name as the title - the tab's, and the desktop window's and tray's,
// which follow it: the configured one in this language, else the dictionary's
const applyName = function(lang) {
    const name = pickName(readBuilt()?.["name"], lang) ?? localization.get("main.name", lang);
    if (typeof name === "string" && name !== "") {
        document.title = name;
    }
};

// the language of the shell: "auto" follows the browser, anything unsupported
// falls back to English, and the resolved one goes back to the desktop shell -
// the name follows it, and it is cached for the title of the next load
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
    applyName(lang);
    writeCached({"lang": lang});
    return lang;
};

// the whole of the local configuration, applied: the theme, the language, and
// what the desktop shell is told of them. Boot does it once, and the settings
// reset does it again, so the defaults land the way any value does.
const applyLocal = function(local, desktop) {
    applyTheme(local);
    const lang = applyLanguage(local);
    if (desktop?.["isAvailable"] === true) {
        desktop["ipcRenderer"].invoke("api", "set-lang", lang);
        desktop["ipcRenderer"].send("api", "set-tray", local["minimizing"]);
    }
    return lang;
};

// how long a snackbar stands before it takes itself off screen
const SNACKBAR_TIMEOUT = 6000;

// the one place a call that failed says so. Its markup is built here rather
// than written into index.html because nothing needs it before the first
// module, and beercss puts it at the bottom of the window on its own - under
// the loading layer and over everything else, which is the order index.css
// writes down. A message comes from a module (or from a server), so it goes in
// as text, never as markup.
const createSnackbar = function() {
    const snackbarEl = document.createElement("div");
    snackbarEl.className = "snackbar";
    snackbarEl.id = "snackbar";
    document.body.appendChild(snackbarEl);

    let timeoutId = -1;
    const snackbar = {
        "el": snackbarEl,
        // the timeout is restarted by every message, so a second one is shown
        // for its own time instead of the rest of the first one's
        "show": function(message, isError = false) {
            clearTimeout(timeoutId);
            snackbarEl.textContent = message;
            snackbarEl.classList.toggle("error", isError === true);
            snackbarEl.classList.add("active");
            timeoutId = setTimeout(function() {
                snackbar.hide();
            }, SNACKBAR_TIMEOUT);
        },
        "hide": function() {
            clearTimeout(timeoutId);
            timeoutId = -1;
            snackbarEl.classList.remove("active");
        }
    };

    // beercss draws it as something to click, so clicking it dismisses it
    snackbarEl.addEventListener("click", function() {
        snackbar.hide();
    });

    return snackbar;
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

    // the message layer at the bottom of the window, over the dialogs
    const snackbar = createSnackbar();

    // the "permissions" block of the conf-get answer, asked as a question rather
    // than read as a value - a missing flag has not arrived, it is not a default
    const permissions = {
        "get": function(name) {
            return ctx["conf"]["remote"]?.["permissions"]?.[name] === true;
        },
        "isAuth": function() {
            return permissions.get("isAuth");
        },
        // whether this client is the guest right now - the one place the
        // guest permissions learn about accounts (src/management/account.js)
        "isGuest": function() {
            return ctx["account"] === null || ctx["account"].isGuest() === true;
        },
        // a guest permission, answered for whoever this client is
        "allows": function(name) {
            return permissions.isGuest() === false || permissions.get(name) === true;
        }
    };

    return {
        "overlay": overlay,
        "loading": loading,
        "snackbar": snackbar,
        "permissions": permissions,
        "env": {"width": width, "sizeS": sizeS, "sizeM": sizeM},
        "navigate": function(path, params) { return ctx["router"].navigate(path, params); },
        "openDialog": function(id, params, isNested) { return ctx["router"].openDialog(id, params, isNested); },
        "closeDialog": function(id) { return ctx["router"].closeDialog(id); },
        "closeDialogs": function() { return ctx["router"].closeDialogs(); },
        // the open route again, for a screen whose records changed under it
        "reload": function() { return ctx["router"].loadPath(); },
        // the local configuration applied again, for a reset of it
        "applyLocal": function() { return applyLocal(ctx["conf"]["local"], ctx["desktop"]); },
        // the colour and the mode of the local configuration, drawn and cached
        "applyTheme": function() { return applyTheme(ctx["conf"]["local"]); },
        // the language of the local configuration, with the name that follows it
        "applyLanguage": function() { return applyLanguage(ctx["conf"]["local"]); },

        // the one question asked before something is undone for good, answered
        // true or false. It opens nested - whatever asked it is still behind it
        // and is what acts on the answer - and it is given localization keys
        // rather than lines, so a language switched while it stands redraws it.
        "confirm": async function(params) {
            const view = await ctx["router"].openDialog("confirm", params, true);
            if (typeof view === "undefined" || view === null) {
                return false;
            }
            return await new Promise(function(resolve) {
                view.addEventListener("done", function(event) {
                    resolve(event.detail?.["isConfirmed"] === true);
                }, {"once": true});
            });
        },
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

export { loadDictionaries, applyScale, applyTheme, applyLanguage, applyLocal, createSnackbar, createUI, buildUI };
export default { loadDictionaries, applyScale, applyTheme, applyLanguage, applyLocal, createSnackbar, createUI, buildUI };
