# iPhone-to-Mac Wireless Game Controller: Architecture & Network Strategy

## 1. Executive Summary & Recommended Architecture

Connecting an iPhone to a Mac across different networks (e.g., iPhone on 5G/LTE cellular while Mac is on home/office Wi-Fi) introduces Network Address Translation (NAT) and firewall barriers. Direct peer-to-peer socket connections cannot be initiated from either side without an intermediary.

### Recommended Architecture: Hybrid Dual-Mode

| Mode | Transport | Typical Latency | Cost | Primary Use Case |
| :--- | :--- | :--- | :--- | :--- |
| **Local Mode** | Direct Local WebSocket (`ws://<mac-ip>:port`) | **2 – 8 ms** | **$0.00** | Same Wi-Fi network (lowest latency) |
| **Remote Mode** | Secure Cloudflare Tunnel or Edge WebSocket Relay (`wss://`) | **25 – 50 ms** | **$0.00** | Cellular 5G/LTE, hotel Wi-Fi, remote play |

```
                       ┌──────────────────────────────────────────────┐
                       │               REMOTE PLAY                    │
                       │   iPhone (Cellular / Remote Wi-Fi)           │
                       └──────────────────────┬───────────────────────┘
                                              │ WSS (TLS 1.3 encrypted)
                                              ▼
                             ┌──────────────────────────────────┐
                             │  Cloudflare Tunnel / Edge Relay  │
                             │  (Outbound tunnel, zero ports)   │
                             └────────────────┬─────────────────┘
                                              │ WSS tunnel stream
                                              ▼
┌───────────────────────┐            ┌──────────────────────────────────┐
│ iPhone (Same Wi-Fi)   │──Local WS─▶│      macOS Companion App         │
└───────────────────────┘  (2-8ms)   │  - CoreGraphics Keyboard Emitter │
                                     │  - Dead-Man Switch (300ms fail)  │
                                     │  - Virtual Gamepad (Phase 7)     │
                                     └──────────────────────────────────┘
```

---

## 2. Technical Evaluation of Remote Connectivity Options

### Option 1: Secure WebSocket Relay (Recommended Primary Strategy)
- **Mechanism**: The Mac companion app opens an *outbound* secure WebSocket connection to a public relay endpoint. When the user opens the web app on iPhone and enters the pairing code, the relay matches them in an isolated session room and pipes compact JSON or binary packets.
- **NAT Traversal**: 100% success rate across all mobile carriers and firewalls because both devices make standard outbound HTTPS/WSS requests.
- **Latency**: Adds one network hop (typically 15–35ms). Total roundtrip input latency: **30–55ms**. At 60 FPS (16.6ms per frame), this represents ~2 to 3 frames of input latency, which is acceptable for platformers, action RPGs, and adventure games.
- **Cost**: **$0.00**. We can use **Cloudflare Quick Tunnels (`trycloudflare`)** directly from the Mac without registering an account or credit card, or deploy a lightweight Node.js relay on **Render / Koyeb / Fly.io / Cloudflare Workers** within their free tier.

### Option 2: WebRTC DataChannels (UDP Peer-to-Peer)
- **Mechanism**: iPhone Safari and Mac companion negotiate an `RTCDataChannel` using SDP offer/answer over a signaling server.
- **Latency**: Raw UDP, lowest remote latency (**15–30ms** direct).
- **Limitation**: Cellular networks use Carrier-Grade NAT (CGNAT, RFC 6598: `100.64.0.0/10`) and symmetric NAT mapping. In 20–30% of cellular-to-residential routes, direct STUN UDP hole-punching fails completely and requires an expensive TURN relay server. TURN bandwidth is rarely free for sustained streaming.
- **Recommendation**: Keep as an optional Phase 5 upgrade once the WebSocket baseline is proven.

### Option 3: Direct Port Forwarding / UPnP
- **Verdict**: **Rejected**. Insecure, brittle, requires router admin access, and fails completely when the Mac is on public or corporate networks.

---

## 3. Security & Safety Model

1. **Short-Lived Pairing Tokens**:
   - The Mac companion displays a randomly generated 6-character code (e.g., `M7-482`) valid for 5 minutes.
   - Upon pairing, both sides negotiate a cryptographically secure session token (`crypto.randomUUID()`).
   - QR code contains strictly the web app URL + the one-time token: `https://controller.local/?code=M7482`. Never contains system credentials or long-lived keys.
2. **Encrypted In-Flight Communication**:
   - Forced TLS 1.3 / WSS. Mobile Safari requires secure contexts for clipboard, vibration, and modern web APIs.
3. **Hardware Failsafe ("Dead-Man's Switch")**:
   - Heartbeat ping sent every 100ms.
   - If no valid input or heartbeat arrives within **300ms**, the Mac companion triggers `releaseAllHeldKeys()`. This prevents characters from walking off ledges or firing endlessly if the iPhone drops cellular connection.
4. **Input Sanitization & Rate Limiting**:
   - Maximum transmission rate: 60Hz.
   - Strict payload schema validation: rejects any unexpected key codes, malformed vectors, or oversized packets (>512 bytes).

---

## 4. Realistic Cost Analysis

| Component | Provider / Tool | Free Tier Terms | Payment Info Required? |
| :--- | :--- | :--- | :--- |
| **Local Connectivity** | Built-in macOS Wi-Fi | Completely free, open-source | No |
| **Remote Tunnel** | Cloudflare Quick Tunnel (`trycloudflare`) | Free temporary tunnels, unlimited bandwidth | **No account or credit card needed** |
| **Static Web App Hosting** | Local Mac Server / GitHub Pages | Free static hosting | No |
| **Mac Native Development** | Swift / Xcode Command Line Tools | Free Apple developer tools | Free Apple ID only |

**Total Estimated Cost: $0.00**
