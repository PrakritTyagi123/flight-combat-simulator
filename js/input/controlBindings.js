/**
 * controlBindings.js — Remappable Control Bindings
 * 
 * Defines every game action and its default keyboard, mouse, and gamepad bindings.
 * Supports runtime rebinding, conflict detection, multiple bindings per action,
 * and serialization for save/load. This is the single source of truth for
 * "what physical input maps to what game action."
 * 
 * Actions are grouped by context (flight, combat, camera, menu, debug) so that
 * the same physical key can mean different things in different contexts.
 */

// ─── Input Source Types ──────────────────────────────────────────────────────
export const InputSource = Object.freeze({
    KEYBOARD: 'keyboard',
    MOUSE:    'mouse',
    GAMEPAD:  'gamepad'
});

// ─── Action Contexts ─────────────────────────────────────────────────────────
// Actions are scoped to contexts so bindings don't conflict across modes
export const InputContext = Object.freeze({
    FLIGHT:  'flight',    // In-flight aircraft controls
    COMBAT:  'combat',    // Weapons and targeting
    CAMERA:  'camera',    // Camera switching and freelook
    MENU:    'menu',      // Menu navigation
    DEBUG:   'debug',     // Debug overlay toggles
    GLOBAL:  'global'     // Always active (pause, screenshot, etc.)
});

// ─── Action Names ────────────────────────────────────────────────────────────
// Every bindable action in the game
export const Actions = Object.freeze({
    // ── Flight ───────────────────────────────────────────────────────────
    PITCH_UP:        'pitch_up',
    PITCH_DOWN:      'pitch_down',
    ROLL_LEFT:       'roll_left',
    ROLL_RIGHT:      'roll_right',
    YAW_LEFT:        'yaw_left',
    YAW_RIGHT:       'yaw_right',
    THROTTLE_UP:     'throttle_up',
    THROTTLE_DOWN:   'throttle_down',
    AFTERBURNER:     'afterburner',
    AIRBRAKE:        'airbrake',
    FLAPS_TOGGLE:    'flaps_toggle',
    GEAR_TOGGLE:     'gear_toggle',
    TRIM_UP:         'trim_up',
    TRIM_DOWN:       'trim_down',

    // ── Combat ───────────────────────────────────────────────────────────
    FIRE_PRIMARY:    'fire_primary',     // Guns
    FIRE_SECONDARY:  'fire_secondary',   // Missiles
    FIRE_SPECIAL:    'fire_special',     // Bombs/rockets
    CYCLE_WEAPON:    'cycle_weapon',
    LOCK_TARGET:     'lock_target',
    NEXT_TARGET:     'next_target',
    PREV_TARGET:     'prev_target',
    COUNTERMEASURES: 'countermeasures',  // Flares/chaff

    // ── Camera ───────────────────────────────────────────────────────────
    CAMERA_CYCLE:    'camera_cycle',
    CAMERA_CHASE:    'camera_chase',
    CAMERA_COCKPIT:  'camera_cockpit',
    CAMERA_MISSILE:  'camera_missile',
    CAMERA_CINEMATIC:'camera_cinematic',
    FREELOOK:        'freelook',         // Hold to look around with mouse
    LOOK_BACK:       'look_back',

    // ── Menu / Global ────────────────────────────────────────────────────
    PAUSE:           'pause',
    MENU_UP:         'menu_up',
    MENU_DOWN:       'menu_down',
    MENU_LEFT:       'menu_left',
    MENU_RIGHT:      'menu_right',
    MENU_SELECT:     'menu_select',
    MENU_BACK:       'menu_back',
    SCREENSHOT:      'screenshot',

    // ── Debug ────────────────────────────────────────────────────────────
    DEBUG_TOGGLE:    'debug_toggle',
    DEBUG_PHYSICS:   'debug_physics',
    DEBUG_AI:        'debug_ai',
    DEBUG_COLLISION: 'debug_collision',
    DEBUG_FPS:       'debug_fps'
});

