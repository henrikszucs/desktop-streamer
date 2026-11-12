#include "screen.h"
#include "args.h"
#include "platform.h"

#include <algorithm>
#include <string>
#include <vector>

#if defined(IS_WINDOWS)
    #include "screen_layout.h"
    #include <cmath>
    #include <map>
    #include <shellscalingapi.h>
#elif defined(IS_MACOS)
    #include <ApplicationServices/ApplicationServices.h>
    #include <CoreGraphics/CoreGraphics.h>
    #import <AppKit/AppKit.h>
#elif defined(IS_LINUX)
    #include "wayland.h"
    #include <X11/Xlib.h>
    #include <X11/extensions/Xrandr.h>
#endif


#if defined(IS_WINDOWS)
static double MonitorScale(HMONITOR hMonitor) {
    UINT dpiX = 96;
    UINT dpiY = 96;
    if (!SUCCEEDED(GetDpiForMonitor(hMonitor, MDT_EFFECTIVE_DPI, &dpiX, &dpiY))) {
        // Fallback to system DPI
        HDC hdc = GetDC(NULL);
        dpiX = GetDeviceCaps(hdc, LOGPIXELSX);
        ReleaseDC(NULL, hdc);
    }
    return (double)dpiX / 96.0;
}

static BOOL CALLBACK MonitorEnumProc(HMONITOR hMonitor, HDC hdcMonitor, LPRECT lprcMonitor, LPARAM dwData) {
    std::vector<MonitorLayout>* monitors = reinterpret_cast<std::vector<MonitorLayout>*>(dwData);

    MONITORINFOEXW monitorInfo;
    monitorInfo.cbSize = sizeof(MONITORINFOEXW);
    if (GetMonitorInfoW(hMonitor, &monitorInfo)) {
        MonitorLayout monitor;
        monitor.rect = monitorInfo.rcMonitor;
        monitor.device = monitorInfo.szDevice;
        monitor.scaleFactor = MonitorScale(hMonitor);
        monitor.isPrimary = (monitorInfo.dwFlags & MONITORINFOF_PRIMARY) != 0;
        monitors->push_back(monitor);
    }
    return TRUE; // Continue enumeration
}

// the monitors' names for people ("DELL U2720Q"), by GDI device name, from
// the display configuration; a built-in panel often has none
static std::map<std::wstring, std::wstring> MonitorNames() {
    std::map<std::wstring, std::wstring> names;
    UINT32 pathCount = 0;
    UINT32 modeCount = 0;
    if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &pathCount, &modeCount) != ERROR_SUCCESS) {
        return names;
    }
    std::vector<DISPLAYCONFIG_PATH_INFO> paths(pathCount);
    std::vector<DISPLAYCONFIG_MODE_INFO> modes(modeCount);
    if (QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, &pathCount, paths.data(), &modeCount, modes.data(), nullptr) != ERROR_SUCCESS) {
        return names;
    }
    for (UINT32 i = 0; i < pathCount; i++) {
        DISPLAYCONFIG_SOURCE_DEVICE_NAME source = {};
        source.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
        source.header.size = sizeof(source);
        source.header.adapterId = paths[i].sourceInfo.adapterId;
        source.header.id = paths[i].sourceInfo.id;
        DISPLAYCONFIG_TARGET_DEVICE_NAME target = {};
        target.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
        target.header.size = sizeof(target);
        target.header.adapterId = paths[i].targetInfo.adapterId;
        target.header.id = paths[i].targetInfo.id;
        // a mirrored screen shows on several monitors: the first names it
        if (DisplayConfigGetDeviceInfo(&source.header) == ERROR_SUCCESS &&
            DisplayConfigGetDeviceInfo(&target.header) == ERROR_SUCCESS) {
            names.emplace(source.viewGdiDeviceName, target.monitorFriendlyDeviceName);
        }
    }
    return names;
}

static Napi::String WideString(Napi::Env env, const std::wstring& text) {
    return Napi::String::New(env, std::u16string(text.begin(), text.end()));
}

static std::vector<MonitorLayout> ListMonitors() {
    std::vector<MonitorLayout> monitors;
    EnumDisplayMonitors(NULL, NULL, MonitorEnumProc, reinterpret_cast<LPARAM>(&monitors));
    return monitors;
}

