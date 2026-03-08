"use strict";

const spawn = globalThis?.require("child_process").spawn;

const FFmpegProcess = class {
    constructor() {
        // callbacks
        this.onData = function(data) {};
        this.onEnd = function(error) {};
            
        // process state
        this.process = null;
        this.isRunning = false;
        this.error = 0;
    };

    async start(ffmpegPath, params) {
        // wait start
        await new Promise((resolve, reject) => {
            this.process = spawn("ffmpeg", params, {"cwd": ffmpegPath, "windowsVerbatimArguments": true});
            this.process.stderr.on("data", (data) => {
                console.error(`FFmpeg stderr: ${data}`);
            });
            const startResolver = (data) => {
                this.onData(data);
                this.isRunning = true;
                this.process.removeListener("close", startRejecter);
                resolve();
            };
            const startRejecter = (code) => {
                this.code = code;
                this.process.stdout.removeListener("data", startResolver);
                reject(new Error("FFmpeg process exited before starting." + code));
            };
            this.process.stdout.once("data", startResolver);
            this.process.once("close", startRejecter);
        });

        // create permanent listeners
        this.process.stdout.on("data", this.onData);
        this.process.stderr.on("data", (data) => {
            //console.error(`FFmpeg stderr: ${data}`);
        });
        this.process.on("close", (code) => {
            this.error = code;
            this.end();
        });
    };

    async end() {
        if (this.isRunning === false) {
            return;
        }
        this.isRunning = false;
        if (this.process.exitCode === null) {
            this.process.removeAllListeners("close");
            await new Promise((resolve) => {
                this.process.once("close", () => {
                    resolve();
                });
                this.process.kill("SIGINT");
            });
            this.process = null;
        }
        this.onEnd(this.error);
    };
};


