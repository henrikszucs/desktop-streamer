#include "mouse.h"

#include <vector>

#if defined(IS_WINDOWS)
    #include <shellscalingapi.h>
    #pragma comment(lib, "Shcore.lib")
#elif defined(IS_MACOS)
    #include <ApplicationServices/ApplicationServices.h>
    #import <AppKit/AppKit.h>
#elif defined(IS_LINUX)
    #include <stdlib.h>
    #include <X11/Xlib.h>
    #include <X11/extensions/XTest.h>
    #include <X11/extensions/Xfixes.h>

    // Helper function to get the main X11 display
    // Returns a singleton Display* connection
    inline Display* XGetMainDisplay() {
        static Display* display = nullptr;
        if (display == nullptr) {
            display = XOpenDisplay(nullptr);
        }
        return display;
    }
#endif


Napi::Number Mouse::getX(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    #if defined(IS_WINDOWS)
        POINT point;
        GetCursorPos(&point);
        
        // Get the monitor that contains this point
        HMONITOR hMonitor = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
        
        // Get DPI for this monitor
        UINT dpiX = 96;
        UINT dpiY = 96;
        
        HRESULT hr = GetDpiForMonitor(hMonitor, MDT_EFFECTIVE_DPI, &dpiX, &dpiY);
        if (!SUCCEEDED(hr)) {
            // Fallback to system DPI
            HDC hdc = GetDC(NULL);
            dpiX = GetDeviceCaps(hdc, LOGPIXELSX);
            ReleaseDC(NULL, hdc);
        }
        
        // Calculate scale factor
        double scaleFactor = (double)dpiX / 96.0;
        
        // Return logical position (physical position / scale factor)
        return Napi::Number::New(env, (double)point.x / scaleFactor);

    #elif defined(IS_MACOS)
        CGEventRef event = CGEventCreate(NULL);
        CGPoint cursor = CGEventGetLocation(event);
        CFRelease(event);
        return Napi::Number::New(env, cursor.x);

    #elif defined(IS_LINUX)
        Display *display = XGetMainDisplay();
        if (display == NULL) {
            return Napi::Number::New(env, 0);
        }
        
        Window root = DefaultRootWindow(display);
        Window window_returned;
        int root_x, root_y;
        int win_x, win_y;
        unsigned int mask_return;
        
        XQueryPointer(display, root, &window_returned,
            &window_returned, &root_x, &root_y,
            &win_x, &win_y, &mask_return);
        
        return Napi::Number::New(env, root_x);

    #endif
}

Napi::Number Mouse::getY(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    #if defined(IS_WINDOWS)
        POINT point;
        GetCursorPos(&point);
        
        // Get the monitor that contains this point
        HMONITOR hMonitor = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
        
        // Get DPI for this monitor
        UINT dpiX = 96;
        UINT dpiY = 96;
        
        HRESULT hr = GetDpiForMonitor(hMonitor, MDT_EFFECTIVE_DPI, &dpiX, &dpiY);
        if (!SUCCEEDED(hr)) {
            // Fallback to system DPI
            HDC hdc = GetDC(NULL);
            dpiY = GetDeviceCaps(hdc, LOGPIXELSY);
            ReleaseDC(NULL, hdc);
        }
        
        // Calculate scale factor
        double scaleFactor = (double)dpiY / 96.0;
        
        // Return logical position (physical position / scale factor)
        return Napi::Number::New(env, (double)point.y / scaleFactor);

    #elif defined(IS_MACOS)
        CGEventRef event = CGEventCreate(NULL);
        CGPoint cursor = CGEventGetLocation(event);
        CFRelease(event);
        return Napi::Number::New(env, cursor.y);

    #elif defined(IS_LINUX)
        Display *display = XGetMainDisplay();
        if (display == NULL) {
            return Napi::Number::New(env, 0);
        }
        
        Window root = DefaultRootWindow(display);
        Window window_returned;
        int root_x, root_y;
        int win_x, win_y;
        unsigned int mask_return;
        
        XQueryPointer(display, root, &window_returned, 
            &window_returned, &root_x, &root_y,
            &win_x, &win_y, &mask_return);
        
        return Napi::Number::New(env, root_y);

    #endif
}


