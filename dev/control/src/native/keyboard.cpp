#include "keyboard.h"
#include "args.h"
#include "platform.h"
#include "release_all.h"

#if defined(IS_WINDOWS)
    #include <windows.h>
    #include <cstdlib>
    #include <cwchar>
#elif defined(IS_MACOS)
    #include <ApplicationServices/ApplicationServices.h>
    #import <AppKit/AppKit.h>
    #include <Carbon/Carbon.h>
    #include <IOKit/hidsystem/IOLLEvent.h>
    #include <IOKit/hidsystem/ev_keymap.h>
    #include <CoreFoundation/CoreFoundation.h>
    #include <cctype>  // for tolower
#elif defined(IS_LINUX)
    #include "uinput.h"
    #include "wayland.h"
    #include <cstdio>
    #include <linux/input-event-codes.h>
    #include <X11/Xlib.h>
    #include <X11/Xutil.h>
    #include <X11/keysym.h>
    #include <X11/extensions/XTest.h>
    #include <X11/XKBlib.h>
    #include <dlfcn.h>
    #include <unistd.h>
#endif

#include <algorithm>
#include <map>
#include <mutex>
#include <set>
#include <string>
#include <utility>
#include <vector>

// KeyboardEvent.code -> scan code (set 1); 0xE0xx are extended keys
#if defined(IS_WINDOWS)
static const WORD PAUSE_KEY = 0xE11D;

static const std::map<std::string, WORD> SpecialKeys = {
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
    {"NumLock", 0x0045},       // sent as 0x45; Windows itself reports it extended
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
    {"Undo", 0xE008},
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
    {"Pause", PAUSE_KEY},      // E1 1D 45: no scancode SendInput can send, so its virtual key
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
    {"MediaSelect", 0xE06D}
};

