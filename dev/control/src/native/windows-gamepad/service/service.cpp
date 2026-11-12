// easy-control virtual gamepad: broker service
//
// Making a software device (SwDeviceCreate) needs administrator rights, which
// the process that wants a gamepad usually does not have. This service, run
// as LocalSystem, plugs pads in for it: each connection to its pipe is one
// pad, made of the two devices described in common/easycontrol_pad.h, and
// unplugged when the connection closes - also when the client crashes.
//
// It is started on demand by the addon and stops itself when idle.
//
//     easy-control-gamepad-service.exe            run as the service
//     easy-control-gamepad-service.exe --console  run in a console, for debugging

#include <windows.h>
#include <objbase.h>
#include <sddl.h>
#include <swdevice.h>

#include <cstdio>
#include <cwchar>
#include <mutex>

#include "../common/easycontrol_pad.h"

static const DWORD IDLE_STOP_MS = 60 * 1000;
static const DWORD CREATE_TIMEOUT_MS = 15 * 1000;

static SERVICE_STATUS_HANDLE statusHandle = NULL;
static HANDLE stopEvent = NULL;
static bool isConsole = false;

// pads in use, by slot; a slot names the pad's devices, so the same few
// device instances are reused instead of a new one being left in the
// registry for every pad ever made
static std::mutex slotsMutex;
static bool slots[EASYCONTROL_MAX_PADS] = {};
static LONG connectionCount = 0;
static ULONGLONG lastActive = 0;


// %ProgramData%\easy-control\gamepad-service.log, at most LOG_MAX_BYTES:
// when bigger, it becomes gamepad-service.log.old and a new one starts
static const LONGLONG LOG_MAX_BYTES = 256 * 1024;
static std::mutex logMutex;

static void AppendToLogFile(const wchar_t* line)
{
    wchar_t folder[MAX_PATH];
    if (GetEnvironmentVariableW(L"ProgramData", folder, MAX_PATH) == 0) {
        return;
    }
    const std::wstring path = std::wstring(folder) + L"\\easy-control\\gamepad-service.log";

    std::lock_guard<std::mutex> lock(logMutex);
    WIN32_FILE_ATTRIBUTE_DATA attributes;
    if (GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &attributes) &&
            (((LONGLONG)attributes.nFileSizeHigh << 32) | attributes.nFileSizeLow) > LOG_MAX_BYTES) {
        MoveFileExW(path.c_str(), (path + L".old").c_str(), MOVEFILE_REPLACE_EXISTING);
    }
    HANDLE file = CreateFileW(path.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ, NULL, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) {
        return;
    }
    SYSTEMTIME now;
    GetLocalTime(&now);
    wchar_t stamped[600];
    swprintf_s(stamped, L"%04u-%02u-%02u %02u:%02u:%02u  %s\r\n",
        now.wYear, now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond, line);
    char utf8[1800];
    const int length = WideCharToMultiByte(CP_UTF8, 0, stamped, -1, utf8, sizeof(utf8), NULL, NULL);
    if (length > 1) {
        DWORD written = 0;
        WriteFile(file, utf8, (DWORD)(length - 1), &written, NULL);
    }
    CloseHandle(file);
}

// to the log file and the debugger, and the console when run in one
static void Log(const wchar_t* format, ...)
{
    wchar_t line[512];
    va_list args;
    va_start(args, format);
    _vsnwprintf_s(line, _TRUNCATE, format, args);
    va_end(args);
    if (isConsole) {
        fwprintf(stderr, L"%s\n", line);
    }
    OutputDebugStringW(line);
    OutputDebugStringW(L"\n");
    AppendToLogFile(line);
}


//
// software devices
//

struct CreateContext {
    HANDLE done;
    HRESULT result;
    wchar_t instanceId[200];
};

static VOID WINAPI OnDeviceCreated(HSWDEVICE device, HRESULT result, PVOID contextPointer, PCWSTR instanceId)
{
    UNREFERENCED_PARAMETER(device);
    CreateContext* context = static_cast<CreateContext*>(contextPointer);
    context->result = result;
    if (instanceId != NULL) {
        wcsncpy_s(context->instanceId, instanceId, _TRUNCATE);
    }
    SetEvent(context->done);
}

