# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Architecture Security Model

This application implements a pairing-based security model:

### Session Security
- **Cryptographic tokens**: All session tokens are generated using Node.js `crypto.randomBytes()` (256-bit entropy).
- **Short-lived sessions**: Pairing codes expire after a configurable timeout (default: 30 minutes).
- **Single-use pairing tokens**: QR code tokens are invalidated immediately after first use.
- **Rate limiting**: Failed pairing attempts trigger progressive lockouts (5 failures → 60-second lockout per IP).
- **Session revocation**: The host can revoke any active session immediately, disconnecting the paired device.

### Transport Security
- **Local network**: Uses `ws://` (unencrypted WebSocket) on trusted local networks. Data stays within the LAN.
- **Remote / Internet**: When deployed with a reverse proxy (e.g., Cloudflare Tunnel, Fly.io), use `wss://` (TLS-encrypted WebSocket). The application supports both protocols.
- **HTTPS requirement**: QR code scanning and camera access require a secure context (`https://` or `localhost`). The application detects insecure contexts and provides guidance.

### Input Safety
- **Dead-man switch**: If the WebSocket connection drops, all held keyboard inputs are automatically released within 400ms. This prevents stuck keys in games.
- **Heartbeat monitoring**: Client sends periodic heartbeats. If no heartbeat is received within the timeout window, the server releases the session.

## Known Limitations

1. **In-memory session storage**: Sessions are stored in a JavaScript `Map()`. They are lost on server restart. For production deployments, consider adding Redis or a database-backed session store.
2. **No user authentication**: The application does not have user accounts or passwords. Security relies on the pairing code mechanism.
3. **Local network trust**: On local networks, WebSocket traffic is unencrypted. Anyone on the same network could theoretically intercept controller inputs.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities.
2. Email the maintainer directly (see repository contact information).
3. Include a clear description of the vulnerability and steps to reproduce it.
4. Allow reasonable time for a fix before public disclosure.

## Security Best Practices for Users

- Use HTTPS/WSS when connecting over the internet.
- Do not share your pairing code publicly.
- Revoke sessions when you are done playing.
- Keep the server software updated.
- Use a firewall to restrict access to the server port when not in use.
