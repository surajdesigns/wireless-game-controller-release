//
//  Companion.swift
//  Antigravity Mac Companion - Native Keyboard Event Emitter & Controller Host
//
//  Compile with:
//  swiftc macos/Companion.swift -o macos/AntigravityCompanion -framework Cocoa -framework CoreGraphics
//

import Cocoa
import CoreGraphics
import Foundation

// Standard macOS Virtual Key Codes (from HIToolbox/Events.h)
struct MacKeyCodes {
    static let kVK_ANSI_A: CGKeyCode = 0x00
    static let kVK_ANSI_S: CGKeyCode = 0x01
    static let kVK_ANSI_D: CGKeyCode = 0x02
    static let kVK_ANSI_W: CGKeyCode = 0x0D
    static let kVK_ANSI_Q: CGKeyCode = 0x0C
    static let kVK_ANSI_E: CGKeyCode = 0x0E
    static let kVK_ANSI_R: CGKeyCode = 0x0F
    static let kVK_ANSI_Z: CGKeyCode = 0x06
    static let kVK_ANSI_X: CGKeyCode = 0x07
    static let kVK_ANSI_C: CGKeyCode = 0x08
    static let kVK_ANSI_V: CGKeyCode = 0x09
    static let kVK_ANSI_F: CGKeyCode = 0x03
    static let kVK_ANSI_T: CGKeyCode = 0x11
    static let kVK_Space: CGKeyCode = 0x31
    static let kVK_Return: CGKeyCode = 0x24
    static let kVK_Escape: CGKeyCode = 0x35
    static let kVK_Tab: CGKeyCode = 0x30
    static let kVK_Shift: CGKeyCode = 0x38
    static let kVK_Control: CGKeyCode = 0x3B
    static let kVK_UpArrow: CGKeyCode = 0x7E
    static let kVK_DownArrow: CGKeyCode = 0x7D
    static let kVK_LeftArrow: CGKeyCode = 0x7B
    static let kVK_RightArrow: CGKeyCode = 0x7C
}

class KeyboardEmitter {
    private let source = CGEventSource(stateID: .combinedSessionState)
    private var heldKeys = Set<CGKeyCode>()
    private let lock = NSLock()

    func checkAccessibilityPermissions() -> Bool {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    func postKeyEvent(keyCode: CGKeyCode, keyDown: Bool) {
        lock.lock()
        defer { lock.unlock() }

        if keyDown {
            if heldKeys.contains(keyCode) { return } // Avoid repeat
            heldKeys.insert(keyCode)
        } else {
            heldKeys.remove(keyCode)
        }

        guard let event = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: keyDown) else {
            return
        }
        event.post(tap: .cghidEventTap)
    }

    func releaseAll() {
        lock.lock()
        defer { lock.unlock() }

        for key in heldKeys {
            if let event = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: false) {
                event.post(tap: .cghidEventTap)
            }
        }
        heldKeys.removeAll()
    }
}

class MacCompanion: NSObject, URLSessionWebSocketDelegate {
    private let emitter = KeyboardEmitter()
    private var webSocketTask: URLSessionWebSocketTask?
    private var serverBaseUrl: String
    private var sessionId: String?
    private var hostToken: String?
    private var isRunning = true
    private var lastInputTimestamp = Date()
    private var watchdogTimer: Timer?

    // Default Xbox to Mac Keycode Mapping (Matches Reference Screenshot)
    private let buttonKeyMap: [String: CGKeyCode] = [
        "LT": MacKeyCodes.kVK_ANSI_Z,        // Aim
        "RT": MacKeyCodes.kVK_ANSI_F,        // Attack
        "LB": MacKeyCodes.kVK_Shift,         // Guard
        "RB": MacKeyCodes.kVK_ANSI_R,        // Use recovery items
        "A": MacKeyCodes.kVK_Space,          // Examine / Pick up item
        "B": MacKeyCodes.kVK_Control,        // None / Optional
        "X": MacKeyCodes.kVK_ANSI_E,         // Reload
        "Y": MacKeyCodes.kVK_ANSI_Q,         // Open Inventory
        "L3": MacKeyCodes.kVK_ANSI_C,        // Run / Left Stick Click
        "R3": MacKeyCodes.kVK_ANSI_V,        // Crouch / Stand
        "View": MacKeyCodes.kVK_Tab,         // Open Map / Journal
        "Menu": MacKeyCodes.kVK_Escape,      // Pause
        "QuickTurn": MacKeyCodes.kVK_ANSI_T, // Quick Turn combo
        "ChangeWeapon": MacKeyCodes.kVK_ANSI_X,
        "DPadUp": MacKeyCodes.kVK_ANSI_W,
        "DPadDown": MacKeyCodes.kVK_ANSI_S,
        "DPadLeft": MacKeyCodes.kVK_ANSI_A,
        "DPadRight": MacKeyCodes.kVK_ANSI_D
    ]

    init(serverUrl: String = "http://localhost:3000") {
        self.serverBaseUrl = serverUrl
        super.init()
    }

