"use strict";

// the name of the application, from the configured one (http.appearance.name,
// keyed by language) - pure, so tests/appname.test.js runs it under Node. The
// script at the top of index.html holds a copy of pickName, since it runs
// before any module can.

// the name in one language: that one, its base, a variant of the base,
// English, then any - null when there is none to pick
const pickName = function(names, lang) {
    if (typeof names !== "object" || names === null) {
        return null;
    }
    const keys = Object.keys(names);
    const base = String(lang).slice(0, 2).toLowerCase();
    const key = keys.find((name) => name === lang) ?? keys.find((name) => name === base)
        ?? keys.find((name) => name.slice(0, 2) === base) ?? (typeof names["en"] === "string" ? "en" : keys[0]);
    return (typeof names[key] === "string" && names[key] !== "" ? names[key] : null);
};

// what a name cannot hold where the system keeps it: the auto-launch entry is
// a registry value on Windows, a file name and an AppleScript string on macOS
// and a file name on Linux
const UNSAFE_SYSTEM = /[\u0000-\u001f\u007f/\\:*?"<>|]/g;

// the name the application registers with the system under, in no language
// the system could follow: the English one, else the first configured, else
// the fallback - the dictionary's - where nothing usable is left
const pickSystemName = function(names, fallback) {
    let name = "";
    if (typeof names === "object" && names !== null) {
        name = names["en"] ?? Object.values(names)[0] ?? "";
    }
    name = String(name).replace(/\s+/g, " ").replace(UNSAFE_SYSTEM, "").trim();
    return (name !== "" ? name : fallback);
};

export { pickName, pickSystemName };
export default { pickName, pickSystemName };
