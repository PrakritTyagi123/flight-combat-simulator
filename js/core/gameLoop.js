/**
 * gameLoop.js — Main Game Loop
 * 
 * Implements a fixed-timestep game loop with variable rendering.
 * Physics/logic updates run at a fixed rate (default 60Hz) for deterministic
 * simulation, while rendering happens as fast as possible via requestAnimationFrame.
 * Includes performance metrics (FPS, frame time, update time) and pause/resume.
 */

// ─── Loop Configuration ──────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
    fixedTimestep: 1 / 60,      // Physics tick rate: 60 Hz
    maxDeltaTime: 0.1,           // Cap delta to prevent spiral of death
    maxUpdatesPerFrame: 5,       // Max physics steps per render frame
    targetFPS: 60,               // Target rendering FPS (for metrics, not limiting)
    enableMetrics: true          // Track performance metrics
};

// ─── GameLoop Class ──────────────────────────────────────────────────────────
export class GameLoop {
    /**
     * @param {Object} [config={}] - Loop configuration overrides
     */
    constructor(config = {}) {
        /** @type {Object} Merged configuration */
        this.config = { ...DEFAULT_CONFIG, ...config };

        /** @type {boolean} Whether the loop is currently running */
        this.running = false;

        /** @type {boolean} Whether the loop is paused (still runs but skips updates) */
        this.paused = false;

        /** @type {number|null} requestAnimationFrame ID */
        this.rafId = null;

        /** @type {number} Accumulated time for fixed-step updates */
        this.accumulator = 0;

        /** @type {number} Last timestamp from rAF */
        this.lastTime = 0;

        /** @type {number} Current delta time (in seconds) */
        this.deltaTime = 0;

        /** @type {number} Total elapsed time since loop start (in seconds) */
        this.elapsedTime = 0;

        /** @type {number} Current frame count */
        this.frameCount = 0;

        /** @type {number} Current physics tick count */
        this.tickCount = 0;

        // ─── Callback References ─────────────────────────────────────────────
        /** @type {Function|null} Fixed update callback (physics, AI, etc.) */
        this.onFixedUpdate = null;

        /** @type {Function|null} Variable update callback (animations, interpolation) */
        this.onUpdate = null;

        /** @type {Function|null} Late update callback (camera, post-processing) */
        this.onLateUpdate = null;

        /** @type {Function|null} Render callback */
        this.onRender = null;

        // ─── Performance Metrics ─────────────────────────────────────────────
        /** @type {Object} Performance tracking data */
        this.metrics = {
            fps: 0,
            frameTime: 0,
            updateTime: 0,
            renderTime: 0,
            fixedUpdateCount: 0,

            // Rolling averages
            _fpsAccum: 0,
            _frameCount: 0,
            _lastFPSUpdate: 0,
            _frameTimes: [],
            _maxSamples: 60
        };

        // Bind the loop function so it keeps correct `this` context
        this._loop = this._loop.bind(this);

        console.log('[GameLoop] Initialized', this.config);
    }

    // ─── Control ─────────────────────────────────────────────────────────────

    /**
     * Start the game loop
     */
    start() {
        if (this.running) {
            console.warn('[GameLoop] Already running');
            return;
        }

        this.running = true;
        this.paused = false;
        this.lastTime = performance.now();
        this.accumulator = 0;
        this.frameCount = 0;
        this.tickCount = 0;
        this.elapsedTime = 0;

        // Reset metrics
        this.metrics._lastFPSUpdate = this.lastTime;
        this.metrics._fpsAccum = 0;
        this.metrics._frameCount = 0;
        this.metrics._frameTimes = [];

        console.log('[GameLoop] Started');
        this.rafId = requestAnimationFrame(this._loop);
    }

    /**
     * Stop the game loop completely
     */
    stop() {
        if (!this.running) return;

        this.running = false;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        console.log('[GameLoop] Stopped');
    }

