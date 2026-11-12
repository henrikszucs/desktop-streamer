#include "mouse.h"
#include "args.h"
#include "platform.h"
#include "release_all.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <initializer_list>
#include <mutex>
#include <set>
#include <string>
#include <vector>

#if defined(IS_MACOS)
    #include "point_clamp.h"
    #include <ApplicationServices/ApplicationServices.h>
    #import <AppKit/AppKit.h>
    #include <chrono>
#elif defined(IS_LINUX)
    #include "scroll_math.h"
    #include "uinput.h"
    #include "wayland.h"
    #include <mutex>
    #include <linux/input-event-codes.h>
    #include <X11/Xlib.h>
    #include <X11/extensions/XTest.h>
    #include <X11/extensions/Xfixes.h>
#endif


// the cursor picture: RGBA, a byte per channel, row by row from the top, in
// physical pixels; empty while the pointer is hidden
struct CursorPicture {
    int width = 0;
    int height = 0;
    int xOffset = 0;
    int yOffset = 0;
    std::vector<uint8_t> rgba;
    // the colour channels are multiplied by alpha, as XFixes and AppKit give them
    bool isPremultiplied = false;
};

// What JS gets is the same on every platform: straight (not premultiplied)
// alpha, and fully transparent pixels black, whatever colour the system left
// in them.
static void NormalizeAlpha(CursorPicture& picture) {
    for (size_t i = 0; i + 3 < picture.rgba.size(); i += 4) {
        uint8_t* pixel = &picture.rgba[i];
        const unsigned int alpha = pixel[3];
        if (alpha == 0) {
            pixel[0] = pixel[1] = pixel[2] = 0;
        } else if (picture.isPremultiplied && alpha < 255) {
            for (int c = 0; c < 3; c++) {
                const unsigned int value = (pixel[c] * 255u + alpha / 2) / alpha;
                pixel[c] = (uint8_t)(value > 255 ? 255 : value);
            }
        }
    }
    picture.isPremultiplied = false;
}

static Napi::Object CursorToObject(Napi::Env env, CursorPicture picture) {
    NormalizeAlpha(picture);
    Napi::Uint8Array data = Napi::Uint8Array::New(env, picture.rgba.size());
    if (!picture.rgba.empty()) {
        memcpy(data.Data(), picture.rgba.data(), picture.rgba.size());
    }
    Napi::Object result = Napi::Object::New(env);
    result.Set("width", picture.width);
    result.Set("height", picture.height);
    result.Set("data", data);
    result.Set("xOffset", picture.xOffset);
    result.Set("yOffset", picture.yOffset);
    return result;
}

#if defined(IS_MACOS)
// The last press, for the click count of the next (see SendButton): its
// button, when and where; the count of the press and of the moves and release
// that belong to it. Used holding an InputStateLock (platform.h).
static const double CLICK_DISTANCE = 4;
static int clickButton = -1;
static CFAbsoluteTime clickTime = 0;
static CGPoint clickPoint = {0, 0};
static int64_t clickCount = 1;

// FNV-1a, to fingerprint a cursor picture where the platform has no cheaper id
static uint32_t HashBytes(const uint8_t* bytes, size_t length, uint32_t hash = 2166136261u) {
    for (size_t i = 0; i < length; i++) {
        hash ^= bytes[i];
        hash *= 16777619u;
    }
    return hash;
}
#endif

// reads the button name argument, or throws and returns false
static bool ParseButton(const Napi::CallbackInfo& info, std::string& button) {
    if (!RequireString(info, 0, button)) {
        return false;
    }
    if (button != "left" &&
        button != "middle" &&
        button != "right" &&
        button != "back" &&
        button != "forward") {
        Napi::TypeError::New(info.Env(), "Argument 1 must be 'left', 'middle', 'right', 'back' or 'forward'").ThrowAsJavaScriptException();
        return false;
    }
    return true;
}

// More notches than any wheel sends in one event; also keeps the X11 loop of
// button presses short and amount * WHEEL_DELTA in range on Windows.
static const double MAX_SCROLL_NOTCHES = 10000;

// reads the scroll arguments, or throws and returns false
static bool ParseScroll(const Napi::CallbackInfo& info, int& amount, bool& isHorizontal) {
    double notches = 0;
    if (!RequireArgs(info, 2) || !RequireFinite(info, 0, notches) || !RequireBoolean(info, 1, isHorizontal)) {
        return false;
    }
    if (std::fabs(notches) > MAX_SCROLL_NOTCHES) {
        Napi::RangeError::New(info.Env(), "Scroll amount out of range (-10000 to 10000)").ThrowAsJavaScriptException();
        return false;
    }
    amount = (int)std::trunc(notches);
    return true;
}

#if defined(IS_LINUX)
// Wayland tells no client where the pointer is, so the position is the one
// last set through easy-control (valid once isPointerSet)
static std::mutex pointerMutex;
static bool isPointerSet = false;
static double pointerX = 0;
static double pointerY = 0;

// Throws with the reason when the virtual device could not be used.
static void ThrowIfFailed(Napi::Env env, bool isDone, const std::string& error) {
    if (!isDone) {
        Napi::Error::New(env, error).ThrowAsJavaScriptException();
    }
}
#endif


#if defined(IS_MACOS)
// A warp moves the pointer at once, but to whole points only; the event posted
// after it brings the fraction a moment later, and moves still on their way
// can land after it. So for a moment after a move the pointer is where the move
// sent it, whatever the system shows. Posted moves were measured landing within
// 18 ms, on a loaded machine; a hand on the mouse goes unseen for this long.
// The target is read and written holding an InputStateLock.
static const std::chrono::milliseconds MOVE_LANDS_WITHIN(100);
static bool hasLastMove = false;
static CGPoint lastMoveTarget = CGPointZero;
static std::chrono::steady_clock::time_point lastMoveTime;

// where the pointer is; false when the system cannot tell
static bool CurrentPointer(CGPoint& pointer) {
    InputStateLock lock;
    if (hasLastMove) {
        if (std::chrono::steady_clock::now() - lastMoveTime < MOVE_LANDS_WITHIN) {
            pointer = lastMoveTarget;
            return true;
        }
        hasLastMove = false;
    }
    CGEventRef event = CGEventCreate(NULL);
    if (event == NULL) {
        return false;
    }
    pointer = CGEventGetLocation(event);
    CFRelease(event);
    return true;
}
#endif

