/**
 * keyboardControls.js — Keyboard Input Handler
 * 
 * Listens for keydown/keyup events and maintains a live state map of every key.
 * Converts raw key events into game actions using ControlBindings.
 * Provides three query modes:
 *   - isDown(code)   — true while the key is held
 *   - wasPressed(code) — true only on the frame the key first went down
 *   - wasReleased(code) — true only on the frame the key was released
 * 
 * The "was" queries are consumed each frame (cleared by update()) so they
 * behave correctly even at varying frame rates.
 */

// ─── KeyboardControls Class ──────────────────────────────────────────────────
export class KeyboardControls {
    /**
     * @param {import('./controlBindings.js').ControlBindings} bindings - Binding definitions
     */
    constructor(bindings) {
        /** @type {import('./controlBindings.js').ControlBindings} */
        this.bindings = bindings;

        /** @type {Set<string>} Keys currently held down (KeyboardEvent.code) */
        this.keysDown = new Set();

        /** @type {Set<string>} Keys that were pressed this frame */
        this.keysPressed = new Set();

        /** @type {Set<string>} Keys that were released this frame */
        this.keysReleased = new Set();

        /** @type {Set<string>} Actions currently active (held) */
        this.activeActions = new Set();

        /** @type {Set<string>} Actions that triggered this frame (just pressed) */
        this.triggeredActions = new Set();

        /** @type {Set<string>} Actions that ended this frame (just released) */
        this.releasedActions = new Set();

        /** @type {boolean} Whether keyboard input is enabled */
        this.enabled = true;

        /** @type {Set<string>} Keys to prevent default browser behavior for */
        this.preventDefaultKeys = new Set([
            'Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
            'F1', 'F2', 'F3', 'F4', 'F5', 'Backquote'
        ]);

        /** @type {boolean} Whether we're in a rebinding flow (captures next key) */
        this.rebinding = false;

        /** @type {Function|null} Callback for rebinding mode */
        this.rebindCallback = null;

        // Bind event handlers to preserve `this` context
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);
        this._onBlur = this._onBlur.bind(this);

        console.log('[KeyboardControls] Created');
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    /**
     * Start listening for keyboard events
     */
    init() {
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('blur', this._onBlur);
        console.log('[KeyboardControls] Listening');
    }

    /**
     * Called once per frame by InputManager.
     * Clears per-frame "pressed" and "released" buffers so they only fire once.
     */
    update() {
        this.keysPressed.clear();
        this.keysReleased.clear();
        this.triggeredActions.clear();
        this.releasedActions.clear();
    }

    /**
     * Stop listening and clean up
     */
    dispose() {
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        window.removeEventListener('blur', this._onBlur);
        this.keysDown.clear();
        this.keysPressed.clear();
        this.keysReleased.clear();
        this.activeActions.clear();
        this.triggeredActions.clear();
        this.releasedActions.clear();
        console.log('[KeyboardControls] Disposed');
    }

    // ─── Event Handlers ──────────────────────────────────────────────────────

    /**
     * Handle keydown
     * @private
     * @param {KeyboardEvent} e
     */
    _onKeyDown(e) {
        // Prevent default for game-bound keys so the browser doesn't scroll, etc.
        if (this.preventDefaultKeys.has(e.code)) {
            e.preventDefault();
        }

        // If we're in rebinding mode, capture this key and return
        if (this.rebinding) {
            this._handleRebind(e.code);
            e.preventDefault();
            return;
        }

        if (!this.enabled) return;

        const code = e.code;

        // Only register if not already held (ignore key repeat)
        if (!this.keysDown.has(code)) {
            this.keysDown.add(code);
            this.keysPressed.add(code);

            // Map to actions
            const actions = this.bindings.getActionsForKey(code);
            for (const { action } of actions) {
                if (!this.activeActions.has(action)) {
                    this.activeActions.add(action);
                    this.triggeredActions.add(action);
                }
            }
        }
    }

