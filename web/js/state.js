/**
 * Antigravity Gamepad State Management & Input Event Dispatcher
 * Full Xbox-Style Virtual Controller State with Dual Sticks and Combos
 */

class GamepadState {
  constructor() {
    // Ground-truth button states
    this.buttons = {
      // D-Pad
      DPadUp: false,
      DPadDown: false,
      DPadLeft: false,
      DPadRight: false,

      // Xbox Action Buttons
      A: false,
      B: false,
      X: false,
      Y: false,

      // Shoulders & Triggers (Xbox naming)
      LB: false,
      LT: false,
      RB: false,
      RT: false,

      // Stick Clicks
      L3: false,
      R3: false,

      // Center Controls
      View: false,
      Menu: false,
      Guide: false,

      // Auxiliary Action Controls
      QuickTurn: false,
      Run: false,
      ChangeWeapon: false,

      // Legacy Aliases for backward compatibility
      L1: false,
      L2: false,
      R1: false,
      R2: false,
      Select: false,
      Start: false
    };

    // Dual Analog Axes (-1.0 to +1.0)
    this.axes = {
      lx: 0.0,
      ly: 0.0,
      rx: 0.0,
      ry: 0.0
    };

    // Analog Trigger Values (0.0 to 1.0)
    this.triggers = {
      lt: 0.0,
      rt: 0.0
    };

    // Toggle states for buttons configured as toggle (e.g. Run toggle)
    this.toggleStates = {
      Run: false,
      LT: false
    };

    this.seq = 0;
    this.subscribers = [];
  }

