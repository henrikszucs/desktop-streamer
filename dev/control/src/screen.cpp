#include "screen.h"

#include <vector>

#if defined(IS_WINDOWS)
    #include <shellscalingapi.h>
    #pragma comment(lib, "Shcore.lib")
#elif defined(IS_MACOS)
    #include <ApplicationServices/ApplicationServices.h>
    #include <CoreGraphics/CoreGraphics.h>
#elif defined(IS_LINUX)
    #include <stdlib.h>
    #include <cmath>
    #include <X11/Xlib.h>
    #include <X11/extensions/Xrandr.h>
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


// helper function to list screens
#if defined(IS_WINDOWS)
// Structure to hold screen information during enumeration
struct ScreenInfo {
    bool isPrimary;
    int width;
    int height;
    int x;
    int y;
    double scaleFactor;
};

// Callback function for EnumDisplayMonitors
BOOL CALLBACK MonitorEnumProc(HMONITOR hMonitor, HDC hdcMonitor, LPRECT lprcMonitor, LPARAM dwData) {
    std::vector<ScreenInfo>* screens = reinterpret_cast<std::vector<ScreenInfo>*>(dwData);
    
    MONITORINFOEX monitorInfo;
    monitorInfo.cbSize = sizeof(MONITORINFOEX);
    
    if (GetMonitorInfo(hMonitor, &monitorInfo)) {
        ScreenInfo screen;
        
        // Check if this is the primary monitor
        screen.isPrimary = (monitorInfo.dwFlags & MONITORINFOF_PRIMARY) != 0;
        
        // Get monitor rectangle (in virtual screen coordinates - these are LOGICAL pixels)
        RECT rect = monitorInfo.rcMonitor;

        // Get per-monitor DPI (Windows 8.1+)
        UINT dpiX = 96;
        UINT dpiY = 96;
        
        HRESULT hr = GetDpiForMonitor(hMonitor, MDT_EFFECTIVE_DPI, &dpiX, &dpiY);
        if (!SUCCEEDED(hr)) {
            // Fallback to system DPI
            HDC hdc = GetDC(NULL);
            dpiX = GetDeviceCaps(hdc, LOGPIXELSX);
            dpiY = GetDeviceCaps(hdc, LOGPIXELSY);
            ReleaseDC(NULL, hdc);
        }
        
        // Calculate the scale factor (96 DPI = 100% = 1.0)
        screen.scaleFactor = (double)dpiY / 96.0;
        
        // Logical dimensions from monitor rect
        screen.width = (int)((rect.right - rect.left) / screen.scaleFactor);
        screen.height = (int)((rect.bottom - rect.top) / screen.scaleFactor);
        
        // Logical offsets from monitor rect
        screen.x = (int)(rect.left / screen.scaleFactor);
        screen.y = (int)(rect.top / screen.scaleFactor);
        
        
        
        screens->push_back(screen);
    }
    
    return TRUE; // Continue enumeration
}
#endif

