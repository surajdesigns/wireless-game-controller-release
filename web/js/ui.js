/**
 * UI Controller, HUD Visualizer, Modals & Xbox Controller Settings
 */

class GamepadUI {
  constructor() {
    this.state = window.controllerState;
    this.settings = window.settingsManager;

    // HUD Elements
    this.hudLS = document.getElementById('hud-ls');
    this.hudRS = document.getElementById('hud-rs');
    this.hudButtons = document.getElementById('hud-buttons');
    this.logOutput = document.getElementById('log-output');

    // Modals
    this.modalLog = document.getElementById('modal-log');
    this.modalSettings = document.getElementById('modal-settings');
    this.modalPairing = document.getElementById('modal-pairing');

    this.logLines = [];
    this.maxLogLines = 80;

    this.init();
  }

  init() {
    this.applySettingsToDOM();
    this.bindHUD();
    this.bindModals();
    this.bindSettingsForm();
    this.bindSimulationTools();
    this.bindFullscreen();
  }

  applySettingsToDOM() {
    const s = this.settings.current;
    if (s.uiScale) {
      document.documentElement.style.setProperty('--controller-scale', s.uiScale);
    }
    if (s.showLabels === false) {
      document.body.classList.add('hide-callouts');
    } else {
      document.body.classList.remove('hide-callouts');
    }
  }

  bindHUD() {
    this.state.subscribe(({ event, snapshot }) => {
      // 1. Update Active Buttons
      const active = this.state.getActiveButtons();
      if (this.hudButtons) {
        this.hudButtons.textContent = active.length > 0 ? active.join(', ') : 'None';
      }

      // 2. Update Left Stick & Right Stick Coordinates
      if (this.hudLS) {
        const lxStr = (snapshot.a.lx >= 0 ? '+' : '') + snapshot.a.lx.toFixed(2);
        const lyStr = (snapshot.a.ly >= 0 ? '+' : '') + snapshot.a.ly.toFixed(2);
        this.hudLS.textContent = `X: ${lxStr} Y: ${lyStr}`;
      }

      if (this.hudRS) {
        const rxStr = (snapshot.a.rx >= 0 ? '+' : '') + snapshot.a.rx.toFixed(2);
        const ryStr = (snapshot.a.ry >= 0 ? '+' : '') + snapshot.a.ry.toFixed(2);
        this.hudRS.textContent = `X: ${rxStr} Y: ${ryStr}`;
      }

      // 3. Append to Event Log
      this.appendLog(event, snapshot);
    });
  }

  appendLog(event, snapshot) {
    if (!this.logOutput) return;

    const time = new Date(snapshot.ts).toISOString().substr(14, 9);
    let summary = '';

    if (event.type === 'buttondown' || event.type === 'buttonup') {
      const mappedKey = this.settings.getMapping(event.button);
      const actionDesc = this.settings.getActionLabel(event.button);
      summary = `[${time}] ${event.type.toUpperCase()}: ${event.button} (${actionDesc}) -> Key: [${mappedKey}]`;
    } else if (event.type === 'axismove') {
      summary = `[${time}] AXIS_MOVE (${event.stick.toUpperCase()}): lx=${snapshot.a.lx.toFixed(2)} ly=${snapshot.a.ly.toFixed(2)} rx=${snapshot.a.rx.toFixed(2)} ry=${snapshot.a.ry.toFixed(2)}`;
    } else if (event.type === 'combodown' || event.type === 'comboup') {
      summary = `[${time}] COMBO_${event.type === 'combodown' ? 'ACTIVATED' : 'RELEASED'}: ${event.combo} (${event.inputs.join(' + ')})`;
    } else if (event.type === 'triggermove') {
      summary = `[${time}] TRIGGER: ${event.trigger} = ${event.value.toFixed(2)}`;
    } else if (event.type === 'reset') {
      summary = `[${time}] RESET_ALL: Released held inputs (dead-man switch)`;
    }

    this.logLines.unshift(summary);
    if (this.logLines.length > this.maxLogLines) {
      this.logLines.pop();
    }

    this.logOutput.textContent = this.logLines.join('\n');
  }

