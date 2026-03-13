/**
 * gamepadControls.js — Gamepad Input Handler
 * 
 * Polls connected gamepads (via the Gamepad API) each frame and translates
 * stick axes and button presses into game actions through ControlBindings.
 * Supports:
 *   - Up to 4 gamepads (uses first connected by default)
 *   - Configurable dead zones and curve for analog sticks
 *   - Button press/hold/release detection
 *   - Axis-to-action mapping with directional thresholds
 *   - Hot-plug connect/disconnect handling
 *   - Rumble/haptic feedback (when supported)
 */

// ─── GamepadControls Class ───────────────────────────────────────────────────
export class GamepadControls {
    /**
     * @param {import('./controlBindings.js').ControlBindings} bindings - Control bindings
     */
    constructor(bindings) {
        /** @type {import('./controlBindings.js').ControlBindings} */
        this.bindings = bindings;

        /** @type {boolean} Whether gamepad input is enabled */
        this.enabled = true;

        /** @type {boolean} Whether any gamepad is currently connected */
        this.connected = false;

        /** @type {number} Index of the active gamepad (0–3) */
        this.activeIndex = 0;

        /** @type {Gamepad|null} Cached reference to the active gamepad snapshot */
        this.gamepad = null;

        // ─── Axis State ──────────────────────────────────────────────────
        /** @type {number[]} Current axis values (after dead zone processing) */
        this.axes = [0, 0, 0, 0];

        /** @type {number[]} Raw unprocessed axis values */
        this.rawAxes = [0, 0, 0, 0];

        // ─── Button State ────────────────────────────────────────────────
        /** @type {Set<number>} Buttons currently held */
        this.buttonsDown = new Set();

        /** @type {Set<number>} Buttons pressed this frame */
        this.buttonsPressed = new Set();

        /** @type {Set<number>} Buttons released this frame */
        this.buttonsReleased = new Set();

        /** @type {number[]} Raw button values (analog 0-1) */
        this.buttonValues = [];

        /** @type {Set<string>} Actions currently active from gamepad */
        this.activeActions = new Set();

        /** @type {Set<string>} Actions triggered this frame from gamepad */
        this.triggeredActions = new Set();

        /** @type {Set<string>} Actions released this frame from gamepad */
        this.releasedActions = new Set();

        // ─── Configuration ───────────────────────────────────────────────
        /** @type {Object} Gamepad settings */
        this.settings = {
            deadZone: 0.15,          // Inner dead zone for sticks (0–1)
            outerDeadZone: 0.98,     // Outer dead zone (snap to 1)
            curve: 1.5,              // Response curve exponent (1 = linear, >1 = progressive)
            buttonThreshold: 0.5,    // Analog button press threshold
            axisActionThreshold: 0.3 // Threshold for axis-to-action triggering
        };

        // Bind handlers
        this._onGamepadConnected = this._onGamepadConnected.bind(this);
        this._onGamepadDisconnected = this._onGamepadDisconnected.bind(this);

        console.log('[GamepadControls] Created');
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    /**
     * Start listening for gamepad connections
     */
    init() {
        window.addEventListener('gamepadconnected', this._onGamepadConnected);
        window.addEventListener('gamepaddisconnected', this._onGamepadDisconnected);

        // Check if gamepads are already connected (they aren't enumerable until
        // a button is pressed, but let's try)
        this._scanForGamepads();

        console.log('[GamepadControls] Listening for gamepads');
    }

    /**
     * Called once per frame by InputManager.
     * Polls the gamepad state (Gamepad API requires polling, not events).
     */
    update() {
        // Clear per-frame buffers
        this.buttonsPressed.clear();
        this.buttonsReleased.clear();
        this.triggeredActions.clear();
        this.releasedActions.clear();

        if (!this.enabled || !this.connected) return;

        // Get fresh gamepad state (required — cached refs go stale)
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        this.gamepad = gamepads[this.activeIndex] || null;

        if (!this.gamepad || !this.gamepad.connected) {
            this.connected = false;
            return;
        }

        // ── Process Axes ─────────────────────────────────────────────────
        this._processAxes();

        // ── Process Buttons ──────────────────────────────────────────────
        this._processButtons();

        // ── Process Axis → Action mappings ───────────────────────────────
        this._processAxisActions();
    }

    /**
     * Stop listening and clean up
     */
    dispose() {
        window.removeEventListener('gamepadconnected', this._onGamepadConnected);
        window.removeEventListener('gamepaddisconnected', this._onGamepadDisconnected);
        this.buttonsDown.clear();
        this.activeActions.clear();
        this.gamepad = null;
        this.connected = false;
        console.log('[GamepadControls] Disposed');
    }

    // ─── Gamepad Connection ──────────────────────────────────────────────────

    /**
     * @private
     * @param {GamepadEvent} e
     */
    _onGamepadConnected(e) {
        console.log(`[GamepadControls] Gamepad connected: "${e.gamepad.id}" (index ${e.gamepad.index})`);
        this.activeIndex = e.gamepad.index;
        this.connected = true;
        this.gamepad = e.gamepad;

        // Initialize button value array
        this.buttonValues = new Array(e.gamepad.buttons.length).fill(0);
    }

    /**
     * @private
     * @param {GamepadEvent} e
     */
    _onGamepadDisconnected(e) {
        console.log(`[GamepadControls] Gamepad disconnected: "${e.gamepad.id}"`);
        if (e.gamepad.index === this.activeIndex) {
            this.connected = false;
            this.gamepad = null;
            this.axes = [0, 0, 0, 0];
            this.buttonsDown.clear();
            this.activeActions.clear();
        }
    }

    /**
     * Scan for already-connected gamepads
     * @private
     */
    _scanForGamepads() {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (let i = 0; i < gamepads.length; i++) {
            if (gamepads[i] && gamepads[i].connected) {
                this.activeIndex = i;
                this.connected = true;
                this.gamepad = gamepads[i];
                this.buttonValues = new Array(gamepads[i].buttons.length).fill(0);
                console.log(`[GamepadControls] Found existing gamepad: "${gamepads[i].id}"`);
                break;
            }
        }
    }

    // ─── Axis Processing ─────────────────────────────────────────────────────

    /**
     * Read and process analog stick axes with dead zone and response curve
     * @private
     */
    _processAxes() {
        const gp = this.gamepad;
        const maxAxes = Math.min(gp.axes.length, 4);

        for (let i = 0; i < maxAxes; i++) {
            const raw = gp.axes[i];
            this.rawAxes[i] = raw;
            this.axes[i] = this._applyDeadZoneAndCurve(raw);
        }

        // Zero out any unused axes
        for (let i = maxAxes; i < 4; i++) {
            this.rawAxes[i] = 0;
            this.axes[i] = 0;
        }
    }

    /**
     * Apply dead zone and response curve to an axis value
     * @private
     * @param {number} value - Raw axis value (-1 to 1)
     * @returns {number} Processed value (-1 to 1)
     */
    _applyDeadZoneAndCurve(value) {
        const abs = Math.abs(value);
        const sign = Math.sign(value);
        const { deadZone, outerDeadZone, curve } = this.settings;

        // Inner dead zone
        if (abs < deadZone) return 0;

        // Outer dead zone — snap to full
        if (abs > outerDeadZone) return sign;

        // Remap from dead zone range to 0–1 range
        const remapped = (abs - deadZone) / (outerDeadZone - deadZone);

        // Apply response curve (exponential)
        const curved = Math.pow(remapped, curve);

        return sign * curved;
    }

    // ─── Button Processing ───────────────────────────────────────────────────

    /**
     * Process button presses and releases
     * @private
     */
    _processButtons() {
        const gp = this.gamepad;
        const threshold = this.settings.buttonThreshold;

        for (let i = 0; i < gp.buttons.length; i++) {
            const btn = gp.buttons[i];
            const value = typeof btn === 'object' ? btn.value : btn;
            const pressed = typeof btn === 'object' ? btn.pressed : (value > threshold);

            this.buttonValues[i] = value;

            if (pressed && !this.buttonsDown.has(i)) {
                // Button just pressed
                this.buttonsDown.add(i);
                this.buttonsPressed.add(i);

                // Map to actions
                const actions = this.bindings.getActionsForGamepadButton(i);
                for (const { action } of actions) {
                    if (!this.activeActions.has(action)) {
                        this.activeActions.add(action);
                        this.triggeredActions.add(action);
                    }
                }

            } else if (!pressed && this.buttonsDown.has(i)) {
                // Button just released
                this.buttonsDown.delete(i);
                this.buttonsReleased.add(i);

                // Release actions
                const actions = this.bindings.getActionsForGamepadButton(i);
                for (const { action } of actions) {
                    this.activeActions.delete(action);
                    this.releasedActions.add(action);
                }
            }
        }
    }

    /**
     * Process axis → action mappings (e.g., left stick Y → pitch)
     * @private
     */
    _processAxisActions() {
        const axisBindings = this.bindings.getGamepadAxisBindings();
        const threshold = this.settings.axisActionThreshold;

        for (const ab of axisBindings) {
            const value = this.axes[ab.axis] || 0;
            const directionalValue = value * ab.direction;
            const isActive = directionalValue > threshold;

            if (isActive && !this.activeActions.has(ab.action)) {
                this.activeActions.add(ab.action);
                this.triggeredActions.add(ab.action);
            } else if (!isActive && this.activeActions.has(ab.action)) {
                this.activeActions.delete(ab.action);
                this.releasedActions.add(ab.action);
            }
        }
    }

    // ─── Axis Queries ────────────────────────────────────────────────────────

    /**
     * Get a processed axis value
     * @param {number} index - Axis index (0=LX, 1=LY, 2=RX, 3=RY typically)
     * @returns {number} -1 to 1
     */
    getAxis(index) {
        return this.axes[index] || 0;
    }

    /**
     * Get raw (unprocessed) axis value
     * @param {number} index
     * @returns {number}
     */
    getRawAxis(index) {
        return this.rawAxes[index] || 0;
    }

    /**
     * Get left stick as a vector
     * @returns {{ x: number, y: number }}
     */
    getLeftStick() {
        return { x: this.axes[0], y: this.axes[1] };
    }

    /**
     * Get right stick as a vector
     * @returns {{ x: number, y: number }}
     */
    getRightStick() {
        return { x: this.axes[2], y: this.axes[3] };
    }

    // ─── Button Queries ──────────────────────────────────────────────────────

    /**
     * Is a gamepad button held?
     * @param {number} index
     * @returns {boolean}
     */
    isButtonDown(index) {
        return this.buttonsDown.has(index);
    }

    /**
     * Was a gamepad button pressed this frame?
     * @param {number} index
     * @returns {boolean}
     */
    wasButtonPressed(index) {
        return this.buttonsPressed.has(index);
    }

    /**
     * Was a gamepad button released this frame?
     * @param {number} index
     * @returns {boolean}
     */
    wasButtonReleased(index) {
        return this.buttonsReleased.has(index);
    }

    /**
     * Get analog value of a button (0–1, for triggers)
     * @param {number} index
     * @returns {number}
     */
    getButtonValue(index) {
        return this.buttonValues[index] || 0;
    }

    // ─── Action Queries ──────────────────────────────────────────────────────

    /**
     * Is a gamepad-bound action active?
     * @param {string} action
     * @returns {boolean}
     */
    isActionActive(action) {
        return this.activeActions.has(action);
    }

    /**
     * Was a gamepad-bound action triggered this frame?
     * @param {string} action
     * @returns {boolean}
     */
    wasActionTriggered(action) {
        return this.triggeredActions.has(action);
    }

    /**
     * Was a gamepad-bound action released this frame?
     * @param {string} action
     * @returns {boolean}
     */
    wasActionReleased(action) {
        return this.releasedActions.has(action);
    }

    // ─── Haptic Feedback ─────────────────────────────────────────────────────

    /**
     * Trigger a rumble effect on the active gamepad
     * @param {number} [intensity=0.5] - Vibration intensity (0–1)
     * @param {number} [duration=200] - Duration in milliseconds
     */
    rumble(intensity = 0.5, duration = 200) {
        if (!this.gamepad) return;

        // Standard Gamepad Haptics API
        if (this.gamepad.vibrationActuator) {
            this.gamepad.vibrationActuator.playEffect?.('dual-rumble', {
                startDelay: 0,
                duration: duration,
                weakMagnitude: intensity * 0.5,
                strongMagnitude: intensity
            }).catch(() => { /* Haptics not supported, ignore */ });
        }

        // Chrome experimental haptics
        if (this.gamepad.hapticActuators?.length > 0) {
            this.gamepad.hapticActuators[0].pulse?.(intensity, duration)
                .catch(() => { /* Not supported */ });
        }
    }

    // ─── Settings ────────────────────────────────────────────────────────────

    /**
     * Update gamepad settings
     * @param {Object} newSettings - Partial settings to merge
     */
    setSettings(newSettings) {
        Object.assign(this.settings, newSettings);
        console.log('[GamepadControls] Settings updated', this.settings);
    }

    // ─── Debug ───────────────────────────────────────────────────────────────

    /**
     * Get debug info about gamepad state
     * @returns {Object}
     */
    getDebugInfo() {
        return {
            enabled: this.enabled,
            connected: this.connected,
            gamepadId: this.gamepad?.id || 'none',
            activeIndex: this.activeIndex,
            axes: this.axes.map(v => v.toFixed(3)),
            rawAxes: this.rawAxes.map(v => v.toFixed(3)),
            buttonsDown: Array.from(this.buttonsDown),
            activeActions: Array.from(this.activeActions),
            triggeredActions: Array.from(this.triggeredActions),
            buttonCount: this.buttonValues.length,
            settings: { ...this.settings }
        };
    }
}