// Lay the monitors out in logical pixels, as Electron's screen API does
// (screen_layout.h): the primary monitor first, every monitor touching a
// placed one put against it.
std::vector<LogicalMonitor> LayoutMonitors() {
    std::vector<LogicalMonitor> monitors;
    std::vector<ScreenLayout::PhysicalMonitor> physical;
    for (const MonitorLayout& layout : ListMonitors()) {
        LogicalMonitor monitor;
        monitor.layout = layout;
        monitors.push_back(monitor);
        physical.push_back({ layout.rect.left, layout.rect.top, layout.rect.right, layout.rect.bottom,
            (float)layout.scaleFactor });
    }
    const std::vector<ScreenLayout::LogicalRect> rects = ScreenLayout::Layout(physical);
    for (size_t i = 0; i < monitors.size(); i++) {
        monitors[i].x = rects[i].x;
        monitors[i].y = rects[i].y;
        monitors[i].width = rects[i].width;
        monitors[i].height = rects[i].height;
    }
    return monitors;
}

void PhysicalToLogical(const std::vector<LogicalMonitor>& monitors, POINT point, double& x, double& y) {
    // the monitor holding the point, or the nearest one
    const LogicalMonitor* found = nullptr;
    double bestDistance = 0;
    for (const LogicalMonitor& monitor : monitors) {
        const RECT& r = monitor.layout.rect;
        const double dx = (point.x < r.left) ? (r.left - point.x) : (point.x >= r.right ? point.x - r.right + 1 : 0);
        const double dy = (point.y < r.top) ? (r.top - point.y) : (point.y >= r.bottom ? point.y - r.bottom + 1 : 0);
        const double distance = dx * dx + dy * dy;
        if (found == nullptr || distance < bestDistance) {
            found = &monitor;
            bestDistance = distance;
        }
    }
    if (found == nullptr) {
        x = point.x;
        y = point.y;
        return;
    }
    const RECT& r = found->layout.rect;
    x = found->x + (point.x - r.left) / found->layout.scaleFactor;
    y = found->y + (point.y - r.top) / found->layout.scaleFactor;
}

POINT LogicalToPhysical(const std::vector<LogicalMonitor>& monitors, double x, double y) {
    // the monitor holding the point, or the nearest one
    const LogicalMonitor* found = nullptr;
    double bestDistance = 0;
    for (const LogicalMonitor& monitor : monitors) {
        const double right = (double)monitor.x + monitor.width;
        const double bottom = (double)monitor.y + monitor.height;
        const double dx = (x < monitor.x) ? (monitor.x - x) : (x >= right ? x - right + 1 : 0);
        const double dy = (y < monitor.y) ? (monitor.y - y) : (y >= bottom ? y - bottom + 1 : 0);
        const double distance = dx * dx + dy * dy;
        if (found == nullptr || distance < bestDistance) {
            found = &monitor;
            bestDistance = distance;
        }
    }

    POINT point;
    if (found == nullptr) {
        point.x = std::lround(x);
        point.y = std::lround(y);
        return point;
    }
    const RECT& r = found->layout.rect;
    const double scale = found->layout.scaleFactor;
    point.x = r.left + std::lround((x - found->x) * scale);
    point.y = r.top + std::lround((y - found->y) * scale);

    // keep it on that monitor
    point.x = (point.x < r.left) ? r.left : (point.x > r.right - 1 ? r.right - 1 : point.x);
    point.y = (point.y < r.top) ? r.top : (point.y > r.bottom - 1 ? r.bottom - 1 : point.y);
    return point;
}
#endif

#if defined(IS_LINUX)
// the monitor name an output's EDID gives ("DELL U2720Q"), "" when none
static std::string EdidMonitorName(Display* display, RROutput output) {
    const Atom edidAtom = XInternAtom(display, RR_PROPERTY_RANDR_EDID, True);
    if (edidAtom == None) {
        return "";
    }
    Atom type;
    int format = 0;
    unsigned long count = 0;
    unsigned long remaining = 0;
    unsigned char* edid = nullptr;
    std::string name;
    if (XRRGetOutputProperty(display, output, edidAtom, 0, 64, False, False, AnyPropertyType,
            &type, &format, &count, &remaining, &edid) == Success && edid != nullptr && format == 8 && count >= 128) {
        // four 18-byte descriptors from byte 54; type 0xFC is the monitor name,
        // up to 13 characters ended by a line feed
        for (int offset = 54; offset <= 108 && name.empty(); offset += 18) {
            if (edid[offset] == 0 && edid[offset + 1] == 0 && edid[offset + 3] == 0xFC) {
                for (int i = 5; i < 18 && edid[offset + i] != 0x0A; i++) {
                    name += (char)edid[offset + i];
                }
                while (!name.empty() && name.back() == ' ') {
                    name.pop_back();
                }
            }
        }
    }
    if (edid != nullptr) {
        XFree(edid);
    }
    return name;
}

