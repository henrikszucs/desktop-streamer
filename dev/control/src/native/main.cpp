// General addons
#include <napi.h>


// Check platform
#if !defined(IS_WINDOWS) && !defined(IS_MACOS) && !defined(IS_LINUX)
    #error "Unsupported platform"
#endif

// Include modules
#include "mouse.h"
#include "keyboard.h"
#include "gamepad.h"
#include "screen.h"
#include "access.h"


Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set(Napi::String::New(env, "Mouse"), Mouse::Init(env, exports));
    obj.Set(Napi::String::New(env, "Keyboard"), Keyboard::Init(env, exports));
    obj.Set(Napi::String::New(env, "Gamepad"), Gamepad::Init(env, exports));
    obj.Set(Napi::String::New(env, "Screen"), IScreen::Init(env, exports));
    obj.Set(Napi::String::New(env, "Platform"), InputAccess::Init(env, exports));

    return obj;
}

NODE_API_MODULE(addon, InitAll);