const FFmpegAudioEncoder = class {
    constructor() {
        // callbacks
        this.onConfiguration = null;
        this.onChunk = null;
        this.onEnd = null;

        // inner state
        this.process = null;
        this.error = 0;
        this.isRunning = false;
        this.decoderConfig = {};
        this.data = new Uint8Array(0);
        this.parserState = {};
    };

    findBox(data, type) {
        for (let i = 0; i < data.length - 4; i++) {
            if (String.fromCharCode(data[i], data[i + 1], data[i + 2], data[i + 3]) === type) {
                return i - 4;
            }
        }
        return -1;
    };


    appendData(data) {
        
    };

    appendDataDefault(data) {
        // Append incoming new data to buffer
        const newData = new Uint8Array(this.data.length + data.length);
        newData.set(this.data);
        newData.set(data, this.data.length);
        this.data = newData;

        // Detect container format from first few bytes
        if (this.data.length >= 4) {
            const magic = String.fromCharCode(this.data[0], this.data[1], this.data[2], this.data[3]);

            // Check for MP4/M4A
            if (magic === "ftyp" || (this.data.length >= 8 && this.data[4] === 0x66 && this.data[5] === 0x74 && this.data[6] === 0x79 && this.data[7] === 0x70)) {
                console.log("Detected audio container: MP4");
                this.parserState = {
                    "frameDuration": 1_000_000 / 48,
                    "timestamp": 0,
                    "baseMediaDecodeTime": 0,
                    "sampleDuration": 0
                };
                this.appendData = this.appendDataMP4;
                this.onConfiguration(this.decoderConfig);
                this.appendData(new Uint8Array(0)); // Process existing buffer
                return;
            }
            // Check for WebM
            else if (this.data[0] === 0x1A && this.data[1] === 0x45 && this.data[2] === 0xDF && this.data[3] === 0xA3) {
                console.log("Detected audio container: WebM");
                this.parserState = {
                    "timecodeScale": 1000000, // Default: 1ms in nanoseconds
                    "clusterTimecode": 0,
                    "sampleRate": 48000
                };
                this.appendData = this.appendDataWebM;
                this.onConfiguration(this.decoderConfig);
                this.appendData(new Uint8Array(0)); // Process existing buffer
                return;
            }
            // Check for Ogg
            else if (magic === "OggS") {
                console.log("Detected audio container: Ogg");
                this.parserState = {
                    "timestamp": 0,
                    "sampleRate": 48000,
                    "granulePosition": 0
                };
                this.appendData = this.appendDataOgg;
                this.appendData(new Uint8Array(0)); // Process existing buffer
                return;
            }
            // Check for MP3 (ID3 tag or sync frame)
            else if (magic.startsWith("ID3") || (this.data[0] === 0xFF && (this.data[1] & 0xE0) === 0xE0)) {
                console.log("Detected audio container: MP3");
                this.parserState = {
                    "offset": 0,
                    "timestamp": 0,
                    "sampleRate": 44100,
                    "skipID3": true
                };
                this.appendData = this.appendDataMP3;
                this.onConfiguration(this.decoderConfig);
                this.appendData(new Uint8Array(0)); // Process existing buffer
                return;
            } else {
                console.log("Unknown audio container format.");
                this.error = 1;
                this.end();
            }
        }
    };

    appendDataMP4(data) {
        // Append incoming new data to buffer
        const newData = new Uint8Array(this.data.length + data.length);
        newData.set(this.data);
        newData.set(data, this.data.length);
        this.data = newData;

        // Process MP4 boxes
        while (this.data.length >= 8) {
            const view = new DataView(this.data.buffer, this.data.byteOffset);

            const boxType = String.fromCharCode(this.data[4], this.data[5], this.data[6], this.data[7]);

            if (boxType !== "moof" && boxType !== "mdat" && boxType !== "moov" && boxType !== "ftyp" && boxType !== "styp") {
                this.data = this.data.slice(8);
                continue;
            }

            const boxSize = view.getUint32(0);

            if (boxSize === 0 || boxSize > this.data.length) {
                break;
            }

            const boxData = this.data.slice(0, boxSize);
            this.data = this.data.slice(boxSize);

            if (boxType === "ftyp" || boxType === "styp") {
                // Skip file type box
                //console.log(`Skipping ${boxType} box`);
            } else if (boxType === "moof") {
                // Extract base media decode time from tfdt
                const tfdtPos = this.findBox(boxData, "tfdt");
                if (tfdtPos !== -1) {
                    const tfdtBox = boxData.slice(tfdtPos);
                    const tfdtView = new DataView(tfdtBox.buffer, tfdtBox.byteOffset);
                    const version = tfdtView.getUint8(8);

                    if (version === 0) {
                        this.parserState.baseMediaDecodeTime = tfdtView.getUint32(12);
                    } else if (version === 1) {
                        this.parserState.baseMediaDecodeTime = Number(tfdtView.getBigUint64(12));
                    }
                }

                // Extract sample duration from trun
                const trunPos = this.findBox(boxData, "trun");
                if (trunPos !== -1) {
                    const trunBox = boxData.slice(trunPos);
                    const trunView = new DataView(trunBox.buffer, trunBox.byteOffset);
                    const flags = trunView.getUint32(8) & 0x00FFFFFF;

                    let offset = 16;
                    if (flags & 0x000001) offset += 4;
                    if (flags & 0x000004) offset += 4;

                    // Extract sample duration if present (flag 0x000100)
                    if (flags & 0x000100) {
                        this.parserState.sampleDuration = trunView.getUint32(offset);
                    }

                    // For audio, typically 44100 or 48000 Hz timescale
                    this.parserState.timestamp = Math.floor((this.parserState.baseMediaDecodeTime / 48000) * 1_000_000);
                }
            } else if (boxType === "mdat") {
                if (this.parserState.timestamp >= 0) {
                    const chunk = new EncodedAudioChunk({
                        "type": "key",
                        "timestamp": this.parserState.timestamp,
                        "duration": this.parserState.sampleDuration > 0 ? Math.floor((this.parserState.sampleDuration / 48000) * 1_000_000) : this.parserState.frameDuration,
                        "data": boxData.slice(8)
                    });
                    this.onChunk(chunk);
                }
            }
        }
    };

    appendDataWebM(data) {
        // Append incoming new data to buffer
        const newData = new Uint8Array(this.data.length + data.length);
        newData.set(this.data);
        newData.set(data, this.data.length);
        this.data = newData;

        // Process EBML elements
        while (this.data.length >= 2) {
            // Read EBML element ID
            let idLength = 1;
            const firstIdByte = this.data[0];
            if ((firstIdByte & 0x80) === 0x80) idLength = 1;
            else if ((firstIdByte & 0xC0) === 0x40) idLength = 2;
            else if ((firstIdByte & 0xE0) === 0x20) idLength = 3;
            else if ((firstIdByte & 0xF0) === 0x10) idLength = 4;
            else break;
            if (idLength > this.data.length) break;

            let elementId = 0;
            for (let i = 0; i < idLength; i++) {
                elementId = (elementId << 8) | this.data[i];
            }

            // Read EBML variable-size integer (element size)
            if (idLength >= this.data.length) break;
            const firstSizeByte = this.data[idLength];
            let sizeLength = 1;
            let sizeMask = 0x80;
            while (sizeLength <= 8 && !(firstSizeByte & sizeMask)) {
                sizeLength++;
                sizeMask >>= 1;
            }
            if (sizeLength > 8 || idLength + sizeLength > this.data.length) break;

            let elementSize = firstSizeByte & (sizeMask - 1);
            for (let i = 1; i < sizeLength; i++) {
                elementSize = (elementSize << 8) | this.data[idLength + i];
            }

            const headerSize = idLength + sizeLength;

            // Handle container elements (don't need full size)
            const containerIds = [0x18538067, 0x1F43B675, 0x1654AE6B, 0x1549A966, 0xAE]; // Segment, Cluster, Tracks, Info, TrackEntry
            if (containerIds.includes(elementId)) {
                this.data = this.data.slice(headerSize);
                continue;
            }

            // For non-container elements, wait for complete data
            if (headerSize + elementSize > this.data.length) {
                break;
            }

            const elementData = this.data.slice(headerSize, headerSize + elementSize);

            // Handle specific elements
            switch (elementId) {
                case 0x1A45DFA3: // EBML Header - skip
                    break;

                case 0x2AD7B1: // TimecodeScale
                    this.parserState.timecodeScale = 0;
                    for (let i = 0; i < elementData.length; i++) {
                        this.parserState.timecodeScale = (this.parserState.timecodeScale << 8) | elementData[i];
                    }
                    break;

                case 0xE7: // Cluster Timecode
                    this.parserState.clusterTimecode = 0;
                    for (let i = 0; i < elementData.length; i++) {
                        this.parserState.clusterTimecode = (this.parserState.clusterTimecode << 8) | elementData[i];
                    }
                    break;

                case 0xA3: // SimpleBlock
                case 0xA1: // Block
                    if (elementData.length >= 4) {
                        // Read track number (VINT)
                        const firstTrackByte = elementData[0];
                        let trackLength = 1;
                        let trackMask = 0x80;
                        while (trackLength <= 8 && !(firstTrackByte & trackMask)) {
                            trackLength++;
                            trackMask >>= 1;
                        }
                        if (trackLength <= 8 && trackLength < elementData.length) {
                            const blockOffset = trackLength;
                            const relativeTimecode = (elementData[blockOffset] << 8) | elementData[blockOffset + 1];
                            const signedTimecode = relativeTimecode > 32767 ? relativeTimecode - 65536 : relativeTimecode;

                            const absoluteTimecode = this.parserState.clusterTimecode + signedTimecode;
                            const timestamp = Math.floor((absoluteTimecode * this.parserState.timecodeScale) / 1000);

                            const frameData = elementData.slice(blockOffset + 3);

                            if (frameData.length > 0) {
                                const chunk = new EncodedAudioChunk({
                                    "type": "key",
                                    "timestamp": timestamp,
                                    "duration": Math.floor(1_000_000 * 1024 / this.parserState.sampleRate),
                                    "data": frameData
                                });
                                this.onChunk(chunk);
                            }
                        }
                    }
                    break;
            }

            this.data = this.data.slice(headerSize + elementSize);
        }
    };

    appendDataOgg(data) {
        // Append incoming new data to buffer
        const newData = new Uint8Array(this.data.length + data.length);
        newData.set(this.data);
        newData.set(data, this.data.length);
        this.data = newData;

        // Process Ogg pages
        while (this.data.length >= 27) {
            // Check for OggS capture pattern
            if (this.data[0] !== 0x4F || this.data[1] !== 0x67 || 
                this.data[2] !== 0x67 || this.data[3] !== 0x53) {
                // Not at page boundary, try to find next page
                let found = false;
                for (let i = 1; i < this.data.length - 3; i++) {
                    if (this.data[i] === 0x4F && this.data[i + 1] === 0x67 &&
                        this.data[i + 2] === 0x67 && this.data[i + 3] === 0x53) {
                        this.data = this.data.slice(i);
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    this.data = this.data.slice(this.data.length - 3);
                    break;
                }
                continue;
            }

            const headerTypeFlags = this.data[5];
            const isContinuation = (headerTypeFlags & 0x01) !== 0;
            const isBOS = (headerTypeFlags & 0x02) !== 0;

            // Read granule position (64-bit little-endian)
            const view = new DataView(this.data.buffer, this.data.byteOffset);
            const granuleLow = view.getUint32(6, true);
            const granuleHigh = view.getInt32(10, true);
            const granulePosition = granuleHigh * 0x100000000 + granuleLow;

            const numSegments = this.data[26];

            if (this.data.length < 27 + numSegments) {
                break;
            }

            let payloadSize = 0;
            for (let i = 0; i < numSegments; i++) {
                payloadSize += this.data[27 + i];
            }

            const pageSize = 27 + numSegments + payloadSize;

            if (this.data.length < pageSize) {
                break;
            }

            const payload = this.data.slice(27 + numSegments, pageSize);
            this.data = this.data.slice(pageSize);

            // Handle BOS pages (codec headers)
            if (isBOS) {
                // Check for Opus header (OpusHead)
                if (payload.length >= 19 && 
                    payload[0] === 0x4F && payload[1] === 0x70 && 
                    payload[2] === 0x75 && payload[3] === 0x73 &&
                    payload[4] === 0x48 && payload[5] === 0x65 &&
                    payload[6] === 0x61 && payload[7] === 0x64) {
                    // OpusHead structure:
                    // 0-7: "OpusHead"
                    // 8: version
                    // 9: channel count
                    // 10-11: pre-skip (little-endian)
                    // 12-15: input sample rate (little-endian) - informational only
                    // 16-17: output gain
                    // 18: channel mapping family
                    const channels = payload[9];
                    const preSkip = payload[10] | (payload[11] << 8);
                    
                    // Opus always decodes at 48000 Hz
                    this.parserState.sampleRate = 48000;
                    this.parserState.preSkip = preSkip;
                    this.parserState.channels = channels;
                    
                    // Update decoder config and emit configuration
                    this.decoderConfig.codec = "opus";
                    this.decoderConfig.sampleRate = 48000;
                    this.decoderConfig.numberOfChannels = channels;
                    this.decoderConfig.description = payload; // OpusHead as description
                    this.onConfiguration(this.decoderConfig);
                }
                // Check for Vorbis header
                else if (payload.length >= 30 &&
                        payload[0] === 0x01 &&
                        payload[1] === 0x76 && payload[2] === 0x6F &&
                        payload[3] === 0x72 && payload[4] === 0x62 &&
                        payload[5] === 0x69 && payload[6] === 0x73) {
                    // Vorbis identification header
                    const channels = payload[11];
                    const sampleRate = payload[12] | (payload[13] << 8) |
                                    (payload[14] << 16) | (payload[15] << 24);
                    
                    this.parserState.sampleRate = sampleRate;
                    this.parserState.channels = channels;
                    
                    this.decoderConfig.codec = "vorbis";
                    this.decoderConfig.sampleRate = sampleRate;
                    this.decoderConfig.numberOfChannels = channels;
                    this.decoderConfig.description = payload;
                    this.onConfiguration(this.decoderConfig);
                }
                continue;
            }

            // Skip comment header pages
            if (payload.length >= 8) {
                if ((payload[0] === 0x4F && payload[1] === 0x70 && 
                    payload[2] === 0x75 && payload[3] === 0x73 &&
                    payload[4] === 0x54 && payload[5] === 0x61 &&
                    payload[6] === 0x67 && payload[7] === 0x73) ||
                    (payload[0] === 0x03 && 
                    payload[1] === 0x76 && payload[2] === 0x6F &&
                    payload[3] === 0x72 && payload[4] === 0x62 &&
                    payload[5] === 0x69 && payload[6] === 0x73)) {
                    continue;
                }
            }

            // Skip if granule position is -1 (no valid timestamp)
            if (granulePosition < 0) {
                continue;
            }

            // For Opus, granule position represents samples at 48kHz
            // Subtract pre-skip for accurate timestamp
            const adjustedGranule = Math.max(0, granulePosition - (this.parserState.preSkip || 0));
            const timestamp = Math.floor((adjustedGranule / this.parserState.sampleRate) * 1_000_000);

            // Calculate duration
            const prevGranule = Math.max(0, this.parserState.granulePosition - (this.parserState.preSkip || 0));
            const duration = adjustedGranule > prevGranule
                ? Math.floor(((adjustedGranule - prevGranule) / this.parserState.sampleRate) * 1_000_000)
                : Math.floor(1_000_000 * 960 / this.parserState.sampleRate);

            this.parserState.granulePosition = granulePosition;

            if (payload.length > 0 && !isContinuation) {
                const chunk = new EncodedAudioChunk({
                    "type": "key",
                    "timestamp": timestamp,
                    "duration": duration,
                    "data": payload
                });
                this.onChunk(chunk);
            }
        }
    };

    appendDataMP3(data) {
        // Append incoming new data to buffer
        const newData = new Uint8Array(this.data.length + data.length);
        newData.set(this.data);
        newData.set(data, this.data.length);
        this.data = newData;

        // Skip ID3 tags at the beginning
        if (this.parserState.skipID3 && this.data.length >= 10) {
            const magic = String.fromCharCode(this.data[0], this.data[1], this.data[2]);
            if (magic === "ID3") {
                // ID3v2 tag size is at bytes 6-9 (synchsafe integer)
                const tagSize = ((this.data[6] & 0x7F) << 21) |
                               ((this.data[7] & 0x7F) << 14) |
                               ((this.data[8] & 0x7F) << 7) |
                               (this.data[9] & 0x7F);
                const totalTagSize = 10 + tagSize; // Header + tag data
                
                if (this.data.length >= totalTagSize) {
                    this.data = this.data.slice(totalTagSize);
                    this.parserState.skipID3 = false;
                } else {
                    return; // Wait for more data
                }
            } else {
                this.parserState.skipID3 = false;
            }
        }

        while (this.data.length >= 4) {
            // Look for MP3 sync word (11 bits set)
            if (this.data[0] !== 0xFF || (this.data[1] & 0xE0) !== 0xE0) {
                this.data = this.data.slice(1);
                continue;
            }

            // Parse MP3 frame header
            const version = (this.data[1] >> 3) & 0x03;
            const layer = (this.data[1] >> 1) & 0x03;
            const bitrateIndex = (this.data[2] >> 4) & 0x0F;
            const sampleRateIndex = (this.data[2] >> 2) & 0x03;
            const padding = (this.data[2] >> 1) & 0x01;

            // Calculate frame size
            const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
            const sampleRates = [44100, 48000, 32000];
            
            if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
                this.data = this.data.slice(1);
                continue;
            }

            const bitrate = bitrates[bitrateIndex] * 1000;
            const sampleRate = sampleRates[sampleRateIndex];
            const frameSize = Math.floor((144 * bitrate) / sampleRate) + padding;

            if (this.data.length < frameSize) {
                break; // Wait for complete frame
            }

            // Extract frame data
            const frameData = this.data.slice(0, frameSize);
            this.data = this.data.slice(frameSize);

            // Calculate duration (MP3 frame = 1152 samples)
            const frameDuration = Math.floor((1152 / sampleRate) * 1_000_000);

            const chunk = new EncodedAudioChunk({
                "type": "key",
                "timestamp": this.parserState.timestamp,
                "duration": frameDuration,
                "data": frameData
            });

            this.onChunk(chunk);
            this.parserState.timestamp += frameDuration;
        }

    };

    async start(ffmpegPath, params, decoderConfig) {
        if (this.isRunning === true) {
            throw new Error("FFmpegAudioEncoder is already running.");
        }

        // reset state
        this.error = 0;
        this.data = new Uint8Array(0);
        this.appendData = this.appendDataDefault;
        this.decoderConfig = decoderConfig;

        // start process
        this.process = new FFmpegProcess();
        this.process.onData = (data) => {
            this.appendData(data);
        };
        this.process.onEnd = (error) => {
            this.error = error;
            this.end();
        };
        await this.process.start(ffmpegPath, params);
        this.isRunning = true;
    };

    async end() {
        if (this.isRunning === false) {
            return;
        }
        this.isRunning = false;
        if (this.process && this.process.isRunning) {
            await this.process.end();
        }
        this.data = new Uint8Array(0);
        this.appendData = this.appendDataDefault;
        this.onEnd(this.error);
    };
};


