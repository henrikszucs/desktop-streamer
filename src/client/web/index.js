"use strict";

// load dependencies
import IDB from "./libs/idb/idb.js";
import Communicator from "./libs/communicator/communicator.js";
import {BrowserAudioEncoder} from "./libs/ffmpeg-chunkifier/encoder-browser.js";
import {Decoder, Player} from "./libs/ffmpeg-chunkifier/decoder.js";

//load configuration
import conf from "./conf.js";
import localization from "./localization.js";



// desktop enviroment
const desktop = {
    "isAvailable": false
};
globalThis.desktop = desktop;   // for debugging

// general enviroment
const checkBrowser = function() {
    // Opera 8.0+
    const isOpera = (!!window.opr && !!opr.addons) || !!window.opera || navigator.userAgent.indexOf(' OPR/') >= 0;

    // Firefox 1.0+
    const isFirefox = typeof InstallTrigger !== 'undefined';

    // Safari 3.0+ "[object HTMLElementConstructor]" 
    const isSafari = /constructor/i.test(window.HTMLElement) || (function (p) { return p.toString() === "[object SafariRemoteNotification]"; })(!window['safari'] || (typeof safari !== 'undefined' && window['safari'].pushNotification));

    // Internet Explorer 6-11
    const isIE = /*@cc_on!@*/false || !!document.documentMode;

    // Edge 20+
    const isEdge = !isIE && !!window.StyleMedia;

    // Chrome 1 - 79
    const isChrome = !!window.chrome;

    // Edge (based on chromium) detection
    const isEdgeChromium = isChrome && (navigator.userAgent.indexOf("Edg") != -1);

    // Blink engine detection
    const isBlink = (isChrome || isOpera) && !!window.CSS;

    return {
        "isFirefox": isFirefox,
        "isChrome": isChrome,
        "isSafari": isSafari,
        "isOpera": isOpera,
        "isIE": isIE,
        "isEdge": isEdge,
        "isEdgeChromium": isEdgeChromium,
        "isBlink": isBlink
    };
};
const checkBrowser2 = () => {
    const ua = navigator.userAgent;
    let tem; 
    let M = ua.match(/(opera|chrome|safari|firefox|msie|trident(?=\/))\/?\s*(\d+)/i) || [];
    if (/trident/i.test(M[1])) {
        tem = /\brv[ :]+(\d+)/g.exec(ua) || [];
        return "IE " + (tem[1] || "");
    }
    if (M[1] === "Chrome") {
        tem = ua.match(/\b(OPR|Edge)\/(\d+)/);
        if (tem != null) {
            return tem.slice(1).join(" ").replace("OPR", "Opera");
        }
    }
    M = M[2]? [M[1], M[2]]: [navigator.appName, navigator.appVersion, "-?"];
    if ((tem = ua.match(/version\/(\d+)/i))!= null) { 
        M.splice(1, 1, tem[1]);
    }
    return M;
};

const browser = checkBrowser();
const width = window.innerWidth;
const sizeS = 600;
const sizeM = 993;

// Load local configuration from disk
const DATABBASE = "desktop_streamer";
const CONF_TABLE = "configuration";
let DB = null;
const confLoad = new Promise(async function(resolve) {
    await IDB.TableSet(DATABBASE, CONF_TABLE);
    DB = await IDB.DatabaseGet(DATABBASE);
    const table = IDB.TableGet(DB, CONF_TABLE);

    // key and their default values
    const vals = {
        "color": "#006e1c",
        "mode": "auto",
        "lang": "auto",
        "autoLaunch": false,
        "minimizing": false,
        "exitShortcuts": "[]",
        "sessionId": ""
    };

    // load values from database
    const keys = Object.keys(vals);
    const search = [];
    for (let key of keys) {
        search.push([key, vals[key]]);
    }
    const res = await IDB.RowGet(table, search);
    const result = {};
    let i = 0;
    for (let i = 0, length = keys.length; i < length; i++) {
        result[keys[i]] = res[i];
    }

    result["exitShortcuts"] = JSON.parse(result["exitShortcuts"]);
    resolve(result);
});


// Wait for the DOM to be ready
const domReady = new Promise(function (resolve) {
    window.addEventListener("load", () => {
        resolve();
    }, { "once": true });
});


// Server connection
const Server = class extends EventTarget {
    address = "";
    ws = null;
    communicator = null;
    isOnline = false;
    constructor(address) {
        super();
        //events: online / offline
        this.communicator = new Communicator({
            "sender": function() {},
            "interactTimeout": 3000,    //the max timeout between two packet arrive
        
            "timeout": 5000,            //the time for transmit message
            "packetSize": 1000,         //the maximum size of one packet in bytes (only for ArrayBuffer)
            "packetTimeout": 1000,      //the max timeout for packets
            "packetRetry": Infinity,    //number of retring attemts for one packet
            "sendThreads": 16
        });

        this.connect(address);
    };
    connect(address = this.address) {
        this.ws?.close?.();
        
        //create connection
        this.address = address;
        this.ws = new WebSocket(this.address);
        this.ws.binaryType = "arraybuffer";

        // configure sernder fn
        this.communicator.configure({
            "sender": async (data) => {
                if ((data instanceof ArrayBuffer) === false) {
                    data = JSON.stringify(data);
                }
                this.ws.send(data);
            }
        });

        // configure receiver fn
        this.ws.addEventListener("message", (event) => {
            console.log("Received data:", event.data);
            let data = event.data;
            if (typeof data === "string") {
                data = JSON.parse(data);
            }
            this.communicator.receive(data);
        });

        //connection status
        this.ws.addEventListener("open", async () => {
            // sync
            await this.communicator.sideSync();
            await this.communicator.timeSync();

            // get server conf
            try {
                const message = this.communicator.invoke({"type":"conf-get"});
                await message.wait();
                conf["ws"]["remote"] = message.data;
            } catch (error) {
                console.error("Failed to get server configuration:", error);
                this.ws.close();
                return;
            }
            if (typeof conf["ws"]["remote"] === "undefined") {
                this.ws.close();
                return;
            }

            // trigger online
            console.log("connected");
            this.dispatchEvent(new CustomEvent("online"));
            this.isOnline = true;
        }, { "once": true });
        this.ws.addEventListener("error", () => {
            console.log("disconnected");
            this.dispatchEvent(new CustomEvent("offline"));
            this.isOnline = false;
        }, { "once": true });
        this.ws.addEventListener("close", () => {
            console.log("closed");
            this.dispatchEvent(new CustomEvent("offline"));
            this.isOnline = false;
            setTimeout(() => {
                this.connect();
            }, 2000);
        }, { "once": true });
    };
    async authGoogle(credential) {
        const message = this.communicator.invoke({"type":"login-google", "credential": credential});
        await message.wait();
        console.log(message.data);
        return message.data;
    };
};
globalThis.server = new Server("wss://" + conf["ws"]["domain"] + ":" + conf["ws"]["port"]);


// UI classes
const EmptyDialog = class {
    constructor() {
        // get important elements
    };
    open = () => {
        // open dialog
    };
    close = () => {
        // close dialog
    };
};

const LoadingDialog = class {
    constructor() {
        this.overlay = document.getElementById("dialog-overlay");
        this.loading = document.getElementById("dialog-loading");
    };
    open = () => {
        this.loading.classList.add("active");
        this.overlay.classList.add("blur");
        this.overlay.classList.add("active");
    };
    close = () => {
        // close dialog
        this.loading.classList.remove("active");
        this.overlay.classList.remove("blur");
        this.overlay.classList.remove("active");
        
    };
};