Napi::Object Mouse::getIcon(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);

    #if defined(IS_WINDOWS)
        // Get information about the global cursor.
        CURSORINFO ci;
        ci.cbSize = sizeof(ci);
        if (!GetCursorInfo(&ci)) {
            result.Set("width", 0);
            result.Set("height", 0);
            result.Set("data", Napi::Array::New(env, 0));
            result.Set("xOffset", 0);
            result.Set("yOffset", 0);
            return result;
        }

        // Get icon information to determine actual size
        ICONINFO iconInfo;
        if (!GetIconInfo(ci.hCursor, &iconInfo)) {
            result.Set("width", 0);
            result.Set("height", 0);
            result.Set("data", Napi::Array::New(env, 0));
            result.Set("xOffset", 0);
            result.Set("yOffset", 0);
            return result;
        }

        // Get bitmap dimensions
        BITMAP bmp;
        GetObject(iconInfo.hbmColor ? iconInfo.hbmColor : iconInfo.hbmMask, sizeof(BITMAP), &bmp);
        int width = bmp.bmWidth;
        int height = iconInfo.hbmColor ? bmp.bmHeight : bmp.bmHeight / 2;

        HDC hdcScreen = GetDC(NULL);
        Napi::Array pixelData = Napi::Array::New(env, width * height * 4);
        int outIndex = 0;

        // Setup the Bitmap Info Header to pull 32-bit BGRA data
        BITMAPINFO bmi = {0};
        bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
        bmi.bmiHeader.biWidth = width;
        bmi.bmiHeader.biHeight = -height; // Negative means top-down
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;    // Enforce 32-bit (BGRA) output
        bmi.bmiHeader.biCompression = BI_RGB;

        if (iconInfo.hbmColor) {
            // Buffer for Color Bitmap
            std::vector<uint8_t> colorPixels(width * height * 4);
            GetDIBits(hdcScreen, iconInfo.hbmColor, 0, height, colorPixels.data(), &bmi, DIB_RGB_COLORS);

            // Buffer for Mask Bitmap (fallback in case color has no alpha)
            std::vector<uint8_t> maskPixels(width * height * 4);
            GetDIBits(hdcScreen, iconInfo.hbmMask, 0, height, maskPixels.data(), &bmi, DIB_RGB_COLORS);

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

                pixelData.Set(outIndex++, r);
                pixelData.Set(outIndex++, g);
                pixelData.Set(outIndex++, b);
                pixelData.Set(outIndex++, a);
            }
        } 
        else {
            // Monochrome cursors (e.g. text I-beam) do not have hbmColor.
            // The top half of hbmMask is the AND mask, bottom half is XOR mask.
            std::vector<uint8_t> maskPixels(width * (height * 2) * 4);
            bmi.bmiHeader.biHeight = -(height * 2); // Full height containing both masks
            GetDIBits(hdcScreen, iconInfo.hbmMask, 0, height * 2, maskPixels.data(), &bmi, DIB_RGB_COLORS);

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

                pixelData.Set(outIndex++, r);
                pixelData.Set(outIndex++, g);
                pixelData.Set(outIndex++, b);
                pixelData.Set(outIndex++, a);
            }
        }

        ReleaseDC(NULL, hdcScreen);
        
        // Clean up icon info
        if (iconInfo.hbmColor) DeleteObject(iconInfo.hbmColor);
        if (iconInfo.hbmMask) DeleteObject(iconInfo.hbmMask);

        result.Set("width", width);
        result.Set("height", height);
        result.Set("data", pixelData);
        result.Set("xOffset", iconInfo.xHotspot);
        result.Set("yOffset", iconInfo.yHotspot);
        
        return result;

    #elif defined(IS_MACOS)
        // Get the current cursor
        NSCursor *cursor = [NSCursor currentSystemCursor];
        if (cursor == nil) {
            result.Set("width", 0);
            result.Set("height", 0);
            result.Set("data", Napi::Array::New(env, 0));
            result.Set("xOffset", 0);
            result.Set("yOffset", 0);
            return result;
        }

        NSImage *image = [cursor image];
        NSPoint hotspot = [cursor hotSpot];
        
        if (image == nil) {
            result.Set("width", 0);
            result.Set("height", 0);
            result.Set("data", Napi::Array::New(env, 0));
            result.Set("xOffset", 0);
            result.Set("yOffset", 0);
            return result;
        }

        NSSize size = [image size];
        int width = (int)size.width;
        int height = (int)size.height;

        // Create a bitmap representation
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

        // Draw the image into the bitmap
        [NSGraphicsContext saveGraphicsState];
        [NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap]];
        [image drawInRect:NSMakeRect(0, 0, width, height)];
        [NSGraphicsContext restoreGraphicsState];

        // Extract pixel data in RGBA format
        unsigned char *bitmapData = [bitmap bitmapData];
        Napi::Array pixelData = Napi::Array::New(env, width * height * 4);
        
        int index = 0;
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                int offset = (y * width + x) * 4;
                pixelData.Set(index++, bitmapData[offset]);     // R
                pixelData.Set(index++, bitmapData[offset + 1]); // G
                pixelData.Set(index++, bitmapData[offset + 2]); // B
                pixelData.Set(index++, bitmapData[offset + 3]); // A
            }
        }

        result.Set("width", width);
        result.Set("height", height);
        result.Set("data", pixelData);
        result.Set("xOffset", (int)hotspot.x);
        result.Set("yOffset", (int)hotspot.y);
        
        return result;

    #elif defined(IS_LINUX)
        Display *display = XGetMainDisplay();
        if (display == NULL) {
            result.Set("width", 0);
            result.Set("height", 0);
            result.Set("data", Napi::Array::New(env, 0));
            result.Set("xOffset", 0);
            result.Set("yOffset", 0);
            return result;
        }

        Window root = DefaultRootWindow(display);
        
        // Query the cursor image using XFixes extension
        XFixesCursorImage *cursorImage = XFixesGetCursorImage(display);
        if (cursorImage == NULL) {
            result.Set("width", 0);
            result.Set("height", 0);
            result.Set("data", Napi::Array::New(env, 0));
            result.Set("xOffset", 0);
            result.Set("yOffset", 0);
            return result;
        }

        int width = cursorImage->width;
        int height = cursorImage->height;
        int xOffset = cursorImage->xhot;
        int yOffset = cursorImage->yhot;

        // Extract pixel data (XFixes returns ARGB format as unsigned long)
        Napi::Array pixelData = Napi::Array::New(env, width * height * 4);
        int index = 0;
        for (int i = 0; i < width * height; i++) {
            // XFixes cursor pixels are in ARGB format
            unsigned long pixel = cursorImage->pixels[i];
            
            // Convert to RGBA
            pixelData.Set(index++, (uint32_t)((pixel >> 16) & 0xFF)); // R
            pixelData.Set(index++, (uint32_t)((pixel >> 8) & 0xFF));  // G
            pixelData.Set(index++, (uint32_t)(pixel & 0xFF));         // B
            pixelData.Set(index++, (uint32_t)((pixel >> 24) & 0xFF)); // A
        }

        XFree(cursorImage);

        result.Set("width", width);
        result.Set("height", height);
        result.Set("data", pixelData);
        result.Set("xOffset", xOffset);
        result.Set("yOffset", yOffset);
        
        return result;

    #endif
    
}


