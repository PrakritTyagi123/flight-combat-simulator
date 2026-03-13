/**
 * cameraManager.js — Camera Manager
 * 
 * Orchestrates all camera modes (chase, cockpit, cinematic, missile).
 * Reads input actions for camera switching, freelook, and look-back.
 * Provides the active camera to the engine each frame.
 * 
 * Flow: InputManager → CameraManager → active camera .update() → Engine.setCamera()
 */

import * as THREE from 'three';
import { ChaseCamera } from './chaseCamera.js';
import { CockpitCamera } from './cockpitCamera.js';
import { CinematicCamera } from './cinematicCamera.js';
import { MissileCamera } from './missileCamera.js';
import { Actions } from '../input/controlBindings.js';

// ─── Camera Mode Enum ────────────────────────────────────────────────────────
export const CameraMode = Object.freeze({
    CHASE:     'chase',
    COCKPIT:   'cockpit',
    CINEMATIC: 'cinematic',
    MISSILE:   'missile'
});

const MODE_CYCLE = [CameraMode.CHASE, CameraMode.COCKPIT, CameraMode.CINEMATIC];

// ─── CameraManager Class ─────────────────────────────────────────────────────
export class CameraManager {
    /**
     * @param {import('../input/inputManager.js').InputManager} inputManager - Input system
     * @param {import('../core/engine.js').Engine} engine - Rendering engine (for viewport info)
     */
    constructor(inputManager, engine) {
        /** @type {import('../input/inputManager.js').InputManager} */
        this.input = inputManager;

        /** @type {import('../core/engine.js').Engine} */
        this.engine = engine;

        /** @type {string} Current active camera mode */
        this.currentMode = CameraMode.CHASE;

        /** @type {number} Index in the cycle order */
        this._cycleIndex = 0;

        // ─── Create a camera for each mode ───────────────────────────────
        // Each mode gets its own PerspectiveCamera so switching is instant
        const viewport = engine.getViewport();
        const aspect = viewport.aspect;

        /** @type {THREE.PerspectiveCamera} Chase camera instance */
        this._chaseCam = new THREE.PerspectiveCamera(70, aspect, 0.5, 50000);

        /** @type {THREE.PerspectiveCamera} Cockpit camera instance */
        this._cockpitCam = new THREE.PerspectiveCamera(65, aspect, 0.1, 50000);

        /** @type {THREE.PerspectiveCamera} Cinematic camera instance */
        this._cinematicCam = new THREE.PerspectiveCamera(60, aspect, 0.5, 50000);

        /** @type {THREE.PerspectiveCamera} Missile camera instance */
        this._missileCam = new THREE.PerspectiveCamera(55, aspect, 0.5, 50000);

        // ─── Create camera controllers ───────────────────────────────────
        /** @type {ChaseCamera} */
        this.chase = new ChaseCamera(this._chaseCam);

        /** @type {CockpitCamera} */
        this.cockpit = new CockpitCamera(this._cockpitCam);

        /** @type {CinematicCamera} */
        this.cinematic = new CinematicCamera(this._cinematicCam);

        /** @type {MissileCamera} */
        this.missile = new MissileCamera(this._missileCam);

        // ─── Target Reference ────────────────────────────────────────────
        /** @type {THREE.Object3D|null} The player aircraft all cameras follow */
        this.target = null;

        /** @type {number} Current aircraft speed (passed to cameras for effects) */
        this.targetSpeed = 0;

        // ─── Transition ──────────────────────────────────────────────────
        /** @type {boolean} Whether a mode transition is in progress */
        this._transitioning = false;

        /** @type {number} Transition progress (0–1) */
        this._transitionProgress = 0;

        /** @type {number} Transition duration in seconds */
        this.transitionDuration = 0.5;

        /** @type {string|null} Mode we're transitioning from */
        this._transitionFrom = null;

        console.log('[CameraManager] Created with modes:', Object.values(CameraMode).join(', '));
    }

    // ─── Initialization ──────────────────────────────────────────────────────

    /**
     * Initialize the camera manager and set up the target
     * @param {THREE.Object3D} target - Player aircraft to follow
     */
    init(target) {
        this.target = target;

        // Point all cameras at the target
        this.chase.setTarget(target);
        this.cockpit.setTarget(target);
        this.cinematic.setTarget(target);
        this.missile.setFallbackTarget(target);

        console.log('[CameraManager] Initialized, following target');
    }

    // ─── Mode Switching ──────────────────────────────────────────────────────

    /**
     * Switch to a specific camera mode
     * @param {string} mode - CameraMode value
     */
    setMode(mode) {
        if (mode === this.currentMode) return;
        if (!Object.values(CameraMode).includes(mode)) {
            console.warn(`[CameraManager] Unknown mode: ${mode}`);
            return;
        }

        const oldMode = this.currentMode;
        this.currentMode = mode;

        // Update cycle index
        const idx = MODE_CYCLE.indexOf(mode);
        if (idx !== -1) this._cycleIndex = idx;

        console.log(`[CameraManager] ${oldMode} → ${mode}`);
    }

    /**
     * Cycle to the next camera mode in the standard cycle
     */
    cycleNext() {
        this._cycleIndex = (this._cycleIndex + 1) % MODE_CYCLE.length;
        this.setMode(MODE_CYCLE[this._cycleIndex]);
    }

    /**
     * Get the currently active camera mode
     * @returns {string}
     */
    getMode() {
        return this.currentMode;
    }

