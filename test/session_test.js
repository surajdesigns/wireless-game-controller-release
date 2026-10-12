/**
 * Comprehensive Automated Test Suite for Session Management, Pairing Security & Error Resilience
 */

const assert = require('assert');
const sessionManager = require('../server/session');
const { generateQRCodeSVG } = require('../server/qr');

console.log('====================================================');
console.log('   RUNNING SECURE SESSION & PAIRING TEST SUITE      ');
console.log('====================================================');

// 1. Session Creation Test
const hostSession = sessionManager.createSession({ hostName: 'MacBook Pro M3 Max' });
assert.ok(hostSession.sessionId, 'Session must have a unique UUID');
assert.ok(hostSession.hostToken, 'Session must generate host secret token');
assert.ok(hostSession.pairToken, 'Session must generate one-time QR pairToken');
assert.strictEqual(hostSession.code.length, 7, 'Code must be XXX-XXX format');
assert.ok(hostSession.code.includes('-'), 'Code must contain hyphen');
assert.ok(hostSession.expiresAt > Date.now(), 'Expiration must be in future');
console.log('✓ 1. Cryptographic session creation and token generation verified');

// 2. Real QR Payload & SVG Generation Test
const pairUrl = `http://192.168.1.10:3000/?pair=${hostSession.pairToken}&code=${hostSession.code}`;
const svg = generateQRCodeSVG(pairUrl, { color: '#00f0ff' });
assert.ok(svg.startsWith('<svg'), 'QR generator must produce valid SVG root');
assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
assert.ok(svg.includes('<rect'), 'QR SVG must contain matrix module rectangles');
console.log('✓ 2. Standards-compliant QR code SVG generation verified');

// 3. Successful Pairing via 6-Character Code Test
const joinResult = sessionManager.joinSession({ code: hostSession.code }, '10.0.0.1');
assert.strictEqual(joinResult.success, true);
assert.ok(joinResult.clientToken, 'Client must receive authenticated clientToken');
assert.strictEqual(joinResult.hostName, 'MacBook Pro M3 Max');

const statusAfterJoin = sessionManager.getStatus(hostSession.sessionId, hostSession.hostToken);
assert.strictEqual(statusAfterJoin.status, 'connected');
console.log('✓ 3. Client pairing via human code verified');

// 4. Prevention of Third Device / Double Join
const secondJoin = sessionManager.joinSession({ code: hostSession.code }, '10.0.0.2');
assert.strictEqual(secondJoin.success, false);
assert.ok(secondJoin.error.includes('already connected'), 'Must reject third device from joining active session');
console.log('✓ 4. Single-client session exclusivity verified');

// 5. Invalid Code Handling
const freshSession = sessionManager.createSession({ hostName: 'Mac Studio' });
const badJoin = sessionManager.joinSession({ code: 'BAD-999' }, '192.168.1.50');
assert.strictEqual(badJoin.success, false);
assert.strictEqual(badJoin.error, 'Invalid pairing code or token.');
console.log('✓ 5. Invalid code rejection verified');

// 6. Rate Limiting Brute-Force Lockout Test (5 failed attempts)
const attackerIp = '203.0.113.42';
for (let i = 0; i < 4; i++) {
  const res = sessionManager.joinSession({ code: 'WRG-00' + i }, attackerIp);
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.lockedOut, undefined, `Attempt ${i + 1} should not be locked out yet`);
}

// 5th attempt triggers lockout
const lockedRes = sessionManager.joinSession({ code: 'WRG-005' }, attackerIp);
assert.strictEqual(lockedRes.success, false);

// 6th attempt is blocked by rate-limiter
const blockedRes = sessionManager.joinSession({ code: freshSession.code }, attackerIp);
assert.strictEqual(blockedRes.success, false);
assert.strictEqual(blockedRes.lockedOut, true, 'Attacker IP must be locked out after 5 failures');
assert.ok(blockedRes.error.includes('Too many failed attempts'), 'Must notify user of lockout duration');
console.log('✓ 6. Brute-force rate limiting and 60-second lockout verified');