// What converting between the pointer's and the logical coordinates needs,
// made once per call. On Windows the monitors' layout, which asks every
// monitor its DPI, so a call that reads the position and moves the pointer
// (setX, setY) makes it once; with the thread per-monitor DPI aware for as
// long as it lives. Nothing elsewhere.
#if defined(IS_WINDOWS)
struct ScreenSpace {
    DpiScope dpiScope;
    std::vector<LogicalMonitor> monitors = LayoutMonitors();
};
#else
struct ScreenSpace {};
#endif

// the pointer position in logical coordinates (see Screen.list)
static bool GetPosition(const ScreenSpace& space, double& x, double& y) {
    #if defined(IS_WINDOWS)
        POINT point;
        if (!GetCursorPos(&point)) {
            return false;
        }
        PhysicalToLogical(space.monitors, point, x, y);
        return true;

    #elif defined(IS_MACOS)
        CGPoint cursor = CGPointZero;
        if (!CurrentPointer(cursor)) {
            return false;
        }
        x = cursor.x;
        y = cursor.y;
        return true;

    #elif defined(IS_LINUX)
        if (IsWaylandSession()) {
            std::lock_guard<std::mutex> lock(pointerMutex);
            if (isPointerSet) {
                x = pointerX;
                y = pointerY;
                return true;
            }
            // not moved yet: XWayland's idea of it is the best there is
        }
        XDisplayLock lock;
        Display *display = XGetMainDisplay();
        if (display == NULL) {
            return false;
        }
        Window root = DefaultRootWindow(display);
        Window window_returned;
        int root_x, root_y;
        int win_x, win_y;
        unsigned int mask_return;
        XQueryPointer(display, root, &window_returned,
            &window_returned, &root_x, &root_y,
            &win_x, &win_y, &mask_return);
        x = root_x;
        y = root_y;
        return true;
    #endif
}

#if defined(IS_MACOS)
// the point itself when on a screen, else the nearest point of the nearest screen
static CGPoint ClampToDisplays(CGPoint point) {
    CGDirectDisplayID displays[32];
    uint32_t count = 0;
    if (CGGetActiveDisplayList(32, displays, &count) != kCGErrorSuccess) {
        return point;
    }
    PointClamp::Rect screens[32];
    for (uint32_t i = 0; i < count; i++) {
        const CGRect bounds = CGDisplayBounds(displays[i]);
        screens[i] = { bounds.origin.x, bounds.origin.y, bounds.size.width, bounds.size.height };
    }
    const PointClamp::Point clamped = PointClamp::Clamp(screens, count, { point.x, point.y });
    return CGPointMake(clamped.x, clamped.y);
}

// Posts a move to a point - posted as an event, not only warped, so
// applications see the move (and a drag while a button is held) - with the
// movement in its delta fields: applications that have detached the pointer
// from the mouse (pointer lock, games) read those, not the position.
static bool PostMove(CGPoint requested, int64_t dx, int64_t dy) {
    const CGPoint target = ClampToDisplays(requested);
    InputStateLock lock;
    CGEventType eventType = kCGEventMouseMoved;
    CGMouseButton mouseButton = kCGMouseButtonLeft;
    const uint32_t pressed = PressedButtons();
    if (pressed & (1u << kCGMouseButtonLeft)) {
        eventType = kCGEventLeftMouseDragged;
    } else if (pressed & (1u << kCGMouseButtonRight)) {
        eventType = kCGEventRightMouseDragged;
        mouseButton = kCGMouseButtonRight;
    } else if (pressed != 0) {
        eventType = kCGEventOtherMouseDragged;
        for (uint32_t b = 2; b < 32; b++) {
            if (pressed & (1u << b)) {
                mouseButton = (CGMouseButton)b;
                break;
            }
        }
    }
    CGEventRef moveEvent = CGEventCreateMouseEvent(EventSource(), eventType, target, mouseButton);
    if (moveEvent == NULL) {
        return false;
    }
    CGEventSetIntegerValueField(moveEvent, kCGMouseEventDeltaX, dx);
    CGEventSetIntegerValueField(moveEvent, kCGMouseEventDeltaY, dy);
    if (pressed != 0) {
        // a drag belongs to the press that started it
        CGEventSetIntegerValueField(moveEvent, kCGMouseEventClickState, clickCount);
    }
    CGEventSetFlags(moveEvent, ModifierFlags());
    // in this order: the warp keeps whole points only, so it may not come last
    CGWarpMouseCursorPosition(target);
    hasLastMove = true;
    lastMoveTarget = target;
    lastMoveTime = std::chrono::steady_clock::now();
    CGEventPost(kCGHIDEventTap, moveEvent);
    CFRelease(moveEvent);
    return true;
}
#endif

// moves the pointer to logical coordinates (see Screen.list)
static void MoveTo(Napi::Env env, const ScreenSpace& space, double x, double y) {
    #if defined(IS_WINDOWS)
        POINT point = LogicalToPhysical(space.monitors, x, y);
        if (!SetCursorPos(point.x, point.y)) {
            ThrowInputBlocked(env, "SetCursorPos failed");
        }

    #elif defined(IS_MACOS)
        double currentX = x;
        double currentY = y;
        GetPosition(space, currentX, currentY);
        if (!PostMove(CGPointMake(x, y), std::lround(x - currentX), std::lround(y - currentY))) {
            Napi::Error::New(env, "Failed to create mouse event").ThrowAsJavaScriptException();
        }

    #elif defined(IS_LINUX)
        if (IsWaylandSession()) {
            // the virtual pointer is absolute over the bounding box of all
            // screens, which is how compositors map such a device
            std::vector<ScreenRect> screens = ListScreens();
            if (screens.empty()) {
                Napi::Error::New(env, "No screen to move the pointer on").ThrowAsJavaScriptException();
                return;
            }
            int left = screens[0].x;
            int top = screens[0].y;
            int right = screens[0].x + screens[0].width;
            int bottom = screens[0].y + screens[0].height;
            for (const ScreenRect& screen : screens) {
                left = std::min(left, screen.x);
                top = std::min(top, screen.y);
                right = std::max(right, screen.x + screen.width);
                bottom = std::max(bottom, screen.y + screen.height);
            }
            const double clampedX = std::min(std::max(x, (double)left), (double)right - 1);
            const double clampedY = std::min(std::max(y, (double)top), (double)bottom - 1);

            std::string error;
            const bool isDone = VirtualInput::PointerMoveTo(
                (clampedX - left) / (right - left), (clampedY - top) / (bottom - top), error);
            if (isDone) {
                std::lock_guard<std::mutex> lock(pointerMutex);
                isPointerSet = true;
                pointerX = clampedX;
                pointerY = clampedY;
            }
            ThrowIfFailed(env, isDone, error);
            return;
        }
        XDisplayLock lock;
        Display *display = RequireDisplay(env);
        if (display == NULL) {
            return;
        }
        Window root = DefaultRootWindow(display);
        XWarpPointer(display, None, root, 0, 0, 0, 0, (int)std::lround(x), (int)std::lround(y));
        XFlush(display);
    #endif
}


