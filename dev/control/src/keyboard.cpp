#include "keyboard.h"

#if defined(IS_WINDOWS)
    #include <windows.h>
#elif defined(IS_MACOS)
    #include <ApplicationServices/ApplicationServices.h>
    #include <Carbon/Carbon.h>
    #include <CoreFoundation/CoreFoundation.h>
    #include <cctype>  // for tolower
#elif defined(IS_LINUX)
    #include <X11/Xlib.h>
    #include <X11/keysym.h>
    #include <X11/extensions/XTest.h>
    #include <X11/XKBlib.h>
#endif

#include <string>
#include <map>



// Helper function to convert KeyboardEvent.key string to Windows Virtual Key Code
#if defined(IS_WINDOWS)
std::map<std::string, WORD> SpecialKeys = {
    {"Escape", 0x0001},
    {"Digit1", 0x0002},
    {"Digit2", 0x0003},
    {"Digit3", 0x0004},
    {"Digit4", 0x0005},
    {"Digit5", 0x0006},
    {"Digit6", 0x0007},
    {"Digit7", 0x0008},
    {"Digit8", 0x0009},
    {"Digit9", 0x000A},
    {"Digit0", 0x000B},
    {"Minus", 0x000C},
    {"Equal", 0x000D},
    {"Backspace", 0x000E},
    {"Tab", 0x000F},
    {"KeyQ", 0x0010},
    {"KeyW", 0x0011},
    {"KeyE", 0x0012},
    {"KeyR", 0x0013},
    {"KeyT", 0x0014},
    {"KeyY", 0x0015},
    {"KeyU", 0x0016},
    {"KeyI", 0x0017},
    {"KeyO", 0x0018},
    {"KeyP", 0x0019},
    {"BracketLeft", 0x001A},
    {"BracketRight", 0x001B},
    {"Enter", 0x001C},
    {"ControlLeft", 0x001D},
    {"KeyA", 0x001E},
    {"KeyS", 0x001F},
    {"KeyD", 0x0020},
    {"KeyF", 0x0021},
    {"KeyG", 0x0022},
    {"KeyH", 0x0023},
    {"KeyJ", 0x0024},
    {"KeyK", 0x0025},
    {"KeyL", 0x0026},
    {"Semicolon", 0x0027},
    {"Quote", 0x0028},
    {"Backquote", 0x0029},
    {"ShiftLeft", 0x002A},
    {"Backslash", 0x002B},
    {"KeyZ", 0x002C},
    {"KeyX", 0x002D},
    {"KeyC", 0x002E},
    {"KeyV", 0x002F},
    {"KeyB", 0x0030},
    {"KeyN", 0x0031},
    {"KeyM", 0x0032},
    {"Comma", 0x0033},
    {"Period", 0x0034},
    {"Slash", 0x0035},
    {"ShiftRight", 0x0036},
    {"NumpadMultiply", 0x0037},
    {"AltLeft", 0x0038},
    {"Space", 0x0039},
    {"CapsLock", 0x003A},
    {"F1", 0x003B},
    {"F2", 0x003C},
    {"F3", 0x003D},
    {"F4", 0x003E},
    {"F5", 0x003F},
    {"F6", 0x0040},
    {"F7", 0x0041},
    {"F8", 0x0042},
    {"F9", 0x0043},
    {"F10", 0x0044},
    {"Pause", 0x0045},
    {"ScrollLock", 0x0046},
    {"Numpad7", 0x0047},
    {"Numpad8", 0x0048},
    {"Numpad9", 0x0049},
    {"NumpadSubtract", 0x004A},
    {"Numpad4", 0x004B},
    {"Numpad5", 0x004C},
    {"Numpad6", 0x004D},
    {"NumpadAdd", 0x004E},
    {"Numpad1", 0x004F},
    {"Numpad2", 0x0050},
    {"Numpad3", 0x0051},
    {"Numpad0", 0x0052},
    {"NumpadDecimal", 0x0053},
    {"PrintScreen", 0x0054},
    {"IntlBackslash", 0x0056},
    {"F11", 0x0057},
    {"F12", 0x0058},
    {"NumpadEqual", 0x0059},
    {"F13", 0x0064},
    {"F14", 0x0065},
    {"F15", 0x0066},
    {"F16", 0x0067},
    {"F17", 0x0068},
    {"F18", 0x0069},
    {"F19", 0x006A},
    {"F20", 0x006B},
    {"F21", 0x006C},
    {"F22", 0x006D},
    {"F23", 0x006E},
    {"KanaMode", 0x0070},
    {"Lang2", 0x0071},
    {"Lang1", 0x0072},
    {"IntlRo", 0x0073},
    {"F24", 0x0076},
    {"Lang4", 0x0077},
    {"Lang3", 0x0078},
    {"Convert", 0x0079},
    {"NonConvert", 0x007B},
    {"IntlYen", 0x007D},
    {"NumpadComma", 0x007E},
    {"Unod", 0xE008},
    {"Paste", 0xE00A},
    {"MediaTrackPrevious", 0xE010},
    {"Cut", 0xE017},
    {"Copy", 0xE018},
    {"MediaTrackNext", 0xE019},
    {"NumpadEnter", 0xE01C},
    {"ControlRight", 0xE01D},
    {"AudioVolumeMute", 0xE020},
    {"LaunchApp2", 0xE021},
    {"MediaPlayPause", 0xE022},
    {"MediaStop", 0xE024},
    {"Eject", 0xE02C},
    {"VolumeDown", 0xE02E},
    {"AudioVolumeDown", 0xE02E},
    {"VolumeUp", 0xE030},
    {"AudioVolumeUp", 0xE030},
    {"BrowserHome", 0xE032},
    {"NumpadDivide", 0xE035},
    {"PrintScreen", 0xE037},
    {"AltRight", 0xE038},
    {"Help", 0xE03B},
    {"NumLock", 0xE045},
    {"Pause", 0xE046},
    {"Home", 0xE047},
    {"ArrowUp", 0xE048},
    {"PageUp", 0xE049},
    {"ArrowLeft", 0xE04B},
    {"ArrowRight", 0xE04D},
    {"End", 0xE04F},
    {"ArrowDown", 0xE050},
    {"PageDown", 0xE051},
    {"Insert", 0xE052},
    {"Delete", 0xE053},
    {"MetaLeft", 0xE05B},
    {"OSLeft", 0xE05B},
    {"MetaRight", 0xE05C},
    {"OSRight", 0xE05C},
    {"ContextMenu", 0xE05D},
    {"Power", 0xE05E},
    {"Sleep", 0xE05F},
    {"WakeUp", 0xE063},
    {"BrowserSearch", 0xE065},
    {"BrowserFavorites", 0xE066},
    {"BrowserRefresh", 0xE067},
    {"BrowserStop", 0xE068},
    {"BrowserForward", 0xE069},
    {"BrowserBack", 0xE06A},
    {"LaunchApp1", 0xE06B},
    {"LaunchMail", 0xE06C},
    {"MediaSelect", 0xE06D},
    {"Lang2", 0xE0F1},
    {"Lang1", 0xE0F2}
};