const SearchDialog = class extends EventTarget {
    constructor() {
        super();

        // get important elements
        this.overlay = document.getElementById("dialog-overlay");
        this.searchInput = document.getElementById("input-search");
        this.searchInputMenu = document.getElementById("input-search-menu");
        this.searchInputTrue = document.getElementById("input-search-true");
        this.searchInputFinish = document.getElementById("input-search-finish");
        this.searchDialog = document.getElementById("dialog-search");
        this.searchInput2 = document.getElementById("input-search-2");
        this.searchInput2Menu = document.getElementById("input-search-2-menu");
        this.searchInput2True = document.getElementById("input-search-2-true");
        this.searchInput2Finish = document.getElementById("input-search-2-finish");

        // set passive behavior
        // common value for all input elements
        this.searchInput.addEventListener("click", () => {
            this.searchInputTrue.focus();
        });
        this.searchInput2.addEventListener("click", () => {
            this.searchInput2True.focus();
        });
        this.searchInputTrue.addEventListener("input", this.spreadSearchInput);
        this.searchInput2True.addEventListener("input", this.spreadSearchInput);


        // finish of search input
        this.searchInputTrue.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                this.searchInputTrue.blur();
                this.triggerSearch();
            }
        });
        this.searchInput2True.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                this.close();
                this.triggerSearch();
            }
        });
        this.searchInputFinish.addEventListener("click", () => {
            this.triggerSearch();
        });
        this.searchInput2Finish.addEventListener("click", () => {
            this.close();
            this.triggerSearch();
        });
    };
    open = () => {
        this.overlay.classList.add("active");
        this.searchDialog.classList.add("active");
        this.searchInput2True.focus();
        this.overlay.addEventListener("click", this.close);
    };
    close = () => {
        this.searchInput2.blur();
        this.searchInput2True.blur();
        this.overlay.classList.remove("active");
        this.searchDialog.classList.remove("active");
        this.overlay.removeEventListener("click", this.close);
    };
    spreadSearchInput = (event) => {
        const value = event.target.value;
        this.searchInput.value = value;
        this.searchInputTrue.value = value;
        this.searchInput2.value = value;
        this.searchInput2True.value = value;
    };
    triggerSearch() {
        this.dispatchEvent(new CustomEvent("search", {
            "detail": {
                "value": this.searchInput.value
            }
        }));
    };
};

const MenuDialog = class {
    constructor() {
        // get important elements
        this.overlay = document.getElementById("dialog-overlay");
        this.dialog = document.getElementById("dialog-menu");
        this.closeBtn = document.getElementById("btn-menu-close");

        // set event listeners
        this.closeBtn.addEventListener("click", () => {
            this.close();
        });
    };
    open = () => {
        this.overlay.classList.add("active");
        this.dialog.classList.add("active");
        this.overlay.addEventListener("click", this.close);
    };
    close = () => {
        this.overlay.classList.remove("active");
        this.dialog.classList.remove("active");
        this.overlay.removeEventListener("click", this.close);
    };
};

