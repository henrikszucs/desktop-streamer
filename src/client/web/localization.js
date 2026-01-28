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
            "tray": {
                "title": {
                    "en": "System tray",
                    "hu": "Rendszer tálca"
                },
                "checkbox": {
                    "en": "Create tray icon instead close",
                    "hu": "Rendszer tálca ikon bezárás helyett"
                },
                "error": {
                    "en": "System tray not supported.",
                    "hu": "A rendszer tálca nem támogatott."
                }
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
            "decoder": {
                "title": {
                    "en": "Audio play",
                    "hu": "Hang lejátszás"
                },
                "supported": {
                    "en": "Low latency play supported",
                    "hu": "Alacsony késleltetésű lejátszás támogatott"
                },
                "unsupported": {
                    "en": "Low latency play not supported",
                    "hu": "Alacsony késleltetésű lejátszás nem támogatott"
                }
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
            "decoder": {
                "title": {
                    "en": "Video play",
                    "hu": "Videó lejátszás"
                },
                "supported": {
                    "en": "Low latency play supported",
                    "hu": "Alacsony késleltetésű lejátszás támogatott"
                },
                "unsupported": {
                    "en": "Low latency play not supported",
                    "hu": "Alacsony késleltetésű lejátszás nem támogatott"
                }
            },
            "cam": {
                "title": {
                    "en": "Webcams",
                    "hu": "Webkamera",
                },
                "name": {
                    "en": "Webcam",
                    "hu": "Webkamera"
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
                "name": {
                    "en": "Screen",
                    "hu": "Képernyő"
                },
                "notsupported": {
                    "en": "Only manual share supported",
                    "hu": "Csak manuális megosztás támogatott"
                },
                "notfound": {
                    "en": "Not found any device",
                    "hu": "Nem található eszköz"
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
                    "en": "Control share not supported",
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
            "tray": {
                "en": "System tray: not supported",
                "hu": "Rendszer tálca: nem támogatott"
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
            "play": {
                "en": "Low latency play: not supported",
                "hu": "Alacsony késleltetésű lejátszás: nem támogatott"
            },
            "control-share": {
                "en": "Control share: not supported",
                "hu": "Irányítás megosztás: nem támogatott"
            }
        }
    },
    "account": {
        "title": {
            "en": "Account settings",
            "hu": "Fiók beállítások"
        },
        "information": {
            "title": {
                "en": "Account information",
                "hu": "Fiók információk"
            },
            "btn": {
                "en": "Information",
                "hu": "Információk"
            },
            "account-data": {
                "en": "Account data",
                "hu": "Fiók adatok"
            },
            "email": {
                "en": "Email",
                "hu": "Email"
            },
            "first-name": {
                "en": "First name",
                "hu": "Keresztnév"
            },
            "last-name": {
                "en": "Last name",
                "hu": "Vezetéknév"
            }
        },
        "sessions": {
            "title": {
                "en": "Active sessions",
                "hu": "Aktív munkamenetek"
            },
            "btn": {
                "en": "Sessions",
                "hu": "Munkamenetek"
            },
            "last-active": {
                "en": "Last active",
                "hu": "Utojára aktív"
            },
            "ip-address": {
                "en": "IP address",
                "hu": "IP cím"
            },
            "this-device": {
                "en": "This device",
                "hu": "Ez az eszköz"
            },
        },
        "delete": {
            "title": {
                "en": "Delete account",
                "hu": "Fiók törlése"
            },
            "btn": {
                "en": "Delete",
                "hu": "Törlés"
            },
            "warning": {
                "en": "Deleting your account will remove all your data from our servers. This action is irreversible.",
                "hu": "A fiók törlése eltávolítja az összes adatot a szervereinkről. Ez a művelet visszafordíthatatlan."
            },
            "send-key": {
                "en": "Send delete key",
                "hu": "Törlési kulcs küldése"
            },
            "send-success": {
                "en": "You will receive a delete key in your email.",
                "hu": "A törlési kulcsot elküldtük email címedre."
            },
            "send-error": {
                "en": "Error sending delete key. Please try again later.",
                "hu": "Hiba történt a törlési kulcs küldése során. Kérlek próbáld meg később."
            },
            "delete-key": {
                "en": "Delete key",
                "hu": "Törlési kulcs"
            },
            "confirm": {
                "en": "Delete my account",
                "hu": "Fiókom törlése"
            },
            "confirm-delete": {
                "en": "Delete my account",
                "hu": "Fiókom törlése"
            },
            "confirm-error": {
                "en": "Error confirming delete key. Please try with other code.",
                "hu": "Hiba történt a törlési kulcs megerősítése során. Kérlek próbáld meg más kóddal."
            }
        }
    },
    "new": {
        "share": {
            "title": {
                "en": "Share device",
                "hu": "Eszköz megosztása"
            },
            "btn": {
                "en": "Share this device",
                "hu": "Eszköz megosztása"
            },
            "dialog-title": {
                "en": "Waiting for join...",
                "hu": "Csatlakozásra várás..."
            },
            "dialog-info": {
                "en": "Share this join code with someone you want to invite:",
                "hu": "Oszd meg ezt a csatlakozási kódot azzal, akit meghívni szeretnél:"
            },
            "join-code": {
                "en": "Join code",
                "hu": "Csatlakozási kód"
            },
            "dialog-info-2": {
                "en": "A popup will appear when someone wants to join your device.",
                "hu": "Egy felugró ablak jelenik meg, amikor valaki csatlakozni szeretne az eszközödhöz."
            },
            "request-title": {
                "en": "Join request",
                "hu": "Csatlakozási kérelem"
            },
            "full-name": {
                "en": "{firstName} {lastName}",
                "hu": "{lastName} {firstName}"
            },
            "guest": {
                "en": "Guest",
                "hu": "Vendég"
            },
            "request-info": {
                "en": "<span class=\"bold\">{fullName}</span> from <span class=\"bold\">{ipAddress}</span> IP address wants to join your device.",
                "hu": "<span class=\"bold\">{fullName}</span> a(z) <span class=\"bold\">{ipAddress}</span> IP címről csatlakozni szeretne az eszközödhöz."
            },
            "request-long": {
                "en": "Share for long term",
                "hu": "Hosszú távú megosztás"
            },
            "accept": {
                "en": "Accept",
                "hu": "Elfogadás"
            },
            "reject": {
                "en": "Reject",
                "hu": "Elutasítás"
            }
        },
        "join": {
            "title": {
                "en": "Join a room",
                "hu": "Csatlakozás egy szobához"
            },
            "join-code": {
                "en": "Join code",
                "hu": "Csatlakozási kód"
            },
            "btn": {
                "en": "Join",
                "hu": "Csatlakozás"
            },
            "code-invalid": {
                "en": "Invalid room code.",
                "hu": "Érvénytelen kód."
            },
            "code-rejected": {
                "en": "Connenction rejected.",
                "hu": "A csatlakozási elutasítva."
            },
            "dialog-title": {
                "en": "Joining room...",
                "hu": "Szobához csatlakozás..."
            },
            "full-name": {
                "en": "{firstName} {lastName}",
                "hu": "{lastName} {firstName}"
            },
            "guest": {
                "en": "Guest",
                "hu": "Vendég"
            },
            "dialog-info": {
                "en": "Establishing connection to host device as <span class=\"bold\">{fullName}</span> from <span class=\"bold\">{ipAddress}</span> IP address. Please wait...",
                "hu": "Kapcsolódás a kiszolgáló eszközhöz <span class=\"bold\">{fullName}</span> néven, <span class=\"bold\">{ipAddress}</span> IP címről. Kérlek várj..."
            },
        }
    }
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
    "get": get,
    "translate": translate,
    "supportedLanguages": getSupportedLanguages(),
    "putParameters": putParameters
};