#elif defined(IS_MACOS)
std::map<std::string, CGKeyCode> SpecialKeys = {
    {"KeyA", kVK_ANSI_A},
    {"KeyS", kVK_ANSI_S},
    {"KeyD", kVK_ANSI_D},
    {"KeyF", kVK_ANSI_F},
    {"KeyH", kVK_ANSI_H},
    {"KeyG", kVK_ANSI_G},
    {"KeyZ", kVK_ANSI_Z},
    {"KeyX", kVK_ANSI_X},
    {"KeyC", kVK_ANSI_C},
    {"KeyV", kVK_ANSI_V},
    {"IntlBackslash", kVK_ISO_Section},
    {"KeyB", kVK_ANSI_B},
    {"KeyQ", kVK_ANSI_Q},
    {"KeyW", kVK_ANSI_W},
    {"KeyE", kVK_ANSI_E},
    {"KeyR", kVK_ANSI_R},
    {"KeyY", kVK_ANSI_Y},
    {"KeyT", kVK_ANSI_T},
    {"Digit1", kVK_ANSI_1},
    {"Digit2", kVK_ANSI_2},
    {"Digit3", kVK_ANSI_3},
    {"Digit4", kVK_ANSI_4},
    {"Digit6", kVK_ANSI_6},
    {"Digit5", kVK_ANSI_5},
    {"Equal", kVK_ANSI_Equal},
    {"Digit9", kVK_ANSI_9},
    {"Digit7", kVK_ANSI_7},
    {"Minus", kVK_ANSI_Minus},
    {"Digit8", kVK_ANSI_8},
    {"Digit0", kVK_ANSI_0},
    {"BracketRight", kVK_ANSI_RightBracket},
    {"KeyO", kVK_ANSI_O},
    {"KeyU", kVK_ANSI_U},
    {"BracketLeft", kVK_ANSI_LeftBracket},
    {"KeyI", kVK_ANSI_I},
    {"KeyP", kVK_ANSI_P},
    {"Enter", kVK_Return},
    {"KeyL", kVK_ANSI_L},
    {"KeyJ", kVK_ANSI_J},
    {"Quote", kVK_ANSI_Quote},
    {"KeyK", kVK_ANSI_K},
    {"Semicolon", kVK_ANSI_Semicolon},
    {"Backslash", kVK_ANSI_Backslash},
    {"Comma", kVK_ANSI_Comma},
    {"Slash", kVK_ANSI_Slash},
    {"KeyN", kVK_ANSI_N},
    {"KeyM", kVK_ANSI_M},
    {"Period", kVK_ANSI_Period},
    {"Tab", kVK_Tab},
    {"Space", kVK_Space},
    {"Backquote", kVK_ANSI_Grave},
    {"Backspace", kVK_Delete},
    {"Escape", kVK_Escape},
    {"MetaRight", 0x36},
    {"OSRight", 0x36},
    {"MetaLeft", kVK_Command},
    {"OSLeft", kVK_Command},
    {"ShiftLeft", kVK_Shift},
    {"CapsLock", kVK_CapsLock},
    {"AltLeft", kVK_Option},
    {"ControlLeft", kVK_Control},
    {"ShiftRight", kVK_RightShift},
    {"AltRight", kVK_RightOption},
    {"ControlRight", kVK_RightControl},
    {"Fn", kVK_Function},
    {"F17", kVK_F17},
    {"NumpadDecimal", kVK_ANSI_KeypadDecimal},
    {"NumpadMultiply", kVK_ANSI_KeypadMultiply},
    {"NumpadAdd", kVK_ANSI_KeypadPlus},
    {"NumLock", kVK_ANSI_KeypadClear},
    {"VolumeUp", kVK_VolumeUp},
    {"AudioVolumeUp", kVK_VolumeUp},
    {"VolumeDown", kVK_VolumeDown},
    {"AudioVolumeDown", kVK_VolumeDown},
    {"VolumeMute", kVK_Mute},
    {"AudioVolumeMute", kVK_Mute},
    {"NumpadDivide", kVK_ANSI_KeypadDivide},
    {"NumpadEnter", kVK_ANSI_KeypadEnter},
    {"NumpadSubtract", kVK_ANSI_KeypadMinus},
    {"F18", kVK_F18},
    {"F19", kVK_F19},
    {"NumpadEqual", kVK_ANSI_KeypadEquals},
    {"Numpad0", kVK_ANSI_Keypad0},
    {"Numpad1", kVK_ANSI_Keypad1},
    {"Numpad2", kVK_ANSI_Keypad2},
    {"Numpad3", kVK_ANSI_Keypad3},
    {"Numpad4", kVK_ANSI_Keypad4},
    {"Numpad5", kVK_ANSI_Keypad5},
    {"Numpad6", kVK_ANSI_Keypad6},
    {"Numpad7", kVK_ANSI_Keypad7},
    {"F20", kVK_F20},
    {"Numpad8", kVK_ANSI_Keypad8},
    {"Numpad9", kVK_ANSI_Keypad9},
    {"IntlYen", kVK_JIS_Yen},
    {"IntlRo", kVK_JIS_Underscore},
    {"NumpadComma", kVK_JIS_KeypadComma},
    {"F5", kVK_F5},
    {"F6", kVK_F6},
    {"F7", kVK_F7},
    {"F3", kVK_F3},
    {"F8", kVK_F8},
    {"F9", kVK_F9},
    {"Lang2", kVK_JIS_Eisu},
    {"F11", kVK_F11},
    {"Lang1", kVK_JIS_Kana},
    {"F13", kVK_F13},
    {"F16", kVK_F16},
    {"F14", kVK_F14},
    {"F10", kVK_F10},
    {"ContextMenu", 0x6E},
    {"F12", kVK_F12},
    {"F15", kVK_F15},
    {"Help", kVK_Help},
    {"Insert", kVK_Help},
    {"Home", kVK_Home},
    {"PageUp", kVK_PageUp},
    {"Delete", kVK_ForwardDelete},
    {"F4", kVK_F4},
    {"End", kVK_End},
    {"F2", kVK_F2},
    {"PageDown", kVK_PageDown},
    {"F1", kVK_F1},
    {"ArrowLeft", kVK_LeftArrow},
    {"ArrowRight", kVK_RightArrow},
    {"ArrowDown", kVK_DownArrow},
    {"ArrowUp", kVK_UpArrow}
};