    // ─── Update ──────────────────────────────────────────────────────────────

    /**
     * Update the camera system. Called each frame from game._lateUpdate().
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
        if (!this.target) return;

        // ── Handle input actions ─────────────────────────────────────────
        this._handleInput(dt);

        // ── Pass speed to active camera for dynamic effects ──────────────
        this.chase.targetSpeed = this.targetSpeed;
        this.cockpit.targetSpeed = this.targetSpeed;

        // ── Afterburner shake on chase cam ───────────────────────────────
        // (Will be driven by actual afterburner state from physics later)
        const speedRatio = Math.min(this.targetSpeed / 250, 1);
        this.chase.setContinuousShake(speedRatio * 0.15);

        // ── Update the active camera controller ──────────────────────────
        this._getActiveController().update(dt);
    }

    /**
     * Handle camera-related input actions
     * @private
     * @param {number} dt
     */
    _handleInput(dt) {
        if (!this.input) return;

        // ── Camera switching (C to cycle) ──────────────────────────────
        if (this.input.wasTriggered(Actions.CAMERA_CYCLE)) {
            this.cycleNext();
        }

        // ── Freelook (hold to look around) ───────────────────────────────
        const freelookHeld = this.input.isActive(Actions.FREELOOK);
        const controller = this._getActiveController();

        if (freelookHeld) {
            if (controller.enableFreelook) controller.enableFreelook();

            // Apply mouse movement to freelook
            const delta = this.input.getMouseDelta();
            if (controller.applyFreelookDelta) {
                controller.applyFreelookDelta(delta.x, delta.y);
            }
        } else {
            if (controller.disableFreelook) controller.disableFreelook();
        }

        // ── Look-back (hold to look behind) ──────────────────────────────
        const lookBackHeld = this.input.isActive(Actions.LOOK_BACK);
        if (lookBackHeld) {
            if (controller.enableLookBack) controller.enableLookBack();
        } else {
            if (controller.disableLookBack) controller.disableLookBack();
        }
    }

    // ─── Camera Access ───────────────────────────────────────────────────────

    /**
     * Get the Three.js camera for the current mode (used by Engine for rendering)
     * @returns {THREE.PerspectiveCamera}
     */
    getActiveCamera() {
        switch (this.currentMode) {
            case CameraMode.CHASE:     return this._chaseCam;
            case CameraMode.COCKPIT:   return this._cockpitCam;
            case CameraMode.CINEMATIC: return this._cinematicCam;
            case CameraMode.MISSILE:   return this._missileCam;
            default: return this._chaseCam;
        }
    }

    /**
     * Get the active camera controller
     * @private
     * @returns {ChaseCamera|CockpitCamera|CinematicCamera|MissileCamera}
     */
    _getActiveController() {
        switch (this.currentMode) {
            case CameraMode.CHASE:     return this.chase;
            case CameraMode.COCKPIT:   return this.cockpit;
            case CameraMode.CINEMATIC: return this.cinematic;
            case CameraMode.MISSILE:   return this.missile;
            default: return this.chase;
        }
    }

    // ─── External API ────────────────────────────────────────────────────────

    /**
     * Set the aircraft speed for dynamic camera effects
     * @param {number} speed - Speed in m/s
     */
    setTargetSpeed(speed) {
        this.targetSpeed = speed;
    }

    /**
     * Set G-force for cockpit camera effects
     * @param {number} g - G-force value
     */
    setGForce(g) {
        this.cockpit.setGForce(g);
    }

    /**
     * Trigger a camera shake (e.g., from explosion)
     * @param {number} intensity - Shake strength (0–1)
     */
    addShake(intensity) {
        this.chase.addShake(intensity);
        this.cockpit.vibrationLevel = Math.min(1, this.cockpit.vibrationLevel + intensity);
    }

    /**
     * Start tracking a missile
     * @param {THREE.Object3D} missile
     * @param {THREE.Object3D} [missileTarget]
     */
    trackMissile(missile, missileTarget) {
        this.missile.trackMissile(missile, missileTarget);
        // Optionally auto-switch to missile cam
        // this.setMode(CameraMode.MISSILE);
    }

    /**
     * Notify missile impact
     * @param {THREE.Vector3} impactPoint
     */
    onMissileImpact(impactPoint) {
        this.missile.onImpact(impactPoint);
    }

    /**
     * Update aspect ratio for all cameras (called on window resize)
     * @param {number} aspect
     */
    updateAspect(aspect) {
        [this._chaseCam, this._cockpitCam, this._cinematicCam, this._missileCam].forEach(cam => {
            cam.aspect = aspect;
            cam.updateProjectionMatrix();
        });
    }

    // ─── Debug ───────────────────────────────────────────────────────────────

    /**
     * Get debug info for the camera system
     * @returns {Object}
     */
    getDebugInfo() {
        return {
            currentMode: this.currentMode,
            targetSpeed: this.targetSpeed.toFixed(1),
            hasTarget: !!this.target,
            activeController: this._getActiveController().getDebugInfo(),
            modes: Object.values(CameraMode)
        };
    }

    /**
     * Clean up all camera controllers
     */
    dispose() {
        this.chase.dispose();
        this.cockpit.dispose();
        this.cinematic.dispose();
        this.missile.dispose();
        this.target = null;
        console.log('[CameraManager] Disposed');
    }
}