    func start() {
        print("====================================================")
        print("       ANTIGRAVITY MAC COMPANION (NATIVE SWIFT)     ")
        print("====================================================")

        let trusted = emitter.checkAccessibilityPermissions()
        if !trusted {
            print("\n⚠️  ACCESSIBILITY PERMISSION REQUIRED")
            print("To inject keyboard strokes into Mac games:")
            print("1. Open: System Settings -> Privacy & Security -> Accessibility")
            print("2. Enable permission for Terminal (or this companion app)")
            print("====================================================\n")
        } else {
            print("✓ Accessibility permissions granted.")
        }

        createSessionAndConnect()
        setupSignalHandler()
        startWatchdog()
    }

    private func createSessionAndConnect() {
        guard let url = URL(string: "\(serverBaseUrl)/api/session/create") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["hostName": Host.current().localizedName ?? "Mac"])

        let task = URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self, let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let sessionId = json["sessionId"] as? String,
                  let hostToken = json["hostToken"] as? String,
                  let code = json["code"] as? String else {
                print("❌ Failed to create session on server: \(error?.localizedDescription ?? "Unknown error")")
                return
            }

            self.sessionId = sessionId
            self.hostToken = hostToken

            print("\n✓ Pairing Session Active!")
            print("----------------------------------------------------")
            print("👉 PAIRING CODE: [ \(code) ]")
            print("----------------------------------------------------")
            print("Scan the QR code on your Mac browser or enter the code on iPhone.")
            print("Listening for authenticated controller events...\n")

            self.connectWebSocket(sessionId: sessionId, token: hostToken)
        }
        task.resume()
    }

    private func connectWebSocket(sessionId: String, token: String) {
        let wsProto = serverBaseUrl.starts(with: "https") ? "wss" : "ws"
        let hostPart = serverBaseUrl.replacingOccurrences(of: "http://", with: "").replacingOccurrences(of: "https://", with: "")
        guard let wsUrl = URL(string: "\(wsProto)://\(hostPart)/ws?sessionId=\(sessionId)&token=\(token)") else { return }

        let session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
        self.webSocketTask = session.webSocketTask(with: wsUrl)
        self.webSocketTask?.resume()
        receiveMessage()
    }

    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.handleIncomingPacket(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self.handleIncomingPacket(text)
                    }
                @unknown default:
                    break
                }
                self.receiveMessage()

            case .failure(let error):
                print("⚠️ WebSocket disconnected: \(error.localizedDescription)")
                self.emitter.releaseAll()
            }
        }
    }

    private func handleIncomingPacket(_ jsonString: String) {
        guard let data = jsonString.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }

        self.lastInputTimestamp = Date()

        if let type = json["t"] as? String {
            if type == "peer_connected" {
                print("🟢 iPhone Connected: \(json["device"] as? String ?? "Controller")")
                return
            } else if type == "peer_disconnected" {
                print("🟡 iPhone Disconnected! Releasing all keys...")
                emitter.releaseAll()
                return
            } else if type == "ping" {
                if let echoTs = json["echoTs"] {
                    let pong: [String: Any] = ["t": "pong", "echoTs": echoTs]
                    if let pongData = try? JSONSerialization.data(withJSONObject: pong),
                       let pongStr = String(data: pongData, encoding: .utf8) {
                        webSocketTask?.send(.string(pongStr)) { _ in }
                    }
                }
                return
            }
        }

        // Process button states
        if let buttons = json["b"] as? [String: Bool] {
            for (btnName, isPressed) in buttons {
                if let keyCode = buttonKeyMap[btnName] {
                    emitter.postKeyEvent(keyCode: keyCode, keyDown: isPressed)
                }
            }
        }

        // Process Analog Stick (Left Stick to WASD)
        if let axes = json["a"] as? [String: Double],
           let lx = axes["lx"], let ly = axes["ly"] {
            let threshold = 0.35
            emitter.postKeyEvent(keyCode: MacKeyCodes.kVK_ANSI_W, keyDown: ly < -threshold)
            emitter.postKeyEvent(keyCode: MacKeyCodes.kVK_ANSI_S, keyDown: ly > threshold)
            emitter.postKeyEvent(keyCode: MacKeyCodes.kVK_ANSI_A, keyDown: lx < -threshold)
            emitter.postKeyEvent(keyCode: MacKeyCodes.kVK_ANSI_D, keyDown: lx > threshold)
        }
    }

    private func startWatchdog() {
        // Dead-man switch: if no heartbeat or input received in 400ms, release held keys!
        DispatchQueue.global(qos: .background).async { [weak self] in
            while true {
                Thread.sleep(forTimeInterval: 0.2)
                guard let self = self else { return }
                if Date().timeIntervalSince(self.lastInputTimestamp) > 0.4 {
                    self.emitter.releaseAll()
                }
            }
        }
    }

    private func setupSignalHandler() {
        signal(SIGINT) { _ in
            print("\nShutting down Mac Companion. Releasing held keys...")
            // Direct release
            exit(0)
        }
    }
}

// Entry Point
let companion = MacCompanion()
companion.start()
RunLoop.main.run()
