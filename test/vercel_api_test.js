/**
 * Automated Test Suite for Vercel Serverless Function API Handler (api/index.js)
 * Tests full parity with server/server.js:
 * 1. GET /api/health
 * 2. POST /api/session/create (Guaranteed JSON, real tokens, no 404s)
 * 3. POST /api/session/join (Authentication & token verification)
 * 4. GET /api/session/status (Session monitoring)
 * 5. GET /api/session/qr (SVG generation)
 * 6. POST /api/session/revoke (Revocation)
 * 7. 404 Catch-all (Guaranteed JSON error format, not HTML)
 * 8. Rate limiting (429 Too Many Requests)
 */

const assert = require('assert');
const { EventEmitter } = require('events');
const handler = require('../api/index');

// Helper to simulate Vercel / Node.js HTTP request/response cycle in memory
function simulateRequest(method, url, headers = {}, body = null) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    req.headers = { host: 'wireless-game-controller-release.vercel.app', ...headers };
    req.socket = { remoteAddress: '127.0.0.1' };

    const resHeaders = {};
    let statusCode = 200;
    let responseBody = '';

    const res = {
      setHeader(name, val) {
        resHeaders[name.toLowerCase()] = val;
      },
      getHeader(name) {
        return resHeaders[name.toLowerCase()];
      },
      status(code) {
        statusCode = code;
        return res;
      },
      set statusCode(code) {
        statusCode = code;
      },
      get statusCode() {
        return statusCode;
      },
      end(chunk) {
        if (chunk) responseBody += chunk;
        resolve({
          statusCode,
          headers: resHeaders,
          body: responseBody,
          json() {
            return JSON.parse(responseBody);
          }
        });
      }
    };

    // Invoke handler
    handler(req, res).catch((err) => {
      resolve({
        statusCode: 500,
        headers: resHeaders,
        body: JSON.stringify({ error: err.message }),
        json() { return { error: err.message }; }
      });
    });

    // Feed request stream body
    if (body) {
      const payload = typeof body === 'object' ? JSON.stringify(body) : body;
      req.headers['content-type'] = 'application/json';
      req.headers['content-length'] = Buffer.byteLength(payload);
      process.nextTick(() => {
        req.emit('data', payload);
        req.emit('end');
      });
    } else {
      process.nextTick(() => {
        req.emit('end');
      });
    }
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('   RUNNING VERCEL SERVERLESS API TEST SUITE         ');
  console.log('====================================================');

  // Test 1: GET /api/health
  {
    const res = await simulateRequest('GET', '/api/health');
    assert.strictEqual(res.statusCode, 200, 'Health endpoint should return 200');
    assert(res.headers['content-type'].includes('application/json'), 'Content-type must be JSON');
    const data = res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.status, 'healthy');
    console.log('✓ 1. GET /api/health returned 200 OK with valid JSON');
  }

  // Test 2: POST /api/session/create (The endpoint that previously failed with 404 on Vercel)
  let createdSession;
  {
    const res = await simulateRequest('POST', '/api/session/create', {}, { hostName: 'MacBook Pro (M3 Max)' });
    assert.strictEqual(res.statusCode, 200, 'Session create must return 200, NOT 404');
    assert(res.headers['content-type'].includes('application/json'), 'Content-type must be JSON');
    createdSession = res.json();

    assert.strictEqual(createdSession.success, true);
    assert(createdSession.sessionId && createdSession.sessionId.length > 20, 'Must have valid UUID sessionId');
    assert(/^[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{3}$/.test(createdSession.code), 'Code must match XXX-XXX format');
    assert(createdSession.hostToken && createdSession.hostToken.length > 20, 'Must have secure hostToken');
    assert(createdSession.pairToken && createdSession.pairToken.length > 20, 'Must have single-use pairToken');
    assert(createdSession.pairUrl.includes('code='), 'pairUrl must contain pairing code');
    assert(createdSession.expiresAt > Date.now(), 'expiresAt must be in the future');
    console.log(`✓ 2. POST /api/session/create succeeded -> Code: [${createdSession.code}] (Root Cause Fix Verified)`);
  }

  // Test 3: GET /api/session/status (Host check)
  {
    const url = `/api/session/status?sessionId=${createdSession.sessionId}&token=${createdSession.hostToken}`;
    const res = await simulateRequest('GET', url);
    assert.strictEqual(res.statusCode, 200);
    const data = res.json();
    assert.strictEqual(data.status, 'awaiting');
    assert.strictEqual(data.code, createdSession.code);
    console.log('✓ 3. GET /api/session/status returned active awaiting session');
  }

  // Test 4: POST /api/session/join (iPhone pairing)
  let joinedClient;
  {
    const res = await simulateRequest('POST', '/api/session/join', {}, {
      code: createdSession.code,
      clientDevice: 'iPhone 16 Pro (Mobile Safari)'
    });
    assert.strictEqual(res.statusCode, 200, 'Valid code join must return 200');
    joinedClient = res.json();
    assert.strictEqual(joinedClient.success, true);
    assert.strictEqual(joinedClient.sessionId, createdSession.sessionId);
    assert(joinedClient.clientToken && joinedClient.clientToken.length > 20, 'Must issue clientToken');
    console.log('✓ 4. POST /api/session/join authenticated client successfully');
  }

  // Test 5: GET /api/session/qr (SVG generation)
  {
    const res = await simulateRequest('GET', `/api/session/qr?text=${encodeURIComponent(createdSession.pairUrl)}`);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['content-type'], 'image/svg+xml; charset=utf-8');
    assert(res.body.includes('<svg') && res.body.includes('</svg>'), 'Body must be valid SVG markup');
    console.log('✓ 5. GET /api/session/qr generated valid SVG markup with image/svg+xml');
  }

  // Test 6: 404 Catch-All returns JSON (NOT Vercel HTML error)
  {
    const res = await simulateRequest('GET', '/api/nonexistent/endpoint');
    assert.strictEqual(res.statusCode, 404, 'Must return HTTP 404');
    assert(res.headers['content-type'].includes('application/json'), '404 MUST be JSON');
    const data = res.json();
    assert.strictEqual(data.success, false);
    assert(data.error.includes('API endpoint not found'), 'Error message must be clear');
    console.log('✓ 6. Unknown /api/* routes return guaranteed JSON 404 (position 4 bug prevented)');
  }

  // Test 7: POST /api/session/revoke
  {
    const res = await simulateRequest('POST', '/api/session/revoke', {}, {
      sessionId: createdSession.sessionId,
      hostToken: createdSession.hostToken
    });
    assert.strictEqual(res.statusCode, 200);
    const data = res.json();
    assert.strictEqual(data.success, true);
    console.log('✓ 7. POST /api/session/revoke invalidated host session');
  }

  // Test 8: Rate limiting returns 429 JSON
  {
    const fakeIpHeaders = { 'x-forwarded-for': '198.51.100.42' };
    for (let i = 0; i < 5; i++) {
      await simulateRequest('POST', '/api/session/join', fakeIpHeaders, { code: 'BAD-999' });
    }
    const lockedRes = await simulateRequest('POST', '/api/session/join', fakeIpHeaders, { code: 'BAD-999' });
    assert.strictEqual(lockedRes.statusCode, 429, 'Locked out client must receive HTTP 429');
    const data = lockedRes.json();
    assert.strictEqual(data.lockedOut, true);
    console.log('✓ 8. Rate limit lockout returns HTTP 429 Too Many Requests JSON');
  }

  console.log('====================================================');
  console.log('   ALL VERCEL API TESTS PASSED! (8/8)               ');
  console.log('====================================================\n');
}

if (require.main === module) {
  runTests().catch((err) => {
    console.error('Test failure:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
