"use strict";

// the localization core: the lookup every module goes through. It holds no
// strings and knows no file of them - the shell load()s the slices of its own
// levels, and the registry add()s each module's slice as it loads

let curLang = "en";

const getLang = () => {
    return curLang;
};

const setLang = (lang) => {
    curLang = lang;
};

// the dictionary, empty until the slices arrive
const dict = {};

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

// every slice carries the same languages, so the list is read off the first
// leaf - empty before anything is loaded
const getSupportedLanguages = () => {
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
    while (lastKey !== null && lastKey !== undefined) {
        prevObj = lastObj;
        lastObj = lastObj[lastKey];
        lastKey = getFirstKey(lastObj);
    }
    return (prevObj === null ? [] : Object.keys(prevObj));
};

// one slice fetched into the dictionary
const load = async (url) => {
    const response = await fetch(url);
    if (response.ok === false) {
        throw new Error("Cannot load the dictionary " + url + ": " + response.status);
    }
    return add(await response.json());
};

const escapeRegex = (str) => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// a few dictionary strings carry markup of their own (the bold run in the two
// request lines), so what is substituted into one reaches the document as
// markup. A name or an address is neither this client's text nor the
// dictionary's - it came from a server - so it is escaped before it goes in.
const escapeHTML = (str) => {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
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
        // a function replacer, so a "$&" or a "$1" inside a value stays literal
        result = result.replace(pattern, function() { return value; });
    });
    
    // Restore escaped characters to their literal form (without the backslash)
    result = result.replace(new RegExp(escapeRegex(startPlaceholder), 'g'), charStart);
    result = result.replace(new RegExp(escapeRegex(endPlaceholder), 'g'), charEnd);
    
    return result;
};

export { getLang, setLang, dict, load, add, get, translate, getSupportedLanguages, putParameters, escapeHTML };
export default {
    "getLang": getLang,
    "setLang": setLang,
    "dict": dict,
    "load": load,
    "add": add,
    "get": get,
    "translate": translate,
    // read when asked, since the languages arrive with the slices
    get supportedLanguages() {
        return getSupportedLanguages();
    },
    "putParameters": putParameters,
    "escapeHTML": escapeHTML
};