  /**
   * Subscribe to state change events.
   * @param {Function} callback ({ event, snapshot }) => void
   */
  subscribe(callback) {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter(fn => fn !== callback);
    };
  }

  /**
   * Set button state (pressed/released) with alias mirroring and combo evaluation.
   * @param {string} buttonName
   * @param {boolean} isPressed
   */
  setButton(buttonName, isPressed) {
    // Normalize aliases
    const canonical = this._canonicalName(buttonName);
    if (this.buttons[canonical] === undefined) return;
    if (this.buttons[canonical] === isPressed) return; // No change

    this.buttons[canonical] = isPressed;
    this._syncAliases(canonical, isPressed);

    // Also update analog triggers if LT or RT and not already set
    if (canonical === 'LT' && !this._settingTrigger) this.triggers.lt = isPressed ? 1.0 : 0.0;
    if (canonical === 'RT' && !this._settingTrigger) this.triggers.rt = isPressed ? 1.0 : 0.0;

    this._dispatch({
      type: isPressed ? 'buttondown' : 'buttonup',
      button: canonical,
      isPressed: isPressed
    });

    // Check combos (e.g. L3 + B for Quick Turn)
    this._evaluateCombos();
  }

  /**
   * Toggle button mode (for buttons configured as toggle).
   * @param {string} buttonName
   */
  toggleButton(buttonName) {
    const canonical = this._canonicalName(buttonName);
    const newState = !this.buttons[canonical];
    this.toggleStates[canonical] = newState;
    this.setButton(canonical, newState);
  }

  /**
   * Update analog stick coordinates.
   * @param {'left'|'right'} stick
   * @param {number} x Normalized -1.0 to +1.0
   * @param {number} y Normalized -1.0 to +1.0
   */
  setAxes(stick, x, y) {
    // Backward compatibility: if stick is a number, treat as setAxes('left', stick, x)
    if (typeof stick === 'number') {
      y = x;
      x = stick;
      stick = 'left';
    }

    const clampedX = Math.max(-1.0, Math.min(1.0, parseFloat(x.toFixed(3))));
    const clampedY = Math.max(-1.0, Math.min(1.0, parseFloat(y.toFixed(3))));

    if (stick === 'left') {
      if (this.axes.lx === clampedX && this.axes.ly === clampedY) return;
      this.axes.lx = clampedX;
      this.axes.ly = clampedY;
    } else if (stick === 'right') {
      if (this.axes.rx === clampedX && this.axes.ry === clampedY) return;
      this.axes.rx = clampedX;
      this.axes.ry = clampedY;
    }

    this._dispatch({
      type: 'axismove',
      stick: stick,
      axes: { ...this.axes }
    });
  }

  /**
   * Update analog trigger value.
   * @param {'LT'|'RT'} trigger
   * @param {number} value Normalized 0.0 to 1.0
   */
  setTrigger(trigger, value) {
    const key = trigger.toLowerCase();
    const clamped = Math.max(0.0, Math.min(1.0, parseFloat(value.toFixed(3))));
    if (this.triggers[key] === clamped) return;

    this.triggers[key] = clamped;
    const isPressed = clamped > 0.15;
    if (this.buttons[trigger] !== isPressed) {
      this._settingTrigger = true;
      try {
        this.setButton(trigger, isPressed);
      } finally {
        this._settingTrigger = false;
      }
    }

    this._dispatch({
      type: 'triggermove',
      trigger: trigger,
      value: clamped
    });
  }

  /**
   * Evaluate multi-button combos (e.g. Quick Turn = L3 + B).
   */
  _evaluateCombos() {
    // Quick Turn combo: L3 + B
    const isQuickTurnCombo = this.buttons.L3 && this.buttons.B;
    if (isQuickTurnCombo && !this.buttons.QuickTurn) {
      this.buttons.QuickTurn = true;
      this._dispatch({
        type: 'combodown',
        combo: 'QuickTurn',
        inputs: ['L3', 'B']
      });
    } else if (!isQuickTurnCombo && this.buttons.QuickTurn && !this._manualQuickTurn) {
      this.buttons.QuickTurn = false;
      this._dispatch({
        type: 'comboup',
        combo: 'QuickTurn',
        inputs: ['L3', 'B']
      });
    }
  }

  /**
   * Trigger Quick Turn directly from its dedicated button.
   * @param {boolean} isPressed
   */
  setQuickTurn(isPressed) {
    this._manualQuickTurn = isPressed;
    this.buttons.QuickTurn = isPressed;
    // When Quick Turn button is held, also assert L3 and B
    this.buttons.L3 = isPressed;
    this.buttons.B = isPressed;
    this._syncAliases('L3', isPressed);
    this._syncAliases('B', isPressed);

    this._dispatch({
      type: isPressed ? 'combodown' : 'comboup',
      combo: 'QuickTurn',
      inputs: ['L3', 'B'],
      isPressed: isPressed
    });
  }

  /**
   * Release all held inputs immediately (failsafe/dead-man reset).
   */
  releaseAll() {
    let changed = false;
    for (const key of Object.keys(this.buttons)) {
      if (this.buttons[key]) {
        this.buttons[key] = false;
        changed = true;
      }
    }
    if (this.axes.lx !== 0.0 || this.axes.ly !== 0.0 || this.axes.rx !== 0.0 || this.axes.ry !== 0.0) {
      this.axes.lx = 0.0;
      this.axes.ly = 0.0;
      this.axes.rx = 0.0;
      this.axes.ry = 0.0;
      changed = true;
    }
    if (this.triggers.lt !== 0.0 || this.triggers.rt !== 0.0) {
      this.triggers.lt = 0.0;
      this.triggers.rt = 0.0;
      changed = true;
    }

    this._manualQuickTurn = false;

    if (changed) {
      this._dispatch({
        type: 'reset',
        reason: 'release_all'
      });
    }
  }

  /**
   * Returns an array of names of currently active buttons.
   */
  getActiveButtons() {
    return Object.keys(this.buttons).filter(k => this.buttons[k] && !['L1', 'L2', 'R1', 'R2', 'Select', 'Start'].includes(k));
  }

  /**
   * Formats current state into an outbound network packet payload.
   */
  toPacket() {
    this.seq++;
    return {
      t: 'input',
      seq: this.seq,
      ts: Date.now(),
      b: { ...this.buttons },
      a: { ...this.axes },
      trig: { ...this.triggers }
    };
  }

  _canonicalName(name) {
    const aliasMap = {
      'L1': 'LB',
      'L2': 'LT',
      'R1': 'RB',
      'R2': 'RT',
      'Select': 'View',
      'Start': 'Menu'
    };
    return aliasMap[name] || name;
  }

  _syncAliases(canonical, isPressed) {
    const reverseMap = {
      'LB': 'L1',
      'LT': 'L2',
      'RB': 'R1',
      'RT': 'R2',
      'View': 'Select',
      'Menu': 'Start'
    };
    const alias = reverseMap[canonical];
    if (alias) {
      this.buttons[alias] = isPressed;
    }
  }

  _dispatch(eventDetail) {
    const packet = this.toPacket();
    const payload = {
      event: eventDetail,
      snapshot: packet
    };
    for (const fn of this.subscribers) {
      try {
        fn(payload);
      } catch (err) {
        console.error('State subscriber error:', err);
      }
    }
  }
}

// Export singleton
window.controllerState = new GamepadState();