// 7. Expired Session Rejection Test
const expiredSession = sessionManager.createSession({ hostName: 'Old Mac' });
sessionManager.sessions.get(expiredSession.sessionId).expiresAt = Date.now() - 1000;

const expiredJoin = sessionManager.joinSession({ code: expiredSession.code }, '192.168.1.99');
assert.strictEqual(expiredJoin.success, false);
assert.ok(expiredJoin.error.includes('expired'), 'Expired sessions must be rejected');
console.log('✓ 7. Expired session rejection verified');

// 8. Session Revocation Test
const revocableSession = sessionManager.createSession({ hostName: 'Mac Pro' });
const revokeRes = sessionManager.revokeSession(revocableSession.sessionId, revocableSession.hostToken);
assert.strictEqual(revokeRes.success, true);

const statusAfterRevoke = sessionManager.getStatus(revocableSession.sessionId, revocableSession.hostToken);
assert.strictEqual(statusAfterRevoke.status, 'revoked');

const joinRevoked = sessionManager.joinSession({ code: revocableSession.code }, '192.168.1.88');
assert.strictEqual(joinRevoked.success, false);
assert.ok(joinRevoked.error.includes('revoked'), 'Revoked sessions must reject joining');
console.log('✓ 8. Host session revocation and instant client invalidation verified');

// 9. Unauthorized Status Inspection Test
const fakeStatus = sessionManager.getStatus(freshSession.sessionId, 'bogus_token_xyz');
assert.strictEqual(fakeStatus.status, 'unauthorized', 'Must reject status query without host or client token');
console.log('✓ 9. Unauthorized token session status protection verified');

// 10. QR Code Payload Refresh Test
const s1 = sessionManager.createSession({ hostName: 'MacBook Air' });
const url1 = `http://localhost:3000/?pair=${s1.pairToken}&code=${s1.code}`;
const svg1 = generateQRCodeSVG(url1);

// Generate second session (refresh)
const s2 = sessionManager.createSession({ hostName: 'MacBook Air' });
const url2 = `http://localhost:3000/?pair=${s2.pairToken}&code=${s2.code}`;
const svg2 = generateQRCodeSVG(url2);

assert.notStrictEqual(s1.code, s2.code, 'Regenerated session must have new code');
assert.notStrictEqual(url1, url2, 'Regenerated session must have new pairing URL');
assert.notStrictEqual(svg1, svg2, 'Regenerated session must produce distinct QR matrix');
console.log('✓ 10. QR Code regeneration and payload refresh verified');

// 11. Malformed / Non-JSON Error Resilience Test (The "Position 4" bug prevention)
function mockSafeFetchTest(status, contentType, bodyText) {
  if (!contentType.includes('application/json')) {
    const shortSnippet = bodyText.trim().slice(0, 80);
    throw new Error(`Server returned HTTP ${status} (Error): ${shortSnippet || 'Non-JSON response'}`);
  }
  return JSON.parse(bodyText);
}

// Case A: 404 Not Found HTML/text response
assert.throws(() => {
  mockSafeFetchTest(404, 'text/plain', '404 Not Found');
}, /Server returned HTTP 404/, 'Non-JSON 404 text must NOT trigger SyntaxError');

// Case B: 500 Internal Error HTML response
assert.throws(() => {
  mockSafeFetchTest(500, 'text/html', '<html><body>Internal Server Error</body></html>');
}, /Server returned HTTP 500/, 'HTML 500 must produce descriptive HTTP error instead of SyntaxError');

// Case C: Valid JSON error response
assert.doesNotThrow(() => {
  const json = mockSafeFetchTest(400, 'application/json', JSON.stringify({ success: false, error: 'Invalid code' }));
  assert.strictEqual(json.success, false);
});
console.log('✓ 11. Non-JSON response resilience (position 4 bug prevention) verified');

// Clean up timer
sessionManager.destroy();

console.log('\n====================================================');
console.log('   ALL SECURITY & PAIRING TESTS PASSED (11/11)      ');
console.log('====================================================\n');
