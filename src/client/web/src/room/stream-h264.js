"use strict";

// the slice headers of an H.264 access unit, read for what the upscaler is told
// about a frame: the QP it was coded at, its type, whether the loop filter runs.
// Pure, no decoder behind it - .claude/CLIENT.md, "The QP of a frame".

const NAL_SLICE = 1;
const NAL_IDR = 5;
const NAL_SPS = 7;
const NAL_PPS = 8;

// the profiles whose SPS carries the chroma format, bit depths and scaling lists
const HIGH_PROFILES = new Set([44, 83, 86, 100, 110, 118, 122, 128, 134, 135, 138, 139, 244]);

const SLICE_TYPES = ["P", "B", "I", "SP", "SI"];

// a reader of a NAL unit's bits from `start` to `end`, dropping the emulation
// prevention byte of every 00 00 03 as it goes, so nothing is copied
const createBits = function(bytes, start, end = bytes.length) {
    let pos = start;
    let zeros = 0;
    let current = 0;
    let left = 0;

    const nextByte = function() {
        if (pos >= end) {
            throw new RangeError("The NAL unit ended inside a header");
        }
        let value = bytes[pos++];
        if (zeros >= 2 && value === 3) {
            zeros = 0;
            if (pos >= end) {
                throw new RangeError("The NAL unit ended inside a header");
            }
            value = bytes[pos++];
        }
        zeros = (value === 0 ? zeros + 1 : 0);
        return value;
    };

    const bit = function() {
        if (left === 0) {
            current = nextByte();
            left = 8;
        }
        left--;
        return (current >> left) & 1;
    };

    // n bits as an unsigned number, n up to 32
    const u = function(n) {
        let value = 0;
        for (let i = 0; i < n; i++) {
            value = value * 2 + bit();
        }
        return value;
    };

    // an unsigned and a signed Exp-Golomb code
    const ue = function() {
        let zeroCount = 0;
        while (bit() === 0) {
            zeroCount++;
            if (zeroCount > 31) {
                throw new RangeError("An Exp-Golomb code longer than 32 bits");
            }
        }
        return 2 ** zeroCount - 1 + u(zeroCount);
    };

    const se = function() {
        const code = ue();
        return (code % 2 === 1 ? (code + 1) / 2 : 0 - code / 2);
    };

    return {"u": u, "ue": ue, "se": se, "flag": function() {
        return bit() === 1;
    }};
};

const skipScalingList = function(bits, size) {
    let last = 8;
    let next = 8;
    for (let j = 0; j < size; j++) {
        if (next !== 0) {
            next = (last + bits.se() + 256) % 256;
        }
        last = (next === 0 ? last : next);
    }
};

const readSps = function(bits) {
    const profile = bits.u(8);
    bits.u(16);     // the constraint flags and the level
    const sps = {"id": bits.ue(), "chromaArrayType": 1};
    if (HIGH_PROFILES.has(profile) === true) {
        const chromaFormat = bits.ue();
        const isSeparatePlanes = (chromaFormat === 3 && bits.flag() === true);
        sps["chromaArrayType"] = (isSeparatePlanes === true ? 0 : chromaFormat);
        sps["isSeparatePlanes"] = isSeparatePlanes;
        bits.ue();
        bits.ue();
        bits.flag();
        if (bits.flag() === true) {
            for (let i = 0; i < (chromaFormat !== 3 ? 8 : 12); i++) {
                if (bits.flag() === true) {
                    skipScalingList(bits, (i < 6 ? 16 : 64));
                }
            }
        }
    }
    sps["frameNumBits"] = bits.ue() + 4;
    sps["pocType"] = bits.ue();
    if (sps["pocType"] === 0) {
        sps["pocLsbBits"] = bits.ue() + 4;
    } else if (sps["pocType"] === 1) {
        sps["isDeltaPocZero"] = bits.flag();
        bits.se();
        bits.se();
        const cycle = bits.ue();
        for (let i = 0; i < cycle; i++) {
            bits.se();
        }
    }
    bits.ue();      // the reference frames
    bits.flag();
    const widthMbs = bits.ue() + 1;
    const heightUnits = bits.ue() + 1;
    sps["isFrameMbsOnly"] = bits.flag();
    sps["mbs"] = widthMbs * heightUnits * (sps["isFrameMbsOnly"] === true ? 1 : 2);
    return sps;
};

