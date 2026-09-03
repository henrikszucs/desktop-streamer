"use strict";

// the room itself: the stream and the toolbar over it. It is the second segment
// of the shell rather than one more management screen, with its own surface.

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
