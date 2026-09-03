"use strict";

// what the browser this client runs in is, and how wide it is - everything the
// UI has to know before it draws anything

// Opera 8.0+, Firefox 1.0+, Safari 3.0+, IE 6-11, Edge 20+, Chrome 1-79
const checkBrowser = function() {
    // Opera 8.0+
    const isOpera = (!!window.opr && !!opr.addons) || !!window.opera || navigator.userAgent.indexOf(' OPR/') >= 0;

    // Firefox 1.0+
    const isFirefox = typeof InstallTrigger !== 'undefined';

    // Safari 3.0+ "[object HTMLElementConstructor]" 
    const isSafari = /constructor/i.test(window.HTMLElement) || (function (p) { return p.toString() === "[object SafariRemoteNotification]"; })(!window['safari'] || (typeof safari !== 'undefined' && window['safari'].pushNotification));

    // Internet Explorer 6-11
    const isIE = /*@cc_on!@*/false || !!document.documentMode;

    // Edge 20+
    const isEdge = !isIE && !!window.StyleMedia;

    // Chrome 1 - 79
    const isChrome = !!window.chrome;

    // Edge (based on chromium) detection
    const isEdgeChromium = isChrome && (navigator.userAgent.indexOf("Edg") != -1);

    // Blink engine detection
    const isBlink = (isChrome || isOpera) && !!window.CSS;

    return {
        "isFirefox": isFirefox,
        "isChrome": isChrome,
        "isSafari": isSafari,
        "isOpera": isOpera,
        "isIE": isIE,
        "isEdge": isEdge,
        "isEdgeChromium": isEdgeChromium,
        "isBlink": isBlink
    };
};

const checkBrowser2 = () => {
    const ua = navigator.userAgent;
    let tem; 
    let M = ua.match(/(opera|chrome|safari|firefox|msie|trident(?=\/))\/?\s*(\d+)/i) || [];
    if (/trident/i.test(M[1])) {
        tem = /\brv[ :]+(\d+)/g.exec(ua) || [];
        return "IE " + (tem[1] || "");
    }
    if (M[1] === "Chrome") {
        tem = ua.match(/\b(OPR|Edge)\/(\d+)/);
        if (tem != null) {
            return tem.slice(1).join(" ").replace("OPR", "Opera");
        }
    }
    M = M[2]? [M[1], M[2]]: [navigator.appName, navigator.appVersion, "-?"];
    if ((tem = ua.match(/version\/(\d+)/i))!= null) { 
        M.splice(1, 1, tem[1]);
    }
    return M;
};

const getOS = function() {
    const userAgent = window.navigator.userAgent,
        platform = window.navigator?.userAgentData?.platform || window.navigator.platform,
        macosPlatforms = ['macOS', 'Macintosh', 'MacIntel', 'MacPPC', 'Mac68K'],
        windowsPlatforms = ['Win32', 'Win64', 'Windows', 'WinCE'],
        iosPlatforms = ['iPhone', 'iPad', 'iPod'];
    let os = null;

    if (macosPlatforms.indexOf(platform) !== -1) {
        os = "darwin";
    } else if (iosPlatforms.indexOf(platform) !== -1) {
        os = 'ios';
    } else if (windowsPlatforms.indexOf(platform) !== -1) {
        os = 'win32';
    } else if (/Android/.test(userAgent)) {
        os = 'android';
    } else if (/Linux/.test(platform)) {
        os = 'linux';
    }

    return os;
};

const browser = checkBrowser();
const width = window.innerWidth;
const sizeS = 600;
const sizeM = 993;

//
// the display, and how big a pixel of it is
//
// CSS fixes an inch at 96 px, so screen.width / 96 is how many inches the
// platform believes the display measures - not the inches a ruler would give,
// because the platform has already divided by the distance it assumes the
// display is looked at from. That is why a phone of 2.7 real inches hands out
// the four inches of CSS pixels a small monitor would: the CSS pixel is a unit
// of angle rather than of glass, and on a phone, a tablet and a monitor the
// platform gets that angle about right on its own.
//
// The one display it gets wrong is a television. It hands out the pixels of a
// twenty inch monitor for a screen watched from three metres and never grew
// the pixel to match the room, so text drawn at the base size lands on the eye
// at a fraction of it. What follows finds that case and says how much bigger
// the root font has to be - the one number the whole UI is measured in, since
// beercss is rem throughout and so is everything this client adds to it.

// the definition, not a measurement: CSS says an inch is 96 px
const cssPxPerInch = 96;

// the root font every rem in the UI is one of
const baseFontPx = 16;

// A set announces itself, and that is the only signal worth trusting for one.
// The tempting alternative - a screen that reports no pointer and no hover -
// is what a browser with no input device attached reports too, headless Chrome
// at 1280x720 included, which is a television's resolution exactly: there is
// no media query that separates the two. Missing a set costs it the desk size,
// which is what it has today; taking a desk display for a set would double the
// UI on someone's monitor, so the guess only goes one way.
const tvAgents = /smart-?tv|google\s?tv|android\s?tv|apple\s?tv|hbbtv|netcast|nettv|web[o0]s|tizen|viera|aquos|bravia|vidaa|hisense|roku|crkey|\baft[a-z]{0,4}\b|philipstv|inettvbrowser|opera\s?tv|playstation|xbox/i;

// what a 1080p set at three metres reads correctly at, and the width it was
// measured against. A set that hands out twice the CSS pixels for the same
// wall makes each one land half the size, so the scale follows the width.
const tvScale = 1.8;
const tvScaleWidth = 1920;
const tvScaleMin = 1.4;
const tvScaleMax = 3;

// a coarse pointer on a screen smaller than this is a phone, above it a tablet
const phoneDiagonalInch = 11;

// a desk display past this many apparent inches is sat further back than the
// 28 the CSS pixel is defined at, so it gets a ramp - an inch of diagonal is
// worth 1/rampInch of the base size - rather than a jump, and a cap
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
        // device pixels to the inch: an inch is 96 CSS px and one CSS px is
        // `ratio` device pixels of the panel. It is the density the platform
        // admits to rather than the one a ruler gives - no browser will say
        // how large the glass is - and the inches below are of that same inch.
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

// the root font size this display needs, in px
//
// A phone, a tablet and a monitor keep the base: the platform already divided
// its pixel by the distance they are read at, and scaling over that would only
// undo work that was done right - a dense phone panel is already handed out as
// the few hundred CSS pixels it should be, not as its device pixels. What is
// left is the two the platform cannot know: a television, where the room is
// what it got wrong, and a desk display large enough to be sat back from.
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

export { checkBrowser, checkBrowser2, getOS, browser, width, sizeS, sizeM, domReady, getDisplay, getDisplayKind, getRootFontSize };
export default { checkBrowser, checkBrowser2, getOS, browser, width, sizeS, sizeM, domReady, getDisplay, getDisplayKind, getRootFontSize };
