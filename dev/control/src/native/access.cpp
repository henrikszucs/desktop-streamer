#include "access.h"
#include "args.h"
#include "platform.h"

#if defined(IS_WINDOWS)
    #include <cwchar>
#elif defined(IS_MACOS)
    #include <ApplicationServices/ApplicationServices.h>
    #include <Carbon/Carbon.h>
#elif defined(IS_LINUX)
    #include "wayland.h"
    #include <unistd.h>
#endif


// true when input sent now reaches applications:
//   macOS   the Accessibility permission of the app running this (without it
//           every synthesized event is dropped, without an error)
//   Linux   Wayland: /dev/uinput can be written (the virtual devices need it);
//           X11: the X display can be opened
//   Windows always (it asks nothing; see the README's limits)
static bool HasAccess() {
    #if defined(IS_MACOS)
        return AXIsProcessTrusted();
    #elif defined(IS_LINUX)
        if (IsWaylandSession()) {
            return access("/dev/uinput", W_OK) == 0 || access("/dev/input/uinput", W_OK) == 0;
        }
        return XGetMainDisplay() != nullptr;
    #else
        return true;
    #endif
}

Napi::Boolean InputAccess::hasInputAccess(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), HasAccess());
}

// Platform.requestInputAccess(): macOS shows its prompt pointing the user to
// the Accessibility settings (once per app, while the permission is not
// given); the Promise resolves with the access there is now, which on macOS
// stays false until the user has allowed it - check again later
Napi::Value InputAccess::requestInputAccess(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    bool hasAccess = false;
    #if defined(IS_MACOS)
        const void* keys[] = { kAXTrustedCheckOptionPrompt };
        const void* values[] = { kCFBooleanTrue };
        CFDictionaryRef options = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 1,
            &kCFCopyStringDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
        hasAccess = AXIsProcessTrustedWithOptions(options);
        if (options != NULL) {
            CFRelease(options);
        }
    #else
        hasAccess = HasAccess();
    #endif
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
    deferred.Resolve(Napi::Boolean::New(env, hasAccess));
    return deferred.Promise();
}

#if defined(IS_WINDOWS)
// the integrity level (its RID: medium 0x2000, high 0x3000, ...) of a
// process's token; -1 when it cannot be read
static long IntegrityLevel(HANDLE process) {
    HANDLE token = NULL;
    if (!OpenProcessToken(process, TOKEN_QUERY, &token)) {
        return -1;
    }
    long level = -1;
    DWORD size = 0;
    GetTokenInformation(token, TokenIntegrityLevel, NULL, 0, &size);
    std::vector<BYTE> buffer(size > 0 ? size : 1);
    if (size > 0 && GetTokenInformation(token, TokenIntegrityLevel, buffer.data(), size, &size)) {
        const TOKEN_MANDATORY_LABEL* label = reinterpret_cast<const TOKEN_MANDATORY_LABEL*>(buffer.data());
        const PUCHAR count = GetSidSubAuthorityCount(label->Label.Sid);
        level = (long)*GetSidSubAuthority(label->Label.Sid, (DWORD)(*count - 1));
    }
    CloseHandle(token);
    return level;
}
#endif

// why input sent now would not arrive; nullptr when nothing is known to stop it
static const char* InputBlock() {
    #if defined(IS_WINDOWS)
        // the secure desktop (UAC prompts, the lock and sign-in screens,
        // Ctrl+Alt+Del) is not this process's to open, or is not "Default"
        HDESK desktop = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
        if (desktop == NULL) {
            return "secure-desktop";
        }
        wchar_t name[64] = L"";
        const bool hasName = GetUserObjectInformationW(desktop, UOI_NAME, name, sizeof(name), NULL) != FALSE;
        CloseDesktop(desktop);
        if (hasName && _wcsicmp(name, L"Default") != 0) {
            return "secure-desktop";
        }

        // User Interface Privilege Isolation: a window of a process of higher
        // integrity (one run as administrator) drops this process's input. A
        // process that cannot even be asked is one of those too.
        HWND foreground = GetForegroundWindow();
        DWORD processId = 0;
        if (foreground != NULL && GetWindowThreadProcessId(foreground, &processId) != 0 && processId != GetCurrentProcessId()) {
            const long ownLevel = IntegrityLevel(GetCurrentProcess());
            bool isHigher = false;
            HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
            if (process == NULL) {
                isHigher = GetLastError() == ERROR_ACCESS_DENIED;
            } else {
                // a token that cannot be read is one of a higher level too
                const long level = IntegrityLevel(process);
                isHigher = level < 0 || level > ownLevel;
                CloseHandle(process);
            }
            if (ownLevel >= 0 && isHigher) {
                return "elevated-window";
            }
        }
        return nullptr;

    #elif defined(IS_MACOS)
        if (!AXIsProcessTrusted()) {
            return "no-permission";
        }
        // a password field (or an app) has asked for secure keyboard entry:
        // keys are dropped, the mouse still works
        if (IsSecureEventInputEnabled()) {
            return "secure-input";
        }
        return nullptr;

    #else
        return HasAccess() ? nullptr : "no-permission";
    #endif
}

// Platform.getInputBlock(): null when input sent now should arrive, else why
// not: "secure-desktop", "elevated-window" (Windows), "secure-input" (macOS),
// "no-permission" (macOS, Wayland)
Napi::Value InputAccess::getInputBlock(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const char* block = InputBlock();
    return block != nullptr ? Napi::Value(Napi::String::New(env, block)) : env.Null();
}

Napi::Object InputAccess::Init(Napi::Env env, Napi::Object exports) {
    Napi::Object obj = Napi::Object::New(env);
    SetFunction(env, obj, "hasInputAccess", InputAccess::hasInputAccess);
    SetFunction(env, obj, "requestInputAccess", InputAccess::requestInputAccess);
    SetFunction(env, obj, "getInputBlock", InputAccess::getInputBlock);
    return obj;
}