void Mouse::setX(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected 1 argument").ThrowAsJavaScriptException();
        return;
    }

    if (!info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected number argument").ThrowAsJavaScriptException();
        return;
    }

    int x = info[0].As<Napi::Number>().Int32Value();

    #if defined(IS_WINDOWS)
        POINT point;
        GetCursorPos(&point);
        SetCursorPos(x, point.y);

    #elif defined(IS_MACOS)
        CGEventRef event = CGEventCreate(NULL);
        CGPoint cursor = CGEventGetLocation(event);
        CFRelease(event);
        
        CGPoint newPosition;
        newPosition.x = (CGFloat)x;
        newPosition.y = cursor.y;
        
        CGWarpMouseCursorPosition(newPosition);

    #elif defined(IS_LINUX)
        Display *display = XGetMainDisplay();
        if (display == NULL) {
            return;
        }
        
        Window root = DefaultRootWindow(display);
        Window window_returned;
        int root_x, root_y;
        int win_x, win_y;
        unsigned int mask_return;
        
        // Get current Y position
        XQueryPointer(display, root, &window_returned,
            &window_returned, &root_x, &root_y,
            &win_x, &win_y, &mask_return);
        
        // Move cursor to new X position, keeping Y the same
        XWarpPointer(display, None, root, 0, 0, 0, 0, x, root_y);
        XFlush(display);

    #endif

    return;
}