const readPps = function(bits) {
    const pps = {"id": bits.ue(), "spsId": bits.ue(), "isCabac": bits.flag(), "isBottomFieldPoc": bits.flag()};
    const sliceGroups = bits.ue() + 1;
    if (sliceGroups > 1) {
        const mapType = bits.ue();
        if (mapType === 0) {
            for (let i = 0; i < sliceGroups; i++) {
                bits.ue();
            }
        } else if (mapType === 2) {
            for (let i = 0; i < sliceGroups - 1; i++) {
                bits.ue();
                bits.ue();
            }
        } else if (mapType >= 3 && mapType <= 5) {
            bits.flag();
            bits.ue();
        } else if (mapType === 6) {
            const units = bits.ue() + 1;
            const idBits = Math.ceil(Math.log2(sliceGroups));
            for (let i = 0; i < units; i++) {
                bits.u(idBits);
            }
        }
    }
    pps["refsL0"] = bits.ue() + 1;
    pps["refsL1"] = bits.ue() + 1;
    pps["isWeightedPred"] = bits.flag();
    pps["weightedBipred"] = bits.u(2);
    pps["initQp"] = 26 + bits.se();
    bits.se();
    bits.se();
    pps["isDeblockControl"] = bits.flag();
    bits.flag();
    pps["isRedundantPicCnt"] = bits.flag();
    return pps;
};

const skipRefListModification = function(bits) {
    if (bits.flag() === false) {
        return;
    }
    for (let idc = bits.ue(); idc !== 3; idc = bits.ue()) {
        if (idc > 5) {
            throw new RangeError("An unknown reference list modification");
        }
        bits.ue();
    }
};

const skipWeights = function(bits, refs, chromaArrayType) {
    for (let i = 0; i < refs; i++) {
        if (bits.flag() === true) {
            bits.se();
            bits.se();
        }
        if (chromaArrayType !== 0 && bits.flag() === true) {
            for (let j = 0; j < 4; j++) {
                bits.se();
            }
        }
    }
};

// a slice header up to its loop filter field: {firstMb, type, qp, deblockIdc},
// or null while the parameter sets it refers to have not been seen
const readSlice = function(bits, nalType, refIdc, spsById, ppsById) {
    const firstMb = bits.ue();
    const type = SLICE_TYPES[bits.ue() % 5];
    const pps = ppsById.get(bits.ue());
    const sps = spsById.get(pps?.["spsId"]);
    if (typeof pps === "undefined" || typeof sps === "undefined") {
        return null;
    }
    const isIntra = (type === "I" || type === "SI");
    if (sps["isSeparatePlanes"] === true) {
        bits.u(2);
    }
    bits.u(sps["frameNumBits"]);
    let isField = false;
    if (sps["isFrameMbsOnly"] === false) {
        isField = bits.flag();
        if (isField === true) {
            bits.flag();
        }
    }
    if (nalType === NAL_IDR) {
        bits.ue();
    }
    if (sps["pocType"] === 0) {
        bits.u(sps["pocLsbBits"]);
        if (pps["isBottomFieldPoc"] === true && isField === false) {
            bits.se();
        }
    } else if (sps["pocType"] === 1 && sps["isDeltaPocZero"] === false) {
        bits.se();
        if (pps["isBottomFieldPoc"] === true && isField === false) {
            bits.se();
        }
    }
    if (pps["isRedundantPicCnt"] === true) {
        bits.ue();
    }
    if (type === "B") {
        bits.flag();
    }
    let refsL0 = pps["refsL0"];
    let refsL1 = pps["refsL1"];
    if (type === "P" || type === "SP" || type === "B") {
        if (bits.flag() === true) {
            refsL0 = bits.ue() + 1;
            if (type === "B") {
                refsL1 = bits.ue() + 1;
            }
        }
    }
    if (isIntra === false) {
        skipRefListModification(bits);
        if (type === "B") {
            skipRefListModification(bits);
        }
    }
    if ((pps["isWeightedPred"] === true && (type === "P" || type === "SP")) || (pps["weightedBipred"] === 1 && type === "B")) {
        bits.ue();
        if (sps["chromaArrayType"] !== 0) {
            bits.ue();
        }
        skipWeights(bits, refsL0, sps["chromaArrayType"]);
        if (type === "B") {
            skipWeights(bits, refsL1, sps["chromaArrayType"]);
        }
    }
    if (refIdc !== 0) {
        if (nalType === NAL_IDR) {
            bits.flag();
            bits.flag();
        } else if (bits.flag() === true) {
            for (let op = bits.ue(); op !== 0; op = bits.ue()) {
                if (op > 6) {
                    throw new RangeError("An unknown memory management operation");
                }
                if (op === 1 || op === 3) {
                    bits.ue();
                }
                if (op === 2) {
                    bits.ue();
                }
                if (op === 3 || op === 6) {
                    bits.ue();
                }
                if (op === 4) {
                    bits.ue();
                }
            }
        }
    }
    if (pps["isCabac"] === true && isIntra === false) {
        bits.ue();
    }
    const qp = pps["initQp"] + bits.se();
    if (type === "SP" || type === "SI") {
        if (type === "SP") {
            bits.flag();
        }
        bits.se();
    }
    const deblockIdc = (pps["isDeblockControl"] === true ? bits.ue() : 0);
    return {"firstMb": firstMb, "type": type, "qp": qp, "deblockIdc": deblockIdc, "mbs": sps["mbs"]};
};

