import Foundation
import CoreHID

@objc
public class SwiftCode: NSObject {
    private static var gamepads: [Int: VirtualGamepadDevice] = [:]
    private static var nextId: Int = 1
    private static let lock = NSLock()
    
    @objc public static func createGamepad() -> Int {
        lock.lock()
        defer { lock.unlock() }
        
        let gamepadId = nextId
        nextId += 1
        
        let device = VirtualGamepadDevice()
        
        // Check if device creation was initiated successfully
        if !device.isInitialized() {
            return -1
        }
        
        gamepads[gamepadId] = device
        
        return gamepadId
    }
    
    @objc public static func destroyGamepad(_ gamepadId: Int) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        
        guard let device = gamepads[gamepadId] else {
            return false
        }
        
        device.destroy()
        gamepads.removeValue(forKey: gamepadId)
        return true
    }
    
    @objc public static func buttonDown(_ gamepadId: Int, button buttonId: Int) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        
        guard let device = gamepads[gamepadId] else {
            return false
        }
        
        return device.buttonDown(buttonIndex: buttonId)
    }
    
    @objc public static func buttonUp(_ gamepadId: Int, button buttonId: Int) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        
        guard let device = gamepads[gamepadId] else {
            return false
        }
        
        return device.buttonUp(buttonIndex: buttonId)
    }
    
    @objc public static func setAxis(_ gamepadId: Int, axis axisId: Int, value: Int) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        
        guard let device = gamepads[gamepadId] else {
            return false
        }
        
        return device.setAxis(axisIndex: axisId, value: Int16(value))
    }
}

// C-compatible structure for gamepad state
public struct GamepadState {
    var buttons: UInt16
    var thumbLX: Int16
    var thumbLY: Int16
    var thumbRX: Int16
    var thumbRY: Int16
    var leftTrigger: UInt8
    var rightTrigger: UInt8
    var _padding: UInt8  // Alignment padding
}

// Delegate to handle HID virtual device callbacks
final class GamepadDelegate: HIDVirtualDeviceDelegate {
    func hidVirtualDevice(_ device: HIDVirtualDevice, receivedSetReportRequestOfType type: HIDReportType, id: HIDReportID?, data: Data) throws {
        // Handle set report requests if needed
    }
    
    func hidVirtualDevice(_ device: HIDVirtualDevice, receivedGetReportRequestOfType type: HIDReportType, id: HIDReportID?, maxSize: size_t) throws -> Data {
        // Return empty data for get report requests
        return Data()
    }
}

// Swift class wrapping HIDVirtualDevice
@objc public class VirtualGamepadDevice: NSObject {
    private var device: HIDVirtualDevice?
    private var currentState: GamepadState
    private var delegate: GamepadDelegate?
    private var activationTask: Task<Void, Never>?
    private var initialized: Bool = false
    
    // Xbox 360 Controller HID Report Descriptor
    private static let reportDescriptor: [UInt8] = [
        0x05, 0x01,        // Usage Page (Generic Desktop)
        0x09, 0x05,        // Usage (Game Pad)
        0xA1, 0x01,        // Collection (Application)
        0x05, 0x09,        //   Usage Page (Button)
        0x19, 0x01,        //   Usage Minimum (Button 1)
        0x29, 0x10,        //   Usage Maximum (Button 16)
        0x15, 0x00,        //   Logical Minimum (0)
        0x25, 0x01,        //   Logical Maximum (1)
        0x75, 0x01,        //   Report Size (1)
        0x95, 0x10,        //   Report Count (16)
        0x81, 0x02,        //   Input (Data, Variable, Absolute)
        0x05, 0x01,        //   Usage Page (Generic Desktop)
        0x09, 0x30,        //   Usage (X)
        0x09, 0x31,        //   Usage (Y)
        0x09, 0x32,        //   Usage (Z)
        0x09, 0x33,        //   Usage (Rx)
        0x16, 0x00, 0x80,  //   Logical Minimum (-32768)
        0x26, 0xFF, 0x7F,  //   Logical Maximum (32767)
        0x75, 0x10,        //   Report Size (16)
        0x95, 0x04,        //   Report Count (4)
        0x81, 0x02,        //   Input (Data, Variable, Absolute)
        0x05, 0x01,        //   Usage Page (Generic Desktop)
        0x09, 0x34,        //   Usage (Ry)
        0x09, 0x35,        //   Usage (Rz)
        0x15, 0x00,        //   Logical Minimum (0)
        0x26, 0xFF, 0x00,  //   Logical Maximum (255)
        0x75, 0x08,        //   Report Size (8)
        0x95, 0x02,        //   Report Count (2)
        0x81, 0x02,        //   Input (Data, Variable, Absolute)
        0xC0               // End Collection
    ]
    