#elif defined(IS_MACOS)
static const std::map<std::string, CGKeyCode> SpecialKeys = {
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
static const std::map<std::string, unsigned int> SpecialKeys = {
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


// reads the one non-empty string argument, or throws and returns false
static bool ParseKey(const Napi::CallbackInfo& info, std::string& key) {
    if (!RequireString(info, 0, key)) {
        return false;
    }
    if (key.length() == 0) {
        Napi::TypeError::New(info.Env(), "Argument 1 must not be empty").ThrowAsJavaScriptException();
        return false;
    }
    return true;
}


#if defined(IS_WINDOWS)
// a key press or release by scan code, so it does not depend on the layout
static INPUT ScanCodeInput(WORD code, bool isUp) {
    INPUT input = {0};
    input.type = INPUT_KEYBOARD;
    if (code == PAUSE_KEY) {
        input.ki.wVk = VK_PAUSE;
        input.ki.dwFlags = isUp ? KEYEVENTF_KEYUP : 0;
        return input;
    }
    input.ki.wVk = 0;
    input.ki.wScan = code & 0xFF;
    input.ki.dwFlags = KEYEVENTF_SCANCODE;
    if ((code & 0xFF00) == 0xE000) {
        // the E0 prefix byte is a flag, not part of wScan
        input.ki.dwFlags |= KEYEVENTF_EXTENDEDKEY;
    }
    if (isUp) {
        input.ki.dwFlags |= KEYEVENTF_KEYUP;
    }
    return input;
}

#elif defined(IS_MACOS)
// The modifier keys, each with the event flags it sets while held: the
// device-independent mask and the left/right one (NX_DEVICE*KEYMASK).
struct ModifierKey {
    CGKeyCode keycode;
    CGEventFlags mask;
    CGEventFlags deviceMask;
};
static const ModifierKey ModifierKeys[] = {
    {kVK_Control,      kCGEventFlagMaskControl,     0x00000001},
    {kVK_Shift,        kCGEventFlagMaskShift,       0x00000002},
    {kVK_RightShift,   kCGEventFlagMaskShift,       0x00000004},
    {kVK_Command,      kCGEventFlagMaskCommand,     0x00000008},
    {0x36,             kCGEventFlagMaskCommand,     0x00000010},    // right command
    {kVK_Option,       kCGEventFlagMaskAlternate,   0x00000020},
    {kVK_RightOption,  kCGEventFlagMaskAlternate,   0x00000040},
    {kVK_RightControl, kCGEventFlagMaskControl,     0x00002000},
    {kVK_Function,     kCGEventFlagMaskSecondaryFn, 0}
};

// modifier keys held now, a bit per ModifierKeys entry; with Caps Lock, used
// holding an InputStateLock (platform.h)
static uint32_t heldModifiers = 0;
static bool isCapsLockOn = false;

static int ModifierIndex(CGKeyCode keycode) {
    for (size_t i = 0; i < sizeof(ModifierKeys) / sizeof(ModifierKeys[0]); i++) {
        if (ModifierKeys[i].keycode == keycode) {
            return (int)i;
        }
    }
    return -1;
}

static void UpdateModifierFlags() {
    CGEventFlags flags = 0;
    for (size_t i = 0; i < sizeof(ModifierKeys) / sizeof(ModifierKeys[0]); i++) {
        if (heldModifiers & (1u << i)) {
            flags |= ModifierKeys[i].mask | ModifierKeys[i].deviceMask;
        }
    }
    if (isCapsLockOn) {
        flags |= kCGEventFlagMaskAlphaShift;
    }
    ModifierFlags() = flags;
}

// The volume keys: as key events they reach the focused window and nothing
// else. The system takes them as system-defined events, which no window sees.
// The system's number for one of these keys, or -1.
static int SystemKeyOf(CGKeyCode keycode) {
    switch (keycode) {
        case kVK_VolumeUp: return NX_KEYTYPE_SOUND_UP;
        case kVK_VolumeDown: return NX_KEYTYPE_SOUND_DOWN;
        case kVK_Mute: return NX_KEYTYPE_MUTE;
        default: return -1;
    }
}

static bool PostSystemKey(int systemKey, bool isDown) {
    // workers have no autorelease pool of their own
    @autoreleasepool {
        const NSUInteger state = (NSUInteger)(isDown ? NX_KEYDOWN : NX_KEYUP) << 8;
        NSEvent* event = [NSEvent otherEventWithType:NSEventTypeSystemDefined
            location:NSZeroPoint
            modifierFlags:(NSEventModifierFlags)state
            timestamp:0
            windowNumber:0
            context:nil
            subtype:NX_SUBTYPE_AUX_CONTROL_BUTTONS
            data1:(NSInteger)(((NSUInteger)systemKey << 16) | state)
            data2:-1];
        if (event == nil || event.CGEvent == NULL) {
            return false;
        }
        CGEventPost(kCGHIDEventTap, event.CGEvent);
    }
    return true;
}

// posts a key press or release; a modifier key goes as a flags-changed event
// and is remembered, so later key and mouse events carry it
static bool PostKey(CGKeyCode keycode, bool isDown) {
    InputStateLock lock;
    const int systemKey = SystemKeyOf(keycode);
    if (systemKey >= 0) {
        return PostSystemKey(systemKey, isDown);
    }
    const int modifier = ModifierIndex(keycode);
    if (modifier >= 0) {
        if (isDown) {
            heldModifiers |= (1u << modifier);
        } else {
            heldModifiers &= ~(1u << modifier);
        }
        UpdateModifierFlags();
    } else if (keycode == kVK_CapsLock && isDown) {
        isCapsLockOn = !isCapsLockOn;
        UpdateModifierFlags();
    }

    CGEventRef event = CGEventCreateKeyboardEvent(EventSource(), keycode, isDown);
    if (event == NULL) {
        return false;
    }
    if (modifier >= 0 || keycode == kVK_CapsLock) {
        CGEventSetType(event, kCGEventFlagsChanged);
    }
    CGEventSetFlags(event, ModifierFlags());
    CGEventPost(kCGHIDEventTap, event);
    CFRelease(event);
    return true;
}

#elif defined(IS_LINUX)
// the X11 keysym of a Unicode code point
static KeySym CodepointToKeysym(uint32_t codepoint) {
    switch (codepoint) {
        case '\n':
        case '\r':
            return XK_Return;
        case '\t':
            return XK_Tab;
        case '\b':
            return XK_BackSpace;
        case 0x1B:
            return XK_Escape;
    }
    // Latin-1 keysyms equal their code point; the rest are 0x01000000 + it
    if ((codepoint >= 0x20 && codepoint <= 0x7E) || (codepoint >= 0xA0 && codepoint <= 0xFF)) {
        return codepoint;
    }
    return 0x01000000 | codepoint;
}

// The character a keysym types, as a code point; 0 for none. Keymaps hold
// many characters as legacy keysyms (Hungarian "ő" is odoubleacute, 0x1F5,
// not the Unicode keysym 0x1000151), so characters are looked up by what
// the keys type. libxkbcommon, which every Linux desktop has, knows them
// all; it is loaded at run time, so it is no build or load dependency. Without
// it, Latin-1 and Unicode keysyms are still recognised.
static uint32_t KeysymToCodepoint(KeySym keysym) {
    typedef uint32_t (*ToUtf32)(uint32_t);
    static ToUtf32 toUtf32 = nullptr;
    static bool isLoaded = false;
    if (!isLoaded) {
        isLoaded = true;
        void* library = dlopen("libxkbcommon.so.0", RTLD_LAZY | RTLD_LOCAL);
        if (library != nullptr) {
            toUtf32 = (ToUtf32)dlsym(library, "xkb_keysym_to_utf32");
        }
    }
    if (toUtf32 != nullptr) {
        return toUtf32((uint32_t)keysym);
    }
    if ((keysym >= 0x20 && keysym <= 0x7E) || (keysym >= 0xA0 && keysym <= 0xFF)) {
        return (uint32_t)keysym;
    }
    if ((keysym & 0xFF000000) == 0x01000000) {
        return (uint32_t)(keysym & 0x00FFFFFF);
    }
    return 0;
}

// UTF-8 -> code points, skipping malformed bytes
static std::vector<uint32_t> DecodeUtf8(const std::string& text) {
    std::vector<uint32_t> codepoints;
    const size_t length = text.length();
    for (size_t i = 0; i < length; ) {
        const unsigned char c = text[i];
        int bytes = 0;
        uint32_t codepoint = 0;
        if (c < 0x80) {
            bytes = 1;
            codepoint = c;
        } else if ((c & 0xE0) == 0xC0) {
            bytes = 2;
            codepoint = c & 0x1F;
        } else if ((c & 0xF0) == 0xE0) {
            bytes = 3;
            codepoint = c & 0x0F;
        } else if ((c & 0xF8) == 0xF0) {
            bytes = 4;
            codepoint = c & 0x07;
        } else {
            i++;
            continue;
        }
        if (i + bytes > length) {
            break;
        }
        bool isValid = true;
        for (int b = 1; b < bytes; b++) {
            const unsigned char next = text[i + b];
            if ((next & 0xC0) != 0x80) {
                isValid = false;
                break;
            }
            codepoint = (codepoint << 6) | (next & 0x3F);
        }
        if (isValid) {
            codepoints.push_back(codepoint);
            i += bytes;
        } else {
            i++;
        }
    }
    return codepoints;
}

// keycodes the keymap leaves empty, which type() borrows for characters the
// layout cannot produce
static std::vector<KeyCode> SpareKeycodes(Display* display) {
    std::vector<KeyCode> spare;
    int minKeycode = 0;
    int maxKeycode = 0;
    XDisplayKeycodes(display, &minKeycode, &maxKeycode);
    int keysymsPerKeycode = 0;
    KeySym* keysyms = XGetKeyboardMapping(display, minKeycode, maxKeycode - minKeycode + 1, &keysymsPerKeycode);
    if (keysyms == NULL) {
        return spare;
    }
    for (int keycode = maxKeycode; keycode >= minKeycode; keycode--) {
        bool isEmpty = true;
        for (int i = 0; i < keysymsPerKeycode; i++) {
            if (keysyms[(keycode - minKeycode) * keysymsPerKeycode + i] != NoSymbol) {
                isEmpty = false;
                break;
            }
        }
        if (isEmpty) {
            spare.push_back((KeyCode)keycode);
        }
    }
    XFree(keysyms);
    return spare;
}

// the modifiers type() can hold for a character, as bits
static const unsigned HOLD_SHIFT = 1;
static const unsigned HOLD_ALTGR = 2;

// where a character is on the current layout: its key, and the modifiers
// held for it (HOLD_*)
struct KeyPlace {
    KeyCode keycode = 0;
    unsigned held = 0;
};

// the modifier keys type() holds: their X keycodes, 0 when the layout has none
struct TypingKeys {
    KeyCode shift;
    KeyCode altGr;
    unsigned int altGrMask;     // the modifier AltGr sets, 0 when none
    KeyCode control;
    bool isWayland;
};

// a keymap from XkbGetMap, freed on every path
struct KeymapGuard {
    XkbDescPtr xkb = nullptr;
    ~KeymapGuard() {
        if (this->xkb != nullptr) {
            XkbFreeKeyboard(this->xkb, 0, True);
        }
    }
};

// What the keys type now, read once per type() call: each character's key
// and the modifiers to hold for it, with the locked modifiers (Caps Lock, Num
// Lock) and the group as they are. Control characters by their keysym
// (Return, Tab, ...), at no modifiers, as no key types them as text.
struct TypingMap {
    std::map<uint32_t, KeyPlace> characters;
    std::map<KeySym, KeyCode> controls;
    unsigned int lockedMods = 0;
    int group = 0;
};

// the modifier sets a character can be typed with, fewest first; those the
// layout cannot hold are left out (no Shift_L key; no AltGr key, or one that
// sets no modifier, where the AltGr sets would be the plain ones)
static std::vector<unsigned> HeldSets(const TypingKeys& keys) {
    const bool hasShift = keys.shift != 0;
    const bool hasAltGr = keys.altGr != 0 && keys.altGrMask != 0;
    std::vector<unsigned> sets = { 0 };
    if (hasShift) {
        sets.push_back(HOLD_SHIFT);
    }
    if (hasAltGr) {
        sets.push_back(HOLD_ALTGR);
    }
    if (hasShift && hasAltGr) {
        sets.push_back(HOLD_SHIFT | HOLD_ALTGR);
    }
    return sets;
}

// What a key types with `held` down. The key's XKB type picks the level,
// which covers Caps Lock on letter keys and Num Lock on the keypad; the rest
// of Caps Lock is the clients' (XLookupString, xkbcommon): when Lock is on and
// the key's type does not use it, they upper-case the keysym - so this does.
static KeySym TypedKeysym(XkbDescPtr xkb, const TypingKeys& keys, const TypingMap& map, KeyCode keycode, unsigned held) {
    unsigned int mods = map.lockedMods;
    if (held & HOLD_SHIFT) {
        mods |= ShiftMask;
    }
    if (held & HOLD_ALTGR) {
        mods |= keys.altGrMask;
    }
    unsigned int consumed = 0;
    KeySym keysym = NoSymbol;
    if (!XkbTranslateKeyCode(xkb, keycode, XkbBuildCoreState(mods, map.group), &consumed, &keysym)) {
        return NoSymbol;
    }
    if ((map.lockedMods & LockMask) && !(consumed & LockMask)) {
        KeySym lower = keysym;
        KeySym upper = keysym;
        XConvertCase(keysym, &lower, &upper);
        keysym = upper;
    }
    return keysym;
}

// puts what a key types with `held` down in the map, unless a character is
// there already (with fewer modifiers, or on a lower keycode)
static void AddKey(XkbDescPtr xkb, const TypingKeys& keys, TypingMap& map, KeyCode keycode, unsigned held) {
    const KeySym keysym = TypedKeysym(xkb, keys, map, keycode, held);
    if (keysym == NoSymbol) {
        return;
    }
    if (keysym == XK_Return || keysym == XK_Tab || keysym == XK_BackSpace || keysym == XK_Escape) {
        if (held == 0) {
            map.controls.emplace(keysym, keycode);
        }
        return;
    }
    const uint32_t codepoint = KeysymToCodepoint(keysym);
    if (codepoint >= 0x20 && codepoint != 0x7F) {
        KeyPlace place;
        place.keycode = keycode;
        place.held = held;
        map.characters.emplace(codepoint, place);
    }
}

// the map of every key; the fewest modifiers win, then the lowest keycode
// (with Num Lock on, "1" is on the top row and the keypad: the top row)
static void BuildTypingMap(XkbDescPtr xkb, const TypingKeys& keys, TypingMap& map) {
    for (unsigned held : HeldSets(keys)) {
        for (int keycode = xkb->min_key_code; keycode <= xkb->max_key_code; keycode++) {
            AddKey(xkb, keys, map, (KeyCode)keycode, held);
        }
    }
}

// where a character is; false when no key types it
static bool FindKey(const TypingMap& map, uint32_t codepoint, KeyPlace& place) {
    if (codepoint < 0x20) {
        const auto control = map.controls.find(CodepointToKeysym(codepoint));
        if (control == map.controls.end()) {
            return false;
        }
        place.keycode = control->second;
        place.held = 0;
        return true;
    }
    const auto character = map.characters.find(codepoint);
    if (character == map.characters.end()) {
        return false;
    }
    place = character->second;
    return true;
}

// presses or releases an X keycode: through the virtual keyboard on Wayland
// (whose evdev codes are the X keycodes minus 8), through XTest on X11
static bool SendXKey(Display* display, const TypingKeys& keys, KeyCode keycode, bool isDown, std::string& error) {
    if (keys.isWayland) {
        return VirtualInput::KeyboardKey((unsigned short)(keycode - 8), isDown, error);
    }
    XTestFakeKeyEvent(display, keycode, isDown ? True : False, CurrentTime);
    return true;
}

// taps a key holding Shift and AltGr as `held` says; one step under the X lock
static bool TapWithModifiers(Display* display, const TypingKeys& keys, KeyCode keycode, unsigned held, std::string& error) {
    XDisplayLock lock;
    const bool needsShift = (held & HOLD_SHIFT) != 0;
    const bool needsAltGr = (held & HOLD_ALTGR) != 0;
    bool isDone = true;
    if (needsAltGr) {
        isDone = SendXKey(display, keys, keys.altGr, true, error);
    }
    if (isDone && needsShift) {
        isDone = SendXKey(display, keys, keys.shift, true, error);
    }
    isDone = isDone && SendXKey(display, keys, keycode, true, error) && SendXKey(display, keys, keycode, false, error);
    // the modifiers go up whatever happened
    std::string releaseError;
    if (needsShift) {
        SendXKey(display, keys, keys.shift, false, releaseError);
    }
    if (needsAltGr) {
        SendXKey(display, keys, keys.altGr, false, releaseError);
    }
    return isDone;
}

// taps the key of a character the layout has; false when it has none
static bool TapCharacter(Display* display, const TypingKeys& keys, const TypingMap& map, uint32_t codepoint, std::string& error) {
    KeyPlace place;
    if (!FindKey(map, codepoint, place)) {
        return false;
    }
    return TapWithModifiers(display, keys, place.keycode, place.held, error);
}

// X11: puts characters on spare keys for the rest of the call, and in the
// map: each keycode with its keysym. A cased character goes as {lower, upper},
// which the X server gives the ALPHABETIC type as it does a letter key's, so
// both cases can be typed, Caps Lock and Shift working on it as on letters; an
// uncased one as itself. All are borrowed before the first key is pressed:
// clients refresh their keymaps lazily, and keys borrowed between presses
// reached some of them as no symbol at all. The keys are read back, so they
// are found in the map like any other.
static void BorrowKeys(Display* display, XkbDescPtr xkb, const TypingKeys& keys, TypingMap& map,
        const std::vector<std::pair<KeyCode, KeySym>>& borrowed) {
    XDisplayLock lock;
    for (const auto& entry : borrowed) {
        KeySym keysyms[2] = { entry.second, entry.second };
        XConvertCase(entry.second, &keysyms[0], &keysyms[1]);
        XChangeKeyboardMapping(display, entry.first, 2, keysyms, 1);
    }
    XSync(display, False);
    // (XkbGetKeySyms of the keys alone fails for keys that had no symbols)
    XkbGetUpdatedMap(display, XkbKeySymsMask, xkb);
    for (unsigned held : HeldSets(keys)) {
        for (const auto& entry : borrowed) {
            AddKey(xkb, keys, map, entry.first, held);
        }
    }
}

// GTK's and IBus's Unicode entry: Ctrl+Shift+U, the code point in hex, then
// space; false when the layout lacks a key it needs. The U key may need Shift
// (Caps Lock on): Ctrl+Shift+U starts the entry either way.
static bool TypeUnicodeEntry(Display* display, const TypingKeys& keys, const TypingMap& map, uint32_t codepoint, std::string& error) {
    KeyPlace u;
    if (keys.control == 0 || keys.shift == 0 || !(FindKey(map, 'u', u) || FindKey(map, 'U', u)) || (u.held & HOLD_ALTGR)) {
        return false;
    }
    bool isDone = false;
    {
        XDisplayLock lock;
        isDone = SendXKey(display, keys, keys.control, true, error) && SendXKey(display, keys, keys.shift, true, error) &&
            SendXKey(display, keys, u.keycode, true, error) && SendXKey(display, keys, u.keycode, false, error);
        std::string releaseError;
        SendXKey(display, keys, keys.shift, false, releaseError);
        SendXKey(display, keys, keys.control, false, releaseError);
    }
    char hex[16];
    snprintf(hex, sizeof(hex), "%x", codepoint);
    for (const char* digit = hex; isDone && *digit != '\0'; digit++) {
        isDone = TapCharacter(display, keys, map, (uint32_t)*digit, error);
    }
    return isDone && TapCharacter(display, keys, map, ' ', error);
}
#endif


// keys pressed through keyDown and not released yet, by code, so releaseAll
// can let them go (shared by every JS environment of the process)
static std::mutex pressedKeysMutex;
static std::set<std::string> pressedKeys;

// presses or releases a supported key; the error when it fails
static InputError SendKey(const std::string& key, bool isDown) {
    auto it = SpecialKeys.find(key);
    if (it == SpecialKeys.end()) {
        return InputError{ "", "Key not supported" };
    }

    #if defined(IS_WINDOWS)
        INPUT input = ScanCodeInput(it->second, !isDown);
        if (SendInput(1, &input, sizeof(INPUT)) != 1) {
            return InputBlockedError("SendInput sent nothing");
        }

    #elif defined(IS_MACOS)
        if (!PostKey(it->second, isDown)) {
            return InputError{ "", isDown ? "Failed to create key down event" : "Failed to create key up event" };
        }

    #elif defined(IS_LINUX)
        if (IsWaylandSession()) {
            // the table holds X keycodes, which are the evdev codes plus 8
            std::string error;
            if (!VirtualInput::KeyboardKey((unsigned short)(it->second - 8), isDown, error)) {
                return InputError{ "", error };
            }
            return InputError();
        }
        XDisplayLock lock;
        Display *display = XGetMainDisplay();
        if (display == NULL) {
            return NoDisplayError();
        }
        XTestFakeKeyEvent(display, it->second, isDown ? True : False, CurrentTime);
        XFlush(display);
    #endif
    return InputError();
}

static void PressKey(const Napi::CallbackInfo& info, bool isDown) {
    std::string key;
    if (!ParseKey(info, key)) {
        return;
    }
    const InputError error = SendKey(key, isDown);
    if (error.IsFailed()) {
        ThrowInputError(info.Env(), error);
        return;
    }
    std::lock_guard<std::mutex> lock(pressedKeysMutex);
    if (isDown) {
        pressedKeys.insert(key);
    } else {
        pressedKeys.erase(key);
    }
}

// Keyboard.releaseAll(): releases every key keyDown pressed and keyUp did not
// release yet, e.g. when the remote side of a session is gone. Every one is
// tried; those that fail stay held for the next call, and the first failure
// is thrown.
void Keyboard::releaseAll(const Napi::CallbackInfo& info) {
    std::set<std::string> keys;
    {
        std::lock_guard<std::mutex> lock(pressedKeysMutex);
        keys.swap(pressedKeys);
    }
    const InputError error = ReleaseEach(keys, [](const std::string& key) {
        return SendKey(key, false);
    });
    if (!keys.empty()) {
        std::lock_guard<std::mutex> lock(pressedKeysMutex);
        pressedKeys.insert(keys.begin(), keys.end());
    }
    if (error.IsFailed()) {
        ThrowInputError(info.Env(), error);
    }
}

void Keyboard::keyDown(const Napi::CallbackInfo& info) {
    PressKey(info, true);
}

void Keyboard::keyUp(const Napi::CallbackInfo& info) {
    PressKey(info, false);
}

Napi::Boolean Keyboard::isKeySupported(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::string key;
    if (!ParseKey(info, key)) {
        return Napi::Boolean::New(env, false);
    }
    auto it = SpecialKeys.find(key);
    // 0 is a key too: macOS's A key (kVK_ANSI_A)
    return Napi::Boolean::New(env, it != SpecialKeys.end());
}

#if defined(IS_WINDOWS) || defined(IS_MACOS)
// The key a control character in type()'s text presses ("\n" Enter, ...), by
// its code; nullptr for any other character. Typed as characters, they would
// reach applications as text, not as the keys (macOS would even report the
// A key, whose key code the text events borrow). Linux finds them on the
// layout by their keysyms (CodepointToKeysym).
static const char* ControlCharacterKey(uint32_t codepoint) {
    switch (codepoint) {
        case '\n':
        case '\r':
            return "Enter";
        case '\t':
            return "Tab";
        case '\b':
            return "Backspace";
        case 0x1B:
            return "Escape";
    }
    return nullptr;
}
#endif

void Keyboard::type(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::string text;
    if (!RequireString(info, 0, text)) {
        return;
    }
    if (text.empty()) {
        return;
    }

    #if defined(IS_WINDOWS)
        int wideSize = MultiByteToWideChar(CP_UTF8, 0, text.c_str(), (int)text.length(), NULL, 0);
        if (wideSize <= 0) {
            Napi::Error::New(env, "Failed to convert text").ThrowAsJavaScriptException();
            return;
        }
        std::wstring wide(wideSize, L'\0');
        MultiByteToWideChar(CP_UTF8, 0, text.c_str(), (int)text.length(), &wide[0], wideSize);

        // a press and a release per UTF-16 unit; a surrogate pair goes as its
        // two units in a row, which Windows puts back together. Control
        // characters press their keys, "\r\n" one Enter.
        std::vector<INPUT> inputs;
        inputs.reserve(wide.length() * 2);
        for (size_t i = 0; i < wide.length(); i++) {
            const wchar_t unit = wide[i];
            const char* controlKey = ControlCharacterKey((uint32_t)unit);
            if (controlKey != nullptr) {
                const WORD code = SpecialKeys.at(controlKey);
                inputs.push_back(ScanCodeInput(code, false));
                inputs.push_back(ScanCodeInput(code, true));
                if (unit == L'\r' && i + 1 < wide.length() && wide[i + 1] == L'\n') {
                    i++;
                }
                continue;
            }
            INPUT input = {0};
            input.type = INPUT_KEYBOARD;
            input.ki.wVk = 0;
            input.ki.wScan = unit;
            input.ki.dwFlags = KEYEVENTF_UNICODE;
            inputs.push_back(input);
            input.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
            inputs.push_back(input);
        }
        if (SendInput((UINT)inputs.size(), inputs.data(), sizeof(INPUT)) != (UINT)inputs.size()) {
            ThrowInputBlocked(env, "SendInput did not send all of the text");
        }

    #elif defined(IS_MACOS)
        // Convert UTF-8 string to UTF-16 for macOS
        CFStringRef cfString = CFStringCreateWithCString(kCFAllocatorDefault, text.c_str(), kCFStringEncodingUTF8);
        if (cfString == NULL) {
            Napi::Error::New(env, "Failed to convert string to CFString").ThrowAsJavaScriptException();
            return;
        }

        CFIndex length = CFStringGetLength(cfString);

        // Type each character; a surrogate pair goes in one event
        for (CFIndex i = 0; i < length; ) {
            UniChar characters[2];
            characters[0] = CFStringGetCharacterAtIndex(cfString, i);
            UniCharCount count = 1;
            if (CFStringIsSurrogateHighCharacter(characters[0]) && i + 1 < length) {
                characters[1] = CFStringGetCharacterAtIndex(cfString, i + 1);
                if (CFStringIsSurrogateLowCharacter(characters[1])) {
                    count = 2;
                }
            }
            i += count;

            // a control character presses its key ("\r\n" one Enter); any
            // other goes as text on key code 0
            const char* controlKey = count == 1 ? ControlCharacterKey(characters[0]) : nullptr;
            const CGKeyCode keycode = controlKey != nullptr ? SpecialKeys.at(controlKey) : 0;
            if (characters[0] == '\r' && i < length && CFStringGetCharacterAtIndex(cfString, i) == '\n') {
                i++;
            }

            CGEventRef keyDownEvent = CGEventCreateKeyboardEvent(EventSource(), keycode, true);
            CGEventRef keyUpEvent = CGEventCreateKeyboardEvent(EventSource(), keycode, false);

            if (keyDownEvent == NULL || keyUpEvent == NULL) {
                if (keyDownEvent != NULL) CFRelease(keyDownEvent);
                if (keyUpEvent != NULL) CFRelease(keyUpEvent);
                CFRelease(cfString);
                Napi::Error::New(env, "Failed to create keyboard event").ThrowAsJavaScriptException();
                return;
            }

            // the text is typed as it is, without the modifiers held down
            CGEventSetFlags(keyDownEvent, 0);
            CGEventSetFlags(keyUpEvent, 0);

            if (controlKey == nullptr) {
                CGEventKeyboardSetUnicodeString(keyDownEvent, count, characters);
                CGEventKeyboardSetUnicodeString(keyUpEvent, count, characters);
            }

            // Post the events
            CGEventPost(kCGHIDEventTap, keyDownEvent);
            CGEventPost(kCGHIDEventTap, keyUpEvent);

            // Release the events
            CFRelease(keyDownEvent);
            CFRelease(keyUpEvent);
        }

        CFRelease(cfString);

    #elif defined(IS_LINUX)
        // Keyboard.type(text, { unicodeFallback: true }): on Wayland, enter the
        // characters the layout has no key for with Ctrl+Shift+U
        bool isUnicodeFallback = false;
        if (info.Length() > 1 && info[1].IsObject()) {
            isUnicodeFallback = info[1].As<Napi::Object>().Get("unicodeFallback").ToBoolean().Value();
        }

        // One call at a time: a call keeps the map, the spare keys and what it
        // borrowed across its steps. The X lock is taken per step (see
        // platform.h), so other threads' calls go on while a text is typed.
        static std::mutex typingMutex;
        std::lock_guard<std::mutex> typing(typingMutex);

        Display *display = XGetMainDisplay();
        if (display == NULL) {
            Napi::Error::New(env, IsWaylandSession()
                ? "Typing text on Wayland needs XWayland, to read the keyboard layout from"
                : "Failed to open X display").ThrowAsJavaScriptException();
            return;
        }

        // On Wayland the keys go through the virtual keyboard, so they reach
        // every application; which key makes which character is read from
        // XWayland's copy of the compositor's layout, whose keymap is not a
        // client's to change. On X11 they go through XTest, and a character
        // the layout has no key for is put on a spare keycode for the
        // duration of the call, as xdotool does.
        TypingKeys keys;
        TypingMap map;
        KeymapGuard keymap;
        {
            XDisplayLock lock;
            keys.shift = XKeysymToKeycode(display, XK_Shift_L);
            keys.altGr = XKeysymToKeycode(display, XK_ISO_Level3_Shift);
            keys.altGrMask = XkbKeysymToModifiers(display, XK_ISO_Level3_Shift);
            keys.control = XKeysymToKeycode(display, XK_Control_L);
            keys.isWayland = IsWaylandSession();
            XkbStateRec state;
            if (XkbGetState(display, XkbUseCoreKbd, &state) == Success) {
                map.group = state.group;
                map.lockedMods = state.locked_mods;
            }
            keymap.xkb = XkbGetMap(display, XkbAllClientInfoMask, XkbUseCoreKbd);
            if (keymap.xkb != nullptr) {
                BuildTypingMap(keymap.xkb, keys, map);
            }
        }
        if (keymap.xkb == nullptr) {
            Napi::Error::New(env, "Failed to read the keyboard map").ThrowAsJavaScriptException();
            return;
        }

        std::vector<std::pair<KeyCode, KeySym>> borrowed;
        std::string missing;
        std::string error;
        const auto addMissing = [&missing](uint32_t codepoint) {
            char hex[16];
            snprintf(hex, sizeof(hex), "%sU+%04X", missing.empty() ? "" : ", ", codepoint);
            missing += hex;
        };

        // "\r\n" is one Enter, as on the other platforms
        std::vector<uint32_t> codepoints = DecodeUtf8(text);
        for (size_t i = 1; i < codepoints.size(); ) {
            if (codepoints[i] == '\n' && codepoints[i - 1] == '\r') {
                codepoints.erase(codepoints.begin() + i);
            } else {
                i++;
            }
        }

        // X11: what the layout has no key for goes on spare keys, borrowed for
        // the call; one for both cases of a character (é and É)
        if (!keys.isWayland) {
            std::vector<KeySym> needed;
            for (uint32_t codepoint : codepoints) {
                KeyPlace place;
                if (FindKey(map, codepoint, place)) {
                    continue;
                }
                KeySym lower = CodepointToKeysym(codepoint);
                KeySym upper = lower;
                XConvertCase(lower, &lower, &upper);
                if (std::find(needed.begin(), needed.end(), lower) == needed.end()) {
                    needed.push_back(lower);
                }
            }
            if (!needed.empty()) {
                std::vector<KeyCode> spare;
                {
                    XDisplayLock lock;
                    spare = SpareKeycodes(display);
                }
                for (size_t i = 0; i < needed.size() && i < spare.size(); i++) {
                    borrowed.push_back(std::make_pair(spare[i], needed[i]));
                }
                BorrowKeys(display, keymap.xkb, keys, map, borrowed);
            }
        }

        for (uint32_t codepoint : codepoints) {
            // on the layout (or a borrowed key), with up to Shift+AltGr held
            if (TapCharacter(display, keys, map, codepoint, error)) {
                continue;
            }
            if (!error.empty()) {
                break;
            }

            if (keys.isWayland) {
                if (!isUnicodeFallback || !TypeUnicodeEntry(display, keys, map, codepoint, error)) {
                    if (!error.empty()) {
                        break;
                    }
                    addMissing(codepoint);
                }
                continue;
            }

            // X11: a borrowed key read back as typing something else is
            // tapped as it is; no spare key was left for the others
            KeySym lower = CodepointToKeysym(codepoint);
            KeySym upper = lower;
            XConvertCase(lower, &lower, &upper);
            const auto entry = std::find_if(borrowed.begin(), borrowed.end(), [lower](const std::pair<KeyCode, KeySym>& borrow) {
                return borrow.second == lower;
            });
            if (entry == borrowed.end()) {
                addMissing(codepoint);
            } else {
                TapWithModifiers(display, keys, entry->first, 0, error);
            }
        }
        if (!keys.isWayland) {
            XDisplayLock lock;
            XSync(display, False);
        }

        // give the borrowed keys back (their type goes back with the
        // symbols), once the clients have had the events; the X lock is not
        // held while waiting
        if (!borrowed.empty()) {
            usleep(25000);
            XDisplayLock lock;
            for (const auto& entry : borrowed) {
                KeySym keysyms[2] = {NoSymbol, NoSymbol};
                XChangeKeyboardMapping(display, entry.first, 2, keysyms, 1);
            }
            XSync(display, False);
        }

        if (!error.empty()) {
            Napi::Error::New(env, error).ThrowAsJavaScriptException();
        } else if (!missing.empty() && !keys.isWayland) {
            Napi::Error::New(env, "Not on the current keyboard layout and no spare key left, not typed: " + missing)
                .ThrowAsJavaScriptException();
        } else if (!missing.empty()) {
            Napi::Error::New(env, "Not on the current keyboard layout, not typed: " + missing +
                (isUnicodeFallback ? "" : " (Keyboard.type(text, { unicodeFallback: true }) enters them in GTK and IBus applications)"))
                .ThrowAsJavaScriptException();
        }
    #endif
}

#if defined(IS_WINDOWS)
// the KLID ("00000409", ...) of a keyboard layout handle
static std::wstring LayoutName(HKL hkl) {
    const DWORD value = (DWORD)(UINT_PTR)hkl;
    const WORD language = LOWORD(value);
    const WORD device = HIWORD(value);
    wchar_t name[KL_NAMELENGTH];

    if ((device & 0xF000) == 0xE000) {
        // an input method: the handle is the KLID
        swprintf(name, KL_NAMELENGTH, L"%08X", value);
        return name;
    }
    if ((device & 0xF000) != 0xF000) {
        // the layout is the device word (0 = the language's default layout)
        swprintf(name, KL_NAMELENGTH, L"%08X", (DWORD)(device != 0 ? device : language));
        return name;
    }

    // a layout variant: its "Layout Id" is in the low bits of the device word,
    // and the KLID is the registry key holding that id
    const WORD layoutId = device & 0x0FFF;
    HKEY layouts;
    if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SYSTEM\\CurrentControlSet\\Control\\Keyboard Layouts", 0, KEY_READ, &layouts) == ERROR_SUCCESS) {
        wchar_t klid[KL_NAMELENGTH + 8];
        for (DWORD index = 0; ; index++) {
            DWORD klidLength = sizeof(klid) / sizeof(klid[0]);
            if (RegEnumKeyExW(layouts, index, klid, &klidLength, NULL, NULL, NULL, NULL) != ERROR_SUCCESS) {
                break;
            }
            wchar_t id[16];
            DWORD idSize = sizeof(id);
            if (RegGetValueW(layouts, klid, L"Layout Id", RRF_RT_REG_SZ, NULL, id, &idSize) == ERROR_SUCCESS &&
                wcstoul(id, NULL, 16) == layoutId) {
                RegCloseKey(layouts);
                return klid;
            }
        }
        RegCloseKey(layouts);
    }
    swprintf(name, KL_NAMELENGTH, L"%08X", (DWORD)language);
    return name;
}
#elif defined(IS_LINUX)
// the keyboard's layout (group) names; NULL, after throwing, when unavailable
static XkbDescPtr GetGroupNames(Napi::Env env, Display* display) {
    XkbDescPtr kbd = XkbAllocKeyboard();
    if (kbd == NULL) {
        Napi::Error::New(env, "Failed to get keyboard descriptor").ThrowAsJavaScriptException();
        return NULL;
    }
    if (XkbGetNames(display, XkbGroupNamesMask, kbd) != Success || kbd->names == NULL) {
        XkbFreeKeyboard(kbd, 0, True);
        Napi::Error::New(env, "No keyboard layouts available").ThrowAsJavaScriptException();
        return NULL;
    }
    return kbd;
}
#endif

Napi::String Keyboard::GetLayout(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    #if defined(IS_WINDOWS)
        // the layout of the window the input goes to, not of this thread
        HWND foreground = GetForegroundWindow();
        DWORD threadId = foreground != NULL ? GetWindowThreadProcessId(foreground, NULL) : 0;
        HKL hkl = GetKeyboardLayout(threadId);
        std::wstring layoutName;
        if (hkl != NULL) {
            layoutName = LayoutName(hkl);
        } else {
            wchar_t name[KL_NAMELENGTH];
            if (!GetKeyboardLayoutNameW(name)) {
                Napi::Error::New(env, "Failed to get keyboard layout").ThrowAsJavaScriptException();
                return Napi::String::New(env, "");
            }
            layoutName = name;
        }
        return Napi::String::New(env, std::u16string(layoutName.begin(), layoutName.end()));

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
            std::vector<char> buffer(maxSize);
            if (CFStringGetCString(sourceID, buffer.data(), maxSize, kCFStringEncodingUTF8)) {
                layout = std::string(buffer.data());
            }
        }

        CFRelease(currentSource);
        return Napi::String::New(env, layout);

    #elif defined(IS_LINUX)
        XDisplayLock lock;
        Display *display = RequireDisplay(env);
        if (display == NULL) {
            return Napi::String::New(env, "");
        }

        // Get the XKB state
        XkbStateRec state;
        if (XkbGetState(display, XkbUseCoreKbd, &state) != Success) {
            Napi::Error::New(env, "Failed to get keyboard state").ThrowAsJavaScriptException();
            return Napi::String::New(env, "");
        }

        XkbDescPtr kbd = GetGroupNames(env, display);
        if (kbd == NULL) {
            return Napi::String::New(env, "");
        }

        std::string layout = "";
        Atom groupName = kbd->names->groups[state.group];
        if (groupName != None) {
            char* layoutName = XGetAtomName(display, groupName);
            if (layoutName != NULL) {
                layout = layoutName;
                XFree(layoutName);
            }
        }

        XkbFreeKeyboard(kbd, 0, True);
        return Napi::String::New(env, layout);
    #endif
}

