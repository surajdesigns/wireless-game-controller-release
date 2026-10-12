/**
 * Main Application Router & Flow Orchestrator
 * Manages Screen 1 (Device Select), Screen 2 (Mac Host), Screen 3 (iPhone Pair), Screen 4 (Gamepad)
 * Implements robust error recovery, persistent session resumption, and real-time input relay.
 */

class AppRouter {
  constructor() {
    this.session = window.sessionClient;
    this.ws = window.wsClient;
    this.scanner = window.qrScanner;

    // Screens
    this.screenSelect = document.getElementById('screen-device-select');
    this.screenMacHost = document.getElementById('screen-mac-host');
    this.screenIphonePair = document.getElementById('screen-iphone-pair');
    this.screenController = document.getElementById('screen-controller');

    this.timerInterval = null;
    this.init();
  }

  init() {
    this.bindDeviceSelection();
    this.bindMacHost();
    this.bindIphonePairing();
    this.bindControllerHeaderActions();
    this.bindCodeCopy();
    this.checkInitialURLParams();

    // Hook state changes to WebSocket transmission
    if (window.controllerState && this.ws) {
      window.controllerState.subscribe(({ snapshot }) => {
        if (this.ws.isAuthenticated) {
          this.ws.send(snapshot);
        }
      });
    }
  }

  showScreen(screen) {
    [this.screenSelect, this.screenMacHost, this.screenIphonePair, this.screenController].forEach(s => {
      if (s) {
        s.classList.add('hidden');
        s.classList.remove('active-screen');
      }
    });

    if (screen) {
      screen.classList.remove('hidden');
      screen.classList.add('active-screen');
      if (screen === this.screenController && window.controllerEngine) {
        setTimeout(() => window.controllerEngine.recomputeCenters(), 50);
      }
    }
  }

  async checkInitialURLParams() {
    const params = new URLSearchParams(window.location.search);
    const pairToken = params.get('pair');
    const code = params.get('code');

    // 1. Check direct pair URL from QR Code
    if (pairToken || code) {
      this.showScreen(this.screenIphonePair);
      if (code) {
        const inp = document.getElementById('iphone-code-input');
        if (inp) inp.value = code;
      }
      this.attemptIphoneJoin({ pairToken, code });
      return;
    }

    // 2. Check saved session resumption
    if (this.session.sessionId && this.session.clientToken) {
      try {
        const status = await this.session.fetchStatus();
        if (status && status.status === 'connected') {
          // Resume controller session
          this.showScreen(this.screenController);
          this.ws.connect(this.session.sessionId, this.session.clientToken);
          return;
        }
      } catch (e) {
        this.session.clearSession();
      }
    }

    // Default to Screen 1
    this.showScreen(this.screenSelect);
  }

  /* ========================================================================
     Screen 1: Device Selection
     ======================================================================== */
  bindDeviceSelection() {
    document.getElementById('btn-select-mac')?.addEventListener('click', () => {
      this.startMacHostFlow();
    });

    document.getElementById('btn-select-iphone')?.addEventListener('click', () => {
      this.showScreen(this.screenIphonePair);
      this.checkCameraPrerequisites();
    });
  }

