"use strict";



const Decoder = class {
    constructor(isAudio=true, isVideo=true) {
        if (!isAudio && !isVideo) {
            throw new Error("At least one of isAudio or isVideo must be true");
        }

        // callbacks
        this.onAudioFrame = null;
        this.onVideoFrame = null;
        this.onEnd = null;

        // inner state
        this.error = 0;
        this.isRunning = false;
        
        // decoders
        if (isAudio) {
            this.audioDecoder = null;
            this.audioConfiguration = null;
            this.wasAudioKeyframe = false;
            this._createAudioDecoder();
        }

        if (isVideo) {
            this.videoDecoder = null;
            this.videoConfiguration = null;
            this.wasVideoKeyframe = false;
            this._createVideoDecoder();
        }
    };

    // internal creation methods
    _createAudioDecoder = () => {
        this.audioDecoder = new AudioDecoder({
            "output": async (frame) => {
                await this.onAudioFrame(frame);
                frame.close();
            },
            "error": this._onAudioError
        });
        this.wasAudioKeyframe = false;
    };
    _onAudioError = (e) => {
        console.error("Audio decoder error:", e);
        this._createAudioDecoder();
        if (this.audioConfiguration !== null) {
            this.audioDecoder.configure(this.audioConfiguration);
        }
    };

    _createVideoDecoder() {
        this.videoDecoder = new VideoDecoder({
            "output": async (frame) => {
                await this.onVideoFrame(frame);
                frame.close();
            },
            "error": this._onVideoError
        });
        this.wasVideoKeyframe = false;
    };
    _onVideoError = (e) => {
        console.error("Video decoder error:", e);
        this._createVideoDecoder();
        if (this.videoConfiguration !== null) {
            this.videoDecoder.configure(this.videoConfiguration);
        }
    };

    // append methods
    appendAudioConfiguration(config) {
        if (this.audioDecoder.state !== "unconfigured") {
            this._createAudioDecoder();
        }
        this.audioConfiguration = config
        this.audioDecoder.configure(this.audioConfiguration);
    };
    appendAudioChunk(chunk) {
        if (this.audioDecoder.state !== "configured") {
            return;
        }
        if (!this.wasAudioKeyframe) {
            if (chunk.type === "delta") {
                return;
            } else {
                this.wasAudioKeyframe = true;
            }
        }
        this.audioDecoder.decode(chunk);

        return;
        if (chunk.type === "key") {
            console.log(`Audio keyframe at ${chunk.timestamp}`);
        } else if (chunk.type === "delta") {
            console.log(`Audio delta frame at ${chunk.timestamp}`);
        }
    };

    appendVideoConfiguration(config) {
        if (this.videoDecoder.state !== "unconfigured") {
            this._createVideoDecoder();
        }
        this.videoConfiguration = config
        this.videoDecoder.configure(this.videoConfiguration);
    };
    async appendVideoChunk(chunk) {
        if (this.videoDecoder.state !== "configured") {
            return;
        }
        if (this.wasVideoKeyframe === false) {
            if (chunk.type === "delta") {
                return;
            } else {
                await this.videoDecoder.flush();
                this.wasVideoKeyframe = true;
            }
        }
        this.videoDecoder.decode(chunk);

        return;
        if (chunk.type === "key") {
            console.log(`Keyframe at ${chunk.timestamp}`);
        } else if (chunk.type === "delta") {
            //console.log(`Delta frame at ${chunk.timestamp}`);
        }
    };
};