// the pointer position, or false after throwing why it cannot be read
static bool RequirePosition(Napi::Env env, const ScreenSpace& space, double& x, double& y) {
    if (GetPosition(space, x, y)) {
        return true;
    }
    #if defined(IS_WINDOWS)
        ThrowInputBlocked(env, "GetCursorPos failed");
    #elif defined(IS_LINUX)
        Napi::Error::New(env, IsWaylandSession()
            ? "The pointer position is not known before it is set through easy-control (no XWayland to ask)"
            : "Failed to open X display").ThrowAsJavaScriptException();
    #else
        Napi::Error::New(env, "Failed to read the pointer position").ThrowAsJavaScriptException();
    #endif
    return false;
}

Napi::Value Mouse::getX(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    double x = 0;
    double y = 0;
    if (!RequirePosition(env, ScreenSpace(), x, y)) {
        return env.Undefined();
    }
    return Napi::Number::New(env, x);
}

Napi::Value Mouse::getY(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    double x = 0;
    double y = 0;
    if (!RequirePosition(env, ScreenSpace(), x, y)) {
        return env.Undefined();
    }
    return Napi::Number::New(env, y);
}

// Mouse.getPosition(): { x, y } from one read, so both belong to the same
// moment
Napi::Value Mouse::getPosition(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    double x = 0;
    double y = 0;
    if (!RequirePosition(env, ScreenSpace(), x, y)) {
        return env.Undefined();
    }
    Napi::Object position = Napi::Object::New(env);
    position.Set("x", x);
    position.Set("y", y);
    return position;
}


