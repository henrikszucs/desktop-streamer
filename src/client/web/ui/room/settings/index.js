"use strict";

// what a room shares and under what name. The markup is there, nothing opens it
// yet - the room screen is the next thing to be built.

// first-party dependencies
import { Dialog } from "../../../src/view.js";

const RoomSettingsDialog = class extends Dialog {
    static id = "room-settings";
    static rootId = "dialog-room-settings";
};

export { RoomSettingsDialog };
export default RoomSettingsDialog;
