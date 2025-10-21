"use strict";

let curLang = "en";

const getLang = () => {
    return curLang;
};

const setLang = (lang) => {
    curLang = lang;
};

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
            },
            "autostart": {
                "title": {
                    "en": "Auto startup",
                    "hu": "Automatikus indítás"
                },
                "checkbox": {
                    "en": "Launch with the system",
                    "hu": "Indítás a rendszerrel"
                },
                "error": {
                    "en": "Auto launch not supported.",
                    "hu": "Az automatikus indítás nem támogatott."
                }
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
            },
            "system": {
                "title": {
                    "en": "System audio share",
                    "hu": "Rendszer hang megosztás"
                },
                "supported": {
                    "en": "Fully supported",
                    "hu": "Teljesen támogatott"
                },
                "partial": {
                    "en": "Only manual share supported",
                    "hu": "Csak manuális megosztás támogatott"
                },
                "unsupported": {
                    "en": "System audio share not supported",
                    "hu": "A rendszer hang megosztás nem támogatott"
                }
            },
            "speaker": {
                "title": {
                    "en": "Speakers",
                    "hu": "Hangszórók"
                },
                "test1": {
                    "en": "Test sound 1",
                    "hu": "Teszt hang 1"
                },
                "test2": {
                    "en": "Test sound 2",
                    "hu": "Teszt hang 2"
                },
                "test3": {
                    "en": "Test sound 3",
                    "hu": "Teszt hang 3"
                }
            },
            "mic": {
                "title": {
                    "en": "Microphones",
                    "hu": "Mikrofon"
                },
                "notfound": {
                    "en": "No Microphone",
                    "hu": "Nincs mikrofon"
                }
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
            },
            "cam": {
                "title": {
                    "en": "Webcams",
                    "hu": "Webkamera",
                },
                "notfound": {
                    "en": "No webcam detected",
                    "hu": "Webkamera nem található"
                }
            },
            "display": {
                "title": {
                    "en": "Screen share",
                    "hu": "Képernyő megosztás"
                },
                "notfound": {
                    "en": "Only manual share supported",
                    "hu": "Csak manuális megosztás támogatott"
                }
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
            },
            "control-share": {
                "title": {
                    "en": "Control share",
                    "hu": "Irányítás megosztás"
                },
                "supported": {
                    "en": "Fully supported",
                    "hu": "Teljesen támogatott"
                },
                "unsupported": {
                    "en": "Constol share not supported",
                    "hu": "Irányítás megosztása nem támogatott"
                }
            },
            "exit-shortcut": {
                "title": {
                    "en": "Fullscreen exit",
                    "hu": "Teljes képernyős kilépés"
                },
                "key": {
                    "en": "Key",
                    "hu": "Billentyű"
                },
                "delay": {
                    "en": "Holding time",
                    "hu": "Nyomvatartási idő"
                },
                "add": {
                    "en": "Add shortcut",
                    "hu": "Gyorsbillentyű hozzáadása"
                },
                "none": {
                    "en": "-- None --",
                    "hu": "-- Nincs --"
                },
                "delay-unit1": {
                    "en": "No delay",
                    "hu": "Azonnal"
                },
                "delay-unit2": {
                    "en": "1 second",
                    "hu": "1 másodperc"
                },
                "delay-unit3": {
                    "en": "2 seconds",
                    "hu": "2 másodperc"
                },
                "delay-unit4": {
                    "en": "3 seconds",
                    "hu": "3 másodperc"
                },
                "delay-unit5": {
                    "en": "5 seconds",
                    "hu": "5 másodperc"
                },
                "delay-unit6": {
                    "en": "8 seconds",
                    "hu": "8 másodperc"
                },
                "delay-unit7": {
                    "en": "10 seconds",
                    "hu": "10 másodperc"
                }
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
            },
            "version": {
                "en": "Version:",
                "hu": "Verzió:"
            },
            "description": {
                "en": "Desktop Streamer is an open source project that allows you to access your computer remotly through a simple web interface. It is built with Electron and Node.js.",
                "hu": "A Desktop Streamer egy nyílt forráskódú projekt, amely lehetővé teszi, hogy egyszerű webes felületen keresztül távolról hozzáférj a számítógépedhez. Az alkalmazás Electron és Node.js alapokon nyugszik."
            },
            "missing-features": {
                "en": "Missing features",
                "hu": "Hiányzó funkciók"
            },
            "supported": {
                "en": "Nothing missing, all features are supported.",
                "hu": "Nincs hiányzó funkció, minden támogatott."
            },
            "auto-launch": {
                "en": "Auto launch: not supported",
                "hu": "Automatikus indítás: nem támogatott"
            },
            "system-audio": {
                "en": "System audio share: only manual share",
                "hu": "Rendszer hang megosztás: csak manuális megosztás"
            },
            "system-audio-unsupported": {
                "en": "System audio share: not supported",
                "hu": "Rendszer hang megosztás: nem támogatott"
            },
            "screen-share": {
                "en": "Screen share: only manual share",
                "hu": "Képernyő megosztás: csak manuális megosztás"
            },
            "control-share": {
                "en": "Control share: not supported",
                "hu": "Irányítás megosztás: nem támogatott"
            }
        }
    },
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

const translate = (lang=curLang) => {
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
    "getLang": getLang,
    "setLang": setLang,
    "dict": dict,
    "get": get,
    "translate": translate,
    "supportedLanguages": getSupportedLanguages()
};