const SettingsDialog = class {
    constructor() {
        // get important elements
        this.overlay = document.getElementById("dialog-overlay");
        this.settingsBtn = document.getElementById("btn-settings");
        this.settingsDialog = document.getElementById("dialog-settings");
        this.settingsClose = document.getElementById("btn-settings-close");
        
        // set event listeners
        this.settingsClose.addEventListener("click", () => {
            this.close();
        });

        // device list
        const listDevicesHelper = async function (type) {
            const selectedDevices = [];
            let devices = await navigator.mediaDevices.enumerateDevices();
            for (let device of devices) {
                if (device.kind === type && (device.deviceId !== "default" || device.deviceId !== "communications")) {
                    selectedDevices.push(device);
                }
            }
            const startLenght = selectedDevices.length;
            for (let i = startLenght - 1; i > -1; i--) {
                if (selectedDevices[i].deviceId === "" ) {
                    selectedDevices.splice(i, 1);
                }
            }

            if (selectedDevices.length === 0 && startLenght !== 0) {
                return undefined;
            }
            return selectedDevices;
        };
        const listDevices = async function(type="audioinput") {
            // try to list device
            let selectedDevices = await listDevicesHelper(type);

            // try to get permission by accessing microphone
            if (selectedDevices === undefined) {
                try {
                    const accessMediaStream = await navigator.mediaDevices.getUserMedia({"audio": true, "video": true});
                    const accessTracks = accessMediaStream.getTracks();
                    for (let track of accessTracks) {
                        track.stop();
                    }
                } catch(err) {
                    console.log(err);
                }

                // try to list device again
                selectedDevices = await listDevicesHelper(type);
                if (selectedDevices === undefined) {
                    return [];
                }
            }
                        
            return selectedDevices;
        };

        // Window classes
        const AppearanceWindow = class {
            constructor() {
                this.win = document.getElementById("settings-appearance");
                this.btn = document.getElementById("btn-settings-appearance");
                
                // language settings
                this.langSelect = document.getElementById("select-appearance-lang");
                this.langSelect.addEventListener("change", async (event) => {
                    let lang = event.target.value;
                    if (lang !== "auto" && localization.supportedLanguages.indexOf(lang) === -1) {
                        lang = "auto";
                    }
                    conf["local"]["lang"] = lang;
                    await IDB.RowSet(IDB.TableGet(DB, CONF_TABLE), [["lang", lang]]);
                    
                    if (lang === "auto") {
                        lang = (navigator.language || navigator.userLanguage).substring(0,2);
                    }
                    if (localization.supportedLanguages.indexOf(lang) === -1) {
                        lang = "en";
                    }
                    localization.setLang(lang);
                    localization.translate(lang);
                    if (desktop.isAvailable) {
                        desktop.ipcRenderer.send("api", "set-lang", lang);
                    }

                });

                // theme settings
                this.themeBtn = document.getElementById("btn-appearance-theme");
                this.themeBtn.addEventListener("click", async () => {
                    if (conf["local"]["mode"] === "auto") {
                        conf["local"]["mode"] = "light";
                    } else if (conf["local"]["mode"] === "light") {
                        conf["local"]["mode"] = "dark";
                    } else {
                        conf["local"]["mode"] = "auto";
                    }
                    let mode = conf["local"]["mode"];
                    if (mode === "auto") {
                        mode = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
                    }
                    globalThis.ui("mode", mode);
                    this.setThemeIcon();
                    await IDB.RowSet(IDB.TableGet(DB, CONF_TABLE), [["mode", conf["local"]["mode"]]]);
                });
                document.getElementById("btn-appearance-theme-color").addEventListener("change", (event) => {
                    const color = event.target.value;
                    this.setColor(color);
                });
                document.getElementById("btn-appearance-theme-green").addEventListener("click", (event) => {
                    this.setColor("#006e1c");
                });
                document.getElementById("btn-appearance-theme-red").addEventListener("click", (event) => {
                    this.setColor("#f44336");
                });
                document.getElementById("btn-appearance-theme-pink").addEventListener("click", (event) => {
                    this.setColor("#e91e63");
                });
                document.getElementById("btn-appearance-theme-purple").addEventListener("click", (event) => {
                    this.setColor("#9c27b0");
                });
                document.getElementById("btn-appearance-theme-indigo").addEventListener("click", (event) => {
                    this.setColor("#3f51b5");
                });
                document.getElementById("btn-appearance-theme-blue").addEventListener("click", (event) => {
                    this.setColor("#2196f3");
                });
                document.getElementById("btn-appearance-theme-yellow").addEventListener("click", (event) => {
                    this.setColor("#ffeb3b");
                });
                document.getElementById("btn-appearance-theme-orange").addEventListener("click", (event) => {
                    this.setColor("#ff9800");
                });

                // tray setting
                this.trayCheckbox = document.getElementById("checkbox-tray");
                this.trayLabel = document.getElementById("label-tray");
                this.trayError = document.getElementById("error-tray");
                if (desktop.isAvailable) {
                    this.trayLabel.classList.remove("hide");
                    this.trayCheckbox.checked = conf["local"]["minimizing"];
                    this.trayCheckbox.addEventListener("change", async (event) => {
                        const isChecked = event.target.checked;
                        conf["local"]["minimizing"] = isChecked;
                        desktop.ipcRenderer.send("api", "set-tray", isChecked);
                        await IDB.RowSet(IDB.TableGet(DB, CONF_TABLE), [["minimizing", isChecked]]);
                    });
                } else {
                    this.trayError.classList.remove("hide");
                }

                // auto lanunch
                this.autoLaunchLabel = document.getElementById("label-auto-launch");
                this.autoLaunchCheckbox = document.getElementById("checkbox-auto-launch");
                this.autoLaunchError = document.getElementById("error-auto-launch");
                if (desktop.isAvailable) {
                    this.autoLaunchLabel.classList.remove("hide");
                    console.log(desktop.autoLaunch);
                    desktop.autoLaunch.isEnabled().then((isEnabled) => {
                        this.autoLaunchCheckbox.checked = isEnabled;
                    });
                    this.autoLaunchCheckbox.addEventListener("change", async (event) => {
                        const isChecked = event.target.checked;
                        if (isChecked) {
                            await desktop.autoLaunch.enable();
                        } else {
                            await desktop.autoLaunch.disable();
                        }
                        const isEnabled = await desktop.autoLaunch.isEnabled();
                        event.target.checked = isEnabled;
                        conf["local"]["autoLaunch"] = isEnabled;
                        await IDB.RowSet(IDB.TableGet(DB, CONF_TABLE), [["autoLaunch", isEnabled]]);
                    });

                } else {
                    this.autoLaunchError.classList.remove("hide");
                }

            };
            setThemeIcon() {
                if (conf["local"]["mode"] === "auto") {
                    this.themeBtn.children[0].innerText = "hdr_auto";
                } else if (conf["local"]["mode"] === "light") {
                    this.themeBtn.children[0].innerText = "light_mode";
                } else {
                    this.themeBtn.children[0].innerText = "dark_mode";
                }
            };
            async setColor(color) {
                globalThis.ui("theme", color);

                /*const r = Number("0x"+color.slice(1,3));
                const g = Number("0x"+color.slice(3,5));
                const b = Number("0x"+color.slice(5,7));
                const isNeedDark = 0.2126 * r + 0.7152 * g + 0.0722 * b > 127;

                const newMode = isNeedDark ? "dark" : "light";
                */

                conf["local"]["color"] = color;
                await IDB.RowSet(IDB.TableGet(DB, CONF_TABLE), [["color", color]]);
            };
            open = () => {
                this.langSelect.value = conf["local"]["lang"];
                this.setThemeIcon();

                this.win.classList.remove("hide");
                this.btn.classList.add("primary");
                this.btn.classList.remove("fill");
            };
            close = () => {
                this.win.classList.add("hide");
                this.btn.classList.remove("primary");
                this.btn.classList.add("fill");
            };
        };

        const AudioWindow = class {
            constructor() {
                this.win = document.getElementById("settings-audio");
                this.btn = document.getElementById("btn-settings-audio");

                this.audioSpeakerContext = null;
                this.audioMicContext = null;

                // decoder support
                this.decoderAudioSupport = document.getElementById("decoder-audio-support");
                this.decoderAudioUnsupport = document.getElementById("decoder-audio-unsupport");
                if (typeof AudioDecoder !== "undefined") {
                    this.decoderAudioSupport.classList.remove("hide");
                } else {
                    this.decoderAudioUnsupport.classList.remove("hide");
                }

                // system audio share
                this.systemAudioSupport = document.getElementById("system-audio-support");
                this.systemAudioPartial = document.getElementById("system-audio-partial");
                this.systemAudioUnsupport = document.getElementById("system-audio-unsupport");
                if (desktop.isAvailable) {
                    this.systemAudioSupport.classList.remove("hide");
                } else if (browser["isChrome"] || browser["isOpera"] || browser["isEdgeChromium"]) {
                    this.systemAudioPartial.classList.remove("hide");
                } else {
                    this.systemAudioUnsupport.classList.remove("hide");
                }

                // speaker test
                this.speakerSelect = document.getElementById("select-audio-test");
                this.speakerBtn = document.getElementById("btn-test-audio-test");
                this.speakerContext = null;
                this.speakerSource = null;
                this.speakerSelect.addEventListener("change", (event) => {
                    this.speakerStop();
                });
                this.speakerBtn.addEventListener("click", async () => {
                    if (this.speakerContext !== null) {
                        this.speakerStop();
                        return;
                    }
                    this.speakerBtn.children[0].innerText = "pause";

                    const value = this.speakerSelect.value;
                    let url;
                    if (value === "0") {
                        url = "/sounds/test1.mp3";
                    } else if (value === "1") {
                        url = "/sounds/test2.mp3";
                    } else {
                        url = "/sounds/test3.mp3";
                    }

                    const context = new AudioContext();
                    const source = context.createBufferSource();

                    this.speakerContext = context;
                    this.speakerSource = source;

                    const res = await fetch(url);
                    const buffer = await res.arrayBuffer();
                    const audioBuffer = await context.decodeAudioData(buffer);
                    source.buffer = audioBuffer;
                    source.connect(context.destination);
                    source.start();
                    source.onended = (event) => {
                        this.speakerStop();
                    };
                });
                        

                // mic test
                this.micSelect = document.getElementById("select-audio-input");
                this.micRefresh = document.getElementById("btn-refresh-audio-input");
                this.micTest = document.getElementById("btn-test-audio-input");
                this.listMic = async () => {
                    // list audio input devices
                    const selectedDevices = await listDevices("audioinput");

                    // remove all old options
                    const select = this.micSelect;
                    for (let i = select.options.length-1; i > -1; i--) {
                        select.remove(i);
                    }

                    // add new options
                    if (selectedDevices.length === 0) {
                        select.disabled = true;
                        const option = new Option(localization.get("settings.audio.mic.notfound"), "");
                        select.add(option);
                    } else {
                        select.disabled = false;
                        for (let device of selectedDevices) {
                            const option = new Option(device.label || `Microphone ${select.options.length+1}`, device.deviceId);
                            select.add(option);
                        }
                        select.dispatchEvent(new Event("change"));
                    }
                };
                navigator.mediaDevices.addEventListener("devicechange", () => {
                    this.listMic();
                });
                this.micRefresh.addEventListener("click", () => {
                    this.listMic();
                });
                this.micSelect.addEventListener("change", (event) => {
                    const deviceId = event.target.value;
                    if (deviceId === "") {
                        this.micTest.disabled = true;
                    } else {
                        this.micTest.disabled = false;
                    }
                });

                this.micTestContext = null;
                this.micTestStream = null;
                this.micTestInterval = -1;
                this.micTest.addEventListener("click", async () => {
                    if (this.micTestContext !== null) {
                        this.micStop();
                        return;
                    }

                    const deviceId = this.micSelect.value;
                    const stream = await navigator.mediaDevices.getUserMedia({"audio": {"deviceId": deviceId}});

                    const audioCtx = new AudioContext();
                    const analyser = audioCtx.createAnalyser();
                    const source = audioCtx.createMediaStreamSource(stream);
                    source.connect(analyser);

                    this.micTestContext = audioCtx;
                    this.micTestStream = stream;

                    analyser.fftSize = 32;
                    const bufferLength = analyser.frequencyBinCount;
                    const dataArray = new Uint8Array(bufferLength);
                    
                    this.micTestInterval = setInterval(() => {
                        analyser.getByteFrequencyData(dataArray);
                        let sum = 0;
                        for (let i = 0; i < bufferLength; i++) {
                            sum = Math.max(dataArray[i]);
                        }
                        const avg = sum;
                        if (avg > 50) {
                            this.micTest.children[0].innerText = "signal_cellular_alt";
                        } else if (avg > 26) {
                            this.micTest.children[0].innerText = "signal_cellular_alt_2_bar";
                        } else {
                            this.micTest.children[0].innerText = "signal_cellular_alt_1_bar";
                        }
                    }, 100);

                });

            };
            speakerStop() {
                if (this.speakerContext === null) {
                    return;
                }

                this.speakerSource.stop();
                this.speakerSource = null;
                this.speakerContext.close();
                this.speakerContext = null;
                
                this.speakerBtn.children[0].innerText = "play_arrow";
            };
            micStop() {
                if (this.micTestContext === null) {
                    return;
                }

                this.micTestContext.close();
                this.micTestContext = null;

                const tracks = this.micTestStream.getTracks();
                for (let track of tracks) {
                    track.stop();
                }
                this.micTestStream = null;

                clearInterval(this.micTestInterval);
                this.micTestInterval = -1;

                this.micTest.children[0].innerText = "play_arrow";
            };
            
            open = () => {
                this.win.classList.remove("hide");
                this.btn.classList.add("primary");
                this.btn.classList.remove("fill");
                this.listMic();
            };
            close = () => {
                this.win.classList.add("hide");
                this.btn.classList.remove("primary");
                this.btn.classList.add("fill");
                this.speakerStop();
                this.micStop();
            };
            
        };

        const VideoWindow = class {
            constructor() {
                this.win = document.getElementById("settings-video");
                this.btn = document.getElementById("btn-settings-video");

                // decoder support
                this.decoderVideoSupport = document.getElementById("decoder-video-support");
                this.decoderVideoUnsupport = document.getElementById("decoder-video-unsupport");
                if (typeof VideoDecoder !== "undefined") {
                    this.decoderVideoSupport.classList.remove("hide");
                } else {
                    this.decoderVideoUnsupport.classList.remove("hide");
                }

                // camera
                this.cameraSelect = document.getElementById("select-camera-input");
                this.cameraRefresh = document.getElementById("btn-camera-refresh");
                this.cameraTest = document.getElementById("btn-camera-test");
                this.listCam = async () => {
                    // list audio input devices
                    const selectedDevices = await listDevices("videoinput");

                    // remove all old options
                    const select = this.cameraSelect;
                    for (let i = select.options.length-1; i > -1; i--) {
                        select.remove(i);
                    }

                    // add new options
                    if (selectedDevices.length === 0) {
                        select.disabled = true;
                        const option = new Option(localization.get("settings.video.cam.notfound"), "");
                        select.add(option);
                    } else {
                        select.disabled = false;
                        for (let device of selectedDevices) {
                            const option = new Option(device.label || localization.get("settings.video.cam.name") + " " + select.options.length+1, device.deviceId);
                            select.add(option);
                        }
                        select.dispatchEvent(new Event("change"));
                    }
                };
                navigator.mediaDevices.addEventListener("devicechange", () => {
                    this.listCam();
                });
                this.cameraRefresh.addEventListener("click", () => {
                    this.listCam();
                });
                this.cameraSelect.addEventListener("change", (event) => {
                    const deviceId = event.target.value;
                    if (deviceId === "") {
                        this.cameraTest.disabled = true;
                    } else {
                        this.cameraTest.disabled = false;
                    }
                });

                this.cameraVideo = document.getElementById("video-camera-test");
                this.cameraVideoBox = document.getElementById("video-camera-test-box");
                this.cameraTestStream = null;
                this.cameraTest.addEventListener("click", async () => {
                    if (this.cameraTestStream !== null) {
                        this.stopCam();
                        return;
                    }

                    const deviceId = this.cameraSelect.value;
                    const stream = await navigator.mediaDevices.getUserMedia({"video": {"deviceId": deviceId}});
                    
                    this.cameraVideo.srcObject = stream;
                    this.cameraTestStream = stream;
                    this.cameraVideoBox.classList.remove("hide");
                    this.cameraTest.children[0].innerText = "pause";
                });

                // screen test
                this.displaySelect = document.getElementById("select-display-input");
                this.displayRefresh = document.getElementById("btn-display-refresh");
                this.displayTest = document.getElementById("btn-display-test");
                this.displayVideo = document.getElementById("video-display-test");
                this.displayVideoBox = document.getElementById("video-display-test-box");
                this.displayTestStream = null;
                if (desktop.isAvailable) {
                    this.listDisplay = async () => {
                        const screens = desktop.Control.Screen.list();
                        if (screens.length === 0) {
                            // remove all old options
                            const select = this.displaySelect;
                            for (let i = select.options.length-1; i > -1; i--) {
                                select.remove(i);
                            }
                            this.displaySelect.disabled = true;
                            this.displayTest.disabled = true;
                            const option = new Option(localization.get("settings.video.display.notfound"), "");
                            select.add(option);
                            select.dispatchEvent(new Event("change"));
                        } else {
                            // remove all old options
                            const select = this.displaySelect;
                            for (let i = select.options.length-1; i > -1; i--) {
                                select.remove(i);
                            }
                            this.displaySelect.disabled = false;
                            for (let i = 0; i < screens.length; i++) {
                                const option = new Option(localization.get("settings.video.display.name") + " " +  (i+1), i);
                                this.displaySelect.add(option);
                            }
                            this.displaySelect.dispatchEvent(new Event("change"));
                        }
                    };
                    this.displayRefresh.addEventListener("click", () => {
                        this.listDisplay();
                    });
                    this.displayTest.addEventListener("click", async () => {
                        if (this.displayTestStream !== null) {
                            this.stopDisplay();
                            return;
                        }
                        const screenIndex = Number(this.displaySelect.value);
                        if (screenIndex < 0) {
                            return;
                        }
                        const trackGenerator = new MediaStreamTrackGenerator({ "kind": "video" });
                        console.log(trackGenerator)
                        const writer = trackGenerator.writable.getWriter();
                        const stream = new MediaStream([trackGenerator]);

                        this.decoder = new Decoder();
                        this.decoder.onVideoFrame = async (frame) => {
                            console.log("Decoded video frame:", frame);
                            try {
                                await writer.write(frame);
                            } catch (e) {
                                console.error("Failed to write frame:", e);
                            } finally {
                                frame.close();
                            }
                        };
                        this.videoEncoderFFmpeg = new desktop["FFmpegVideoEncoder"]();
                        this.videoEncoderFFmpeg.onConfiguration = (config) => {
                            console.log("Video configuration:", config);
                            this.decoder.appendVideoConfiguration(config);
                        };
                        this.videoEncoderFFmpeg.onChunk = (chunk) => {
                            console.log("Video chunk:", chunk);
                            this.decoder.appendVideoChunk(chunk);
                        };
                        this.videoEncoderFFmpeg.onEnd = (error) => {
                            console.log("Video encoding ended with error code:", error);
                        };

                        const ffpmegParams = [];
                        ffpmegParams.push(
                            "-fflags", "+nobuffer+flush_packets",
                            "-flags", "+low_delay",
                            "-analyzeduration", "0",         // Don't analyze input
                            "-probesize", "32",              // Minimum probe size
                            "-thread_queue_size", "8"       // Small queue");
                        );
                        if (desktop["os"].platform() === "win32") {
                            ffpmegParams.push(
                                "-filter_complex",
                                "gfxcapture=monitor_idx=" + screenIndex +
                                ":capture_cursor=true" +
                                ":max_framerate=30" +
                                ",hwdownload,format=bgra",
                            );
                        }
                        ffpmegParams.push(
                            "-c:v", "h264_nvenc",
                            "-b:v", "10000K",
                            "-tune:v", "3",
                            "-profile:v", "2",
                            "-level:v", "51",
                            "-rc:v", "1",
                            "-rgb_mode:v", "1",
                            "-delay:v", "0",
                            "-zerolatency:v", "1",
                                
                            "-framerate", "30",
                            "-g", "30",             // Keyframe interval (every 30 frames = 0.5s at 60fps)
                            "-keyint_min", "30",
                            "-force_key_frames", "expr:gte(t,n_forced*0.5)",
                            "-f", "mp4",
                            "-movflags", "frag_keyframe+empty_moov+default_base_moof+omit_tfhd_offset",
                            "-frag_duration", "16666",
                            "pipe:1"
                        );
                        await this.videoEncoderFFmpeg.start(
                            desktop["ffmpegPath"],
                            ffpmegParams,
                            {
                                "codec": "avc1.640033",
                                "codedWidth": 1920,
                                "codedHeight": 1080,
                                "hardwareAcceleration": "prefer-hardware",
                                "optimizeForLatency": true
                            }
                        );
                        this.displayVideo.srcObject = stream;
                        this.displayTestStream = stream;
                        stream.getVideoTracks()[0].addEventListener("ended", async () => {
                            this.stopDisplay();
                        });

                        this.displayVideoBox.classList.remove("hide");
                        this.displayTest.children[0].innerText = "pause";
                    });
                    this.listDisplay();

                } else {
                    this.displayRefresh.parentElement.classList.add("hide");

                    const select = this.displaySelect;
                    for (let i = select.options.length-1; i > -1; i--) {
                        select.remove(i);
                    }
                    this.displaySelect.disabled = true;
                    const option = new Option(localization.get("settings.video.display.notsupported"), "");
                    this.displaySelect.add(option);

                    this.displayTest.addEventListener("click", async () => {
                        if (this.displayTestStream !== null) {
                            this.stopDisplay();
                            return;
                        }
                        const stream = await navigator.mediaDevices.getDisplayMedia({"video": true, "audio": false});
                    
                        this.displayVideo.srcObject = stream;
                        this.displayTestStream = stream;
                        stream.getVideoTracks()[0].addEventListener("ended", () => {
                            this.stopDisplay();
                        });

                        this.displayVideoBox.classList.remove("hide");
                        this.displayTest.children[0].innerText = "pause";
                    });
                }

                
                
            };
            stopCam() {
                if (this.cameraTestStream === null) {
                    return;
                }
                this.cameraVideo.srcObject = null;

                const tracks = this.cameraTestStream.getTracks();
                for (let track of tracks) {
                    track.stop();
                }
                this.cameraTestStream = null;

                this.cameraVideoBox.classList.add("hide");
                this.cameraTest.children[0].innerText = "play_arrow";
            };
            async stopDisplay() {
                if (this.displayTestStream === null) {
                    return;
                }
                this.displayVideo.srcObject = null;

                const tracks = this.displayTestStream.getTracks();
                for (let track of tracks) {
                    track.stop();
                }
                this.displayTestStream = null;

                await this.videoEncoderFFmpeg?.end?.();
                await this.decoder?.end?.();

                this.displayVideoBox.classList.add("hide");
                this.displayTest.children[0].innerText = "play_arrow";
            };
            open = () => {
                this.win.classList.remove("hide");
                this.btn.classList.add("primary");
                this.btn.classList.remove("fill");
                this.listCam();
            };
            close = () => {
                this.win.classList.add("hide");
                this.btn.classList.remove("primary");
                this.btn.classList.add("fill");
                this.stopCam();
                this.stopDisplay();
            };
        };

        const ControlWindow = class {
            constructor() {
                this.win = document.getElementById("settings-control");
                this.btn = document.getElementById("btn-settings-control");

                // check mouse share support
                this.mouseShareSupport = document.getElementById("mouse-share-support");
                this.mouseShareUnsupport = document.getElementById("mouse-share-unsupport");
                if (desktop.isAvailable) {
                    this.mouseShareSupport.classList.remove("hide");
                } else {
                    this.mouseShareUnsupport.classList.remove("hide");
                }

                // exit shortcuts
                this.shortcuts = [];
                this.shortcutList = document.getElementById("shortcut-list");
                this.shortcutAdd = document.getElementById("btn-shortcut-add");
                this.shortcutAdd.addEventListener("click", async () => {
                    const newShortcut = {
                        "delay": "1",
                        "keys": []
                    };
                    conf["local"]["exitShortcuts"].push(newShortcut);
                    await IDB.RowSet(IDB.TableGet(DB, CONF_TABLE), [["exitShortcuts", JSON.stringify(conf["local"]["exitShortcuts"])]]);
                    this.createShortcut(newShortcut["delay"], Array.from(newShortcut["keys"]).join(" + "), newShortcut);
                });
            };
            createShortcut(delay, key, confobj) {
                const el = document.createElement("div");
                el.classList.add("shortcut-box");

                // delay
                const delayBox = document.createElement("div");
                delayBox.classList.add("field", "label", "suffix", "border", "round", "shortcut-delay");
                const delaySelect = document.createElement("select");
                for (let i = 1; i < 8; i++) {
                    const option = new Option(localization.get("settings.control.exit-shortcut.delay-unit"+i), i.toString());
                    delaySelect.add(option);
                    option.value = i.toString();
                }
                delaySelect.value = delay;
                if (typeof confobj === "undefined") {
                    delaySelect.disabled = true;
                } else {
                    delaySelect.addEventListener("change", async (event) => {
                        confobj["delay"] = event.target.value;
                        await IDB.RowSet(IDB.TableGet(DB, CONF_TABLE), [["exitShortcuts", JSON.stringify(conf["local"]["exitShortcuts"])]]);
                    });
                }
                delayBox.appendChild(delaySelect);
                const delayLabel = document.createElement("label");
                delayLabel.innerText = localization.get("settings.control.exit-shortcut.delay");
                delayBox.appendChild(delayLabel);
                const delayIcon = document.createElement("i");
                delayIcon.innerText = "arrow_drop_down";
                delayBox.appendChild(delayIcon);
                el.appendChild(delayBox);

                // key and delete
                const elSub = document.createElement("div");
                elSub.classList.add("shortcut-box-sub");

                const keyBox = document.createElement("div");
                keyBox.classList.add("field", "label", "border", "round", "shortcut-key");
                const keyInput = document.createElement("input");
                keyInput.type = "text";
                if (key === "") {
                    keyInput.value = localization.get("settings.control.exit-shortcut.none");
                } else {
                    keyInput.value = key;
                }
                if (typeof confobj === "undefined") {
                    keyInput.disabled = true;
                } else {
                    let firstKey = "";
                    const allkeys = new Set();
                    keyInput.addEventListener("keydown", (event) => {
                        event.preventDefault();
                        const key = event.key;
                        if (firstKey === "") {
                            allkeys.clear();
                            firstKey = key;
                        }
                        allkeys.add(key);
                        event.target.value = Array.from(allkeys).join(" + ");
                    });
                    keyInput.addEventListener("keyup", async (event) => {
                        event.preventDefault();
                        const key = event.key;
                        if (key === firstKey) {
                            firstKey = "";
                            confobj["keys"] = Array.from(allkeys);
                            await IDB.RowSet(IDB.TableGet(DB, CONF_TABLE), [["exitShortcuts", JSON.stringify(conf["local"]["exitShortcuts"])]]);
                        }
                    });
                }
                keyBox.appendChild(keyInput);
                const keyLabel = document.createElement("label");
                keyLabel.innerText = localization.get("settings.control.exit-shortcut.key");
                keyBox.appendChild(keyLabel);
                elSub.appendChild(keyBox);

                const deleteBox = document.createElement("div");
                deleteBox.classList.add("shortcut-delete");
                if (typeof confobj === "undefined") {
                    deleteBox.style.visibility = "hidden";
                } else {
                    deleteBox.addEventListener("click", async () => {
                        el.remove();
                        const exitShortcuts = conf["local"]["exitShortcuts"];
                        exitShortcuts.splice(exitShortcuts.indexOf(confobj), 1);
                        await IDB.RowSet(IDB.TableGet(DB, CONF_TABLE), [["exitShortcuts", JSON.stringify(exitShortcuts)]]);
                    });
                }
                const deleteBtn = document.createElement("button");
                const deleteIcon = document.createElement("i");
                deleteIcon.innerText = "delete";
                deleteBtn.appendChild(deleteIcon);
                deleteBox.appendChild(deleteBtn);
                elSub.appendChild(deleteBox);

                el.appendChild(elSub);

                this.shortcuts.push(el);
                this.shortcutList.appendChild(el);
                return [el, keyInput, deleteBtn];
            };
            deleteShortcut(el) {
                el.remove();
            };
            open = () => {
                this.shortcuts = [];
                // add browser specific shortcuts
                if (desktop.isAvailable === true) {
                    this.createShortcut("5", "ESC");
                } else {
                    this.createShortcut("1", "ESC");
                    this.createShortcut("1", "F11");
                }
                // add user defined shortcuts
                for (const shortcut of conf["local"]["exitShortcuts"]) {
                    this.createShortcut(shortcut["delay"], Array.from(shortcut["keys"]).join(" + "), shortcut);
                }
                
                this.win.classList.remove("hide");
                this.btn.classList.add("primary");
                this.btn.classList.remove("fill");
            };
            close = () => {
                for (const shortcut of this.shortcuts) {
                    this.deleteShortcut(shortcut);
                }

                this.win.classList.add("hide");
                this.btn.classList.remove("primary");
                this.btn.classList.add("fill");
            };
        };

        const AboutWindow = class {
            constructor() {
                this.win = document.getElementById("settings-about");
                this.btn = document.getElementById("btn-settings-about");

                this.version = document.getElementById("about-version");
                this.version.innerText = conf["http"]["version"];

                this.supported = document.getElementById("about-supported");
                let isMissing = false;

                // check autolaunch support
                this.autoLanuch = document.getElementById("about-auto-launch");
                if (desktop.isAvailable === false) {
                    isMissing = true;
                    this.autoLanuch.classList.remove("hide");
                }

                // check tray support
                this.tray = document.getElementById("about-tray");
                if (desktop.isAvailable === false) {
                    isMissing = true;
                    this.tray.classList.remove("hide");
                }

                // check system audio share support
                this.systemAudio = document.getElementById("about-audio");
                this.systemAudio2 = document.getElementById("about-audio-unsupported");
                if (desktop.isAvailable === false) {
                    isMissing = true;
                    if (browser["isChrome"] || browser["isOpera"] || browser["isEdgeChromium"]) {
                        this.systemAudio.classList.remove("hide");
                    } else {
                        this.systemAudio2.classList.remove("hide");
                    }
                }

                // check screen share support
                this.screenShare = document.getElementById("about-screen");
                if (desktop.isAvailable === false) {
                    isMissing = true;
                    this.screenShare.classList.remove("hide");
                }

                // check play support
                this.playback = document.getElementById("about-play");
                if (desktop.isAvailable === false && (typeof VideoDecoder === "undefined" || typeof AudioDecoder === "undefined")) {
                    isMissing = true;
                    this.playback.classList.remove("hide");
                }

                // check control share support
                this.controlShare = document.getElementById("about-control");
                if (desktop.isAvailable === false) {
                    isMissing = true;
                    this.controlShare.classList.remove("hide");
                }

                if (isMissing === false) {
                    this.supported.classList.remove("hide");
                }
            };
            open = () => {
                this.win.classList.remove("hide");
                this.btn.classList.add("primary");
                this.btn.classList.remove("fill");
            };
            close = () => {
                this.win.classList.add("hide");
                this.btn.classList.remove("primary");
                this.btn.classList.add("fill");
            };
        };
        
        const appearanceWindow = new AppearanceWindow();
        const audioWindow = new AudioWindow();
        const videoWindow = new VideoWindow();
        const controlWindow = new ControlWindow();
        const aboutWindow = new AboutWindow();

        // category change
        this.currentWindow = appearanceWindow;
        document.getElementById("btn-settings-appearance").addEventListener("click", () => {
            this.changeWindow(appearanceWindow);
        });
        document.getElementById("btn-settings-audio").addEventListener("click", () => {
            this.changeWindow(audioWindow);
        });
        document.getElementById("btn-settings-video").addEventListener("click", () => {
            this.changeWindow(videoWindow);
        });
        document.getElementById("btn-settings-control").addEventListener("click", () => {
            this.changeWindow(controlWindow);
        });
        document.getElementById("btn-settings-about").addEventListener("click", () => {
            this.changeWindow(aboutWindow);
        });
    };
    changeWindow(window) {
        this.currentWindow.close();
        window.open();
        this.currentWindow = window;
    };
    open = () => {
        this.overlay.classList.add("active");
        this.settingsDialog.classList.add("active");
        this.overlay.addEventListener("click", this.close);
        this.currentWindow.open();
    };
    close = () => {
        this.overlay.classList.remove("active");
        this.settingsDialog.classList.remove("active");
        this.overlay.removeEventListener("click", this.close);
        this.currentWindow.close();
    };
    
};