#elif defined(IS_LINUX)
std::map<std::string, unsigned int> SpecialKeys = {
    {"Escape", 0x0009},
    {"Digit1", 0x000A},
    {"Digit2", 0x000B},
    {"Digit3", 0x000C},
    {"Digit4", 0x000D},
    {"Digit5", 0x000E},
    {"Digit6", 0x000F},
    {"Digit7", 0x0010},
    {"Digit8", 0x0011},
    {"Digit9", 0x0012},
    {"Digit0", 0x0013},
    {"Minus", 0x0014},
    {"Equal", 0x0015},
    {"Backspace", 0x0016},
    {"Tab", 0x0017},
    {"KeyQ", 0x0018},
    {"KeyW", 0x0019},
    {"KeyE", 0x001A},
    {"KeyR", 0x001B},
    {"KeyT", 0x001C},
    {"KeyY", 0x001D},
    {"KeyU", 0x001E},
    {"KeyI", 0x001F},
    {"KeyO", 0x0020},
    {"KeyP", 0x0021},
    {"BracketLeft", 0x0022},
    {"BracketRight", 0x0023},
    {"Enter", 0x0024},
    {"ControlLeft", 0x0025},
    {"KeyA", 0x0026},
    {"KeyS", 0x0027},
    {"KeyD", 0x0028},
    {"KeyF", 0x0029},
    {"KeyG", 0x002A},
    {"KeyH", 0x002B},
    {"KeyJ", 0x002C},
    {"KeyK", 0x002D},
    {"KeyL", 0x002E},
    {"Semicolon", 0x002F},
    {"Quote", 0x0030},
    {"Backquote", 0x0031},
    {"ShiftLeft", 0x0032},
    {"Backslash", 0x0033},
    {"KeyZ", 0x0034},
    {"KeyX", 0x0035},
    {"KeyC", 0x0036},
    {"KeyV", 0x0037},
    {"KeyB", 0x0038},
    {"KeyN", 0x0039},
    {"KeyM", 0x003A},
    {"Comma", 0x003B},
    {"Period", 0x003C},
    {"Slash", 0x003D},
    {"ShiftRight", 0x003E},
    {"NumpadMultiply", 0x003F},
    {"AltLeft", 0x0040},
    {"Space", 0x0041},
    {"CapsLock", 0x0042},
    {"F1", 0x0043},
    {"F2", 0x0044},
    {"F3", 0x0045},
    {"F4", 0x0046},
    {"F5", 0x0047},
    {"F6", 0x0048},
    {"F7", 0x0049},
    {"F8", 0x004A},
    {"F9", 0x004B},
    {"F10", 0x004C},
    {"NumLock", 0x004D},
    {"ScrollLock", 0x004E},
    {"Numpad7", 0x004F},
    {"Numpad8", 0x0050},
    {"Numpad9", 0x0051},
    {"NumpadSubtract", 0x0052},
    {"Numpad4", 0x0053},
    {"Numpad5", 0x0054},
    {"Numpad6", 0x0055},
    {"NumpadAdd", 0x0056},
    {"Numpad1", 0x0057},
    {"Numpad2", 0x0058},
    {"Numpad3", 0x0059},
    {"Numpad0", 0x005A},
    {"NumpadDecimal", 0x005B},
    {"Lang5", 0x005D},
    {"IntlBackslash", 0x005E},
    {"F11", 0x005F},
    {"F12", 0x0060},
    {"IntlRo", 0x0061},
    {"Lang3", 0x0062},
    {"Lang4", 0x0063},
    {"Convert", 0x0064},
    {"KanaMode", 0x0065},
    {"NonConvert", 0x0066},
    {"NumpadEnter", 0x0068},
    {"ControlRight", 0x0069},
    {"NumpadDivide", 0x006A},
    {"PrintScreen", 0x006B},
    {"AltRight", 0x006C},
    {"Home", 0x006E},
    {"ArrowUp", 0x006F},
    {"PageUp", 0x0070},
    {"ArrowLeft", 0x0071},
    {"ArrowRight", 0x0072},
    {"End", 0x0073},
    {"ArrowDown", 0x0074},
    {"PageDown", 0x0075},
    {"Insert", 0x0076},
    {"Delete", 0x0077},
    {"VolumeMute", 0x0079},
    {"AudioVolumeMute", 0x0079},
    {"VolumeDown", 0x007A},
    {"AudioVolumeDown", 0x007A},
    {"VolumeUp", 0x007B},
    {"AudioVolumeUp", 0x007B},
    {"Power", 0x007C},
    {"NumpadEqual", 0x007D},
    {"Pause", 0x007F},
    {"NumpadComma", 0x0081},
    {"Lang1", 0x0082},
    {"Lang2", 0x0083},
    {"IntlYen", 0x0084},
    {"MetaLeft", 0x0085},
    {"OSLeft", 0x0085},
    {"MetaRight", 0x0086},
    {"OSRight", 0x0086},
    {"ContextMenu", 0x0087},
    {"BrowserStop", 0x0088},
    {"Abort", 0x0088},
    {"Again", 0x0089},
    {"Props", 0x008A},
    {"Undo", 0x008B},
    {"Select", 0x008C},
    {"Copy", 0x008D},
    {"Open", 0x008E},
    {"Paste", 0x008F},
    {"Find", 0x0090},
    {"Cut", 0x0091},
    {"Help", 0x0092},
    {"LaunchApp2", 0x0094},
    {"Sleep", 0x0096},
    {"WakeUp", 0x0097},
    {"LaunchApp1", 0x0098},
    {"LaunchMail", 0x00A3},
    {"BrowserFavorites", 0x00A4},
    {"BrowserBack", 0x00A6},
    {"BrowserForward", 0x00A7},
    {"Eject", 0x00A9},
    {"MediaTrackNext", 0x00AB},
    {"MediaPlayPause", 0x00AC},
    {"MediaTrackPrevious", 0x00AD},
    {"MediaStop", 0x00AE},
    {"MediaSelect", 0x00B3},
    {"BrowserHome", 0x00B4},
    {"BrowserRefresh", 0x00B5},
    {"NumpadParenLeft", 0x00BB},
    {"NumpadParenRight", 0x00BC},
    {"F13", 0x00BF},
    {"F14", 0x00C0},
    {"F15", 0x00C1},
    {"F16", 0x00C2},
    {"F17", 0x00C3},
    {"F18", 0x00C4},
    {"F19", 0x00C5},
    {"F20", 0x00C6},
    {"F21", 0x00C7},
    {"F22", 0x00C8},
    {"F23", 0x00C9},
    {"F24", 0x00CA},
    {"BrowserSearch", 0x00E1}
};