// plugs in one software device and waits until PnP has enumerated it
static HRESULT CreateDevice(PCWSTR enumerator, PCWSTR instanceId, PCWSTR hardwareIds, PCWSTR description,
    const GUID& containerId, HSWDEVICE* device, wchar_t (&deviceInstanceId)[200])
{
    CreateContext context = {};
    context.done = CreateEventW(NULL, TRUE, FALSE, NULL);
    if (context.done == NULL) {
        return HRESULT_FROM_WIN32(GetLastError());
    }

    SW_DEVICE_CREATE_INFO info = {};
    info.cbSize = sizeof(info);
    info.pszInstanceId = instanceId;
    info.pszzHardwareIds = hardwareIds;
    info.pContainerId = &containerId;
    info.CapabilityFlags = SWDeviceCapabilitiesRemovable | SWDeviceCapabilitiesSilentInstall | SWDeviceCapabilitiesDriverRequired;
    info.pszDeviceDescription = description;

    HRESULT hr = SwDeviceCreate(enumerator, L"HTREE\\ROOT\\0", &info, 0, NULL, OnDeviceCreated, &context, device);
    if (SUCCEEDED(hr)) {
        if (WaitForSingleObject(context.done, CREATE_TIMEOUT_MS) != WAIT_OBJECT_0) {
            hr = HRESULT_FROM_WIN32(WAIT_TIMEOUT);
        } else {
            hr = context.result;
        }
        if (FAILED(hr)) {
            SwDeviceClose(*device);
            *device = NULL;
        } else {
            wcsncpy_s(deviceInstanceId, context.instanceId, _TRUNCATE);
        }
    }
    CloseHandle(context.done);
    return hr;
}

// whether this Windows has Microsoft's xinputhid filter driver (Windows
// Server editions do not)
static bool HasXinputHid()
{
    wchar_t path[MAX_PATH];
    if (GetSystemDirectoryW(path, MAX_PATH) == 0) {
        return false;
    }
    wcscat_s(path, L"\\drivers\\xinputhid.sys");
    return GetFileAttributesW(path) != INVALID_FILE_ATTRIBUTES;
}

struct Pad {
    int slot = -1;
    HSWDEVICE xusb = NULL;
    HSWDEVICE hid = NULL;
};

static void DestroyPad(Pad& pad)
{
    if (pad.hid != NULL) {
        SwDeviceClose(pad.hid);
        pad.hid = NULL;
    }
    if (pad.xusb != NULL) {
        SwDeviceClose(pad.xusb);
        pad.xusb = NULL;
    }
    if (pad.slot >= 0) {
        std::lock_guard<std::mutex> lock(slotsMutex);
        slots[pad.slot] = false;
        lastActive = GetTickCount64();
        Log(L"pad %d unplugged", pad.slot);
        pad.slot = -1;
    }
}

static HRESULT CreatePad(Pad& pad, EASYCONTROL_PIPE_RESPONSE& response)
{
    {
        std::lock_guard<std::mutex> lock(slotsMutex);
        for (int i = 0; i < EASYCONTROL_MAX_PADS; i++) {
            if (!slots[i]) {
                slots[i] = true;
                pad.slot = i;
                break;
            }
        }
    }
    if (pad.slot < 0) {
        return EASYCONTROL_E_NO_SLOT;
    }

    // the two devices of one pad are one container, so Windows shows and
    // counts them as one controller
    GUID containerId;
    HRESULT hr = CoCreateGuid(&containerId);
    if (FAILED(hr)) {
        DestroyPad(pad);
        return hr;
    }
    wchar_t instanceId[32];
    swprintf_s(instanceId, L"Pad%d", pad.slot);

    // Windows.Gaming.Input takes the XUSB device for an Xbox pad with
    // Microsoft's xinputhid filter on it; where Windows has no such filter
    // (Windows Server), the device goes without it - XInput still reads it
    const PCWSTR xusbHardwareIds = HasXinputHid()
        ? EASYCONTROL_XUSB_HARDWARE_ID L"\0"
        : EASYCONTROL_XUSB_PLAIN_HARDWARE_ID L"\0";

    // a device being removed may still hold the instance name for a moment
    for (int attempt = 0; attempt < 10; attempt++) {
        hr = CreateDevice(EASYCONTROL_XUSB_ENUMERATOR, instanceId, xusbHardwareIds,
            L"easy-control Virtual Gamepad (XInput)", containerId, &pad.xusb, response.XusbInstanceId);
        if (SUCCEEDED(hr)) {
            hr = CreateDevice(EASYCONTROL_HID_ENUMERATOR, instanceId, EASYCONTROL_HID_HARDWARE_ID L"\0",
                L"easy-control Virtual Gamepad", containerId, &pad.hid, response.HidInstanceId);
        }
        if (SUCCEEDED(hr) || hr == HRESULT_FROM_WIN32(WAIT_TIMEOUT)) {
            break;
        }
        if (pad.xusb != NULL) {
            SwDeviceClose(pad.xusb);
            pad.xusb = NULL;
        }
        Sleep(200);
    }
    if (FAILED(hr)) {
        Log(L"pad %d: creating its devices failed, 0x%08X", pad.slot, (unsigned)hr);
        DestroyPad(pad);
        return hr;
    }
    Log(L"pad %d plugged in: %s, %s", pad.slot, response.XusbInstanceId, response.HidInstanceId);
    return S_OK;
}


