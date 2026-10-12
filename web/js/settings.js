/**
 * Controller Settings & Key Mappings
 * Supports complete Xbox mapping matching the reference gameplay profile.
 */

const DEFAULT_SETTINGS = {
  // Joystick Calibration
  deadzoneLS: 0.08,
  deadzoneRS: 0.08,
  sensitivityLS: 1.0,
  sensitivityRS: 1.0,
  
  // UI & Feedback
  uiScale: 1.0,
  haptics: true,
  showLabels: true,
  runToggle: false,
  aimToggle: false,

  // Reference Screenshot Action Labels (editable)
  actionLabels: {
    LT: 'Aim',
    RT: 'Attack',
    LB: 'Guard',
    RB: 'Use recovery items',
    A: 'Examine / Pick up item',
    B: 'None / Optional',
    X: 'Reload',
    Y: 'Open Inventory',
    LS: 'Move',
    L3: 'Run',
    RS: 'View / Look',
    R3: 'Crouch / Stand',
    View: 'Open Map / Journal',
    Menu: 'Pause',
    Guide: 'Guide (Optional)',
    QuickTurn: 'Quick Turn (L3 + B)',
    Run: 'Run (L3)',
    ChangeWeapon: 'Change Weapon'
  },

  // Mac Keyboard Key Mappings
  mappings: {
    // Triggers & Bumpers
    LT: 'KeyZ',
    RT: 'KeyF',
    LB: 'ShiftLeft',
    RB: 'KeyR',

    // Action Diamond
    A: 'Space',
    B: 'ControlLeft',
    X: 'KeyE',
    Y: 'KeyQ',

    // Stick Clicks
    L3: 'KeyC',
    R3: 'KeyV',

    // Center Controls
    View: 'Tab',
    Menu: 'Escape',
    Guide: 'F1',

    // D-Pad
    DPadUp: 'KeyW',
    DPadDown: 'KeyS',
    DPadLeft: 'KeyA',
    DPadRight: 'KeyD',

    // Auxiliary Action Buttons
    QuickTurn: 'KeyT',
    Run: 'KeyC',
    ChangeWeapon: 'KeyX',

    // Backward compatibility aliases
    L1: 'ShiftLeft',
    L2: 'KeyZ',
    R1: 'KeyR',
    R2: 'KeyF',
    Select: 'Tab',
    Start: 'Escape'
  }
};

class SettingsManager {
  constructor() {
    this.storageKey = 'antigravity_controller_xbox_settings_v2';
    this.current = this.load();
  }

  load() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          mappings: { ...DEFAULT_SETTINGS.mappings, ...(parsed.mappings || {}) },
          actionLabels: { ...DEFAULT_SETTINGS.actionLabels, ...(parsed.actionLabels || {}) }
        };
      }
    } catch (e) {
      console.warn('Failed to load settings from localStorage:', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  save(newSettings) {
    this.current = {
      ...this.current,
      ...newSettings,
      mappings: { ...this.current.mappings, ...(newSettings.mappings || {}) },
      actionLabels: { ...this.current.actionLabels, ...(newSettings.actionLabels || {}) }
    };
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.current));
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  }

  reset() {
    this.current = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    try {
      localStorage.removeItem(this.storageKey);
    } catch (e) {
      console.error('Failed to reset settings:', e);
    }
    return this.current;
  }

  getMapping(button) {
    return this.current.mappings[button] || button;
  }

  getActionLabel(button) {
    return this.current.actionLabels[button] || '';
  }
}

window.settingsManager = new SettingsManager();