#endif


void Keyboard::keyDown(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected 1 argument").ThrowAsJavaScriptException();
        return;
    }

    if (!info[0].IsString()) {
        Napi::TypeError::New(env, "Expected string argument").ThrowAsJavaScriptException();
        return;
    }

    std::string key = info[0].As<Napi::String>().Utf8Value();

    if (key.length() == 0) {
        Napi::TypeError::New(env, "Expected non empty string").ThrowAsJavaScriptException();
        return;
    }

    #if defined(IS_WINDOWS)
        bool isNotSupported = false;
        auto it = SpecialKeys.find(key);
        if (it == SpecialKeys.end()) {
            Napi::Error::New(env, "Failed to send key up event").ThrowAsJavaScriptException();
            return;
        }
        WORD wScan = it->second;

        INPUT Input = {0};
        Input.type = INPUT_KEYBOARD;
        Input.ki.wVk = 0;
        Input.ki.wScan = wScan;
        Input.ki.dwFlags = KEYEVENTF_SCANCODE;
        SendInput(1, &Input, sizeof(INPUT));
        
    #elif defined(IS_MACOS)
        auto it = SpecialKeys.find(key);
        if (it == SpecialKeys.end()) {
            Napi::Error::New(env, "Key not supported").ThrowAsJavaScriptException();
            return;
        }
        
        CGKeyCode keycode = it->second;
        
        // Create a key down event
        CGEventRef keyDownEvent = CGEventCreateKeyboardEvent(NULL, keycode, true);
        if (keyDownEvent == NULL) {
            Napi::Error::New(env, "Failed to create key down event").ThrowAsJavaScriptException();
            return;
        }
        
        // Post the event
        CGEventPost(kCGHIDEventTap, keyDownEvent);
        
        // Release the event
        CFRelease(keyDownEvent);
    #elif defined(IS_LINUX)
        Display *display = XOpenDisplay(NULL);
        if (display == NULL) {
            Napi::Error::New(env, "Failed to open X display").ThrowAsJavaScriptException();
            return;
        }
        
        auto it = SpecialKeys.find(key);
        if (it == SpecialKeys.end()) {
            XCloseDisplay(display);
            Napi::Error::New(env, "Key not supported").ThrowAsJavaScriptException();
            return;
        }
        
        unsigned int keycode = it->second;
        
        // Send key press event
        XTestFakeKeyEvent(display, keycode, True, 0);
        XFlush(display);
        
        XCloseDisplay(display);
    #endif

    return;
}

