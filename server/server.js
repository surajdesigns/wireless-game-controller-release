/**
 * Antigravity Controller - Secure Server
 * HTTP Static Server + Session REST API + Authenticated WebSocket Relay
 * Zero External Dependencies (Node.js built-in http, crypto, fs, path, os)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const sessionManager = require('./session');
const { generateQRCodeSVG } = require('./qr');

const PORT = parseInt(process.env.PORT || '3000', 10);
const WEB_DIR = path.join(__dirname, '..', 'web');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function log(level, message) {
  const time = new Date().toISOString().substring(11, 19);
  console.log(`[${time}] [${level}] ${message}`);
}

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

function parseJsonBody(req, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let body = '';
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('Request body timeout'));
    }, timeoutMs);

    req.on('data', chunk => {
      body += chunk;
      if (body.length > 32 * 1024) { // 32KB max request
        clearTimeout(timer);
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });

    req.on('end', () => {
      clearTimeout(timer);
      if (!body || body.trim() === '') return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Malformed JSON payload: ' + err.message));
      }
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(payload);
}

// ============================================================================
// HTTP Request Router
// ============================================================================
const server = http.createServer(async (req, res) => {
  const startTime = Date.now();
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1').split(',')[0].trim();

  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  // --------------------------------------------------------------------------
  // API Endpoints (/api/*) — GUARANTEED to ALWAYS return JSON
  // --------------------------------------------------------------------------
  if (pathname.startsWith('/api/')) {
    // 0. API Health Check
    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { success: true, status: 'healthy', uptime: process.uptime() });
      log('INFO', `GET /api/health from ${clientIp} -> 200 OK (${Date.now() - startTime}ms)`);
      return;
    }

    // 1. API: Create Session (Called by Mac Host)
    if (pathname === '/api/session/create' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        const hostName = body.hostName || 'MacBook Pro';
        const session = sessionManager.createSession({ hostName });

        const host = req.headers.host || `localhost:${PORT}`;
        const proto = req.headers['x-forwarded-proto'] || 'http';
        const pairUrl = `${proto}://${host}/?pair=${session.pairToken}&code=${session.code}`;

        sendJson(res, 200, {
          success: true,
          sessionId: session.sessionId,
          code: session.code,
          hostToken: session.hostToken,
          pairToken: session.pairToken,
          pairUrl: pairUrl,
          expiresAt: session.expiresAt,
          ttlSeconds: session.ttlSeconds
        });
        log('INFO', `POST /api/session/create -> Code: [${session.code}] Session: ${session.sessionId.slice(0, 8)}... (${Date.now() - startTime}ms)`);
      } catch (err) {
        log('WARN', `POST /api/session/create failed: ${err.message}`);
        sendJson(res, 400, { success: false, error: err.message });
      }
      return;
    }

    // 2. API: Join Session (Called by iPhone Client)
    if (pathname === '/api/session/join' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        const result = sessionManager.joinSession(body, clientIp);

        if (result.success) {
          sendJson(res, 200, result);
          log('INFO', `POST /api/session/join -> Device paired for Session: ${result.sessionId.slice(0, 8)}... (${Date.now() - startTime}ms)`);
        } else {
          const status = result.lockedOut ? 429 : 400;
          sendJson(res, status, result);
          log('WARN', `POST /api/session/join rejected (${result.error}) from ${clientIp}`);
        }
      } catch (err) {
        log('WARN', `POST /api/session/join error: ${err.message}`);
        sendJson(res, 400, { success: false, error: err.message });
      }
      return;
    }

    // 3. API: Revoke Session (Called by Mac Host)
    if (pathname === '/api/session/revoke' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        if (!body.sessionId || !body.hostToken) {
          sendJson(res, 400, { success: false, error: 'Missing sessionId or hostToken' });
          return;
        }
        const result = sessionManager.revokeSession(body.sessionId, body.hostToken);
        sendJson(res, result.success ? 200 : 403, result);
        log('INFO', `POST /api/session/revoke -> ${result.message || result.error}`);
      } catch (err) {
        sendJson(res, 400, { success: false, error: err.message });
      }
      return;
    }

    // 4. API: Session Status
    if (pathname === '/api/session/status' && req.method === 'GET') {
      const sessionId = parsedUrl.searchParams.get('sessionId');
      const token = parsedUrl.searchParams.get('token');
      if (!sessionId || !token) {
        sendJson(res, 400, { success: false, error: 'Missing sessionId or token parameter' });
        return;
      }
      const status = sessionManager.getStatus(sessionId, token);
      const code = status.status === 'not_found' ? 404 : (status.status === 'unauthorized' ? 403 : 200);
      sendJson(res, code, status);
      return;
    }

    // 5. API: Dynamic QR Code SVG Endpoint
    if (pathname === '/api/session/qr' && req.method === 'GET') {
      const text = parsedUrl.searchParams.get('text');
      if (!text || text.trim() === '') {
        sendJson(res, 400, { success: false, error: 'Missing text parameter' });
        return;
      }
      try {
        const svg = generateQRCodeSVG(text, { color: '#00f0ff', margin: 2 });
        res.writeHead(200, {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(svg),
          'Cache-Control': 'no-store, no-cache',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(svg);
        log('INFO', `GET /api/session/qr (${text.length} chars) -> 200 SVG (${Date.now() - startTime}ms)`);
      } catch (err) {
        sendJson(res, 500, { success: false, error: 'Failed to generate QR SVG: ' + err.message });
      }
      return;
    }

    // Catch-all for undefined /api/* routes: ALWAYS return JSON 404!
    sendJson(res, 404, { success: false, error: `API endpoint not found: ${pathname}` });
    return;
  }

  // --------------------------------------------------------------------------
  // Static Web Files Serving (web/*)
  // --------------------------------------------------------------------------
  let reqPath = pathname;
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(WEB_DIR, safePath);

  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Content-Type-Options': 'nosniff'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

// ============================================================================
// Zero-Dependency WebSocket Implementation (RFC 6455)
// ============================================================================
function encodeWsFrame(data) {
  const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

server.on('upgrade', (req, socket, head) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (parsedUrl.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  const sessionId = parsedUrl.searchParams.get('sessionId');
  const token = parsedUrl.searchParams.get('token');

  const session = sessionManager.sessions.get(sessionId);
  if (!session || (session.hostToken !== token && session.clientToken !== token)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  // WebSocket Handshake
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
  );

  const isHost = session.hostToken === token;
  const wsClient = {
    socket,
    send(data) {
      if (!socket.destroyed) {
        try {
          socket.write(encodeWsFrame(data));
        } catch (e) {}
      }
    },
    close(code = 1000, reason = '') {
      if (!socket.destroyed) {
        socket.end();
      }
    }
  };

  if (isHost) {
    session.hostWs = wsClient;
    log('INFO', `[WS] Host connected for Session: ${sessionId.slice(0, 8)}...`);
  } else {
    session.clientWs = wsClient;
    log('INFO', `[WS] Client (iPhone) connected for Session: ${sessionId.slice(0, 8)}...`);
    if (session.hostWs) {
      session.hostWs.send({ t: 'peer_connected', device: session.clientDevice });
    }
    // Also notify client that handshake succeeded
    wsClient.send({ t: 'authenticated', hostName: session.hostName });
  }

  // Handle incoming WebSocket frames
  let buffer = Buffer.alloc(0);
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const byte0 = buffer[0];
      const byte1 = buffer[1];
      const opcode = byte0 & 0x0f;
      const isMasked = (byte1 & 0x80) !== 0;
      let payloadLen = byte1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (buffer.length < offset + 2) break;
        payloadLen = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLen === 127) {
        if (buffer.length < offset + 8) break;
        payloadLen = Number(buffer.readBigUInt64BE(offset));
        offset += 8;
      }

      let maskKey = null;
      if (isMasked) {
        if (buffer.length < offset + 4) break;
        maskKey = buffer.slice(offset, offset + 4);
        offset += 4;
      }

      if (buffer.length < offset + payloadLen) break;

      const payload = buffer.slice(offset, offset + payloadLen);
      buffer = buffer.slice(offset + payloadLen);

      // Close opcode
      if (opcode === 0x08) {
        socket.end();
        return;
      }

      // Ping opcode -> Pong
      if (opcode === 0x09) {
        socket.write(Buffer.from([0x8a, 0x00]));
        return;
      }

      // Text / Binary frame
      if (opcode === 0x01 || opcode === 0x02) {
        if (isMasked && maskKey) {
          for (let i = 0; i < payload.length; i++) {
            payload[i] ^= maskKey[i % 4];
          }
        }

        const msgStr = payload.toString('utf8');
        try {
          const msg = JSON.parse(msgStr);
          if (msg.t === 'ping') {
            // Heartbeat ping -> immediate pong reply to sender
            wsClient.send({ t: 'pong', echoTs: msg.echoTs });
            return;
          }

          // Forward input packets between iPhone and Mac
          if (payloadLen <= 512) {
            if (!isHost && session.hostWs) {
              session.hostWs.send(msg);
            } else if (isHost && session.clientWs) {
              session.clientWs.send(msg);
            }
          }
        } catch (e) {}
      }
    }
  });

  socket.on('close', () => {
    if (isHost) {
      session.hostWs = null;
      log('INFO', `[WS] Host disconnected for Session: ${sessionId.slice(0, 8)}...`);
    } else {
      session.clientWs = null;
      log('INFO', `[WS] Client disconnected for Session: ${sessionId.slice(0, 8)}...`);
      if (session.hostWs) {
        session.hostWs.send({ t: 'peer_disconnected' });
      }
    }
  });

  socket.on('error', () => {
    socket.destroy();
  });
});

// Guard: Only start listening if executed directly from terminal
if (require.main === module) {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('\n❌ ERROR: Port ' + PORT + ' is already in use by another process.');
      console.error('To terminate the existing process, run this in Terminal:');
      console.error('  lsof -ti :' + PORT + ' | xargs kill -9');
      console.error('Then restart the server with: node server/server.js\n');
      process.exit(1);
    } else {
      console.error('Server error:', err);
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    const localIps = getLocalIpAddresses();
    console.log('====================================================');
    console.log('  ANTIGRAVITY GAME CONTROLLER (SECURE PAIRING & WS) ');
    console.log('====================================================');
    console.log(`\nMac Host Browser:  http://localhost:${PORT}`);
    if (localIps.length > 0) {
      console.log('\nTo pair your iPhone (same Wi-Fi):');
      localIps.forEach(ip => {
        console.log(`  👉  http://${ip}:${PORT}`);
      });
    }
    console.log('\nPress Ctrl+C to stop the server.');
    console.log('====================================================\n');
  });
}

module.exports = { server, sessionManager, PORT };