// the screens as XRandR reports them. X11 has no logical coordinate space: the
// mouse and the screens are both in pixels, so the scale factor is 1.0 - a
// desktop's own UI scaling (GDK_SCALE, Xft.dpi, ...) does not change them.
static std::vector<ScreenRect> ListXScreens() {
    std::vector<ScreenRect> screens;
    XDisplayLock lock;
    Display *display = XGetMainDisplay();
    if (display == NULL) {
        return screens;
    }

    Window root = DefaultRootWindow(display);

    // Check if XRandR extension is available
    int eventBase, errorBase;
    if (XRRQueryExtension(display, &eventBase, &errorBase)) {
        // the current configuration, without probing the outputs again
        XRRScreenResources *screenRes = XRRGetScreenResourcesCurrent(display, root);

        if (screenRes) {
            // Get primary output
            RROutput primary = XRRGetOutputPrimary(display, root);

            for (int i = 0; i < screenRes->noutput; i++) {
                XRROutputInfo *outputInfo = XRRGetOutputInfo(display, screenRes, screenRes->outputs[i]);
                if (outputInfo == NULL) {
                    continue;
                }

                if (outputInfo->connection == RR_Connected && outputInfo->crtc) {
                    XRRCrtcInfo *crtcInfo = XRRGetCrtcInfo(display, screenRes, outputInfo->crtc);
                    if (crtcInfo) {
                        ScreenRect screen;
                        screen.x = crtcInfo->x;
                        screen.y = crtcInfo->y;
                        screen.width = (int)crtcInfo->width;
                        screen.height = (int)crtcInfo->height;
                        screen.scaleFactor = 1.0;
                        screen.isPrimary = (screenRes->outputs[i] == primary);
                        screen.id = std::string(outputInfo->name, outputInfo->nameLen);
                        screen.name = EdidMonitorName(display, screenRes->outputs[i]);
                        screens.push_back(screen);
                        XRRFreeCrtcInfo(crtcInfo);
                    }
                }

                XRRFreeOutputInfo(outputInfo);
            }

            XRRFreeScreenResources(screenRes);
        }
    }

    // no output set as primary (Xvfb, some minimal desktops): the one at the
    // origin stands for it, as on Wayland
    const bool hasPrimary = std::any_of(screens.begin(), screens.end(), [](const ScreenRect& screen) {
        return screen.isPrimary;
    });
    if (!screens.empty() && !hasPrimary) {
        auto origin = std::find_if(screens.begin(), screens.end(), [](const ScreenRect& screen) {
            return screen.x == 0 && screen.y == 0;
        });
        (origin != screens.end() ? *origin : screens.front()).isPrimary = true;
    }

    if (screens.empty()) {
        // Fallback: Single screen without XRandR
        int screenNumber = DefaultScreen(display);
        ScreenRect screen;
        screen.x = 0;
        screen.y = 0;
        screen.width = DisplayWidth(display, screenNumber);
        screen.height = DisplayHeight(display, screenNumber);
        screen.scaleFactor = 1.0;
        screen.isPrimary = true;
        screen.id = "default";
        screen.name = "";
        screens.push_back(screen);
    }
    return screens;
}

std::vector<ScreenRect> ListScreens() {
    // in a Wayland session the compositor knows the layout in its logical
    // coordinates; XWayland only has its own pixels of it
    if (IsWaylandSession()) {
        std::vector<WaylandOutput> outputs;
        if (ListWaylandOutputs(outputs)) {
            std::vector<ScreenRect> screens;
            for (const WaylandOutput& output : outputs) {
                screens.push_back({output.x, output.y, output.width, output.height, output.scaleFactor, output.isPrimary,
                    output.id, output.name});
            }
            return screens;
        }
    }
    return ListXScreens();
}
#endif

