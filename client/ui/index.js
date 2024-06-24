"use strict";
let nutjs = null;

function arrayBufferToBase64(buffer) {
    let binary = '';
    let bytes = new Uint8Array(buffer);
    let len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

const getWsAdress = function (url) {
    let address = "";
    if (url.protocol === "https:") {
        address += "wss://";
    } else {
        address += "ws://";
    }
    address += url.host;
    return address;
};


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
            console.log(nutjs);
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
            senderFn = function(data) {ws.send(JSON.stringify(data));};
            recieverFn = function(get) {ws.addEventListener("message", function(event) {get(JSON.parse(event.data));})};
            processes = [];
            isRed = false;
            gcClear = 0;
            gcClearLimit = 10;
    
            FROM_MYSELF = 0;
            FROM_OTHER = 1;
            
            // methods: invoke, send, reply (only in event),
            // events: invoke, send
            constructor(isRed, callback) {
                super();
    
                this.reset(isRed, callback);
            }
            reset(isRed=false, callback) {
                this.FROM_MYSELF = (isRed ? 1 : 0);
                this.FROM_OTHER = (isRed ? 0 : 1);
    
                this.processes = [];
                this.senderFn = callback["senderFn"];
                this.recieverFn = callback["recieverFn"];
    
                this.recieverFn(function(data) {
                    //handle error
                    if ((data instanceof Array) === false || data.length < 2) {
                        console.log("Wrong format");
                        this.senderFn([this.FROM_OTHER, -1, 400]);
                    } else {
                        this.recieve(data);
                    }
                }.bind(this));
                
            };
            
            send(msg={}) {
                //send data, fire and forget
                let data = [this.FROM_MYSELF, -1, msg];
                this.senderFn(data);
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
                    this.senderFn(data);
                });
            };
            recieve(data) {
                //process data
                if (data[0] === this.FROM_MYSELF) {
                    //recieve response
                    if (data[1] < this.processes.length && this.processes[data[1]] !== null) {
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
                                "reply": this.reply.bind(this),
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
                this.senderFn(data);
            };
        };

        const webrtcServers = {
            "iceServers": [
                {
                    "urls": "stun:stun.l.google.com:19302"
                }
            ]
        };
        const webrtcServers2 = {
            "iceServers": [
                {
                    "urls": "turn:numb.viagenie.ca",
                    "credential": "muazkh",
                    "username": "webrtc@live.com"
                }
            ]
        };


        let isServerConnected = false;
        let serverCommunicator = null;
        let myId = "";
        const userList = new Map();
        const createConnection = function() {
            //create connection
            const ws = new WebSocket(getWsAdress(address));

            //create communicator
            serverCommunicator = new Communicator(false, {
                "senderFn": function(data) {
                    ws.send(JSON.stringify(data));
                },
                "recieverFn": function(get) {
                    ws.addEventListener("message", function(event) {
                        let data = [];
                        try {
                            data = JSON.parse(event.data)
                        } catch (error) {
                            
                        }
                        get(data);
                    });
                }
            });

            //listen connection state
            ws.addEventListener("error", () => {
                console.log("disconnected");
                isServerConnected = false;

                status.innerText = "Error in connection, trying to connect...";
                connect.classList.add("d-none");
                share.classList.add("d-none");
            });
            ws.addEventListener("close", () => {
                console.log("closed");
                isServerConnected = false;
                setTimeout(createConnection, 2000);

                status.innerText = "Error in connection, trying to connect...";
                connect.classList.add("d-none");
                share.classList.add("d-none");
            });

            //fresh connection
            ws.addEventListener("open", async function() {
                console.log("connected");
                isServerConnected = true;

                //get ID
                myId = await serverCommunicator.invoke({"method": "myId"});

                //set UI
                code.value = myId;
                status.innerText = "Connected (ID: " + myId + ")";
                connect.classList.remove("d-none");
                if (isDesktop) {
                    share.classList.remove("d-none");
                }

                //listen non-respond api
                serverCommunicator.addEventListener("send", async function(event) {
                    if (event.detail.data["method"] === "iceSend") {
                        try {
                            const peerConnection = userList.get(event.detail.data["fromId"]);
                            console.log("iceSend", event.detail.data);
                            await peerConnection.addIceCandidate(event.detail.data["iceCandidate"]);
                        } catch (e) {
                            console.error("Error adding received ice candidate", e);
                        }
                    }
                });

                //listen respond api
                serverCommunicator.addEventListener("invoke", async function(event) {
                    if (event.detail.data["method"] === "call") {
                        // 2nd step - handle call
                        const peerId = event.detail.data["fromId"];
                        if (allowConnect.checked === false || userList.has(peerId)) {
                            event.detail.reply(event.detail.id, {
                                "isSuccess": false
                            });
                            return;
                        }

                        const peerEl = addUser(peerId, function() {
                            userList.delete(peerId);
                            peerConnection.close();
                        })

                        const peerConnection = new RTCPeerConnection(webrtcServers2);
                        userList.set(peerId, peerConnection);

                        peerConnection.addEventListener("icecandidate", function(event) {
                            console.log("icecandidate", event.candidate);
                            serverCommunicator.send({
                                "method": "iceSend",
                                "id": peerId,
                                "iceCandidate": event.candidate
                            });
                        });
                        peerConnection.addEventListener("connectionstatechange", function(event) {
                            console.log("connectionstatechange:", peerConnection.connectionState);
                            if (peerConnection.connectionState === "failed" || peerConnection.connectionState === "closed" || peerConnection.connectionState === "disconnected") {
                                userList.delete(peerId);
                                removeUser(peerEl);
                            }
                        });
            
                        //4th ready to communicate
                        peerConnection.addEventListener("datachannel", function(event) {
                            //console.log(event.channel);
                            const peerDataChannel = event.channel;
                            peerDataChannel.addEventListener("open", function() {
                                const peerCommunicator = new Communicator(true, {
                                    "senderFn": function(data) {
                                        peerDataChannel.send(JSON.stringify(data));
                                    },
                                    "recieverFn": function(get) {
                                        peerDataChannel.addEventListener("message", function(event) {
                                            let data = [];
                                            try {
                                                data = JSON.parse(event.data);
                                            } catch (error) {
                                                console.log(error);
                                            }
                                            get(data);
                                        });
                                    }
                                });

                                let videoPeerConnection = null;
                                //listen non-responding api
                                peerCommunicator.addEventListener("send", async function(event) {
                                    console.log(event.detail.data);
                                    if (event.detail.data["method"] === "iceSend") {
                                        try {
                                            console.log("iceSend", event.detail.data);
                                            await videoPeerConnection.addIceCandidate(event.detail.data["iceCandidate"]);
                                        } catch (e) {
                                            console.error("Error adding received ice candidate", e);
                                        }
                                    }
                                });
                                
                                //listen responding api
                                peerCommunicator.addEventListener("invoke", async function(event) {
                                    //get screens
                                    if (event.detail.data["method"] === "screenList") {
                                        const screens = await ipcRenderer.invoke("api", "list-screens");
                                        event.detail.reply(event.detail.id, screens);
                                        return;
                                    }
                                    //get stream
                                    if (event.detail.data["method"] === "videoGet") {
                                        const screenId = event.detail.data["screenId"];
                                        const frameRate = event.detail.data["frameRate"];
                                        const bitRate = event.detail.data["bitRate"] * 1000 * 1000;

                                        let stream = null;
                                        try {
                                            const constraints = {
                                                "video": {
                                                    "mandatory": {
                                                        "chromeMediaSource": "desktop",
                                                        "chromeMediaSourceId": screenId,
                                                        "minFrameRate": frameRate,
                                                        "maxFrameRate": frameRate
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
                                        } catch (error) {
                                            console.log(error);
                                        }

                                        if (stream === null) {
                                            event.detail.reply(event.detail.id, {
                                                "isSuccess": false
                                            });
                                            return;
                                        }
                                        event.detail.reply(event.detail.id, {
                                            "isSuccess": true
                                        });

                                        //create connection
                                        videoPeerConnection = new RTCPeerConnection(webrtcServers2);
                                        //videoPeerConnection.createDataChannel("sendDataChannel", {"ordered": false});
                                        videoPeerConnection.addEventListener("icecandidate", function(event) {
                                            console.log("video icecandidate", event.candidate);
                                            peerCommunicator.send({
                                                "method": "iceSend",
                                                "iceCandidate": event.candidate
                                            });
                                        });
                                        videoPeerConnection.addEventListener("connectionstatechange", function(event) {
                                            console.log("video connectionstatechange:", videoPeerConnection.connectionState);
                                            if (videoPeerConnection.connectionState === "connected") {
                                                
                            
                                            } else if (videoPeerConnection.connectionState === "failed" || videoPeerConnection.connectionState === "closed" || videoPeerConnection.connectionState === "disconnected") {
                                                
                                            }
                                        });
                                        videoPeerConnection.addEventListener("negotiationneeded ", function(event) {
                                            console.log("video negotiationneeded:", event);
                                        });

                                        //add video stream
                                        //console.log(RTCRtpSender.getCapabilities("video"));
                                        const videoCodecs = [];
                                        for (const codec of RTCRtpSender.getCapabilities("video")["codecs"]) {
                                            if (codec["mimeType"] === "video/VP9" && codec["sdpFmtpLine"] === "profile-id=0") {
                                                videoCodecs.push(codec);
                                            }
                                        }
                                        const videoTransceiver = videoPeerConnection.addTransceiver("video", {
                                            "direction": "sendonly",
                                            "sendEncodings": videoCodecs,
                                            "streams": [stream]
                                        });
                                        videoTransceiver.setCodecPreferences(videoCodecs);
                                        const videoSender = videoTransceiver.sender;
                                        const videoParams = videoSender.getParameters();
                                        console.log(videoParams);
                                        for (const encoding of videoParams["encodings"]) {
                                            encoding["maxFramerate"] = frameRate;
                                            encoding["maxBitrate"] = bitRate;
                                            encoding["priority"] = "high";
                                            encoding["networkPriority"] = "high";
                                        }
                                        videoSender.setParameters(videoParams);

                                        //console.log(RTCRtpReceiver.getCapabilities("video"));
                                        videoTransceiver.receiver.jitterBufferTarget = 0;
                                        console.log(videoTransceiver);
                                        
                                        //add audio stream
                                        //console.log(RTCRtpSender.getCapabilities("audio"));
                                        const audioCodecs = [];
                                        for (const codec of RTCRtpSender.getCapabilities("video")["codecs"]) {
                                            if (codec["mimeType"] === "audio/opus") {
                                                audioCodecs.push(codec);
                                            }
                                        }
                                        const audioTransceiver = videoPeerConnection.addTransceiver("video", {
                                            "direction": "sendonly",
                                            "sendEncodings": audioCodecs,
                                            "streams": [stream]
                                        });
                                        audioTransceiver.setCodecPreferences(audioCodecs);
                                        const audioSender = audioTransceiver.sender;
                                        const audioParams = audioSender.getParameters();
                                        console.log(audioParams);
                                        for (const encoding of audioParams["encodings"]) {
                                            encoding["priority"] = "high";
                                            encoding["networkPriority"] = "high";
                                        }
                                        audioSender.setParameters(audioParams);

                                        //console.log(RTCRtpReceiver.getCapabilities("audio"));
                                        audioTransceiver.receiver.jitterBufferTarget = 0;
                                        console.log(audioTransceiver);

                                        const offer = await videoPeerConnection.createOffer();
                                        await videoPeerConnection.setLocalDescription(offer);
                                        
                                        try {
                                            const res = await peerCommunicator.invoke({
                                                "method": "videoOffer",
                                                "offer": offer
                                            });
                                            const remoteDesc = new RTCSessionDescription(res["answer"]);
                                            await videoPeerConnection.setRemoteDescription(remoteDesc);
                                        } catch (error) {
                                            console.log(error);
                                            videoPeerConnection = null;
                                        }
                                        return;
                                    }
                                    
                                    console.log(event.detail.data);
                                });
                            });
                        });

                        // 2nd step - handle call
                        peerConnection.setRemoteDescription(new RTCSessionDescription(event.detail.data["offer"]));
                        const answer = await peerConnection.createAnswer();

                        event.detail.reply(event.detail.id, {
                            "isSuccess": true,
                            "answer": answer
                        });
                        await peerConnection.setLocalDescription(answer);

                        return;
                    }
                });
            });

            


            


    
            return;
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
                        if (event.detail.data["method"] === "setMouse") {

                        }
                        if (event.detail.data["method"] === "setKeyboard") {

                        }
                        if (event.detail.data["method"] === "getClipboard") {

                        }
                        if (event.detail.data["method"] === "setClipboard") {

                        }
                    });
                    let mediaConnection = null;
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
                        if (event.detail.data["method"] === "screenGet") {
                            const id = event.detail.data["id"];
                            const frameRate = event.detail.data["frameRate"];
                            const bitRate = event.detail.data["bitRate"] * 1000 * 1000;
                            let stream = null;

                            // get screen
                            try {
                                const constraints = {
                                    "video": {
                                        "mandatory": {
                                            "chromeMediaSource": "desktop",
                                            "chromeMediaSourceId": id,
                                            "minFrameRate": frameRate,
                                            "maxFrameRate": frameRate
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

                            // call
                            if (stream !== null) {
                                mediaConnection = peer.call(dataConnection.peer, stream);

                                // set quality
                                const videoSender = mediaConnection.peerConnection.getSenders().filter(s => s.track?.kind === "video")[0];
                                const videoParams = videoSender.getParameters();
                                if ("degradationPreference" in videoParams) {
                                    // So that the webrtc implementation doesn't alter the framerate - this is optional
                                    videoParams.degradationPreference = "maintain-framerate";
                                }
                                videoParams["encodings"][0]["priority"] = "high";
                                videoParams["encodings"][0]["networkPriority"] = "high";
                                videoParams["encodings"][0]["maxFramerate"] = frameRate;
                                videoParams["encodings"][0]["maxBitrate"] = bitRate
                                await videoSender.setParameters(videoParams);

                                // set latency
                                console.log(mediaConnection.peerConnection.getReceivers());
                                for (const reciever of mediaConnection.peerConnection.getReceivers()) {
                                    reciever.jitterBufferTarget = 20;
                                }
                                
                            }
                            event.detail.communicator.reply(event.detail.id, stream!==null);
                            return;
                        }
                        if (event.detail.data["method"] === "screenSet") {
                            const id = event.detail.data["id"];
                            const frameRate = event.detail.data["frameRate"];
                            const bitRate = event.detail.data["bitRate"] * 1000 * 1000;
                            let stream = null;

                            // get screen
                            try {
                                const constraints = {
                                    "video": {
                                        "mandatory": {
                                            "chromeMediaSource": "desktop",
                                            "chromeMediaSourceId": id,
                                            "minFrameRate": frameRate,
                                            "maxFrameRate": frameRate
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

                            if (stream !== null) {
                                // set quality
                                const videoSender = mediaConnection.peerConnection.getSenders().filter(s => s.track?.kind === "video")[0];
                                await videoSender.replaceTrack(stream.getVideoTracks()[0]);

                                const videoParams = videoSender.getParameters();
                                if ("degradationPreference" in videoParams) {
                                    // So that the webrtc implementation doesn't alter the framerate - this is optional
                                    videoParams.degradationPreference = "maintain-framerate";
                                }
                                videoParams["encodings"][0]["priority"] = "high";
                                videoParams["encodings"][0]["networkPriority"] = "high";
                                videoParams["encodings"][0]["maxFramerate"] = frameRate;
                                videoParams["encodings"][0]["maxBitrate"] = bitRate
                                await videoSender.setParameters(videoParams);

                                // set latency
                                console.log(mediaConnection.peerConnection.getReceivers());
                                for (const reciever of mediaConnection.peerConnection.getReceivers()) {
                                    reciever.jitterBufferTarget = 100;
                                }
                                
                            }

                            event.detail.communicator.reply(event.detail.id, stream!==null);
                            return;
                        }
                    });
                    ipcRenderer.on("api", async function(event, ...arg) {
                        if (arg[0] === "screenchange") {
                            communicator.send({
                                "method": "screenChange"
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
        

        const startJoin = async function() {
            join.setAttribute("aria-busy", "true");
            joinCode.removeAttribute("aria-invalid");
            const peerId = joinCode.value;

            // 1st step - create connection and call
            const peerConnection = new RTCPeerConnection(webrtcServers2);
            const peerDataChannel = peerConnection.createDataChannel("sendDataChannel", {"ordered": false});
            

            peerConnection.addEventListener("icecandidate", function(event) {
                console.log("icecandidate", event.candidate);
                serverCommunicator.send({
                    "method": "iceSend",
                    "id": peerId,
                    "iceCandidate": event.candidate
                });
            });
            peerConnection.addEventListener("connectionstatechange", function(event) {
                console.log("connectionstatechange:", peerConnection.connectionState);
                if (peerConnection.connectionState === "connected") {
                    join.setAttribute("aria-busy", "false");
                    joinCode.removeAttribute("aria-invalid");
                    main.classList.add("d-none");
                    control.classList.remove("d-none");

                    

                } else if (peerConnection.connectionState === "failed" || peerConnection.connectionState === "closed" || peerConnection.connectionState === "disconnected") {
                    userList.delete(peerId);
                    main.classList.remove("d-none");
                    control.classList.add("d-none");
                }
            });

            // 4th step ready to messaging
            peerDataChannel.addEventListener("open", async function() {
                const peerCommunicator = new Communicator(false, {
                    "senderFn": function(data) {
                        peerDataChannel.send(JSON.stringify(data));
                    },
                    "recieverFn": function(get) {
                        peerDataChannel.addEventListener("message", function(event) {
                            let data = [];
                            try {
                                data = JSON.parse(event.data);
                            } catch (error) {
                                console.log(error);  
                            }
                            get(data);
                        });
                    }
                });

                let videoPeerConnection = null;
                peerCommunicator.addEventListener("send", async function(event) {
                    if (event.detail.data["method"] === "iceSend") {
                        try {
                            console.log("iceSend", event.detail.data);
                            await videoPeerConnection.addIceCandidate(event.detail.data["iceCandidate"]);
                        } catch (e) {
                            console.error("Error adding received ice candidate", e);
                        }
                    }
                });
                peerCommunicator.addEventListener("invoke", async function(event) {
                    if (event.detail.data["method"] === "videoOffer") {
                        videoPeerConnection.setRemoteDescription(new RTCSessionDescription(event.detail.data["offer"]));
                        console.log(videoPeerConnection);
                        const answer = await videoPeerConnection.createAnswer();

                        event.detail.reply(event.detail.id, {
                            "isSuccess": true,
                            "answer": answer
                        });
                        await videoPeerConnection.setLocalDescription(answer);
                    }
                });
                const setVideo = async function(screenId, frameRate, bitRate) {
                    videoPeerConnection = new RTCPeerConnection(webrtcServers2);
                    videoPeerConnection.addEventListener("icecandidate", function(event) {
                        console.log("video icecandidate", event.candidate);
                        peerCommunicator.send({
                            "method": "iceSend",
                            "iceCandidate": event.candidate
                        });
                    });
                    videoPeerConnection.addEventListener("negotiationneeded ", function(event) {
                        console.log("video negotiationneeded:", event);
                    });
                    videoPeerConnection.addEventListener("connectionstatechange", function(event) {
                        console.log("video connectionstatechange:", videoPeerConnection.connectionState);
                        if (videoPeerConnection.connectionState === "connected") {
                            
        
                        } else if (videoPeerConnection.connectionState === "failed" || videoPeerConnection.connectionState === "closed" || videoPeerConnection.connectionState === "disconnected") {
                            
                        }
                    });
                    videoPeerConnection.addEventListener("track", function(event) {
                        console.log("videoPeerConnectiontrack", event);
                        event.receiver.jitterBufferTarget = 0;
                        console.log(event.track);
                    });
                    
                    const res = await peerCommunicator.invoke({
                        "method": "videoGet",
                        "screenId": screenId,
                        "frameRate": frameRate,
                        "bitRate": bitRate
                    });
                    return res["isSuccess"];
                };
                const screens = await peerCommunicator.invoke({
                    "method": "screenList"
                });
                setVideo(screens[0]["id"], 60, 20);
            });
            

            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            const res = await serverCommunicator.invoke({
                "method": "call",
                "id": peerId,
                "offer": offer
            });

            // 3rd step - accept answer if exitst
            if (res["isSuccess"]) {
                userList.set(peerId, peerConnection);
                const remoteDesc = new RTCSessionDescription(res["answer"]);
                await peerConnection.setRemoteDescription(remoteDesc);
            } else {
                join.setAttribute("aria-busy", "false");
                joinCode.setAttribute("aria-invalid", "true");
            }

            

            return;
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
                if (isAvailable === false) {
                    join.setAttribute("aria-busy", "false");
                    joinCode.setAttribute("aria-invalid", "true");
                    dataConnection.close();
                    return;
                }

                //screen initial
                let screens = await communicator.invoke({
                    "method": "screenList"
                });
                console.log(screens);
                

                //video UI
                let isClosing = false;
                const video = control.querySelector(".video");
                let currenctId = screens[0].id;
                let currenctFrameRate = 60;
                let currenctBitRate = 15;
                peer.on("call", async function(mediaConnection) {
                    console.log(mediaConnection);
                    if (dataConnection.peer !== mediaConnection.peer) {
                        mediaConnection.close();
                        return;
                    }
                    mediaConnection.on("stream", function(stream) {
                        console.log(mediaConnection);

                        console.log(stream);
                        video.srcObject = stream;

                        stream.addEventListener("addtrack",function() {
                            console.log("addtrack")
                        });
                        stream.addEventListener("removetrack",function() {
                            console.log("removetrack")
                        });

                        join.setAttribute("aria-busy", "false");
                        joinCode.removeAttribute("aria-invalid");
                        main.classList.add("d-none");
                        control.classList.remove("d-none");
                    });
                    mediaConnection.on("close", function() {
                        if (isClosing) {
                            dataConnection.close();
                        }
                    });
                    mediaConnection.on("error", function(error) {
                        console.log("error stream");
                    });
                    mediaConnection.answer();

                    //close btn
                    const close = control.querySelector(".close");
                    close.addEventListener("click", function() {
                        isClosing = true;
                        mediaConnection.close();
                    });

                    //audio btn
                    let isAudio = (await IdbHelper.RowGet(db, "settings", [["audio", false]]))[0];
                    const audio = control.querySelector(".audio");
                    const audioIconOn = control.querySelector(".audioIconOn");
                    const audioIconOff = control.querySelector(".audioIconOff");
                    audio.addEventListener("click", async function() {
                        isAudio = !isAudio;
                        await IdbHelper.RowSet(db, "settings", [["audio", isAudio]]);
                        audioRefresh();
                    });
                    const audioRefresh = function() {
                        if (isAudio) {
                            video.muted = false;
                            audioIconOn.classList.remove("d-none");
                            audioIconOff.classList.add("d-none");
                        } else {
                            video.muted = true;
                            audioIconOn.classList.add("d-none");
                            audioIconOff.classList.remove("d-none");
                        }
                    };
                    audioRefresh();

                    //screen btn
                    const screen = control.querySelector(".screen");
                    const modal = document.getElementById("modal");
                    const display = modal.querySelector(".display");
                    const frameRate = modal.querySelector(".frameRate");
                    const bitRate = modal.querySelector(".bitRate");
                    const modalConfirm = modal.querySelector(".confirm");
                    const modalCancel= modal.querySelector(".cancel");
                    screen.addEventListener("click", async function() {
                        if (modal.open === false) {
                            await screenRefresh();
                            modal.show();
                        }
                    });
                    modalConfirm.addEventListener("click", async function() {
                        mediaConnection.close();
                        currenctId = display.value;
                        currenctFrameRate = frameRate.value;
                        currenctBitRate = bitRate.value;
                        await communicator.invoke({
                            "method": "screenGet",
                            "id": currenctId,
                            "frameRate": currenctFrameRate,
                            "bitRate": currenctBitRate
                        });
                        modal.close();
                    });
                    modalCancel.addEventListener("click", function() {
                        modal.close();
                    });
                    communicator.addEventListener("send", async function(event) {
                        if (event.detail.data["method"] === "screenChange") {
                            let screens = await communicator.invoke({
                                "method": "screenList"
                            });
                            currenctId = screens[0].id;
                            await communicator.invoke({
                                "method": "screenGet",
                                "id": currenctId,
                                "frameRate": currenctFrameRate,
                                "bitRate": currenctBitRate
                            });
                            screenRefresh();
                        }
                    });
                    const screenRefresh = async function() {
                        //get screens
                        let screens = await communicator.invoke({
                            "method": "screenList"
                        });

                        //update ui
                        display.innerHTML = "";
                        let isExist = false;
                        let screenCount = 0;
                        let WindowCount = 0;
                        for (const screen of screens) {
                            const option = document.createElement("option");
                            if (screen["id"].split(":")[0] === "screen") {
                                screenCount++;
                                option.text = "Screen " + screenCount;
                            } else {
                                WindowCount++;
                                option.text = "Window " + WindowCount;
                            }
                            option.value = screen["id"];
                            display.add(option);
                            if (isExist === false) {
                                isExist = screen["id"] === currenctId;
                            }
                        }
                        if (isExist) {
                            display.value = currenctId;
                        }
                        
                        frameRate.value = currenctFrameRate;
                        bitRate.value = currenctBitRate;
                    };

                    //fullscreen
                    let isFullscreen = false;
                    const fullscreen = control.querySelector(".fullscreen");
                    /*const fullscreenIconOn = control.querySelector(".fullscreenIconOn");
                    const fullscreenIconOff = control.querySelector(".fullscreenIconOff");*/
                    fullscreen.addEventListener("click", function() {
                        video.requestFullscreen();
                    });
                    /*const fullscreenRefresh = function() {
                        if (isFullscreen) {
                            fullscreenIconOn.classList.remove("d-none");
                            fullscreenIconOff.classList.add("d-none");
                        } else {
                            fullscreenIconOn.classList.add("d-none");
                            fullscreenIconOff.classList.remove("d-none");
                        }
                    };
                    fullscreenRefresh();*/
                });
                await communicator.invoke({
                    "method": "screenGet",
                    "id": currenctId,
                    "frameRate": currenctFrameRate,
                    "bitRate": currenctBitRate
                });


                
            });
        };
        



























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

        


        

    };

});