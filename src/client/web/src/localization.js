"use strict";

// the localization core: the strings the shell itself shows, and the lookup,
// substitution and translation every module goes through. A module ships its
// own slice as the localization.json beside its markup, and the registry hands
// it to add() while the module loads, so the dictionary grows with the UI
// instead of arriving whole at boot.

let curLang = "en";

const getLang = () => {
    return curLang;
};

const setLang = (lang) => {
    curLang = lang;
};

// the shell slice, every other key arrives through add()
const dict = {
    "loading": {
        "title": {
            "en": "Loading...",
            "hu": "Betöltés..."
        },
        "subtitle": {
            "en": "The application is loading please wait...",
            "hu": "Az alkalmazás betöltése folyamatban, kérlek várj..."
        }
    },
    "main": {
        "new": {
            "en": "New",
            "hu": "Új"
        },
        "services": {
            "en": "Services",
            "hu": "Szolgáltatások"
        },
        "devices": {
            "en": "Devices",
            "hu": "Eszközök"
        },
        "shares": {
            "en": "Shares",
            "hu": "Megosztások"
        },
        "downloads": {
            "en": "Download client",
            "hu": "Kliens letöltése"
        },
        "search": {
            "en": "Search...",
            "hu": "Keresés..."
        },
        "login": {
            "en": "Login",
            "hu": "Bejelentkezés"
        },
        "account": {
            "en": "Account settings",
            "hu": "Fiók beállítások"
        },
        "logout": {
            "en": "Logout",
            "hu": "Kijelentkezés"
        },
        "menu": {
            "en": "Menu",
            "hu": "Menü"
        },
    }
};

// merge a module slice into the dictionary, deeper keys win over shallower ones
const add = (slice) => {
    const merge = (target, source) => {
        for (const key in source) {
            const value = source[key];
            if (typeof value === "object" && value !== null && typeof target[key] === "object" && target[key] !== null) {
                merge(target[key], value);
            } else {
                target[key] = value;
            }
        }
    };
    merge(dict, slice);
    return dict;
};

const get = (key, lang=curLang) => {
    let current = dict;
    const original = key;
    try {
        key = key.split(".");
        for (let i = 0; i < key.length; i++) {
            current = current[key[i]];
        }
        return current[lang];
    } catch (e) {
        console.warn(`Localization key "${original}" not found!`);
        return "";
    }
    
};

// translate a subtree, so a fragment can be translated the moment it is built
// and before it reaches the document
const translate = (lang=curLang, root=document) => {
    const elements = root.querySelectorAll("[data-localization]");
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        const key = el.getAttribute("data-localization");
        const text = get(key, lang);
        if (text) {
            if (el.placeholder !== undefined) {
                el.placeholder = text;
            } else {
                el.innerText = text;
            }
        }
    }
};

// the module slices arrive after boot, so the list comes from the shell slice -
// every slice carries the same languages
const getSupportedLanguages = () => {
    const langs = [];
    const getFirstKey = (obj) => {
        if (typeof obj !== "object") {
            return null;
        }
        for (const key in obj) {
            return key;
        }

    };
    let prevObj = null;
    let lastObj = dict;
    let lastKey = getFirstKey(lastObj);
    while (lastKey !== null) {
        prevObj = lastObj;
        lastObj = lastObj[lastKey];
        lastKey = getFirstKey(lastObj);
    }
    return Object.keys(prevObj);
};

const escapeRegex = (str) => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const putParameters = (str, params=new Map(), charStart="{", charEnd="}", charStartEscape="\\{", charEndEscape="\\}") => {
    // First, replace escaped characters with temporary placeholders
    const startPlaceholder = "\x00START\x00";
    const endPlaceholder = "\x00END\x00";
    
    let result = str.replace(new RegExp(escapeRegex(charStartEscape), 'g'), startPlaceholder);
    result = result.replace(new RegExp(escapeRegex(charEndEscape), 'g'), endPlaceholder);
    
    // Replace parameters
    params.forEach((value, key) => {
        const pattern = new RegExp(escapeRegex(charStart) + escapeRegex(key) + escapeRegex(charEnd), 'g');
        result = result.replace(pattern, value);
    });
    
    // Restore escaped characters to their literal form (without the backslash)
    result = result.replace(new RegExp(escapeRegex(startPlaceholder), 'g'), charStart);
    result = result.replace(new RegExp(escapeRegex(endPlaceholder), 'g'), charEnd);
    
    return result;
};

const supportedLanguages = getSupportedLanguages();

export { getLang, setLang, dict, add, get, translate, supportedLanguages, putParameters };
export default {
    "getLang": getLang,
    "setLang": setLang,
    "dict": dict,
    "add": add,
    "get": get,
    "translate": translate,
    "supportedLanguages": supportedLanguages,
    "putParameters": putParameters
};