const AccountDialog = class {
    constructor() {
        // get important elements
        this.overlay = document.getElementById("dialog-overlay");
        this.accountDialog = document.getElementById("dialog-account");
        this.accountClose = document.getElementById("btn-account-close");

        // set event listeners
        this.accountClose.addEventListener("click", () => {
            this.close();
        });
    };
    open = () => {
        this.overlay.classList.add("active");
        this.accountDialog.classList.add("active");
        this.overlay.addEventListener("click", this.close);
    };
    close = () => {
        this.overlay.classList.remove("active");
        this.accountDialog.classList.remove("active");
        this.overlay.removeEventListener("click", this.close);
    };
};

const NewScreen = class {
    constructor() {
        // get important elements
        this.newScreen = document.getElementById("screen-new");
    };
    open = () => {
        this.newScreen.classList.remove("hide");
    };
    close = () => {
        this.newScreen.classList.add("hide");
    };
};

const DownloadScreen = class {
    constructor(clientList) {

        // convert client list to map
        this.clients = new Map();
        for (let client of clientList) {
            client = client.slice(0, client.lastIndexOf("."));
            client = client.split("-");
            let clientSet = this.clients.get(client[0]);
            if (clientSet === undefined) {
                const newClientSet = new Set();
                this.clients.set(client[0], newClientSet);
                clientSet = newClientSet;
            }
            clientSet.add(client[1]);
        }

        // get important elements
        this.downloadBtn = document.getElementById("btn-download");
        this.downloadBtn2 = document.getElementById("btn-download-2");
        this.downloadScreen = document.getElementById("screen-downloads");
        this.downloadWindows = document.getElementById("download-win32");
        this.downloadMacos = document.getElementById("download-macos");
        this.downloadLinux = document.getElementById("download-linux");
        this.downloadx64 = document.getElementById("download-x64");
        this.downloadx86 = document.getElementById("download-x86");
        this.downloadArm64 = document.getElementById("download-arm64");
        this.downloadArm32 = document.getElementById("download-arm32");
        this.downloadFinish = document.getElementById("download-finish");

        // selection and initialization
        if (this.clients.has("win32") === false) {
            this.downloadWindows.classList.add("hide");
        }
        if (this.clients.has("macos") === false) {
            this.downloadMacos.classList.add("hide");
        }
        if (this.clients.has("linux") === false) {
            this.downloadLinux.classList.add("hide");
        }
        this.lastOsChoice = this.downloadWindows;
        this.lastArchChoice = this.downloadx64;
        this.selectedOs = "win32";
        this.selectedArch = "x64";
        this.displayChoice(this.getOS(), this.getArch());

        // set event listeners
        this.downloadWindows.addEventListener("click", () => {
            this.displayChoice("win32");
        });
        this.downloadMacos.addEventListener("click", () => {
            this.displayChoice("macos");
        });
        this.downloadLinux.addEventListener("click", () => {
            this.displayChoice("linux");
        });

        this.downloadx86.addEventListener("click", () => {
            this.displayChoice(undefined, "x86");
        });
        this.downloadx64.addEventListener("click", () => {
            this.displayChoice(undefined, "x64");
        });
        this.downloadArm64.addEventListener("click", () => {
            this.displayChoice(undefined, "arm64");
        });
        this.downloadArm32.addEventListener("click", () => {
            this.displayChoice(undefined, "arm32");
        });

        this.downloadFinish.addEventListener("click", () => {
            const file = this.selectedOs + "-" + this.selectedArch + ".zip";
            console.log("Download client:", file);
            window.open(location.href + file, "_blank");
        });

        //hide on desktop
        if (desktop.isAvailable) {
            this.downloadBtn.classList.add("hide");
            this.downloadBtn2.classList.add("hide");
        }

    };
    open = () => {
        this.displayChoice(undefined, undefined);
        this.downloadScreen.classList.remove("hide");
    };
    close = () => {
        this.displayChoice(undefined, undefined);
        this.downloadScreen.classList.add("hide");
    };
    displayChoice = (os, arch) => {
        // select OS
        if (os === undefined) {
            os = this.selectedOs;
        }
        let osSet = this.clients.get(os);
        
        if (osSet === undefined) {
            const iterator = clients.entries();
            const value = iterator.next();
            os = value.value[0];
            osSet = value.value[1];
        }
        let newOsChoice = null;
        if (os === "win32") {
            newOsChoice = this.downloadWindows;
        } else if (os === "macos") {
            newOsChoice = this.downloadMacos;
        } else if (os === "linux") {
            newOsChoice = this.downloadLinux;
        }
        this.lastOsChoice.classList.add("border");
        newOsChoice.classList.remove("border");
        this.lastOsChoice = newOsChoice;
        this.selectedOs = os;

        if (osSet.has("x64") === false) {
            this.downloadx64.classList.add("hide");
        } else {
            this.downloadx64.classList.remove("hide");
        }
        if (osSet.has("x86") === false) {
            this.downloadx86.classList.add("hide");
        } else {
            this.downloadx86.classList.remove("hide");
        }
        if (osSet.has("arm64") === false) {
            this.downloadArm64.classList.add("hide");
        } else {
            this.downloadArm64.classList.remove("hide");
        }
        if (osSet.has("arm32") === false) {
            this.downloadArm32.classList.add("hide");
        } else {
            this.downloadArm32.classList.remove("hide");
        }
        

        // select architecture
        if (arch === undefined) {
            arch = this.selectedArch;
        }
        if (osSet.has(arch) === false) {
            const iterator = osSet.values();
            arch = iterator.next().value;
        }
        let newArchChoice = null;
        if (arch === "x64") {
            newArchChoice = this.downloadx64;
        } else if (arch === "x86") {
            newArchChoice = this.downloadx86;
        } else if (arch === "arm64") {
            newArchChoice = this.downloadArm64;
        } else if (arch === "arm32") {
            newArchChoice = this.downloadArm32;
        }
        if (newArchChoice !== this.lastArchChoice) {
            this.lastArchChoice.classList.add("border");
            newArchChoice.classList.remove("border");
            this.lastArchChoice = newArchChoice;
            this.selectedArch = arch;
        }

    };
    indexOf(array, value) {
        for (let i = 0; i < array.length; i++) {
            if (value.indexOf(array[i]) !== -1) {
                return i;
            }
        }
        return -1;
    };
    getArch() {
        const userAgent = window.navigator.userAgent;
        const x64Platforms = ["x86_64", "AMD64", "x64"];
        const x86Platforms = ["i386", "i686", "x86"];
        const arm64Platforms = ["arm64", "aarch64"];
        const arm32Platforms = ["armv7l", "armv6l", "arm"];

        let arch = "unknown";

        if (this.indexOf(x64Platforms, userAgent) !== -1) {
            arch = "x64";
        } else if (this.indexOf(x86Platforms, userAgent) !== -1) {
            arch = "x86";
        } else if (this.indexOf(arm64Platforms, userAgent) !== -1) {
            arch = "arm64";
        } else if (this.indexOf(arm32Platforms, userAgent) !== -1) {
            arch = "arm32";
        }
        return arch;
    };
    getOS() {
        const userAgent = window.navigator.userAgent;
        const platform = window.navigator?.userAgentData?.platform || window.navigator.platform;
        const macosPlatforms = ["macOS", "Macintosh", "MacIntel", "MacPPC", "Mac68K"];
        const windowsPlatforms = ["Win32", "Win64", "Windows", "WinCE"];
        const iosPlatforms = ["iPhone", "iPad", "iPod"];
        let os = "unknown";

        if (macosPlatforms.indexOf(platform) !== -1) {
            os = "macos";
        } else if (iosPlatforms.indexOf(platform) !== -1) {
            os = "ios";
        } else if (windowsPlatforms.indexOf(platform) !== -1) {
            os = "win32";
        } else if (/Android/.test(userAgent)) {
            os = "android";
        } else if (/Linux/.test(platform)) {
            os = "linux";
        }

        return os;
    };
};

