/**
 * Client Session & Pairing Manager
 * Resilient REST communication with AbortController timeouts,
 * guaranteed JSON validation, friendly error formatting, and persistent session resumption.
 */

class SessionClient {
  constructor() {
    this.sessionId = null;
    this.hostToken = null;
    this.clientToken = null;
    this.hostName = null;
    this.code = null;
    this.expiresAt = null;
    this.pollTimer = null;
    this.storageKey = 'antigravity_active_session_v1';

    this.restoreSavedSession();
  }

  restoreSavedSession() {
    try {
      const saved = sessionStorage.getItem(this.storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.expiresAt && Date.now() < parsed.expiresAt) {
          this.sessionId = parsed.sessionId;
          this.hostToken = parsed.hostToken;
          this.clientToken = parsed.clientToken;
          this.hostName = parsed.hostName;
          this.code = parsed.code;
          this.expiresAt = parsed.expiresAt;
        } else {
          sessionStorage.removeItem(this.storageKey);
        }
      }
    } catch (e) {}
  }

  saveSession(data) {
    try {
      const payload = {
        sessionId: this.sessionId,
        hostToken: this.hostToken,
        clientToken: this.clientToken,
        hostName: this.hostName,
        code: this.code,
        expiresAt: this.expiresAt
      };
      sessionStorage.setItem(this.storageKey, JSON.stringify(payload));
    } catch (e) {}
  }

  clearSession() {
    this.stopPolling();
    this.sessionId = null;
    this.hostToken = null;
    this.clientToken = null;
    this.hostName = null;
    this.code = null;
    this.expiresAt = null;
    try {
      sessionStorage.removeItem(this.storageKey);
    } catch (e) {}
  }

  getBackendUrl() {
    if (typeof window !== 'undefined') {
      if (window.BACKEND_URL) return window.BACKEND_URL.replace(/\/+$/, '');
      if (window.SERVER_URL) return window.SERVER_URL.replace(/\/+$/, '');
      try {
        const saved = localStorage.getItem('antigravity_relay_url');
        if (saved) return saved.trim().replace(/\/+$/, '');
      } catch (e) {}
    }
    return '';
  }

  setBackendUrl(url) {
    try {
      if (url && url.trim()) {
        localStorage.setItem('antigravity_relay_url', url.trim().replace(/\/+$/, ''));
      } else {
        localStorage.removeItem('antigravity_relay_url');
      }
    } catch (e) {}
  }

  /**
   * Resilient Fetch with AbortController timeout & guaranteed JSON parsing.
   */
  async safeFetchJson(endpoint, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const baseUrl = this.getBackendUrl();
    const targetUrl = (baseUrl && !endpoint.startsWith('http')) ? `${baseUrl}${endpoint}` : endpoint;

    try {
      const res = await fetch(targetUrl, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timer);

      const contentType = res.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');

      if (!isJson) {
        const text = await res.text();
        const shortSnippet = text.trim().slice(0, 80);
        throw new Error(`Server returned HTTP ${res.status} (${res.statusText || 'Error'}): ${shortSnippet || 'Non-JSON response'}`);
      }

      let data;
      try {
        data = await res.json();
      } catch (err) {
        throw new Error(`Failed to parse JSON response: ${err.message}`);
      }

      if (!res.ok) {
        const msg = data.error || `Request failed with status ${res.status}`;
        const error = new Error(msg);
        error.status = res.status;
        error.lockedOut = data.lockedOut;
        throw error;
      }

      return data;
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Error(`Connection timed out after ${Math.round(timeoutMs / 1000)}s. Please check that your Mac server is running.`);
      }
      if (err.message && err.message.includes('Failed to fetch')) {
        throw new Error(`Cannot reach server at ${location.host}. Ensure both devices are on the same Wi-Fi network.`);
      }
      throw err;
    }
  }

  async createHostSession(hostName = 'MacBook Pro') {
    const data = await this.safeFetchJson('/api/session/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostName })
    });

    this.sessionId = data.sessionId;
    this.hostToken = data.hostToken;
    this.hostName = hostName;
    this.code = data.code;
    this.expiresAt = data.expiresAt;
    this.saveSession();

    return data;
  }

  async joinSession(params) {
    const data = await this.safeFetchJson('/api/session/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    this.sessionId = data.sessionId;
    this.clientToken = data.clientToken;
    this.hostName = data.hostName;
    this.expiresAt = Date.now() + 5 * 60 * 1000;
    this.saveSession();

    return data;
  }

  async revokeHostSession() {
    if (!this.sessionId || !this.hostToken) {
      this.clearSession();
      return;
    }
    try {
      await this.safeFetchJson('/api/session/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId, hostToken: this.hostToken })
      });
    } catch (e) {
      // Ignore network errors when revoking
    } finally {
      this.clearSession();
    }
  }

  async fetchStatus() {
    if (!this.sessionId) return null;
    const token = this.hostToken || this.clientToken;
    if (!token) return null;
    return await this.safeFetchJson(`/api/session/status?sessionId=${encodeURIComponent(this.sessionId)}&token=${encodeURIComponent(token)}`);
  }

  startStatusPolling(onUpdate) {
    this.stopPolling();
    this.pollTimer = setInterval(async () => {
      try {
        const status = await this.fetchStatus();
        if (status) onUpdate(status);
      } catch (e) {}
    }, 2000);
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

window.sessionClient = new SessionClient();