// reads the current cursor picture; false (and an empty picture) when there
// is none to read, e.g. the pointer is hidden
static bool ReadCursor(CursorPicture& picture) {
    #if defined(IS_WINDOWS)
        // Get information about the global cursor; none while it is hidden,
        // as getIconId() says then
        CURSORINFO ci;
        ci.cbSize = sizeof(ci);
        if (!GetCursorInfo(&ci) || !(ci.flags & CURSOR_SHOWING) || ci.hCursor == NULL) {
            return false;
        }

        // the cursor's bitmaps and a screen DC, freed on every path
        struct CursorBitmaps {
            ICONINFO iconInfo = {};
            HDC hdcScreen = NULL;
            ~CursorBitmaps() {
                if (iconInfo.hbmColor) DeleteObject(iconInfo.hbmColor);
                if (iconInfo.hbmMask) DeleteObject(iconInfo.hbmMask);
                if (hdcScreen != NULL) ReleaseDC(NULL, hdcScreen);
            }
        } bitmaps;
        ICONINFO& iconInfo = bitmaps.iconInfo;

        // Get icon information to determine actual size
        if (!GetIconInfo(ci.hCursor, &iconInfo)) {
            return false;
        }

        // Get bitmap dimensions
        BITMAP bmp;
        if (GetObject(iconInfo.hbmColor ? iconInfo.hbmColor : iconInfo.hbmMask, sizeof(BITMAP), &bmp) == 0) {
            return false;
        }
        int width = bmp.bmWidth;
        int height = iconInfo.hbmColor ? bmp.bmHeight : bmp.bmHeight / 2;

        bitmaps.hdcScreen = GetDC(NULL);
        HDC hdcScreen = bitmaps.hdcScreen;
        if (hdcScreen == NULL) {
            return false;
        }
        picture.rgba.resize((size_t)width * height * 4);
        uint8_t* out = picture.rgba.data();

        // Setup the Bitmap Info Header to pull 32-bit BGRA data
        BITMAPINFO bmi = {0};
        const auto resetHeader = [&bmi, width](int rows) {
            memset(&bmi, 0, sizeof(bmi));
            bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
            bmi.bmiHeader.biWidth = width;
            bmi.bmiHeader.biHeight = -rows; // Negative means top-down
            bmi.bmiHeader.biPlanes = 1;
            bmi.bmiHeader.biBitCount = 32;    // Enforce 32-bit (BGRA) output
            bmi.bmiHeader.biCompression = BI_RGB;
        };

        if (iconInfo.hbmColor) {
            // Buffer for Color Bitmap
            std::vector<uint8_t> colorPixels((size_t)width * height * 4);
            resetHeader(height);
            if (GetDIBits(hdcScreen, iconInfo.hbmColor, 0, height, colorPixels.data(), &bmi, DIB_RGB_COLORS) == 0) {
                return false;
            }

            // Buffer for Mask Bitmap (fallback in case color has no alpha)
            std::vector<uint8_t> maskPixels((size_t)width * height * 4);
            resetHeader(height);
            if (GetDIBits(hdcScreen, iconInfo.hbmMask, 0, height, maskPixels.data(), &bmi, DIB_RGB_COLORS) == 0) {
                return false;
            }

            // Check if the color bitmap actually utilizes the alpha channel
            bool hasAlphaChannel = false;
            for (int i = 0; i < width * height; i++) {
                if (colorPixels[i * 4 + 3] != 0) { // Alpha byte
                    hasAlphaChannel = true;
                    break;
                }
            }

            for (int i = 0; i < width * height; i++) {
                uint8_t b = colorPixels[i * 4 + 0];
                uint8_t g = colorPixels[i * 4 + 1];
                uint8_t r = colorPixels[i * 4 + 2];
                uint8_t a = colorPixels[i * 4 + 3];

                if (!hasAlphaChannel) {
                    // Windows masks: if mask pixel is white (255), the pixel is transparent.
                    // If mask pixel is black (0), the pixel is drawn.
                    uint8_t maskVal = maskPixels[i * 4 + 0]; // Any channel will do, it's grayscale
                    a = (maskVal == 0) ? 255 : 0;

                    // Clear rgb if transparent
                    if (a == 0) r = g = b = 0;
                }

                out[i * 4 + 0] = r;
                out[i * 4 + 1] = g;
                out[i * 4 + 2] = b;
                out[i * 4 + 3] = a;
            }
        }
        else {
            // Monochrome cursors (e.g. text I-beam) do not have hbmColor.
            // The top half of hbmMask is the AND mask, bottom half is XOR mask.
            std::vector<uint8_t> maskPixels((size_t)width * (height * 2) * 4);
            resetHeader(height * 2); // Full height containing both masks
            if (GetDIBits(hdcScreen, iconInfo.hbmMask, 0, height * 2, maskPixels.data(), &bmi, DIB_RGB_COLORS) == 0) {
                return false;
            }

            for (int i = 0; i < width * height; i++) {
                // Top half is AND mask
                uint8_t maskVal = maskPixels[i * 4 + 0];
                // Bottom half is XOR mask
                uint8_t xorVal = maskPixels[(i + width * height) * 4 + 0];

                uint8_t r = 0, g = 0, b = 0, a = 255;
                if (maskVal == 255 && xorVal == 0) {
                    a = 0; // Transparent
                } else if (maskVal == 0 && xorVal == 0) {
                    r = g = b = 0; // Black
                } else if (maskVal == 0 && xorVal == 255) {
                    r = g = b = 255; // White
                } else if (maskVal == 255 && xorVal == 255) {
                    // Inverted pixel (used for I-beam). We treat it as inverted grey or contrasting color.
                    r = g = b = 128;
                }

                out[i * 4 + 0] = r;
                out[i * 4 + 1] = g;
                out[i * 4 + 2] = b;
                out[i * 4 + 3] = a;
            }
        }

        picture.width = width;
        picture.height = height;
        picture.xOffset = iconInfo.xHotspot;
        picture.yOffset = iconInfo.yHotspot;
        return true;

    #elif defined(IS_MACOS)
        // Get the current cursor
        NSCursor *cursor = [NSCursor currentSystemCursor];
        if (cursor == nil) {
            return false;
        }

        NSImage *image = [cursor image];
        NSPoint hotspot = [cursor hotSpot];
        if (image == nil) {
            return false;
        }

        // the image's size is in points; it is drawn in the pixels of the
        // screen under the pointer (2 per point on Retina), as that shows it
        NSSize size = [image size];
        if (size.width <= 0 || size.height <= 0) {
            return false;
        }
        CGFloat scale = 1.0;
        const NSPoint pointer = [NSEvent mouseLocation];
        for (NSScreen *screen in [NSScreen screens]) {
            if (NSPointInRect(pointer, screen.frame)) {
                scale = screen.backingScaleFactor;
                break;
            }
        }
        const int width = (int)std::lround(size.width * scale);
        const int height = (int)std::lround(size.height * scale);
        if (width <= 0 || height <= 0) {
            return false;
        }

        // Create a bitmap representation, sized in points so drawing scales
        NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc]
            initWithBitmapDataPlanes:NULL
            pixelsWide:width
            pixelsHigh:height
            bitsPerSample:8
            samplesPerPixel:4
            hasAlpha:YES
            isPlanar:NO
            colorSpaceName:NSDeviceRGBColorSpace
            bytesPerRow:width * 4
            bitsPerPixel:32];
        if (bitmap == nil) {
            return false;
        }
        [bitmap setSize:size];

        // Draw the image into the bitmap
        [NSGraphicsContext saveGraphicsState];
        [NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap]];
        [image drawInRect:NSMakeRect(0, 0, size.width, size.height)];
        [NSGraphicsContext restoreGraphicsState];

        // RGBA, row by row from the top, alpha premultiplied (AppKit draws so)
        unsigned char *bitmapData = [bitmap bitmapData];
        if (bitmapData == NULL) {
            return false;
        }
        picture.rgba.assign(bitmapData, bitmapData + (size_t)width * height * 4);
        picture.isPremultiplied = true;

        // Nothing to see: how a pointer is hidden by a picture (CSS cursor: none).
        // CGCursorIsVisible is no help for the other ways: it stays false after
        // typing, through moves we post, while the pointer can be seen moving;
        // a remote client going by it would lose its cursor.
        bool isVisible = false;
        for (size_t i = 3; i < picture.rgba.size() && !isVisible; i += 4) {
            isVisible = picture.rgba[i] != 0;
        }
        if (!isVisible) {
            return false;
        }
        picture.width = width;
        picture.height = height;
        picture.xOffset = (int)std::lround(hotspot.x * scale);
        picture.yOffset = (int)std::lround(hotspot.y * scale);
        return true;

    #elif defined(IS_LINUX)
        XDisplayLock lock;
        Display *display = XGetMainDisplay();
        if (display == NULL) {
            return false;
        }

        // Query the cursor image using XFixes extension
        XFixesCursorImage *cursorImage = XFixesGetCursorImage(display);
        if (cursorImage == NULL) {
            return false;
        }

        int width = cursorImage->width;
        int height = cursorImage->height;
        picture.rgba.resize((size_t)width * height * 4);
        uint8_t* out = picture.rgba.data();

        // XFixes cursor pixels are ARGB, alpha premultiplied, one per unsigned long
        picture.isPremultiplied = true;
        for (int i = 0; i < width * height; i++) {
            unsigned long pixel = cursorImage->pixels[i];
            out[i * 4 + 0] = (uint8_t)((pixel >> 16) & 0xFF); // R
            out[i * 4 + 1] = (uint8_t)((pixel >> 8) & 0xFF);  // G
            out[i * 4 + 2] = (uint8_t)(pixel & 0xFF);         // B
            out[i * 4 + 3] = (uint8_t)((pixel >> 24) & 0xFF); // A
        }

        picture.width = width;
        picture.height = height;
        picture.xOffset = cursorImage->xhot;
        picture.yOffset = cursorImage->yhot;
        XFree(cursorImage);
        return true;
    #endif
}

Napi::Object Mouse::getIcon(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    CursorPicture picture;
    if (!ReadCursor(picture)) {
        picture = CursorPicture();
    }
    return CursorToObject(env, picture);
}

