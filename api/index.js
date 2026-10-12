/**
 * Vercel Serverless Function Entry Point for Wireless Game Controller API
 * Handles all /api/* routes deployed to Vercel:
 * - GET  /api/health
 * - POST /api/session/create
 * - POST /api/session/join
 * - POST /api/session/revoke
 * - GET  /api/session/status
 * - GET  /api/session/qr
 */

const { URL } = require('url');
const sessionManager = require('../server/session');
const { generateQRCodeSVG } = require('../server/qr');

// Utility: Guaranteed JSON Response Writer
function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data);
  if (typeof res.status === 'function') {
    res.status(statusCode);
  } else {
    res.statusCode = statusCode;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.end(payload);
}

// Utility: Parse JSON body across Vercel and Node.js runtimes
async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (e) {
      throw new Error(`Malformed JSON payload: ${e.message}`);
    }
  }
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 64 * 1024) {
        reject(new Error('Payload exceeds 64KB limit'));
      }
    });
    req.on('end', () => {
      if (!raw || raw.trim() === '') {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`Malformed JSON payload: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (typeof res.status === 'function') {
      res.status(204);
    } else {
      res.statusCode = 204;
    }
    res.end();
    return;
  }

  const host = req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const fullUrl = new URL(req.url, `${proto}://${host}`);
  const pathname = fullUrl.pathname;
  const clientIp = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1').split(',')[0].trim();

  // 0. GET /api/health
  if (pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, {
      success: true,
      status: 'healthy',
      platform: 'vercel-serverless',
      uptime: process.uptime()
    });
    return;
  }

  // 1. POST /api/session/create
  if (pathname === '/api/session/create' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const hostName = body.hostName || 'MacBook Pro';
      const session = sessionManager.createSession({ hostName });
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
    } catch (err) {
      sendJson(res, 400, { success: false, error: err.message });
    }
    return;
  }

  // 2. POST /api/session/join
  if (pathname === '/api/session/join' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const result = sessionManager.joinSession(body, clientIp);
      if (result.success) {
        sendJson(res, 200, result);
      } else {
        const status = result.lockedOut ? 429 : 400;
        sendJson(res, status, result);
      }
    } catch (err) {
      sendJson(res, 400, { success: false, error: err.message });
    }
    return;
  }

  // 3. POST /api/session/revoke
  if (pathname === '/api/session/revoke' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      if (!body.sessionId || !body.hostToken) {
        sendJson(res, 400, { success: false, error: 'Missing sessionId or hostToken' });
        return;
      }
      const result = sessionManager.revokeSession(body.sessionId, body.hostToken);
      sendJson(res, result.success ? 200 : 403, result);
    } catch (err) {
      sendJson(res, 400, { success: false, error: err.message });
    }
    return;
  }

  // 4. GET /api/session/status
  if (pathname === '/api/session/status' && req.method === 'GET') {
    const sessionId = fullUrl.searchParams.get('sessionId') || req.query?.sessionId;
    const token = fullUrl.searchParams.get('token') || req.query?.token;
    if (!sessionId || !token) {
      sendJson(res, 400, { success: false, error: 'Missing sessionId or token parameter' });
      return;
    }
    const status = sessionManager.getStatus(sessionId, token);
    const code = status.status === 'not_found' ? 404 : (status.status === 'unauthorized' ? 403 : 200);
    sendJson(res, code, status);
    return;
  }

  // 5. GET /api/session/qr
  if (pathname === '/api/session/qr' && req.method === 'GET') {
    const text = fullUrl.searchParams.get('text') || req.query?.text;
    if (!text || text.trim() === '') {
      sendJson(res, 400, { success: false, error: 'Missing text parameter' });
      return;
    }
    try {
      const svg = generateQRCodeSVG(text, { color: '#00f0ff', margin: 2 });
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Content-Length', Buffer.byteLength(svg));
      res.setHeader('Cache-Control', 'no-store, no-cache');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (typeof res.status === 'function') {
        res.status(200);
      } else {
        res.statusCode = 200;
      }
      res.end(svg);
    } catch (err) {
      sendJson(res, 500, { success: false, error: 'Failed to generate QR SVG: ' + err.message });
    }
    return;
  }

  // 404 Catch-All for undefined /api/*
  sendJson(res, 404, { success: false, error: `API endpoint not found: ${pathname}` });
};
