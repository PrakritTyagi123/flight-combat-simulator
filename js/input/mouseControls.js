/**
 * mouseControls.js — Mouse Input Handler
 * 
 * Handles mouse movement (with pointer lock for flight), mouse buttons,
 * scroll wheel, and sensitivity settings. Provides:
 *   - Smooth movement deltas (dx, dy) for pitch/yaw/freelook
 *   - Button press/hold/release detection mapped through ControlBindings
 *   - Scroll wheel events for weapon cycling
 *   - Pointer lock management for immersive flight control
 *   - Configurable sensitivity, inversion, and dead zones
 */

// ─── MouseControls Class ─────────────────────────────────────────────────────
export class MouseControls {
    /**
     * @param {import('./controlBindings.js').ControlBindings} bindings - Control bindings
     * @param {HTMLElement} canvas - The renderer's canvas element (for pointer lock)
     */
    constructor(bindings, canvas) {
        /** @type {import('./controlBindings.js').ControlBindings} */
        this.bindings = bindings;

        /** @type {HTMLElement} Target element for pointer lock */
        this.canvas = canvas;

        /** @type {boolean} Whether mouse input is enabled */
        this.enabled = true;

        // ─── Movement State ──────────────────────────────────────────────
        /** @type {number} Raw X movement delta this frame (pixels) */
        this.rawDeltaX = 0;

        /** @type {number} Raw Y movement delta this frame (pixels) */
        this.rawDeltaY = 0;

        /** @type {number} Smoothed X delta (after sensitivity + smoothing) */
        this.deltaX = 0;

        /** @type {number} Smoothed Y delta (after sensitivity + smoothing) */
        this.deltaY = 0;

        /** @type {number} Accumulated X movement since last update */
        this._accumX = 0;

        /** @type {number} Accumulated Y movement since last update */
        this._accumY = 0;

        // ─── Button State ────────────────────────────────────────────────
        /** @type {Set<number>} Mouse buttons currently held */
        this.buttonsDown = new Set();

        /** @type {Set<number>} Mouse buttons pressed this frame */
        this.buttonsPressed = new Set();

        /** @type {Set<number>} Mouse buttons released this frame */
        this.buttonsReleased = new Set();

        /** @type {Set<string>} Actions active from mouse buttons */
        this.activeActions = new Set();

        /** @type {Set<string>} Actions triggered this frame from mouse */
        this.triggeredActions = new Set();

        /** @type {Set<string>} Actions released this frame from mouse */
        this.releasedActions = new Set();

        // ─── Scroll Wheel ────────────────────────────────────────────────
        /** @type {number} Scroll wheel delta this frame (positive = up, negative = down) */
        this.wheelDelta = 0;

        /** @type {boolean} Whether scroll-up occurred this frame */
        this.wheelUp = false;

        /** @type {boolean} Whether scroll-down occurred this frame */
        this.wheelDown = false;

        // ─── Pointer Lock ────────────────────────────────────────────────
        /** @type {boolean} Whether pointer lock is currently active */
        this.pointerLocked = false;

        /** @type {boolean} Whether we should try to acquire pointer lock */
        this.wantPointerLock = false;

        // ─── Configuration ───────────────────────────────────────────────
        /** @type {Object} Mouse settings */
        this.settings = {
            sensitivity: 1.0,       // Master sensitivity multiplier
            sensitivityX: 1.0,      // Additional X axis multiplier
            sensitivityY: 1.0,      // Additional Y axis multiplier
            invertY: false,         // Invert Y axis (common in flight sims)
            invertX: false,         // Invert X axis
            smoothing: 0.5,         // Movement smoothing factor (0 = none, 1 = max)
            deadZone: 2.0,          // Pixel dead zone to ignore tiny movements
            maxDelta: 100           // Clamp maximum per-frame delta
        };

        /** @type {number} Previous frame smoothed X */
        this._prevSmoothX = 0;

        /** @type {number} Previous frame smoothed Y */
        this._prevSmoothY = 0;

        // ─── Screen position (for menus, UI clicks) ─────────────────────
        /** @type {number} Cursor X in viewport pixels */
        this.clientX = 0;

        /** @type {number} Cursor Y in viewport pixels */
        this.clientY = 0;

        /** @type {{ x: number, y: number }} Normalized position (-1 to 1) */
        this.normalized = { x: 0, y: 0 };

        // Bind handlers
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseDown = this._onMouseDown.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);
        this._onWheel = this._onWheel.bind(this);
        this._onPointerLockChange = this._onPointerLockChange.bind(this);
        this._onPointerLockError = this._onPointerLockError.bind(this);
        this._onContextMenu = this._onContextMenu.bind(this);

        console.log('[MouseControls] Created');
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    /**
     * Start listening for mouse events
     */
    init() {
        // Movement and buttons on the canvas
        this.canvas.addEventListener('mousemove', this._onMouseMove);
        this.canvas.addEventListener('mousedown', this._onMouseDown);
        this.canvas.addEventListener('mouseup', this._onMouseUp);
        this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
        this.canvas.addEventListener('contextmenu', this._onContextMenu);

        // Global mouseup so we don't miss releases outside the canvas
        window.addEventListener('mouseup', this._onMouseUp);

        // Pointer lock events
        document.addEventListener('pointerlockchange', this._onPointerLockChange);
        document.addEventListener('pointerlockerror', this._onPointerLockError);

        console.log('[MouseControls] Listening');
    }

