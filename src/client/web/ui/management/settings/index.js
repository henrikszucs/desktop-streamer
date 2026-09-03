"use strict";

// the settings dialog: the column of buttons, and a router of its own over the
// five windows beside it. Each window is a module in a folder below this one and
// arrives the first time it is asked for, so opening the dialog costs the
// appearance window and nothing else.

// first-party dependencies
import { Dialog } from "../../../src/view.js";

const DEFAULT_WINDOW = "appearance";

const SettingsDialog = class extends Dialog {
    static id = "settings";
    static rootId = "dialog-settings";

    windowName = DEFAULT_WINDOW;
    window = null;
    buttons = null;

    async mount(ctx) {
        this.buttons = this.el.querySelectorAll("[data-window]");

        document.getElementById("btn-settings-close").addEventListener("click", () => {
            this.requestClose();
        });
        this.el.addEventListener("click", (event) => {
            const button = event.target.closest("[data-window]");
            if (button === null) {
                return;
            }
            this.changeWindow(button.getAttribute("data-window"));
        });
    };

    // the button of the open window is filled in, the rest are outlined
    markButtons(name) {
        for (const button of this.buttons) {
            if (button.getAttribute("data-window") === name) {
                button.classList.add("primary");
                button.classList.remove("fill");
            } else {
                button.classList.remove("primary");
                button.classList.add("fill");
            }
        }
    };

    async changeWindow(name) {
        if (name === this.windowName && this.window !== null) {
            return;
        }
        this.window?.close();
        this.window = null;
        this.windowName = name;
        this.markButtons(name);

        const view = await this.ctx["ui"].loadModule("settings." + name);
        if (this.windowName !== name) {
            return;     // another window was picked while this one loaded
        }
        this.window = view;
        view.open();
    };

    open(params) {
        super.open(params);
        this.markButtons(this.windowName);
        this.changeWindow(this.windowName);
    };
    close() {
        this.window?.close();
        this.window = null;
        super.close();
    };
};

export { SettingsDialog };
export default SettingsDialog;