const FFmpegVideoEncoder = class {
    constructor() {
        // callbacks
        this.onConfiguration = null;
        this.onChunk = null;
        this.onEnd = null;

        // inner state
        this.process = null;
        this.error = 0;
        this.isRunning = false;
        this.decoderConfig = {};
        this.data = new Uint8Array(0);
        this.parserState = {};
    };

    findBox(data, type) {
        for (let i = 0; i < data.length - 4; i++) {
            if (String.fromCharCode(data[i], data[i + 1], data[i + 2], data[i + 3]) === type) {
                return i - 4;
            }
        }
        return -1;
    };

    appendData(data) {

    };

    appendDataDefault(data) {
        // Append incoming new data to buffer
        const newData = new Uint8Array(this.data.length + data.length);
        newData.set(this.data);
        newData.set(data, this.data.length);
        this.data = newData;

        // Detect container format from first few bytes
        if (this.data.length >= 4) {
            const magic = String.fromCharCode(this.data[0], this.data[1], this.data[2], this.data[3]);

            // Check for MP4/M4A
            if (magic === "ftyp" || (this.data.length >= 8 && this.data[4] === 0x66 && this.data[5] === 0x74 && this.data[6] === 0x79 && this.data[7] === 0x70)) {
                console.log("Detected container format: MP4");
                this.parserState = {
                    "isKeyframe": false,
                    "frameDuration": 1_000_000 / 48,
                    "timestamp": 0,
                    "baseMediaDecodeTime": 0,
                    "sampleDuration": 0
                };
                this.appendData = this.appendDataMP4;
                this.appendData(new Uint8Array(0)); // Process existing buffer
                return;
            }
            // Check for WebM
            else if (this.data[0] === 0x1A && this.data[1] === 0x45 && this.data[2] === 0xDF && this.data[3] === 0xA3) {
                console.log("Detected container format: WebM");
                this.parserState = {
                    "offset": 0,
                    "clusterTimecode": 0,
                    "codecPrivate": null,
                    "timecodeScale": 1000000,
                    "isKeyframe": true,
                    "configurationSent": false  // Track if onConfiguration has been called
                };
                this.appendData = this.appendDataWebM;
                this.appendData(new Uint8Array(0)); // Process existing buffer
                return;
            }
            // Check for Ogg
            else if (magic === "OggS") {
                console.log("Detected container format: Ogg");
                this.parserState = {
                    "offset": 0,
                    "granulePosition": 0
                };
                this.appendData = this.appendDataOgg;
                this.appendData(new Uint8Array(0)); // Process existing buffer
                return;
            } else {
                this.error = 1;
                this.end();
            }
        }
    };

    appendDataMP4(data) {
        // Append incoming new data to buffer
        const newData = new Uint8Array(this.data.length + data.length);
        newData.set(this.data);
        newData.set(data, this.data.length);
        this.data = newData;

        // Try to parse complete boxes (multiple boxes may be present)
        while (this.data.length >= 8) {
            // get next box
            const view = new DataView(this.data.buffer);

            const boxType = String.fromCharCode(
                this.data[4], this.data[5],
                this.data[6], this.data[7]
            );

            if (boxType !== "moof" && boxType !== "mdat" && boxType !== "moov") {
                // Unknown box, skip 1 byte and continue
                this.data = this.data.slice(7);
                continue;
            }

            const boxSize = view.getUint32(0);
            //console.log(`Found box: ${boxType} (size: ${boxSize})`);

            if (boxSize === 0 || boxSize > this.data.length) {
                //console.log("Waiting for more data...");
                break;
            }

            const boxData = this.data.slice(0, boxSize);
            this.data = this.data.slice(boxSize);

            // Handle different box types
            if (boxType === "moof") {
                this.parserState.isKeyframe = false;

                // Extract base media decode time from tfdt (Track Fragment Decode Time)
                const tfdtPos = this.findBox(boxData, "tfdt");
                if (tfdtPos !== -1) {
                    const tfdtBox = boxData.slice(tfdtPos);
                    const tfdtView = new DataView(tfdtBox.buffer);
                    const version = tfdtView.getUint8(8);

                    if (version === 0) {
                        this.parserState.baseMediaDecodeTime = tfdtView.getUint32(12);
                    } else if (version === 1) {
                        this.parserState.baseMediaDecodeTime = Number(tfdtView.getBigUint64(12));
                    }
                }

                // Extract sample info from trun
                const trunPos = this.findBox(boxData, "trun");
                if (trunPos !== -1) {
                    const trunBox = boxData.slice(trunPos);
                    const trunView = new DataView(trunBox.buffer);

                    // trun box: 4 bytes size + 4 bytes type + 1 byte version + 3 bytes flags
                    const flags = trunView.getUint32(8) & 0x00FFFFFF;
                    //const sampleCount = trunView.getUint32(12);

                    let offset = 16;

                    // Skip data-offset if present (flag 0x000001)
                    if (flags & 0x000001) offset += 4;

                    // Check first-sample-flags (flag 0x000004)
                    if (flags & 0x000004) {
                        const firstSampleFlags = trunView.getUint32(offset);
                        this.parserState.isKeyframe = ((firstSampleFlags >> 24) & 0x03) === 2;
                        offset += 4;
                    } else {
                        // If no first-sample-flags, check tfhd default-sample-flags
                        const tfhdPos = this.findBox(boxData, "tfhd");
                        if (tfhdPos !== -1) {
                            const tfhdBox = boxData.slice(tfhdPos);
                            const tfhdView = new DataView(tfhdBox.buffer);
                            const tfhdFlags = tfhdView.getUint32(8) & 0x00FFFFFF;

                            // Check if default-sample-flags present (flag 0x000020)
                            if (tfhdFlags & 0x000020) {
                                let tfhdOffset = 16; // After track_ID

                                // Skip base-data-offset if present (flag 0x000001)
                                if (tfhdFlags & 0x000001) tfhdOffset += 8;
                                // Skip sample-description-index if present (flag 0x000002)
                                if (tfhdFlags & 0x000002) tfhdOffset += 4;
                                // Skip default-sample-duration if present (flag 0x000008)
                                if (tfhdFlags & 0x000008) tfhdOffset += 4;
                                // Skip default-sample-size if present (flag 0x000010)
                                if (tfhdFlags & 0x000010) tfhdOffset += 4;

                                // Now read default-sample-flags
                                const defaultSampleFlags = tfhdView.getUint32(tfhdOffset);
                                this.parserState.isKeyframe = ((defaultSampleFlags >> 24) & 0x03) === 2;
                            }
                        }
                    }

                    // Extract sample duration if present (flag 0x000100)
                    if (flags & 0x000100) {
                        this.parserState.sampleDuration = trunView.getUint32(offset);
                    }

                    // Calculate timestamp from base time (in timescale units, convert to microseconds)
                    // Assuming timescale of 90000 (common for video)
                    this.parserState.timestamp = Math.floor((this.parserState.baseMediaDecodeTime / 90000) * 1_000_000);
                }
            } else if (boxType === "mdat") {
                // Handle mdat - decode frame
                // Only process if we have valid timing info
                if (this.parserState.timestamp >= 0) {
                    const chunk = new EncodedVideoChunk({
                        "type": this.parserState.isKeyframe ? "key" : "delta", // "key",
                        "timestamp": this.parserState.timestamp,
                        "duration": this.parserState.sampleDuration > 0 ? Math.floor((this.parserState.sampleDuration / 90000) * 1_000_000) : this.parserState.frameDuration,
                        "data": boxData.slice(8)
                    });
                    this.onChunk(chunk);
                } else {
                    console.warn("Skipping mdat without valid timestamp");
                }
            } else if (boxType === "moov") {
                const avcCPos = this.findBox(boxData, "avcC");
                if (avcCPos !== -1) {
                    const avcC = boxData.slice(avcCPos);
                    this.decoderConfig.description = avcC.slice(8);
                    this.onConfiguration(this.decoderConfig);
                }
            }
        }
    };

    appendDataWebM(data) {
        // Append incoming new data to buffer
        const newData = new Uint8Array(this.data.length + data.length);
        newData.set(this.data);
        newData.set(data, this.data.length);
        this.data = newData;

        // Process EBML elements
        while (this.data.length >= 2) {
            // Read EBML element ID
            let idLength = 1;
            const firstIdByte = this.data[0];
            if ((firstIdByte & 0x80) === 0x80) idLength = 1;
            else if ((firstIdByte & 0xC0) === 0x40) idLength = 2;
            else if ((firstIdByte & 0xE0) === 0x20) idLength = 3;
            else if ((firstIdByte & 0xF0) === 0x10) idLength = 4;
            else break;
            if (idLength > this.data.length) break;

            let elementId = 0;
            for (let i = 0; i < idLength; i++) {
                elementId = (elementId << 8) | this.data[i];
            }

            // Read EBML variable-size integer (element size)
            if (idLength >= this.data.length) break;
            const firstSizeByte = this.data[idLength];
            let sizeLength = 1;
            let sizeMask = 0x80;
            while (sizeLength <= 8 && !(firstSizeByte & sizeMask)) {
                sizeLength++;
                sizeMask >>= 1;
            }
            if (sizeLength > 8 || idLength + sizeLength > this.data.length) break;

            let elementSize = firstSizeByte & (sizeMask - 1);
            for (let i = 1; i < sizeLength; i++) {
                elementSize = (elementSize << 8) | this.data[idLength + i];
            }

            const headerSize = idLength + sizeLength;

            // Handle container elements (don't need full size)
            // Segment, Cluster, Tracks, Info, TrackEntry
            const containerIds = [0x18538067, 0x1F43B675, 0x1654AE6B, 0x1549A966, 0xAE];
            if (containerIds.includes(elementId)) {
                this.data = this.data.slice(headerSize);
                continue;
            }

            // For non-container elements, wait for complete data
            if (headerSize + elementSize > this.data.length) {
                break;
            }

            const elementData = this.data.slice(headerSize, headerSize + elementSize);

            // Handle specific elements
            switch (elementId) {
                case 0x1A45DFA3: // EBML Header - skip
                    break;

                case 0x2AD7B1: // TimecodeScale (nanoseconds per tick, default 1000000 = 1ms)
                    this.parserState.timecodeScale = 0;
                    for (let i = 0; i < elementData.length; i++) {
                        this.parserState.timecodeScale = (this.parserState.timecodeScale << 8) | elementData[i];
                    }
                    if (!this.parserState.timecodeScale) {
                        this.parserState.timecodeScale = 1000000; // Default 1ms
                    }
                    break;

                case 0xE7: // Cluster Timecode
                    this.parserState.clusterTimecode = 0;
                    for (let i = 0; i < elementData.length; i++) {
                        this.parserState.clusterTimecode = (this.parserState.clusterTimecode << 8) | elementData[i];
                    }
                    break;

                case 0x63A2: // CodecPrivate - contains decoder configuration
                    this.parserState.codecPrivate = elementData.slice();
                    this.decoderConfig.description = this.parserState.codecPrivate;
                    if (!this.parserState.configurationSent) {
                        this.parserState.configurationSent = true;
                        this.onConfiguration(this.decoderConfig);
                    }
                    break;

                case 0xA3: // SimpleBlock
                    // Trigger configuration before first chunk if not already sent
                    if (!this.parserState.configurationSent) {
                        this.parserState.configurationSent = true;
                        this.onConfiguration(this.decoderConfig);
                    }

                    if (elementData.length >= 4) {
                        // Read track number (VINT)
                        const firstTrackByte = elementData[0];
                        let trackLength = 1;
                        let trackMask = 0x80;
                        while (trackLength <= 8 && !(firstTrackByte & trackMask)) {
                            trackLength++;
                            trackMask >>= 1;
                        }

                        if (trackLength <= 8 && trackLength + 3 <= elementData.length) {
                            const blockOffset = trackLength;

                            // Read relative timecode (signed 16-bit)
                            const relativeTimecode = (elementData[blockOffset] << 8) | elementData[blockOffset + 1];
                            const signedTimecode = relativeTimecode > 32767 ? relativeTimecode - 65536 : relativeTimecode;

                            // Read flags byte
                            const flags = elementData[blockOffset + 2];
                            const isKeyframe = (flags & 0x80) !== 0; // Bit 7 = keyframe flag

                            // Calculate absolute timestamp in microseconds
                            const absoluteTimecode = this.parserState.clusterTimecode + signedTimecode;
                            const timecodeScale = this.parserState.timecodeScale || 1000000;
                            const timestamp = Math.floor((absoluteTimecode * timecodeScale) / 1000);

                            // Frame data starts after track number + timecode + flags
                            const frameData = elementData.slice(blockOffset + 3);

                            if (frameData.length > 0) {
                                const chunk = new EncodedVideoChunk({
                                    "type": isKeyframe ? "key" : "delta",
                                    "timestamp": timestamp,
                                    "data": frameData
                                });
                                this.onChunk(chunk);
                            }
                        }
                    }
                    break;

                case 0xA0: // BlockGroup - parse contents to find Block and ReferenceBlock
                    // Trigger configuration before first chunk if not already sent
                    if (!this.parserState.configurationSent) {
                        this.parserState.configurationSent = true;
                        this.onConfiguration(this.decoderConfig);
                    }

                    if (elementData.length >= 4) {
                        let isKeyframe = true; // Assume keyframe unless ReferenceBlock exists
                        let blockContent = null;
                        let blockTimestamp = 0;

                        // Parse BlockGroup children
                        let offset = 0;
                        while (offset < elementData.length - 1) {
                            // Read child element ID
                            let childIdLength = 1;
                            const childFirstIdByte = elementData[offset];
                            if ((childFirstIdByte & 0x80) === 0x80) childIdLength = 1;
                            else if ((childFirstIdByte & 0xC0) === 0x40) childIdLength = 2;
                            else if ((childFirstIdByte & 0xE0) === 0x20) childIdLength = 3;
                            else if ((childFirstIdByte & 0xF0) === 0x10) childIdLength = 4;
                            else break;
                            if (offset + childIdLength > elementData.length) break;

                            let childId = 0;
                            for (let i = 0; i < childIdLength; i++) {
                                childId = (childId << 8) | elementData[offset + i];
                            }

                            // Read child element size
                            if (offset + childIdLength >= elementData.length) break;
                            const childFirstSizeByte = elementData[offset + childIdLength];
                            let childSizeLength = 1;
                            let childSizeMask = 0x80;
                            while (childSizeLength <= 8 && !(childFirstSizeByte & childSizeMask)) {
                                childSizeLength++;
                                childSizeMask >>= 1;
                            }
                            if (childSizeLength > 8 || offset + childIdLength + childSizeLength > elementData.length) break;

                            let childSize = childFirstSizeByte & (childSizeMask - 1);
                            for (let i = 1; i < childSizeLength; i++) {
                                childSize = (childSize << 8) | elementData[offset + childIdLength + i];
                            }

                            const childHeaderSize = childIdLength + childSizeLength;
                            const childDataStart = offset + childHeaderSize;
                            const childDataEnd = childDataStart + childSize;

                            if (childDataEnd > elementData.length) break;

                            // Handle specific child elements
                            if (childId === 0xFB) { // ReferenceBlock - presence means not a keyframe
                                isKeyframe = false;
                            } else if (childId === 0xA1) { // Block
                                const blockData = elementData.slice(childDataStart, childDataEnd);
                                if (blockData.length >= 4) {
                                    // Read track number (VINT)
                                    const firstTrackByte = blockData[0];
                                    let trackLength = 1;
                                    let trackMask = 0x80;
                                    while (trackLength <= 8 && !(firstTrackByte & trackMask)) {
                                        trackLength++;
                                        trackMask >>= 1;
                                    }

                                    if (trackLength <= 8 && trackLength + 3 <= blockData.length) {
                                        const blockOffset = trackLength;

                                        // Read relative timecode (signed 16-bit)
                                        const relativeTimecode = (blockData[blockOffset] << 8) | blockData[blockOffset + 1];
                                        const signedTimecode = relativeTimecode > 32767 ? relativeTimecode - 65536 : relativeTimecode;

                                        // Calculate absolute timestamp in microseconds
                                        const absoluteTimecode = this.parserState.clusterTimecode + signedTimecode;
                                        const timecodeScale = this.parserState.timecodeScale || 1000000;
                                        blockTimestamp = Math.floor((absoluteTimecode * timecodeScale) / 1000);

                                        // Frame data starts after track number + timecode + flags
                                        blockContent = blockData.slice(blockOffset + 3);
                                    }
                                }
                            }

                            offset = childDataEnd;
                        }

                        // Create chunk after parsing entire BlockGroup
                        if (blockContent && blockContent.length > 0) {
                            const chunk = new EncodedVideoChunk({
                                "type": isKeyframe ? "key" : "delta",
                                "timestamp": blockTimestamp,
                                "data": blockContent
                            });
                            this.onChunk(chunk);
                        }
                    }
                    break;
            }

            this.data = this.data.slice(headerSize + elementSize);
        }
    };

    appendDataOgg(data) {

    };

    async start(ffmpegPath, params, decoderConfig) {
        if (this.isRunning === true) {
            throw new Error("FFmpegAudioEncoder is already running.");
        }

        // reset state
        this.error = 0;
        this.data = new Uint8Array(0);
        this.appendData = this.appendDataDefault;
        this.decoderConfig = decoderConfig;
        
        // start process
        this.process = new FFmpegProcess();
        this.process.onData = (data) => {
            this.appendData(data);
        };
        this.process.onEnd = (error => {
            this.error = error;
            this.end();
        });
        await this.process.start(ffmpegPath, params);
        this.isRunning = true;
    };

    async end() {
        if (this.isRunning === false) {
            return;
        }
        this.isRunning = false;
        if (this.process && this.process.isRunning) {
            await this.process.end();
        }
        this.data = new Uint8Array(0);
        this.appendData = this.appendDataDefault;
        this.onEnd(this.error);
    };

};



module.exports = {
    FFmpegAudioEncoder,
    FFmpegVideoEncoder
};