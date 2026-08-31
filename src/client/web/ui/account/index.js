"use strict";

// the account dialog, built the same way the settings dialog is: a column of
// buttons and the three windows beside it, each one a module of its own

// first-party dependencies
import { Dialog } from "../../src/view.js";

const DEFAULT_WINDOW = "information";

const AccountDialog = class extends Dialog {
    static id = "account";
    static rootId = "dialog-account-settings";

    windowName = DEFAULT_WINDOW;
    window = null;
    buttons = null;

    async mount(ctx) {
        this.buttons = this.el.querySelectorAll("[data-window]");

        document.getElementById("btn-account-close").addEventListener("click", () => {
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

        const view = await this.ctx["ui"].loadModule("account." + name);
        if (this.windowName !== name) {
            return;
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

export { AccountDialog };
export default AccountDialog;
