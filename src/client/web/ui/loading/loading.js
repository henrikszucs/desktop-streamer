"use strict";

// the loading layer, over both segments. Its markup is in index.html because it
// is on screen from the first paint; what is here is who holds it.

// the connection and a slow module both ask for it and they overlap, so every
// holder is named - it starts held by the connection, as the markup is written
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
        // what replaces the layer rather than waits for it: a terminal dialog
        // takes it off every holder and keeps the overlay
        "dismiss": function() {
            holders.clear();
            loadingEl.classList.remove("active");
            overlay.release("loading");
        }
    };
};

export { createLoading };
export default { createLoading };
