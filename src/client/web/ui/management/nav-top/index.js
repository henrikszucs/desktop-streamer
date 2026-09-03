"use strict";

// the top bar of the management segment: the settings dialog, and the user menu
//
// It is chrome rather than a screen, so the router puts it on and off the screen
// by its data-segment attribute and never opens or closes it. The entries that
// lead somewhere are [data-dialog] or [data-route], which the delegated handler
// in the router answers, so only the account rows and the sign out are wired
// here.
//
// There is no signed out state: the client starts as the guest, a user with
// nothing behind it, and signing in adds one more user beside it rather than
// replacing it. So the menu is the menu of an account throughout, and the parts
// an account has and the guest does not - the account dialog, the session the
// server would end - are the parts that follow the current user.
//
// Nothing carries accounts today (dev/plans/ws-accounts.md), so the list stays
// the guest alone and setAccounts() waits there for the rest.

// first-party dependencies
import { View } from "../../../src/view.js";

// the user a client is before it is anybody else
//
// Its id is the empty one: every user this client keeps records for is a row of
// the one user table under its own id, and the guest is the row with no account
// behind it (see GUEST_ID in src/conf.js). Its name is a string of the shell
// rather than a value of its own, so the row carries the key and follows a
// language change like the rest of the bar.
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

        // whether there is any sign-in to add an account with is the server's
        // answer, and it arrives after this bar is mounted - and again after
        // every reconnect, which may be a server configured differently. So the
        // entry follows the answer rather than the boot.
        this.applyPermissions();
        ctx["server"].addEventListener("online", () => {
            this.applyPermissions();
        });

        this.setAccounts();
    };

    //
    // the permissions
    //
    // the entry that adds an account, against a server that may have no sign-in
    // at all. It is left in the menu rather than taken out of it: an entry that
    // is gone says nothing, and what the user needs to know is that the account
    // is refused by the administrator and not by this client. So it is greyed,
    // it carries the reason in its tooltip, and the route is taken off it -
    // which is what stops the click, since the delegated handler of the router
    // walks past an element with no [data-route].
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

    //
    // the users
    //
    // the accounts of the switch-account submenu, under the entry that adds one
    // more: the guest is always the first of them and the one the client starts
    // as, and everything after it comes from the server. The rows are rebuilt
    // from the list every time, so the add entry is the one thing that stays
    // and everything after it belongs to this call.
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

    // one row of the submenu: the picture of the user, its name, and the mark on
    // the one this client is. It is built rather than written in view.html
    // because there is one per account, and a name that comes from the server
    // goes in as text, never as markup.
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

        // the menu stays open while the button it hangs on holds the focus, and
        // this row is not one of the [data-route] entries the router closes it
        // for, so it takes the focus off itself
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

    //
    // signing out
    //
    // For an account this ends the session the server keeps, and nothing
    // carries one today. For the guest there is no session at all: what it has
    // is the records this client keeps for it - the connections reachable
    // without an account - and forgetting those is the reset the entry offers.
    // The local configuration is not part of it, so the theme and the language
    // survive a guest sign out.
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
