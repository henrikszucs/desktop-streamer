#include "gamepad_win.h"

#include <windows.h>
#include <cfgmgr32.h>
#include <hidsdi.h>
#include <shellapi.h>

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <thread>
#include <vector>

#include "platform.h"
#include "windows-gamepad/common/easycontrol_pad.h"

// how long a new pad's devices may take to come up
static const DWORD DEVICE_TIMEOUT_MS = 10000;
static const DWORD SERVICE_TIMEOUT_MS = 10000;
// how often a version 2 driver is asked for the rumble state
static const DWORD OUTPUT_POLL_MS = 16;

// {4D1E55B2-F16F-11CF-88CB-001111000030}
static const GUID HidInterfaceGuid = { 0x4D1E55B2, 0xF16F, 0x11CF, { 0x88, 0xCB, 0x00, 0x11, 0x11, 0x00, 0x00, 0x30 } };

struct WinPad {
    HANDLE pipe = INVALID_HANDLE_VALUE;     // the pad lives while this is open
    HANDLE xusb = INVALID_HANDLE_VALUE;
    std::wstring xusbPath;
    HANDLE hid = INVALID_HANDLE_VALUE;      // its vendor collection
    EASYCONTROL_PAD_STATE state = {};
    int driverVersion = 0;                  // what the running driver says it is

    // the rumble thread (WinPadStartOutput)
    std::thread outputThread;
    HANDLE stopEvent = NULL;
    WinPadOutputCallback outputCallback = nullptr;
    void* outputContext = nullptr;
};

static void SetError(WinPadError& error, const char* code, const std::string& message) {
    error.code = code;
    error.message = message;
}


//
// driver status and setup
//

static std::wstring ModuleFolder();

// the version of the driver files beside the addon (gamepad/version.json,
// {"version": N}); 0 when they are missing
static int ReadBundledVersion() {
    int version = 0;
    FILE* file = _wfopen((ModuleFolder() + L"\\gamepad\\version.json").c_str(), L"rb");
    if (file == nullptr) {
        return version;
    }
    char text[256] = {};
    const size_t length = fread(text, 1, sizeof(text) - 1, file);
    fclose(file);
    text[length] = '\0';
    const char* key = strstr(text, "\"version\"");
    const char* colon = key != nullptr ? strchr(key, ':') : nullptr;
    if (colon != nullptr) {
        version = (int)strtol(colon + 1, nullptr, 10);
    }
    return version;
}

// read once (and once only, whichever thread asks first): the files do not
// change while the addon is loaded
static int BundledVersion() {
    static const int version = ReadBundledVersion();
    return version;
}

WinDriverStatus WinDriverGetStatus() {
    WinDriverStatus status = { false, 0, EASYCONTROL_PAD_MIN_VERSION, BundledVersion() };
    DWORD version = 0;
    DWORD size = sizeof(version);
    if (RegGetValueW(HKEY_LOCAL_MACHINE, EASYCONTROL_REGISTRY_KEY, L"Version", RRF_RT_REG_DWORD, nullptr, &version, &size) != ERROR_SUCCESS) {
        return status;
    }
    status.version = (int)version;
    SC_HANDLE manager = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CONNECT);
    if (manager != nullptr) {
        SC_HANDLE service = OpenServiceW(manager, EASYCONTROL_SERVICE_NAME, SERVICE_QUERY_STATUS);
        if (service != nullptr) {
            status.isInstalled = true;
            CloseServiceHandle(service);
        }
        CloseServiceHandle(manager);
    }
    return status;
}

// the folder of this .node; the driver files are in its "gamepad" folder
static std::wstring ModuleFolder() {
    HMODULE module = nullptr;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
        reinterpret_cast<LPCWSTR>(&ModuleFolder), &module);
    std::vector<wchar_t> path(MAX_PATH);
    for (;;) {
        DWORD length = GetModuleFileNameW(module, path.data(), (DWORD)path.size());
        if (length < path.size()) {
            std::wstring result(path.data(), length);
            // Node loads addons by \\?\ paths, which PowerShell cannot take apart
            if (result.rfind(L"\\\\?\\UNC\\", 0) == 0) {
                result = L"\\\\" + result.substr(8);
            } else if (result.rfind(L"\\\\?\\", 0) == 0) {
                result = result.substr(4);
            }
            return result.substr(0, result.find_last_of(L"\\/"));
        }
        path.resize(path.size() * 2);
    }
}