void Keyboard::keyUp(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected 1 argument").ThrowAsJavaScriptException();
        return;
    }

    if (!info[0].IsString()) {
        Napi::TypeError::New(env, "Expected string argument").ThrowAsJavaScriptException();
        return;
    }

    std::string key = info[0].As<Napi::String>().Utf8Value();

    if (key.length() == 0) {
        Napi::TypeError::New(env, "Expected non empty string").ThrowAsJavaScriptException();
        return;
    }

    #if defined(IS_WINDOWS)
        bool isNotSupported = false;
        auto it = SpecialKeys.find(key);
        if (it == SpecialKeys.end()) {
            Napi::Error::New(env, "Failed to send key up event").ThrowAsJavaScriptException();
            return;
        }
        WORD wScan = it->second;

        INPUT Input = {0};
        Input.type = INPUT_KEYBOARD;
        Input.ki.wVk = 0;
        Input.ki.wScan = wScan;
        Input.ki.dwFlags = KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP;
        SendInput(1, &Input, sizeof(INPUT));

    #elif defined(IS_MACOS)
        auto it = SpecialKeys.find(key);
        if (it == SpecialKeys.end()) {
            Napi::Error::New(env, "Key not supported").ThrowAsJavaScriptException();
            return;
        }
        
        CGKeyCode keycode = it->second;
        
        // Create a key up event
        CGEventRef keyUpEvent = CGEventCreateKeyboardEvent(NULL, keycode, false);
        if (keyUpEvent == NULL) {
            Napi::Error::New(env, "Failed to create key up event").ThrowAsJavaScriptException();
            return;
        }
        
        // Post the event
        CGEventPost(kCGHIDEventTap, keyUpEvent);
        
        // Release the event
        CFRelease(keyUpEvent);
    #elif defined(IS_LINUX)
        Display *display = XOpenDisplay(NULL);
        if (display == NULL) {
            Napi::Error::New(env, "Failed to open X display").ThrowAsJavaScriptException();
            return;
        }
        
        auto it = SpecialKeys.find(key);
        if (it == SpecialKeys.end()) {
            XCloseDisplay(display);
            Napi::Error::New(env, "Key not supported").ThrowAsJavaScriptException();
            return;
        }
        
        unsigned int keycode = it->second;
        
        // Send key release event
        XTestFakeKeyEvent(display, keycode, False, 0);
        XFlush(display);
        
        XCloseDisplay(display);
    #endif

    return;
}

