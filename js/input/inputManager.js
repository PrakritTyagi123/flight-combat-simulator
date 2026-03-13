/**
 * inputManager.js — Central Input Handler
 * 
 * The top-level input system that unifies keyboard, mouse, and gamepad input
 * into a single, context-aware action query API. Other game systems (aircraft,
 * combat, UI, camera) never touch raw input devices — they ask the InputManager:
 * 
 *   input.isActive('pitch_up')          // Is the player pitching up?
 *   input.wasTriggered('fire_primary')   // Did they just press fire?
 *   input.getAxis('pitch')              // Analog pitch value (-1 to 1)
 * 
 * The InputManager:
 *   - Owns the ControlBindings, KeyboardControls, MouseControls, GamepadControls
 *   - Manages active input contexts (flight, combat, menu, etc.)
 *   - Computes composite analog axes from digital inputs (keyboard → smooth ramp)
 *   - Provides a unified action query regardless of which device triggered it
 *   - Handles pointer lock management tied to game state
 *   - Supports input buffering for tight-timing actions
 */

import { ControlBindings, InputContext, Actions } from './controlBindings.js';
import { KeyboardControls } from './keyboardControls.js';
import { MouseControls } from './mouseControls.js';
import { GamepadControls } from './gamepadControls.js';

// ─── Analog Axis Definitions ─────────────────────────────────────────────────
// Maps logical axes to pairs of digital actions + gamepad axis for analog blending
const AXIS_DEFINITIONS = {
    pitch: {
        positive: Actions.PITCH_DOWN,   // Pull stick back = nose up (positive pitch)
        negative: Actions.PITCH_UP,     // Push stick forward = nose down
        gamepadAxis: 1,                 // Left stick Y
        mouseAxis: 'y',                 // Mouse Y movement
        mouseSensitivity: 0.008
    },
    roll: {
        positive: Actions.ROLL_RIGHT,
        negative: Actions.ROLL_LEFT,
        gamepadAxis: 0,                 // Left stick X
        mouseAxis: 'x',                 // Mouse X movement
        mouseSensitivity: 0.008
    },
    yaw: {
        positive: Actions.YAW_RIGHT,
        negative: Actions.YAW_LEFT,
        gamepadAxis: 2,                 // Right stick X
        mouseAxis: null
    },
    throttle: {
        positive: Actions.THROTTLE_UP,
        negative: Actions.THROTTLE_DOWN,
        gamepadAxis: null,              // Throttle uses triggers, handled separately
        mouseAxis: null,
        rampUp: 1.5,                    // Seconds to reach full from keyboard
        rampDown: 2.0                   // Seconds to return to zero
    }
};