Napi::Array IScreen::list(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    Napi::Array result = Napi::Array::New(env);

    #if defined(IS_WINDOWS)
        DpiScope dpiScope;
        std::vector<LogicalMonitor> monitors = LayoutMonitors();
        const std::map<std::wstring, std::wstring> names = MonitorNames();

        for (uint32_t i = 0; i < (uint32_t)monitors.size(); i++) {
            Napi::Object screenObj = Napi::Object::New(env);
            const std::wstring& device = monitors[i].layout.device;
            const auto name = names.find(device);
            screenObj.Set("id", WideString(env, device));
            screenObj.Set("name", WideString(env, name != names.end() ? name->second : std::wstring()));
            screenObj.Set("isPrimary", Napi::Boolean::New(env, monitors[i].layout.isPrimary));
            screenObj.Set("width", Napi::Number::New(env, monitors[i].width));
            screenObj.Set("height", Napi::Number::New(env, monitors[i].height));
            screenObj.Set("x", Napi::Number::New(env, monitors[i].x));
            screenObj.Set("y", Napi::Number::New(env, monitors[i].y));
            screenObj.Set("scaleFactor", Napi::Number::New(env, monitors[i].layout.scaleFactor));

            result.Set(i, screenObj);
        }

    #elif defined(IS_MACOS)
        uint32_t displayCount = 0;
        CGDirectDisplayID displays[32]; // Support up to 32 displays

        // Get all active displays
        if (CGGetActiveDisplayList(32, displays, &displayCount) == kCGErrorSuccess) {
            CGDirectDisplayID mainDisplay = CGMainDisplayID();

            for (uint32_t i = 0; i < displayCount; i++) {
                Napi::Object screenObj = Napi::Object::New(env);

                CGDirectDisplayID display = displays[i];

                // Check if this is the primary (main) display
                bool isPrimary = (display == mainDisplay);

                // Display bounds in points, in the global display space: origin at
                // the top left of the main display, y growing downward - the same
                // space CGEventGetLocation reports the mouse in
                CGRect bounds = CGDisplayBounds(display);

                // Backing scale factor (2 on Retina displays)
                double scaleFactor = 1.0;
                CGDisplayModeRef mode = CGDisplayCopyDisplayMode(display);
                if (mode) {
                    size_t pixelWidth = CGDisplayModeGetPixelWidth(mode);
                    if (pixelWidth > 0 && bounds.size.width > 0) {
                        scaleFactor = pixelWidth / bounds.size.width;
                    }
                    CGDisplayModeRelease(mode);
                }

                // the name System Settings shows, from the NSScreen of the display
                std::string name;
                for (NSScreen* screen in [NSScreen screens]) {
                    NSNumber* number = screen.deviceDescription[@"NSScreenNumber"];
                    if (number != nil && number.unsignedIntValue == display) {
                        if (@available(macOS 10.15, *)) {
                            if (screen.localizedName != nil) {
                                name = [screen.localizedName UTF8String];
                            }
                        }
                        break;
                    }
                }

                screenObj.Set("id", Napi::String::New(env, std::to_string(display)));
                screenObj.Set("name", Napi::String::New(env, name));
                screenObj.Set("isPrimary", Napi::Boolean::New(env, isPrimary));
                screenObj.Set("width", Napi::Number::New(env, (int)bounds.size.width));
                screenObj.Set("height", Napi::Number::New(env, (int)bounds.size.height));
                screenObj.Set("x", Napi::Number::New(env, (int)bounds.origin.x));
                screenObj.Set("y", Napi::Number::New(env, (int)bounds.origin.y));
                screenObj.Set("scaleFactor", Napi::Number::New(env, scaleFactor));

                result.Set(i, screenObj);
            }
        }

    #elif defined(IS_LINUX)
        std::vector<ScreenRect> screens = ListScreens();
        for (uint32_t i = 0; i < (uint32_t)screens.size(); i++) {
            Napi::Object screenObj = Napi::Object::New(env);
            screenObj.Set("id", Napi::String::New(env, screens[i].id));
            screenObj.Set("name", Napi::String::New(env, screens[i].name));
            screenObj.Set("isPrimary", Napi::Boolean::New(env, screens[i].isPrimary));
            screenObj.Set("width", Napi::Number::New(env, screens[i].width));
            screenObj.Set("height", Napi::Number::New(env, screens[i].height));
            screenObj.Set("x", Napi::Number::New(env, screens[i].x));
            screenObj.Set("y", Napi::Number::New(env, screens[i].y));
            screenObj.Set("scaleFactor", Napi::Number::New(env, screens[i].scaleFactor));
            result.Set(i, screenObj);
        }

    #endif

    return result;
}


Napi::Object IScreen::Init(Napi::Env env, Napi::Object exports) {
    Napi::Object obj = Napi::Object::New(env);
    SetFunction(env, obj, "list", IScreen::list);
    return obj;
}