// the frame its slices make: the QP over its macroblocks, the type of its most
// predicted slice, and whether the loop filter runs on any of it
const pictureOf = function(slices) {
    slices.sort(function(a, b) {
        return a["firstMb"] - b["firstMb"];
    });
    const total = slices[0]["mbs"];
    let qpSum = 0;
    let mbCount = 0;
    for (let i = 0; i < slices.length; i++) {
        const end = (i + 1 < slices.length ? slices[i + 1]["firstMb"] : total);
        const count = end - slices[i]["firstMb"];
        qpSum += slices[i]["qp"] * count;
        mbCount += count;
    }
    const types = new Set(slices.map(function(slice) {
        return slice["type"];
    }));
    return {
        "qp": (mbCount > 0 && slices[slices.length - 1]["firstMb"] < total
            ? qpSum / mbCount
            : slices.reduce(function(sum, slice) {
                return sum + slice["qp"];
            }, 0) / slices.length),
        "type": (types.has("B") === true ? "B" : (types.has("P") === true || types.has("SP") === true ? "P" : "I")),
        "isDeblocked": slices.some(function(slice) {
            return slice["deblockIdc"] !== 1;
        }),
        "slices": slices.length
    };
};

// a reader of one stream's access units, in decode order: the parameter sets
// are kept from one unit to the next, as a decoder keeps them
const createSliceReader = function() {
    const spsById = new Map();
    const ppsById = new Map();

    return {
        // one access unit (Annex B bytes) in, {qp, type, isDeblocked, slices}
        // out, or null for a unit with no slice that can be read yet
        "read": function(data) {
            const bytes = (data instanceof Uint8Array ? data : new Uint8Array(data));
            const slices = [];
            const starts = [];
            for (let i = 0; i + 3 < bytes.length; i++) {
                if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
                    starts.push(i + 3);
                    i += 2;
                }
            }
            for (let k = 0; k < starts.length; k++) {
                const start = starts[k];
                const end = (k + 1 < starts.length ? starts[k + 1] - 3 : bytes.length);
                const header = bytes[start];
                const nalType = header & 0x1F;
                try {
                    if (nalType === NAL_SPS) {
                        const sps = readSps(createBits(bytes, start + 1, end));
                        spsById.set(sps["id"], sps);
                    } else if (nalType === NAL_PPS) {
                        const pps = readPps(createBits(bytes, start + 1, end));
                        ppsById.set(pps["id"], pps);
                    } else if (nalType === NAL_SLICE || nalType === NAL_IDR) {
                        const slice = readSlice(createBits(bytes, start + 1, end), nalType, (header >> 5) & 3, spsById, ppsById);
                        if (slice !== null) {
                            slices.push(slice);
                        }
                    }
                } catch (error) {
                    // a unit that does not read is left out, and the frame is what the rest say
                }
            }
            return (slices.length > 0 ? pictureOf(slices) : null);
        },

        // a new stream: its parameter sets come with its first keyframe
        "reset": function() {
            spsById.clear();
            ppsById.clear();
        }
    };
};

export { createBits, createSliceReader };
export default { createBits, createSliceReader };