    public override init() {
        self.currentState = GamepadState(
            buttons: 0,
            thumbLX: 0,
            thumbLY: 0,
            thumbRX: 0,
            thumbRY: 0,
            leftTrigger: 0,
            rightTrigger: 0,
            _padding: 0
        )
        super.init()
        
        // Check if macOS version is supported and create device
        if #available(macOS 26.0, *) {
            let properties = HIDVirtualDevice.Properties(
                descriptor: Data(Self.reportDescriptor),
                vendorID: 0x045e,  // Microsoft
                productID: 0x028e,  // Xbox 360 Controller
                transport: .usb,
                product: "Virtual Xbox 360 Controller",
                manufacturer: "Microsoft",
                serialNumber: "EasyControl001"
            )
            
            guard let hidDevice = HIDVirtualDevice(properties: properties) else {
                print("Failed to create HIDVirtualDevice")
                self.initialized = false
                return
            }
            
            self.device = hidDevice
            self.delegate = GamepadDelegate()
            self.initialized = true
            
            // Activate asynchronously after successful creation
            activationTask = Task {
                await self.activate()
            }
        } else {
            print("HIDVirtualDevice requires macOS 26.0 or later")
            self.initialized = false
        }
    }
    
    @objc public func isInitialized() -> Bool {
        return initialized
    }
    
    private func activate() async {
        guard #available(macOS 13.0, *), let device = device, let delegate = delegate else {
            print("ERROR: activate() - Prerequisites not met")
            self.initialized = false
            return
        }
        
        do {
            try await device.activate(delegate: delegate)
            print("Virtual gamepad activated successfully")
        } catch {
            print("ERROR: Failed to activate HIDVirtualDevice: \(error)")
            print("ERROR: Error details - \(error.localizedDescription)")
            self.initialized = false
        }
    }
    
    @objc public func destroy() {
        if #available(macOS 26.0, *) {
            activationTask?.cancel()
            activationTask = nil
            device = nil
            delegate = nil
        }
        initialized = false
    }
    
    @objc public func buttonDown(buttonIndex: Int) -> Bool {
        guard buttonIndex >= 0 && buttonIndex < 16 else {
            return false
        }
        let mask: UInt16 = 1 << buttonIndex
        currentState.buttons |= mask
        return sendReport()
    }
    
    @objc public func buttonUp(buttonIndex: Int) -> Bool {
        guard buttonIndex >= 0 && buttonIndex < 16 else {
            return false
        }
        let mask: UInt16 = 1 << buttonIndex
        currentState.buttons &= ~mask
        return sendReport()
    }
    
    @objc public func setAxis(axisIndex: Int, value: Int16) -> Bool {
        switch axisIndex {
        case 0:
            currentState.thumbLX = value
        case 1:
            currentState.thumbLY = value
        case 2:
            currentState.thumbRX = value
        case 3:
            currentState.thumbRY = value
        case 4:
            currentState.leftTrigger = UInt8(max(0, min(255, (Int(value) + 32768) / 256)))
        case 5:
            currentState.rightTrigger = UInt8(max(0, min(255, (Int(value) + 32768) / 256)))
        default:
            return false
        }
        return sendReport()
    }
    
    private func sendReport() -> Bool {
        guard #available(macOS 26.0, *), let device = device else {
            return false
        }
        
        // Build HID report: 2 bytes buttons + 8 bytes axes + 2 bytes triggers
        var report = Data(capacity: 12)
        
        // Buttons (16 bits)
        withUnsafeBytes(of: currentState.buttons.littleEndian) { report.append(contentsOf: $0) }
        
        // Thumb sticks (4 x 16-bit signed)
        withUnsafeBytes(of: currentState.thumbLX.littleEndian) { report.append(contentsOf: $0) }
        withUnsafeBytes(of: currentState.thumbLY.littleEndian) { report.append(contentsOf: $0) }
        withUnsafeBytes(of: currentState.thumbRX.littleEndian) { report.append(contentsOf: $0) }
        withUnsafeBytes(of: currentState.thumbRY.littleEndian) { report.append(contentsOf: $0) }
        
        // Triggers (2 x 8-bit unsigned)
        report.append(currentState.leftTrigger)
        report.append(currentState.rightTrigger)
        
        // Dispatch input report asynchronously
        Task {
            do {
                try await device.dispatchInputReport(data: report, timestamp: SuspendingClock.now)
            } catch {
                print("Failed to send HID report: \(error)")
            }
        }
        
        return true
    }
}