// the setup's exit code when it did not install over a newer version
static const DWORD SETUP_EXIT_NEWER_INSTALLED = 2;

bool WinDriverRunSetup(const wchar_t* action, bool force, WinPadError& error) {
    const std::wstring script = ModuleFolder() + L"\\gamepad\\easy-control-gamepad-setup.ps1";
    if (GetFileAttributesW(script.c_str()) == INVALID_FILE_ATTRIBUTES) {
        SetError(error, "EASYCONTROL_SETUP_MISSING", "The gamepad driver files are missing beside the addon");
        return false;
    }
    wchar_t system[MAX_PATH];
    GetSystemDirectoryW(system, MAX_PATH);
    const std::wstring powershell = std::wstring(system) + L"\\WindowsPowerShell\\v1.0\\powershell.exe";
    const std::wstring parameters = L"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + L"\" " + action +
        (force ? L" -Force" : L"");

    SHELLEXECUTEINFOW execute = {};
    execute.cbSize = sizeof(execute);
    execute.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
    execute.lpVerb = L"runas";
    execute.lpFile = powershell.c_str();
    execute.lpParameters = parameters.c_str();
    execute.nShow = SW_HIDE;
    if (!ShellExecuteExW(&execute)) {
        const DWORD code = GetLastError();
        if (code == ERROR_CANCELLED) {
            SetError(error, "EASYCONTROL_SETUP_CANCELLED", "The administrator permission was not given");
        } else {
            SetError(error, "EASYCONTROL_SETUP_FAILED", "Starting the driver setup failed: " + WinErrorText(code));
        }
        return false;
    }
    WaitForSingleObject(execute.hProcess, INFINITE);
    DWORD exitCode = 1;
    GetExitCodeProcess(execute.hProcess, &exitCode);
    CloseHandle(execute.hProcess);
    if (exitCode == SETUP_EXIT_NEWER_INSTALLED) {
        SetError(error, "EASYCONTROL_SETUP_FAILED",
            "A newer gamepad driver is installed, which serves this version too; installDriver({ force: true }) replaces it");
        return false;
    }
    if (exitCode != 0) {
        SetError(error, "EASYCONTROL_SETUP_FAILED",
            "The driver setup failed, its log is %ProgramData%\\easy-control\\gamepad-setup.log");
        return false;
    }
    return true;
}


//
// the service
//

// How often a missing pipe starts the service again. The service stops by
// itself when idle and reports RUNNING until it has stopped, so a start in
// that time is answered ERROR_SERVICE_ALREADY_RUNNING and does nothing: once
// it has gone, the next start brings it back.
static const DWORD SERVICE_RESTART_MS = 500;

// asks the service to start: it starts on demand, and signed-in users may
// start it. True when it starts or runs (or is stopping, see above), or the
// service database is busy - both waited out by the caller; false, with the
// error, when it cannot be started (not installed, disabled, ...).
static bool StartGamepadService(DWORD& startError) {
    SC_HANDLE manager = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CONNECT);
    SC_HANDLE service = manager != nullptr ? OpenServiceW(manager, EASYCONTROL_SERVICE_NAME, SERVICE_START) : nullptr;
    bool isOk = false;
    if (service == nullptr) {
        startError = GetLastError();
    } else if (StartServiceW(service, 0, nullptr)) {
        isOk = true;
    } else {
        startError = GetLastError();
        isOk = startError == ERROR_SERVICE_ALREADY_RUNNING || startError == ERROR_SERVICE_DATABASE_LOCKED;
    }
    if (service != nullptr) {
        CloseServiceHandle(service);
    }
    if (manager != nullptr) {
        CloseServiceHandle(manager);
    }
    return isOk;
}