// ─── InputManager Class ──────────────────────────────────────────────────────
export class InputManager {
    /**
     * @param {import('../core/gameState.js').GameState} gameState - Game state reference
     * @param {HTMLElement} canvas - Renderer canvas element
     */
    constructor(gameState, canvas) {
        /** @type {import('../core/gameState.js').GameState} */
        this.gameState = gameState;

        /** @type {HTMLElement} */
        this.canvas = canvas;

        // ─── Sub-systems ─────────────────────────────────────────────────
        /** @type {ControlBindings} Master binding definitions */
        this.bindings = new ControlBindings();

        /** @type {KeyboardControls} */
        this.keyboard = new KeyboardControls(this.bindings);

        /** @type {MouseControls} */
        this.mouse = new MouseControls(this.bindings, canvas);

        /** @type {GamepadControls} */
        this.gamepad = new GamepadControls(this.bindings);

        // ─── Active Contexts ─────────────────────────────────────────────
        /** @type {Set<string>} Currently active input contexts */
        this.activeContexts = new Set([InputContext.GLOBAL, InputContext.MENU]);

        // ─── Composite Axis State ────────────────────────────────────────
        /** @type {Object<string, number>} Current analog axis values (-1 to 1) */
        this.axisValues = {};

        /** @type {Object<string, number>} Keyboard-derived ramp values for smooth digital→analog */
        this._keyboardRamps = {};

        // Initialize axis state
        for (const axisName of Object.keys(AXIS_DEFINITIONS)) {
            this.axisValues[axisName] = 0;
            this._keyboardRamps[axisName] = 0;
        }

        // Throttle is special: it's persistent (doesn't return to 0 when released)
        /** @type {number} Current throttle level (0 to 1) */
        this.throttleLevel = 0.5; // Start at 50%

        // ─── Input Buffer ────────────────────────────────────────────────
        /** @type {{ action: string, time: number }[]} Recent action triggers for buffering */
        this._inputBuffer = [];

        /** @type {number} Max age (seconds) of buffered inputs */
        this._bufferWindow = 0.15; // 150ms input buffer

        // ─── Last Active Device ──────────────────────────────────────────
        /** @type {string} 'keyboard', 'mouse', or 'gamepad' */
        this.lastActiveDevice = 'keyboard';

        /** @type {boolean} Whether the input manager has been initialized */
        this.initialized = false;

        console.log('[InputManager] Created');
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    /**
     * Initialize all input sub-systems and register state listeners
     */
    init() {
        this.keyboard.init();
        this.mouse.init();
        this.gamepad.init();

        // Listen for game state changes to update contexts and pointer lock
        this._registerStateListeners();

        // Load saved bindings from localStorage if available
        this._loadSavedBindings();

        this.initialized = true;
        console.log('[InputManager] Initialized — Contexts:', Array.from(this.activeContexts));
    }

    /**
     * Frame update: poll all devices, compute axes, buffer actions.
     * Call this at the START of the frame, BEFORE reading any action states.
     * After reading actions, call flush() to clear per-frame buffers.
     * @param {number} dt - Frame delta time in seconds
     */
    update(dt) {
        if (!this.initialized) return;

        // ── Poll gamepad (required every frame) ──────────────────────────
        this.gamepad.update();

        // ── Compute composite analog axes from all devices ───────────────
        this._computeAxes(dt);

        // ── Track last active device ─────────────────────────────────────
        this._detectActiveDevice();

        // ── Buffer recent triggers ───────────────────────────────────────
        this._updateInputBuffer(dt);

        // NOTE: Do NOT clear keyboard/mouse per-frame buffers here.
        // Game code needs to read wasTriggered/wasReleased AFTER this call.
        // Call flush() when done reading actions for this frame.
    }

    /**
     * Clear per-frame input buffers (pressed/released/triggered).
     * Must be called once per frame AFTER all game systems have read input.
     */
    flush() {
        if (!this.initialized) return;
        this.keyboard.update();  // Clears keysPressed, keysReleased, triggeredActions, releasedActions
        this.mouse.update();     // Clears buttonsPressed, buttonsReleased, deltas
    }

    /**
     * Shut down all input sub-systems
     */
    dispose() {
        this.keyboard.dispose();
        this.mouse.dispose();
        this.gamepad.dispose();
        this.bindings.dispose();
        this._inputBuffer = [];
        this.initialized = false;
        console.log('[InputManager] Disposed');
    }

    // ─── Context Management ──────────────────────────────────────────────────

    /**
     * Activate an input context (enables its actions)
     * @param {string} context - Context name from InputContext
     */
    enableContext(context) {
        this.activeContexts.add(context);
    }

    /**
     * Deactivate an input context
     * @param {string} context
     */
    disableContext(context) {
        // Don't allow disabling GLOBAL
        if (context === InputContext.GLOBAL) return;
        this.activeContexts.delete(context);
    }

    /**
     * Set exactly which contexts are active (GLOBAL is always included)
     * @param {string[]} contexts
     */
    setContexts(contexts) {
        this.activeContexts.clear();
        this.activeContexts.add(InputContext.GLOBAL);
        for (const ctx of contexts) {
            this.activeContexts.add(ctx);
        }
    }

    /**
     * Check if a context is currently active
     * @param {string} context
     * @returns {boolean}
     */
    isContextActive(context) {
        return this.activeContexts.has(context);
    }

    // ─── Unified Action Queries ──────────────────────────────────────────────
    // These aggregate across keyboard, mouse, and gamepad.
    // Actions are only active if their context is currently enabled.

    /**
     * Is an action currently being held down? (any device)
     * @param {string} action - Action name from Actions enum
     * @returns {boolean}
     */
    isActive(action) {
        if (!this._isActionContextActive(action)) return false;
        return this.keyboard.isActionActive(action)
            || this.mouse.isActionActive(action)
            || this.gamepad.isActionActive(action);
    }

    /**
     * Was an action just triggered this frame? (any device)
     * @param {string} action
     * @returns {boolean}
     */
    wasTriggered(action) {
        if (!this._isActionContextActive(action)) return false;
        return this.keyboard.wasActionTriggered(action)
            || this.mouse.wasActionTriggered(action)
            || this.gamepad.wasActionTriggered(action);
    }

    /**
     * Was an action released this frame? (any device)
     * @param {string} action
     * @returns {boolean}
     */
    wasReleased(action) {
        if (!this._isActionContextActive(action)) return false;
        return this.keyboard.wasActionReleased(action)
            || this.mouse.wasActionReleased(action)
            || this.gamepad.wasActionReleased(action);
    }

    /**
     * Was an action triggered within the buffer window?
     * Useful for forgiving timing on fire/dodge inputs.
     * @param {string} action
     * @returns {boolean}
     */
    wasBuffered(action) {
        if (!this._isActionContextActive(action)) return false;
        return this._inputBuffer.some(entry => entry.action === action);
    }

    /**
     * Consume a buffered action (removes it from the buffer after use)
     * @param {string} action
     * @returns {boolean} Whether the action was in the buffer
     */
    consumeBuffered(action) {
        const idx = this._inputBuffer.findIndex(e => e.action === action);
        if (idx !== -1) {
            this._inputBuffer.splice(idx, 1);
            return true;
        }
        return false;
    }

    // ─── Analog Axis Queries ─────────────────────────────────────────────────

    /**
     * Get a composite analog axis value (-1 to 1)
     * Blends keyboard (digital ramping), mouse (movement delta), and gamepad (analog stick).
     * @param {string} axisName - 'pitch', 'roll', 'yaw', or 'throttle'
     * @returns {number} -1 to 1
     */
    getAxis(axisName) {
        return this.axisValues[axisName] || 0;
    }

    /**
     * Get the current throttle level (0 to 1)
     * @returns {number}
     */
    getThrottle() {
        return this.throttleLevel;
    }

    /**
     * Set the throttle level directly (e.g., from UI slider)
     * @param {number} level - 0 to 1
     */
    setThrottle(level) {
        this.throttleLevel = Math.max(0, Math.min(1, level));
    }

    /**
     * Get mouse movement delta (for freelook / camera control)
     * @returns {{ x: number, y: number }}
     */
    getMouseDelta() {
        return this.mouse.getMovementDelta();
    }

    /**
     * Get raw mouse position (for UI interaction)
     * @returns {{ x: number, y: number }}
     */
    getMousePosition() {
        return { x: this.mouse.clientX, y: this.mouse.clientY };
    }

    /**
     * Get normalized mouse position (-1 to 1) for raycasting
     * @returns {{ x: number, y: number }}
     */
    getMouseNormalized() {
        return { ...this.mouse.normalized };
    }

    // ─── Composite Axis Computation ──────────────────────────────────────────

    /**
     * Compute blended analog axes from all input sources
     * @private
     * @param {number} dt - Delta time
     */
    _computeAxes(dt) {
        for (const [axisName, def] of Object.entries(AXIS_DEFINITIONS)) {
            // Special handling for throttle (persistent level)
            if (axisName === 'throttle') {
                this._computeThrottle(dt, def);
                continue;
            }

            let value = 0;

            // ── Keyboard: digital → smooth ramp ──────────────────────────
            const posHeld = this.isActive(def.positive);
            const negHeld = this.isActive(def.negative);
            let kbTarget = 0;
            if (posHeld && !negHeld)       kbTarget = 1;
            else if (negHeld && !posHeld)  kbTarget = -1;

            // Ramp toward target for smooth keyboard control
            const rampSpeed = 4.0; // How fast keyboard reaches full deflection (per second)
            const returnSpeed = 6.0; // How fast it returns to center
            let ramp = this._keyboardRamps[axisName];

            if (kbTarget !== 0) {
                ramp += (kbTarget - ramp) * Math.min(1, rampSpeed * dt);
            } else {
                ramp += (0 - ramp) * Math.min(1, returnSpeed * dt);
            }
            // Snap to zero if very close (avoids floating drift)
            if (Math.abs(ramp) < 0.001) ramp = 0;
            this._keyboardRamps[axisName] = ramp;

            value = ramp;

            // ── Gamepad: override with analog stick if it has significant input ──
            if (this.gamepad.connected && def.gamepadAxis !== null) {
                const gpValue = this.gamepad.getAxis(def.gamepadAxis);
                if (Math.abs(gpValue) > 0.01) {
                    value = gpValue;
                }
            }

            // ── Mouse: add mouse movement as an additional layer ─────────
            if (def.mouseAxis && this.mouse.pointerLocked) {
                const delta = this.mouse.getMovementDelta();
                const mouseValue = def.mouseAxis === 'x' ? delta.x : delta.y;
                const mouseSens = def.mouseSensitivity || 0.005;
                value += mouseValue * mouseSens;
            }

            // Clamp final value
            this.axisValues[axisName] = Math.max(-1, Math.min(1, value));
        }
    }

    /**
     * Compute throttle as a persistent 0–1 level
     * @private
     * @param {number} dt
     * @param {Object} def - Axis definition
     */
    _computeThrottle(dt, def) {
        const rampUp = def.rampUp || 1.5;
        const rampDown = def.rampDown || 2.0;

        // Keyboard
        if (this.isActive(def.positive)) {
            this.throttleLevel += dt / rampUp;
        }
        if (this.isActive(def.negative)) {
            this.throttleLevel -= dt / rampDown;
        }

        // Afterburner: snap to 100%
        if (this.isActive(Actions.AFTERBURNER)) {
            this.throttleLevel = 1.0;
        }

        // Airbrake: drag throttle toward idle
        if (this.isActive(Actions.AIRBRAKE)) {
            this.throttleLevel -= dt * 0.8;
        }

        // Gamepad: use trigger axis if available (axis 3 is often right stick Y or trigger)
        if (this.gamepad.connected) {
            // Use right trigger (button 7) as throttle up, left trigger (button 6) as brake
            const rtValue = this.gamepad.getButtonValue(7);
            const ltValue = this.gamepad.getButtonValue(6);
            if (rtValue > 0.1) {
                this.throttleLevel += rtValue * dt / rampUp;
            }
            if (ltValue > 0.1) {
                this.throttleLevel -= ltValue * dt / rampDown;
            }
        }

        this.throttleLevel = Math.max(0, Math.min(1, this.throttleLevel));
        this.axisValues.throttle = this.throttleLevel;
    }

    // ─── Input Buffer ────────────────────────────────────────────────────────

    /**
     * Update the input buffer: add new triggers, expire old ones
     * @private
     * @param {number} dt
     */
    _updateInputBuffer(dt) {
        // Age out old entries
        const now = performance.now() / 1000;
        this._inputBuffer = this._inputBuffer.filter(
            e => (now - e.time) < this._bufferWindow
        );

        // Add newly triggered actions
        for (const action of Object.values(Actions)) {
            if (this.wasTriggered(action)) {
                this._inputBuffer.push({ action, time: now });
            }
        }
    }

    // ─── Device Detection ────────────────────────────────────────────────────

    /**
     * Detect which device the player is actively using (for UI prompt switching)
     * @private
     */
    _detectActiveDevice() {
        if (this.gamepad.connected && this.gamepad.buttonsPressed.size > 0) {
            this.lastActiveDevice = 'gamepad';
        } else if (this.mouse.buttonsPressed.size > 0
            || Math.abs(this.mouse.rawDeltaX) > 5
            || Math.abs(this.mouse.rawDeltaY) > 5) {
            this.lastActiveDevice = 'mouse';
        } else if (this.keyboard.keysPressed.size > 0) {
            this.lastActiveDevice = 'keyboard';
        }
    }

    // ─── State Listeners ─────────────────────────────────────────────────────

    /**
     * Register listeners for game state changes to swap input contexts
     * @private
     */
    _registerStateListeners() {
        const { GameStates } = require_gamestate_workaround();

        this.gameState.on('stateChange', ({ from, to }) => {
            switch (to) {
                case 'MENU':
                case 'MAP_SELECT':
                case 'PLANE_SELECT':
                case 'MISSION_BRIEFING':
                case 'SETTINGS':
                    this.setContexts([InputContext.MENU]);
                    this.mouse.releasePointerLock();
                    break;

                case 'PLAYING':
                    this.setContexts([
                        InputContext.FLIGHT,
                        InputContext.COMBAT,
                        InputContext.CAMERA,
                        InputContext.DEBUG
                    ]);
                    // Request pointer lock for immersive flight control
                    this.mouse.requestPointerLock();
                    break;

                case 'PAUSED':
                    this.setContexts([InputContext.MENU]);
                    this.mouse.releasePointerLock();
                    break;

                case 'GAME_OVER':
                case 'MISSION_COMPLETE':
                    this.setContexts([InputContext.MENU]);
                    this.mouse.releasePointerLock();
                    break;
            }
        });
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    /**
     * Check if an action's context is currently active
     * @private
     * @param {string} action
     * @returns {boolean}
     */
    _isActionContextActive(action) {
        const ctx = this.bindings.getContext(action);
        if (!ctx) return false;
        return this.activeContexts.has(ctx);
    }

    // ─── Pointer Lock Convenience ────────────────────────────────────────────

    /**
     * Request pointer lock (delegates to mouse controls)
     */
    requestPointerLock() {
        this.mouse.requestPointerLock();
    }

    /**
     * Release pointer lock
     */
    releasePointerLock() {
        this.mouse.releasePointerLock();
    }

    /**
     * Is the pointer currently locked?
     * @returns {boolean}
     */
    isPointerLocked() {
        return this.mouse.pointerLocked;
    }

    // ─── Saved Bindings ──────────────────────────────────────────────────────

    /**
     * Load saved control bindings from localStorage
     * @private
     */
    _loadSavedBindings() {
        try {
            const saved = localStorage.getItem('flight_sim_bindings');
            if (saved) {
                this.bindings.deserialize(JSON.parse(saved));
                console.log('[InputManager] Loaded saved bindings');
            }
        } catch (e) {
            console.warn('[InputManager] Could not load saved bindings:', e.message);
        }
    }

    /**
     * Save current control bindings to localStorage
     */
    saveBindings() {
        try {
            localStorage.setItem('flight_sim_bindings', JSON.stringify(this.bindings.serialize()));
            console.log('[InputManager] Bindings saved');
        } catch (e) {
            console.warn('[InputManager] Could not save bindings:', e.message);
        }
    }

    /**
     * Reset bindings to defaults and clear saved data
     */
    resetBindings() {
        this.bindings.resetToDefaults();
        try {
            localStorage.removeItem('flight_sim_bindings');
        } catch (e) { /* ignore */ }
        console.log('[InputManager] Bindings reset to defaults');
    }

    // ─── Rebinding ───────────────────────────────────────────────────────────

    /**
     * Enter rebinding mode for a keyboard key
     * @param {string} action - Action to rebind
     * @param {Function} callback - Called with (newCode, conflicts) when a key is pressed
     */
    startKeyRebind(action, callback) {
        this.keyboard.startRebind((code) => {
            const conflicts = this.bindings.findKeyConflicts(code, action);
            this.bindings.rebindKeyboard(action, [code]);
            callback(code, conflicts);
        });
    }

    /**
     * Cancel an active rebinding
     */
    cancelRebind() {
        this.keyboard.cancelRebind();
    }

    // ─── Debug ───────────────────────────────────────────────────────────────

    /**
     * Get comprehensive debug info about the entire input system
     * @returns {Object}
     */
    getDebugInfo() {
        return {
            initialized: this.initialized,
            activeContexts: Array.from(this.activeContexts),
            lastActiveDevice: this.lastActiveDevice,
            axes: { ...this.axisValues },
            throttle: this.throttleLevel.toFixed(3),
            bufferSize: this._inputBuffer.length,
            pointerLocked: this.mouse.pointerLocked,
            gamepadConnected: this.gamepad.connected,
            keyboard: this.keyboard.getDebugInfo(),
            mouse: this.mouse.getDebugInfo(),
            gamepad: this.gamepad.getDebugInfo()
        };
    }
}

// ─── Workaround: We can't circular-import GameStates in the state listener ───
// Instead we use string literals for state names (they match GameStates values)
function require_gamestate_workaround() {
    return {
        GameStates: {
            MENU: 'MENU', PLAYING: 'PLAYING', PAUSED: 'PAUSED',
            MAP_SELECT: 'MAP_SELECT', PLANE_SELECT: 'PLANE_SELECT',
            MISSION_BRIEFING: 'MISSION_BRIEFING', SETTINGS: 'SETTINGS',
            GAME_OVER: 'GAME_OVER', MISSION_COMPLETE: 'MISSION_COMPLETE'
        }
    };
}