"use strict";

// the room itself: the stream and the toolbar over it. It takes the whole
// window, so the router hides the two navigation bars while it is open.

// first-party dependencies
import { Screen } from "../../src/view.js";

const RoomScreen = class extends Screen {
    static id = "room";
    static mountPoint = "body";
    static rootId = "screen-room";
    static hidesNav = true;
};

export { RoomScreen };
export default RoomScreen;