// connects to the service's pipe by `end` (GetTickCount64), starting the
// service if needed
static HANDLE ConnectToService(ULONGLONG end, WinPadError& error) {
    ULONGLONG nextStart = 0;
    for (;;) {
        HANDLE pipe = CreateFileW(EASYCONTROL_PIPE_NAME, GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING,
            SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, nullptr);
        if (pipe != INVALID_HANDLE_VALUE) {
            DWORD mode = PIPE_READMODE_MESSAGE;
            SetNamedPipeHandleState(pipe, &mode, nullptr, nullptr);
            return pipe;
        }
        const DWORD code = GetLastError();
        if (GetTickCount64() > end) {
            SetError(error, "EASYCONTROL_SERVICE_FAILED", "The gamepad service did not answer: " + WinErrorText(code));
            return INVALID_HANDLE_VALUE;
        }
        if (code == ERROR_PIPE_BUSY) {
            WaitNamedPipeW(EASYCONTROL_PIPE_NAME, 1000);
            continue;
        }
        if (code == ERROR_FILE_NOT_FOUND && GetTickCount64() >= nextStart) {
            DWORD startError = 0;
            if (!StartGamepadService(startError)) {
                SetError(error, "EASYCONTROL_SERVICE_FAILED", "Starting the gamepad service failed: " + WinErrorText(startError));
                return INVALID_HANDLE_VALUE;
            }
            nextStart = GetTickCount64() + SERVICE_RESTART_MS;
        }
        Sleep(50);
    }
}

// the device interface paths of one class on one device
static std::vector<std::wstring> InterfacePaths(const GUID& guid, const wchar_t* instanceId) {
    std::vector<std::wstring> paths;
    ULONG length = 0;
    if (CM_Get_Device_Interface_List_SizeW(&length, const_cast<GUID*>(&guid), const_cast<wchar_t*>(instanceId),
            CM_GET_DEVICE_INTERFACE_LIST_PRESENT) != CR_SUCCESS || length <= 1) {
        return paths;
    }
    std::vector<wchar_t> list(length);
    if (CM_Get_Device_Interface_ListW(const_cast<GUID*>(&guid), const_cast<wchar_t*>(instanceId), list.data(), length,
            CM_GET_DEVICE_INTERFACE_LIST_PRESENT) != CR_SUCCESS) {
        return paths;
    }
    for (const wchar_t* path = list.data(); *path != L'\0'; path += wcslen(path) + 1) {
        paths.emplace_back(path);
    }
    return paths;
}

// the XUSB device, and the path it was opened by (the rumble thread opens it
// again: a handle without FILE_FLAG_OVERLAPPED does one request at a time)
static HANDLE OpenXusb(const wchar_t* instanceId, std::wstring& openedPath) {
    for (const std::wstring& path : InterfacePaths(EASYCONTROL_GUID_DEVINTERFACE_XUSB, instanceId)) {
        HANDLE handle = CreateFileW(path.c_str(), GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
            nullptr, OPEN_EXISTING, 0, nullptr);
        if (handle != INVALID_HANDLE_VALUE) {
            openedPath = path;
            return handle;
        }
    }
    return INVALID_HANDLE_VALUE;
}

// the running driver's version: it answers EASYCONTROL_IOCTL_GET_VERSION from
// version 3 on, and version 2 refuses it
static int DriverVersion(HANDLE xusb) {
    EASYCONTROL_PAD_VERSION_INFO info = {};
    DWORD returned = 0;
    if (DeviceIoControl(xusb, EASYCONTROL_IOCTL_GET_VERSION, nullptr, 0, &info, sizeof(info), &returned, nullptr) &&
            returned == sizeof(info)) {
        return (int)info.Version;
    }
    return 2;
}

// the HID device's vendor collection, one of the collections hidclass made
// as its children
static HANDLE OpenHidStateCollection(const wchar_t* instanceId) {
    DEVINST device;
    if (CM_Locate_DevNodeW(&device, const_cast<wchar_t*>(instanceId), CM_LOCATE_DEVNODE_NORMAL) != CR_SUCCESS) {
        return INVALID_HANDLE_VALUE;
    }
    DEVINST child;
    CONFIGRET result = CM_Get_Child(&child, device, 0);
    while (result == CR_SUCCESS) {
        wchar_t childId[MAX_DEVICE_ID_LEN];
        if (CM_Get_Device_IDW(child, childId, MAX_DEVICE_ID_LEN, 0) == CR_SUCCESS) {
            for (const std::wstring& path : InterfacePaths(HidInterfaceGuid, childId)) {
                HANDLE handle = CreateFileW(path.c_str(), GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
                    nullptr, OPEN_EXISTING, 0, nullptr);
                if (handle == INVALID_HANDLE_VALUE) {
                    continue;
                }
                PHIDP_PREPARSED_DATA preparsed = nullptr;
                HIDP_CAPS caps = {};
                const bool isOurs = HidD_GetPreparsedData(handle, &preparsed) &&
                    HidP_GetCaps(preparsed, &caps) == HIDP_STATUS_SUCCESS &&
                    caps.UsagePage == EASYCONTROL_HID_VENDOR_USAGE_PAGE &&
                    caps.FeatureReportByteLength == 1 + sizeof(EASYCONTROL_PAD_STATE);
                if (preparsed != nullptr) {
                    HidD_FreePreparsedData(preparsed);
                }
                if (isOurs) {
                    return handle;
                }
                CloseHandle(handle);
            }
        }
        result = CM_Get_Sibling(&child, child, 0);
    }
    return INVALID_HANDLE_VALUE;
}

