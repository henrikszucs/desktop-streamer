"use strict";

// the top bar of the management segment: the settings dialog and the user menu.
// Chrome rather than a screen - see .claude/CLIENT.md for the user model.

// first-party dependencies
import { View } from "../../../src/view.js";

// the user a client is before it is anybody else, under the empty id (GUEST_ID
// in src/conf.js) - its name is a localization key, so it follows the language
const GUEST = {
    "id": "",
    "name": "main.guest",
    "avatar": "/media/guest.svg"
};

// what an account with no picture of its own is shown with
const DEFAULT_AVATAR = "/media/user.svg";

const NavTop = class extends View {
    static id = "nav-top";
    static mountPoint = "body";
    static rootId = "nav-top";

    accounts = [];                  // [{"id", "name", "avatar"}], the guest first
    currentId = GUEST["id"];        // the one this client is

    async mount(ctx) {
        this.userBtn = document.getElementById("btn-user-circle");
        this.avatarEl = document.getElementById("btn-user");
        this.switchMenu = document.getElementById("btn-user-switch-menu");
        this.addEntry = document.getElementById("btn-user-add");
        this.addTooltip = document.getElementById("btn-user-add-tooltip");
        this.logoutEntry = document.getElementById("btn-logout");

        this.logoutEntry.addEventListener("click", () => {
            this.logout();
        });

        // the server answers after this bar is mounted, and again on every
        // reconnect, so the entry follows the answer rather than the boot
        this.applyPermissions();
        ctx["server"].addEventListener("online", () => {
            this.applyPermissions();
        });

        this.setAccounts();
    };

    // the add-account entry is greyed rather than removed, and loses its
    // [data-route] - which is what stops the click in the router's handler
    applyPermissions() {
        const isAuth = this.ctx["ui"].permissions.isAuth();
        this.addEntry.classList.toggle("entry-disabled", isAuth === false);
        this.addTooltip.classList.toggle("hide", isAuth === true);
        if (isAuth === true) {
            this.addEntry.setAttribute("data-route", "login");
        } else {
            this.addEntry.removeAttribute("data-route");
        }
    };

    // the switch-account submenu, the guest first and the accounts after it. The
    // rows are rebuilt every time, so the add entry is all that stays.
    setAccounts(accounts=[], currentId=this.currentId) {
        this.accounts = [GUEST, ...accounts];
        const isKnown = this.accounts.some(function(account) {
            return account["id"] === currentId;
        });
        this.currentId = isKnown === true ? currentId : GUEST["id"];

        while (this.addEntry.nextElementSibling !== null) {
            this.addEntry.nextElementSibling.remove();
        }
        for (const account of this.accounts) {
            this.switchMenu.appendChild(this.buildAccount(account));
        }

        // the bar shows the picture of the user it is
        this.avatarEl.setAttribute("src", this.currentAccount()["avatar"] || DEFAULT_AVATAR);
    };

    currentAccount() {
        return this.accounts.find((account) => {
            return account["id"] === this.currentId;
        }) || GUEST;
    };

    // one row of the submenu, built rather than written in view.html - there is
    // one per account, and a server-given name goes in as text, never markup
    buildAccount(account) {
        const entry = document.createElement("li");
        entry.setAttribute("data-account", account["id"]);

        const avatar = document.createElement("img");
        avatar.className = "circle tiny";
        avatar.setAttribute("src", account["avatar"] || DEFAULT_AVATAR);
        entry.appendChild(avatar);

        const name = document.createElement("span");
        name.className = "max";
        if (account === GUEST) {
            name.setAttribute("data-localization", account["name"]);
            name.textContent = this.ctx["localization"].get(account["name"]);
        } else {
            name.textContent = account["name"] || "";
        }
        entry.appendChild(name);

        if (account["id"] === this.currentId) {
            const mark = document.createElement("i");
            mark.textContent = "check";
            entry.appendChild(mark);
        }

        // not a [data-route] entry, so the router does not close the menu for it
        // - the row takes the focus off the button that holds it open
        entry.addEventListener("click", () => {
            this.userBtn.blur();
            this.switchAccount(account["id"]);
        });
        return entry;
    };

    switchAccount(id) {
        if (id === this.currentId) {
            return;
        }
        this.setAccounts(this.accounts.slice(1), id);
        this.dispatchEvent(new CustomEvent("switch-account", {"detail": {"id": id}}));
    };

    // an account ends the session the server keeps; the guest has none, so its
    // sign out is forgetting the records this client holds for it
    async logout() {
        this.userBtn.blur();
        const id = this.currentId;
        if (id === GUEST["id"]) {
            await this.ctx["resetUser"](id);
        }
        this.dispatchEvent(new CustomEvent("logout", {"detail": {"id": id}}));
    };
};

export { NavTop };
export default NavTop;
