#include "wayland.h"

#if defined(IS_LINUX)

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>

#include <dlfcn.h>
#include <poll.h>


bool IsWaylandSession() {
    static const bool isWayland = []() {
        const char* backend = getenv("EASY_CONTROL_BACKEND");
        if (backend != nullptr && strcmp(backend, "wayland") == 0) {
            return true;
        }
        if (backend != nullptr && strcmp(backend, "x11") == 0) {
            return false;
        }
        const char* waylandDisplay = getenv("WAYLAND_DISPLAY");
        if (waylandDisplay != nullptr && waylandDisplay[0] != '\0') {
            return true;
        }
        const char* sessionType = getenv("XDG_SESSION_TYPE");
        return sessionType != nullptr && strcmp(sessionType, "wayland") == 0;
    }();
    return isWayland;
}


namespace {

// libwayland-client's interface description types (wayland-util.h); their
// layout is part of its stable ABI.
struct WlInterface;
struct WlMessage {
    const char* name;
    const char* signature;
    const WlInterface** types;
};
struct WlInterface {
    const char* name;
    int version;
    int methodCount;
    const WlMessage* methods;
    int eventCount;
    const WlMessage* events;
};

typedef void (*Handler)(void);

// the part of libwayland-client used here, looked up at run time
struct WlApi {
    void* (*displayConnect)(const char*);
    void (*displayDisconnect)(void*);
    int (*displayRoundtrip)(void*);
    // reading what has arrived without waiting; all null when the library
    // lacks them (then every call makes the round trips)
    int (*displayPrepareRead)(void*);
    int (*displayReadEvents)(void*);
    void (*displayCancelRead)(void*);
    int (*displayDispatchPending)(void*);
    int (*displayFlush)(void*);
    int (*displayGetFd)(void*);
    void* (*proxyMarshalConstructor)(void*, uint32_t, const WlInterface*, ...);
    void* (*proxyMarshalConstructorVersioned)(void*, uint32_t, const WlInterface*, uint32_t, ...);
    void (*proxyMarshal)(void*, uint32_t, ...);
    int (*proxyAddListener)(void*, Handler*, void*);
    void (*proxyDestroy)(void*);
    const WlInterface* registryInterface;
    const WlInterface* outputInterface;
};

// xdg-output-unstable-v1, which wayland-scanner would generate
const WlInterface* noTypes[8] = {nullptr};
const WlInterface* getXdgOutputTypes[2] = {nullptr, nullptr};   // filled once wl_output is loaded

extern const WlInterface xdgOutputInterface;
const WlMessage xdgOutputManagerMethods[] = {
    {"destroy", "", noTypes},
    {"get_xdg_output", "no", getXdgOutputTypes}
};
const WlInterface xdgOutputManagerInterface = {"zxdg_output_manager_v1", 3, 2, xdgOutputManagerMethods, 0, nullptr};

const WlMessage xdgOutputMethods[] = {
    {"destroy", "", noTypes}
};
const WlMessage xdgOutputEvents[] = {
    {"logical_position", "ii", noTypes},
    {"logical_size", "ii", noTypes},
    {"done", "", noTypes},
    {"name", "2s", noTypes},
    {"description", "2s", noTypes}
};
const WlInterface xdgOutputInterface = {"zxdg_output_v1", 3, 1, xdgOutputMethods, 5, xdgOutputEvents};

// request opcodes
const uint32_t DISPLAY_GET_REGISTRY = 1;
const uint32_t REGISTRY_BIND = 0;
const uint32_t OUTPUT_RELEASE = 0;              // wl_output v3+
const uint32_t XDG_OUTPUT_DESTROY = 0;
const uint32_t XDG_OUTPUT_MANAGER_GET_XDG_OUTPUT = 1;

const WlApi* LoadApi() {
    static bool isTried = false;
    static WlApi api;
    static const WlApi* loaded = nullptr;
    if (isTried) {
        return loaded;
    }
    isTried = true;

    void* lib = dlopen("libwayland-client.so.0", RTLD_NOW | RTLD_LOCAL);
    if (lib == nullptr) {
        return nullptr;
    }
    api.displayConnect = (void* (*)(const char*))dlsym(lib, "wl_display_connect");
    api.displayDisconnect = (void (*)(void*))dlsym(lib, "wl_display_disconnect");
    api.displayRoundtrip = (int (*)(void*))dlsym(lib, "wl_display_roundtrip");
    api.displayPrepareRead = (int (*)(void*))dlsym(lib, "wl_display_prepare_read");
    api.displayReadEvents = (int (*)(void*))dlsym(lib, "wl_display_read_events");
    api.displayCancelRead = (void (*)(void*))dlsym(lib, "wl_display_cancel_read");
    api.displayDispatchPending = (int (*)(void*))dlsym(lib, "wl_display_dispatch_pending");
    api.displayFlush = (int (*)(void*))dlsym(lib, "wl_display_flush");
    api.displayGetFd = (int (*)(void*))dlsym(lib, "wl_display_get_fd");
    if (!api.displayPrepareRead || !api.displayReadEvents || !api.displayCancelRead ||
        !api.displayDispatchPending || !api.displayFlush || !api.displayGetFd) {
        api.displayPrepareRead = nullptr;
    }
    api.proxyMarshalConstructor = (void* (*)(void*, uint32_t, const WlInterface*, ...))dlsym(lib, "wl_proxy_marshal_constructor");
    api.proxyMarshalConstructorVersioned = (void* (*)(void*, uint32_t, const WlInterface*, uint32_t, ...))dlsym(lib, "wl_proxy_marshal_constructor_versioned");
    api.proxyMarshal = (void (*)(void*, uint32_t, ...))dlsym(lib, "wl_proxy_marshal");
    api.proxyAddListener = (int (*)(void*, Handler*, void*))dlsym(lib, "wl_proxy_add_listener");
    api.proxyDestroy = (void (*)(void*))dlsym(lib, "wl_proxy_destroy");
    api.registryInterface = (const WlInterface*)dlsym(lib, "wl_registry_interface");
    api.outputInterface = (const WlInterface*)dlsym(lib, "wl_output_interface");
    if (!api.displayConnect || !api.displayDisconnect || !api.displayRoundtrip ||
        !api.proxyMarshalConstructor || !api.proxyMarshalConstructorVersioned || !api.proxyMarshal ||
        !api.proxyAddListener || !api.proxyDestroy || !api.registryInterface || !api.outputInterface) {
        dlclose(lib);
        return nullptr;
    }
    getXdgOutputTypes[0] = &xdgOutputInterface;
    getXdgOutputTypes[1] = api.outputInterface;
    loaded = &api;
    return loaded;
}

// what the compositor has said about one output
struct Output {
    uint32_t globalName = 0;
    uint32_t version = 0;
    void* wlOutput = nullptr;
    void* xdgOutput = nullptr;
    int x = 0;
    int y = 0;
    int transform = 0;
    int modeWidth = 0;
    int modeHeight = 0;
    int scale = 1;
    bool hasLogical = false;
    int logicalX = 0;
    int logicalY = 0;
    int logicalWidth = 0;
    int logicalHeight = 0;
    std::string name;           // wl_output v4 or xdg_output v2: "HDMI-A-1"
    std::string description;    // "Dell Inc. DELL U2720Q (HDMI-A-1)"
    std::string model;          // from the geometry: "DELL U2720Q"
};

// One connection kept open, so a call only has to catch up on what changed.
struct Connection {
    const WlApi* api = nullptr;
    void* display = nullptr;
    void* registry = nullptr;
    void* xdgOutputManager = nullptr;
    std::vector<Output*> outputs;
    // false until round trips have brought every output's details: after
    // connecting, and when an output was bound since
    bool isSynced = false;
};

std::mutex connectionMutex;
Connection connection;

// wl_output events
void OnGeometry(void* data, void*, int32_t x, int32_t y, int32_t, int32_t, int32_t, const char*, const char* model, int32_t transform) {
    Output* output = static_cast<Output*>(data);
    output->x = x;
    output->y = y;
    output->transform = transform;
    output->model = model != nullptr ? model : "";
}
void OnMode(void* data, void*, uint32_t flags, int32_t width, int32_t height, int32_t) {
    if (flags & 0x1) {      // WL_OUTPUT_MODE_CURRENT
        Output* output = static_cast<Output*>(data);
        output->modeWidth = width;
        output->modeHeight = height;
    }
}
void OnOutputDone(void*, void*) {}
void OnScale(void* data, void*, int32_t factor) {
    static_cast<Output*>(data)->scale = factor > 0 ? factor : 1;
}
void OnOutputName(void* data, void*, const char* name) {
    static_cast<Output*>(data)->name = name != nullptr ? name : "";
}
void OnOutputDescription(void* data, void*, const char* description) {
    static_cast<Output*>(data)->description = description != nullptr ? description : "";
}
Handler outputListener[] = {
    (Handler)OnGeometry,
    (Handler)OnMode,
    (Handler)OnOutputDone,
    (Handler)OnScale,
    (Handler)OnOutputName,
    (Handler)OnOutputDescription
};

// zxdg_output_v1 events
void OnLogicalPosition(void* data, void*, int32_t x, int32_t y) {
    Output* output = static_cast<Output*>(data);
    output->logicalX = x;
    output->logicalY = y;
    output->hasLogical = true;
}
void OnLogicalSize(void* data, void*, int32_t width, int32_t height) {
    Output* output = static_cast<Output*>(data);
    output->logicalWidth = width;
    output->logicalHeight = height;
}
void OnXdgDone(void*, void*) {}
// the same as wl_output v4 tells; kept when that told it already
void OnXdgName(void* data, void*, const char* name) {
    Output* output = static_cast<Output*>(data);
    if (output->name.empty() && name != nullptr) {
        output->name = name;
    }
}
void OnXdgDescription(void* data, void*, const char* description) {
    Output* output = static_cast<Output*>(data);
    if (output->description.empty() && description != nullptr) {
        output->description = description;
    }
}
Handler xdgOutputListener[] = {
    (Handler)OnLogicalPosition,
    (Handler)OnLogicalSize,
    (Handler)OnXdgDone,
    (Handler)OnXdgName,
    (Handler)OnXdgDescription
};

void WatchLogical(Output* output) {
    if (connection.xdgOutputManager == nullptr || output->xdgOutput != nullptr) {
        return;
    }
    output->xdgOutput = connection.api->proxyMarshalConstructor(connection.xdgOutputManager,
        XDG_OUTPUT_MANAGER_GET_XDG_OUTPUT, &xdgOutputInterface, nullptr, output->wlOutput);
    if (output->xdgOutput != nullptr) {
        connection.api->proxyAddListener(output->xdgOutput, xdgOutputListener, output);
    }
}

void ForgetOutput(Output* output) {
    const WlApi* api = connection.api;
    if (output->xdgOutput != nullptr) {
        api->proxyMarshal(output->xdgOutput, XDG_OUTPUT_DESTROY);
        api->proxyDestroy(output->xdgOutput);
    }
    if (output->wlOutput != nullptr) {
        if (output->version >= 3) {
            api->proxyMarshal(output->wlOutput, OUTPUT_RELEASE);
        }
        api->proxyDestroy(output->wlOutput);
    }
    delete output;
}

// wl_registry events
void OnGlobal(void*, void* registry, uint32_t name, const char* interface, uint32_t version) {
    const WlApi* api = connection.api;
    if (strcmp(interface, "wl_output") == 0) {
        Output* output = new Output();
        output->globalName = name;
        output->version = version < 4 ? version : 4;
        output->wlOutput = api->proxyMarshalConstructorVersioned(registry, REGISTRY_BIND,
            api->outputInterface, output->version, name, api->outputInterface->name, output->version, nullptr);
        if (output->wlOutput == nullptr) {
            delete output;
            return;
        }
        api->proxyAddListener(output->wlOutput, outputListener, output);
        connection.outputs.push_back(output);
        WatchLogical(output);
        // its details come only in answer to the bind
        connection.isSynced = false;
    } else if (strcmp(interface, "zxdg_output_manager_v1") == 0 && connection.xdgOutputManager == nullptr) {
        const uint32_t bound = version < 3 ? version : 3;
        connection.xdgOutputManager = api->proxyMarshalConstructorVersioned(registry, REGISTRY_BIND,
            &xdgOutputManagerInterface, bound, name, xdgOutputManagerInterface.name, bound, nullptr);
        for (Output* output : connection.outputs) {
            WatchLogical(output);
        }
        connection.isSynced = false;
    }
}
void OnGlobalRemove(void*, void*, uint32_t name) {
    for (auto it = connection.outputs.begin(); it != connection.outputs.end(); ++it) {
        if ((*it)->globalName == name) {
            ForgetOutput(*it);
            connection.outputs.erase(it);
            return;
        }
    }
}
Handler registryListener[] = {
    (Handler)OnGlobal,
    (Handler)OnGlobalRemove
};

void Disconnect() {
    if (connection.display == nullptr) {
        return;
    }
    // the proxies go with the connection; only the bookkeeping is freed
    for (Output* output : connection.outputs) {
        delete output;
    }
    connection.outputs.clear();
    connection.api->displayDisconnect(connection.display);
    connection.display = nullptr;
    connection.registry = nullptr;
    connection.xdgOutputManager = nullptr;
    connection.isSynced = false;
}

// Handles what the compositor has sent since the last call (outputs added,
// removed or changed), without waiting for anything; false when the
// connection broke.
bool CatchUp() {
    const WlApi* api = connection.api;
    void* display = connection.display;
    while (api->displayPrepareRead(display) != 0) {
        if (api->displayDispatchPending(display) < 0) {
            return false;
        }
    }
    api->displayFlush(display);
    struct pollfd pfd = {api->displayGetFd(display), POLLIN, 0};
    if (poll(&pfd, 1, 0) > 0) {
        if (api->displayReadEvents(display) < 0) {
            return false;
        }
    } else {
        api->displayCancelRead(display);
    }
    return api->displayDispatchPending(display) >= 0;
}

bool Connect() {
    if (connection.display != nullptr) {
        return true;
    }
    connection.api = LoadApi();
    if (connection.api == nullptr) {
        return false;
    }
    connection.display = connection.api->displayConnect(nullptr);
    if (connection.display == nullptr) {
        return false;
    }
    connection.registry = connection.api->proxyMarshalConstructor(connection.display,
        DISPLAY_GET_REGISTRY, connection.api->registryInterface, nullptr);
    if (connection.registry == nullptr) {
        Disconnect();
        return false;
    }
    connection.api->proxyAddListener(connection.registry, registryListener, nullptr);
    return true;
}

}  // namespace