Napi::Boolean Keyboard::isKeySupported(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected 1 argument").ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }

    if (!info[0].IsString()) {
        Napi::TypeError::New(env, "Expected string argument").ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }

    std::string key = info[0].As<Napi::String>().Utf8Value();

    if (key.length() == 0) {
        Napi::TypeError::New(env, "Expected non empty string").ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }

    bool isNotSupported = false;

    auto it = SpecialKeys.find(key);
    if (it != SpecialKeys.end()) {
        if (it->second == 0) {
            isNotSupported = true;
        }
    } else {
        isNotSupported = true;
    }
    return Napi::Boolean::New(env, !isNotSupported);
}

void Keyboard::type(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected 1 argument").ThrowAsJavaScriptException();
        return;
    }

    if (!info[0].IsString()) {
        Napi::TypeError::New(env, "Expected string argument").ThrowAsJavaScriptException();
        return;
    }

    std::string key = info[0].As<Napi::String>().Utf8Value();
    
    if (key.length() == 0) {
        Napi::TypeError::New(env, "Expected non empty string").ThrowAsJavaScriptException();
        return;
    }

    #if defined(IS_WINDOWS)
        int wideSize = MultiByteToWideChar(CP_UTF8, 0, key.c_str(), -1, NULL, 0);
        wchar_t* wideStr = new wchar_t[wideSize];
        memset(wideStr, 0, wideSize * sizeof(wchar_t));
        MultiByteToWideChar(CP_UTF8, 0, key.c_str(), -1, wideStr, wideSize);
        
        INPUT Input[1] = {0};
        Input[0].type = INPUT_KEYBOARD;
        Input[0].ki.wVk = 0;
        Input[0].ki.wScan = wideStr[0];
        Input[0].ki.dwFlags = KEYEVENTF_UNICODE;
        SendInput(1, Input, sizeof(INPUT));
        delete[] wideStr;

    #elif defined(IS_MACOS)
        // Convert UTF-8 string to UTF-16 for macOS
        CFStringRef cfString = CFStringCreateWithCString(kCFAllocatorDefault, key.c_str(), kCFStringEncodingUTF8);
        if (cfString == NULL) {
            Napi::Error::New(env, "Failed to convert string to CFString").ThrowAsJavaScriptException();
            return;
        }
        
        CFIndex length = CFStringGetLength(cfString);
        
        // Type each character
        for (CFIndex i = 0; i < length; i++) {
            UniChar character = CFStringGetCharacterAtIndex(cfString, i);
            
            // Create a Unicode keyboard event
            CGEventRef keyDownEvent = CGEventCreateKeyboardEvent(NULL, 0, true);
            CGEventRef keyUpEvent = CGEventCreateKeyboardEvent(NULL, 0, false);
            
            if (keyDownEvent == NULL || keyUpEvent == NULL) {
                if (keyDownEvent != NULL) CFRelease(keyDownEvent);
                if (keyUpEvent != NULL) CFRelease(keyUpEvent);
                CFRelease(cfString);
                Napi::Error::New(env, "Failed to create keyboard event").ThrowAsJavaScriptException();
                return;
            }
            
            // Set the Unicode character for the event
            CGEventKeyboardSetUnicodeString(keyDownEvent, 1, &character);
            CGEventKeyboardSetUnicodeString(keyUpEvent, 1, &character);
            
            // Post the events
            CGEventPost(kCGHIDEventTap, keyDownEvent);
            CGEventPost(kCGHIDEventTap, keyUpEvent);
            
            // Release the events
            CFRelease(keyDownEvent);
            CFRelease(keyUpEvent);
        }
        
        CFRelease(cfString);
    #elif defined(IS_LINUX)
        Display *display = XOpenDisplay(NULL);
        if (display == NULL) {
            Napi::Error::New(env, "Failed to open X display").ThrowAsJavaScriptException();
            return;
        }
        
        // Type each character in the string
        for (size_t i = 0; i < key.length(); ) {
            // Handle UTF-8 multi-byte characters
            unsigned char c = key[i];
            uint32_t unicode = 0;
            int bytes = 1;
            
            // Decode UTF-8
            if (c < 0x80) {
                // Single byte (ASCII)
                unicode = c;
                bytes = 1;
            } else if ((c & 0xE0) == 0xC0) {
                // 2 bytes
                unicode = ((c & 0x1F) << 6) | (key[i + 1] & 0x3F);
                bytes = 2;
            } else if ((c & 0xF0) == 0xE0) {
                // 3 bytes
                unicode = ((c & 0x0F) << 12) | ((key[i + 1] & 0x3F) << 6) | (key[i + 2] & 0x3F);
                bytes = 3;
            } else if ((c & 0xF8) == 0xF0) {
                // 4 bytes
                unicode = ((c & 0x07) << 18) | ((key[i + 1] & 0x3F) << 12) | 
                        ((key[i + 2] & 0x3F) << 6) | (key[i + 3] & 0x3F);
                bytes = 4;
            }
            
            // Convert Unicode to X11 KeySym
            KeySym keysym = unicode;
            
            // Get the keycode for this keysym
            KeyCode keycode = XKeysymToKeycode(display, keysym);
            
            if (keycode != 0) {
                // Send key press and release
                XTestFakeKeyEvent(display, keycode, True, 0);
                XTestFakeKeyEvent(display, keycode, False, 0);
            }
            
            i += bytes;
        }
        
        XFlush(display);
        XCloseDisplay(display);
    #endif
}

