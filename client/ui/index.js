"use strict";

window.addEventListener("load", async function() {
    // Main (load libs and call the next step)
    const isDesktop = (typeof globalThis.require !== "undefined");
    let db = null;
    let address = null;

    let ipcRenderer = null;
    let pathApp = "";
    let pathExe = "";
    let os = null;
    let cmd = null;
    let fs = null;
    let path = null;
    let nutjs = null;
    let appAutoLaunch = null;
    const main = async function () {

        //load libs
        if (isDesktop) {
            // Electron import
            let electron = require("electron");
            ipcRenderer = electron.ipcRenderer;
            ipcRenderer.on("api", function(event, ...arg) {
                if (arg[0] === "log") {
                    console.log(arg[1]);
                }
            });
            pathApp = await ipcRenderer.invoke("api", "path-app");
            pathExe = await ipcRenderer.invoke("api", "path-exe");
    
            // OS import
            os = require("node:os");
            // CMD import
            cmd = require("node:child_process");
            // File system import
            fs = require("node:fs/promises");
            // Path import
            path = require("node:path");
            // Nut.js import
            nutjs = require(path.join(pathApp, "ui/libs/nutjs/nut.js"));
            // AutoLaunch import
            const AutoLaunch = require(path.join(pathApp, "ui/libs/auto-launch.js"));

            // Read app name and autolaunch
            let pack = await fs.readFile(path.join(pathApp, "package.json"), {
                "encoding": "utf8"
            });
            pack = JSON.parse(pack);
            appAutoLaunch = new AutoLaunch({
                "name": pack["name"],
                "path": pathExe,
            });
        }

        //create IDB adnd load saved data
        await IdbHelper.TableSet("db", "settings");
        db = await IdbHelper.DatabaseGet("db");

        //read server address
        if (isDesktop) {
            // Read server address
            let conf = await fs.readFile(path.join(pathApp, "conf.json"), {
                "encoding": "utf8"
            });
            conf = JSON.parse(conf);
            address = conf["host"];
        } else {
            address = location.href;
        }
        address = new URL(address);
    };
    await main();


    // Download
    {
        const page = document.getElementById("download");
        if (isDesktop === false) {
            page.classList.remove("d-none");
            let req = null;
            const download = page.querySelector(".download");
            const version = page.querySelector(".version");

            download.addEventListener("click", function() {
                if (req) {
                    return;
                }
                const filenames = {
                    "win": "electron-win32-x64.zip"
                };
                const filename = filenames[version.value];

                download.setAttribute("aria-busy", "true");

                req = new XMLHttpRequest();
                req.open("GET", "/tmp/" + filename, true);
                req.responseType = "blob";
                req.addEventListener("progress", function(event) {
                    const percent = Math.floor(event.loaded / event.total * 100);
                    download.innerText = "Download (" + percent + "%)";
                });
                req.addEventListener("load", async function() {
                    const fileBlob =  req.response;
                    if (fileBlob) {
                        console.log(fileBlob);
                        const zip = new JSZip();
                        await zip.loadAsync(fileBlob);

                        //edit conf.json
                        const confPath = "resources/app/conf.json";
                        let conf = await zip.file(confPath).async("string");
                        conf = JSON.parse(conf);
                        conf["host"] = location.protocol + "//" + location.host;
                        zip.file(confPath, JSON.stringify(conf));

                        //edit package.json
                        const packFile = "resources/app/package.json";
                        let pack = await zip.file(packFile).async("string");
                        pack = JSON.parse(pack);
                        pack["name"] = "desktop_streamer";
                        pack["name"] += "_" + location.hostname;
                        zip.file(packFile, JSON.stringify(pack));

                        //download
                        const contentBlob = await zip.generateAsync({"type":"blob"});
                        const url = window.URL.createObjectURL(contentBlob);

                        const a = document.createElement("a");
                        document.body.appendChild(a);
                        a.style = "display: none";
                        a.href = url;
                        a.download = filename;
                        a.click();
                        window.URL.revokeObjectURL(url);
                        a.remove();
                        
                        download.setAttribute("aria-busy", "false");
                        download.innerText = "Download";
                        req = null;
                    }
                });
                req.send();
            });
        } else {
            page.classList.add("d-none");
        }
    };

    // Settings
    {
        // AutoLaunch and AutoLock
        let refreshButton = null;
        const page = document.getElementById("settings");
        if (isDesktop) {
            page.classList.remove("d-none");
            const checker = page.querySelector("#autolaunch");
            checker.addEventListener("click", function(event) {
                if (event.target.checked) {
                    appAutoLaunch.enable();
                } else {
                    appAutoLaunch.disable();
                }
            });
            refreshButton = async function() {
                checker.checked = await appAutoLaunch.isEnabled();
            };
            refreshButton();

            //autolocker
            const lockerDiv = page.querySelector(".autolock");
            const locker = page.querySelector("#autolock");
            if (os.platform() === "win32") {
                locker.checked = (await IdbHelper.RowGet(db, "settings", [["autolock", false]]))[0];
                ipcRenderer.on("api", function(event, ...arg) {
                    if (arg[0] === "screenchange") {
                        if (locker.checked) {
                            if (os.platform() === "win32") {
                                cmd.exec("Rundll32.exe user32.dll,LockWorkStation");
                            }
                        }
                    }
                });
                locker.addEventListener("click", async function(event) {
                    await IdbHelper.RowSet(db, "settings", [["autolock", event.target.checked]]);
                });
            } else {
                lockerDiv.classList.add("d-none");
            }
        } else {
            page.classList.add("d-none");
        }
    };


    // Connect
    {
        
        const page = document.getElementById("remote");
        const main = document.getElementById("main");
        const control = document.getElementById("control");

        const status = page.querySelector(".status");
        const connect = page.querySelector(".connect");
        const share = page.querySelector(".share");
        const shareSub = page.querySelector(".shareSub");

        //startup connection
        const Communicator = class extends EventTarget {
            ws = null;
            processes = [];
            isServer = false;
            gcClear = 0;
            gcClearLimit = 10;
    
            FROM_MYSELF = 0;
            FROM_OTHER = 1;
            
            // methods: invoke, send, reply (for events),
            // events: invoke, send
            constructor(ws, isServer) {
                super();
    
                this.reset(ws, isServer);
            }
            reset(ws=this.ws, isServer=false) {
                this.FROM_MYSELF = (isServer ? 1 : 0);
                this.FROM_OTHER = (isServer ? 0 : 1);
    
                this.processes = [];
                this.ws = ws;
                this.ws.on("data", (data) =>  {
                    //console.log("Message from other: ", data);
    
                    // handle syntax errors
                    try {
                        if ((data instanceof Array) === false || data.length < 2) {
                            throw new Error("Wrong format");
                        }
                    } catch (error) {
                        console.log(error);
                        this.ws.send([this.FROM_OTHER, -1, 400]);
                        return;
                    }
    
                    // call recieve
                    this.recieve(data);
                });
                
            };
            
            send(msg={}) {
                //send data, fire and forget
                let data = [this.FROM_MYSELF, -1, msg];
                this.ws.send(data);
            };
    
            gc() {
                const lastEl = this.processes.length - 1;
                let i = lastEl;
                while(i >= 0 && this.processes[i] === null) {
                    i--;
                }
                this.processes.splice(i+1, lastEl-i);
            };
            async invoke(msg={}, timeout=5000) {
                return new Promise((resolve, reject) => {
                    // run garbage collector
                    if (this.gcClear > this.gcClearLimit) {
                        this.gcClear = 0;
                        this.gc();
                    }
                    this.gcClear++;
    
                    //get unique id from stack
                    const id = this.processes.length;
    
                    //start timeout
                    const myTimeout = setTimeout(function() {
                        reject(new Error("Timeout (" + id + ")"));
                    }, timeout);
    
                    //set callback function in stack
                    this.processes.push((data) => {
                        this.processes[id] = null;
                        clearTimeout(myTimeout);
                        resolve(data);
                    });
                    
                    //send data
                    let data = [this.FROM_MYSELF, id, msg];
                    this.ws.send(data);
                });
            };
            recieve(data) {
                //process data
                if (data[0] === this.FROM_MYSELF) {
                    //recieve response
                    if (data[1] < this.processes.length && this.processes[data[1]] !== null) {
                        console.log(data[1]);
                        this.processes[data[1]](data[2]);
                    }
    
                } else if (data[0] === this.FROM_OTHER) {
                    //recieve request
                    if (data[1] === -1) {
                        // no need reply for this
                        this.dispatchEvent(
                            new CustomEvent("send", {"detail": {
                                "data": data[2]
                            }})
                        );
                    } else {
                        // need reply for this with id
                        this.dispatchEvent(
                            new CustomEvent("invoke", {"detail": {
                                "communicator": this,
                                "id": data[1],
                                "data": data[2]
                            }})
                        );
                    }
                    
                }
            };
            reply(id, msg={}) {
                //send data
                let data = [this.FROM_OTHER, id, msg];
                this.ws.send(data);
            };
        };    
        const options = {
            "host": address.hostname,
            "port": address.port,
            "path": "peerjs",
            "config": {
                "iceServers": [
                    {
                        "urls": "stun:stun.l.google.com:19302"
                    },
                    {
                        "urls": "stun:stun4.l.google.com:19302"
                    }
                ],
                "sdpSemantics": "unified-plan"
            },
            "debug": 2
        };
        let peer = null;
        const userList = new Set();
        const createConnection = function() {
            peer = new Peer(options);
            //general connection to server
            peer.on("open", function(id) {
                code.value = id;
                status.innerText = "Connected (ID: " + id + ")";
                connect.classList.remove("d-none");
                if (isDesktop) {
                    share.classList.remove("d-none");
                } 
            });
            peer.on("error", function(error) {
                if (error.type === "disconnected" || error.type === "network" || error.type === "server-error") {
                    //network problem
                    status.innerText = "Error in connection";
                    connect.classList.add("d-none");
                    share.classList.add("d-none");
                    setTimeout(function() {
                        createConnection();
                    }, 3000)
                } else if (error.type === "peer-unavailable") {
                    //join code problem
                    join.setAttribute("aria-busy", "false");
                    joinCode.setAttribute("aria-invalid", "true");
                }
            });

            //reciever
            peer.on("connection", function(dataConnection) {
                const communicator = new Communicator(dataConnection, true);
                let userEl = null;

                dataConnection.on("open", function() {
                    let timeoutID = setTimeout(function() {
                        dataConnection.close();
                    }, 5000);
                    dataConnection.on("close", function() {
                        userList.delete(dataConnection.peer);
                        removeUser(userEl);
                        clearTimeout(timeoutID);
                        timeoutID = -1;
                    });
                    communicator.addEventListener("send", function(event) {
                        if (event.detail.data["method"] === "setScreen") {

                        }
                        if (event.detail.data["method"] === "setKeyboard") {

                        }
                        if (event.detail.data["method"] === "setMouse") {

                        }
                    });
                    communicator.addEventListener("invoke", async function(event) {
                        if (event.detail.data["method"] === "isAvailable") {
                            if (allowConnect.checked && userList.has(dataConnection.peer) === false) {
                                userList.add(dataConnection.peer);
                                userEl = addUser(dataConnection.peer, function() {
                                    dataConnection.close();
                                });
                                clearTimeout(timeoutID);
                                timeoutID = -1;
                                event.detail.communicator.reply(event.detail.id, true);
                            } else {
                                event.detail.communicator.reply(event.detail.id, false);
                            }
                            return;
                        }
                        if (event.detail.data["method"] === "screenList") {
                            const screens = await ipcRenderer.invoke("api", "list-screens");
                            event.detail.communicator.reply(event.detail.id, screens);
                            return;
                        }
                        if (event.detail.data["method"] === "getScreen") {
                            let stream = null;
                            try {
                                const constraints = {
                                    "video": {
                                        "mandatory": {
                                            "chromeMediaSource": "desktop",
                                            "chromeMediaSourceId": event.detail.data["id"],
                                            "minFrameRate": 1,
                                            "maxFrameRate": event.detail.data["frameRate"]
                                        }
                                    },
                                    "audio": {
                                        "mandatory": {
                                            "chromeMediaSource": "desktop"
                                        }
                                    }
                                };
                                console.log(constraints);
                                stream = await navigator.mediaDevices.getUserMedia(constraints);
                                //console.log(stream);
                            } catch (error) {
                                /* handle the error */
                                console.log(error);
                                stream = null;
                            }
                            //console.log(stream);
                            const mediaConnection = peer.call(dataConnection.peer, stream);
                            console.log(mediaConnection);
                            const videoSender = mediaConnection.peerConnection.getSenders().filter(s => s.track?.kind === "video")[0];
                            console.log(mediaConnection.peerConnection.getSenders());
                            const videoParams = videoSender.getParameters();
                            if ("degradationPreference" in videoParams) {
                                // So that the webrtc implementation doesn't alter the framerate - this is optional
                                videoParams.degradationPreference = "maintain-framerate";
                            }

                            // Set a base encoding setup if there isn't one already
                            console.log(videoParams.encodings);
                            videoParams["encodings"][0]["priority"] = "high";
                            videoParams["encodings"][0]["networkPriority"] = "high";
                            videoParams["encodings"][0]["maxFramerate"] = event.detail.data["frameRate"];
                            videoParams["encodings"][0]["maxBitrate"] = event.detail.data["bitRate"] // For a 50mbps stream; the value is in bps
                            await videoSender.setParameters(videoParams);
                            
                            event.detail.communicator.reply(event.detail.id, stream!==null);
                        }
                        if (event.detail.data["method"] === "getClipboard") {

                        }
                        if (event.detail.data["method"] === "setClipboard") {

                        }
                        
                    });
                    ipcRenderer.on("api", async function(event, ...arg) {
                        if (arg[0] === "screenchange") {
                            const screens = await ipcRenderer.invoke("api", "list-screens");
                            communicator.send({
                                "method": "screenChange",
                                "screens": screens
                            });
                        }
                    });
                });
            });
        };
        createConnection();


        //incoming elements
        const allowConnect = document.getElementById("allowConnect");
        allowConnect.addEventListener("click", function(event) {
            if (event.target.checked) {
                shareSub.classList.remove("d-none");
                codeCopy.classList.remove("d-none");
            } else {
                shareSub.classList.add("d-none");
            }
        });
        const code = share.querySelector(".code");
        const codeCopy = share.querySelector(".codeCopy");
        codeCopy.addEventListener("click", function() {
            code.select();
            code.setSelectionRange(0, 99999); // For mobile devices

            // Copy the text inside the text field
            navigator.clipboard.writeText(code.value);
        });
        const codeField = share.querySelector(".codeField");
        const users = page.querySelector(".users");
        const noUsers = page.querySelector(".noUsers");
        const addUser = function (id, removeCallback) {
            noUsers.classList.add("d-none");
            const el = document.createElement("div");
            let HTMLstring = "";
            HTMLstring += "<fieldset role=\"group\">";
            HTMLstring += "<input type=\"text\" readonly>";
            HTMLstring += "<button class=\"secondary\">Remove</button>";
            HTMLstring += "</fieldset>";
            el.innerHTML = HTMLstring;
            el.childNodes[0].childNodes[0].value = id;
            el.childNodes[0].childNodes[1].addEventListener("click", function() {
                removeUser(el);
                removeCallback?.(id);
            });
            users.appendChild(el);
            return el;
        };
        const removeUser = function(el) {
            if (el === null) {
                return;
            }
            el.remove();
            if (userList.size === 0) {
                noUsers.classList.remove("d-none");
            } else {
                noUsers.classList.add("d-none");
            }
        };


        //outgoing connection
        const join = page.querySelector(".join");
        const joinCode = page.querySelector(".joinCode");
        join.setAttribute("disabled", "disabled");
        joinCode.addEventListener("keyup", function(event) {
            if (event.target.value === "") {
                join.setAttribute("disabled", "disabled");
            } else {
                join.removeAttribute("disabled");
            }
        });
        join.addEventListener("click", function() {
            startJoin();
        });
        
        let setScreen = null;
        const startJoin = function() {
            join.setAttribute("aria-busy", "true");
            joinCode.removeAttribute("aria-invalid");
            
            const dataConnection = peer.connect(joinCode.value, {"serialization": "json"});
            const communicator = new Communicator(dataConnection, false);
            dataConnection.on("open", async function() {
                dataConnection.on("close", function() {
                    console.log("closed connection");
                    main.classList.remove("d-none");
                    control.classList.add("d-none");
                });
                dataConnection.on("error", function(err) {
                    console.log(err);
                });

                //startup checkup
                const isAvailable = await communicator.invoke({
                    "method": "isAvailable"
                });
                console.log(isAvailable);
                if (isAvailable) {
                    join.setAttribute("aria-busy", "false");
                    joinCode.removeAttribute("aria-invalid");
                    main.classList.add("d-none");
                    control.classList.remove("d-none");
                } else {
                    join.setAttribute("aria-busy", "false");
                    joinCode.setAttribute("aria-invalid", "true");
                    dataConnection.close();
                }

                //screen manage
                let screens = await communicator.invoke({
                    "method": "screenList"
                });
                console.log(screens);
                communicator.addEventListener("send", function(event) {
                    if (event.detail.data["method"] === "screenChange") {
                        console.log(event.detail.data["screens"]);
                    }
                });

                //load screen
                let mediaConnection = null;
                const video = control.querySelector(".video");
                setScreen = async function(id, frameRate, bitRate) {
                    if (id === null) {
                        mediaConnection?.close();
                        return;
                    }
                    const res = await communicator.invoke({
                        "method": "getScreen",
                        "id": id,
                        "frameRate": frameRate,
                        "bitRate": bitRate
                    });
                    return res;
                };
                peer.on("call", function(mediaConnection) {
                    console.log(mediaConnection);
                    if (dataConnection.peer !== mediaConnection.peer) {
                        mediaConnection.close();
                        return;
                    }
                    mediaConnection.on("stream", function(stream) {
                        console.log(stream);
                        video.srcObject = stream;
                    });
                    mediaConnection.on("close", function() {
                        console.log("closed stream");
                    });
                    mediaConnection.on("error", function(error) {
                        console.log("error stream");
                    });
                    mediaConnection.answer();
                });
                console.log(await setScreen(screens[0].id, 60, 24000000));
            });
        };
        

        //close
        const close = control.querySelector(".close");
        close.addEventListener("click", function() {

        });


        //clipboard
        let isClipboard = true;
        const clipboard = control.querySelector(".clipboard");
        const clipboardIconOff = control.querySelector(".clipboardIconOff");
        const clipboardIconOn = control.querySelector(".clipboardIconOn");
        clipboard.addEventListener("click", function() {
            isClipboard = !isClipboard;
            clipboardRefresh();
        });
        const clipboardRefresh = function() {
            if (isClipboard) {
                clipboardIconOn.classList.remove("d-none");
                clipboardIconOff.classList.add("d-none");
            } else {
                clipboardIconOn.classList.add("d-none");
                clipboardIconOff.classList.remove("d-none");
            }
        };
        clipboardRefresh();
        
        //keyboard
        const keyboard = control.querySelector(".keyboard");

        //mouse
        let isMouse = true;
        const mouse = control.querySelector(".mouse");
        const mouseIconOff = control.querySelector(".mouseIconOff");
        const mouseIconOn = control.querySelector(".mouseIconOn");
        mouse.addEventListener("click", function() {
            isMouse = !isMouse;
            mouseRefresh();
        });
        const mouseRefresh = function() {
            if (isMouse) {
                mouseIconOn.classList.remove("d-none");
                mouseIconOff.classList.add("d-none");
            } else {
                mouseIconOn.classList.add("d-none");
                mouseIconOff.classList.remove("d-none");
            }
        };
        mouseRefresh();

        //audio
        let isAudio = true;
        const audio = control.querySelector(".audio");
        const audioIconOn = control.querySelector(".audioIconOn");
        const audioIconOff = control.querySelector(".audioIconOff");
        audio.addEventListener("click", function() {
            isAudio = !isAudio;
            audioRefresh();
        });
        const audioRefresh = function() {
            if (isAudio) {
                audioIconOn.classList.remove("d-none");
                audioIconOff.classList.add("d-none");
            } else {
                audioIconOn.classList.add("d-none");
                audioIconOff.classList.remove("d-none");
            }
        };
        audioRefresh();

        //lock
        let isLock = false;
        const lock = control.querySelector(".lock");
        const lockIconOn = control.querySelector(".lockIconOn");
        const lockIconOff = control.querySelector(".lockIconOff");
        lock.addEventListener("click", function() {
            isLock = !isLock;
            lockRefresh();
        });
        const lockRefresh = function() {
            if (isLock) {
                lockIconOn.classList.remove("d-none");
                lockIconOff.classList.add("d-none");
            } else {
                lockIconOn.classList.add("d-none");
                lockIconOff.classList.remove("d-none");
            }
        };
        lockRefresh();

        //screen
        const screen = control.querySelector(".screen");
        const modal = document.getElementById("modal");
        const modalConfirm = modal.querySelector(".confirm");
        const modalCancel= modal.querySelector(".cancel");
        screen.addEventListener("click", function() {
            if (modal.open === false) {
                modal.show();
            }
        });
        modalConfirm.addEventListener("click", function() {
            modal.close();
        });
        modalCancel.addEventListener("click", function() {
            modal.close();
        });


        //fullscreen
        let isFullscreen = false;
        const fullscreen = control.querySelector(".fullscreen");
        const fullscreenIconOn = control.querySelector(".fullscreenIconOn");
        const fullscreenIconOff = control.querySelector(".fullscreenIconOff");
        fullscreen.addEventListener("click", function() {
            isFullscreen = !isFullscreen;
            fullscreenRefresh();
        });
        const fullscreenRefresh = function() {
            if (isFullscreen) {
                fullscreenIconOn.classList.remove("d-none");
                fullscreenIconOff.classList.add("d-none");
            } else {
                fullscreenIconOn.classList.add("d-none");
                fullscreenIconOff.classList.remove("d-none");
            }
        };
        fullscreenRefresh();

    };

});