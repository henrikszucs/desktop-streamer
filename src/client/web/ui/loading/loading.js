"use strict";

// the loading layer, over both segments of the shell
//
// It is the third layer of the UI beside the two segments, and the only one
// that is in index.html rather than in a module: it is on screen from the first
// paint, before there is anything to load it with. What is here is the half
// that has to be code - who is holding it and when it comes off - and the one
// dialog that replaces it rather than waiting behind it is ./version.

// the layer, holding the overlay it is shown over
//
// Two things ask for it and they overlap: the connection, which holds it from
// boot until the server answers and takes it back the moment it drops, and a
// module that is slow to arrive. A screen that finishes loading while the
// socket is down must not hand the layer back, so every holder is named and the
// layer is on screen while any of them holds it. It starts held by the
// connection, which is the state the markup is written in.
const createLoading = function(overlay) {
    const loadingEl = document.getElementById("dialog-loading");
    const holders = new Set(["connection"]);

    return {
        "el": loadingEl,
        "open": function(holder="connection") {
            holders.add(holder);
            loadingEl.classList.add("active");
            overlay.take("loading", true);
        },
        "close": function(holder="connection") {
            holders.delete(holder);
            if (holders.size > 0) {
                return;
            }
            loadingEl.classList.remove("active");
            overlay.release("loading");
        },
        // what replaces the layer rather than waits for it: the version
        // mismatch is terminal, so it takes the layer off whoever holds it and
        // leaves the overlay to the dialog that replaces it
        "dismiss": function() {
            holders.clear();
            loadingEl.classList.remove("active");
            overlay.release("loading");
        }
    };
};

export { createLoading };
export default { createLoading };