    /**
     * Called once per frame by InputManager.
     * Processes accumulated movement, applies smoothing, then clears per-frame buffers.
     */
    update() {
        // ── Apply movement ───────────────────────────────────────────────
        this.rawDeltaX = this._accumX;
        this.rawDeltaY = this._accumY;

        // Dead zone
        let dx = Math.abs(this._accumX) < this.settings.deadZone ? 0 : this._accumX;
        let dy = Math.abs(this._accumY) < this.settings.deadZone ? 0 : this._accumY;

        // Clamp
        dx = Math.max(-this.settings.maxDelta, Math.min(this.settings.maxDelta, dx));
        dy = Math.max(-this.settings.maxDelta, Math.min(this.settings.maxDelta, dy));

        // Apply sensitivity
        dx *= this.settings.sensitivity * this.settings.sensitivityX;
        dy *= this.settings.sensitivity * this.settings.sensitivityY;

        // Apply inversion
        if (this.settings.invertX) dx = -dx;
        if (this.settings.invertY) dy = -dy;

        // Smoothing (lerp with previous frame)
        const s = this.settings.smoothing;
        this.deltaX = dx * (1 - s) + this._prevSmoothX * s;
        this.deltaY = dy * (1 - s) + this._prevSmoothY * s;

        this._prevSmoothX = this.deltaX;
        this._prevSmoothY = this.deltaY;

        // Clear accumulators
        this._accumX = 0;
        this._accumY = 0;

        // ── Process wheel actions ────────────────────────────────────────
        this.wheelUp = false;
        this.wheelDown = false;

        // (Wheel actions were already triggered in onWheel — just clear the triggered lists)

        // ── Clear per-frame buffers ──────────────────────────────────────
        this.buttonsPressed.clear();
        this.buttonsReleased.clear();
        this.triggeredActions.clear();
        this.releasedActions.clear();
        this.wheelDelta = 0;
    }

    /**
     * Stop listening and clean up
     */
    dispose() {
        this.canvas.removeEventListener('mousemove', this._onMouseMove);
        this.canvas.removeEventListener('mousedown', this._onMouseDown);
        this.canvas.removeEventListener('mouseup', this._onMouseUp);
        this.canvas.removeEventListener('wheel', this._onWheel);
        this.canvas.removeEventListener('contextmenu', this._onContextMenu);
        window.removeEventListener('mouseup', this._onMouseUp);
        document.removeEventListener('pointerlockchange', this._onPointerLockChange);
        document.removeEventListener('pointerlockerror', this._onPointerLockError);

        this.releasePointerLock();

        this.buttonsDown.clear();
        this.activeActions.clear();
        console.log('[MouseControls] Disposed');
    }

    // ─── Event Handlers ──────────────────────────────────────────────────────