// ─── Default Binding Definitions ─────────────────────────────────────────────
// Each entry: { action, context, keyboard?, mouse?, gamepad? }
// keyboard values are KeyboardEvent.code strings
// mouse values are button indices (0=left, 1=middle, 2=right) or 'wheel_up'/'wheel_down'
// gamepad values are { type: 'button'|'axis', index, direction? }
const DEFAULT_BINDINGS = [
    // ═══ FLIGHT ═══════════════════════════════════════════════════════════════
    { action: Actions.PITCH_DOWN,    context: InputContext.FLIGHT,  keyboard: ['KeyW', 'ArrowUp'],    gamepad: { type: 'axis', index: 1, direction: -1 } },
    { action: Actions.PITCH_UP,      context: InputContext.FLIGHT,  keyboard: ['KeyS', 'ArrowDown'],  gamepad: { type: 'axis', index: 1, direction: 1 } },
    { action: Actions.ROLL_LEFT,     context: InputContext.FLIGHT,  keyboard: ['KeyA', 'ArrowLeft'],  gamepad: { type: 'axis', index: 0, direction: -1 } },
    { action: Actions.ROLL_RIGHT,    context: InputContext.FLIGHT,  keyboard: ['KeyD', 'ArrowRight'], gamepad: { type: 'axis', index: 0, direction: 1 } },
    { action: Actions.YAW_LEFT,      context: InputContext.FLIGHT,  keyboard: ['KeyQ'],               gamepad: { type: 'axis', index: 2, direction: -1 } },
    { action: Actions.YAW_RIGHT,     context: InputContext.FLIGHT,  keyboard: ['KeyE'],               gamepad: { type: 'axis', index: 2, direction: 1 } },
    { action: Actions.THROTTLE_UP,   context: InputContext.FLIGHT,  keyboard: ['ShiftLeft'],          gamepad: { type: 'axis', index: 3, direction: -1 } },
    { action: Actions.THROTTLE_DOWN, context: InputContext.FLIGHT,  keyboard: ['ControlLeft'],        gamepad: { type: 'axis', index: 3, direction: 1 } },
    { action: Actions.AFTERBURNER,   context: InputContext.FLIGHT,  keyboard: ['Tab'],                gamepad: { type: 'button', index: 5 } },
    { action: Actions.AIRBRAKE,      context: InputContext.FLIGHT,  keyboard: ['KeyB'],               gamepad: { type: 'button', index: 4 } },
    { action: Actions.FLAPS_TOGGLE,  context: InputContext.FLIGHT,  keyboard: ['KeyF'],               gamepad: { type: 'button', index: 3 } },
    { action: Actions.GEAR_TOGGLE,   context: InputContext.FLIGHT,  keyboard: ['KeyG'],               gamepad: { type: 'button', index: 2 } },
    { action: Actions.TRIM_UP,       context: InputContext.FLIGHT,  keyboard: ['Numpad8']  },
    { action: Actions.TRIM_DOWN,     context: InputContext.FLIGHT,  keyboard: ['Numpad2']  },

    // ═══ COMBAT ═══════════════════════════════════════════════════════════════
    { action: Actions.FIRE_PRIMARY,    context: InputContext.COMBAT,  keyboard: ['Space'],      mouse: [0],     gamepad: { type: 'button', index: 7 } },
    { action: Actions.FIRE_SECONDARY,  context: InputContext.COMBAT,  keyboard: ['Enter'],      mouse: [2],     gamepad: { type: 'button', index: 6 } },
    { action: Actions.FIRE_SPECIAL,    context: InputContext.COMBAT,  keyboard: ['KeyR'],                       gamepad: { type: 'button', index: 1 } },
    { action: Actions.CYCLE_WEAPON,    context: InputContext.COMBAT,  keyboard: ['KeyX'],       mouse: ['wheel_down'], gamepad: { type: 'button', index: 13 } },
    { action: Actions.LOCK_TARGET,     context: InputContext.COMBAT,  keyboard: ['KeyT'],       mouse: [1],     gamepad: { type: 'button', index: 0 } },
    { action: Actions.NEXT_TARGET,     context: InputContext.COMBAT,  keyboard: ['BracketRight'],               gamepad: { type: 'button', index: 15 } },
    { action: Actions.PREV_TARGET,     context: InputContext.COMBAT,  keyboard: ['BracketLeft'],                gamepad: { type: 'button', index: 14 } },
    { action: Actions.COUNTERMEASURES, context: InputContext.COMBAT,  keyboard: ['KeyZ'],                       gamepad: { type: 'button', index: 10 } },

    // ═══ CAMERA ═══════════════════════════════════════════════════════════════
    { action: Actions.CAMERA_CYCLE,     context: InputContext.CAMERA, keyboard: ['KeyC'],               gamepad: { type: 'button', index: 11 } },
    { action: Actions.CAMERA_CHASE,     context: InputContext.CAMERA, keyboard: ['Digit1'] },
    { action: Actions.CAMERA_COCKPIT,   context: InputContext.CAMERA, keyboard: ['Digit2'] },
    { action: Actions.CAMERA_MISSILE,   context: InputContext.CAMERA, keyboard: ['Digit3'] },
    { action: Actions.CAMERA_CINEMATIC, context: InputContext.CAMERA, keyboard: ['Digit4'] },
    { action: Actions.FREELOOK,         context: InputContext.CAMERA, keyboard: ['AltLeft'],   mouse: [2] },
    { action: Actions.LOOK_BACK,        context: InputContext.CAMERA, keyboard: ['KeyV'] },

    // ═══ MENU / GLOBAL ════════════════════════════════════════════════════════
    { action: Actions.PAUSE,       context: InputContext.GLOBAL, keyboard: ['Escape'],           gamepad: { type: 'button', index: 9 } },
    { action: Actions.MENU_UP,     context: InputContext.MENU,   keyboard: ['ArrowUp', 'KeyW'],  gamepad: { type: 'button', index: 12 } },
    { action: Actions.MENU_DOWN,   context: InputContext.MENU,   keyboard: ['ArrowDown', 'KeyS'],gamepad: { type: 'button', index: 13 } },
    { action: Actions.MENU_LEFT,   context: InputContext.MENU,   keyboard: ['ArrowLeft', 'KeyA'],gamepad: { type: 'button', index: 14 } },
    { action: Actions.MENU_RIGHT,  context: InputContext.MENU,   keyboard: ['ArrowRight','KeyD'],gamepad: { type: 'button', index: 15 } },
    { action: Actions.MENU_SELECT, context: InputContext.MENU,   keyboard: ['Enter', 'Space'],   gamepad: { type: 'button', index: 0 } },
    { action: Actions.MENU_BACK,   context: InputContext.MENU,   keyboard: ['Escape', 'Backspace'], gamepad: { type: 'button', index: 1 } },
    { action: Actions.SCREENSHOT,  context: InputContext.GLOBAL, keyboard: ['F12'] },

    // ═══ DEBUG ════════════════════════════════════════════════════════════════
    { action: Actions.DEBUG_TOGGLE,    context: InputContext.DEBUG, keyboard: ['Backquote'] },
    { action: Actions.DEBUG_PHYSICS,   context: InputContext.DEBUG, keyboard: ['F1'] },
    { action: Actions.DEBUG_AI,        context: InputContext.DEBUG, keyboard: ['F2'] },
    { action: Actions.DEBUG_COLLISION, context: InputContext.DEBUG, keyboard: ['F3'] },
    { action: Actions.DEBUG_FPS,       context: InputContext.DEBUG, keyboard: ['F4'] }
];