static bool SendState(WinPad* pad) {
    DWORD returned = 0;
    const bool isXusbSent = DeviceIoControl(pad->xusb, EASYCONTROL_IOCTL_SET_STATE, &pad->state, sizeof(pad->state),
        nullptr, 0, &returned, nullptr) != FALSE;
    UCHAR report[1 + sizeof(EASYCONTROL_PAD_STATE)];
    report[0] = EASYCONTROL_HID_STATE_REPORT_ID;
    memcpy(report + 1, &pad->state, sizeof(pad->state));
    const bool isHidSent = HidD_SetFeature(pad->hid, report, sizeof(report)) != FALSE;
    return isXusbSent && isHidSent;
}


//
// pads
//

WinPad* WinPadCreate(WinPadError& error) {
    const WinDriverStatus status = WinDriverGetStatus();
    if (!status.isInstalled) {
        SetError(error, "EASYCONTROL_DRIVER_MISSING",
            "The easy-control gamepad driver is not installed; Gamepad.installDriver() installs it");
        return nullptr;
    }
    if (status.version < EASYCONTROL_PAD_MIN_VERSION) {
        SetError(error, "EASYCONTROL_DRIVER_OUTDATED",
            "The easy-control gamepad driver is outdated (" + std::to_string(status.version) + ", needs " +
            std::to_string(status.required) + "); Gamepad.installDriver() updates it");
        return nullptr;
    }

    WinPad* pad = new WinPad();
    const ULONGLONG serviceEnd = GetTickCount64() + SERVICE_TIMEOUT_MS;
    EASYCONTROL_PIPE_REQUEST request = { EASYCONTROL_PIPE_MAGIC, EASYCONTROL_PAD_VERSION, EASYCONTROL_PIPE_CREATE };
    EASYCONTROL_PIPE_RESPONSE response = {};
    for (bool isRetry = false; ; isRetry = true) {
        pad->pipe = ConnectToService(serviceEnd, error);
        if (pad->pipe == INVALID_HANDLE_VALUE) {
            delete pad;
            return nullptr;
        }
        DWORD read = 0;
        if (TransactNamedPipe(pad->pipe, &request, sizeof(request), &response, sizeof(response), &read, nullptr)) {
            if (read != sizeof(response) || response.Magic != EASYCONTROL_PIPE_MAGIC) {
                SetError(error, "EASYCONTROL_SERVICE_FAILED", read != sizeof(response)
                    ? "The gamepad service answered " + std::to_string(read) + " bytes, expected " + std::to_string(sizeof(response))
                    : std::string("The gamepad service's answer is not of this protocol (wrong magic number)"));
                WinPadDestroy(pad);
                return nullptr;
            }
            break;
        }
        // The service's idle stop closes a connection made just as it
        // decides to stop: connect again (starting it again) once.
        const DWORD code = GetLastError();
        const bool isClosed = code == ERROR_PIPE_NOT_CONNECTED || code == ERROR_BROKEN_PIPE || code == ERROR_NO_DATA;
        if (isClosed && !isRetry && GetTickCount64() < serviceEnd) {
            CloseHandle(pad->pipe);
            pad->pipe = INVALID_HANDLE_VALUE;
            continue;
        }
        SetError(error, "EASYCONTROL_SERVICE_FAILED", "The gamepad service did not answer: " + WinErrorText(code));
        WinPadDestroy(pad);
        return nullptr;
    }
    if (response.Result == EASYCONTROL_E_NO_SLOT) {
        SetError(error, "EASYCONTROL_NO_SLOT", "No free slot for another virtual gamepad (4 at most)");
        WinPadDestroy(pad);
        return nullptr;
    }
    if (FAILED(response.Result)) {
        SetError(error, "EASYCONTROL_CREATE_FAILED", "Plugging in the virtual gamepad failed: " + WinErrorText((DWORD)response.Result));
        WinPadDestroy(pad);
        return nullptr;
    }

    // the devices' interfaces come up once their drivers have started
    const ULONGLONG end = GetTickCount64() + DEVICE_TIMEOUT_MS;
    while ((pad->xusb == INVALID_HANDLE_VALUE || pad->hid == INVALID_HANDLE_VALUE) && GetTickCount64() < end) {
        if (pad->xusb == INVALID_HANDLE_VALUE) {
            pad->xusb = OpenXusb(response.XusbInstanceId, pad->xusbPath);
        }
        if (pad->hid == INVALID_HANDLE_VALUE) {
            pad->hid = OpenHidStateCollection(response.HidInstanceId);
        }
        if (pad->xusb == INVALID_HANDLE_VALUE || pad->hid == INVALID_HANDLE_VALUE) {
            Sleep(50);
        }
    }
    if (pad->xusb == INVALID_HANDLE_VALUE || pad->hid == INVALID_HANDLE_VALUE) {
        SetError(error, "EASYCONTROL_CREATE_FAILED", std::string("The virtual gamepad's ") +
            (pad->xusb == INVALID_HANDLE_VALUE ? "XInput" : "HID") + " device did not start");
        WinPadDestroy(pad);
        return nullptr;
    }

    // The registry says what the setup installed, the service and the driver
    // what runs: older ones are left from before an update - devices made
    // before it, or a service that kept running.
    pad->driverVersion = DriverVersion(pad->xusb);
    const int running = (int)response.Version < pad->driverVersion ? (int)response.Version : pad->driverVersion;
    if (running < status.version) {
        SetError(error, "EASYCONTROL_DRIVER_RESTART_NEEDED", "The gamepad driver " + std::to_string(status.version) +
            " is installed, but version " + std::to_string(running) +
            " still runs; destroy every gamepad and try again in a minute, or run Gamepad.installDriver()");
        WinPadDestroy(pad);
        return nullptr;
    }

    // triggers rest released, sticks centred
    if (!SendState(pad)) {
        SetError(error, "EASYCONTROL_CREATE_FAILED", "The virtual gamepad did not take its state: " + WinErrorText(GetLastError()));
        WinPadDestroy(pad);
        return nullptr;
    }
    return pad;
}