//
// pipe
//

static DWORD WINAPI ConnectionThread(LPVOID parameter)
{
    HANDLE pipe = static_cast<HANDLE>(parameter);
    CoInitializeEx(NULL, COINIT_MULTITHREADED);
    Pad pad;

    for (;;) {
        EASYCONTROL_PIPE_REQUEST request = {};
        DWORD read = 0;
        if (!ReadFile(pipe, &request, sizeof(request), &read, NULL) || read != sizeof(request) ||
                request.Magic != EASYCONTROL_PIPE_MAGIC) {
            break;      // closed, crashed, or not our client
        }
        EASYCONTROL_PIPE_RESPONSE response = {};
        response.Magic = EASYCONTROL_PIPE_MAGIC;
        response.Version = EASYCONTROL_PAD_VERSION;
        if (request.Command == EASYCONTROL_PIPE_VERSION) {
            response.Result = S_OK;
        } else if (request.Command == EASYCONTROL_PIPE_CREATE) {
            // one pad per connection
            response.Result = pad.slot >= 0 ? HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS) : CreatePad(pad, response);
        } else {
            response.Result = E_INVALIDARG;
        }
        DWORD written = 0;
        if (!WriteFile(pipe, &response, sizeof(response), &written, NULL)) {
            break;
        }
    }

    DestroyPad(pad);
    DisconnectNamedPipe(pipe);
    CloseHandle(pipe);
    CoUninitialize();
    {
        std::lock_guard<std::mutex> lock(slotsMutex);
        connectionCount--;
        lastActive = GetTickCount64();
    }
    return 0;
}

// the pipe's access: system, administrators, and the signed-in users
static bool MakePipeSecurity(SECURITY_ATTRIBUTES& attributes)
{
    attributes.nLength = sizeof(attributes);
    attributes.bInheritHandle = FALSE;
    return ConvertStringSecurityDescriptorToSecurityDescriptorW(L"D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;IU)",
        SDDL_REVISION_1, &attributes.lpSecurityDescriptor, NULL) != FALSE;
}