// ─── ControlBindings Class ───────────────────────────────────────────────────
export class ControlBindings {
    constructor() {
        /**
         * Internal binding storage.
         * Map<action, { context, keyboard: string[], mouse: (number|string)[], gamepad: Object|null }>
         * @type {Map<string, Object>}
         */
        this.bindings = new Map();

        /**
         * Reverse lookup: keyboard code → action(s)
         * @type {Map<string, { action: string, context: string }[]>}
         */
        this.keyboardMap = new Map();

        /**
         * Reverse lookup: mouse button/wheel → action(s)
         * @type {Map<string, { action: string, context: string }[]>}
         */
        this.mouseMap = new Map();

        /**
         * Reverse lookup: gamepad button index → action(s)
         * @type {Map<number, { action: string, context: string }[]>}
         */
        this.gamepadButtonMap = new Map();

        /**
         * Gamepad axis bindings
         * @type {{ action: string, context: string, axis: number, direction: number }[]}
         */
        this.gamepadAxisBindings = [];

        // Load default bindings
        this._loadDefaults();

        console.log('[ControlBindings] Initialized with', this.bindings.size, 'actions');
    }

    // ─── Initialization ──────────────────────────────────────────────────────

    /**
     * Load the default binding set and build reverse-lookup maps
     * @private
     */
    _loadDefaults() {
        this.bindings.clear();
        this.keyboardMap.clear();
        this.mouseMap.clear();
        this.gamepadButtonMap.clear();
        this.gamepadAxisBindings = [];

        for (const def of DEFAULT_BINDINGS) {
            const binding = {
                context:  def.context,
                keyboard: def.keyboard || [],
                mouse:    def.mouse || [],
                gamepad:  def.gamepad || null
            };
            this.bindings.set(def.action, binding);
        }

        this._rebuildReverseMaps();
    }

