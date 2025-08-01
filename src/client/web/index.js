const theme = function(color) {
    globalThis.ui("theme", color || "#006e1c");
}

const mode = function() {
    let newMode = globalThis.ui("mode") == "dark" ? "light" : "dark";
    globalThis.ui("mode", newMode);
}

window.addEventListener("load", () => theme());