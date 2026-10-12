/**
 * Automated Unit Test Suite for Xbox-Style Gamepad State Machine & Settings
 */

const assert = require('assert');

// Mock window and localStorage
global.window = {};
global.localStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = v; },
  removeItem(k) { delete this.store[k]; }
};

// Load state and settings modules
require('../web/js/state.js');
require('../web/js/settings.js');

const state = window.controllerState;
const settings = window.settingsManager;

console.log('====================================================');
console.log('   RUNNING XBOX CONTROLLER STATE & COMBO TESTS      ');
console.log('====================================================');

// 1. Initial State Verification
assert.strictEqual(state.buttons.A, false);
assert.strictEqual(state.buttons.B, false);
assert.strictEqual(state.buttons.X, false);
assert.strictEqual(state.buttons.Y, false);
assert.strictEqual(state.buttons.LB, false);
assert.strictEqual(state.buttons.LT, false);
assert.strictEqual(state.buttons.RB, false);
assert.strictEqual(state.buttons.RT, false);
assert.strictEqual(state.buttons.L3, false);
assert.strictEqual(state.buttons.R3, false);
assert.strictEqual(state.buttons.View, false);
assert.strictEqual(state.buttons.Menu, false);
assert.strictEqual(state.buttons.Guide, false);
assert.strictEqual(state.axes.lx, 0.0);
assert.strictEqual(state.axes.ly, 0.0);
assert.strictEqual(state.axes.rx, 0.0);
assert.strictEqual(state.axes.ry, 0.0);
assert.strictEqual(state.triggers.lt, 0.0);
assert.strictEqual(state.triggers.rt, 0.0);
console.log('✓ 1. Neutral initial state verified for all dual sticks and buttons');

// 2. Dual Analog Stick Normalization & Tracking
let lastEvent = null;
state.subscribe((payload) => {
  lastEvent = payload;
});

// Left Stick movement
state.setAxes('left', 0.85, -0.42);
assert.strictEqual(state.axes.lx, 0.85);
assert.strictEqual(state.axes.ly, -0.42);
assert.strictEqual(lastEvent.event.type, 'axismove');
assert.strictEqual(lastEvent.event.stick, 'left');

// Right Stick movement (independent)
state.setAxes('right', -0.65, 0.95);
assert.strictEqual(state.axes.rx, -0.65);
assert.strictEqual(state.axes.ry, 0.95);
assert.strictEqual(state.axes.lx, 0.85, 'Right stick must not corrupt left stick coordinates');
assert.strictEqual(lastEvent.event.type, 'axismove');
assert.strictEqual(lastEvent.event.stick, 'right');

// Clamp bounds check
state.setAxes('left', 2.5, -3.0);
assert.strictEqual(state.axes.lx, 1.0, 'Values over +1.0 must be clamped');
assert.strictEqual(state.axes.ly, -1.0, 'Values under -1.0 must be clamped');
console.log('✓ 2. Dual analog sticks normalization and independent tracking verified');

// 3. Button Press & Release with Backward Compatibility Aliases
state.setButton('LB', true);
assert.strictEqual(state.buttons.LB, true);
assert.strictEqual(state.buttons.L1, true, 'LB must sync with legacy L1 alias');
assert.strictEqual(lastEvent.event.type, 'buttondown');
assert.strictEqual(lastEvent.event.button, 'LB');

state.setButton('LB', false);
assert.strictEqual(state.buttons.LB, false);
assert.strictEqual(state.buttons.L1, false);
assert.strictEqual(lastEvent.event.type, 'buttonup');
console.log('✓ 3. Xbox button event dispatch and backward compatibility aliases verified');

// 4. Analog Trigger Support
state.setTrigger('LT', 0.85);
assert.strictEqual(state.triggers.lt, 0.85);
assert.strictEqual(state.buttons.LT, true, 'Trigger over threshold must flag LT button as pressed');
assert.strictEqual(lastEvent.event.type, 'triggermove');

state.setTrigger('LT', 0.0);
assert.strictEqual(state.triggers.lt, 0.0);
assert.strictEqual(state.buttons.LT, false);
console.log('✓ 4. Analog trigger value tracking verified');

// 5. Quick Turn Combo Logic (L3 + B)
let comboEvents = [];
state.subscribe((payload) => {
  if (payload.event.type === 'combodown' || payload.event.type === 'comboup') {
    comboEvents.push(payload.event);
  }
});

// Pressing only L3 must NOT trigger combo
state.setButton('L3', true);
assert.strictEqual(state.buttons.QuickTurn, false, 'Pressing only L3 must NOT activate Quick Turn');
assert.strictEqual(comboEvents.length, 0);

