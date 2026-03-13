/**
 * gameState.js — Game State Manager
 * 
 * Manages all game states (BOOT, MENU, PLAYING, PAUSED, LOADING, GAME_OVER, MISSION_COMPLETE).
 * Implements a finite state machine with enter/exit callbacks, state history,
 * and an event-driven notification system so other systems can react to state changes.
 */

// ─── State Enum ──────────────────────────────────────────────────────────────
export const GameStates = Object.freeze({
    BOOT:             'BOOT',
    LOADING:          'LOADING',
    MENU:             'MENU',
    MAP_SELECT:       'MAP_SELECT',
    PLANE_SELECT:     'PLANE_SELECT',
    MISSION_BRIEFING: 'MISSION_BRIEFING',
    PLAYING:          'PLAYING',
    PAUSED:           'PAUSED',
    GAME_OVER:        'GAME_OVER',
    MISSION_COMPLETE: 'MISSION_COMPLETE',
    SETTINGS:         'SETTINGS',
    DEBUG:            'DEBUG'
});

// ─── Valid State Transitions ─────────────────────────────────────────────────
// Defines which states can transition to which other states
const VALID_TRANSITIONS = {
    [GameStates.BOOT]:             [GameStates.LOADING],
    [GameStates.LOADING]:          [GameStates.MENU, GameStates.PLAYING, GameStates.MAP_SELECT],
    [GameStates.MENU]:             [GameStates.MAP_SELECT, GameStates.SETTINGS, GameStates.LOADING],
    [GameStates.MAP_SELECT]:       [GameStates.PLANE_SELECT, GameStates.MENU],
    [GameStates.PLANE_SELECT]:     [GameStates.MISSION_BRIEFING, GameStates.MAP_SELECT],
    [GameStates.MISSION_BRIEFING]: [GameStates.LOADING, GameStates.PLAYING, GameStates.PLANE_SELECT],
    [GameStates.PLAYING]:          [GameStates.PAUSED, GameStates.GAME_OVER, GameStates.MISSION_COMPLETE, GameStates.DEBUG],
    [GameStates.PAUSED]:           [GameStates.PLAYING, GameStates.MENU, GameStates.SETTINGS],
    [GameStates.GAME_OVER]:        [GameStates.MENU, GameStates.LOADING, GameStates.PLAYING],
    [GameStates.MISSION_COMPLETE]: [GameStates.MENU, GameStates.LOADING, GameStates.PLAYING],
    [GameStates.SETTINGS]:         [GameStates.MENU, GameStates.PAUSED],
    [GameStates.DEBUG]:            [GameStates.PLAYING]
};

// ─── GameState Class ─────────────────────────────────────────────────────────
export class GameState {
    constructor() {
        /** @type {string} Current active state */
        this.currentState = GameStates.BOOT;

        /** @type {string|null} Previous state for back-navigation */
        this.previousState = null;

        /** @type {string[]} Full history of state transitions */
        this.stateHistory = [GameStates.BOOT];

        /** @type {Map<string, Set<Function>>} Event listeners for state changes */
        this.listeners = new Map();

        /** @type {Map<string, Function>} Enter callbacks for each state */
        this.enterCallbacks = new Map();

        /** @type {Map<string, Function>} Exit callbacks for each state */
        this.exitCallbacks = new Map();

        /** @type {number} Timestamp of last state change */
        this.lastTransitionTime = performance.now();

        /** @type {Object} Arbitrary data payload passed between states */
        this.stateData = {};

        /** @type {boolean} Whether to enforce valid transitions */
        this.strictMode = true;

        console.log('[GameState] Initialized in BOOT state');
    }

    // ─── State Queries ───────────────────────────────────────────────────────

    /**
     * Get the current game state
     * @returns {string} Current state
     */
    getState() {
        return this.currentState;
    }

    /**
     * Check if current state matches the given state
     * @param {string} state - State to check against
     * @returns {boolean}
     */
    is(state) {
        return this.currentState === state;
    }

    /**
     * Check if the game is in any of the given states
     * @param {...string} states - States to check
     * @returns {boolean}
     */
    isAny(...states) {
        return states.includes(this.currentState);
    }

    /**
     * Check if a transition to the given state is valid
     * @param {string} targetState - State to transition to
     * @returns {boolean}
     */
    canTransitionTo(targetState) {
        if (!this.strictMode) return true;
        const allowed = VALID_TRANSITIONS[this.currentState];
        return allowed ? allowed.includes(targetState) : false;
    }

    /**
     * Get how long (in ms) we've been in the current state
     * @returns {number} Duration in milliseconds
     */
    getTimeInCurrentState() {
        return performance.now() - this.lastTransitionTime;
    }

    // ─── State Transitions ───────────────────────────────────────────────────

