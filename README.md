# 🎮 Wireless Game Controller

Use your iPhone as a wireless Xbox-style game controller for macOS games.

No App Store download needed — the controller runs entirely in Safari.

![Controller Preview](docs/controller-preview.png)

---

## Features

- **Xbox-style virtual gamepad** — Dual analog sticks, A/B/X/Y buttons, D-pad, LT/RT/LB/RB triggers, L3/R3 clicks, View/Menu/Guide buttons
- **Secure QR code pairing** — Scan a QR code or enter a short pairing code to connect
- **Real-time WebSocket transport** — Sub-10ms local latency with heartbeat monitoring
- **Dead-man switch** — All held keys are automatically released if the connection drops
- **Customizable key mappings** — Map any controller input to any keyboard key
- **Reconnection support** — Automatic reconnect with exponential backoff after network interruptions
- **Zero dependencies** — The entire server runs on Node.js built-in modules only
- **Native macOS companion** — Swift app injects keyboard events via CoreGraphics for game compatibility

---

## Quick Start

### Prerequisites

- **Mac**: Node.js 18+ (`node --version` to check)
- **iPhone**: Safari browser (iOS 15+)
- Both devices on the same Wi-Fi network (for local mode)

### 1. Start the server

```bash
git clone https://github.com/YOUR_USERNAME/wireless-game-controller.git
cd wireless-game-controller
node server/server.js
```

The server starts on port 3000 and displays your local IP address.

### 2. Open on your Mac

Open `http://localhost:3000` in your Mac browser and select **"Using on Mac"**.

A QR code and pairing code will appear.

### 3. Connect your iPhone

Open `http://<your-mac-ip>:3000` in iPhone Safari and select **"Using on iPhone"**.

Either:
- **Scan the QR code** displayed on your Mac, or
- **Enter the pairing code** manually

The Xbox-style controller will appear once connected.

### 4. Play your game

Launch your Mac game and start playing with the virtual controller!

---

## Project Structure

```
wireless-game-controller/
├── server/
│   ├── server.js          # HTTP server, REST API, and WebSocket relay
│   ├── session.js         # Secure session and pairing management
│   ├── qr.js              # Zero-dependency QR code SVG generator
│   └── host_receiver.js   # Headless test companion for development
├── web/
│   ├── index.html         # Multi-screen application layout
│   ├── css/
│   │   └── style.css      # Dark gaming UI theme
│   └── js/
│       ├── app.js          # Application router and screen management
│       ├── controller.js   # Touch input engine (dual joysticks, buttons)
│       ├── state.js        # Gamepad state machine with combo detection
│       ├── settings.js     # Settings and key mapping manager
│       ├── ui.js           # HUD overlays and settings modals
│       ├── session.js      # REST API client with timeout/retry
│       ├── scanner.js      # QR code camera scanner
│       ├── qrcode.js       # Browser-side QR code generator
│       └── ws.js           # WebSocket client with reconnection
├── macos/
│   └── Companion.swift     # Native macOS keyboard injection companion
├── test/
│   ├── state_test.js       # Xbox controller state tests (8 tests)
│   ├── session_test.js     # Session security tests (11 tests)
│   └── integration_test.js # Protocol integration tests (4 tests)
├── docs/
│   └── architecture.md     # Network architecture documentation
├── package.json
├── vercel.json             # Vercel static deployment config
├── .env.example            # Environment variable template
├── .gitignore
├── LICENSE
└── SECURITY.md
```

---

## Deployment

### Option A: Local Only (Recommended for Getting Started)

Both devices on the same Wi-Fi network:

```bash
node server/server.js
```

The server serves the frontend and handles WebSocket connections. Open the displayed URL on both devices.

### Option B: Vercel Frontend + Separate WebSocket Backend

For internet access (iPhone on cellular, Mac on Wi-Fi):

#### Frontend (Vercel — free)