    /**
     * Pause the loop (rendering continues but updates are skipped)
     */
    pause() {
        if (this.paused) return;
        this.paused = true;
        console.log('[GameLoop] Paused');
    }

    /**
     * Resume from pause
     */
    resume() {
        if (!this.paused) return;
        this.paused = false;
        // Reset lastTime to prevent a huge delta spike after unpause
        this.lastTime = performance.now();
        this.accumulator = 0;
        console.log('[GameLoop] Resumed');
    }

    /**
     * Toggle pause state
     * @returns {boolean} New paused state
     */
    togglePause() {
        if (this.paused) {
            this.resume();
        } else {
            this.pause();
        }
        return this.paused;
    }

    // ─── Callback Registration ───────────────────────────────────────────────

    /**
     * Set the fixed-timestep update callback (physics, game logic, AI)
     * Called at a fixed rate regardless of frame rate.
     * @param {Function} callback - (fixedDelta: number, tickCount: number)
     */
    setFixedUpdate(callback) {
        this.onFixedUpdate = callback;
    }

    /**
     * Set the variable update callback (animations, interpolation)
     * Called once per frame with the actual delta time.
     * @param {Function} callback - (deltaTime: number, elapsedTime: number)
     */
    setUpdate(callback) {
        this.onUpdate = callback;
    }

    /**
     * Set the late update callback (camera follow, post-processing setup)
     * Called after update, before render.
     * @param {Function} callback - (deltaTime: number)
     */
    setLateUpdate(callback) {
        this.onLateUpdate = callback;
    }

    /**
     * Set the render callback
     * Called once per frame after all updates.
     * @param {Function} callback - (interpolation: number)
     */
    setRender(callback) {
        this.onRender = callback;
    }

    // ─── Main Loop ───────────────────────────────────────────────────────────

    /**
     * The core loop function called by requestAnimationFrame
     * @private
     * @param {DOMHighResTimeStamp} timestamp - Current time in ms
     */
    _loop(timestamp) {
        if (!this.running) return;

        // Schedule next frame immediately
        this.rafId = requestAnimationFrame(this._loop);

        const frameStart = performance.now();

        // ─── Calculate Delta Time ────────────────────────────────────────
        let rawDelta = (timestamp - this.lastTime) / 1000; // Convert ms → seconds
        this.lastTime = timestamp;

        // Clamp delta to prevent spiral of death (e.g., after tab switch)
        if (rawDelta > this.config.maxDeltaTime) {
            rawDelta = this.config.maxDeltaTime;
        }

        // Discard negative or zero deltas (can happen on first frame)
        if (rawDelta <= 0) rawDelta = this.config.fixedTimestep;

        this.deltaTime = rawDelta;
        this.frameCount++;

        // ─── Fixed-Step Updates (Physics, Logic) ─────────────────────────
        let fixedUpdates = 0;

        if (!this.paused) {
            this.accumulator += rawDelta;
            const updateStart = performance.now();

            while (this.accumulator >= this.config.fixedTimestep
                   && fixedUpdates < this.config.maxUpdatesPerFrame) {
                
                if (this.onFixedUpdate) {
                    this.onFixedUpdate(this.config.fixedTimestep, this.tickCount);
                }

                this.accumulator -= this.config.fixedTimestep;
                this.tickCount++;
                fixedUpdates++;
            }

            this.metrics.updateTime = performance.now() - updateStart;
        }

        // ─── Variable Update ─────────────────────────────────────────
        // ALWAYS called, even when paused, so that input polling and
        // pause/unpause detection work correctly. Game systems inside
        // _update() gate themselves on game state.
        this.elapsedTime += rawDelta;

        if (this.onUpdate) {
            this.onUpdate(rawDelta, this.elapsedTime);
        }

        // ─── Late Update ─────────────────────────────────────────────
        if (!this.paused) {
            if (this.onLateUpdate) {
                this.onLateUpdate(rawDelta);
            }
        }

        // ─── Render ──────────────────────────────────────────────────────
        // Always render, even when paused (so the scene remains visible)
        const renderStart = performance.now();
        const interpolation = this.accumulator / this.config.fixedTimestep;

        if (this.onRender) {
            this.onRender(interpolation);
        }

        this.metrics.renderTime = performance.now() - renderStart;

        // ─── Update Metrics ──────────────────────────────────────────────
        if (this.config.enableMetrics) {
            this._updateMetrics(frameStart, fixedUpdates);
        }
    }