void Keyboard::SetLayout(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::string layout;
    if (!ParseKey(info, layout)) {
        return;
    }

    #if defined(IS_WINDOWS)
        // the layout is switched for the window the input goes to
        HWND foreground = GetForegroundWindow();
        if (foreground == NULL) {
            ThrowInputBlocked(env, "no foreground window to switch the layout of");
            return;
        }

        // only to a layout the user has, never adding one to their languages:
        // the handle with that KLID, in the window's current language when
        // several languages have it (US under English and under Hungarian)
        const std::wstring klid = WidenUtf8(layout);
        const int count = GetKeyboardLayoutList(0, NULL);
        std::vector<HKL> hkls(count > 0 ? count : 0);
        hkls.resize(count > 0 ? GetKeyboardLayoutList(count, hkls.data()) : 0);
        const WORD language = LOWORD((DWORD)(UINT_PTR)GetKeyboardLayout(GetWindowThreadProcessId(foreground, NULL)));
        HKL hkl = NULL;
        for (HKL candidate : hkls) {
            if (_wcsicmp(LayoutName(candidate).c_str(), klid.c_str()) != 0) {
                continue;
            }
            if (hkl == NULL || LOWORD((DWORD)(UINT_PTR)candidate) == language) {
                hkl = candidate;
            }
            if (LOWORD((DWORD)(UINT_PTR)candidate) == language) {
                break;
            }
        }
        if (hkl == NULL) {
            Napi::Error::New(env, "Layout not found").ThrowAsJavaScriptException();
            return;
        }
        // Windows answers the request with WM_INPUTLANGCHANGE itself
        if (!PostMessageW(foreground, WM_INPUTLANGCHANGEREQUEST, 0, (LPARAM)hkl)) {
            Napi::Error::New(env, "Failed to switch the keyboard layout: " + WinErrorText(GetLastError())).ThrowAsJavaScriptException();
            return;
        }

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
        if (IsWaylandSession()) {
            // the compositor owns the layout, and every desktop has its own
            // settings for it (GNOME, KDE, sway, ...); XWayland's copy would
            // change for X clients only
            Napi::Error::New(env, "Setting the keyboard layout is not supported on Wayland").ThrowAsJavaScriptException();
            return;
        }
        XDisplayLock lock;
        Display *display = RequireDisplay(env);
        if (display == NULL) {
            return;
        }

        XkbDescPtr kbd = GetGroupNames(env, display);
        if (kbd == NULL) {
            return;
        }

        // Find the layout group index by name
        int targetGroup = -1;
        for (int i = 0; i < XkbNumKbdGroups; i++) {
            if (kbd->names->groups[i] != None) {
                char* groupName = XGetAtomName(display, kbd->names->groups[i]);
                if (groupName != NULL) {
                    const bool isMatch = (layout == groupName);
                    XFree(groupName);
                    if (isMatch) {
                        targetGroup = i;
                        break;
                    }
                }
            }
        }
        XkbFreeKeyboard(kbd, 0, True);

        if (targetGroup == -1) {
            Napi::Error::New(env, "Layout not found").ThrowAsJavaScriptException();
            return;
        }

        // Lock to the target group (layout)
        XkbLockGroup(display, XkbUseCoreKbd, targetGroup);
        XFlush(display);
    #endif
}

