/**
 * Authenticated Real-Time WebSocket Transport Client
 * Features:
 * - Genuine authenticated state confirmation
 * - Heartbeat ping/pong with true round-trip latency tracking
 * - Bounded exponential backoff auto-reconnect
 * - Connection-loss detection
 * - Failsafe input release on disconnect
 * - Cancellation on page unload
 */

class WebSocketClient {
  constructor() {
    this.ws = null;
    this.sessionId = null;
    this.token = null;
    this.isAuthenticated = false;
    this.isConnecting = false;
    this.shouldReconnect = true;

    this.pingTimer = null;
    this.lastPongTime = 0;
    this.reconnectAttempt = 0;
    this.maxReconnectAttempts = 6;
    this.reconnectTimer = null;

    this.subscribers = [];
    this.bindPageLifecycle();
  }

  bindPageLifecycle() {
    const cleanup = () => {
      this.shouldReconnect = false;
      this.disconnect();
    };
    window.addEventListener('beforeunload', cleanup);
    window.addEventListener('pagehide', cleanup);
  }

  onMessage(callback) {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter(fn => fn !== callback);
    };
  }

  getWsUrl(sessionId, token) {
    const backend = window.sessionClient?.getBackendUrl?.() || '';
    if (backend) {
      const isHttps = backend.startsWith('https:');
      const wsProto = isHttps ? 'wss:' : 'ws:';
      const cleanHost = backend.replace(/^https?:\/\//, '');
      return `${wsProto}//${cleanHost}/ws?sessionId=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`;
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws?sessionId=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`;
  }

  connect(sessionId, token) {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.sessionId = sessionId;
    this.token = token;
    this.shouldReconnect = true;
    this.isConnecting = true;

    this._updateStatus('connecting', 'Connecting...');

    const wsUrl = this.getWsUrl(sessionId, token);

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (e) {
      console.error('[WS] Initialization failed:', e);
      this.isConnecting = false;
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.isConnecting = false;
      this.reconnectAttempt = 0;
      this.lastPongTime = Date.now();
      this._startHeartbeat();
      // Wait for server authentication confirmation message before showing green
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.t === 'authenticated') {
          this.isAuthenticated = true;
          this._updateStatus('connected', 'Connected');
          this._emit({ t: 'authenticated', hostName: msg.hostName });
          return;
        }

        if (msg.t === 'pong') {
          this.lastPongTime = Date.now();
          const rtt = Math.max(1, Date.now() - msg.echoTs);
          const pingEl = document.getElementById('ping-readout');
          if (pingEl) pingEl.textContent = `${rtt} ms`;
          const modalPingEl = document.getElementById('modal-pair-ping');
          if (modalPingEl) modalPingEl.textContent = `${rtt} ms`;
          return;
        }

        this._emit(msg);
      } catch (e) {}
    };

    this.ws.onclose = (event) => {
      this.isConnecting = false;
      this.isAuthenticated = false;
      this._stopHeartbeat();

      // Release all held inputs on Mac & iPhone immediately
      if (window.controllerState) {
        window.controllerState.releaseAll();
      }

      this._emit({ t: 'connection_close', code: event.code });

      // Code 4001: Session revoked by host
      if (event.code === 4001) {
        this.shouldReconnect = false;
        this._updateStatus('revoked', 'Session Revoked');
        return;
      }

      // Code 4003: Session expired
      if (event.code === 4003) {
        this.shouldReconnect = false;
        this._updateStatus('expired', 'Session Expired');
        return;
      }

      if (this.shouldReconnect) {
        this._scheduleReconnect();
      } else {
        this._updateStatus('disconnected', 'Disconnected');
      }
    };

    this.ws.onerror = () => {
      this.isConnecting = false;
    };
  }

  send(packet) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(typeof packet === 'string' ? packet : JSON.stringify(packet));
      } catch (e) {}
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    this._stopHeartbeat();
    this._clearReconnectTimer();

    if (this.ws) {
      try {
        this.ws.close(1000, 'User disconnected');
      } catch (e) {}
      this.ws = null;
    }

    this.isAuthenticated = false;
    this.isConnecting = false;
    this._updateStatus('disconnected', 'Disconnected');
  }

  _scheduleReconnect() {
    this._clearReconnectTimer();
    if (!this.shouldReconnect) return;

    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this._updateStatus('failed', 'Connection Lost');
      return;
    }

    this.reconnectAttempt++;

    // If on a serverless host like Vercel with no custom relay configured,
    // WebSockets cannot connect to Vercel edge. Notify subscribers after 2 attempts.
    const isVercel = location.host.includes('vercel.app');
    const hasRelay = !!(window.sessionClient?.getBackendUrl?.());
    if (isVercel && !hasRelay && this.reconnectAttempt >= 2) {
      this.shouldReconnect = false;
      this._updateStatus('needs_relay', 'Mac/Relay Server Needed');
      this._emit({ t: 'ws_unsupported_host', host: location.host });
      return;
    }

    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this._updateStatus('failed', 'Connection Lost');
      return;
    }

    // Exponential backoff with jitter: 1s, 2s, 4s, 8s, max 10s
    const delay = Math.min(10000, Math.pow(2, this.reconnectAttempt - 1) * 1000);
    this._updateStatus('reconnecting', `Reconnecting (${this.reconnectAttempt}/${this.maxReconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      if (this.shouldReconnect && this.sessionId && this.token) {
        this.connect(this.sessionId, this.token);
      }
    }, delay);
  }

  _clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Send ping
        this.send({ t: 'ping', echoTs: Date.now() });

        // Check if last pong was too long ago (over 7 seconds)
        if (Date.now() - this.lastPongTime > 7000) {
          console.warn('[WS] Heartbeat timeout. Reconnecting...');
          this.ws.close();
        }
      }
    }, 2500);
  }

  _stopHeartbeat() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  _updateStatus(state, label) {
    const statusText = document.getElementById('connection-status-text');
    const statusDot = document.querySelector('.status-indicator');
    if (statusText) statusText.textContent = label;

    if (statusDot) {
      statusDot.className = 'status-indicator ' + state;
    }
  }

  _emit(data) {
    for (const fn of this.subscribers) {
      try { fn(data); } catch (e) {}
    }
  }
}

window.wsClient = new WebSocketClient();
