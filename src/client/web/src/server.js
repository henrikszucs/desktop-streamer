"use strict";

// the transport the whole UI talks to the server through: one WebSocket, the
// packetized communicator on top of it, and the joins it keeps in memory. It is
// not a UI module - the shell builds it once and hands it to every module in ctx.

// third-party dependencies
import IDB from "../libs/idb/idb.js";
import Communicator from "../libs/communicator/communicator.js";

// first-party dependencies
import { conf, table, CONF_TABLE, GUEST_TABLE, USER_TABLE } from "./conf.js";
import { desktop } from "./desktop.js";
import { getOS } from "./env.js";

// events:
// online, offline, login, logout,
// user-data
// session-added, session-removed, session-changed,
// pair-request, pair-accept, pair-reject, 
// devices-added, devices-removed, devices-changed,
// shares-added, shares-removed, shares-changed
const Server = class extends EventTarget {
    address = "";
    ws = null;
    communicator = null;
    isOnline = false;
    loginState = {
        "isLoggedIn": false,
        "sessionId": "",
        "sessionKey": ""
    };
    joinsGuest = new Map();   // joinId -> {peerCode, hostCode, name, isOnline, isRemember}
    joinsUser = new Map();    // joinId -> {isPeer, isHost, hostCode, name, isOnline, isRemember}
    constructor() {
        super();
    };
    connect(address) {
        //events: online / offline
        this.address = address;
        this.communicator = new Communicator({
            "sender": function() {},
            "interactTimeout": 3000,    //the max timeout between two packet arrive
            "timeout": 5000,            //the time for transmit message
            "packetSize": 1000,         //the maximum size of one packet in bytes (only for ArrayBuffer)
            "packetTimeout": 1000,      //the max timeout for packets
            "packetRetry": Infinity,    //number of retring attemts for one packet
            "sendThreads": 16
        });

        if (conf["local"]["sessionId"] !== "") {
            this.loginState["isLoggedIn"] = true;
            this.loginState["sessionId"] = conf["local"]["sessionId"];
            this.loginState["sessionKey"] = conf["local"]["sessionKey"];
        }
        
        this.reconnect();
    };
    reconnect() {
        this.ws?.close?.();
        
        //create connection
        this.ws = new WebSocket(this.address);
        this.ws.binaryType = "arraybuffer";

        // listen for incoming requests
        this.communicator.onIncoming((messageObj) => {
            this.handleIncoming(messageObj);
        });

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

        // connection finishing
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

            // allow online
            console.log("connected");
            this.isOnline = true;

            // try to login with saved session
            if (this.loginState["isLoggedIn"] === true) {
                const message = this.communicator.invoke({"type":"login-session", "sessionKey": this.loginState["sessionKey"]});
                await message.wait();
                const data = message.data;
                if (data["success"] !== true) {
                    this.loginState["isLoggedIn"] = false;
                    this.loginState["sessionId"] = "";
                    this.loginState["sessionKey"] = "";
                    await this.saveSession();
                }
            }

            // clear joins
            this.joinsGuest.clear();
            this.joinsUser.clear();

            // try connect on peer/host joins (guest - local)
            const guestJoins = await IDB.RowEntries(table(GUEST_TABLE))
            for (let guestJoin of guestJoins) {
                const joinId = guestJoin[0];
                let isChange = false;
                const dataStore = {
                    "peerCode": guestJoin[1]["peerCode"],
                    "hostCode": guestJoin[1]["hostCode"]
                };

                if (dataStore["peerCode"] !== undefined) {
                    const request = await this.subscribeJoin(joinId, dataStore["peerCode"], undefined);
                    if (request["success"] === false) {
                        isChange = true;
                        delete dataStore["peerCode"];
                    } else {
                        this.setJoin(true, joinId, {
                            "isPeer": true,
                            "peerCode": dataStore["peerCode"],
                            "name": request["name"],
                            "isRemember": request["isRemember"],
                            "isOnline": request["isOnline"]
                        });
                    }
                }

                if (dataStore["hostCode"] !== undefined) {
                    const request = await this.subscribeJoin(joinId, undefined, dataStore["hostCode"]);
                    if (request["success"] === false) {
                        isChange = true;
                        delete dataStore["hostCode"];
                    } else {
                        this.setJoin(true, joinId, {
                            "isHost": true,
                            "hostCode": dataStore["hostCode"],
                            "name": request["name"],
                            "isRemember": request["isRemember"],
                            "isOnline": request["isOnline"]
                        });
                    }
                }

                // save or delete
                if (dataStore["peerCode"] === undefined && dataStore["hostCode"] === undefined) {
                    await IDB.RowDel(table(GUEST_TABLE),  [joinId]);
                    continue;
                }
                if (isChange) {
                    await IDB.RowUpdate(table(GUEST_TABLE), joinId, dataStore);
                }
            }

            // try share on host joins (users - local)
            const userJoins = await IDB.RowEntries(table(USER_TABLE))
            for (let userJoin of userJoins) {
                const joinId = userJoin[0];
                const dataStore = {
                    "hostCode": userJoin[1]["hostCode"]
                };

                const request = await this.subscribeJoin(joinId, undefined, dataStore["hostCode"]);
                if (request["success"] === false) {
                    await IDB.RowDel(table(USER_TABLE), [joinId]);
                } else {
                    this.setJoin(true, joinId, {
                        "isHost": true,
                        "hostCode": dataStore["hostCode"],
                        "name": request["name"],
                        "isRemember": request["isRemember"],
                        "isOnline": request["isOnline"]
                    });
                }
            }

            // try connect peer joins (users - remote)
            let peersUser = [];
            try {
                peersUser= await this.getUserData("devices");
            } catch (error) {}
            for (let peerJoin of peersUser) {
                this.setJoin(false, peerJoin["joinId"], {
                    "isPeer": true,
                    "name": peerJoin["name"],
                    "isRemember": peerJoin["isRemember"],
                    "isOnline": peerJoin["isOnline"]
                });
            }

            // try connect host joins (users - remote)
            const hostsUser = [];
            try {
                hostsUser = await this.getUserData("shares");
            } catch (error) {}
            for (let hostJoin of hostsUser) {
                this.setJoin(false, hostJoin["joinId"], {
                    "isHost": true,
                    "name": hostJoin["name"],
                    "isRemember": hostJoin["isRemember"],
                    "isOnline": hostJoin["isOnline"]
                });
            }

            // trigger online
            this.dispatchEvent(new CustomEvent("online"));

            // trigger login
            if (this.loginState["isLoggedIn"] === true) {
                this.dispatchEvent(new CustomEvent("login"));
            }

            // notify outgoing shares
            if (this.isShare()) {
                this.dispatchEvent(new CustomEvent("share-start"));
            } else {
                this.dispatchEvent(new CustomEvent("share-end"));
            }
        }, { "once": true });

        // handle disconnection
        const handleDisconnection = () => {
            this.ws.removeEventListener("error", handleError);
            this.ws.removeEventListener("close", handleClose);
            this.isOnline = false;
            this.dispatchEvent(new CustomEvent("offline"));
            setTimeout(() => {
                this.reconnect();
            }, 2000);
        };
        const handleError = () => {
            console.log("disconnected");
            handleDisconnection();
        };
        this.ws.addEventListener("error", handleError, { "once": true });
        const handleClose = () => {
            console.log("close");
            handleDisconnection();
        };
        this.ws.addEventListener("close", handleClose, { "once": true });
    };
    async handleIncoming(messageObj) {
        await messageObj.wait();
        const message = messageObj.data;

        // logout
        if (message["type"] === "logout") {
            this.loginState["isLoggedIn"] = false;
            this.loginState["sessionId"] = "";
            this.loginState["sessionKey"] = "";
            await this.saveSession();
            return;
        }
        
        // basic user data
        if (["email", "firstName", "lastName", "picture"].includes(message["type"])) {
            this.dispatchEvent(new CustomEvent("user-data", {
                "detail": {
                    "type": message["type"],
                    "value": message["value"]
                }
            }));
            return;
        }
        
        // session added / removed
        if (message["type"] === "sessions") {
            if (message["isRemove"] === true) {
                this.dispatchEvent(new CustomEvent("session-removed", {
                    "detail": message["value"]
                }));
                return;
            }

            if (message["isChange"] === true) {
                this.dispatchEvent(new CustomEvent("session-changed", {
                    "detail": message["value"]
                }));
                return;
            }
            
            this.dispatchEvent(new CustomEvent("session-added", {
                "detail": message["value"]
            }));
        }

        // pair request
        if (message["type"] === "pair-request") {
            const showRemember = message["details"]["isUser"] === true || this.loginState["isLoggedIn"] === true;
            this.dispatchEvent(new CustomEvent("pair-request", {
                "detail": {
                    "showRemember": showRemember,
                    "details": message["details"],
                    "timeout": message["timeout"]
                }
            }));
            return;
        }

        // pair accept
        if (message["type"] === "pair-accept") {
            // save pairing (only for guests)
            const isGuest = this.loginState["isLoggedIn"] === false;
            if (isGuest) {
                const table = table(GUEST_TABLE);
                let data = await IDB.RowGet(table, [[messageObj.data["joinId"], {}]]);
                data = data[0];
                data["peerCode"] =  messageObj.data["peerCode"];
                await IDB.RowSet(table, [
                    [message["joinId"], data]
                ]);
            }

            // update memory
            this.setJoin(isGuest, message["joinId"], {
                "peerCode": message["peerCode"],
                "isRemember": message["isRemember"],
                "peerName": message["peerName"]
            });

            // send event
            this.dispatchEvent(new CustomEvent("pair-accept", {
                "detail": {
                    "joinId": message["joinId"],
                    "peerCode": message["peerCode"],
                    "isRemember": message["isRemember"],
                    "peerName": message["peerName"]
                }
            }));
            return;
        }

        // pair reject
        if (message["type"] === "pair-reject") {
            this.dispatchEvent(new CustomEvent("pair-reject"));
            return;
        }

        // devices
        if (message["type"] === "devices") {
            console.log(message);

            const guestJoin = this.joinsGuest.get(message["value"]["joinId"]);
            const isGuestExist = guestJoin !== undefined;

            const userJoin = this.joinsUser.get(message["value"]["joinId"]);
            const isUserExist = userJoin !== undefined;

            const isExist = isGuestExist || isUserExist;

            if (isExist) {
                if (message["isRemove"] === true) {
                    this.removeJoin(isGuestExist, message["value"]["joinId"]);
                } else if (message["isChange"] === true) {
                    console.log(message);
                    this.setJoin(isGuestExist, message["value"]["joinId"], {
                        "name": message["value"]["name"],
                        "isRemember": message["value"]["isRemember"],
                        "isOnline": message["value"]["isOnline"]
                    });
                } else {
                    this.setJoin(isGuestExist, message["value"]["joinId"], {
                        "name": message["value"]["name"],
                        "isRemember": message["value"]["isRemember"],
                        "isOnline": message["value"]["isOnline"]
                    });
                }
                
            } else {
                if (message["isRemove"] !== true && message["isChange"] !== true) {
                    if (this.loginState["isLoggedIn"] === true) {
                        this.setJoin(false, message["value"]["joinId"], {
                            "isPeer": true,
                            "name": message["value"]["name"],
                            "isRemember": message["value"]["isRemember"],
                            "isOnline": message["value"]["isOnline"]
                        });
                    }
                }
            }
            return;
        }

        // shares
        if (message["type"] === "shares") {

            const guestJoin = this.joinsGuest.get(message["value"]["joinId"]);
            const isGuestExist = guestJoin !== undefined;

            const userJoin = this.joinsUser.get(message["value"]["joinId"]);
            const isUserExist = userJoin !== undefined;

            const isExist = isGuestExist || isUserExist;

            if (isExist) {
                if (message["isRemove"] === true) {
                    this.removeJoin(isGuestExist, message["value"]["joinId"]);
                } else if (message["isChange"] === true) {
                    const data = {};
                    if (message["value"]["name"] !== undefined) {
                        data["name"] = message["value"]["name"];
                    }
                    if (message["value"]["isRemember"] !== undefined) {
                        data["isRemember"] = message["value"]["isRemember"];
                    }
                    if (message["value"]["isOnline"] !== undefined) {
                        data["isOnline"] = message["value"]["isOnline"];
                    }
                    if (message["value"]["hostCode"] !== undefined) {
                        data["hostCode"] = undefined;
                    }

                    this.setJoin(isGuestExist, message["value"]["joinId"], data);
                } else {
                    this.setJoin(isGuestExist, message["value"]["joinId"], {
                        "name": message["value"]["name"],
                        "isRemember": message["value"]["isRemember"],
                        "isOnline": message["value"]["isOnline"]
                    });
                }
                
                
            } else {
                if (message["isRemove"] !== true && message["isChange"] !== true) {
                    if (this.loginState["isLoggedIn"] === true) {
                        this.setJoin(false, message["value"]["joinId"], {
                            "name": message["value"]["name"],
                            "isRemember": message["value"]["isRemember"],
                            "isOnline": message["value"]["isOnline"]
                        });
                    }
                }
            }
            return;
        }
    };
    async saveSession() {
        conf["local"]["sessionId"] = this.loginState["sessionId"];
        conf["local"]["sessionKey"] = this.loginState["sessionKey"];
        await IDB.RowSet(table(CONF_TABLE), [
            ["sessionId", this.loginState["sessionId"]],
            ["sessionKey", this.loginState["sessionKey"]]
        ]);
        if (this.loginState["isLoggedIn"]) {
            this.dispatchEvent(new CustomEvent("login"));
        } else {
            this.dispatchEvent(new CustomEvent("logout"));
        }
    };
    async loginGoogle(credential) {
        const userAgent = {};
        userAgent["desktop"] = desktop.isAvailable;
        userAgent["os"] = getOS();
        const message = this.communicator.invoke({"type":"login-google", "credential": credential, "userAgent": JSON.stringify(userAgent)});
        await message.wait();
        const data = message.data;
        if (data["success"] === true) {
            this.loginState["isLoggedIn"] = true;
            this.loginState["sessionId"] = data["sessionId"];
            this.loginState["sessionKey"] = data["sessionKey"];
            this.saveSession();
        }
        return data["success"];
    };
    async logout(sessionId=this.loginState["sessionId"]) {
        const message = this.communicator.invoke({"type":"logout", "sessionId": sessionId});
        await message.wait();
        if (sessionId === this.loginState["sessionId"] ) {
            if (message.data["success"] === true) {
                this.loginState["isLoggedIn"] = false;
                this.loginState["sessionId"] = "";
                this.loginState["sessionKey"] = "";
                await IDB.TableClear(table(USER_TABLE));
                await this.saveSession();
            }
        }
        return message.data["success"];
    };

    async getUserData(type, once=false) {
        if (this.isOnline === false) {
            throw new Error("Offline");
        }
        const messageObj = this.communicator.invoke({
            "type": "user-data-subscribe",
            "key": type,
            "once": once
        });
        await messageObj.wait();
        if (messageObj.data["success"] !== true) {
            throw new Error("Failed to get user data");
        }
        return messageObj.data["value"];
    };
    async unsubscribeUserData(type) {
        if (this.isOnline === false) {
            throw new Error("Offline");
        }
        const messageObj = this.communicator.invoke({
            "type": "user-data-unsubscribe",
            "key": type
        });
        await messageObj.wait();
        return messageObj.data["success"];
    };
    async deleteEmail(lang) {
        if (this.isOnline === false) {
            throw new Error("Offline");
        }
        const messageObj = this.communicator.invoke({
            "type": "delete-email",
            "lang": lang
        });
        await messageObj.wait();
        return messageObj.data["success"];
    };
    async deleteAccount(deleteKey) {
        if (this.isOnline === false) {
            throw new Error("Offline");
        }
        const messageObj = this.communicator.invoke({
            "type": "delete",
            "deleteKey": deleteKey
        });
        await messageObj.wait();
        const success = messageObj.data["success"];
        if (success === true) {
            this.loginState["isLoggedIn"] = false;
            this.loginState["sessionId"] = "";
            this.loginState["sessionKey"] = "";
            await this.saveSession();
        }
        return success;
    };

    async createPairCode() {
        const message = this.communicator.invoke({"type":"pair-create"});
        await message.wait();
        if (message.error !== "" || message.data["success"] !== true) {
            throw new Error("Failed to create pair code");
        }
        return message.data["pairCode"];
    };
    async pairRequest(pairCode) {
        const messageObj = this.communicator.invoke({"type":"pair-request", "pairCode": pairCode});
        await messageObj.wait();
        return messageObj.data;
    }
    async pairAccept(isRemember=false) {
        const messageObj = this.communicator.invoke({"type":"pair-accept", "remember": isRemember});
        await messageObj.wait();
        if (messageObj.error !== "" || messageObj.data["success"] !== true) {
            throw new Error("Failed to accept pair request");
        }
        // save
        let table;
        if (this.loginState["isLoggedIn"] === false) {
            table = table(GUEST_TABLE);
        } else {
            table = table(USER_TABLE);
        }
        let data = await IDB.RowGet(table, [[messageObj.data["joinId"], {}]]);
        data = data[0];
        data["hostCode"] =  messageObj.data["hostCode"];
        await IDB.RowSet(table, [
            [messageObj.data["joinId"], data]
        ]);

        // broadcast result
        const obj = {
            "joinId": messageObj.data["joinId"],
            "hostCode": messageObj.data["hostCode"],
            "isRemember": messageObj.data["isRemember"],
            "hostName": messageObj.data["hostName"]
        };
        this.dispatchEvent(new CustomEvent("pair-accept", {"detail": obj}));
        return obj;
    };
    async pairReject() {
        const messageObj = this.communicator.invoke({"type":"pair-reject"});
        await messageObj.wait();
        this.dispatchEvent(new CustomEvent("pair-reject"));
    };
    async deletePairCode() {
        const messageObj = this.communicator.invoke({"type":"pair-delete"});
        await messageObj.wait();
        if (messageObj.error !== "" || messageObj.data["success"] !== true) {
            throw new Error("Failed to delete pair code");
        }
        return true;
    };

    async subscribeJoin(joinId="", peerCode=undefined, hostCode=undefined) {
        const msg = {
            "type":"join-connect",
            "joinId": joinId
        };
        if (peerCode !== undefined) {
            msg["peerCode"] = peerCode;
        }
        if (hostCode !== undefined) {
            msg["hostCode"] = hostCode;
        }
        const messageObj = this.communicator.invoke(msg);
        await messageObj.wait();
        return messageObj.data;
    };
    async unsubscribeJoin(joinId="", peerCode=undefined, hostCode=undefined) {
        const msg = {
            "type":"join-disconnect",
            "joinId": joinId
        };
        if (peerCode !== undefined) {
            msg["peerCode"] = peerCode;
        }
        if (hostCode !== undefined) {
            msg["hostCode"] = hostCode;
        }
        const messageObj = this.communicator.invoke(msg);
        await messageObj.wait();
        return messageObj.data["success"];
    };
    setJoin(isGuest, joinId, option={}) {
        console.log("setJoin", isGuest, joinId, option);
        let isCreated = false;
        let exist;
        if (isGuest) {
            exist = this.joinsGuest.get(joinId);
            if (exist === undefined) {
                exist = {};
                this.joinsGuest.set(joinId, exist);
                isCreated = true;
            }
        } else {
            exist = this.joinsUser.get(joinId);
            if (exist === undefined) {
                exist = {};
                this.joinsUser.set(joinId, exist);
                isCreated = true;
            }
        }
        for (let key in option) {
            exist[key] = option[key];
        }
        let event = "join-changed";
        if (isCreated) {
            event = "join-added";
        }
        this.dispatchEvent(new CustomEvent(event, {
            "detail": {
                "isGuest": isGuest,
                "joinId": joinId,
                "value": option
            }
        }));
    };
    removeJoin(isGuest, joinId) {
        if (isGuest) {
            this.joinsGuest.delete(joinId);
        } else {
            this.joinsUser.delete(joinId);
        }
        this.dispatchEvent(new CustomEvent("join-removed", {
            "detail": {
                "isGuest": isGuest,
                "joinId": joinId
            }
        }));
    };
    isShare() {
        for (let joinData of this.joinsGuest) {
            if (joinData[1]["hostCode"] !== undefined) {
                return true;
            }
        }
        for (let joinData of this.joinsUser) {
            if (joinData[1]["hostCode"] !== undefined) {
                return true;
            }
        }
        return false;
    };

};
export { Server };
export default Server;