// Pressing B while L3 is held MUST trigger combo!
state.setButton('B', true);
assert.strictEqual(state.buttons.QuickTurn, true, 'Simultaneous L3 + B must activate Quick Turn');
assert.strictEqual(comboEvents.length, 1);
assert.strictEqual(comboEvents[0].type, 'combodown');
assert.strictEqual(comboEvents[0].combo, 'QuickTurn');

// Releasing B must release combo
state.setButton('B', false);
assert.strictEqual(state.buttons.QuickTurn, false, 'Releasing B must deactivate Quick Turn');
assert.strictEqual(comboEvents.length, 2);
assert.strictEqual(comboEvents[1].type, 'comboup');

// Clean up
state.setButton('L3', false);
console.log('✓ 5. Quick Turn combo (L3 + B) precision detection verified without false triggers');

// 6. Dedicated Quick Turn Button Test
state.setQuickTurn(true);
assert.strictEqual(state.buttons.QuickTurn, true);
assert.strictEqual(state.buttons.L3, true);
assert.strictEqual(state.buttons.B, true);

state.setQuickTurn(false);
assert.strictEqual(state.buttons.QuickTurn, false);
console.log('✓ 6. Dedicated Quick Turn button verified');

// 7. Dead-Man Switch / Failsafe releaseAll()
state.setButton('A', true);
state.setButton('Y', true);
state.setButton('RB', true);
state.setAxes('left', 0.5, 0.5);
state.setAxes('right', -0.5, -0.5);
state.setTrigger('RT', 1.0);

assert.ok(state.getActiveButtons().length >= 3);

state.releaseAll();
assert.strictEqual(state.getActiveButtons().length, 0, 'All buttons must be released');
assert.strictEqual(state.axes.lx, 0.0, 'Left stick X must be 0.0');
assert.strictEqual(state.axes.ly, 0.0, 'Left stick Y must be 0.0');
assert.strictEqual(state.axes.rx, 0.0, 'Right stick X must be 0.0');
assert.strictEqual(state.axes.ry, 0.0, 'Right stick Y must be 0.0');
assert.strictEqual(state.triggers.lt, 0.0);
assert.strictEqual(state.triggers.rt, 0.0);
console.log('✓ 7. Complete dead-man failsafe reset verified across all dual sticks and triggers');

// 8. Settings & Reference Screenshot Game Mappings
assert.strictEqual(settings.getMapping('LT'), 'KeyZ', 'Aim -> LT -> KeyZ');
assert.strictEqual(settings.getMapping('RT'), 'KeyF', 'Attack -> RT -> KeyF');
assert.strictEqual(settings.getMapping('LB'), 'ShiftLeft', 'Guard -> LB -> ShiftLeft');
assert.strictEqual(settings.getMapping('RB'), 'KeyR', 'Use recovery items -> RB -> KeyR');
assert.strictEqual(settings.getMapping('A'), 'Space', 'Examine / Pick up item -> A -> Space');
assert.strictEqual(settings.getMapping('B'), 'ControlLeft', 'Optional -> B -> ControlLeft');
assert.strictEqual(settings.getMapping('X'), 'KeyE', 'Reload -> X -> KeyE');
assert.strictEqual(settings.getMapping('Y'), 'KeyQ', 'Open Inventory -> Y -> KeyQ');
assert.strictEqual(settings.getMapping('L3'), 'KeyC', 'Run -> L3 -> KeyC');
assert.strictEqual(settings.getMapping('R3'), 'KeyV', 'Crouch / Stand -> R3 -> KeyV');
assert.strictEqual(settings.getMapping('View'), 'Tab', 'Open Map / Journal -> View -> Tab');
assert.strictEqual(settings.getMapping('Menu'), 'Escape', 'Pause -> Menu -> Escape');

assert.strictEqual(settings.getActionLabel('LT'), 'Aim');
assert.strictEqual(settings.getActionLabel('RT'), 'Attack');
assert.strictEqual(settings.getActionLabel('LB'), 'Guard');
assert.strictEqual(settings.getActionLabel('RB'), 'Use recovery items');
assert.strictEqual(settings.getActionLabel('A'), 'Examine / Pick up item');
assert.strictEqual(settings.getActionLabel('Y'), 'Open Inventory');
console.log('✓ 8. Reference screenshot game action mappings and descriptive labels verified');

console.log('\n====================================================');
console.log('   ALL TESTS PASSED SUCCESSFULLY! (8/8)             ');
console.log('====================================================\n');