void Mouse::setY(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected 1 argument").ThrowAsJavaScriptException();
        return;
    }

    if (!info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected number argument").ThrowAsJavaScriptException();
        return;
    }

    int y = info[0].As<Napi::Number>().Int32Value();

    #if defined(IS_WINDOWS)
        POINT point;
        GetCursorPos(&point);
        SetCursorPos(point.x, y);

    #elif defined(IS_MACOS)
        CGEventRef event = CGEventCreate(NULL);
        CGPoint cursor = CGEventGetLocation(event);
        CFRelease(event);
        
        CGPoint newPosition;
        newPosition.x = cursor.x;
        newPosition.y = (CGFloat)y;
        
        CGWarpMouseCursorPosition(newPosition);

    #elif defined(IS_LINUX)
        Display *display = XGetMainDisplay();
        if (display == NULL) {
            return;
        }
        
        Window root = DefaultRootWindow(display);
        Window window_returned;
        int root_x, root_y;
        int win_x, win_y;
        unsigned int mask_return;
        
        // Get current X position
        XQueryPointer(display, root, &window_returned,
            &window_returned, &root_x, &root_y,
            &win_x, &win_y, &mask_return);
        
        // Move cursor to new Y position, keeping X the same
        XWarpPointer(display, None, root, 0, 0, 0, 0, root_x, y);
        XFlush(display);

    #endif

    return;
}


void Mouse::buttonDown(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected 1 argument").ThrowAsJavaScriptException();
        return;
    }

    if (!info[0].IsString()) {
        Napi::TypeError::New(env, "Expected string argument").ThrowAsJavaScriptException();
        return;
    }

    std::string button = info[0].As<Napi::String>().Utf8Value();

    if (button != "left" &&
        button != "middle" &&
        button != "right" &&
        button != "back" &&
        button != "forward") {
        Napi::TypeError::New(env, "Expected 'left', 'middle', 'right', 'back', or 'forward'").ThrowAsJavaScriptException();
        return;
    }

    #if defined(IS_WINDOWS)
        INPUT input = {0};
        input.type = INPUT_MOUSE;
        
        if (button == "left") {
            input.mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
        } else if (button == "right") {
            input.mi.dwFlags = MOUSEEVENTF_RIGHTDOWN;
        } else if (button == "middle") {
            input.mi.dwFlags = MOUSEEVENTF_MIDDLEDOWN;
        } else if (button == "back") {
            input.mi.dwFlags = MOUSEEVENTF_XDOWN;
            input.mi.mouseData = XBUTTON1;
        } else if (button == "forward") {
            input.mi.dwFlags = MOUSEEVENTF_XDOWN;
            input.mi.mouseData = XBUTTON2;
        }
        
        SendInput(1, &input, sizeof(INPUT));

    #elif defined(IS_MACOS)
        CGEventRef event = CGEventCreate(NULL);
        CGPoint cursor = CGEventGetLocation(event);
        CFRelease(event);
    
        CGEventType eventType = kCGEventLeftMouseDown;  // Initialize with default
        CGMouseButton mouseButton = kCGMouseButtonLeft;  // Initialize with default
    
        if (button == "left") {
            eventType = kCGEventLeftMouseDown;
            mouseButton = kCGMouseButtonLeft;
        } else if (button == "right") {
            eventType = kCGEventRightMouseDown;
            mouseButton = kCGMouseButtonRight;
        } else if (button == "middle") {
            eventType = kCGEventOtherMouseDown;
            mouseButton = kCGMouseButtonCenter;
        } else if (button == "back") {
            eventType = kCGEventOtherMouseDown;
            mouseButton = (CGMouseButton)3; // Back button
        } else if (button == "forward") {
            eventType = kCGEventOtherMouseDown;
            mouseButton = (CGMouseButton)4; // Forward button
        }
        
        CGEventRef mouseEvent = CGEventCreateMouseEvent(NULL, eventType, cursor, mouseButton);
        if (mouseEvent != NULL) {
            CGEventPost(kCGHIDEventTap, mouseEvent);
            CFRelease(mouseEvent);
        } else {
            // Handle error if needed
            Napi::Error::New(env, "Failed to create mouse event").ThrowAsJavaScriptException();
        }

    #elif defined(IS_LINUX)
        Display *display = XGetMainDisplay();
        if (display == NULL) {
            return;
        }
        
        unsigned int xButton;
        
        if (button == "left") {
            xButton = Button1;
        } else if (button == "middle") {
            xButton = Button2;
        } else if (button == "right") {
            xButton = Button3;
        } else if (button == "back") {
            xButton = 8; // X11 back button
        } else if (button == "forward") {
            xButton = 9; // X11 forward button
        }
        
        XTestFakeButtonEvent(display, xButton, True, CurrentTime);
        XFlush(display);

    #endif

    return;
}

