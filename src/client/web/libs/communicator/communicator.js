"use strict";

//constant values 
const errors = {
    NO_ERROR: "",               // no error
    TIMEOUT: "timeout",         // error occurs if the data transfer is not completed in time
    INACTIVE: "inactive",       // error occurs if between the packet transfers there is no interaction
    ABORT: "abort",             // error occurs if local side abort the process
    REJECT: "reject",           // error occurs if other side abort the process
    TRANSFER_SEND: "send",      // error occurs if cannot send data with sender function
    TRANSFER_RECEIVE: "receive" // error occurs if exceed the receive attempts number
};

//main class
const Communicator = class {
    UID = 1;                    //random positive number to decide the side
    sender = async function(data, transfer, message) {}; //sender function
    interactTimeout = 5000;     //cancel if not happen any transmission in time

    timeout = 5000;             //the whole invoke process time limit
    packetSize = 16384;         //max size of each packet
    packetTimeout = 1000;       //timeout for packet acknowledgment
    packetRetry = Infinity;     //retry attemts number for one packets
    sendThreads = 16;           //packets that can be sent in same time

    timeOffset = 0;             //time offset between the sender and receiver
    timeSyncIntervalId = -1;    //time sync interval id
    timePromise;                //time sync promise
    timeResolve;                //time sync callback

    sidePromise;                //side sync promise
    sideResolve;                //side sync callback

    messageId = 0;              //the message id for the next message
    myReminder = 0;             //reminder of the UID what I am
    messages = new Map();       //all messages that are in process

    onincoming = function(message) {};  // trigger if incoming new message
    onsend = function(data) {};         // trigger if incomed and finished new send message
    oninvoke = function(message) {};    // trigger if incomed and finished new invoke message

    ERROR = errors;     //error constants

    // Public
    // setup API: configure, release, timeSyncStart, timeSyncStop, timeSync
    // com API: send, invoke, receive
    // trigger API: onIncoming, onSend, onInvoke
    constructor(config) {
        //initial UID setup
        this.UID = Math.floor(Math.random() * 4294967294) + 1; // betwwen 1 and (32 bit-1)

        //set configuration
        this.configure(config);
    };

    configure(config) {
        //set variables
        if (typeof config !== "object") {
            throw new Error("Configuration needs to be an object.");
        }

        //set required params and static params
        if (config["sender"] !== "undefined") {
            if (typeof config["sender"] === "function") {
                this.sender = config["sender"];
            } else {
                throw new Error("'sender' option must be function");
            }
        }

        //set optional and static params
        if (typeof config["interactTimeout"] !== "undefined") {
            if (typeof config["interactTimeout"] === "number") {
                this.interactTimeout = config["interactTimeout"];
            } else {
                throw new Error("'interactTimeout' option must be number");
            }
        }

        //set optional params
        if (typeof config["timeout"] !== "undefined") {
            if (typeof config["timeout"] === "number") {
                this.timeout = config["timeout"];
            } else {
                throw new Error("'timeout' option must be number");
            }
        }
        if (typeof config["packetSize"] !== "undefined") {
            if (typeof config["packetSize"] === "number") {
                this.packetSize = config["packetSize"];
            } else {
                throw new Error("'packetSize' option must be number");
            }
        }
        if (typeof config["packetTimeout"] !== "undefined") {
            if (typeof config["packetTimeout"] === "number") {
                this.packetTimeout = config["packetTimeout"];
            } else {
                throw new Error("'packetRetry' option must be number");
            }
        }
        if (typeof config["packetRetry"] !== "undefined") {
            if (typeof config["packetRetry"] === "number") {
                this.packetRetry = config["packetRetry"];
            } else {
                throw new Error("'packetRetry' option must be number");
            }
        }
        if (typeof config["sendThreads"] !== "undefined") {
            if (typeof config["sendThreads"] === "number") {
                this.sendThreads = config["sendThreads"];
            } else {
                throw new Error("'sendThreads' option must be number");
            }
        }
        if (typeof config["timeOffset"] !== "undefined") {
            if (typeof config["timeOffset"] === "number") {
                this.timeOffset = config["timeOffset"];
            } else {
                throw new Error("'timeOffset' option must be number");
            }
        }

    };
    release() {
        //free up every pointer that point to non internal variables
        clearInterval(this.timeSyncIntervalId);
        this.sender = async function(data, transfer, message) {};
        this.messages = new Map();
    };

    timeSyncStart(resyncTime=60000) {
        clearInterval(this.timeSyncIntervalId);
        this.SyncTime();
        this.timeSyncIntervalId = setInterval(() => {
            this.SyncTime();
        }, resyncTime);
    };
    timeSyncStop() {
        clearInterval(this.timeSyncIntervalId);
    };
    async timeSync(retry=5, patience=this.interactTimeout) {
        //check runnig request
        if (this.timePromise !== undefined) {
            return this.timePromise;
        }

        //start request
        this.timePromise = this.timeSyncRaw(retry, patience);
        const isSuccess = await this.timePromise;
        this.timePromise = undefined;
        return isSuccess;
    };
    async timeSyncRaw(retry, patience) {
        let isSuccess = false;
        let trying = 0;
        do {
            trying++;

            isSuccess = await new Promise((resolve) => {
                this.timeSyncResolve(resolve, patience);

                //send
                const buffer = new ArrayBuffer(17);
                const view = new DataView(buffer);
                view.setUint8(view.byteLength - 1, 1); //time sync flag
                view.setFloat64(view.byteLength - 9, Date.now()); //my time
                view.setFloat64(view.byteLength - 17, -1); //other time
                this.sender(buffer, [buffer], undefined);
                
                
            });
        } while (trying < retry && isSuccess === false);

        if (isSuccess === false) {
            isSuccess = await new Promise((resolve) => {
                this.timeSyncResolve(resolve, this.interactTimeout);
            });
        }

        return isSuccess;
    };
    timeSyncResolve(resolve, patience) {
        //timeout
        const timeout = setTimeout(() => {
            this.timeResolve = undefined;
            resolve(false);
        }, patience);

        //callback
        this.timeResolve = () => {
            this.timeResolve = undefined;
            clearTimeout(timeout);
            resolve(true);
        };
    };

    async sideSync(retry=5, patience=this.interactTimeout) {
        //check runnig request
        if (this.sidePromise !== undefined) {
            return this.sidePromise;
        }

        //start request
        this.sidePromise = this.sideSyncRaw(retry, patience);
        const isSuccess = await this.sidePromise;
        this.sidePromise = undefined;
        return isSuccess;
    };
    async sideSyncRaw(retry, patience) {
        let isSuccess = false;
        let trying = 0;
        do {
            trying++;
            isSuccess = await new Promise((resolve) => {
                this.sideSyncResolve(resolve, patience);

                //send
                const buffer = new ArrayBuffer(13);
                const view = new DataView(buffer);
                view.setUint8(view.byteLength - 1, 2); //side sync flag
                view.setUint32(view.byteLength - 5, Date.now() % 4294967295); //my time
                view.setUint32(view.byteLength - 9, this.UID); //my UID
                view.setUint32(view.byteLength - 13, 0); //other UID
                this.sender(buffer, [buffer], undefined);
            });
        } while (trying < retry && isSuccess === false);

        if (isSuccess === false) {
            isSuccess = await new Promise((resolve) => {
                this.sideSyncResolve(resolve, this.interactTimeout);
            });
        }

        return isSuccess;
    };
    sideSyncResolve(resolve, patience) {
        //timeout
        const timeout = setTimeout(() => {
            this.sideResolve = undefined;
            resolve(false);
        }, patience);

        //callback
        this.sideResolve = (otherUID) => {
            this.sideResolve = undefined;
            clearTimeout(timeout);

            if (otherUID === this.UID) {
                //console.log("UID", this.UID, otherUID);
                this.UID = Math.floor(Math.random() * 4294967294) + 1; // betwwen 1 and (32 bit-1)
                resolve(false);
            } else {
                //console.log("UID", this.UID, otherUID);
                this.myReminder = (this.UID > otherUID ? 1 : 0);
                this.messageId = this.myReminder;
                resolve(true);
            }

        };
    };



    send(msg, transfer = [], timeout, options) {
        //create
        const messageObj = this.messageCreate();

        //set params
        this.messageSet(messageObj, options, false);

        //create pending process
        messageObj.pending = this.sendRaw(messageObj, msg, transfer, timeout);

        return messageObj;
    };
    async sendRaw(messageObj, msg, transfer, timeout) {
        //prevent recalling
        messageObj.send = undefined;
        messageObj.invoke = undefined;

        //timeout abort
        if (typeof timeout !== "number") {
            timeout = this.timeout;
        }
        messageObj.timeoutId = setTimeout(() => {
            messageObj.error = this.ERROR.TIMEOUT;
            for (const cb of messageObj.onaborts) {
                cb();
            }
        }, timeout);

        //send data
        await this.messageSend(messageObj, msg, transfer);
        if (messageObj.error === this.ERROR.ABORT) {
            console.log(messageObj.error)
            const sendTime = (Date.now() + this.timeOffset) % 4294967295; //32 bit time
            const data = new Uint8Array(9);
            const view = new DataView(data.buffer);
            //set headers
            view.setUint8(view.byteLength - 1, 16); //abort flag
            view.setUint32(view.byteLength - 5, sendTime); //send time
            view.setUint32(view.byteLength - 9, messageObj.messageId);
            try {
                this.sender(data.buffer, [data.buffer], messageObj);
            } catch (e) {
                
            }
        }
        this.messageFree(messageObj);

        return messageObj;
    };
    invoke(msg, transfer = [], timeout, options) {
        //create
        const messageObj = this.messageCreate();

        //set params
        this.messageSet(messageObj, options, true);

        //create pending process
        messageObj.pending = this.invokeRaw(messageObj, msg, transfer, timeout);

        return messageObj;
    };
    async invokeRaw(messageObj, msg, transfer, timeout) {
        return new Promise((resolve) => {
            //prevent recalling
            messageObj.send = undefined;
            messageObj.invoke = undefined;

            //timeout abort
            if (typeof timeout !== "number") {
                timeout = this.timeout;
            }
            messageObj.timeoutId = setTimeout(() => {
                messageObj.error = this.ERROR.TIMEOUT;
                for (const cb of messageObj.onaborts) {
                    cb();
                }
            }, timeout);

            //exit if error
            messageObj.onaborts.add(() => {
                //console.log("aborted");
                //console.log(messageObj.error);
                //send abort warning to other side
                if (messageObj.error === this.ERROR.ABORT) {
                    const sendTime = (Date.now() + this.timeOffset) % 4294967295; //32 bit time
                    const data = new Uint8Array(9);
                    const view = new DataView(data.buffer);
                    //set headers
                    view.setUint8(view.byteLength - 1, 16); //abort flag
                    view.setUint32(view.byteLength - 5, sendTime); //send time
                    view.setUint32(view.byteLength - 9, messageObj.messageId);
                    try {
                        this.sender(data.buffer, [data.buffer], messageObj);
                    } catch (e) {

                    }
                }
                this.messageFree(messageObj);
                resolve([messageObj.error, messageObj.data, messageObj.isInvoke]);
            });

            //or exit if invoke finish
            messageObj.onfinish = () => {
                this.messageFree(messageObj);
                messageObj.send = (msg, transfer, timeout, options) => {
                    this.messageSet(messageObj, options, false);
                    messageObj.pending = this.sendRaw(messageObj, msg, transfer, timeout);
                    return messageObj;
                };
                messageObj.invoke = (msg, transfer, timeout, options) => {
                    this.messageSet(messageObj, options, true);
                    messageObj.pending = this.invokeRaw(messageObj, msg, transfer, timeout);
                    return messageObj;
                };
                resolve([messageObj.error, messageObj.data, messageObj.isInvoke]);
            };

            //send data
            this.messageSend(messageObj, msg, transfer);
        });
    }



    async receive(msg) {
        //1bit time sync request flag
        //1bit side sync request flag
        //1bit invoke flag
        //1bit split flag
        //1bit abort flag
        //1bit answer flag
        //2bit unused

        //my time - 64bit float timestamp (only time sync)
        //other time - 64bit float timestamp (only time sync)

        //my time - 32bit uint (only side sync)
        //my UID - 32bit uint (only side sync)
        //other UID - 32bit uint (only side sync)

        //32bit send time
        //32bit message id
        //16bit packet id (split)
        //16bit packet count (split, first)
        //32bit answer for (answer flag)

        //data...

        //mandaory header
        let isTimeSync = false;
        let isSideSync = false;
        let isInvoke = false;
        let isSplit = false;
        let isAbort = false;
        let isAnswer = false;

        //time header
        let time1 = 0;
        let time2 = 0;

        //side header
        let time = 0;
        let UID1 = 0;
        let UID2 = 0;

        //message header
        let sendTime = 0;
        let messageId = 0;
        let packetId = 0;
        let packetCount = 1;
        let answerFor = 0;

        //data
        let data;

        //read from different types
        if (msg instanceof Array && msg.length > 1) {
            //handle 1st layer
            let offset = 0;
            const h = msg[offset++];
            isTimeSync = ((h & 1) !== 0 ? true : false); //get time sync request
            isSideSync = ((h & 2) !== 0 ? true : false); //get side sync request

            //handle 2nd layer
            if (isTimeSync) {
                time1 = msg[offset++];
                time2 = msg[offset++];

            } else if (isSideSync) {
                time = msg[offset++];
                UID1 = msg[offset++];
                UID2 = msg[offset++];

            } else {
                isInvoke = ((h & 4) !== 0 ? true : false); //get invoke flag
                isSplit = ((h & 8) !== 0 ? true : false); //get split flag
                isAbort = ((h & 16) !== 0 ? true : false); //get abort flag
                isAnswer = ((h & 32) !== 0 ? true : false); //get answer flag
                sendTime = msg[offset++]; //get send time
                messageId = msg[offset++]; //get message id
                if (isSplit) {
                    packetId = msg[offset++]; //get packet id
                    if (packetId === 0) {
                        packetCount = msg[offset++]; //get packet count
                    }
                }
                if (isAnswer) {
                    answerFor = msg[offset++]; //get answer for
                }
                data = msg[offset++]; //get data
            }

        } else if (msg instanceof ArrayBuffer && msg.byteLength > 0) {
            //handle 1st layer
            let offset = 0;
            const view = new DataView(msg);
            offset += 1;
            let h = view.getUint8(msg.byteLength - offset);
            isTimeSync = ((h & 1) !== 0 ? true : false); //get time sync request
            isSideSync = ((h & 2) !== 0 ? true : false); //get side sync request

            //handle 2nd layer
            if (isTimeSync) {
                offset += 8;
                time1 = view.getFloat64(view.byteLength - offset);
                offset += 8;
                time2 = view.getFloat64(view.byteLength - offset);

            } else if (isSideSync) {
                offset += 4;
                time = view.getUint32(view.byteLength - offset);
                offset += 4;
                UID1 = view.getUint32(view.byteLength - offset);
                offset += 4;
                UID2 = view.getUint32(view.byteLength - offset);

            } else {
                isInvoke = ((h & 4) !== 0 ? true : false); //get invoke flag
                isSplit = ((h & 8) !== 0 ? true : false); //get split flag
                isAbort = ((h & 16) !== 0 ? true : false); //get abort flag
                isAnswer = ((h & 32) !== 0 ? true : false); //get answer flag

                offset += 4;
                sendTime = view.getUint32(view.byteLength - offset); //get send time
                offset += 4;
                messageId = view.getUint32(view.byteLength - offset); //get message id
                if (isSplit) {
                    offset += 2;
                    packetId = view.getUint16(view.byteLength - offset); //get packet id
                    if (packetId === 0 && messageId % 2 !== this.myReminder) {
                        offset += 2;
                        packetCount = view.getUint16(view.byteLength - offset); //get packet count
                    }
                }
                if (isAnswer) {
                    offset += 4;
                    answerFor = view.getUint32(view.byteLength - offset); //get answer for
                }
                data = msg.transfer(msg.byteLength - offset); //get data


            }

        } else {
            console.warn("Wrong format incoming", msg);
            return;
        }

        // handle time sync packets
        if (isTimeSync) {
            //recive others request
            if (time2 === -1) {
                const buffer = new ArrayBuffer(25);
                const view = new DataView(buffer);
                view.setUint8(view.byteLength - 1, 1);
                view.setFloat64(view.byteLength - 9, time1);
                view.setFloat64(view.byteLength - 17, Date.now());
                this.sender(buffer, [buffer], undefined);
                return;
            }

            //recive my request
            const returnTime = Date.now() - time1;
            if (returnTime > this.interactTimeout || this.timeResolve === undefined) {
                return;
            }
            const timeOffset = (time2 + (returnTime / 2)) - Date.now();
            //console.log(timeOffset);
            this.timeOffset = timeOffset;
            this.timeResolve();
            return;
        }

        // handle side sync packets
        if (isSideSync) {
            //recive others request
            if (UID2 === 0) {
                const buffer = new ArrayBuffer(25);
                const view = new DataView(buffer);
                view.setUint8(view.byteLength - 1, 2);
                view.setUint32(view.byteLength - 5, time);
                view.setUint32(view.byteLength - 9, UID1);
                view.setUint32(view.byteLength - 13, this.UID);
                this.sender(buffer, [buffer], undefined);
                return;
            }

            //recive my request
            const now = Date.now() % 4294967295 - 100;
            if (time < now || now - time > this.interactTimeout || UID1 !== this.UID) {
                return;
            }
            //console.log("uid", UID1, UID2);
            this.sideResolve(UID2);
            return;
        }

        // delete outdated packets
        const now = Date.now() % 4294967295 - 100;
        if (sendTime < now || now - sendTime > this.interactTimeout) {
            return;
        }

        // my packets
        if (messageId % 2 === this.myReminder) {
            this.receiveMy(isAbort, messageId, packetId);
            return;
        }

        // other packets
        this.receiveOther(isInvoke, isSplit, isAbort, isAnswer, messageId, packetId, packetCount, answerFor, data);
    };
    async receiveMy(isAbort, messageId, packetId) {
        //get relevant object
        const messageObj = this.messages.get(messageId);

        //exit if not exist
        if (messageObj === undefined) {
            return;
        }

        //call the listening message
        messageObj.onreceive(isAbort, packetId);
        return;
    };
    async receiveOther(isInvoke, isSplit, isAbort, isAnswer, messageId, packetId, packetCount, answerFor, data) {
        // load message object
        let messageObj = this.messages.get(messageId);

        // solve if not exist
        if (messageObj === undefined) {
            if (isAnswer) {
                //console.log(isAnswer);
                // check the parent object (and not moved yet)
                messageObj = this.messages.get(answerFor);

                // exit if no parent
                if (messageObj === undefined) {
                    return;
                }

                // finsh outgoing sendings
                const iterator1 = messageObj.onpackets[Symbol.iterator]();
                for (const [key, val] of iterator1) {
                    val();
                }

                // move message object
                messageObj.messageId = messageId;
                messageObj.isInvoke = (isInvoke === 1 ? true : false);
                messageObj.isAnswer = true;
                messageObj.packetCount = Infinity;
                messageObj.packets = new Map();
                this.messages.delete(answerFor);
                this.messages.set(messageId, messageObj);

                // todo: trigger incoming answer
                //trigger incoming event
                messageObj.onincoming?.(messageObj);

            } else {
                //create new object
                messageObj = new Message();
                messageObj.messageId = messageId;
                messageObj.isInvoke = isInvoke;
                this.messages.set(messageId, messageObj);

                //create wait function
                messageObj.pending = new Promise((resolve) => {
                    messageObj.onaborts.add(() => {
                        resolve([messageObj.error, messageObj.data, messageObj.isInvoke]);
                    });

                    //or exit if invoke finish
                    messageObj.onfinish = () => {
                        resolve([messageObj.error, messageObj.data, messageObj.isInvoke]);
                    };
                });
                //trigger incoming event
                this.onincoming?.(messageObj);
            }
        }

        //no answer if under error
        if (messageObj.error !== "") {
            return;
        }

        //abort
        if (isAbort) {
            messageObj.error = this.ERROR.REJECT;
            for (const cb of messageObj.onaborts) {
                cb();
            }
            return;
        }
        

        //refresh interactivity
        clearTimeout(messageObj.interactTimeoutId);
        messageObj.interactTimeoutId = setTimeout(() => {
            messageObj.error = this.ERROR.INACTIVE;
            for (const cb of messageObj.onaborts) {
                cb();
            }
            messageObj?.onfinish?.();
            this.messageFree(messageObj);
        }, this.interactTimeout);


        //set data
        if (packetId === 0) {
            //first chunk
            messageObj.packetCount = packetCount;
        }
        messageObj.packets.set(packetId, data);
        //console.log(packetId, data);

        //trigger progress (answer for invoke, or incoming message)
        if (messageObj.isAnswer === true) {
            //start from 50%
            messageObj.progress = 0.5 + messageObj.packets.size / messageObj.packetCount / 2;
            messageObj.onprogress?.(messageObj.progress);
        } else {
            //start from 0%
            messageObj.progress = messageObj.packets.size / messageObj.packetCount;
            messageObj.onprogress?.(messageObj.progress);
        }


        //send ack
        const sendTime = (Date.now() + this.timeOffset) % 4294967295; //32 bit time
        const ack = new ArrayBuffer(11);
        const view = new DataView(ack);
        view.setUint32(view.byteLength - 5, sendTime);
        view.setUint32(view.byteLength - 9, messageId);
        if (isSplit) {
            view.setUint8(view.byteLength - 1, (isSplit ? 8 : 0));
            view.setUint16(view.byteLength - 11, packetId);
        }
        try {
            this.sender(ack, [ack], messageObj);
        } catch (e) {
            console.warn("Sender error", e);
            messageObj.error = this.ERROR.TRANSFER_SEND;
            for (const cb of messageObj.onaborts) {
                cb();
            }
            return;
        }

        //check finish
        if (messageObj.packetCount === messageObj.packets.size) {
            const firstPacket = messageObj.packets.get(0);
            if (firstPacket instanceof ArrayBuffer) {
                //calc max message size
                let size = 0;
                let packets = []; // (Map not ordered, need Array)
                packets.length = messageObj.packets.size;
                const it = messageObj.packets[Symbol.iterator]();
                for (const [key, value] of it) {
                    size += value.byteLength;
                    packets[key] = value;
                }
                const data = new Uint8Array(size);

                //copy packets data 
                let offset = 0;
                for (const packet of packets) {
                    data.set(new Uint8Array(packet), offset);
                    offset += packet.byteLength;
                }
                messageObj.data = data.buffer;
            } else {
                messageObj.data = firstPacket;
            }
            //console.log(new Uint8Array(messageObj.data))
            //console.log(messageObj.isAnswer);

            //callback (if new)
            if (messageObj.isInvoke) {
                messageObj.send = (msg, transfer, timeout=messageObj.timeout, options) => {
                    this.messageSet(messageObj, options, false);
                    messageObj.pending = this.sendRaw(messageObj, msg, transfer, timeout);
                    return messageObj;
                };
                messageObj.invoke = (msg, transfer, timeout=messageObj.timeout, options) => {
                    this.messageSet(messageObj, options, true);
                    messageObj.pending = this.invokeRaw(messageObj, msg, transfer, timeout);
                    return messageObj;
                };
                messageObj?.onfinish?.();
                if (messageObj.isAnswer) {
                    messageObj.oninvoke?.(messageObj);
                } else {
                    this.oninvoke?.(messageObj);
                }
            } else {
                messageObj?.onfinish?.();
                if (messageObj.isAnswer) {
                    messageObj.onsend?.(messageObj.data);
                } else {
                    this.onsend?.(messageObj.data);
                }
            }
            //callback
            this.messageFree(messageObj);
        }
    };

    onSend(cb) {
        this.onsend = cb;
        return this;
    };
    onInvoke(cb) {
        this.oninvoke = cb;
        return this;
    };
    onIncoming(cb) {
        this.onincoming = cb;
        return this;
    };

    

    messageCreate() {
        //get unique message id
        do {
            this.messageId = (this.messageId + 2) % 4294967294; // 32 bit-1
        } while (this.messages.has(this.messageId));
        const messageId = this.messageId;

        //setup object on the global stack
        const messageObj = new Message();

        messageObj.messageId = messageId;
        this.messages.set(messageId, messageObj);
        return messageObj;
    };
    messageSet(messageObj, options, isInvoke) {
        //set sending params
        let packetSize;
        let packetTimeout;
        let packetRetry;
        let sendThreads;
        if (typeof options === "object") {
            if ("packetSize" in options) {
                packetSize = options["packetSize"];
            }
            if ("packetTimeout" in options) {
                packetTimeout = options["packetTimeout"];
            }
            if ("packetRetry" in options) {
                packetRetry = options["packetRetry"];
            }
            if ("sendThreads" in options) {
                sendThreads = options["sendThreads"];
            }
        }
        if (packetSize === undefined) {
            packetSize = this.packetSize;
        }
        if (packetTimeout === undefined) {
            packetTimeout = this.packetTimeout;
        }
        if (packetRetry === undefined) {
            packetRetry = this.packetRetry;
        }
        if (sendThreads === undefined) {
            sendThreads = this.sendThreads;
        }
        messageObj.packetSize = packetSize;
        messageObj.packetTimeout = packetTimeout;
        messageObj.packetRetry = packetRetry;
        messageObj.sendThreads = sendThreads;

        //set invoke
        messageObj.isInvoke = isInvoke;

        //reset progress
        messageObj.packetCount = Infinity;
        messageObj.packetDone = 0;
        messageObj.packets = new Map();

        //set answer (if need)
        if (messageObj.messageId % 2 !== this.myReminder) {
            messageObj.isAnswer = true;
            messageObj.answerFor = messageObj.messageId;
            //get unique message id
            do {
                this.messageId = (this.messageId + 2) % 4294967294; // 32 bit-1
            } while (this.messages.has(this.messageId));
            const messageId = this.messageId;

            this.messages.delete(messageObj.messageId);
            messageObj.messageId = messageId;
            this.messages.set(messageObj.messageId, messageObj);
        }
    };
    async messageSend(messageObj, msg, transfer) {
        //initial interactivity
        const abort = () => {
            messageObj.error = this.ERROR.INACTIVE;
            for (const cb of messageObj.onaborts) {
                cb();
            }
        };
        clearTimeout(messageObj.interactTimeoutId);
        messageObj.interactTimeoutId = setTimeout(abort, this.interactTimeout);

        //message listener
        messageObj.onreceive = (isAbort, packetId) => {
            //no communication if error
            if (messageObj.error !== "") {
                return;
            }

            //update interactivity
            clearTimeout(messageObj.interactTimeoutId);
            messageObj.interactTimeoutId = setTimeout(abort, this.interactTimeout);

            //check abort
            if (isAbort) {
                messageObj.error = this.ERROR.REJECT;
                for (const cb of messageObj.onaborts) {
                    cb();
                }
                return;
            }

            //packet callback
            const cb = messageObj.onpackets.get(packetId);
            cb?.();
        };

        //setup flags
        const invokeFlag = (messageObj.isInvoke ? 4 : 0);
        const answerFlag = (messageObj.isAnswer ? 32 : 0);

        //sending
        if (msg instanceof ArrayBuffer) {
            //general data
            const packetSize = messageObj.packetSize;
            const threadCount = messageObj.sendThreads;
            let generalOverhead = 9; // mandatory header size (every packet)
            const answerOverhead = (messageObj.isAnswer ? 4 : 0); // answer header size

            if (msg.byteLength + generalOverhead + answerOverhead <= packetSize) {
                const data = new Uint8Array(msg.byteLength + generalOverhead + answerOverhead);
                //copy message
                data.set(new Uint8Array(msg), 0);
                //set headers
                const view = new DataView(data.buffer);
                view.setUint8(view.byteLength - 1, invokeFlag + answerFlag);
                view.setUint32(view.byteLength - 9, messageObj.messageId);
                if (messageObj.isAnswer) {
                    view.setUint32(view.byteLength - 13, messageObj.answerFor);
                }
                messageObj.packetCount = 1;
                //send
                await this.messageSendPacket(messageObj, data.buffer, [data.buffer], 0);

            } else {
                //queue logic
                let stack = new Map();
                let stackId = 0;
                const next = async function(stackId, fn) {
                    stack.set(stackId, fn);
                    await fn;
                    stack.delete(stackId);
                };
                const race = async function() {
                    return new Promise((resolve, reject) => {
                        const it = stack[Symbol.iterator]();
                        for (const [key, value] of it) {
                            value.then(resolve, reject);
                        }
                    });
                };

                //modify general header size (because split)
                const splitFlag = 8;
                generalOverhead += 2;
                const firstOverhead = 2;

                //calculate slice count (2 byte first header, 9 byte packet header, 2 byte split header)
                //first calculation (without answer headers)
                let wholeSize = msg.byteLength + firstOverhead;
                let packetCount = Math.ceil(wholeSize / (packetSize - generalOverhead));
                //calculate answer flags count
                let answerCount = Math.min(threadCount, packetCount);
                //update size and packet count (only increase)
                wholeSize += answerCount * answerOverhead; //answer headers size 
                packetCount = Math.ceil(wholeSize / (packetSize - generalOverhead));
                messageObj.packetCount = packetCount;
                answerCount = Math.min(threadCount, packetCount);

                let pos = 0;
                let size = packetSize - (generalOverhead + firstOverhead + answerOverhead)
                //first packet
                {
                    const data = new Uint8Array(packetSize);
                    //copy data
                    data.set(new Uint8Array(msg.slice(pos, pos + size)), 0);
                    pos += size;
                    //set headers
                    const view = new DataView(data.buffer);
                    view.setUint8(view.byteLength - 1, invokeFlag + answerFlag + splitFlag);
                    view.setUint32(view.byteLength - 9, messageObj.messageId);
                    view.setUint16(view.byteLength - 11, stackId);
                    view.setUint16(view.byteLength - 13, packetCount);
                    if (messageObj.isAnswer) {
                        view.setUint32(view.byteLength - 17, messageObj.answerFor);
                    }
                    //send
                    next(stackId, this.messageSendPacket(messageObj, data.buffer, [data.buffer], stackId));
                    stackId++;
                }

                //initial packets (until sendThreads full)
                size = packetSize - (generalOverhead + answerOverhead);
                while (stackId < answerCount && messageObj.error === "") {
                    const data = new Uint8Array(Math.min(size, msg.byteLength - pos) + generalOverhead + answerOverhead);
                    //copy data
                    data.set(new Uint8Array(msg.slice(pos, pos + size)), 0);
                    pos += size;
                    //set headers
                    const view = new DataView(data.buffer);
                    view.setUint8(view.byteLength - 1, invokeFlag + answerFlag + splitFlag);
                    view.setUint32(view.byteLength - 9, messageObj.messageId);
                    view.setUint16(view.byteLength - 11, stackId);
                    if (messageObj.isAnswer) {
                        view.setUint32(view.byteLength - 15, messageObj.answerFor);
                    }
                    //send
                    next(stackId, this.messageSendPacket(messageObj, data.buffer, [data.buffer], stackId));
                    stackId++;
                }
                await race();

                //other packets (wait for free thread)
                size = packetSize - generalOverhead;
                while (stackId < packetCount && messageObj.error === "") {
                    const data = new Uint8Array(Math.min(size, msg.byteLength - pos) + generalOverhead);
                    //copy data
                    data.set(new Uint8Array(msg.slice(pos, pos + size)), 0);
                    pos += size;
                    //set headers
                    const view = new DataView(data.buffer);
                    view.setUint8(view.byteLength - 1, invokeFlag + splitFlag);
                    view.setUint32(view.byteLength - 9, messageObj.messageId);
                    view.setUint16(view.byteLength - 11, stackId);
                    //send
                    next(stackId, this.messageSendPacket(messageObj, data.buffer, [data.buffer], stackId));
                    stackId++;
                    await race();
                }

                //wait the reamining packets
                while (stack.size !== 0 && messageObj.error === "") {
                    await race();
                }

            }
        } else {
            const data = [];
            //set headers
            data.push(invokeFlag + answerFlag);
            data.push(0);
            data.push(messageObj.messageId);
            if (messageObj.isAnswer) {
                data.push(messageObj.answerFor);
            }
            messageObj.packetCount = 1;
            //copy message
            data.push(msg);
            //send
            await this.messageSendPacket(messageObj, data, transfer, 0);
        }
    };
    async messageSendPacket(messageObj, msg, transfer, packetId) {
        //params
        const retry = messageObj.packetRetry;
        const patience = messageObj.packetTimeout;
        //start sending
        let trying = 0;
        await new Promise((resolve) => {
            //free from memory
            const free = async function() {
                //trigger progress
                messageObj.packetDone++;
                const divide = (messageObj.isInvoke ? 2 : 1);
                messageObj.progress = messageObj.packetDone / messageObj.packetCount / divide;
                messageObj.onprogress?.(messageObj.progress);

                //free references
                clearTimeout(interval);
                messageObj.onaborts.delete(abort);
                messageObj.onpackets.delete(packetId);
                resolve(undefined);
            };

            //success ack
            messageObj.onpackets.set(packetId, () => {
                free();
            });

            //abort
            const abort = () => {
                free();
            };
            messageObj.onaborts.add(abort);

            //send
            const sending = async () => {
                //abort if too much tries
                if (retry < trying) {
                    messageObj.error = this.ERROR.TRANSFER_RECEIVE;
                    for (const cb of messageObj.onaborts) {
                        cb();
                    }
                    return;
                }

                //try send
                trying++;
                const sendTime = (Date.now() + this.timeOffset) % 4294967295; //32 bit time
                if (msg instanceof ArrayBuffer) {
                    const view = new DataView(msg);
                    view.setUint32(view.byteLength - 5, sendTime);
                } else {
                    msg[1] = sendTime;
                }
                try {
                    await this.sender(msg, transfer, messageObj);
                } catch (e) {
                    messageObj.error = this.ERROR.TRANSFER_SEND;
                    for (const cb of messageObj.onaborts) {
                        cb();
                    }
                    return;
                }
            };
            const interval = setInterval(sending, patience);
            sending();
        });
    };
    async messageFree(messageObj) {
        //stop timers
        clearTimeout(messageObj.timeoutId);
        clearTimeout(messageObj.interactTimeoutId);

        //waiting stucked packets
        await new Promise((resolve) => {
            setTimeout(resolve, this.interactTimeout);
        });

        //free from global stack
        this.messages.delete(messageObj.messageId);
    };
};