    /**
     * @private
     * @param {MouseEvent} e
     */
    _onMouseMove(e) {
        if (!this.enabled) return;

        // Accumulate movement deltas (multiple events can fire per frame)
        this._accumX += e.movementX || 0;
        this._accumY += e.movementY || 0;

        // Track screen position for non-locked cursor (menus, UI)
        this.clientX = e.clientX;
        this.clientY = e.clientY;

        // Normalized coordinates (-1 to 1)
        const rect = this.canvas.getBoundingClientRect();
        this.normalized.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.normalized.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    /**
     * @private
     * @param {MouseEvent} e
     */
    _onMouseDown(e) {
        if (!this.enabled) return;

        const btn = e.button;

        if (!this.buttonsDown.has(btn)) {
            this.buttonsDown.add(btn);
            this.buttonsPressed.add(btn);

            // Map to actions
            const actions = this.bindings.getActionsForMouseButton(btn);
            for (const { action } of actions) {
                if (!this.activeActions.has(action)) {
                    this.activeActions.add(action);
                    this.triggeredActions.add(action);
                }
            }
        }
    }

    /**
     * @private
     * @param {MouseEvent} e
     */
    _onMouseUp(e) {
        if (!this.enabled) return;

        const btn = e.button;

        if (this.buttonsDown.has(btn)) {
            this.buttonsDown.delete(btn);
            this.buttonsReleased.add(btn);

            // Release actions — only if no other mouse button for that action is held
            const actions = this.bindings.getActionsForMouseButton(btn);
            for (const { action } of actions) {
                if (this._isMouseActionStillHeld(action)) continue;
                this.activeActions.delete(action);
                this.releasedActions.add(action);
            }
        }
    }

    /**
     * @private
     * @param {WheelEvent} e
     */
    _onWheel(e) {
        if (!this.enabled) return;
        e.preventDefault();

        this.wheelDelta = -e.deltaY; // Positive = scroll up

        if (e.deltaY < 0) {
            this.wheelUp = true;
            // Trigger wheel_up actions
            const actions = this.bindings.getActionsForMouseButton('wheel_up');
            for (const { action } of actions) {
                this.triggeredActions.add(action);
            }
        } else if (e.deltaY > 0) {
            this.wheelDown = true;
            // Trigger wheel_down actions
            const actions = this.bindings.getActionsForMouseButton('wheel_down');
            for (const { action } of actions) {
                this.triggeredActions.add(action);
            }
        }
    }

    /**
     * Prevent context menu on right-click (we use right-click for game actions)
     * @private
     * @param {MouseEvent} e
     */
    _onContextMenu(e) {
        e.preventDefault();
    }

    // ─── Pointer Lock ────────────────────────────────────────────────────────

    /**
     * Request pointer lock on the canvas (hides cursor, provides raw movement)
     */
    requestPointerLock() {
        this.wantPointerLock = true;
        if (!this.pointerLocked) {
            this.canvas.requestPointerLock?.();
        }
    }

    /**
     * Release pointer lock
     */
    releasePointerLock() {
        this.wantPointerLock = false;
        if (this.pointerLocked) {
            document.exitPointerLock?.();
        }
    }

    /**
     * Toggle pointer lock
     */
    togglePointerLock() {
        if (this.pointerLocked) {
            this.releasePointerLock();
        } else {
            this.requestPointerLock();
        }
    }

    /**
     * @private
     */
    _onPointerLockChange() {
        this.pointerLocked = (document.pointerLockElement === this.canvas);
        console.log(`[MouseControls] Pointer lock: ${this.pointerLocked}`);
    }

    /**
     * @private
     */
    _onPointerLockError() {
        console.warn('[MouseControls] Pointer lock error');
        this.pointerLocked = false;
    }

    // ─── Button State Queries ────────────────────────────────────────────────

    /**
     * Is a mouse button currently held?
     * @param {number} button - 0=left, 1=middle, 2=right
     * @returns {boolean}
     */
    isButtonDown(button) {
        return this.buttonsDown.has(button);
    }

    /**
     * Was a mouse button pressed this frame?
     * @param {number} button
     * @returns {boolean}
     */
    wasButtonPressed(button) {
        return this.buttonsPressed.has(button);
    }

    /**
     * Was a mouse button released this frame?
     * @param {number} button
     * @returns {boolean}
     */
    wasButtonReleased(button) {
        return this.buttonsReleased.has(button);
    }

    // ─── Action Queries ──────────────────────────────────────────────────────

    /**
     * Is a mouse-bound action active?
     * @param {string} action
     * @returns {boolean}
     */
    isActionActive(action) {
        return this.activeActions.has(action);
    }

    /**
     * Was a mouse-bound action triggered this frame?
     * @param {string} action
     * @returns {boolean}
     */
    wasActionTriggered(action) {
        return this.triggeredActions.has(action);
    }

    /**
     * Was a mouse-bound action released this frame?
     * @param {string} action
     * @returns {boolean}
     */
    wasActionReleased(action) {
        return this.releasedActions.has(action);
    }

    // ─── Movement Getters ────────────────────────────────────────────────────

    /**
     * Get the processed mouse movement delta for this frame.
     * Positive X = right, positive Y = up (if not inverted)
     * @returns {{ x: number, y: number }}
     */
    getMovementDelta() {
        return { x: this.deltaX, y: this.deltaY };
    }

    /**
     * Get raw unprocessed delta
     * @returns {{ x: number, y: number }}
     */
    getRawDelta() {
        return { x: this.rawDeltaX, y: this.rawDeltaY };
    }

    // ─── Settings ────────────────────────────────────────────────────────────

    /**
     * Update mouse settings
     * @param {Object} newSettings - Partial settings to merge
     */
    setSettings(newSettings) {
        Object.assign(this.settings, newSettings);
        console.log('[MouseControls] Settings updated', this.settings);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    /**
     * Check if an action still has at least one of its mouse buttons held
     * @private
     * @param {string} action
     * @returns {boolean}
     */
    _isMouseActionStillHeld(action) {
        const binding = this.bindings.getBinding(action);
        if (!binding) return false;
        return binding.mouse.some(btn => {
            if (typeof btn === 'number') return this.buttonsDown.has(btn);
            return false; // Wheel events aren't "held"
        });
    }

    // ─── Debug ───────────────────────────────────────────────────────────────

    /**
     * Get debug info about mouse state
     * @returns {Object}
     */
    getDebugInfo() {
        return {
            enabled: this.enabled,
            pointerLocked: this.pointerLocked,
            delta: { x: this.deltaX.toFixed(2), y: this.deltaY.toFixed(2) },
            rawDelta: { x: this.rawDeltaX.toFixed(2), y: this.rawDeltaY.toFixed(2) },
            buttonsDown: Array.from(this.buttonsDown),
            activeActions: Array.from(this.activeActions),
            normalized: { x: this.normalized.x.toFixed(3), y: this.normalized.y.toFixed(3) },
            wheelDelta: this.wheelDelta,
            settings: { ...this.settings }
        };
    }
}