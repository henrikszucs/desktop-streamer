"use strict";

// whether this client can hand its mouse and keyboard over, and the key
// combinations that get out of a fullscreen room

// first-party dependencies
import { Panel } from "../../../../src/view.js";

const ControlWindow = class extends Panel {
    static id = "settings.control";
    static mountPoint = "#settings-windows";
    static rootId = "settings-control";

    shortcuts = [];

    async mount(ctx) {
        const conf = ctx["conf"];
        const setLocal = ctx["setLocal"];

        // check mouse share support
        this.mouseShareSupport = document.getElementById("mouse-share-support");
        this.mouseShareUnsupport = document.getElementById("mouse-share-unsupport");
        if (ctx["desktop"].isAvailable) {
            this.mouseShareSupport.classList.remove("hide");
        } else {
            this.mouseShareUnsupport.classList.remove("hide");
        }

        // exit shortcuts
        this.shortcutList = document.getElementById("shortcut-list");
        this.shortcutAdd = document.getElementById("btn-shortcut-add");
        this.shortcutAdd.addEventListener("click", async () => {
            const newShortcut = {
                "delay": "1",
                "keys": []
            };
            conf["local"]["exitShortcuts"].push(newShortcut);
            await this.saveShortcuts();
            this.createShortcut(newShortcut["delay"], Array.from(newShortcut["keys"]).join(" + "), newShortcut);
        });
    };

    // the list is one local value, stored as the JSON of the whole array
    saveShortcuts() {
        const shortcuts = this.ctx["conf"]["local"]["exitShortcuts"];
        return this.ctx["setLocal"]("exitShortcuts", shortcuts, JSON.stringify(shortcuts));
    };

    createShortcut(delay, key, confobj) {
        const localization = this.ctx["localization"];
        const el = document.createElement("div");
        el.classList.add("shortcut-box");

        // delay
        const delayBox = document.createElement("div");
        delayBox.classList.add("field", "label", "suffix", "border", "round", "shortcut-delay");
        const delaySelect = document.createElement("select");
        for (let i = 1; i < 8; i++) {
            const option = new Option(localization.get("settings.control.exit-shortcut.delay-unit"+i), i.toString());
            delaySelect.add(option);
            option.value = i.toString();
        }
        delaySelect.value = delay;
        if (typeof confobj === "undefined") {
            delaySelect.disabled = true;
        } else {
            delaySelect.addEventListener("change", async (event) => {
                confobj["delay"] = event.target.value;
                await this.saveShortcuts();
            });
        }
        delayBox.appendChild(delaySelect);
        const delayLabel = document.createElement("label");
        delayLabel.innerText = localization.get("settings.control.exit-shortcut.delay");
        delayBox.appendChild(delayLabel);
        const delayIcon = document.createElement("i");
        delayIcon.innerText = "arrow_drop_down";
        delayBox.appendChild(delayIcon);
        el.appendChild(delayBox);

        // key and delete
        const elSub = document.createElement("div");
        elSub.classList.add("shortcut-box-sub");

        const keyBox = document.createElement("div");
        keyBox.classList.add("field", "label", "border", "round", "shortcut-key");
        const keyInput = document.createElement("input");
        keyInput.type = "text";
        if (key === "") {
            keyInput.value = localization.get("settings.control.exit-shortcut.none");
        } else {
            keyInput.value = key;
        }
        if (typeof confobj === "undefined") {
            keyInput.disabled = true;
        } else {
            let firstKey = "";
            const allkeys = new Set();
            keyInput.addEventListener("keydown", (event) => {
                event.preventDefault();
                const key = event.key;
                if (firstKey === "") {
                    allkeys.clear();
                    firstKey = key;
                }
                allkeys.add(key);
                event.target.value = Array.from(allkeys).join(" + ");
            });
            keyInput.addEventListener("keyup", async (event) => {
                event.preventDefault();
                const key = event.key;
                if (key === firstKey) {
                    firstKey = "";
                    confobj["keys"] = Array.from(allkeys);
                    await this.saveShortcuts();
                }
            });
        }
        keyBox.appendChild(keyInput);
        const keyLabel = document.createElement("label");
        keyLabel.innerText = localization.get("settings.control.exit-shortcut.key");
        keyBox.appendChild(keyLabel);
        elSub.appendChild(keyBox);

        const deleteBox = document.createElement("div");
        deleteBox.classList.add("shortcut-delete");
        if (typeof confobj === "undefined") {
            deleteBox.style.visibility = "hidden";
        } else {
            deleteBox.addEventListener("click", async () => {
                el.remove();
                const exitShortcuts = this.ctx["conf"]["local"]["exitShortcuts"];
                exitShortcuts.splice(exitShortcuts.indexOf(confobj), 1);
                await this.saveShortcuts();
            });
        }
        const deleteBtn = document.createElement("button");
        const deleteIcon = document.createElement("i");
        deleteIcon.innerText = "delete";
        deleteBtn.appendChild(deleteIcon);
        deleteBox.appendChild(deleteBtn);
        elSub.appendChild(deleteBox);

        el.appendChild(elSub);

        this.shortcuts.push(el);
        this.shortcutList.appendChild(el);
        return [el, keyInput, deleteBtn];
    };
    deleteShortcut(el) {
        el.remove();
    };

    open(params) {
        this.shortcuts = [];
        // add browser specific shortcuts
        if (this.ctx["desktop"].isAvailable === true) {
            this.createShortcut("5", "ESC");
        } else {
            this.createShortcut("1", "ESC");
            this.createShortcut("1", "F11");
        }
        // add user defined shortcuts
        for (const shortcut of this.ctx["conf"]["local"]["exitShortcuts"]) {
            this.createShortcut(shortcut["delay"], Array.from(shortcut["keys"]).join(" + "), shortcut);
        }

        super.open(params);
    };
    close() {
        for (const shortcut of this.shortcuts) {
            this.deleteShortcut(shortcut);
        }
        this.shortcuts = [];
        super.close();
    };
};

export { ControlWindow };
export default ControlWindow;