void Mouse::buttonUp(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected 1 argument").ThrowAsJavaScriptException();
        return;
    }

    if (!info[0].IsString()) {
        Napi::TypeError::New(env, "Expected string argument").ThrowAsJavaScriptException();
        return;
    }

    std::string button = info[0].As<Napi::String>().Utf8Value();

    if (button != "left" &&
        button != "middle" &&
        button != "right" &&
        button != "back" &&
        button != "forward") {
        Napi::TypeError::New(env, "Expected 'left', 'middle', 'right', 'back', or 'forward'").ThrowAsJavaScriptException();
        return;
    }

    #if defined(IS_WINDOWS)
        INPUT input = {0};
        input.type = INPUT_MOUSE;
        
        if (button == "left") {
            input.mi.dwFlags = MOUSEEVENTF_LEFTUP;
        } else if (button == "right") {
            input.mi.dwFlags = MOUSEEVENTF_RIGHTUP;
        } else if (button == "middle") {
            input.mi.dwFlags = MOUSEEVENTF_MIDDLEUP;
        } else if (button == "back") {
            input.mi.dwFlags = MOUSEEVENTF_XUP;
            input.mi.mouseData = XBUTTON1;
        } else if (button == "forward") {
            input.mi.dwFlags = MOUSEEVENTF_XUP;
            input.mi.mouseData = XBUTTON2;
        }
        
        SendInput(1, &input, sizeof(INPUT));

    #elif defined(IS_MACOS)
        CGEventRef event = CGEventCreate(NULL);
        CGPoint cursor = CGEventGetLocation(event);
        CFRelease(event);
        
        CGEventType eventType = kCGEventLeftMouseUp;  // Initialize with default
        CGMouseButton mouseButton = kCGMouseButtonLeft;  // Initialize with default
    
        if (button == "left") {
            eventType = kCGEventLeftMouseUp;
            mouseButton = kCGMouseButtonLeft;
        } else if (button == "right") {
            eventType = kCGEventRightMouseUp;
            mouseButton = kCGMouseButtonRight;
        } else if (button == "middle") {
            eventType = kCGEventOtherMouseUp;
            mouseButton = kCGMouseButtonCenter;
        } else if (button == "back") {
            eventType = kCGEventOtherMouseUp;
            mouseButton = (CGMouseButton)3; // Back button
        } else if (button == "forward") {
            eventType = kCGEventOtherMouseUp;
            mouseButton = (CGMouseButton)4; // Forward button
        }
        
        CGEventRef mouseEvent = CGEventCreateMouseEvent(NULL, eventType, cursor, mouseButton);
        if (mouseEvent != NULL) {
            CGEventPost(kCGHIDEventTap, mouseEvent);
            CFRelease(mouseEvent);
        } else {
            // Handle error if needed
            Napi::Error::New(env, "Failed to create mouse event").ThrowAsJavaScriptException();
        }

    #elif defined(IS_LINUX)
        Display *display = XGetMainDisplay();
        if (display == NULL) {
            return;
        }
        
        unsigned int xButton;
        
        if (button == "left") {
            xButton = Button1;
        } else if (button == "middle") {
            xButton = Button2;
        } else if (button == "right") {
            xButton = Button3;
        } else if (button == "back") {
            xButton = 8; // X11 back button
        } else if (button == "forward") {
            xButton = 9; // X11 forward button
        }
        
        XTestFakeButtonEvent(display, xButton, False, CurrentTime);
        XFlush(display);

    #endif

    return;
}


