"use strict";

const BrowserAudioEncoder = class {
    constructor() {
        // callbacks
        this.onConfiguration = null;
        this.onChunk = null;
        this.onEnd = null;

        // inner state
        this.error = 0;
        this.isRunning = false;

        // audio variables
        this.audioTrack = null;
        this.audioEncoder = null;
    };
    async start(config) {
        const displayMediaOptions = {
            "video": {
                "frameRate": {
                    "max": 1
                },
                "height": {
                    "max": 2
                },
                "width": {
                    "max": 2
                },
                "resizeMode": "crop-and-scale"
            },
            "audio": {
                "sampleRate": config["sampleRate"],
                "channelCount": config["numberOfChannels"]
            },
            "preferCurrentTab": false,
            "systemAudio": "include"
        };

        let captureStream = null;
        try {
            captureStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
        } catch (err) {
            console.error(`Error: ${err}`);
            throw err;
        }

        captureStream.getVideoTracks().forEach(track => track.stop());

        this.audioTrack = captureStream.getAudioTracks()[0];
        if (!this.audioTrack) {
            throw new Error("No audio track available");
        }

        this.isRunning = true;

        // Get actual audio settings
        const trackSettings = this.audioTrack.getSettings();
        console.log("Audio track settings:", trackSettings);

        this.audioEncoder = new AudioEncoder({
            "output": (chunk, metadata) => {
                if (metadata?.decoderConfig) {
                    this.onConfiguration(metadata.decoderConfig);
                }
                this.onChunk(chunk);
            },
            "error": (error) => {
                console.error("Audio encoder error:", error);
                this.error = 1;
                this.end();
            }
        });

        this.audioEncoder.configure(config);

        // Create MediaStreamTrackProcessor to get raw audio frames
        const processor = new MediaStreamTrackProcessor({
            "track": this.audioTrack
        });
        const reader = processor.readable.getReader();

        // Read and encode audio frames
        const encodeLoop = async () => {
            try {
                while (this.isRunning) {
                    const {value, done} = await reader.read();
                    if (done) {
                        break;
                    }
                    if (this.isRunning && value && this.audioEncoder.state === "configured") {
                        this.audioEncoder.encode(value);
                        value.close();
                    }
                }
            } catch (err) {
                console.error("Encoding loop error:", err);
                this.error = 1;
            } finally {
                this.end();
            }
        };
        encodeLoop();
    };
    async end() {
        if (this.isRunning === false) {
            return;
        }
        this.isRunning = false;
        if (this.audioEncoder && this.audioEncoder.state !== "closed") {
            try {
                if (this.audioEncoder.state === "configured") {
                    await this.audioEncoder.flush();
                }
                this.audioEncoder.close();
                this.audioTrack.stop();
            } catch (err) {
                console.error("Error closing audio encoder:", err);
            }
            this.audioEncoder = null;
        }
        this.onEnd(this.error);
    };
};

export {
    BrowserAudioEncoder
};
export default {
    BrowserAudioEncoder
};