Napi::String Keyboard::GetLayout(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    #if defined(IS_WINDOWS)
        HKL layout = GetKeyboardLayout(0);
        wchar_t layoutName[9];
        if (GetKeyboardLayoutNameW(layoutName)) {
            int size_needed = WideCharToMultiByte(CP_UTF8, 0, layoutName, -1, NULL, 0, NULL, NULL);
            std::string layoutStr(size_needed, 0);
            WideCharToMultiByte(CP_UTF8, 0, layoutName, -1, &layoutStr[0], size_needed, NULL, NULL);
            return Napi::String::New(env, layoutStr.c_str());
        } else {
            Napi::Error::New(env, "Failed to get keyboard layout").ThrowAsJavaScriptException();
            return Napi::String::New(env, "");
        }
    #elif defined(IS_MACOS)
        // Get the current keyboard input source
        TISInputSourceRef currentSource = TISCopyCurrentKeyboardInputSource();
        if (currentSource == NULL) {
            Napi::Error::New(env, "Failed to get current input source").ThrowAsJavaScriptException();
            return Napi::String::New(env, "");
        }
        
        // Get the source ID (e.g., "com.apple.keylayout.US")
        CFStringRef sourceID = (CFStringRef)TISGetInputSourceProperty(currentSource, kTISPropertyInputSourceID);
        
        std::string layout = "";
        if (sourceID != NULL) {
            // Convert CFString to C++ string
            CFIndex length = CFStringGetLength(sourceID);
            CFIndex maxSize = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
            char* buffer = new char[maxSize];
            
            if (CFStringGetCString(sourceID, buffer, maxSize, kCFStringEncodingUTF8)) {
                layout = std::string(buffer);
            }
            
            delete[] buffer;
        }
        
        CFRelease(currentSource);
        return Napi::String::New(env, layout);
        
    #elif defined(IS_LINUX)
        Display *display = XOpenDisplay(NULL);
        if (display == NULL) {
            Napi::Error::New(env, "Failed to open X display").ThrowAsJavaScriptException();
            return Napi::String::New(env, "");
        }
        
        // Get the XKB state
        XkbStateRec state;
        if (XkbGetState(display, XkbUseCoreKbd, &state) != Success) {
            XCloseDisplay(display);
            Napi::Error::New(env, "Failed to get keyboard state").ThrowAsJavaScriptException();
            return Napi::String::New(env, "");
        }
        
        // Get the XKB descriptor
        XkbDescPtr kbd = XkbGetKeyboard(display, XkbAllComponentsMask, XkbUseCoreKbd);
        if (kbd == NULL) {
            XCloseDisplay(display);
            Napi::Error::New(env, "Failed to get keyboard descriptor").ThrowAsJavaScriptException();
            return Napi::String::New(env, "");
        }
        
        // Get the group (layout) names
        Atom* groupNames = kbd->names->groups;
        if (groupNames == NULL || groupNames[state.group] == None) {
            XkbFreeKeyboard(kbd, 0, True);
            XCloseDisplay(display);
            return Napi::String::New(env, "");
        }
        
        // Get the layout name
        char* layoutName = XGetAtomName(display, groupNames[state.group]);
        std::string layout = (layoutName != NULL) ? std::string(layoutName) : "";
        
        if (layoutName != NULL) {
            XFree(layoutName);
        }
        
        XkbFreeKeyboard(kbd, 0, True);
        XCloseDisplay(display);
        
        return Napi::String::New(env, layout);
    #endif
    return Napi::String::New(env, "");
}