void Mouse::scrollDown(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 argument").ThrowAsJavaScriptException();
        return;
    }

    if (!info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected number in 1st argument").ThrowAsJavaScriptException();
        return;
    }

    if (!info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Expected boolean 2nd argument").ThrowAsJavaScriptException();
        return;
    }

    int amount = info[0].As<Napi::Number>().Int32Value();
    bool isHorizontal = info[1].As<Napi::Boolean>().Value();

    #if defined(IS_WINDOWS)
        INPUT input = {0};
        input.type = INPUT_MOUSE;

        if (isHorizontal) {
            // Horizontal scroll (scroll right)
            input.mi.dwFlags = MOUSEEVENTF_HWHEEL;
            input.mi.mouseData = -amount * WHEEL_DELTA; // Negative for scrolling right
        } else {
            // Vertical scroll (scroll down)
            input.mi.dwFlags = MOUSEEVENTF_WHEEL;
            input.mi.mouseData = -amount * WHEEL_DELTA; // Negative for scrolling down
        }
        
        SendInput(1, &input, sizeof(INPUT));

    #elif defined(IS_MACOS)
        CGEventRef event = CGEventCreate(NULL);
        CFRelease(event);
        
        CGEventRef scrollEvent;
        
        if (isHorizontal) {
            // Horizontal scroll (scroll right)
            scrollEvent = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitLine, 2, 0, -amount);
        } else {
            // Vertical scroll (scroll down)
            scrollEvent = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitLine, 1, -amount);
        }
        
        CGEventPost(kCGHIDEventTap, scrollEvent);
        CFRelease(scrollEvent);

    #elif defined(IS_LINUX)
        Display *display = XGetMainDisplay();
        if (display == NULL) {
            return;
        }
        
        unsigned int button;
        
        if (isHorizontal) {
            // Horizontal scroll right (button 7)
            button = 7;
        } else {
            // Vertical scroll down (button 5)
            button = 5;
        }
        
        // Simulate multiple scroll events based on amount
        for (int i = 0; i < amount; i++) {
            XTestFakeButtonEvent(display, button, True, CurrentTime);
            XTestFakeButtonEvent(display, button, False, CurrentTime);
        }
        
        XFlush(display);

    #endif

    return;
}

void Mouse::scrollUp(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 argument").ThrowAsJavaScriptException();
        return;
    }

    if (!info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected number in 1st argument").ThrowAsJavaScriptException();
        return;
    }

    if (!info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Expected boolean 2nd argument").ThrowAsJavaScriptException();
        return;
    }

    int amount = info[0].As<Napi::Number>().Int32Value();
    bool isHorizontal = info[1].As<Napi::Boolean>().Value();

    #if defined(IS_WINDOWS)
        INPUT input = {0};
        input.type = INPUT_MOUSE;

        if (isHorizontal) {
            // Horizontal scroll (scroll left)
            input.mi.dwFlags = MOUSEEVENTF_HWHEEL;
            input.mi.mouseData = amount * WHEEL_DELTA; // Positive for scrolling left
        } else {
            // Vertical scroll (scroll up)
            input.mi.dwFlags = MOUSEEVENTF_WHEEL;
            input.mi.mouseData = amount * WHEEL_DELTA; // Positive for scrolling up
        }
        
        SendInput(1, &input, sizeof(INPUT));

    #elif defined(IS_MACOS)
        CGEventRef event = CGEventCreate(NULL);
        CFRelease(event);
        
        CGEventRef scrollEvent;
        
        if (isHorizontal) {
            // Horizontal scroll (scroll left)
            scrollEvent = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitLine, 2, 0, amount);
        } else {
            // Vertical scroll (scroll up)
            scrollEvent = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitLine, 1, amount);
        }
        
        CGEventPost(kCGHIDEventTap, scrollEvent);
        CFRelease(scrollEvent);

    #elif defined(IS_LINUX)
        Display *display = XGetMainDisplay();
        if (display == NULL) {
            return;
        }
        
        unsigned int button;
        
        if (isHorizontal) {
            // Horizontal scroll left (button 6)
            button = 6;
        } else {
            // Vertical scroll up (button 4)
            button = 4;
        }
        
        // Simulate multiple scroll events based on amount
        for (int i = 0; i < amount; i++) {
            XTestFakeButtonEvent(display, button, True, CurrentTime);
            XTestFakeButtonEvent(display, button, False, CurrentTime);
        }
        
        XFlush(display);

    #endif

    return;
}


Napi::Object Mouse::Init(Napi::Env env, Napi::Object exports) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set(Napi::String::New(env, "getX"), Napi::Function::New(env, Mouse::getX));
    obj.Set(Napi::String::New(env, "getY"), Napi::Function::New(env, Mouse::getY));

    obj.Set(Napi::String::New(env, "getIcon"), Napi::Function::New(env, Mouse::getIcon));

    obj.Set(Napi::String::New(env, "setX"), Napi::Function::New(env, Mouse::setX));
    obj.Set(Napi::String::New(env, "setY"), Napi::Function::New(env, Mouse::setY));

    obj.Set(Napi::String::New(env, "buttonDown"), Napi::Function::New(env, Mouse::buttonDown));
    obj.Set(Napi::String::New(env, "buttonUp"), Napi::Function::New(env, Mouse::buttonUp));

    obj.Set(Napi::String::New(env, "scrollDown"), Napi::Function::New(env, Mouse::scrollDown));
    obj.Set(Napi::String::New(env, "scrollUp"), Napi::Function::New(env, Mouse::scrollUp));
    return obj;
}