// serves the pipe until stopEvent is set or the service has been idle
static void RunPipeServer()
{
    SECURITY_ATTRIBUTES security;
    if (!MakePipeSecurity(security)) {
        Log(L"pipe security descriptor failed: %lu", GetLastError());
        return;
    }
    HANDLE connected = CreateEventW(NULL, TRUE, FALSE, NULL);
    lastActive = GetTickCount64();
    bool isFirst = true;

    for (;;) {
        // FILE_FLAG_FIRST_PIPE_INSTANCE: fail if another process already
        // made a pipe of this name to pose as the service
        HANDLE pipe = CreateNamedPipeW(EASYCONTROL_PIPE_NAME,
            PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | (isFirst ? FILE_FLAG_FIRST_PIPE_INSTANCE : 0),
            PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            PIPE_UNLIMITED_INSTANCES, sizeof(EASYCONTROL_PIPE_RESPONSE), sizeof(EASYCONTROL_PIPE_REQUEST), 0, &security);
        if (pipe == INVALID_HANDLE_VALUE) {
            Log(L"CreateNamedPipe failed: %lu", GetLastError());
            break;
        }
        isFirst = false;

        OVERLAPPED overlapped = {};
        overlapped.hEvent = connected;
        ResetEvent(connected);
        bool isConnected = ConnectNamedPipe(pipe, &overlapped) != FALSE || GetLastError() == ERROR_PIPE_CONNECTED;
        while (!isConnected) {
            if (GetLastError() != ERROR_IO_PENDING) {
                break;
            }
            HANDLE events[2] = { stopEvent, connected };
            DWORD wait = WaitForMultipleObjects(2, events, FALSE, 5000);
            if (wait == WAIT_OBJECT_0) {
                break;
            }
            if (wait == WAIT_OBJECT_0 + 1) {
                DWORD transferred;
                isConnected = GetOverlappedResult(pipe, &overlapped, &transferred, FALSE) != FALSE;
                break;
            }
            // idle: no client for a while, nothing plugged in
            std::lock_guard<std::mutex> lock(slotsMutex);
            if (!isConsole && connectionCount == 0 && GetTickCount64() - lastActive > IDLE_STOP_MS) {
                Log(L"idle, stopping");
                SetEvent(stopEvent);
            }
            SetLastError(ERROR_IO_PENDING);
        }
        if (!isConnected) {
            CancelIo(pipe);
            CloseHandle(pipe);
            if (WaitForSingleObject(stopEvent, 0) == WAIT_OBJECT_0) {
                break;
            }
            continue;
        }

        {
            std::lock_guard<std::mutex> lock(slotsMutex);
            connectionCount++;
        }
        HANDLE thread = CreateThread(NULL, 0, ConnectionThread, pipe, 0, NULL);
        if (thread == NULL) {
            std::lock_guard<std::mutex> lock(slotsMutex);
            connectionCount--;
            CloseHandle(pipe);
        } else {
            CloseHandle(thread);
        }
    }
    CloseHandle(connected);
    LocalFree(security.lpSecurityDescriptor);
}


//
// service plumbing
//

static void ReportStatus(DWORD state, DWORD exitCode = NO_ERROR)
{
    if (statusHandle == NULL) {
        return;
    }
    SERVICE_STATUS status = {};
    status.dwServiceType = SERVICE_WIN32_OWN_PROCESS;
    status.dwCurrentState = state;
    status.dwControlsAccepted = state == SERVICE_RUNNING ? SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN : 0;
    status.dwWin32ExitCode = exitCode;
    status.dwWaitHint = state == SERVICE_RUNNING || state == SERVICE_STOPPED ? 0 : 5000;
    SetServiceStatus(statusHandle, &status);
}

static DWORD WINAPI ControlHandler(DWORD control, DWORD eventType, LPVOID eventData, LPVOID context)
{
    UNREFERENCED_PARAMETER(eventType);
    UNREFERENCED_PARAMETER(eventData);
    UNREFERENCED_PARAMETER(context);
    if (control == SERVICE_CONTROL_STOP || control == SERVICE_CONTROL_SHUTDOWN) {
        ReportStatus(SERVICE_STOP_PENDING);
        SetEvent(stopEvent);
        return NO_ERROR;
    }
    return control == SERVICE_CONTROL_INTERROGATE ? NO_ERROR : ERROR_CALL_NOT_IMPLEMENTED;
}

static VOID WINAPI ServiceMain(DWORD argc, LPWSTR* argv)
{
    UNREFERENCED_PARAMETER(argc);
    UNREFERENCED_PARAMETER(argv);
    statusHandle = RegisterServiceCtrlHandlerExW(EASYCONTROL_SERVICE_NAME, ControlHandler, NULL);
    if (statusHandle == NULL) {
        return;
    }
    ReportStatus(SERVICE_RUNNING);
    Log(L"started, version %d%s", EASYCONTROL_PAD_VERSION,
        HasXinputHid() ? L"" : L"; no xinputhid.sys here: XInput only, not Windows.Gaming.Input");
    RunPipeServer();
    // pads still plugged in go when the process ends, as their handles close
    ReportStatus(SERVICE_STOPPED);
}

int wmain(int argc, wchar_t** argv)
{
    stopEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
    if (argc > 1 && wcscmp(argv[1], L"--console") == 0) {
        isConsole = true;
        Log(L"serving %s, Ctrl+C to stop", EASYCONTROL_PIPE_NAME);
        RunPipeServer();
        return 0;
    }
    SERVICE_TABLE_ENTRYW table[] = {
        { const_cast<LPWSTR>(EASYCONTROL_SERVICE_NAME), ServiceMain },
        { NULL, NULL }
    };
    return StartServiceCtrlDispatcherW(table) ? 0 : (int)GetLastError();
}
