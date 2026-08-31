"use strict";

// the Electron side of the client: an empty object in a browser, the node and
// electron modules the renderer is allowed to reach under the desktop shell

const desktop = {
    "isAvailable": false
};

// fill the object above when there is an Electron renderer around it, the
// modules it pulls in only exist there so they load with it, not at boot
const initDesktop = async function() {
    if (typeof require === "undefined") {
        return desktop;
    }
    const native = await import("./desktop-native.js");
    await native.load(desktop);

    // disable require to prevent security issues
    globalThis.require = undefined;

    return desktop;
};

export { desktop, initDesktop };
export default { desktop, initDesktop };