const LoginScreen = class {
    constructor() {
        // get important elements
        this.loginScreen = document.getElementById("screen-login");
    };
    open = () => {
        // open login screen
        this.loginScreen.classList.remove("hide");
    };
    close = () => {
        // close login screen
        this.loginScreen.classList.add("hide");
    };
};

const ServiceScreen = class {
    constructor() {
        // get important elements
        this.serviceScreen = document.getElementById("screen-services");
        this.serviceBtn = document.getElementById("btn-services");
        this.serviceBtn2 = document.getElementById("btn-services-2");
    };
    open = () => {
        this.serviceScreen.classList.remove("hide");
        this.serviceBtn.classList.add("active");
        this.serviceBtn2.classList.add("fill");
    };
    close = () => {
        this.serviceScreen.classList.add("hide");
        this.serviceBtn.classList.remove("active");
        this.serviceBtn2.classList.remove("fill");
    };
};

const DeviceScreen = class {
    constructor() {
        // get important elements
        this.deviceScreen = document.getElementById("screen-devices");
        this.deviceBtn = document.getElementById("btn-devices");
        this.deviceBtn2 = document.getElementById("btn-devices-2");
    };
    open = () => {
        this.deviceScreen.classList.remove("hide");
        this.deviceBtn.classList.add("active");
        this.deviceBtn2.classList.add("fill");
    };
    close = () => {
        this.deviceScreen.classList.add("hide");
        this.deviceBtn.classList.remove("active");
        this.deviceBtn2.classList.remove("fill");
    };
};

