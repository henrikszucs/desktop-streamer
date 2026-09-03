"use strict";

// the top bar of the management segment: the settings dialog, and the user menu
//
// It is chrome rather than a screen, so the router puts it on and off the screen
// by its data-segment attribute and never opens or closes it. Both entries it
// carries are [data-dialog], which the delegated handler in the router answers,
// so there is nothing to wire here.
//
// The user menu follows the sign-in state, and the server answers nothing about
// it today (see dev/plans/ws-accounts.md). The markup it starts from - the
// logged out menu shown, the logged in one hidden - is what a client without
// sign-in shows, so nothing switches between them until the transport carries
// an account again.

// first-party dependencies
import { View } from "../../../src/view.js";

const NavTop = class extends View {
    static id = "nav-top";
    static mountPoint = "body";
    static rootId = "nav-top";
};

export { NavTop };
export default NavTop;