    /**
     * Rebuild all reverse-lookup maps from the canonical bindings map.
     * Must be called after any binding mutation.
     * @private
     */
    _rebuildReverseMaps() {
        this.keyboardMap.clear();
        this.mouseMap.clear();
        this.gamepadButtonMap.clear();
        this.gamepadAxisBindings = [];

        for (const [action, binding] of this.bindings) {
            const ref = { action, context: binding.context };

            // Keyboard codes
            for (const code of binding.keyboard) {
                if (!this.keyboardMap.has(code)) this.keyboardMap.set(code, []);
                this.keyboardMap.get(code).push(ref);
            }

            // Mouse buttons / wheel
            for (const btn of binding.mouse) {
                const key = String(btn);
                if (!this.mouseMap.has(key)) this.mouseMap.set(key, []);
                this.mouseMap.get(key).push(ref);
            }

            // Gamepad
            if (binding.gamepad) {
                const gp = binding.gamepad;
                if (gp.type === 'button') {
                    if (!this.gamepadButtonMap.has(gp.index)) this.gamepadButtonMap.set(gp.index, []);
                    this.gamepadButtonMap.get(gp.index).push(ref);
                } else if (gp.type === 'axis') {
                    this.gamepadAxisBindings.push({
                        action,
                        context: binding.context,
                        axis: gp.index,
                        direction: gp.direction || 1
                    });
                }
            }
        }
    }

    // ─── Queries ─────────────────────────────────────────────────────────────

    /**
     * Look up which actions a keyboard code triggers
     * @param {string} code - KeyboardEvent.code (e.g. 'KeyW', 'Space')
     * @returns {{ action: string, context: string }[]}
     */
    getActionsForKey(code) {
        return this.keyboardMap.get(code) || [];
    }

    /**
     * Look up which actions a mouse input triggers
     * @param {number|string} button - Button index or 'wheel_up'/'wheel_down'
     * @returns {{ action: string, context: string }[]}
     */
    getActionsForMouseButton(button) {
        return this.mouseMap.get(String(button)) || [];
    }

    /**
     * Look up which actions a gamepad button triggers
     * @param {number} index - Gamepad button index
     * @returns {{ action: string, context: string }[]}
     */
    getActionsForGamepadButton(index) {
        return this.gamepadButtonMap.get(index) || [];
    }

    /**
     * Get all gamepad axis bindings
     * @returns {{ action: string, context: string, axis: number, direction: number }[]}
     */
    getGamepadAxisBindings() {
        return this.gamepadAxisBindings;
    }

    /**
     * Get the full binding definition for an action
     * @param {string} action - Action name
     * @returns {Object|undefined}
     */
    getBinding(action) {
        return this.bindings.get(action);
    }

    /**
     * Get the context for an action
     * @param {string} action - Action name
     * @returns {string|undefined}
     */
    getContext(action) {
        return this.bindings.get(action)?.context;
    }

    // ─── Rebinding ───────────────────────────────────────────────────────────

