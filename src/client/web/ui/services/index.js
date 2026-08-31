"use strict";

// the services this device rents out, still only the empty screen behind the
// route the server configuration switches on

// first-party dependencies
import { Screen } from "../../src/view.js";

const ServiceScreen = class extends Screen {
    static id = "services";
    static rootId = "screen-services";
};

export { ServiceScreen };
export default ServiceScreen;