const OutgoingScreen = class {
    constructor() {
        // get important elements
        this.outgoingScreen = document.getElementById("screen-outgoings");
        this.outgoingBtn = document.getElementById("btn-outgoings");
        this.outgoingBtn2 = document.getElementById("btn-outgoings-2");
    };
    open = () => {
        this.outgoingScreen.classList.remove("hide");
        this.outgoingBtn.classList.add("active");
        this.outgoingBtn2.classList.add("fill");
    };
    close = () => {
        this.outgoingScreen.classList.add("hide");
        this.outgoingBtn.classList.remove("active");
        this.outgoingBtn2.classList.remove("fill");
    };
};

const RoomScreen = class {
    constructor() {
        // get important elements
        this.roomScreen = document.getElementById("screen-room");
        this.navTop = document.getElementById("nav-top");
        this.navLeft = document.getElementById("nav-left");
    };
    open = () => {
        this.roomScreen.classList.remove("hide");
        this.navTop.classList.add("hide");
        this.navLeft.classList.add("hide");
    };
    close = () => {
        this.roomScreen.classList.add("hide");
        this.navTop.classList.remove("hide");
        this.navLeft.classList.remove("hide");
        
    };
};



const GoogleLogin = class extends EventTarget {
    constructor(clientId) {
        super();

        // load google script if not already loaded
        const scriptSrc = "https://accounts.google.com/gsi/client";
        if (document.querySelector("head script[src=\"" + scriptSrc + "\"]") === null) {
            const googleScript = document.createElement("script");
            googleScript.setAttribute("src", scriptSrc);
            document.head.appendChild(googleScript);
        }

        // store client id
        this.clientId = clientId;

        // global callback function
        window.onGoogleLogin = async (response) => {
            //console.log(response);
            let res;
            try {
                res = await server.authGoogle(response.credential);
            } catch(err) {
                console.error("Google login failed");
            }
            /*console.log("https://oauth2.googleapis.com/tokeninfo?id_token=" + response.credential);
            const responsePayload = this.decodeJWT(response.credential);
            console.log(responsePayload);*/
            console.log(res);
            if (typeof res === "undefined") {
                return;
            }
            this.dispatchEvent(
                new CustomEvent("login", {"detail": response})
            );
        }
    };
    createButton(el) {
        el.innerHTML = "<div data-auto_prompt=false data-callback=onGoogleLogin data-client_id=" + this.clientId + " data-context=signin data-ux_mode=popup id=g_id_onload></div><div class=g_id_signin data-logo_alignment=left data-shape=pill data-size=large data-text=signin_with data-theme=filled_blue data-type=standard></div>";
    };
    decodeJWT(token) {
        let base64Url = token.split(".")[1];
        let base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
        let jsonPayload = decodeURIComponent(atob(base64).split("").map(function (c) {
                return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
            }).join("")
        );
        return JSON.parse(jsonPayload);
    };
};