    /**
     * Handle keyup
     * @private
     * @param {KeyboardEvent} e
     */
    _onKeyUp(e) {
        if (!this.enabled) return;

        const code = e.code;

        if (this.keysDown.has(code)) {
            this.keysDown.delete(code);
            this.keysReleased.add(code);

            // Map to actions — only deactivate if NO other key for that action is held
            const actions = this.bindings.getActionsForKey(code);
            for (const { action } of actions) {
                if (this._isActionStillHeld(action)) continue;
                this.activeActions.delete(action);
                this.releasedActions.add(action);
            }
        }
    }

    /**
     * Handle window blur — release all keys to prevent stuck keys
     * @private
     */
    _onBlur() {
        // Move all active to released
        for (const action of this.activeActions) {
            this.releasedActions.add(action);
        }
        this.keysDown.clear();
        this.activeActions.clear();
    }

    // ─── Key State Queries ───────────────────────────────────────────────────

    /**
     * Is the key currently held down?
     * @param {string} code - KeyboardEvent.code
     * @returns {boolean}
     */
    isKeyDown(code) {
        return this.keysDown.has(code);
    }

    /**
     * Was the key pressed this frame? (single-fire, not held)
     * @param {string} code - KeyboardEvent.code
     * @returns {boolean}
     */
    wasKeyPressed(code) {
        return this.keysPressed.has(code);
    }

    /**
     * Was the key released this frame?
     * @param {string} code - KeyboardEvent.code
     * @returns {boolean}
     */
    wasKeyReleased(code) {
        return this.keysReleased.has(code);
    }

    // ─── Action State Queries ────────────────────────────────────────────────

    /**
     * Is the action currently active (held)?
     * @param {string} action - Action name
     * @returns {boolean}
     */
    isActionActive(action) {
        return this.activeActions.has(action);
    }

    /**
     * Was the action just triggered this frame?
     * @param {string} action - Action name
     * @returns {boolean}
     */
    wasActionTriggered(action) {
        return this.triggeredActions.has(action);
    }

    /**
     * Was the action released this frame?
     * @param {string} action - Action name
     * @returns {boolean}
     */
    wasActionReleased(action) {
        return this.releasedActions.has(action);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    /**
     * Check if an action still has at least one of its bound keys held down
     * @private
     * @param {string} action - Action name
     * @returns {boolean}
     */
    _isActionStillHeld(action) {
        const binding = this.bindings.getBinding(action);
        if (!binding) return false;
        return binding.keyboard.some(code => this.keysDown.has(code));
    }

    // ─── Rebinding ───────────────────────────────────────────────────────────

    /**
     * Enter rebinding mode: the next keypress will be captured and
     * passed to the callback instead of being processed normally.
     * @param {Function} callback - (code: string) => void
     */
    startRebind(callback) {
        this.rebinding = true;
        this.rebindCallback = callback;
        console.log('[KeyboardControls] Rebinding mode ON — press a key...');
    }

    /**
     * Cancel rebinding mode without binding anything
     */
    cancelRebind() {
        this.rebinding = false;
        this.rebindCallback = null;
    }

    /**
     * Handle a key captured during rebinding
     * @private
     * @param {string} code
     */
    _handleRebind(code) {
        this.rebinding = false;
        if (this.rebindCallback) {
            this.rebindCallback(code);
            this.rebindCallback = null;
        }
    }

    // ─── Debug ───────────────────────────────────────────────────────────────

    /**
     * Get debug snapshot of keyboard state
     * @returns {Object}
     */
    getDebugInfo() {
        return {
            enabled: this.enabled,
            keysDown: Array.from(this.keysDown),
            activeActions: Array.from(this.activeActions),
            triggeredActions: Array.from(this.triggeredActions),
            releasedActions: Array.from(this.releasedActions),
            rebinding: this.rebinding
        };
    }
}