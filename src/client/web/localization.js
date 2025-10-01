"use strict";

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
        "outgoings": {
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
        "menu": {
            "en": "Menu",
            "hu": "Menü"
        },
    },
    "settings": {
        "title": {
            "en": "Settings",
            "hu": "Beállítások"
        },
        "appearance": {
            "title": {
                "en": "Appearance settings",
                "hu": "Megjelenés beállítások"
            },
            "btn": {
                "en": "Appearance",
                "hu": "Megjelenés"
            },
            "theme": {
                "en": "Theme color",
                "hu": "Téma szín"
            },
            "lang": {
                "en": "Language",
                "hu": "Nyelv"
            },
            "autolang": {
                "en": "-- Automatic selection --",
                "hu": "-- Automatikus kiválasztás --"
            }
        },
        "audio": {
            "title": {
                "en": "Audio settings",
                "hu": "Hang beállítások"
            },
            "btn": {
                "en": "Audio",
                "hu": "Hang"
            }
        },
        "video": {
            "title": {
                "en": "Video settings",
                "hu": "Videó beállítások"
            },
            "btn": {
                "en": "Video",
                "hu": "Videó"
            }
        },
        "control": {
            "title": {
                "en": "Control settings",
                "hu": "Irányítás beállítások"
            },
            "btn": {
                "en": "Control",
                "hu": "Irányítás"
            }
        },
        "about": {
            "title": {
                "en": "About application",
                "hu": "Az alkalmazásról"
            },
            "btn": {
                "en": "About",
                "hu": "Névjegy"
            }
        }
    },
};

const get = (key, lang) => {
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

const translate = (lang) => {
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

export default {
    "dict": dict,
    "get": get,
    "translate": translate,
    "supportedLanguages": getSupportedLanguages()
};