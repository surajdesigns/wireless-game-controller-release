/**
 * Headless Mac Companion Receiver (Node.js fallback for development & testing)
 * Connects as host to verify authenticated WebSocket packet streaming without native compilation.
 *
 * Requirements: Node.js 22+ (for built-in global WebSocket) or Node.js 18+ with --experimental-websocket flag.
 */

const http = require('http');

async function startHostReceiver(port = 3000) {
  console.log('--- STARTING HOST RECEIVER (NODE TEST COMPANION) ---');

  // Check for WebSocket support
  if (typeof WebSocket === 'undefined') {
    console.error('❌ Global WebSocket is not available in this Node.js version.');
    console.error('   Use Node.js 22+ or run with: node --experimental-websocket server/host_receiver.js');
    process.exit(1);
  }

  // 1. Create Session on Server
  const postData = JSON.stringify({ hostName: 'MacBook Pro (Node Host)' });
  const options = {
    hostname: 'localhost',
    port: port,
    path: '/api/session/create',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      let session;
      try {
        session = JSON.parse(data);
      } catch (e) {
        console.error('❌ Failed to parse server response:', data.substring(0, 200));
        process.exit(1);
      }

      if (!session.success) {
        console.error('❌ Session creation failed:', session.error || 'Unknown error');
        process.exit(1);
      }

      console.log('✓ Session Created!');
      console.log('  Session ID:', session.sessionId);
      console.log('  Pairing Code:', session.code);
      console.log('  Pair URL:', session.pairUrl);

      // Connect Host WebSocket
      const ws = new WebSocket(`ws://localhost:${port}/ws?sessionId=${session.sessionId}&token=${session.hostToken}`);
      
      ws.onopen = () => {
        console.log('✓ Host WebSocket Connected. Ready for controller inputs.');
      };

      ws.onerror = (event) => {
        console.error('❌ WebSocket error:', event.message || 'Connection failed');
      };

      ws.onclose = (event) => {
        console.log(`🔴 WebSocket closed (code: ${event.code}, reason: ${event.reason || 'none'})`);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.t === 'peer_connected') {
            console.log('🟢 iPhone Connected:', msg.device);
          } else if (msg.t === 'peer_disconnected') {
            console.log('🟡 iPhone Disconnected');
          } else if (msg.t === 'input') {
            const held = Object.keys(msg.b).filter(k => msg.b[k]);
            console.log(`[Input #${msg.seq}] Buttons: [${held.join(', ')}] | LS: (${msg.a.lx}, ${msg.a.ly}) | RS: (${msg.a.rx}, ${msg.a.ry})`);
          }
        } catch (e) {}
      };
    });
  });

  req.on('error', (err) => {
    if (err.code === 'ECONNREFUSED') {
      console.error(`❌ Cannot connect to server at localhost:${port}`);
      console.error('   Make sure the server is running: node server/server.js');
    } else {
      console.error('❌ HTTP request error:', err.message);
    }
    process.exit(1);
  });

  req.write(postData);
  req.end();
}

if (require.main === module) {
  startHostReceiver();
}

module.exports = { startHostReceiver };