void Keyboard::SetLayout(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected 1 argument").ThrowAsJavaScriptException();
        return;
    }

    if (!info[0].IsString()) {
        Napi::TypeError::New(env, "Expected string argument").ThrowAsJavaScriptException();
        return;
    }

    std::string layout = info[0].As<Napi::String>().Utf8Value();

    if (layout.length() == 0) {
        Napi::TypeError::New(env, "Expected non empty string").ThrowAsJavaScriptException();
        return;
    }

    #if defined(IS_WINDOWS)
        HKL hkl = LoadKeyboardLayoutW(std::wstring(layout.begin(), layout.end()).c_str(), KLF_ACTIVATE);
        if (hkl == NULL) {
            Napi::Error::New(env, "Failed to set keyboard layout").ThrowAsJavaScriptException();
            return;
        }
        PostMessageW(GetForegroundWindow(), WM_INPUTLANGCHANGEREQUEST, 0, (LPARAM)hkl);
        PostMessageW(GetForegroundWindow(), WM_INPUTLANGCHANGE, 0, (LPARAM)hkl);    

    #elif defined(IS_MACOS)
        // Convert C++ string to CFString
        CFStringRef layoutID = CFStringCreateWithCString(kCFAllocatorDefault, layout.c_str(), kCFStringEncodingUTF8);
        if (layoutID == NULL) {
            Napi::Error::New(env, "Failed to create CFString from layout").ThrowAsJavaScriptException();
            return;
        }
        
        // Create a dictionary to filter input sources by ID
        CFMutableDictionaryRef filter = CFDictionaryCreateMutable(kCFAllocatorDefault, 1, 
            &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
        CFDictionarySetValue(filter, kTISPropertyInputSourceID, layoutID);
        
        // Get the list of input sources matching the filter
        CFArrayRef inputSources = TISCreateInputSourceList(filter, false);
        
        CFRelease(filter);
        CFRelease(layoutID);
        
        if (inputSources == NULL || CFArrayGetCount(inputSources) == 0) {
            if (inputSources != NULL) CFRelease(inputSources);
            Napi::Error::New(env, "Layout not found").ThrowAsJavaScriptException();
            return;
        }
        
        // Get the first matching input source
        TISInputSourceRef inputSource = (TISInputSourceRef)CFArrayGetValueAtIndex(inputSources, 0);
        
        // Select the input source
        OSStatus status = TISSelectInputSource(inputSource);
        
        CFRelease(inputSources);
        
        if (status != noErr) {
            Napi::Error::New(env, "Failed to set keyboard layout").ThrowAsJavaScriptException();
            return;
        }
    #elif defined(IS_LINUX)
        Display *display = XOpenDisplay(NULL);
        if (display == NULL) {
            Napi::Error::New(env, "Failed to open X display").ThrowAsJavaScriptException();
            return;
        }
        
        // Get the XKB descriptor
        XkbDescPtr kbd = XkbGetKeyboard(display, XkbAllComponentsMask, XkbUseCoreKbd);
        if (kbd == NULL) {
            XCloseDisplay(display);
            Napi::Error::New(env, "Failed to get keyboard descriptor").ThrowAsJavaScriptException();
            return;
        }
        
        // Get the group (layout) names
        Atom* groupNames = kbd->names->groups;
        if (groupNames == NULL) {
            XkbFreeKeyboard(kbd, 0, True);
            XCloseDisplay(display);
            Napi::Error::New(env, "No keyboard layouts available").ThrowAsJavaScriptException();
            return;
        }
        
        // Find the layout group index by name
        int targetGroup = -1;
        for (int i = 0; i < XkbNumKbdGroups; i++) {
            if (groupNames[i] != None) {
                char* groupName = XGetAtomName(display, groupNames[i]);
                if (groupName != NULL) {
                    if (layout == std::string(groupName)) {
                        targetGroup = i;
                        XFree(groupName);
                        break;
                    }
                    XFree(groupName);
                }
            }
        }
        
        if (targetGroup == -1) {
            XkbFreeKeyboard(kbd, 0, True);
            XCloseDisplay(display);
            Napi::Error::New(env, "Layout not found").ThrowAsJavaScriptException();
            return;
        }
        
        // Lock to the target group (layout)
        XkbLockGroup(display, XkbUseCoreKbd, targetGroup);
        XFlush(display);
        
        XkbFreeKeyboard(kbd, 0, True);
        XCloseDisplay(display);
    #endif
    return;
}

Napi::Object Keyboard::Init(Napi::Env env, Napi::Object exports) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set(Napi::String::New(env, "keyDown"), Napi::Function::New(env, Keyboard::keyDown));
    obj.Set(Napi::String::New(env, "keyUp"), Napi::Function::New(env, Keyboard::keyUp));
    obj.Set(Napi::String::New(env, "isKeySupported"), Napi::Function::New(env, Keyboard::isKeySupported));
    obj.Set(Napi::String::New(env, "type"), Napi::Function::New(env, Keyboard::type));
    obj.Set(Napi::String::New(env, "GetLayout"), Napi::Function::New(env, Keyboard::GetLayout));
    obj.Set(Napi::String::New(env, "SetLayout"), Napi::Function::New(env, Keyboard::SetLayout));
    return obj;
}




