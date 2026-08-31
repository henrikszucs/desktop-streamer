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

// the DOM the shell is built from
const domReady = new Promise(function (resolve) {
    window.addEventListener("load", () => {
        resolve();
    }, { "once": true });
});

export { checkBrowser, checkBrowser2, getOS, browser, width, sizeS, sizeM, domReady };
export default { checkBrowser, checkBrowser2, getOS, browser, width, sizeS, sizeM, domReady };