bool ListWaylandOutputs(std::vector<WaylandOutput>& outputs) {
    std::lock_guard<std::mutex> lock(connectionMutex);
    outputs.clear();
    if (!Connect()) {
        return false;
    }

    // Once in sync, what changed has come as events, read without waiting:
    // a call (every Mouse.setPosition on Wayland makes one) costs no round
    // trip. Otherwise the first round trip brings the globals (and binds
    // them), the second what the newly bound outputs have to say.
    if (connection.isSynced && connection.api->displayPrepareRead != nullptr && !CatchUp()) {
        // the compositor went away; connect again on the next call
        Disconnect();
        return false;
    }
    if (!connection.isSynced || connection.api->displayPrepareRead == nullptr) {
        for (int i = 0; i < 2; i++) {
            if (connection.api->displayRoundtrip(connection.display) < 0) {
                Disconnect();
                return false;
            }
        }
        connection.isSynced = true;
    }

    for (const Output* output : connection.outputs) {
        if (output->modeWidth <= 0 || output->modeHeight <= 0) {
            continue;
        }
        // a rotated output's mode is sideways to its place in the layout
        const bool isSideways = (output->transform % 2) == 1;
        const int pixelWidth = isSideways ? output->modeHeight : output->modeWidth;
        const int pixelHeight = isSideways ? output->modeWidth : output->modeHeight;

        WaylandOutput result;
        if (output->hasLogical && output->logicalWidth > 0 && output->logicalHeight > 0) {
            result.x = output->logicalX;
            result.y = output->logicalY;
            result.width = output->logicalWidth;
            result.height = output->logicalHeight;
        } else {
            result.x = output->x;
            result.y = output->y;
            result.width = pixelWidth / output->scale;
            result.height = pixelHeight / output->scale;
        }
        result.scaleFactor = result.width > 0 ? (double)pixelWidth / result.width : 1.0;
        result.isPrimary = false;
        // an old compositor names no output: the global number still tells them apart
        result.id = !output->name.empty() ? output->name : "wl_output-" + std::to_string(output->globalName);
        const bool hasModel = !output->model.empty() && output->model != "unknown";
        result.name = hasModel ? output->model : output->description;
        outputs.push_back(result);
    }

    // Wayland has no primary output: the one at the origin stands for it
    if (!outputs.empty()) {
        size_t primary = 0;
        for (size_t i = 0; i < outputs.size(); i++) {
            if (outputs[i].x == 0 && outputs[i].y == 0) {
                primary = i;
                break;
            }
        }
        outputs[primary].isPrimary = true;
    }
    return !outputs.empty();
}

#endif