//message instancce class, created by Communicator class
const Message = class {
    packetSize=1000;        // The maximum packet size in messaging in bytes.
    packetTimeout=2000;     // The maximum waiting time for packet in miliseconds.
    packetRetry=Infinity;   // The maximum retry attempts for packets.
    sendThreads=16;         // The maximum parallel packet trying number.

    onreceive = function() {};          // The callback function for receiving any packets.
    onpackets = new Map();              // Multiple callback functions for pending packets.
    onaborts = new Set();               // Multiple callback functions to broadcast abort event.
    onfinish = function() {};           // The callback function for finish state.
    onprogress = function(progress) {}; // The callback function for progress update.
    onincoming = function(message) {};  // The callback function for incoming message.
    onsend = function(data) {};         // The callback function for successfull incoming sending message.
    oninvoke = function(message) {};    // The callback function for successfull incoming invoke message.

    messageId;              // The unique id of the message.
    timeoutId = -1;         // The setTimeout number id for timeout mesure.
    interactTimeoutId = -1; // The setTimeout number id for interactivity (timeout between packets) mesure.

    isAnswer = false;       //Boolean to indicate that this message an remote answer or new locally created message.
    answerFor = 0;          //If the message is an answer, this will be the message id of the parent message.

    packetCount = Infinity; // The total packet count of the message.
    packetDone = 0;         // The total packet count of the message.
    packets = new Map();    // Incoming packet data in a map.
    pending;                // The sending or invoke promise.

    //public API
    progress = 0;   // The progress of the message in 0-1 range.
    error = "";     // The error message if any.
    data;           // The incoming data.
    isInvoke = false;   // True if message is invoke else the message is only send.

    send = undefined;
    invoke = undefined;
    onProgress(cb) {
        this.onprogress = cb;
        return this;
    };
    onIncoming(cb) {
        this.onincoming = cb;
        return this;
    };
    onSend(cb) {
        this.onsend = cb;
        return this;
    };
    onInvoke(cb) {
        this.oninvoke = cb;
        return this;
    };
    abort() {
        this.error = errors.ABORT;
        for (const cb of this.onaborts) {
            cb();
        }
        return this;
    };
    async wait() {
        await this.pending;
        return this;
    };
};


export default Communicator;
