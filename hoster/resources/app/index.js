"use strict";

const { ipcRenderer } = require("electron");
const { networkInterfaces } = require("os");
const http = require("http");
const fs = require('node:fs');
const path = require("path");
const { Buffer } = require('node:buffer');

const getIpAddresses = function() {
    const nets = networkInterfaces();
    const results = {};
    
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
            // 'IPv4' is in Node <= 17, from 18 it's a number 4 or 6
            const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4
            if (net.family === familyV4Value && !net.internal) {
                if (!results[name]) {
                    results[name] = [];
                }
                results[name].push(net.address);
            }
        }
    }
    return results;
}


window.addEventListener("load", async function() {
    const pathApp = await ipcRenderer.invoke("api", "path-app");
    const websocket = require(path.join(pathApp, "websocket.js"));
    //console.log(websocket);

    const msg = document.getElementById("message");


    //
    // Port
    //
    let port = parseInt(localStorage.getItem("port"));
    const portEl = document.getElementById("port");
    if (isNaN(port)) {
        port = 8910;
    }
    portEl.value = port;
    portEl.addEventListener("change", function(event) {
        const newPort = parseInt(event.target.value);
        if (isNaN(newPort) === false && (1 < newPort && newPort < 65000)) {
            port = newPort;
            event.target.value = port;
            localStorage.setItem("port", port);
        } else {
            event.target.value = port;
        }
    });


    //
    // Screen
    //
    const screenEl = document.getElementById("screen");
    const sourcesUpdate = async function() {
        return new Promise(async function(resolve) {
            const sources = await ipcRenderer.invoke("api", "sources");

            for(let i = screenEl.options.length - 1; i >= 0; i--) {
                screenEl.remove(i);
            }

            for (const source of sources) {
                const option = document.createElement("option");
                option.text = source["name"];
                option.value = source["id"];
                screenEl.appendChild(option);
            }
        });
    }
    document.getElementById("update").addEventListener("click", function() {
        sourcesUpdate();
    });
    sourcesUpdate();


    //
    // Audio
    //
    let audio = !Boolean(parseInt(localStorage.getItem("audio")));
    const audioEl = document.getElementById("audio");
    audioEl.checked = audio;
    audioEl.addEventListener("change", function(event) {
        audio = Boolean(event.target.checked);
        localStorage.setItem("audio", audio ? 0 : 1);
    });


    //
    // Start
    //
    const startEl = document.getElementById("start");
    let stream = null;

    let server = null;
    let wss = null;
    
    startEl.addEventListener("click", async function() {
        if (stream === null) {
            try {
                const constraints = {
                    "video": {
                        "mandatory": {
                            "chromeMediaSource": "desktop",
                            "chromeMediaSourceId": screenEl.value,
                            "minFrameRate": 60,
                            "maxFrameRate": 60
                        }
                    }
                };
                if (audio === true) {
                    constraints["audio"] = {
                        "mandatory": {
                            "chromeMediaSource": "desktop"
                        }
                    };
                } else {
                    constraints["audio"] = false;
                }
                stream = await navigator.mediaDevices.getUserMedia(constraints);
                //console.log(stream);
                
            } catch (error) {
                /* handle the error */
                console.log(error);
                stream = null;
            }
        } else {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }

        if (stream !== null) {
            //http server
            server = http.createServer(async function (req, res) {
                res.writeHead(200, {
                    "Content-Type": "text/html"
                });
                const data = fs.readFileSync(path.join(pathApp, "client.html"), "utf8");
                res.write(data);
                res.end();
            }).listen(port);
            
            //websocket server
            wss = new websocket.server({ "httpServer": server });
            wss.on("request", function(request) {
                let connection = request.accept("stream-protocol", request.origin);
                console.log((new Date()) + " Connection accepted.");

                //recorder
                const recorder = new MediaRecorder(stream,  {
                    "audioBitsPerSecond": 256000,
                    "videoBitsPerSecond": 25000000,
                    "mimeType": "video/webm; codecs=opus,vp8"
                });
                recorder.addEventListener("dataavailable", async function (event) {
                    //console.log(event);
                    if (event.data.size > 0) {
                        let buff = await event.data.arrayBuffer();
                        buff = Buffer.from(buff);
                        connection.sendBytes(buff);
                    }
                });
                recorder.start(1000);

                /*
                connection.on("message", function(message) {
                    
                    if (message.type === "utf8") {
                        console.log("Received Message: " + message.utf8Data);
                        connection.sendUTF(message.utf8Data);
                    }
                    else if (message.type === "binary") {
                        console.log("Received Binary Message of " + message.binaryData.length + " bytes");
                        connection.sendBytes(message.binaryData);
                    }
                });
                */
                connection.on("close", function(reasonCode, description) {
                    recorder.stop();
                    console.log((new Date()) + " Peer " + connection.remoteAddress + " disconnected.");
                });
            });

            
        } else {
            server?.close?.();
            wss?.close?.();
        }

        if (stream !== null) {
            startEl.value = "Stop";

            const ips = getIpAddresses();
            msg.innerHTML = "http://" + ips[Object.keys(ips)[0]][0] + ":" + port;

            const video = document.getElementById("video");
            video.muted = true;
            video.width = "640";
            video.height = "360";
            video.srcObject = stream;
            video.onloadedmetadata = (e) => video.play();
            //console.log(stream.getVideoTracks()[0].getSettings().frameRate);
        } else {
            startEl.value = "Start";
            msg.innerHTML = "Currently cast is not running.";
        }
    });

    
});

//debug
ipcRenderer.on("api", function(event, ...arg) {
    if (arg[0] === "log") {
        console.log(arg[1]);
    }
})