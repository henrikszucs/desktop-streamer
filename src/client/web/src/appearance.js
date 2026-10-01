"use strict";

// the look of the client: its defaults and its palette as beercss writes one -
// pure, so the build paints with the same code the client draws with

// how the client looks where http.appearance says nothing
const DEFAULT_APPEARANCE = Object.freeze({"color": "#006e1c", "theme": "auto"});

// the variable names exactly as beercss writes them (ui("theme") in beer.min.js)
const toStyle = function(colors) {
    let style = "";
    for (const key of Object.keys(colors)) {
        style += "--" + key.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, "$1-$2").toLowerCase() + ":" + colors[key] + ";";
    }
    return style;
};

// the palette of a colour as {light, dark} style strings - material-dynamic-colors
// has to be loaded first, since it sets itself on globalThis
const buildPalette = async function(color) {
    const palette = await globalThis.materialDynamicColors(color);
    return {"light": toStyle(palette["light"]), "dark": toStyle(palette["dark"])};
};

export { DEFAULT_APPEARANCE, toStyle, buildPalette };
export default { DEFAULT_APPEARANCE, toStyle, buildPalette };
