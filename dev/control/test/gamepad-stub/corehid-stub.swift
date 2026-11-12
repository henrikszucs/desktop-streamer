// A stand-in for CoreHID, so the macOS gamepad can be tested with no entitlement:
// no machine here or in CI can make a real virtual device. run.js puts this
// in place of `import CoreHID` in a copy of GamepadImplement.swift.
//
// It has the SDK's names and shapes (CoreHID.swiftinterface, macOS 27.2 SDK):
// HIDVirtualDevice is an actor, and activate(delegate:) neither throws nor returns
// anything. What it cannot catch is Apple's real device behaving otherwise.
//
// It records to the file in EC_STUB_LOG, a line for each thing done, and
// EC_STUB_MODE, read as a device is made, chooses a failure:
//     nil              no device, as without the entitlement
//     hang             the activation does not finish in time
//     report-fails:N   the first N reports of the device fail

@available(macOS 15, *)
private enum StubLog {
    static func line(_ text: String) {
        guard let path = ProcessInfo.processInfo.environment["EC_STUB_LOG"], !path.isEmpty else {
            return
        }
        let file = open(path, O_WRONLY | O_APPEND | O_CREAT, 0o644)
        if file >= 0 {
            let bytes = Array((text + "\n").utf8)
            _ = bytes.withUnsafeBytes { write(file, $0.baseAddress, $0.count) }
            close(file)
        }
    }

    static func hex(_ data: Data) -> String {
        return data.map { String(format: "%02x", $0) }.joined()
    }
}

enum HIDReportType { case input, output, feature }
typealias HIDReportID = UInt8
enum HIDDeviceTransport { case usb }

private struct StubReportError: Error {}

@available(macOS 15, *)
protocol HIDVirtualDeviceDelegate: Sendable {
    func hidVirtualDevice(_ device: HIDVirtualDevice, receivedSetReportRequestOfType type: HIDReportType, id: HIDReportID?, data: Data) async throws
    func hidVirtualDevice(_ device: HIDVirtualDevice, receivedGetReportRequestOfType type: HIDReportType, id: HIDReportID?, maxSize: Int) async throws -> Data
}

@available(macOS 15, *)
actor HIDVirtualDevice {
    struct Properties: Sendable {
        let descriptor: Data
        let vendorID: UInt32
        let productID: UInt32?
        let transport: HIDDeviceTransport?
        let product: String?
        let manufacturer: String?
        let serialNumber: String?
    }

    private let serial: String
    private let isHanging: Bool
    private var reportsToFail: Int

    init?(properties: Properties) {
        let mode = ProcessInfo.processInfo.environment["EC_STUB_MODE"] ?? ""
        if mode == "nil" {
            return nil
        }
        serial = properties.serialNumber ?? ""
        isHanging = mode == "hang"
        reportsToFail = mode.hasPrefix("report-fails:") ? Int(mode.dropFirst("report-fails:".count)) ?? 0 : 0
        StubLog.line("new \(serial) \(StubLog.hex(properties.descriptor)) \(String(properties.vendorID, radix: 16)) \(String(properties.productID ?? 0, radix: 16))")
    }

    deinit {
        StubLog.line("gone \(serial)")
    }

    func activate(delegate: any HIDVirtualDeviceDelegate) {
        if isHanging {
            // past the 5 s create() waits; nothing to wake it, as the real one is not async
            sleep(7)
        }
        StubLog.line("active \(serial)")
    }

    func dispatchInputReport(data: Data, timestamp: SuspendingClock.Instant) async throws {
        if reportsToFail > 0 {
            reportsToFail -= 1
            StubLog.line("report-failed \(serial)")
            throw StubReportError()
        }
        StubLog.line("report \(serial) \(StubLog.hex(data))")
    }
}