// A number that changes when the pointer's shape changes, and 0 while there is
// no shape to read (hidden pointer). Cheap on Windows and Linux, so it can be
// polled and getIcon called only when it changes; on macOS it is a hash of the
// picture, so it costs about as much as getIcon itself.
Napi::Number Mouse::getIconId(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    #if defined(IS_WINDOWS)
        CURSORINFO ci;
        ci.cbSize = sizeof(ci);
        if (!GetCursorInfo(&ci) || !(ci.flags & CURSOR_SHOWING) || ci.hCursor == NULL) {
            return Napi::Number::New(env, 0);
        }
        // handles are 32-bit significant, so the value is exact as a JS number
        return Napi::Number::New(env, (double)(uint32_t)(uintptr_t)ci.hCursor);

    #elif defined(IS_MACOS)
        CursorPicture picture;
        if (!ReadCursor(picture)) {
            return Napi::Number::New(env, 0);
        }
        int32_t header[4] = {picture.width, picture.height, picture.xOffset, picture.yOffset};
        uint32_t hash = HashBytes(reinterpret_cast<const uint8_t*>(header), sizeof(header));
        hash = HashBytes(picture.rgba.data(), picture.rgba.size(), hash);
        return Napi::Number::New(env, hash == 0 ? 1 : hash);

    #elif defined(IS_LINUX)
        // XFixes numbers every cursor shape it hands out (cursor_serial) and
        // notifies each change; after the first call only those notifications
        // are read, the picture is not fetched again
        static bool isSelected = false;
        static int fixesEventBase = 0;
        static unsigned long serial = 0;

        XDisplayLock lock;
        Display *display = XGetMainDisplay();
        if (display == NULL) {
            return Napi::Number::New(env, 0);
        }
        if (!isSelected) {
            int errorBase = 0;
            if (!XFixesQueryExtension(display, &fixesEventBase, &errorBase)) {
                return Napi::Number::New(env, 0);
            }
            XFixesSelectCursorInput(display, DefaultRootWindow(display), XFixesDisplayCursorNotifyMask);
            XFixesCursorImage *cursorImage = XFixesGetCursorImage(display);
            if (cursorImage != NULL) {
                serial = cursorImage->cursor_serial;
                XFree(cursorImage);
            }
            isSelected = true;
        }
        XEvent event;
        while (XCheckTypedEvent(display, fixesEventBase + XFixesCursorNotify, &event)) {
            serial = reinterpret_cast<XFixesCursorNotifyEvent*>(&event)->cursor_serial;
        }
        return Napi::Number::New(env, (double)serial);
    #endif
}


void Mouse::setX(const Napi::CallbackInfo& info) {
    double x = 0;
    if (!RequireFinite(info, 0, x)) {
        return;
    }
    ScreenSpace space;
    double currentX = 0;
    double currentY = 0;
    if (!RequirePosition(info.Env(), space, currentX, currentY)) {
        return;
    }
    MoveTo(info.Env(), space, x, currentY);
}

void Mouse::setY(const Napi::CallbackInfo& info) {
    double y = 0;
    if (!RequireFinite(info, 0, y)) {
        return;
    }
    ScreenSpace space;
    double currentX = 0;
    double currentY = 0;
    if (!RequirePosition(info.Env(), space, currentX, currentY)) {
        return;
    }
    MoveTo(info.Env(), space, currentX, y);
}

void Mouse::setPosition(const Napi::CallbackInfo& info) {
    double x = 0;
    double y = 0;
    if (!RequireArgs(info, 2) || !RequireFinite(info, 0, x) || !RequireFinite(info, 1, y)) {
        return;
    }
    MoveTo(info.Env(), ScreenSpace(), x, y);
}


// moveBy's limit, in mouse counts either way: far more than one event of a
// real mouse carries
static const double MAX_MOVE_COUNTS = 100000;
static const char* const MOVE_RANGE_MESSAGE = "Distance out of range (-100000 to 100000)";

// reads finite numbers of at most `limit` either way into `values`, one per
// argument, or throws and returns false
static bool ParseLimited(const Napi::CallbackInfo& info, double limit, const char* rangeMessage,
        std::initializer_list<double*> values) {
    if (!RequireArgs(info, values.size())) {
        return false;
    }
    size_t index = 0;
    for (double* value : values) {
        if (!RequireFinite(info, index++, *value)) {
            return false;
        }
    }
    for (double* value : values) {
        if (std::fabs(*value) > limit) {
            Napi::RangeError::New(info.Env(), rangeMessage).ThrowAsJavaScriptException();
            return false;
        }
    }
    return true;
}

// What moveBy and scroll leave over: the fractions of the units the platform
// takes, added to the next call, so many small steps add up to the right
// distance. Each call adds to it and takes out the whole units.
struct Remainder {
    double x = 0;
    double y = 0;
};
static std::mutex remainderMutex;
static Remainder moveRemainder;
static Remainder scrollRemainder;

static void TakeWhole(Remainder& remainder, double x, double y, long& wholeX, long& wholeY) {
    std::lock_guard<std::mutex> lock(remainderMutex);
    remainder.x += x;
    remainder.y += y;
    wholeX = (long)std::trunc(remainder.x);
    wholeY = (long)std::trunc(remainder.y);
    remainder.x -= wholeX;
    remainder.y -= wholeY;
}