  bindModals() {
    // Open modal triggers
    document.getElementById('btn-open-log')?.addEventListener('click', () => {
      this.modalLog?.classList.remove('hidden');
    });
    document.getElementById('btn-open-settings')?.addEventListener('click', () => {
      this.renderSettingsValues();
      this.modalSettings?.classList.remove('hidden');
    });
    document.getElementById('btn-open-pairing')?.addEventListener('click', () => {
      this.modalPairing?.classList.remove('hidden');
    });

    // Close modal triggers
    document.getElementById('btn-close-log')?.addEventListener('click', () => {
      this.modalLog?.classList.add('hidden');
    });
    document.getElementById('btn-close-settings')?.addEventListener('click', () => {
      this.modalSettings?.classList.add('hidden');
    });
    document.getElementById('btn-close-pairing')?.addEventListener('click', () => {
      this.modalPairing?.classList.add('hidden');
    });

    // Backdrop tap closes
    [this.modalLog, this.modalSettings, this.modalPairing].forEach(modal => {
      modal?.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
      });
    });
  }

  renderSettingsValues() {
    const s = this.settings.current;

    // Sliders
    this._setVal('setting-deadzone-ls', 'val-deadzone-ls', s.deadzoneLS);
    this._setVal('setting-sens-ls', 'val-sens-ls', s.sensitivityLS);
    this._setVal('setting-deadzone-rs', 'val-deadzone-rs', s.deadzoneRS);
    this._setVal('setting-sens-rs', 'val-sens-rs', s.sensitivityRS);

    const scaleInput = document.getElementById('setting-ui-scale');
    const scaleVal = document.getElementById('val-ui-scale');
    if (scaleInput && scaleVal) {
      scaleInput.value = s.uiScale ?? 1.0;
      scaleVal.textContent = `${Math.round((s.uiScale ?? 1.0) * 100)}%`;
    }

    // Checkboxes
    const showLabels = document.getElementById('setting-show-labels');
    if (showLabels) showLabels.checked = s.showLabels !== false;

    const runToggle = document.getElementById('setting-run-toggle');
    if (runToggle) runToggle.checked = !!s.runToggle;

    const aimToggle = document.getElementById('setting-aim-toggle');
    if (aimToggle) aimToggle.checked = !!s.aimToggle;

    const haptics = document.getElementById('setting-haptics');
    if (haptics) haptics.checked = s.haptics !== false;

    // Render Mappings Table
    const table = document.getElementById('mapping-grid');
    if (table) {
      table.innerHTML = '';
      const order = [
        'LT', 'RT', 'LB', 'RB',
        'A', 'B', 'X', 'Y',
        'L3', 'R3', 'QuickTurn', 'Run', 'ChangeWeapon',
        'View', 'Menu', 'Guide',
        'DPadUp', 'DPadDown', 'DPadLeft', 'DPadRight'
      ];

      for (const btn of order) {
        const key = s.mappings[btn] || btn;
        const desc = s.actionLabels[btn] || '';
        const row = document.createElement('div');
        row.className = 'mapping-row';
        row.innerHTML = `
          <div class="map-name-group">
            <span class="map-button-name">${btn}</span>
            <span class="map-action-desc">${desc}</span>
          </div>
          <input type="text" class="map-key-input" data-map-btn="${btn}" value="${key}" maxlength="18">
        `;
        table.appendChild(row);
      }
    }
  }

  _setVal(inputId, labelId, val) {
    const input = document.getElementById(inputId);
    const label = document.getElementById(labelId);
    if (input) input.value = val;
    if (label) label.textContent = val;
  }

  bindSettingsForm() {
    // Dynamic slider labels
    const bindLiveLabel = (inputId, labelId, suffix = '') => {
      const inp = document.getElementById(inputId);
      const lbl = document.getElementById(labelId);
      inp?.addEventListener('input', (e) => {
        lbl.textContent = e.target.value + suffix;
      });
    };

    bindLiveLabel('setting-deadzone-ls', 'val-deadzone-ls');
    bindLiveLabel('setting-sens-ls', 'val-sens-ls');
    bindLiveLabel('setting-deadzone-rs', 'val-deadzone-rs');
    bindLiveLabel('setting-sens-rs', 'val-sens-rs');

    document.getElementById('setting-ui-scale')?.addEventListener('input', (e) => {
      const pct = Math.round(parseFloat(e.target.value) * 100);
      document.getElementById('val-ui-scale').textContent = `${pct}%`;
    });

    // Save Settings
    document.getElementById('btn-save-settings')?.addEventListener('click', () => {
      const deadzoneLS = parseFloat(document.getElementById('setting-deadzone-ls')?.value || 0.08);
      const sensitivityLS = parseFloat(document.getElementById('setting-sens-ls')?.value || 1.0);
      const deadzoneRS = parseFloat(document.getElementById('setting-deadzone-rs')?.value || 0.08);
      const sensitivityRS = parseFloat(document.getElementById('setting-sens-rs')?.value || 1.0);
      const uiScale = parseFloat(document.getElementById('setting-ui-scale')?.value || 1.0);

      const showLabels = document.getElementById('setting-show-labels')?.checked;
      const runToggle = document.getElementById('setting-run-toggle')?.checked;
      const aimToggle = document.getElementById('setting-aim-toggle')?.checked;
      const haptics = document.getElementById('setting-haptics')?.checked;

      const newMappings = {};
      document.querySelectorAll('[data-map-btn]').forEach(inp => {
        const btn = inp.getAttribute('data-map-btn');
        newMappings[btn] = inp.value.trim() || btn;
      });

      this.settings.save({
        deadzoneLS,
        sensitivityLS,
        deadzoneRS,
        sensitivityRS,
        uiScale,
        showLabels,
        runToggle,
        aimToggle,
        haptics,
        mappings: newMappings
      });

      this.applySettingsToDOM();
      this.modalSettings?.classList.add('hidden');
    });

    // Reset Defaults
    document.getElementById('btn-reset-settings')?.addEventListener('click', () => {
      this.settings.reset();
      this.applySettingsToDOM();
      this.renderSettingsValues();
    });
  }

  bindSimulationTools() {
    // Clear Event Log
    document.getElementById('btn-clear-log')?.addEventListener('click', () => {
      this.logLines = [];
      this.logOutput.textContent = 'Event log cleared.';
    });

    // Test Quick Turn (L3 + B combo)
    document.getElementById('btn-test-quickturn')?.addEventListener('click', () => {
      this.state.setQuickTurn(true);
      setTimeout(() => {
        this.state.setQuickTurn(false);
      }, 500);
    });

    // Test Dual Stick Sweeps simultaneously
    document.getElementById('btn-test-dualstick')?.addEventListener('click', () => {
      let angle = 0;
      const interval = setInterval(() => {
        angle += 0.25;
        const lx = Math.cos(angle);
        const ly = Math.sin(angle);
        const rx = -Math.cos(angle);
        const ry = Math.sin(angle);

        this.state.setAxes('left', lx, ly);
        this.state.setAxes('right', rx, ry);

        if (angle >= Math.PI * 2) {
          clearInterval(interval);
          this.state.setAxes('left', 0.0, 0.0);
          this.state.setAxes('right', 0.0, 0.0);
        }
      }, 40);
    });

    // Test Triggers (LT + RT)
    document.getElementById('btn-test-triggers')?.addEventListener('click', () => {
      this.state.setTrigger('LT', 1.0);
      this.state.setTrigger('RT', 1.0);
      setTimeout(() => {
        this.state.setTrigger('LT', 0.0);
        this.state.setTrigger('RT', 0.0);
      }, 600);
    });
  }

  bindFullscreen() {
    const btn = document.getElementById('btn-fullscreen');
    btn?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.gamepadUI = new GamepadUI();
});
