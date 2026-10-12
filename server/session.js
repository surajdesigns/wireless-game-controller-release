/**
 * Cryptographic Session Manager & Rate Limiter
 * Handles short-lived pairing codes, single-use tokens, rate-limiting, and revocation.
 */

const crypto = require('crypto');

// Disambiguated 32-character alphabet (no 0/O, 1/I/L)
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 60 * 1000; // 60 seconds

class SessionManager {
  constructor() {
    this.sessions = new Map(); // sessionId -> SessionObject
    this.codeToSessionId = new Map(); // normalizedCode -> sessionId
    this.tokenToSessionId = new Map(); // pairToken -> sessionId
    this.rateLimits = new Map(); // ip -> { failedCount, lockedUntil, windowStart }

    // Clean up expired sessions periodically
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), 30000);
    this.cleanupTimer.unref(); // Don't block process exit in tests
  }

  generateHumanCode() {
    let attempts = 0;
    while (attempts < 100) {
      const bytes = crypto.randomBytes(6);
      let chars = '';
      for (let i = 0; i < 6; i++) {
        chars += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
      }
      const formatted = `${chars.slice(0, 3)}-${chars.slice(3, 6)}`;
      const normalized = this.normalizeCode(formatted);
      if (!this.codeToSessionId.has(normalized)) {
        return formatted;
      }
      attempts++;
    }
    // Fallback with timestamp suffix if heavily contested
    return `${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  }

  normalizeCode(code) {
    if (!code || typeof code !== 'string') return '';
    return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  }

  checkRateLimit(ip) {
    const now = Date.now();
    const entry = this.rateLimits.get(ip);
    if (!entry) return { allowed: true };

    if (entry.lockedUntil && now < entry.lockedUntil) {
      const remainingSec = Math.ceil((entry.lockedUntil - now) / 1000);
      return {
        allowed: false,
        error: `Too many failed attempts. Locked out for ${remainingSec}s.`,
        remainingSec
      };
    }

    // Reset window after 5 minutes
    if (now - entry.windowStart > 5 * 60 * 1000) {
      this.rateLimits.delete(ip);
      return { allowed: true };
    }

    return { allowed: true };
  }

  recordFailedAttempt(ip) {
    const now = Date.now();
    let entry = this.rateLimits.get(ip);
    if (!entry) {
      entry = { failedCount: 1, lockedUntil: 0, windowStart: now };
      this.rateLimits.set(ip, entry);
      return;
    }

    entry.failedCount++;
    if (entry.failedCount >= MAX_FAILED_ATTEMPTS) {
      entry.lockedUntil = now + LOCKOUT_DURATION_MS;
      entry.failedCount = 0; // Reset after triggering lockout
    }
  }

  recordSuccess(ip) {
    this.rateLimits.delete(ip);
  }

  createSession(options = {}) {
    const sessionId = crypto.randomUUID();
    const hostToken = crypto.randomBytes(24).toString('base64url');
    const pairToken = crypto.randomBytes(24).toString('base64url');
    const code = this.generateHumanCode();
    const normalizedCode = this.normalizeCode(code);
    const expiresAt = Date.now() + SESSION_TTL_MS;

    const session = {
      id: sessionId,
      code: code,
      normalizedCode: normalizedCode,
      hostToken: hostToken,
      pairToken: pairToken, // One-time token embedded in QR
      clientToken: null,    // Granted upon successful pairing
      hostName: options.hostName || 'MacBook Pro',
      clientDevice: null,
      status: 'awaiting',   // 'awaiting' | 'connected' | 'revoked' | 'expired'
      createdAt: Date.now(),
      expiresAt: expiresAt,
      hostWs: null,
      clientWs: null
    };

    this.sessions.set(sessionId, session);
    this.codeToSessionId.set(normalizedCode, sessionId);
    this.tokenToSessionId.set(pairToken, sessionId);

    return {
      sessionId: session.id,
      code: session.code,
      hostToken: session.hostToken,
      pairToken: session.pairToken,
      expiresAt: session.expiresAt,
      ttlSeconds: Math.round(SESSION_TTL_MS / 1000)
    };
  }

  joinSession(params = {}, ip = '127.0.0.1') {
    // 1. Rate-limit check
    const rateCheck = this.checkRateLimit(ip);
    if (!rateCheck.allowed) {
      return { success: false, error: rateCheck.error, lockedOut: true };
    }

    const { code, pairToken, clientDevice } = params;
    let sessionId = null;

    if (pairToken) {
      sessionId = this.tokenToSessionId.get(pairToken);
    } else if (code) {
      const normalized = this.normalizeCode(code);
      sessionId = this.codeToSessionId.get(normalized);
    }

    if (!sessionId) {
      this.recordFailedAttempt(ip);
      return { success: false, error: 'Invalid pairing code or token.' };
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      this.recordFailedAttempt(ip);
      return { success: false, error: 'Session not found.' };
    }

    // 2. Expiration and status check
    if (session.status === 'revoked') {
      return { success: false, error: 'This pairing session has been revoked by the host.' };
    }

    if (Date.now() > session.expiresAt) {
      session.status = 'expired';
      this.recordFailedAttempt(ip);
      return { success: false, error: 'Pairing session has expired. Request a new code on your Mac.' };
    }

    // 3. Prevent third device if already connected
    if (session.status === 'connected') {
      return { success: false, error: 'A controller is already connected to this session.' };
    }

    // 4. Grant single-use pairing and generate client token
    const clientToken = crypto.randomBytes(24).toString('base64url');
    session.clientToken = clientToken;
    session.clientDevice = clientDevice || 'iPhone (Safari)';
    session.status = 'connected';

    // Invalidate the one-time pairToken so QR code cannot be reused by another phone
    if (session.pairToken) {
      this.tokenToSessionId.delete(session.pairToken);
      session.pairToken = null;
    }

    this.recordSuccess(ip);

    return {
      success: true,
      sessionId: session.id,
      clientToken: clientToken,
      hostName: session.hostName
    };
  }

  revokeSession(sessionId, hostToken) {
    const session = this.sessions.get(sessionId);
    if (!session || session.hostToken !== hostToken) {
      return { success: false, error: 'Unauthorized or session not found.' };
    }

    session.status = 'revoked';
    if (session.pairToken) {
      this.tokenToSessionId.delete(session.pairToken);
    }

    // Terminate connected WebSockets if active
    if (session.clientWs) {
      try {
        session.clientWs.close(4001, 'Session revoked by host');
      } catch (e) {}
    }

    return { success: true, message: 'Session revoked successfully.' };
  }

  getStatus(sessionId, token) {
    const session = this.sessions.get(sessionId);
    if (!session) return { status: 'not_found' };

    // Validate authorization (either hostToken or clientToken)
    if (session.hostToken !== token && session.clientToken !== token) {
      return { status: 'unauthorized' };
    }

    const isExpired = Date.now() > session.expiresAt;
    if (isExpired && session.status !== 'revoked') {
      session.status = 'expired';
    }

    return {
      status: session.status,
      hostName: session.hostName,
      clientDevice: session.clientDevice,
      code: session.code,
      expiresAt: session.expiresAt,
      remainingSeconds: Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000))
    };
  }

  cleanupExpired() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      // Keep revoked/expired sessions around for 10 minutes for audit, then purge
      if (now > session.expiresAt + 10 * 60 * 1000) {
        this.codeToSessionId.delete(session.normalizedCode);
        if (session.pairToken) this.tokenToSessionId.delete(session.pairToken);
        this.sessions.delete(id);
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupTimer);
  }
}

module.exports = new SessionManager();