// Keyboard.getLockState(): { capsLock, numLock, scrollLock }, whether each is
// on - so a remote session can bring them in line with the other side's
Napi::Value Keyboard::getLockState(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    bool capsLock = false;
    bool numLock = false;
    bool scrollLock = false;

    #if defined(IS_WINDOWS)
        // the low bit is the toggle; the system's, as this thread reads no
        // keyboard messages of its own
        capsLock = (GetKeyState(VK_CAPITAL) & 1) != 0;
        numLock = (GetKeyState(VK_NUMLOCK) & 1) != 0;
        scrollLock = (GetKeyState(VK_SCROLL) & 1) != 0;

    #elif defined(IS_MACOS)
        // Mac keyboards have Caps Lock only
        capsLock = (CGEventSourceFlagsState(kCGEventSourceStateHIDSystemState) & kCGEventFlagMaskAlphaShift) != 0;

    #elif defined(IS_LINUX)
        // the keyboard indicators, by name; on Wayland XWayland's, which follow
        // the compositor's
        XDisplayLock lock;
        Display* display = RequireDisplay(env);
        if (display == NULL) {
            return env.Undefined();
        }
        const auto isOn = [display](const char* name) {
            Bool on = False;
            const Atom atom = XInternAtom(display, name, True);
            return atom != None && XkbGetNamedIndicator(display, atom, NULL, &on, NULL, NULL) && on;
        };
        capsLock = isOn("Caps Lock");
        numLock = isOn("Num Lock");
        scrollLock = isOn("Scroll Lock");
    #endif

    Napi::Object result = Napi::Object::New(env);
    result.Set("capsLock", capsLock);
    result.Set("numLock", numLock);
    result.Set("scrollLock", scrollLock);
    return result;
}

Napi::Object Keyboard::Init(Napi::Env env, Napi::Object exports) {
    Napi::Object obj = Napi::Object::New(env);
    SetFunction(env, obj, "keyDown", Keyboard::keyDown);
    SetFunction(env, obj, "keyUp", Keyboard::keyUp);
    SetFunction(env, obj, "releaseAll", Keyboard::releaseAll);
    SetFunction(env, obj, "isKeySupported", Keyboard::isKeySupported);
    SetFunction(env, obj, "type", Keyboard::type);
    SetFunction(env, obj, "getLockState", Keyboard::getLockState);
    // getLayout/setLayout, and the same functions by their old names
    obj.Set("GetLayout", SetFunction(env, obj, "getLayout", Keyboard::GetLayout));
    obj.Set("SetLayout", SetFunction(env, obj, "setLayout", Keyboard::SetLayout));
    return obj;
}