// Moves by a distance in mouse counts, as a mouse does; what pointer-locked
// pages and games read (movementX/Y), which moving to a position never makes.
// Fractions are added to the next call; the kept fraction of an axis moved by
// 0 stays as it is.
static void MoveBy(Napi::Env env, double dx, double dy) {
    long x = 0;
    long y = 0;
    TakeWhole(moveRemainder, dx, dy, x, y);
    if (x == 0 && y == 0) {
        return;
    }

    #if defined(IS_WINDOWS)
        // Raw Input readers get the counts as they are; the visible pointer
        // moves by them after the pointer speed and acceleration settings
        INPUT input = {0};
        input.type = INPUT_MOUSE;
        input.mi.dx = x;
        input.mi.dy = y;
        input.mi.dwFlags = MOUSEEVENTF_MOVE;
        if (SendInput(1, &input, sizeof(INPUT)) != 1) {
            ThrowInputBlocked(env, "SendInput sent nothing");
        }

    #elif defined(IS_MACOS)
        // the pointer goes by the distance (kept on the displays); the delta
        // fields carry it whole, for applications that detached the pointer
        double currentX = 0;
        double currentY = 0;
        if (!RequirePosition(env, ScreenSpace(), currentX, currentY)) {
            return;
        }
        if (!PostMove(CGPointMake(currentX + x, currentY + y), x, y)) {
            Napi::Error::New(env, "Failed to create mouse event").ThrowAsJavaScriptException();
        }

    #elif defined(IS_LINUX)
        if (IsWaylandSession()) {
            std::string error;
            const bool isDone = VirtualInput::PointerMoveBy((int)x, (int)y, error);
            if (isDone) {
                // the compositor applies acceleration: where the pointer is
                // now is not known
                std::lock_guard<std::mutex> lock(pointerMutex);
                isPointerSet = false;
            }
            ThrowIfFailed(env, isDone, error);
            return;
        }
        XDisplayLock lock;
        Display *display = RequireDisplay(env);
        if (display == NULL) {
            return;
        }
        XTestFakeRelativeMotionEvent(display, (int)x, (int)y, CurrentTime);
        XFlush(display);
    #endif
}

// Mouse.moveBy(dx, dy)
void Mouse::moveBy(const Napi::CallbackInfo& info) {
    double dx = 0;
    double dy = 0;
    if (ParseLimited(info, MAX_MOVE_COUNTS, MOVE_RANGE_MESSAGE, { &dx, &dy })) {
        MoveBy(info.Env(), dx, dy);
    }
}

// Mouse.moveByX(dx): moveBy(dx, 0)
void Mouse::moveByX(const Napi::CallbackInfo& info) {
    double dx = 0;
    if (ParseLimited(info, MAX_MOVE_COUNTS, MOVE_RANGE_MESSAGE, { &dx })) {
        MoveBy(info.Env(), dx, 0);
    }
}

// Mouse.moveByY(dy): moveBy(0, dy)
void Mouse::moveByY(const Napi::CallbackInfo& info) {
    double dy = 0;
    if (ParseLimited(info, MAX_MOVE_COUNTS, MOVE_RANGE_MESSAGE, { &dy })) {
        MoveBy(info.Env(), 0, dy);
    }
}


// buttons pressed through buttonDown and not released yet, so releaseAll can
// let them go (shared by every JS environment of the process)
static std::mutex pressedButtonsMutex;
static std::set<std::string> pressedButtons;

// presses or releases a button ("left", ...); the error when it fails
static InputError SendButton(const std::string& button, bool isDown) {
    #if defined(IS_WINDOWS)
        INPUT input = {0};
        input.type = INPUT_MOUSE;

        if (button == "left") {
            input.mi.dwFlags = isDown ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
        } else if (button == "right") {
            input.mi.dwFlags = isDown ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
        } else if (button == "middle") {
            input.mi.dwFlags = isDown ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;
        } else if (button == "back") {
            input.mi.dwFlags = isDown ? MOUSEEVENTF_XDOWN : MOUSEEVENTF_XUP;
            input.mi.mouseData = XBUTTON1;
        } else if (button == "forward") {
            input.mi.dwFlags = isDown ? MOUSEEVENTF_XDOWN : MOUSEEVENTF_XUP;
            input.mi.mouseData = XBUTTON2;
        }

        if (SendInput(1, &input, sizeof(INPUT)) != 1) {
            return InputBlockedError("SendInput sent nothing");
        }

    #elif defined(IS_MACOS)
        InputStateLock lock;
        CGPoint cursor = CGPointZero;
        if (!CurrentPointer(cursor)) {
            return InputError{ "", "Failed to read the pointer position" };
        }

        CGEventType eventType = isDown ? kCGEventLeftMouseDown : kCGEventLeftMouseUp;
        CGMouseButton mouseButton = kCGMouseButtonLeft;

        if (button == "right") {
            eventType = isDown ? kCGEventRightMouseDown : kCGEventRightMouseUp;
            mouseButton = kCGMouseButtonRight;
        } else if (button == "middle") {
            eventType = isDown ? kCGEventOtherMouseDown : kCGEventOtherMouseUp;
            mouseButton = kCGMouseButtonCenter;
        } else if (button == "back") {
            eventType = isDown ? kCGEventOtherMouseDown : kCGEventOtherMouseUp;
            mouseButton = (CGMouseButton)3; // Back button
        } else if (button == "forward") {
            eventType = isDown ? kCGEventOtherMouseDown : kCGEventOtherMouseUp;
            mouseButton = (CGMouseButton)4; // Forward button
        }

        // macOS tells a double click from two clicks by the click count the
        // events carry, not by their timing: a press of the same button within
        // the double-click interval and a few points of the last one counts up
        if (isDown) {
            const CFAbsoluteTime now = CFAbsoluteTimeGetCurrent();
            const bool isRepeat = clickButton == (int)mouseButton &&
                now - clickTime <= [NSEvent doubleClickInterval] &&
                std::fabs(cursor.x - clickPoint.x) <= CLICK_DISTANCE &&
                std::fabs(cursor.y - clickPoint.y) <= CLICK_DISTANCE;
            clickCount = isRepeat ? clickCount + 1 : 1;
            clickButton = (int)mouseButton;
            clickTime = now;
            clickPoint = cursor;
        }

        CGEventRef mouseEvent = CGEventCreateMouseEvent(EventSource(), eventType, cursor, mouseButton);
        if (mouseEvent == NULL) {
            return InputError{ "", "Failed to create mouse event" };
        }
        CGEventSetIntegerValueField(mouseEvent, kCGMouseEventClickState, clickButton == (int)mouseButton ? clickCount : 1);
        CGEventSetFlags(mouseEvent, ModifierFlags());
        CGEventPost(kCGHIDEventTap, mouseEvent);
        CFRelease(mouseEvent);

        if (isDown) {
            PressedButtons() |= (1u << mouseButton);
        } else {
            PressedButtons() &= ~(1u << mouseButton);
        }

    #elif defined(IS_LINUX)
        if (IsWaylandSession()) {
            unsigned short code = BTN_LEFT;
            if (button == "middle") {
                code = BTN_MIDDLE;
            } else if (button == "right") {
                code = BTN_RIGHT;
            } else if (button == "back") {
                code = BTN_SIDE;
            } else if (button == "forward") {
                code = BTN_EXTRA;
            }
            std::string error;
            if (!VirtualInput::PointerButton(code, isDown, error)) {
                return InputError{ "", error };
            }
            return InputError();
        }
        XDisplayLock lock;
        Display *display = XGetMainDisplay();
        if (display == NULL) {
            return NoDisplayError();
        }

        unsigned int xButton = Button1;
        if (button == "middle") {
            xButton = Button2;
        } else if (button == "right") {
            xButton = Button3;
        } else if (button == "back") {
            xButton = 8; // X11 back button
        } else if (button == "forward") {
            xButton = 9; // X11 forward button
        }

        XTestFakeButtonEvent(display, xButton, isDown ? True : False, CurrentTime);
        XFlush(display);
    #endif
    return InputError();
}