  /* ========================================================================
     Screen 2: Mac Host Dashboard
     ======================================================================== */
  async startMacHostFlow() {
    this.showScreen(this.screenMacHost);

    const statusText = document.getElementById('mac-host-status');
    const codeEl = document.getElementById('mac-session-code');
    const qrContainer = document.getElementById('mac-qr-container');

    if (statusText) {
      statusText.textContent = 'Generating pairing session...';
      statusText.className = 'status-pill-sub';
    }
    if (codeEl) codeEl.textContent = '--- ---';
    if (qrContainer) {
      qrContainer.innerHTML = '<div class="qr-loading-box"><span class="spinner-circle"></span><span>Generating QR Code...</span></div>';
    }

    try {
      const data = await this.session.createHostSession('MacBook Pro');

      // 1. Display Real Pairing Code
      if (codeEl) {
        codeEl.textContent = data.code;
      }

      // 2. Render Real QR Code (Client-Side SVG with Server Fallback)
      if (qrContainer) {
        this.renderQRCode(qrContainer, data.pairUrl);
      }

      // 3. Start Expiration Countdown Timer
      this.startCountdown(data.expiresAt);

      // 4. Connect Authenticated Host WebSocket
      this.ws.connect(data.sessionId, data.hostToken);

      // 5. Listen for WebSocket peer events
      this.ws.onMessage((msg) => {
        if (msg.t === 'peer_connected') {
          const peerEl = document.getElementById('mac-peer-status');
          if (peerEl) {
            peerEl.textContent = '🟢 iPhone Connected';
            peerEl.className = 'status-tag connected';
          }
        } else if (msg.t === 'peer_disconnected') {
          const peerEl = document.getElementById('mac-peer-status');
          if (peerEl) {
            peerEl.textContent = '🟡 Awaiting Connection';
            peerEl.className = 'status-tag waiting';
          }
        }
      });

      // 6. Polling session status backup
      this.session.startStatusPolling((status) => {
        if (status.status === 'connected') {
          const peerEl = document.getElementById('mac-peer-status');
          if (peerEl) {
            peerEl.textContent = `🟢 ${status.clientDevice || 'iPhone'} Connected`;
            peerEl.className = 'status-tag connected';
          }
        }
      });

      if (statusText) {
        statusText.textContent = 'Pairing session active';
        statusText.className = 'status-pill-sub ready';
      }

    } catch (err) {
      console.error('Failed to create host session:', err);
      if (statusText) {
        statusText.textContent = err.message || 'Connection Error';
        statusText.className = 'status-pill-sub error';
      }
      if (qrContainer) {
        qrContainer.innerHTML = `
          <div class="qr-error-box">
            <span class="qr-error-icon">⚠️</span>
            <p>${err.message}</p>
            <button class="btn-primary btn-sm" onclick="appRouter.startMacHostFlow()">Retry</button>
          </div>
        `;
      }
    }
  }

  renderQRCode(container, url) {
    try {
      if (window.generateQRCodeSVG) {
        container.innerHTML = window.generateQRCodeSVG(url, {
          color: '#00f0ff',
          margin: 1
        });
        return;
      }
    } catch (e) {
      console.warn('Client QR generator fallback to server image:', e);
    }

    // Fallback: load SVG dynamically from server endpoint
    const img = new Image();
    img.src = `/api/session/qr?text=${encodeURIComponent(url)}`;
    img.alt = 'Mac Pairing QR Code';
    img.className = 'qr-img-loaded';
    container.innerHTML = '';
    container.appendChild(img);
  }

  bindMacHost() {
    document.getElementById('btn-mac-back')?.addEventListener('click', async () => {
      await this.session.revokeHostSession();
      this.ws.disconnect();
      this.stopCountdown();
      this.showScreen(this.screenSelect);
    });

    document.getElementById('btn-mac-revoke')?.addEventListener('click', async () => {
      await this.session.revokeHostSession();
      this.ws.disconnect();
      this.stopCountdown();
      const peerEl = document.getElementById('mac-peer-status');
      if (peerEl) {
        peerEl.textContent = '🔴 Session Revoked';
        peerEl.className = 'status-tag revoked';
      }
      const statusText = document.getElementById('mac-host-status');
      if (statusText) statusText.textContent = 'Session revoked by user';
    });

    document.getElementById('btn-mac-regen')?.addEventListener('click', () => {
      this.stopCountdown();
      this.startMacHostFlow();
    });
  }

  bindCodeCopy() {
    const codeBox = document.querySelector('.code-number-box');
    codeBox?.addEventListener('click', () => {
      const code = document.getElementById('mac-session-code')?.textContent.trim();
      if (code && code !== '--- ---') {
        navigator.clipboard?.writeText(code.replace('-', '')).then(() => {
          const hint = document.querySelector('.code-hint');
          if (hint) {
            const old = hint.textContent;
            hint.textContent = '✓ Pairing code copied to clipboard!';
            setTimeout(() => hint.textContent = old, 2500);
          }
        }).catch(() => {});
      }
    });
  }

  startCountdown(expiresAt) {
    this.stopCountdown();
    const update = () => {
      const remainingMs = expiresAt - Date.now();
      const timerEl = document.getElementById('mac-timer-countdown');
      if (remainingMs <= 0) {
        if (timerEl) timerEl.textContent = '00:00 (Expired)';
        const peerEl = document.getElementById('mac-peer-status');
        if (peerEl) {
          peerEl.textContent = '🔴 Session Expired';
          peerEl.className = 'status-tag expired';
        }
        this.stopCountdown();
        return;
      }
      const mins = Math.floor(remainingMs / 60000).toString().padStart(2, '0');
      const secs = Math.floor((remainingMs % 60000) / 1000).toString().padStart(2, '0');
      if (timerEl) timerEl.textContent = `${mins}:${secs}`;
    };
    update();
    this.timerInterval = setInterval(update, 1000);
  }

