"use strict";

// the account dialog, built the same way the settings dialog is: a column of
// buttons and the windows beside it, each one a module of its own. The column
// is not the same for every user - the guest is a name and a way to be
// forgotten, an account has the information, sessions and delete windows - so
// open() shows the buttons of the user this client is and starts on the first.

// first-party dependencies
import { Dialog } from "../../../src/view.js";

const AccountDialog = class extends Dialog {
    static id = "account";
    static rootId = "dialog-account-settings";

    windowName = "";
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

    // the user this client is names its buttons; the rest stay out of the column
    userKind() {
        return this.ctx["ui"].permissions.isGuest() === true ? "guest" : "account";
    };

    showButtons(kind) {
        for (const button of this.buttons) {
            button.classList.toggle("hide", button.getAttribute("data-user") !== kind);
        }
    };

    // the windows of one user, in the order of the column
    windowNames(kind) {
        return [...this.buttons].filter(function(button) {
            return button.getAttribute("data-user") === kind;
        }).map(function(button) {
            return button.getAttribute("data-window");
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

    // the window it was last on, unless that belongs to the other kind of user
    open(params) {
        super.open(params);
        const kind = this.userKind();
        const names = this.windowNames(kind);
        this.showButtons(kind);
        if (names.includes(this.windowName) === false) {
            this.windowName = names[0];
        }
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