static void PressButton(const Napi::CallbackInfo& info, bool isDown) {
    std::string button;
    if (!ParseButton(info, button)) {
        return;
    }
    const InputError error = SendButton(button, isDown);
    if (error.IsFailed()) {
        ThrowInputError(info.Env(), error);
        return;
    }
    std::lock_guard<std::mutex> lock(pressedButtonsMutex);
    if (isDown) {
        pressedButtons.insert(button);
    } else {
        pressedButtons.erase(button);
    }
}

// Mouse.releaseAll(): releases every button buttonDown pressed and buttonUp did
// not release yet, e.g. when the remote side of a session is gone. Every one
// is tried; those that fail stay held for the next call, and the first
// failure is thrown.
void Mouse::releaseAll(const Napi::CallbackInfo& info) {
    std::set<std::string> buttons;
    {
        std::lock_guard<std::mutex> lock(pressedButtonsMutex);
        buttons.swap(pressedButtons);
    }
    const InputError error = ReleaseEach(buttons, [](const std::string& button) {
        return SendButton(button, false);
    });
    if (!buttons.empty()) {
        std::lock_guard<std::mutex> lock(pressedButtonsMutex);
        pressedButtons.insert(buttons.begin(), buttons.end());
    }
    if (error.IsFailed()) {
        ThrowInputError(info.Env(), error);
    }
}

void Mouse::buttonDown(const Napi::CallbackInfo& info) {
    PressButton(info, true);
}

void Mouse::buttonUp(const Napi::CallbackInfo& info) {
    PressButton(info, false);
}


// scrolls `amount` notches: isForward = down (vertical) or right (horizontal)
static void Scroll(const Napi::CallbackInfo& info, bool isForward) {
    Napi::Env env = info.Env();
    int amount = 0;
    bool isHorizontal = false;
    if (!ParseScroll(info, amount, isHorizontal)) {
        return;
    }

    #if defined(IS_WINDOWS)
        INPUT input = {0};
        input.type = INPUT_MOUSE;

        if (isHorizontal) {
            // Horizontal wheel: positive tilts right, negative left
            input.mi.dwFlags = MOUSEEVENTF_HWHEEL;
            input.mi.mouseData = (isForward ? amount : -amount) * WHEEL_DELTA;
        } else {
            // Vertical wheel: positive rotates away from the user (scrolls up)
            input.mi.dwFlags = MOUSEEVENTF_WHEEL;
            input.mi.mouseData = (isForward ? -amount : amount) * WHEEL_DELTA;
        }

        if (SendInput(1, &input, sizeof(INPUT)) != 1) {
            ThrowInputBlocked(env, "SendInput sent nothing");
        }

    #elif defined(IS_MACOS)
        // wheel 1 is vertical (positive up), wheel 2 horizontal (positive left)
        const int32_t delta = isForward ? -amount : amount;
        CGEventRef scrollEvent = isHorizontal
            ? CGEventCreateScrollWheelEvent(EventSource(), kCGScrollEventUnitLine, 2, 0, delta)
            : CGEventCreateScrollWheelEvent(EventSource(), kCGScrollEventUnitLine, 1, delta);
        if (scrollEvent == NULL) {
            Napi::Error::New(env, "Failed to create scroll event").ThrowAsJavaScriptException();
            return;
        }
        {
            InputStateLock lock;
            CGEventSetFlags(scrollEvent, ModifierFlags());
        }
        CGEventPost(kCGHIDEventTap, scrollEvent);
        CFRelease(scrollEvent);

    #elif defined(IS_LINUX)
        if (amount == 0) {
            return;
        }
        if (IsWaylandSession()) {
            // REL_WHEEL counts up as positive, REL_HWHEEL right; a negative
            // amount goes the other way
            std::string error;
            const bool isDone = isHorizontal
                ? VirtualInput::PointerScroll(REL_HWHEEL, isForward ? amount : -amount, error)
                : VirtualInput::PointerScroll(REL_WHEEL, isForward ? -amount : amount, error);
            ThrowIfFailed(env, isDone, error);
            return;
        }
        XDisplayLock lock;
        Display *display = RequireDisplay(env);
        if (display == NULL) {
            return;
        }

        // buttons 4/5 scroll up/down, 6/7 left/right; a negative amount is
        // that many notches the other way
        if (amount < 0) {
            isForward = !isForward;
            amount = -amount;
        }
        unsigned int button = isHorizontal ? (isForward ? 7 : 6) : (isForward ? 5 : 4);

        // Simulate multiple scroll events based on amount
        for (int i = 0; i < amount; i++) {
            XTestFakeButtonEvent(display, button, True, CurrentTime);
            XTestFakeButtonEvent(display, button, False, CurrentTime);
        }

        XFlush(display);
    #endif
}

void Mouse::scrollDown(const Napi::CallbackInfo& info) {
    Scroll(info, true);
}

void Mouse::scrollUp(const Napi::CallbackInfo& info) {
    Scroll(info, false);
}

#if defined(IS_MACOS)
// Mouse.scroll's points per notch on macOS, which scrolls continuous (pixel)
// events by points: what Chromium scrolls for a notch of a wheel (40 px), so a
// page scrolls as far as with scrollDown(1, false)
static const double MACOS_POINTS_PER_NOTCH = 40;
#elif defined(IS_LINUX)
// the high-resolution wheel totals (120ths of a notch) Wayland's scroll has
// sent, positive down and right, to tell when they complete a notch
static long wheelTotalX = 0;
static long wheelTotalY = 0;
#endif