void WinPadDestroy(WinPad* pad) {
    if (pad == nullptr) {
        return;
    }
    WinPadStopOutput(pad);
    if (pad->hid != INVALID_HANDLE_VALUE) {
        CloseHandle(pad->hid);
    }
    if (pad->xusb != INVALID_HANDLE_VALUE) {
        CloseHandle(pad->xusb);
    }
    // the service unplugs the pad when its connection closes
    if (pad->pipe != INVALID_HANDLE_VALUE) {
        CloseHandle(pad->pipe);
    }
    if (pad->stopEvent != NULL) {
        CloseHandle(pad->stopEvent);
    }
    delete pad;
}

// XInput button bits for W3C buttons 0-16 (6 and 7 are the triggers)
static const UINT16 ButtonBits[17] = {
    0x1000, 0x2000, 0x4000, 0x8000,     // A B X Y
    0x0100, 0x0200,                     // left and right shoulder
    0, 0,                               // triggers
    0x0020, 0x0010,                     // back, start
    0x0040, 0x0080,                     // left and right thumb
    0x0001, 0x0002, 0x0004, 0x0008,     // D-pad up, down, left, right
    0x0400                              // guide
};

bool WinPadSend(WinPad* pad) {
    return SendState(pad);
}

bool WinPadSetButton(WinPad* pad, int button, bool isDown, bool isSent) {
    if (button == 6) {
        pad->state.LeftTrigger = isDown ? 255 : 0;
    } else if (button == 7) {
        pad->state.RightTrigger = isDown ? 255 : 0;
    } else if (isDown) {
        pad->state.Buttons |= ButtonBits[button];
    } else {
        pad->state.Buttons &= (UINT16)~ButtonBits[button];
    }
    return !isSent || SendState(pad);
}