Napi::Array IScreen::list(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    Napi::Array result = Napi::Array::New(env);

    #if defined(IS_WINDOWS)
        std::vector<ScreenInfo> screens;
        
        // Enumerate all monitors
        EnumDisplayMonitors(NULL, NULL, MonitorEnumProc, reinterpret_cast<LPARAM>(&screens));
        
        // Convert to Napi::Array
        for (size_t i = 0; i < screens.size(); i++) {
            Napi::Object screenObj = Napi::Object::New(env);
            screenObj.Set("isPrimary", Napi::Boolean::New(env, screens[i].isPrimary));
            screenObj.Set("width", Napi::Number::New(env, screens[i].width));
            screenObj.Set("height", Napi::Number::New(env, screens[i].height));
            screenObj.Set("x", Napi::Number::New(env, screens[i].x));
            screenObj.Set("y", Napi::Number::New(env, screens[i].y));
            screenObj.Set("scaleFactor", Napi::Number::New(env, screens[i].scaleFactor));
            
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
                
                // Get display bounds
                CGRect bounds = CGDisplayBounds(display);
                
                // Get backing scale factor (for Retina displays)
                CGSize size = CGDisplayScreenSize(display);
                double scaleFactor = 1.0;
                
                // Try to get the scale factor
                // This works for Retina displays
                if (size.width > 0 && size.height > 0) {
                    // Get mode to determine pixel dimensions
                    CGDisplayModeRef mode = CGDisplayCopyDisplayMode(display);
                    if (mode) {
                        size_t pixelWidth = CGDisplayModeGetPixelWidth(mode);
                        
                        // Calculate scale factor
                        if (pixelWidth > 0 && bounds.size.width > 0) {
                            scaleFactor = pixelWidth / bounds.size.width;
                        }
                        
                        CGDisplayModeRelease(mode);
                    }
                }
                
                // macOS uses a coordinate system where (0,0) is bottom-left of main display
                // Convert to top-left origin for consistency
                CGRect mainBounds = CGDisplayBounds(mainDisplay);
                int y = (int)(mainBounds.size.height - bounds.origin.y - bounds.size.height);
                
                screenObj.Set("isPrimary", Napi::Boolean::New(env, isPrimary));
                screenObj.Set("width", Napi::Number::New(env, (int)bounds.size.width));
                screenObj.Set("height", Napi::Number::New(env, (int)bounds.size.height));
                screenObj.Set("x", Napi::Number::New(env, (int)bounds.origin.x));
                screenObj.Set("y", Napi::Number::New(env, y));
                screenObj.Set("scaleFactor", Napi::Number::New(env, scaleFactor));
                
                result.Set(i, screenObj);
            }
        }

    #elif defined(IS_LINUX)
        Display *display = XGetMainDisplay();
        if (display == NULL) {
            return result;
        }
        
        Window root = DefaultRootWindow(display);
        
        // Check if XRandR extension is available
        int eventBase, errorBase;
        if (XRRQueryExtension(display, &eventBase, &errorBase)) {
            XRRScreenResources *screenRes = XRRGetScreenResources(display, root);
            
            if (screenRes) {
                // Get primary output
                RROutput primary = XRRGetOutputPrimary(display, root);
                
                for (int i = 0; i < screenRes->noutput; i++) {
                    XRROutputInfo *outputInfo = XRRGetOutputInfo(display, screenRes, screenRes->outputs[i]);
                    
                    if (outputInfo && outputInfo->connection == RR_Connected && outputInfo->crtc) {
                        XRRCrtcInfo *crtcInfo = XRRGetCrtcInfo(display, screenRes, outputInfo->crtc);
                        
                        if (crtcInfo) {
                            Napi::Object screenObj = Napi::Object::New(env);
                            
                            // Check if this is the primary output
                            bool isPrimary = (screenRes->outputs[i] == primary);
                            
                            // Get DPI to calculate scale factor
                            double dpi = 96.0; // Default DPI
                            double scaleFactor = 1.0;
                            
                            // Try to get physical size and calculate DPI
                            if (outputInfo->mm_width > 0 && crtcInfo->width > 0) {
                                // Calculate DPI from physical size
                                dpi = (crtcInfo->width * 25.4) / outputInfo->mm_width;
                                scaleFactor = dpi / 96.0;

                                // Round to nearest 5% (0.05) increment
                                scaleFactor = round(scaleFactor * 20.0) / 20.0;
                            }
                            
                            screenObj.Set("isPrimary", Napi::Boolean::New(env, isPrimary));
                            screenObj.Set("width", Napi::Number::New(env, (int)crtcInfo->width));
                            screenObj.Set("height", Napi::Number::New(env, (int)crtcInfo->height));
                            screenObj.Set("x", Napi::Number::New(env, (int)crtcInfo->x));
                            screenObj.Set("y", Napi::Number::New(env, (int)crtcInfo->y));
                            screenObj.Set("scaleFactor", Napi::Number::New(env, scaleFactor));
                            
                            result.Set(result.Length(), screenObj);
                            
                            XRRFreeCrtcInfo(crtcInfo);
                        }
                        
                        XRRFreeOutputInfo(outputInfo);
                    }
                }
                
                XRRFreeScreenResources(screenRes);
            }
        } else {
            // Fallback: Single screen without XRandR
            int screen = DefaultScreen(display);
            Napi::Object screenObj = Napi::Object::New(env);
            
            screenObj.Set("isPrimary", Napi::Boolean::New(env, true));
            screenObj.Set("width", Napi::Number::New(env, DisplayWidth(display, screen)));
            screenObj.Set("height", Napi::Number::New(env, DisplayHeight(display, screen)));
            screenObj.Set("x", Napi::Number::New(env, 0));
            screenObj.Set("y", Napi::Number::New(env, 0));
            screenObj.Set("scaleFactor", Napi::Number::New(env, 1.0));
            
            result.Set((int)0, screenObj);
        }

    #endif

    return result;
}


Napi::Object IScreen::Init(Napi::Env env, Napi::Object exports) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set(Napi::String::New(env, "list"), Napi::Function::New(env, IScreen::list));
    return obj;
}