  stopCountdown() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  /* ========================================================================
     Screen 3: iPhone Mobile Pairing Flow
     ======================================================================== */
  checkCameraPrerequisites() {
    const noteEl = document.querySelector('.camera-security-notice');
    if (!noteEl) return;

    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      noteEl.classList.remove('hidden');
      noteEl.textContent = 'ℹ️ Note: iPhone Safari blocks camera access over plain HTTP. Use the manual 6-character code below, or use HTTPS.';
    } else {
      noteEl.classList.add('hidden');
    }
  }

  bindIphonePairing() {
    const errorEl = document.getElementById('iphone-error-msg');
    const inputEl = document.getElementById('iphone-code-input');
    const submitBtn = document.getElementById('btn-submit-code');

    document.getElementById('btn-iphone-back')?.addEventListener('click', () => {
      this.scanner.stopScan();
      this.showScreen(this.screenSelect);
    });

    // Auto-format code as XXX-XXX
    inputEl?.addEventListener('input', (e) => {
      let val = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (val.length > 3) {
        val = `${val.slice(0, 3)}-${val.slice(3, 6)}`;
      }
      e.target.value = val;
      if (errorEl) errorEl.classList.add('hidden');
    });

    // Enter key submits
    inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        submitBtn?.click();
      }
    });

    // Submit manual code
    submitBtn?.addEventListener('click', () => {
      const code = inputEl?.value.trim().replace(/[^A-Za-z0-9]/g, '');
      if (!code || code.length < 6) {
        if (errorEl) {
          errorEl.textContent = 'Please enter the complete 6-character code (e.g. 7KX-924)';
          errorEl.classList.remove('hidden');
        }
        inputEl?.focus();
        return;
      }
      this.attemptIphoneJoin({ code });
    });

    // Open Camera Scanner
    const camModal = document.getElementById('modal-camera-scanner');
    document.getElementById('btn-open-camera-scanner')?.addEventListener('click', () => {
      if (camModal) camModal.classList.remove('hidden');
      const video = document.getElementById('camera-preview-video');
      this.scanner.startScan(
        video,
        (detectedUrl) => {
          if (camModal) camModal.classList.add('hidden');
          try {
            const url = new URL(detectedUrl);
            const pairToken = url.searchParams.get('pair');
            const code = url.searchParams.get('code');
            this.attemptIphoneJoin({ pairToken, code });
          } catch (e) {
            this.attemptIphoneJoin({ code: detectedUrl });
          }
        },
        (err) => {
          if (camModal) camModal.classList.add('hidden');
          if (errorEl) {
            errorEl.textContent = err.message;
            errorEl.classList.remove('hidden');
          }
          inputEl?.focus();
        }
      );
    });

    document.getElementById('btn-close-scanner')?.addEventListener('click', () => {
      this.scanner.stopScan();
      if (camModal) camModal.classList.add('hidden');
    });
  }

  async attemptIphoneJoin(params) {
    const errorEl = document.getElementById('iphone-error-msg');
    const loadingEl = document.getElementById('iphone-pairing-spinner');
    const submitBtn = document.getElementById('btn-submit-code');

    if (errorEl) errorEl.classList.add('hidden');
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const data = await this.session.joinSession({
        ...params,
        clientDevice: 'iPhone (Safari)'
      });

      // Connect Authenticated WebSocket
      this.ws.connect(data.sessionId, data.clientToken);

      // Smooth transition to Xbox gamepad
      setTimeout(() => {
        if (loadingEl) loadingEl.classList.add('hidden');
        if (submitBtn) submitBtn.disabled = false;
        this.showScreen(this.screenController);

        const hostNameEl = document.querySelector('.device-name');
        if (hostNameEl) hostNameEl.textContent = data.hostName || 'MacBook Pro';
      }, 350);

    } catch (err) {
      if (loadingEl) loadingEl.classList.add('hidden');
      if (submitBtn) submitBtn.disabled = false;
      if (errorEl) {
        errorEl.textContent = err.message || 'Pairing failed. Please check your code.';
        errorEl.classList.remove('hidden');
      }
    }
  }

  bindControllerHeaderActions() {
    const handleDisconnect = () => {
      this.ws.disconnect();
      this.session.clearSession();
      document.getElementById('modal-pairing')?.classList.add('hidden');
      this.showScreen(this.screenSelect);
    };

    document.getElementById('btn-controller-disconnect')?.addEventListener('click', handleDisconnect);
    document.getElementById('btn-modal-disconnect')?.addEventListener('click', handleDisconnect);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.appRouter = new AppRouter();
});