const Player = class {
    constructor(audioPlay=true, audioDrawCtx, videoDrawCtx) {
        this.videoDrawCtx = videoDrawCtx;
        this.audioDrawCtx = audioDrawCtx;
        this.audioPlay = audioPlay;

        this.audioCtx = new window.AudioContext();
        this.audioStartTime = this.audioCtx.currentTime;
        this.nextPlaybackTime = this.audioCtx.currentTime;

        if (this.audioDrawCtx) {
            const analyser = this.audioCtx.createAnalyser();
            analyser.fftSize = 1024;
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyser.getByteTimeDomainData(dataArray);
            const draw = () => {
                requestAnimationFrame(draw);

                analyser.getByteTimeDomainData(dataArray);

                this.audioDrawCtx.fillStyle = "rgb(200 200 200)";
                this.audioDrawCtx.fillRect(0, 0, this.audioDrawCtx.canvas.width, this.audioDrawCtx.canvas.height);

                this.audioDrawCtx.lineWidth = 2;
                this.audioDrawCtx.strokeStyle = "rgb(0 0 0)";

                this.audioDrawCtx.beginPath();

                const sliceWidth = (this.audioDrawCtx.canvas.width * 1.0) / bufferLength;
                let x = 0;

                for (let i = 0; i < bufferLength; i++) {
                    const v = dataArray[i] / 128.0;
                    const y = (v * this.audioDrawCtx.canvas.height) / 2;
                    if (i === 0) {
                        this.audioDrawCtx.moveTo(x, y);
                    } else {
                        this.audioDrawCtx.lineTo(x, y);
                    }
                    x += sliceWidth;
                }

                this.audioDrawCtx.lineTo(this.audioDrawCtx.canvas.width, this.audioDrawCtx.canvas.height / 2);
                this.audioDrawCtx.stroke();
            };
            draw();
            this.analyser = analyser;
        }
    };

    appendAudioFrame(frame) {
        // Convert AudioData to AudioBuffer
        const audioBuffer = this.audioCtx.createBuffer(
            frame.numberOfChannels,
            frame.numberOfFrames,
            frame.sampleRate
        );

        // Check the audio format
        const format = frame.format; // e.g., "f32", "f32-planar", "s16", "s16-planar", "u8", "u8-planar"
        if (format.endsWith("-planar")) {
            // Planar format - each channel is in a separate plane
            const baseFormat = format.replace("-planar", "");
            for (let channel = 0; channel < frame.numberOfChannels; channel++) {
                const channelData = new Float32Array(frame.numberOfFrames);
                
                if (baseFormat === "f32") {
                    frame.copyTo(channelData, { "planeIndex": channel });
                } else if (baseFormat === "s16") {
                    const rawData = new Int16Array(frame.numberOfFrames);
                    frame.copyTo(rawData, { "planeIndex": channel });
                    for (let i = 0; i < frame.numberOfFrames; i++) {
                        channelData[i] = rawData[i] / 32768.0;
                    }
                } else if (baseFormat === "s32") {
                    const rawData = new Int32Array(frame.numberOfFrames);
                    frame.copyTo(rawData, { "planeIndex": channel });
                    for (let i = 0; i < frame.numberOfFrames; i++) {
                        channelData[i] = rawData[i] / 2147483648.0;
                    }
                } else if (baseFormat === "u8") {
                    const rawData = new Uint8Array(frame.numberOfFrames);
                    frame.copyTo(rawData, { "planeIndex": channel });
                    for (let i = 0; i < frame.numberOfFrames; i++) {
                        // Convert U8 (0-255, center at 128) to Float32 (-1.0 to 1.0)
                        channelData[i] = (rawData[i] - 128) / 128.0;
                    }
                }
                
                audioBuffer.copyToChannel(channelData, channel);
            }
        } else {
            // Interleaved format - all channels are interleaved in plane 0
            const totalSamples = frame.numberOfFrames * frame.numberOfChannels;
                
            if (format === "f32") {
                // Float32 interleaved
                const interleaved = new Float32Array(totalSamples);
                frame.copyTo(interleaved, { "planeIndex": 0 });
                
                for (let channel = 0; channel < frame.numberOfChannels; channel++) {
                    const channelData = new Float32Array(frame.numberOfFrames);
                    for (let i = 0; i < frame.numberOfFrames; i++) {
                        channelData[i] = interleaved[i * frame.numberOfChannels + channel];
                    }
                    audioBuffer.copyToChannel(channelData, channel);
                }
            } else if (format === "s16") {
                // Int16 interleaved - need to convert to float
                const interleaved = new Int16Array(totalSamples);
                frame.copyTo(interleaved, { "planeIndex": 0 });
                
                for (let channel = 0; channel < frame.numberOfChannels; channel++) {
                    const channelData = new Float32Array(frame.numberOfFrames);
                    for (let i = 0; i < frame.numberOfFrames; i++) {
                        // Convert Int16 to Float32 (-1.0 to 1.0)
                        channelData[i] = interleaved[i * frame.numberOfChannels + channel] / 32768.0;
                    }
                    audioBuffer.copyToChannel(channelData, channel);
                }
            } else if (format === "s32") {
                // Int32 interleaved
                const interleaved = new Int32Array(totalSamples);
                frame.copyTo(interleaved, { "planeIndex": 0 });
                for (let channel = 0; channel < frame.numberOfChannels; channel++) {
                    const channelData = new Float32Array(frame.numberOfFrames);
                    for (let i = 0; i < frame.numberOfFrames; i++) {
                        channelData[i] = interleaved[i * frame.numberOfChannels + channel] / 2147483648.0;
                    }
                    audioBuffer.copyToChannel(channelData, channel);
                }
            } else if (format === "u8") {
                // Unsigned 8-bit interleaved (common in MP3)
                const interleaved = new Uint8Array(totalSamples);
                frame.copyTo(interleaved, { "planeIndex": 0 });
                for (let channel = 0; channel < frame.numberOfChannels; channel++) {
                    const channelData = new Float32Array(frame.numberOfFrames);
                    for (let i = 0; i < frame.numberOfFrames; i++) {
                        // Convert U8 (0-255, center at 128) to Float32 (-1.0 to 1.0)
                        channelData[i] = (interleaved[i * frame.numberOfChannels + channel] - 128) / 128.0;
                    }
                    audioBuffer.copyToChannel(channelData, channel);
                }
            }
        }

        // Create source and schedule playback
        const source = this.audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        if (this.audioPlay) {
            source.connect(this.audioCtx.destination);
        } else {
            source.channelInterpretation = "discrete";
        }
        if (this.analyser) {
            source.connect(this.analyser);
        }

        // Schedule at next available time slot to avoid gaps
        const now = this.audioCtx.currentTime;
        if (this.nextPlaybackTime < now) {
            this.nextPlaybackTime = now;
        }
        source.start(this.nextPlaybackTime);
        this.nextPlaybackTime += audioBuffer.duration;
    };

    async appendVideoFrame(frame) {
        const context = this.videoDrawCtx;
        

        if (context.canvas.width !== frame.displayWidth || context.canvas.height !== frame.displayHeight) {
            context.canvas.width = frame.displayWidth;
            context.canvas.height = frame.displayHeight;
            if (this.webgpuInitialized) { context.configure({ device: this.device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'premultiplied' }); }
        }
        
        // Initialize WebGPU resources on the first frame
        if (!this.webgpuInitialized) {
            if (this.webgpuInitializing) {
                // Drop frame if we're still waiting for the GPU device
                return;
            }
            this.webgpuInitializing = true;

            try {
                const adapter = await navigator.gpu.requestAdapter();
                if (!adapter) throw new Error('No appropriate GPUAdapter found.');
                
                this.device = await adapter.requestDevice();
                const format = navigator.gpu.getPreferredCanvasFormat();
                
                context.configure({
                    device: this.device,
                    format: format,
                    alphaMode: 'premultiplied'
                });

                const shaderCode = `
                    struct VertexOutput {
                        @builtin(position) position : vec4<f32>,
                        @location(0) texCoord : vec2<f32>,
                    }

                    @vertex
                    fn vert_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {
                        var pos = array<vec2<f32>, 4>(
                            vec2<f32>(-1.0,  1.0),
                            vec2<f32>( 1.0,  1.0),
                            vec2<f32>(-1.0, -1.0),
                            vec2<f32>( 1.0, -1.0)
                        );
                        var tex = array<vec2<f32>, 4>(
                            vec2<f32>(0.0, 0.0),
                            vec2<f32>(1.0, 0.0),
                            vec2<f32>(0.0, 1.0),
                            vec2<f32>(1.0, 1.0)
                        );
                        
                        var output : VertexOutput;
                        output.position = vec4<f32>(pos[VertexIndex], 0.0, 1.0);
                        output.texCoord = tex[VertexIndex];
                        return output;
                    }

                    @group(0) @binding(0) var mySampler: sampler;
                    @group(0) @binding(1) var myTexture: texture_external;

                    @fragment
                    fn frag_main(@location(0) texCoord : vec2<f32>) -> @location(0) vec4<f32> {
                        // Sample from the external texture
                        return textureSampleBaseClampToEdge(myTexture, mySampler, texCoord);
                    }
                `;

                const module = this.device.createShaderModule({ code: shaderCode });

                this.pipeline = this.device.createRenderPipeline({
                    layout: 'auto',
                    vertex: {
                        module,
                        entryPoint: 'vert_main',
                    },
                    fragment: {
                        module,
                        entryPoint: 'frag_main',
                        targets: [{ format }],
                    },
                    primitive: {
                        topology: 'triangle-strip',
                    },
                });

                this.sampler = this.device.createSampler({
                    magFilter: 'linear',
                    minFilter: 'linear',
                });

                this.webgpuInitialized = true;
            } catch (err) {
                console.error('Failed to initialize WebGPU:', err);
                return;
            } finally {
                this.webgpuInitializing = false;
            }
        }

        // Import the VideoFrame as an external texture
        const externalTexture = this.device.importExternalTexture({ source: frame });

        const bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: externalTexture }
            ]
        });

        const commandEncoder = this.device.createCommandEncoder();
        const textureView = context.getCurrentTexture().createView();

        const renderPassDescriptor = {
            colorAttachments: [{
                view: textureView,
                clearValue: [0.0, 0.0, 0.0, 1.0],
                loadOp: 'clear',
                storeOp: 'store',
            }],
        };

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.draw(4);
        passEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);
        /*
        appendVideoFrame(frame) {
            this.videoDrawCtx.drawImage(frame, 0, 0, this.videoDrawCtx.canvas.width, this.videoDrawCtx.canvas.height);
        };
        */
    };
};

export {
    Decoder,
    Player
};
export default {
    Decoder,
    Player
};