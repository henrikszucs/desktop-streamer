"use strict";

let curLang = "en";
let dict = {};

const getLang = () => {
    return curLang;
};

const setLang = (lang) => {
    curLang = lang;
};

const load = (dictionary) => {
    dict = dictionary;
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

const translateHTML = (lang=curLang) => {
    const elements = document.querySelectorAll("[data-i18n]");
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        const key = el.getAttribute("data-i18n");
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
        console.log(lastObj);
        console.log(lastKey);
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

export default {
    "getLang": getLang,
    "setLang": setLang,
    "dict": dict,
    "load": load,
    "get": get,
    "translateHTML": translateHTML,
    "supportedLanguages": getSupportedLanguages(),
    "putParameters": putParameters
};