// Mouse.scroll(x, y): scrolls by wheel notches, fractions included - what
// touchpads and a browser's pixel wheel events need. Positive x scrolls right,
// positive y down (WheelEvent's signs). What the platform cannot send yet is
// added to the next call.
void Mouse::scroll(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    double x = 0;
    double y = 0;
    if (!ParseLimited(info, MAX_SCROLL_NOTCHES, "Scroll amount out of range (-10000 to 10000)", { &x, &y })) {
        return;
    }

    #if defined(IS_WINDOWS)
        // in 120ths of a notch (WHEEL_DELTA), which Windows takes as they are
        // (precise touchpads send such); the wheel counts up as positive
        long wheelX = 0;
        long wheelY = 0;
        TakeWhole(scrollRemainder, x * WHEEL_DELTA, y * WHEEL_DELTA, wheelX, wheelY);
        INPUT inputs[2] = {};
        UINT count = 0;
        if (wheelY != 0) {
            inputs[count].type = INPUT_MOUSE;
            inputs[count].mi.dwFlags = MOUSEEVENTF_WHEEL;
            inputs[count].mi.mouseData = (DWORD)(-wheelY);
            count++;
        }
        if (wheelX != 0) {
            inputs[count].type = INPUT_MOUSE;
            inputs[count].mi.dwFlags = MOUSEEVENTF_HWHEEL;
            inputs[count].mi.mouseData = (DWORD)wheelX;
            count++;
        }
        if (count > 0 && SendInput(count, inputs, sizeof(INPUT)) != count) {
            ThrowInputBlocked(env, "SendInput sent nothing");
        }

    #elif defined(IS_MACOS)
        // a continuous (touchpad-like) event in points; wheel 1 is vertical
        // (positive up), wheel 2 horizontal (positive left)
        long pointsX = 0;
        long pointsY = 0;
        TakeWhole(scrollRemainder, x * MACOS_POINTS_PER_NOTCH, y * MACOS_POINTS_PER_NOTCH, pointsX, pointsY);
        if (pointsX == 0 && pointsY == 0) {
            return;
        }
        CGEventRef scrollEvent = CGEventCreateScrollWheelEvent(EventSource(), kCGScrollEventUnitPixel, 2,
            (int32_t)-pointsY, (int32_t)-pointsX);
        if (scrollEvent == NULL) {
            Napi::Error::New(env, "Failed to create scroll event").ThrowAsJavaScriptException();
            return;
        }
        CGEventSetIntegerValueField(scrollEvent, kCGScrollWheelEventIsContinuous, 1);
        {
            InputStateLock lock;
            CGEventSetFlags(scrollEvent, ModifierFlags());
        }
        CGEventPost(kCGHIDEventTap, scrollEvent);
        CFRelease(scrollEvent);

    #elif defined(IS_LINUX)
        if (IsWaylandSession()) {
            // the high-resolution wheel (120ths of a notch), with the whole
            // notches it completes for readers of the plain one
            long wheelX = 0;
            long wheelY = 0;
            TakeWhole(scrollRemainder, x * 120, y * 120, wheelX, wheelY);
            long notchesX = 0;
            long notchesY = 0;
            {
                std::lock_guard<std::mutex> lock(remainderMutex);
                notchesX = AddWheel(wheelTotalX, wheelX);
                notchesY = AddWheel(wheelTotalY, wheelY);
            }
            std::string error;
            bool isDone = true;
            // REL_WHEEL counts up as positive, REL_HWHEEL right
            if (wheelY != 0) {
                isDone = VirtualInput::PointerScrollHiRes(REL_WHEEL, (int)-wheelY, (int)-notchesY, error);
            }
            if (isDone && wheelX != 0) {
                isDone = VirtualInput::PointerScrollHiRes(REL_HWHEEL, (int)wheelX, (int)notchesX, error);
            }
            ThrowIfFailed(env, isDone, error);
            return;
        }
        // XTest has only the wheel's buttons, 4/5 up/down and 6/7 left/right:
        // the fractions add up to whole notches
        long notchesX = 0;
        long notchesY = 0;
        TakeWhole(scrollRemainder, x, y, notchesX, notchesY);
        if (notchesX == 0 && notchesY == 0) {
            return;
        }
        XDisplayLock lock;
        Display *display = RequireDisplay(env);
        if (display == NULL) {
            return;
        }
        const unsigned int buttonY = notchesY > 0 ? 5 : 4;
        const unsigned int buttonX = notchesX > 0 ? 7 : 6;
        for (long i = 0; i < std::labs(notchesY); i++) {
            XTestFakeButtonEvent(display, buttonY, True, CurrentTime);
            XTestFakeButtonEvent(display, buttonY, False, CurrentTime);
        }
        for (long i = 0; i < std::labs(notchesX); i++) {
            XTestFakeButtonEvent(display, buttonX, True, CurrentTime);
            XTestFakeButtonEvent(display, buttonX, False, CurrentTime);
        }
        XFlush(display);
    #endif
}


Napi::Object Mouse::Init(Napi::Env env, Napi::Object exports) {
    Napi::Object obj = Napi::Object::New(env);
    SetFunction(env, obj, "getX", Mouse::getX);
    SetFunction(env, obj, "getY", Mouse::getY);
    SetFunction(env, obj, "getPosition", Mouse::getPosition);

    SetFunction(env, obj, "getIcon", Mouse::getIcon);
    SetFunction(env, obj, "getIconId", Mouse::getIconId);

    SetFunction(env, obj, "setX", Mouse::setX);
    SetFunction(env, obj, "setY", Mouse::setY);
    SetFunction(env, obj, "setPosition", Mouse::setPosition);
    SetFunction(env, obj, "moveBy", Mouse::moveBy);
    SetFunction(env, obj, "moveByX", Mouse::moveByX);
    SetFunction(env, obj, "moveByY", Mouse::moveByY);

    SetFunction(env, obj, "buttonDown", Mouse::buttonDown);
    SetFunction(env, obj, "buttonUp", Mouse::buttonUp);
    SetFunction(env, obj, "releaseAll", Mouse::releaseAll);

    SetFunction(env, obj, "scrollDown", Mouse::scrollDown);
    SetFunction(env, obj, "scrollUp", Mouse::scrollUp);
    SetFunction(env, obj, "scroll", Mouse::scroll);
    return obj;
}
