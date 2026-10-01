"use strict";

// what platform this client runs on, and how wide it is - everything the UI
// has to know before it draws anything. What the browser can *do* is asked of
// the feature itself where it is used, never guessed from its name.

// the operating system, in the names node uses for it, since the desktop shell
// reports the same word from os.platform() - "unknown" where the user agent
// says nothing this recognises
const getPlatform = function() {
    const agent = navigator.userAgent ?? "";
    if (/iPhone|iPad|iPod/i.test(agent)) {
        return "ios";
    }
    if (/Android/i.test(agent)) {
        return "android";
    }
    if (/Windows/i.test(agent)) {
        return "win32";
    }
    if (/Mac OS|Macintosh/i.test(agent)) {
        return "darwin";
    }
    if (/Linux|X11/i.test(agent)) {
        return "linux";
    }
    return "unknown";
};
const width = window.innerWidth;
const sizeS = 600;
const sizeM = 993;

// the display, and how big a pixel of it is. A CSS inch is 96 px by definition,
// so every inch below is the apparent one - see .claude/CLIENT.md.

// the definition, not a measurement: CSS says an inch is 96 px
const cssPxPerInch = 96;

// the root font every rem in the UI is one of
const baseFontPx = 16;

// a set announces itself, and the user agent is the only signal worth trusting
// for one - no media query separates a set from a browser with no input device
const tvAgents = /smart-?tv|google\s?tv|android\s?tv|apple\s?tv|hbbtv|netcast|nettv|web[o0]s|tizen|viera|aquos|bravia|vidaa|hisense|roku|crkey|\baft[a-z]{0,4}\b|philipstv|inettvbrowser|opera\s?tv|playstation|xbox/i;

// what a 1080p set at three metres reads correctly at, and the width it was
// measured against - twice the CSS pixels for one wall halves each of them
const tvScale = 1.8;
const tvScaleWidth = 1920;
const tvScaleMin = 1.4;
const tvScaleMax = 3;

// a coarse pointer on a screen smaller than this is a phone, above it a tablet
const phoneDiagonalInch = 11;

// a desk display past this many apparent inches is sat further back than the 28
// the CSS pixel is defined at, so it gets a ramp rather than a jump, and a cap
const deskDiagonalInch = 30;
const deskRampInch = 60;
const deskScaleMax = 1.25;

const mediaMatches = function(query) {
    return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
};

// what the platform will admit about the display it is drawing on
const getDisplay = function() {
    const ratio = window.devicePixelRatio || 1;
    const screenWidth = (window.screen && window.screen.width) || window.innerWidth;
    const screenHeight = (window.screen && window.screen.height) || window.innerHeight;
    const widthInch = screenWidth / cssPxPerInch;
    const heightInch = screenHeight / cssPxPerInch;
    return {
        "ratio": ratio,
        // device pixels to the inch, the density the platform admits to rather
        // than the one a ruler gives - no browser says how large the glass is
        "pixelsPerInch": cssPxPerInch * ratio,
        "width": screenWidth,
        "height": screenHeight,
        "widthInch": widthInch,
        "heightInch": heightInch,
        "diagonalInch": Math.sqrt(widthInch * widthInch + heightInch * heightInch)
    };
};

// "phone" | "tablet" | "desk" | "tv"
const getDisplayKind = function(display) {
    if (tvAgents.test(window.navigator.userAgent)) {
        return "tv";
    }
    if (mediaMatches("(pointer: coarse)") && mediaMatches("(hover: none)")) {
        return display["diagonalInch"] < phoneDiagonalInch ? "phone" : "tablet";
    }
    return "desk";
};

// the root font size this display needs, in px. Only the two the platform
// cannot know are scaled: a television, and a desk display sat back from.
const getRootFontSize = function(display, kind) {
    if (kind === "tv") {
        const scale = tvScale * (display["width"] / tvScaleWidth);
        return baseFontPx * Math.min(Math.max(scale, tvScaleMin), tvScaleMax);
    }
    if (display["diagonalInch"] > deskDiagonalInch) {
        const scale = 1 + (display["diagonalInch"] - deskDiagonalInch) / deskRampInch;
        return baseFontPx * Math.min(scale, deskScaleMax);
    }
    return baseFontPx;
};

// the DOM the shell is built from
const domReady = new Promise(function (resolve) {
    window.addEventListener("load", () => {
        resolve();
    }, { "once": true });
});

export { getPlatform, width, sizeS, sizeM, domReady, getDisplay, getDisplayKind, getRootFontSize };
export default { getPlatform, width, sizeS, sizeM, domReady, getDisplay, getDisplayKind, getRootFontSize };
