/**
 * Antigravity Controller Engine - Full Xbox Edition
 * Independent Dual Analog Joysticks, Multi-touch Tracking, Tactile D-Pad & Action Combos
 */

class ControllerEngine {
  constructor() {
    this.state = window.controllerState;
    this.settings = window.settingsManager;

    // Left Joystick DOM
    this.leftBase = document.getElementById('joystick-left-base');
    this.leftKnob = document.getElementById('joystick-left-knob');
    this.leftTouchId = null;
    this.leftCenter = { x: 0, y: 0 };
    this.leftMaxRadius = 42;

    // Right Joystick DOM
    this.rightBase = document.getElementById('joystick-right-base');
    this.rightKnob = document.getElementById('joystick-right-knob');
    this.rightTouchId = null;
    this.rightCenter = { x: 0, y: 0 };
    this.rightMaxRadius = 42;

    // Multi-touch tracking: Map<touchIdentifier, { btn, input }>
    this.activeTouches = new Map();

    // Cache of interactive buttons
    this.buttons = document.querySelectorAll('[data-input]');

    this.init();
  }

  init() {
    this.bindTouchSuppression();
    this.bindJoysticks();
    this.bindButtons();
    this.bindWindowEvents();
    this.recomputeCenters();

    window.addEventListener('resize', () => this.recomputeCenters());
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this.recomputeCenters(), 250);
    });
  }

  recomputeCenters() {
    if (this.leftBase) {
      const rect = this.leftBase.getBoundingClientRect();
      this.leftCenter = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    }
    if (this.rightBase) {
      const rect = this.rightBase.getBoundingClientRect();
      this.rightCenter = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    }
  }

  bindTouchSuppression() {
    const prevent = (e) => {
      // Only suppress default touch behavior inside the controller screen
      // Allow normal interaction on all other screens (device select, mac host, iphone pair)
      if (!e.target.closest('#screen-controller')) {
        return;
      }
      if (e.target.closest('#modal-settings, #modal-log, #modal-pairing')) {
        return; // Allow modal interaction
      }
      e.preventDefault();
    };

    document.addEventListener('touchstart', prevent, { passive: false });
    document.addEventListener('touchmove', prevent, { passive: false });
    document.addEventListener('touchend', prevent, { passive: false });
    document.addEventListener('contextmenu', (e) => {
      if (e.target.closest('#screen-controller')) e.preventDefault();
    });
  }

  bindWindowEvents() {
    // Failsafe: release all keys when browser tab loses focus or app backgrounded
    window.addEventListener('blur', () => {
      this.state.releaseAll();
      this.resetLeftJoystick();
      this.resetRightJoystick();
      this.clearAllButtonStyles();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.state.releaseAll();
        this.resetLeftJoystick();
        this.resetRightJoystick();
        this.clearAllButtonStyles();
      }
    });
  }

  clearAllButtonStyles() {
    this.buttons.forEach(btn => {
      if (!btn.dataset.toggled) {
        btn.classList.remove('active');
      }
    });
    this.activeTouches.clear();
  }

  triggerHaptic() {
    if (this.settings.current.haptics && navigator.vibrate) {
      try {
        navigator.vibrate(10);
      } catch (e) {
        // Ignored if unsupported or non-interacted
      }
    }
  }

  /* ========================================================================
     Dual Analog Joysticks (Left Stick & Right Stick)
     ======================================================================== */
  bindJoysticks() {
    const onTouchStart = (e) => {
      const touches = e.changedTouches ? Array.from(e.changedTouches) : [e];
      for (const touch of touches) {
        const id = touch.identifier ?? 'mouse_left';

        // Check Left Joystick
        if (this.leftBase && this.leftTouchId === null) {
          this.recomputeCenters();
          const dist = Math.hypot(touch.clientX - this.leftCenter.x, touch.clientY - this.leftCenter.y);
          if (dist <= this.leftMaxRadius + 35) {
            this.leftTouchId = id;
            this.leftKnob.classList.add('active');
            this.updateLeftPosition(touch.clientX, touch.clientY);
            this.triggerHaptic();
            continue;
          }
        }

        // Check Right Joystick
        if (this.rightBase && this.rightTouchId === null) {
          this.recomputeCenters();
          const dist = Math.hypot(touch.clientX - this.rightCenter.x, touch.clientY - this.rightCenter.y);
          if (dist <= this.rightMaxRadius + 35) {
            this.rightTouchId = id;
            this.rightKnob.classList.add('active');
            this.updateRightPosition(touch.clientX, touch.clientY);
            this.triggerHaptic();
            continue;
          }
        }
      }
    };

    const onTouchMove = (e) => {
      const touches = e.changedTouches ? Array.from(e.changedTouches) : [e];
      for (const touch of touches) {
        const id = touch.identifier ?? 'mouse_left';
        if (id === this.leftTouchId) {
          this.updateLeftPosition(touch.clientX, touch.clientY);
        } else if (id === this.rightTouchId) {
          this.updateRightPosition(touch.clientX, touch.clientY);
        }
      }
    };

    const onTouchEnd = (e) => {
      const touches = e.changedTouches ? Array.from(e.changedTouches) : [e];
      for (const touch of touches) {
        const id = touch.identifier ?? 'mouse_left';
        if (id === this.leftTouchId) {
          this.resetLeftJoystick();
        } else if (id === this.rightTouchId) {
          this.resetRightJoystick();
        }
      }
    };

    // Attach to windows & bases
    if (this.leftBase) this.leftBase.addEventListener('touchstart', onTouchStart, { passive: false });
    if (this.rightBase) this.rightBase.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: false });
    window.addEventListener('touchcancel', onTouchEnd, { passive: false });

    // Desktop Mouse Fallback
    if (this.leftBase) {
      this.leftBase.addEventListener('mousedown', (e) => {
        if (e.button === 0) {
          this.recomputeCenters();
          this.leftTouchId = 'mouse_left';
          this.leftKnob.classList.add('active');
          this.updateLeftPosition(e.clientX, e.clientY);
        }
      });
    }
    if (this.rightBase) {
      this.rightBase.addEventListener('mousedown', (e) => {
        if (e.button === 0) {
          this.recomputeCenters();
          this.rightTouchId = 'mouse_right';
          this.rightKnob.classList.add('active');
          this.updateRightPosition(e.clientX, e.clientY);
        }
      });
    }

    window.addEventListener('mousemove', (e) => {
      if (this.leftTouchId === 'mouse_left') this.updateLeftPosition(e.clientX, e.clientY);
      if (this.rightTouchId === 'mouse_right') this.updateRightPosition(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', (e) => {
      if (this.leftTouchId === 'mouse_left') this.resetLeftJoystick();
      if (this.rightTouchId === 'mouse_right') this.resetRightJoystick();
    });
  }

  updateLeftPosition(clientX, clientY) {
    let dx = clientX - this.leftCenter.x;
    let dy = clientY - this.leftCenter.y;
    const distance = Math.hypot(dx, dy);

    if (distance > this.leftMaxRadius) {
      const angle = Math.atan2(dy, dx);
      dx = Math.cos(angle) * this.leftMaxRadius;
      dy = Math.sin(angle) * this.leftMaxRadius;
    }

    this.leftKnob.style.transform = `translate(${dx}px, ${dy}px)`;

    let normX = dx / this.leftMaxRadius;
    let normY = dy / this.leftMaxRadius;
    const mag = Math.hypot(normX, normY);

    const deadzone = this.settings.current.deadzoneLS ?? 0.08;
    const sensitivity = this.settings.current.sensitivityLS ?? 1.0;

    if (mag < deadzone) {
      normX = 0.0;
      normY = 0.0;
    } else {
      const rescaled = ((mag - deadzone) / (1.0 - deadzone)) * sensitivity;
      const angle = Math.atan2(normY, normX);
      normX = Math.cos(angle) * Math.min(1.0, rescaled);
      normY = Math.sin(angle) * Math.min(1.0, rescaled);
    }

    this.state.setAxes('left', normX, normY);
  }

  resetLeftJoystick() {
    this.leftTouchId = null;
    if (this.leftKnob) {
      this.leftKnob.classList.remove('active');
      this.leftKnob.style.transform = 'translate(0px, 0px)';
    }
    this.state.setAxes('left', 0.0, 0.0);
  }

  updateRightPosition(clientX, clientY) {
    let dx = clientX - this.rightCenter.x;
    let dy = clientY - this.rightCenter.y;
    const distance = Math.hypot(dx, dy);

    if (distance > this.rightMaxRadius) {
      const angle = Math.atan2(dy, dx);
      dx = Math.cos(angle) * this.rightMaxRadius;
      dy = Math.sin(angle) * this.rightMaxRadius;
    }

    this.rightKnob.style.transform = `translate(${dx}px, ${dy}px)`;

    let normX = dx / this.rightMaxRadius;
    let normY = dy / this.rightMaxRadius;
    const mag = Math.hypot(normX, normY);

    const deadzone = this.settings.current.deadzoneRS ?? 0.08;
    const sensitivity = this.settings.current.sensitivityRS ?? 1.0;

    if (mag < deadzone) {
      normX = 0.0;
      normY = 0.0;
    } else {
      const rescaled = ((mag - deadzone) / (1.0 - deadzone)) * sensitivity;
      const angle = Math.atan2(normY, normX);
      normX = Math.cos(angle) * Math.min(1.0, rescaled);
      normY = Math.sin(angle) * Math.min(1.0, rescaled);
    }

    this.state.setAxes('right', normX, normY);
  }

  resetRightJoystick() {
    this.rightTouchId = null;
    if (this.rightKnob) {
      this.rightKnob.classList.remove('active');
      this.rightKnob.style.transform = 'translate(0px, 0px)';
    }
    this.state.setAxes('right', 0.0, 0.0);
  }

  /* ========================================================================
     Button Interaction Engine: Multi-touch, Slide-over, Combos & Toggles
     ======================================================================== */
  bindButtons() {
    const handleTouchStart = (e) => {
      for (const touch of Array.from(e.changedTouches)) {
        const targetBtn = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('[data-input]');
        if (targetBtn) {
          const inputName = targetBtn.getAttribute('data-input');
          this.activeTouches.set(touch.identifier, { btn: targetBtn, input: inputName });
          this.processButtonPress(inputName, targetBtn);
          this.triggerHaptic();
        }
      }
    };

    const handleTouchMove = (e) => {
      for (const touch of Array.from(e.changedTouches)) {
        const tracked = this.activeTouches.get(touch.identifier);
        const currentTarget = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('[data-input]');

        if (tracked) {
          // If finger slid to another button or outside
          if (currentTarget !== tracked.btn) {
            this.processButtonRelease(tracked.input, tracked.btn);

            if (currentTarget) {
              // Slid onto a new button (e.g. D-Pad slide)
              const newInput = currentTarget.getAttribute('data-input');
              this.activeTouches.set(touch.identifier, { btn: currentTarget, input: newInput });
              this.processButtonPress(newInput, currentTarget);
              this.triggerHaptic();
            } else {
              this.activeTouches.delete(touch.identifier);
            }
          }
        }
      }
    };

    const handleTouchEnd = (e) => {
      for (const touch of Array.from(e.changedTouches)) {
        const tracked = this.activeTouches.get(touch.identifier);
        if (tracked) {
          this.processButtonRelease(tracked.input, tracked.btn);
          this.activeTouches.delete(touch.identifier);
        }
      }
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: false });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: false });
    document.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    // Desktop Mouse Fallback
    this.buttons.forEach(btn => {
      const inputName = btn.getAttribute('data-input');
      btn.addEventListener('mousedown', (e) => {
        if (e.button === 0) {
          e.preventDefault();
          this.processButtonPress(inputName, btn);
          this.triggerHaptic();
        }
      });

      const onMouseUp = () => {
        this.processButtonRelease(inputName, btn);
      };

      btn.addEventListener('mouseup', onMouseUp);
      btn.addEventListener('mouseleave', () => {
        if (!btn.dataset.toggled) {
          this.processButtonRelease(inputName, btn);
        }
      });
    });
  }

  processButtonPress(inputName, btn) {
    // 1. Quick Turn dedicated button
    if (inputName === 'QuickTurn') {
      btn.classList.add('active');
      this.state.setQuickTurn(true);
      return;
    }

    // 2. Run dedicated button (supports hold or toggle)
    if (inputName === 'Run') {
      if (this.settings.current.runToggle) {
        const isToggled = btn.dataset.toggled === 'true';
        if (isToggled) {
          btn.dataset.toggled = 'false';
          btn.classList.remove('active');
          this.state.setButton('L3', false);
        } else {
          btn.dataset.toggled = 'true';
          btn.classList.add('active');
          this.state.setButton('L3', true);
        }
        return;
      }
      btn.classList.add('active');
      this.state.setButton('L3', true);
      this.state.setButton('Run', true);
      return;
    }

    // 3. Aim Toggle option on LT
    if (inputName === 'LT' && this.settings.current.aimToggle) {
      const isToggled = btn.dataset.toggled === 'true';
      if (isToggled) {
        btn.dataset.toggled = 'false';
        btn.classList.remove('active');
        this.state.setButton('LT', false);
      } else {
        btn.dataset.toggled = 'true';
        btn.classList.add('active');
        this.state.setButton('LT', true);
      }
      return;
    }

    // Standard button press
    btn.classList.add('active');
    this.state.setButton(inputName, true);
  }

  processButtonRelease(inputName, btn) {
    if (inputName === 'QuickTurn') {
      btn.classList.remove('active');
      this.state.setQuickTurn(false);
      return;
    }

    if (inputName === 'Run') {
      if (this.settings.current.runToggle) return; // Managed in press
      btn.classList.remove('active');
      this.state.setButton('L3', false);
      this.state.setButton('Run', false);
      return;
    }

    if (inputName === 'LT' && this.settings.current.aimToggle) {
      return; // Managed in press
    }

    btn.classList.remove('active');
    this.state.setButton(inputName, false);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.controllerEngine = new ControllerEngine();
});