1. Push the repository to GitHub
2. Import into [Vercel](https://vercel.com)
3. Vercel auto-detects `vercel.json` and deploys the `web/` directory as a static site

> ⚠️ **Vercel does NOT support persistent WebSocket connections.** The frontend on Vercel can only serve the static controller UI. The real-time WebSocket server must be hosted separately.

#### WebSocket Backend (choose one)

| Service | Free Tier | Notes |
|---------|-----------|-------|
| **Fly.io** | 3 shared VMs | `fly launch` + `fly deploy` |
| **Railway** | 500 hrs/month | Connect GitHub repo |
| **Render** | 750 hrs/month | Free web service |
| **Self-hosted** | ∞ | Run `node server/server.js` on any VPS |

After deploying the WebSocket server, update the frontend to point to it by configuring the `WEBSOCKET_SERVER_URL` environment variable (see `.env.example`).

### Option C: Cloudflare Tunnel (Remote Access Without Deployment)

For quick remote access without deploying to a cloud service:

```bash
# Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel --url http://localhost:3000
```

This creates a temporary public `https://*.trycloudflare.com` URL that tunnels to your local server. Share this URL with your iPhone — works across any network, with TLS included.

**Cost**: Free (Cloudflare Quick Tunnels are free, no account required).

---

## macOS Companion (Optional)

The Swift companion app provides native keyboard injection for games that require actual key press events (not just browser keyboard events).

### Build and Run

```bash
cd macos
swiftc Companion.swift -o GameControllerCompanion -framework Cocoa -framework CoreGraphics
./GameControllerCompanion
```

**Requirements**:
- Xcode Command Line Tools (`xcode-select --install`)
- macOS Accessibility permission (System Settings → Privacy & Security → Accessibility)

The companion connects to the WebSocket server and translates controller inputs into keyboard events using `CGEvent`.

---

## Running Tests

```bash
# Run all tests (23 total)
npm test

# Run individual test suites
npm run test:state        # 8 Xbox controller state tests
npm run test:session      # 11 session security tests
npm run test:integration  # 4 protocol integration tests
```

---

## Configuration

Copy `.env.example` to `.env` and customize:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `SESSION_EXPIRY_MINUTES` | `30` | Pairing code expiration |
| `RATE_LIMIT_MAX_FAILURES` | `5` | Max failed attempts before lockout |
| `WEBSOCKET_SERVER_URL` | *(auto)* | WebSocket URL for split deployments |

---

## Key Mapping

The default mapping is designed for action/adventure games:

| Controller Input | Default Key | Game Action |
|-----------------|-------------|-------------|
| Left Stick | W/A/S/D | Move |
| Right Stick | Arrow Keys | Camera |
| A | E | Examine / Pick up |
| B | Q | Dodge |
| X | R | Reload |
| Y | Tab | Inventory |
| LT | Right Click | Aim |
| RT | Left Click | Attack |
| LB | Shift | Guard |
| RB | F | Use item |
| L3 (Run) | Shift+W | Sprint |
| View | M | Map |
| Menu | Escape | Pause |

Mappings can be customized in the Settings panel on the controller screen.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **QR code not showing** | Check that the server is running and accessible. Try refreshing the Mac host page. |
| **"Camera not supported"** | Camera requires HTTPS. Use `localhost` or deploy with HTTPS. Manual code entry works on HTTP. |
| **Connection drops frequently** | Ensure stable Wi-Fi. The controller auto-reconnects up to 6 times with exponential backoff. |
| **Keys stuck in game** | The dead-man switch releases all keys within 400ms of disconnection. If stuck, click the game window to refocus. |
| **Port 3000 in use** | Set a different port: `PORT=3001 node server/server.js` |
| **JSON parsing error** | Fixed in v1.0. Update to the latest version. All API responses are guaranteed JSON. |

---

## Security

See [SECURITY.md](SECURITY.md) for the full security policy.

**Key protections**:
- Cryptographically secure pairing tokens
- Rate-limited pairing attempts
- Single-use QR codes
- Automatic session expiration
- Dead-man switch for input safety

---

## License

[MIT](LICENSE)