// Main logic
const main = async function() {

    //load desktop modules if available
    if (typeof require !== "undefined") {
        // load node modules
        const path = require("node:path");
        const os = require("node:os");
        const { spawn } = require("node:child_process");

        // load electron modules
        const { ipcRenderer } = require("electron");
        const appPath = await ipcRenderer.invoke("api", "path-app");
        const exePath = await ipcRenderer.invoke("api", "path-exe");

        // load desktop specific libs
        const AutoLaunch = require(path.join(appPath, "libs/auto-launch/auto-launch.js"));
        const Control = require(path.join(appPath, "libs/easy-control/easy-control.node"));
        const FFmpegEncoder = require(path.join(appPath, "libs/ffmpeg-chunkifier/encoder-ffmpeg.js"));

        // expose desktop APIs
        desktop["isAvailable"] = true;
        desktop["path"] = path;
        desktop["os"] = os;
        desktop["spawn"] = spawn;
        desktop["ipcRenderer"] = ipcRenderer;
        desktop["appPath"] = appPath;
        desktop["autoLaunch"] = new AutoLaunch({
            "name": "Desktop Streamer",
            "path": exePath
        });
        desktop["Control"] = Control;
        desktop["ffmpegPath"] = path.join(appPath, "libs/ffmpeg");
        desktop["FFmpegVideoEncoder"] = FFmpegEncoder["FFmpegVideoEncoder"];
        desktop["FFmpegAudioEncoder"] = FFmpegEncoder["FFmpegAudioEncoder"];

        // disable require to prevent security issues
        globalThis.require = undefined; // disable require for security reasons

        console.log(desktop);
    }
    
    const val = await Promise.all([confLoad, domReady]);
    conf["local"] = val[0];

    // load local conf
    globalThis.ui("theme", conf["local"]["color"]);
    setTimeout(() => {
        let mode = conf["local"]["mode"];
        if (mode === "auto") {
            mode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? "dark" : "light";
        }
        globalThis.ui("mode", mode);
    }, 1);

    let lang = conf["local"]["lang"];
    if (lang === "auto") {
        lang = (navigator.language || navigator.userLanguage).substring(0,2);
    }
    if (localization.supportedLanguages.indexOf(lang) === -1) {
        lang = "en";
    }
    localization.setLang(lang);
    localization.translate(lang);

    if (desktop.isAvailable) {
        desktop.ipcRenderer.invoke("api", "set-lang", lang);
        desktop.ipcRenderer.send("api", "set-tray", conf["local"]["minimizing"]);
    }
    
    console.log(conf);
    globalThis.localization = localization;


    // Search dialog
    const searchDialog = new SearchDialog();
    document.getElementById("btn-search").addEventListener("click", () => {
        openedDialog?.close();
        openedDialog = searchDialog;
        openedDialog.open();
    });
    searchDialog.addEventListener("search", (event) => {
        const value = event.detail.value;
        console.log("Search for:", value);
    });

    // Settings dialog
    const settingsDialog = new SettingsDialog();
    settingsDialog.settingsBtn.addEventListener("click", () => {
        switchDialog(settingsDialog);
    });

    // Account dialog
    const accountDialog = new AccountDialog();


    // New screen
    const newScreen = new NewScreen();
    document.getElementById("btn-new").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "new");
        loadPath();
    });
    document.getElementById("btn-new-2").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "new");
        loadPath();
    });

    // Download screen
    const downloadScreen = new DownloadScreen(conf["http"]["clients"]);
    document.getElementById("btn-download").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "downloads");
        loadPath();
    });
    document.getElementById("btn-download-2").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "downloads");
        loadPath();
    });

    // Login screen
    const loginScreen = new LoginScreen();
    document.getElementById("btn-login").addEventListener("click", () => {
        document.getElementById("btn-user-circle").blur();
        window.history.pushState({}, "", "/" + "login");
        loadPath();
    });
    
    // Rooms screen
    const serviceScreen = new ServiceScreen();
    document.getElementById("btn-services").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "services");
        loadPath();
    });
    document.getElementById("btn-services-2").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "services");
        loadPath();
    });

    // Devices screen
    const deviceScreen = new DeviceScreen();
    document.getElementById("btn-devices").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "devices");
        loadPath();
    });
    document.getElementById("btn-devices-2").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "devices");
        loadPath();
    });

    // Outgoings screen
    const outgoingScreen = new OutgoingScreen();
    document.getElementById("btn-outgoings").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "outgoings");
        loadPath();
    });
    document.getElementById("btn-outgoings-2").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "outgoings");
        loadPath();
    });

    // Room screen
    const roomScreen = new RoomScreen();



    

    // Dialog and screen management
    const emptyDialog = new EmptyDialog();
    let openedDialog = emptyDialog;
    let openedScreen = newScreen;
    const switchScreen = function(newScreen) {
        switchDialog(emptyDialog);
        openedScreen.close();
        openedScreen = newScreen;
        openedScreen.open();
    };
    const switchDialog = function(newDialog) {
        openedDialog.close();
        openedDialog = newDialog;
        openedDialog.open();
    };

    
    
    // Side menu toggle
    const menuBtn = document.getElementById("btn-menu-left");
    let isMenuMax = false;
    const switchMenu = function(isMax = isMenuMax) {
        if (isMax) {
            menuBtn.parentElement.parentElement.classList.add("max");
            document.getElementById("btn-download").classList.add("primary");
            document.getElementById("btn-download").children[0].classList.remove("primary");
        } else {
            menuBtn.parentElement.parentElement.classList.remove("max");
            document.getElementById("btn-download").classList.remove("primary");
            document.getElementById("btn-download").children[0].classList.add("primary");
        }
    };
    if (sizeS < width) {
        if (width < sizeM) {
            isMenuMax = false;
            switchMenu();
        } else {
            isMenuMax = true;
            switchMenu();
        }
    }
    menuBtn.addEventListener("click", function (event) {
        isMenuMax = !isMenuMax;
        switchMenu();
    });
    const menuDialog = new MenuDialog();
    const menuBtn2 = document.getElementById("btn-menu-top");
    menuBtn2.addEventListener("click", function (event) {
        switchDialog(menuDialog);
    });
    window.addEventListener("resize", function() {
        const width = window.innerWidth;
        if (sizeS < width && openedDialog === menuDialog) {
            switchDialog(emptyDialog);
        };
    });


    
    // Load the given URL path
    const loadPath = function() {
        let path = window.location.pathname || "/";
        path = path.slice(1);
        path = path.split("/");

        const singleRoutes = ["new", "downloads", "outgoings", "login"];
        const doubleRoutes = ["services", "devices", "search", "room"];
        if (singleRoutes.includes(path[0])) {
            path = [path[0]];
        } else if (doubleRoutes.includes(path[0])) {
            path = [path[0], path[1]];
        } else {
            path = [""];
        }
        window.history.replaceState({}, "", "/" + path.join("/"));


        // load screens
        if (path[0] === "new") {
            switchScreen(newScreen);
        } else if (path[0] === "downloads") {
            switchScreen(downloadScreen);
        } else if (path[0] === "login") {
            switchScreen(loginScreen);
        } else if (path[0] === "services") {
            switchScreen(serviceScreen);
        } else if (path[0] === "devices") {
            switchScreen(deviceScreen);
        } else if (path[0] === "outgoings") {
            switchScreen(outgoingScreen);
        } else {
            switchScreen(newScreen);
        }
    };
    window.addEventListener("popstate", loadPath);
    
    

    // Loading
    let loadingDialog = new LoadingDialog();
    const switchOnline = function() {
        // prepare UI
        const serverConf = conf["ws"]["remote"];

        if (typeof serverConf["auth"]["google"] !== "undefined") {
            const googleLogin = new GoogleLogin(serverConf["auth"]["google"]["clientId"]);
            googleLogin.createButton(document.getElementById("google-login"));
            document.getElementById("google-login").classList.remove("hide");
        } else {
            document.getElementById("google-login").classList.add("hide");
        }

        loadingDialog.close();
        switchDialog(emptyDialog);
        loadPath();
    };
    if (server.isOnline) {
        switchOnline();
    }
    server.addEventListener("online", switchOnline);
    server.addEventListener("offline", function() {
        switchDialog(emptyDialog);
        loadingDialog.open();
    });
};
main();








// Theme and mode
const theme = function(color) {
    globalThis.ui("theme", color || "#006e1c");
};

const mode = function() {
    let newMode = globalThis.ui("mode") == "dark" ? "light" : "dark";
    globalThis.ui("mode", newMode);
};

const isNeedDarkFont = function(color="#006e1c") {
    const r = Number("0x"+color.slice(1,3))
    const g = Number("0x"+color.slice(3,5))
    const b = Number("0x"+color.slice(5,7))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 127;
};