    /**
     * Rebind a keyboard key for an action (replaces all keyboard keys for that action)
     * @param {string} action - Action name
     * @param {string[]} codes - New KeyboardEvent.code values
     * @returns {boolean} Whether the rebind succeeded
     */
    rebindKeyboard(action, codes) {
        const binding = this.bindings.get(action);
        if (!binding) {
            console.warn(`[ControlBindings] Unknown action: ${action}`);
            return false;
        }
        binding.keyboard = [...codes];
        this._rebuildReverseMaps();
        console.log(`[ControlBindings] Rebound ${action} keyboard → [${codes.join(', ')}]`);
        return true;
    }

    /**
     * Rebind a mouse button for an action
     * @param {string} action - Action name
     * @param {(number|string)[]} buttons - Button indices or wheel strings
     * @returns {boolean}
     */
    rebindMouse(action, buttons) {
        const binding = this.bindings.get(action);
        if (!binding) return false;
        binding.mouse = [...buttons];
        this._rebuildReverseMaps();
        return true;
    }

    /**
     * Rebind a gamepad input for an action
     * @param {string} action - Action name
     * @param {Object} gamepadDef - { type: 'button'|'axis', index, direction? }
     * @returns {boolean}
     */
    rebindGamepad(action, gamepadDef) {
        const binding = this.bindings.get(action);
        if (!binding) return false;
        binding.gamepad = { ...gamepadDef };
        this._rebuildReverseMaps();
        return true;
    }

    /**
     * Check if a keyboard code already has a binding and return conflicts
     * @param {string} code - KeyboardEvent.code
     * @param {string} [excludeAction] - Action to exclude from conflict check
     * @returns {{ action: string, context: string }[]} Conflicting bindings
     */
    findKeyConflicts(code, excludeAction) {
        const existing = this.keyboardMap.get(code) || [];
        return excludeAction
            ? existing.filter(e => e.action !== excludeAction)
            : existing;
    }

    // ─── Serialization (Save/Load) ───────────────────────────────────────────

    /**
     * Export current bindings as a plain JSON-serializable object
     * @returns {Object}
     */
    serialize() {
        const data = {};
        for (const [action, binding] of this.bindings) {
            data[action] = {
                context:  binding.context,
                keyboard: [...binding.keyboard],
                mouse:    [...binding.mouse],
                gamepad:  binding.gamepad ? { ...binding.gamepad } : null
            };
        }
        return data;
    }

    /**
     * Import bindings from a serialized object (e.g. from localStorage)
     * @param {Object} data - Previously serialized bindings
     */
    deserialize(data) {
        if (!data || typeof data !== 'object') return;

        for (const [action, binding] of Object.entries(data)) {
            if (this.bindings.has(action)) {
                const current = this.bindings.get(action);
                if (binding.keyboard) current.keyboard = binding.keyboard;
                if (binding.mouse)    current.mouse = binding.mouse;
                if (binding.gamepad !== undefined) current.gamepad = binding.gamepad;
            }
        }
        this._rebuildReverseMaps();
        console.log('[ControlBindings] Loaded saved bindings');
    }

    /**
     * Reset all bindings back to defaults
     */
    resetToDefaults() {
        this._loadDefaults();
        console.log('[ControlBindings] Reset to defaults');
    }

    // ─── Debug ───────────────────────────────────────────────────────────────

    /**
     * Get a human-readable summary of all bindings
     * @returns {Object}
     */
    getDebugInfo() {
        const summary = {};
        for (const [action, binding] of this.bindings) {
            summary[action] = {
                ctx: binding.context,
                keys: binding.keyboard.join('+') || '—',
                mouse: binding.mouse.length ? binding.mouse.join(',') : '—',
                gamepad: binding.gamepad
                    ? `${binding.gamepad.type}:${binding.gamepad.index}`
                    : '—'
            };
        }
        return summary;
    }

    /**
     * Clean up
     */
    dispose() {
        this.bindings.clear();
        this.keyboardMap.clear();
        this.mouseMap.clear();
        this.gamepadButtonMap.clear();
        this.gamepadAxisBindings = [];
    }
}