    /**
     * Transition to a new state
     * @param {string} newState - Target state
     * @param {Object} [data={}] - Optional data to pass to the new state
     * @returns {boolean} Whether the transition succeeded
     */
    setState(newState, data = {}) {
        // Validate the state exists
        if (!Object.values(GameStates).includes(newState)) {
            console.error(`[GameState] Invalid state: "${newState}"`);
            return false;
        }

        // Check if transition is valid (in strict mode)
        if (this.strictMode && !this.canTransitionTo(newState)) {
            console.warn(
                `[GameState] Invalid transition: ${this.currentState} → ${newState}. ` +
                `Allowed: [${VALID_TRANSITIONS[this.currentState]?.join(', ') || 'none'}]`
            );
            return false;
        }

        // Skip if already in the target state
        if (this.currentState === newState) {
            console.warn(`[GameState] Already in state: ${newState}`);
            return false;
        }

        const oldState = this.currentState;

        // Call exit callback for the old state
        const exitCb = this.exitCallbacks.get(oldState);
        if (exitCb) {
            try {
                exitCb(oldState, newState, this.stateData);
            } catch (e) {
                console.error(`[GameState] Error in exit callback for ${oldState}:`, e);
            }
        }

        // Perform the transition
        this.previousState = oldState;
        this.currentState = newState;
        this.stateData = { ...data };
        this.lastTransitionTime = performance.now();
        this.stateHistory.push(newState);

        // Cap history length to prevent memory leaks
        if (this.stateHistory.length > 100) {
            this.stateHistory = this.stateHistory.slice(-50);
        }

        console.log(`[GameState] ${oldState} → ${newState}`, data);

        // Call enter callback for the new state
        const enterCb = this.enterCallbacks.get(newState);
        if (enterCb) {
            try {
                enterCb(newState, oldState, this.stateData);
            } catch (e) {
                console.error(`[GameState] Error in enter callback for ${newState}:`, e);
            }
        }

        // Notify all listeners
        this._notifyListeners('stateChange', { from: oldState, to: newState, data: this.stateData });
        this._notifyListeners(`enter:${newState}`, { from: oldState, data: this.stateData });
        this._notifyListeners(`exit:${oldState}`, { to: newState, data: this.stateData });

        return true;
    }

    /**
     * Force a state transition, bypassing validation (use sparingly)
     * @param {string} newState - Target state
     * @param {Object} [data={}] - Optional data
     */
    forceState(newState, data = {}) {
        const wasStrict = this.strictMode;
        this.strictMode = false;
        this.setState(newState, data);
        this.strictMode = wasStrict;
    }

    /**
     * Go back to the previous state
     * @returns {boolean} Whether the transition succeeded
     */
    goBack() {
        if (this.previousState) {
            return this.setState(this.previousState);
        }
        console.warn('[GameState] No previous state to go back to');
        return false;
    }

    // ─── Event System ────────────────────────────────────────────────────────

    /**
     * Register a listener for state change events
     * @param {string} event - Event name ('stateChange', 'enter:STATE', 'exit:STATE')
     * @param {Function} callback - Handler function
     * @returns {Function} Unsubscribe function
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);

        // Return an unsubscribe function for easy cleanup
        return () => this.off(event, callback);
    }

    /**
     * Remove a listener
     * @param {string} event - Event name
     * @param {Function} callback - Handler to remove
     */
    off(event, callback) {
        const set = this.listeners.get(event);
        if (set) {
            set.delete(callback);
            if (set.size === 0) this.listeners.delete(event);
        }
    }

    /**
     * Register an enter callback for a specific state
     * @param {string} state - State name
     * @param {Function} callback - Called when entering this state
     */
    onEnter(state, callback) {
        this.enterCallbacks.set(state, callback);
    }

    /**
     * Register an exit callback for a specific state
     * @param {string} state - State name
     * @param {Function} callback - Called when leaving this state
     */
    onExit(state, callback) {
        this.exitCallbacks.set(state, callback);
    }

    /**
     * Notify all listeners for a given event
     * @private
     * @param {string} event - Event name
     * @param {Object} data - Event data
     */
    _notifyListeners(event, data) {
        const set = this.listeners.get(event);
        if (set) {
            set.forEach(cb => {
                try {
                    cb(data);
                } catch (e) {
                    console.error(`[GameState] Error in listener for "${event}":`, e);
                }
            });
        }
    }

    // ─── State Data ──────────────────────────────────────────────────────────

    /**
     * Get a value from state data
     * @param {string} key - Data key
     * @param {*} [defaultValue=null] - Default if key not found
     * @returns {*}
     */
    getData(key, defaultValue = null) {
        return this.stateData[key] !== undefined ? this.stateData[key] : defaultValue;
    }

    /**
     * Set a value in state data without changing states
     * @param {string} key - Data key
     * @param {*} value - Data value
     */
    setData(key, value) {
        this.stateData[key] = value;
    }

    // ─── Debug / Utility ─────────────────────────────────────────────────────

    /**
     * Get a debug summary of the state machine
     * @returns {Object}
     */
    getDebugInfo() {
        return {
            currentState: this.currentState,
            previousState: this.previousState,
            timeInState: this.getTimeInCurrentState(),
            stateData: { ...this.stateData },
            historyLength: this.stateHistory.length,
            recentHistory: this.stateHistory.slice(-10),
            listenerCount: Array.from(this.listeners.entries()).map(
                ([event, set]) => ({ event, count: set.size })
            )
        };
    }

    /**
     * Reset the state machine to initial BOOT state
     */
    reset() {
        this.currentState = GameStates.BOOT;
        this.previousState = null;
        this.stateHistory = [GameStates.BOOT];
        this.stateData = {};
        this.lastTransitionTime = performance.now();
        console.log('[GameState] Reset to BOOT');
    }

    /**
     * Clean up all listeners and callbacks
     */
    dispose() {
        this.listeners.clear();
        this.enterCallbacks.clear();
        this.exitCallbacks.clear();
        this.stateHistory = [];
        this.stateData = {};
        console.log('[GameState] Disposed');
    }
}