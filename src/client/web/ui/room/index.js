"use strict";

// the room itself: the stream and the toolbar over it
//
// It is the second segment of the shell rather than one more screen of the
// management side: the router takes the management chrome off the screen while
// it is open, and it mounts into the surface of its own segment rather than
// into the one the management screens share.

// first-party dependencies
import { Screen } from "../../src/view.js";

const RoomScreen = class extends Screen {
    static id = "room";
    static mountPoint = "#room-main";
    static rootId = "screen-room";
    static segment = "room";
};

export { RoomScreen };
export default RoomScreen;