bool WinPadSetAxis(WinPad* pad, int axis, double value, bool isSent) {
    const INT16 stick = (INT16)std::lround(value * 32767.0);
    const UINT8 trigger = (UINT8)std::lround((value + 1.0) * 127.5);
    switch (axis) {
        case 0: pad->state.ThumbLX = stick; break;
        case 1: pad->state.ThumbLY = (INT16)-stick; break;     // XInput counts up as positive
        case 2: pad->state.ThumbRX = stick; break;
        case 3: pad->state.ThumbRY = (INT16)-stick; break;
        case 4: pad->state.LeftTrigger = trigger; break;
        case 5: pad->state.RightTrigger = trigger; break;
    }
    return !isSent || SendState(pad);
}


//
// rumble
//

// Waits for one rumble change: a version 3 driver answers when the output
// differs from `serial`, a version 2 driver is asked after a pause. False when
// stopped or the device is gone.
static bool NextOutput(WinPad* pad, HANDLE xusb, OVERLAPPED& overlapped, UINT32& serial, EASYCONTROL_PAD_OUTPUT& output) {
    const bool canWait = pad->driverVersion >= 3;
    if (!canWait && WaitForSingleObject(pad->stopEvent, OUTPUT_POLL_MS) == WAIT_OBJECT_0) {
        return false;
    }
    EASYCONTROL_PAD_OUTPUT_EVENT event = {};
    DWORD returned = 0;
    ResetEvent(overlapped.hEvent);
    BOOL isDone = canWait
        ? DeviceIoControl(xusb, EASYCONTROL_IOCTL_WAIT_OUTPUT, &serial, sizeof(serial), &event, sizeof(event), &returned, &overlapped)
        : DeviceIoControl(xusb, EASYCONTROL_IOCTL_GET_OUTPUT, nullptr, 0, &event.Output, sizeof(event.Output), &returned, &overlapped);
    if (!isDone && GetLastError() == ERROR_IO_PENDING) {
        HANDLE handles[2] = { pad->stopEvent, overlapped.hEvent };
        if (WaitForMultipleObjects(2, handles, FALSE, INFINITE) == WAIT_OBJECT_0) {
            CancelIoEx(xusb, &overlapped);
            GetOverlappedResult(xusb, &overlapped, &returned, TRUE);
            return false;
        }
        isDone = GetOverlappedResult(xusb, &overlapped, &returned, FALSE);
    }
    if (!isDone || returned != (canWait ? sizeof(event) : sizeof(event.Output))) {
        return false;
    }
    if (canWait) {
        serial = event.Serial;
    }
    output = event.Output;
    return true;
}

static void OutputLoop(WinPad* pad) {
    HANDLE xusb = CreateFileW(pad->xusbPath.c_str(), GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
        nullptr, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr);
    if (xusb == INVALID_HANDLE_VALUE) {
        return;
    }
    OVERLAPPED overlapped = {};
    overlapped.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    UINT32 serial = 0;
    EASYCONTROL_PAD_OUTPUT last = {};
    EASYCONTROL_PAD_OUTPUT output = {};
    while (overlapped.hEvent != NULL && NextOutput(pad, xusb, overlapped, serial, output)) {
        if (output.LeftMotor != last.LeftMotor || output.RightMotor != last.RightMotor) {
            last = output;
            pad->outputCallback(pad->outputContext, output.LeftMotor, output.RightMotor);
        }
    }
    if (overlapped.hEvent != NULL) {
        CloseHandle(overlapped.hEvent);
    }
    CloseHandle(xusb);
}

void WinPadStartOutput(WinPad* pad, WinPadOutputCallback callback, void* context) {
    WinPadStopOutput(pad);
    if (pad->stopEvent == NULL) {
        pad->stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    }
    ResetEvent(pad->stopEvent);
    pad->outputCallback = callback;
    pad->outputContext = context;
    pad->outputThread = std::thread(OutputLoop, pad);
}

void WinPadStopOutput(WinPad* pad) {
    if (pad->outputThread.joinable()) {
        SetEvent(pad->stopEvent);
        pad->outputThread.join();
    }
}