    // ─── Performance Metrics ─────────────────────────────────────────────────

    /**
     * Update performance tracking data
     * @private
     * @param {number} frameStart - Timestamp when this frame started processing
     * @param {number} fixedUpdates - Number of fixed updates this frame
     */
    _updateMetrics(frameStart, fixedUpdates) {
        const now = performance.now();
        const frameTime = now - frameStart;

        // Rolling frame time samples
        this.metrics._frameTimes.push(frameTime);
        if (this.metrics._frameTimes.length > this.metrics._maxSamples) {
            this.metrics._frameTimes.shift();
        }

        this.metrics.frameTime = frameTime;
        this.metrics.fixedUpdateCount = fixedUpdates;

        // FPS calculation (update once per second)
        this.metrics._frameCount++;
        const elapsed = now - this.metrics._lastFPSUpdate;
        if (elapsed >= 1000) {
            this.metrics.fps = Math.round(
                (this.metrics._frameCount * 1000) / elapsed
            );
            this.metrics._frameCount = 0;
            this.metrics._lastFPSUpdate = now;
        }
    }

    /**
     * Get current performance metrics
     * @returns {Object} Performance data
     */
    getMetrics() {
        const avgFrameTime = this.metrics._frameTimes.length > 0
            ? this.metrics._frameTimes.reduce((a, b) => a + b, 0) / this.metrics._frameTimes.length
            : 0;

        return {
            fps: this.metrics.fps,
            frameTime: this.metrics.frameTime.toFixed(2) + 'ms',
            avgFrameTime: avgFrameTime.toFixed(2) + 'ms',
            updateTime: this.metrics.updateTime.toFixed(2) + 'ms',
            renderTime: this.metrics.renderTime.toFixed(2) + 'ms',
            fixedUpdatesThisFrame: this.metrics.fixedUpdateCount,
            totalFrames: this.frameCount,
            totalTicks: this.tickCount,
            elapsedTime: this.elapsedTime.toFixed(1) + 's',
            isPaused: this.paused,
            isRunning: this.running
        };
    }

    // ─── Configuration ───────────────────────────────────────────────────────

    /**
     * Update the fixed timestep (changes physics tick rate)
     * @param {number} hz - New tick rate in Hz (e.g., 60, 120)
     */
    setTickRate(hz) {
        this.config.fixedTimestep = 1 / hz;
        console.log(`[GameLoop] Tick rate set to ${hz} Hz`);
    }

    /**
     * Get the current fixed timestep
     * @returns {number} Fixed timestep in seconds
     */
    getFixedTimestep() {
        return this.config.fixedTimestep;
    }

    // ─── Debug ───────────────────────────────────────────────────────────────

    /**
     * Get detailed debug information
     * @returns {Object}
     */
    getDebugInfo() {
        return {
            ...this.getMetrics(),
            config: { ...this.config },
            accumulator: this.accumulator.toFixed(4),
            deltaTime: this.deltaTime.toFixed(4),
            callbacks: {
                fixedUpdate: !!this.onFixedUpdate,
                update: !!this.onUpdate,
                lateUpdate: !!this.onLateUpdate,
                render: !!this.onRender
            }
        };
    }

    /**
     * Clean up the game loop
     */
    dispose() {
        this.stop();
        this.onFixedUpdate = null;
        this.onUpdate = null;
        this.onLateUpdate = null;
        this.onRender = null;
        console.log('[GameLoop] Disposed');
    }
}