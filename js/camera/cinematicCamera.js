/**
 * cinematicCamera.js — Cinematic Camera
 * 
 * An automated dramatic camera that cycles through cinematic shot types:
 *   - Fly-by: fixed position as aircraft streaks past
 *   - Orbit: slow orbit around the aircraft
 *   - Low sweep: close to the ground looking up at the aircraft
 *   - Wing cam: close to the wing tip
 *   - Dramatic zoom: far away with telephoto compression
 * 
 * Shots auto-cycle on a timer. Used for idle mode, replays, and spectating.
 */

import * as THREE from 'three';

// ─── Shot Types ──────────────────────────────────────────────────────────────
const ShotType = Object.freeze({
    ORBIT:          'orbit',
    FLY_BY:         'fly_by',
    LOW_SWEEP:      'low_sweep',
    WING_CAM:       'wing_cam',
    DRAMATIC_ZOOM:  'dramatic_zoom'
});

const SHOT_LIST = Object.values(ShotType);

const _tmpVec = new THREE.Vector3();

// ─── CinematicCamera Class ───────────────────────────────────────────────────
export class CinematicCamera {
    /**
     * @param {THREE.PerspectiveCamera} camera
     */
    constructor(camera) {
        /** @type {THREE.PerspectiveCamera} */
        this.camera = camera;

        /** @type {THREE.Object3D|null} Subject to film */
        this.target = null;

        // ─── Shot Management ─────────────────────────────────────────────
        /** @type {string} Current shot type */
        this.currentShot = ShotType.ORBIT;

        /** @type {number} Index into shot list */
        this.shotIndex = 0;

        /** @type {number} Time elapsed in current shot (seconds) */
        this.shotTimer = 0;

        /** @type {number} Duration of each shot before auto-cycling */
        this.shotDuration = 6.0;

        /** @type {boolean} Whether to auto-cycle shots */
        this.autoCycle = true;

        // ─── Orbit State ─────────────────────────────────────────────────
        /** @type {number} Current orbit angle */
        this.orbitAngle = 0;

        /** @type {number} Orbit speed (radians/second) */
        this.orbitSpeed = 0.3;

        /** @type {number} Orbit radius */
        this.orbitRadius = 80;

        /** @type {number} Orbit height above target */
        this.orbitHeight = 20;

        // ─── Fly-By State ────────────────────────────────────────────────
        /** @type {THREE.Vector3|null} Fixed world position for fly-by */
        this._flyByPos = null;

        // ─── Smoothing ───────────────────────────────────────────────────
        /** @type {THREE.Vector3} Smoothed camera position */
        this._smoothPos = new THREE.Vector3();

        /** @type {THREE.Vector3} Smoothed look target */
        this._smoothLook = new THREE.Vector3();

        /** @type {number} Position smoothing factor */
        this.smoothing = 3.0;

        /** @type {boolean} Whether to snap on next update */
        this._needsSnap = true;

        // ─── FOV ─────────────────────────────────────────────────────────
        /** @type {Object} FOV per shot type */
        this.shotFOV = {
            [ShotType.ORBIT]:          60,
            [ShotType.FLY_BY]:         50,
            [ShotType.LOW_SWEEP]:      75,
            [ShotType.WING_CAM]:       80,
            [ShotType.DRAMATIC_ZOOM]:  25
        };

        /** @type {number} Current smoothed FOV */
        this._currentFOV = 60;

        console.log('[CinematicCamera] Created');
    }

    // ─── Configuration ───────────────────────────────────────────────────────

    setTarget(target) {
        this.target = target;
        this._needsSnap = true;
    }

    /**
     * Force a specific shot type
     * @param {string} shotType - One of ShotType values
     */
    setShot(shotType) {
        if (!SHOT_LIST.includes(shotType)) {
            console.warn(`[CinematicCamera] Unknown shot: ${shotType}`);
            return;
        }
        this.currentShot = shotType;
        this.shotTimer = 0;
        this._initShot();
        this._needsSnap = true;
    }

    /**
     * Cycle to the next shot
     */
    nextShot() {
        this.shotIndex = (this.shotIndex + 1) % SHOT_LIST.length;
        this.currentShot = SHOT_LIST[this.shotIndex];
        this.shotTimer = 0;
        this._initShot();
        this._needsSnap = true;
    }

    // ─── Update ──────────────────────────────────────────────────────────────

    update(dt) {
        if (!this.target) return;

        // ── Auto-cycle shots ─────────────────────────────────────────────
        this.shotTimer += dt;
        if (this.autoCycle && this.shotTimer >= this.shotDuration) {
            this.nextShot();
        }

        // ── Compute desired position and look target for current shot ────
        let desiredPos, lookTarget;

        switch (this.currentShot) {
            case ShotType.ORBIT:
                [desiredPos, lookTarget] = this._updateOrbit(dt);
                break;
            case ShotType.FLY_BY:
                [desiredPos, lookTarget] = this._updateFlyBy(dt);
                break;
            case ShotType.LOW_SWEEP:
                [desiredPos, lookTarget] = this._updateLowSweep(dt);
                break;
            case ShotType.WING_CAM:
                [desiredPos, lookTarget] = this._updateWingCam(dt);
                break;
            case ShotType.DRAMATIC_ZOOM:
                [desiredPos, lookTarget] = this._updateDramaticZoom(dt);
                break;
            default:
                [desiredPos, lookTarget] = this._updateOrbit(dt);
        }

        // ── Snap or smooth ───────────────────────────────────────────────
        if (this._needsSnap) {
            this._smoothPos.copy(desiredPos);
            this._smoothLook.copy(lookTarget);
            this._needsSnap = false;
        } else {
            const lerpFactor = 1 - Math.exp(-this.smoothing * dt);
            this._smoothPos.lerp(desiredPos, lerpFactor);
            this._smoothLook.lerp(lookTarget, lerpFactor);
        }

        // Ground avoidance
        if (this._smoothPos.y < 3) this._smoothPos.y = 3;

        this.camera.position.copy(this._smoothPos);
        this.camera.lookAt(this._smoothLook);

        // ── FOV ──────────────────────────────────────────────────────────
        const targetFOV = this.shotFOV[this.currentShot] || 60;
        this._currentFOV += (targetFOV - this._currentFOV) * 2.0 * dt;
        this.camera.fov = this._currentFOV;
        this.camera.updateProjectionMatrix();
    }

    // ─── Shot Initializers ───────────────────────────────────────────────────

    /**
     * Initialize state for the current shot type
     * @private
     */
    _initShot() {
        if (!this.target) return;

        switch (this.currentShot) {
            case ShotType.FLY_BY:
                // Pick a point offset from the aircraft's current position
                const side = (Math.random() > 0.5 ? 1 : -1);
                _tmpVec.set(
                    -100 + Math.random() * 50,
                    5 + Math.random() * 30,
                    side * (30 + Math.random() * 40)
                );
                _tmpVec.applyQuaternion(this.target.quaternion);
                _tmpVec.add(this.target.position);
                this._flyByPos = _tmpVec.clone();
                break;

            case ShotType.ORBIT:
                this.orbitAngle = Math.random() * Math.PI * 2;
                break;
        }
    }

    // ─── Shot Update Functions ───────────────────────────────────────────────

    /**
     * @private
     * @returns {[THREE.Vector3, THREE.Vector3]}
     */
    _updateOrbit(dt) {
        this.orbitAngle += this.orbitSpeed * dt;
        const pos = new THREE.Vector3(
            this.target.position.x + Math.cos(this.orbitAngle) * this.orbitRadius,
            this.target.position.y + this.orbitHeight + Math.sin(this.orbitAngle * 0.3) * 10,
            this.target.position.z + Math.sin(this.orbitAngle) * this.orbitRadius
        );
        return [pos, this.target.position.clone()];
    }

    /**
     * @private
     * @returns {[THREE.Vector3, THREE.Vector3]}
     */
    _updateFlyBy(dt) {
        if (!this._flyByPos) {
            this._initShot();
        }
        // Camera stays fixed, aircraft flies past
        return [this._flyByPos.clone(), this.target.position.clone()];
    }

    /**
     * @private
     * @returns {[THREE.Vector3, THREE.Vector3]}
     */
    _updateLowSweep(dt) {
        // Low to the ground, offset to the side, looking up at the aircraft
        const t = this.shotTimer / this.shotDuration;
        const sweepAngle = t * Math.PI * 0.5;

        _tmpVec.set(-20, 0, 40);
        _tmpVec.applyQuaternion(this.target.quaternion);
        const pos = new THREE.Vector3(
            this.target.position.x + _tmpVec.x,
            Math.max(3, this.target.position.y - 20),
            this.target.position.z + _tmpVec.z
        );

        const look = this.target.position.clone();
        look.y += 5;

        return [pos, look];
    }

    /**
     * @private
     * @returns {[THREE.Vector3, THREE.Vector3]}
     */
    _updateWingCam(dt) {
        // Close to the wing tip
        _tmpVec.set(-2, 1.5, 6); // Off the right wing
        _tmpVec.applyQuaternion(this.target.quaternion);
        _tmpVec.add(this.target.position);

        // Look forward along the aircraft
        const look = new THREE.Vector3(30, 0, 0);
        look.applyQuaternion(this.target.quaternion);
        look.add(this.target.position);

        return [_tmpVec.clone(), look];
    }

    /**
     * @private
     * @returns {[THREE.Vector3, THREE.Vector3]}
     */
    _updateDramaticZoom(dt) {
        // Far away with telephoto zoom
        const angle = this.shotTimer * 0.1;
        const pos = new THREE.Vector3(
            this.target.position.x + Math.cos(angle) * 250,
            this.target.position.y + 30,
            this.target.position.z + Math.sin(angle) * 250
        );
        return [pos, this.target.position.clone()];
    }

    // ─── Debug ───────────────────────────────────────────────────────────────

    getDebugInfo() {
        return {
            type: 'cinematic',
            shot: this.currentShot,
            shotIndex: this.shotIndex,
            shotTimer: this.shotTimer.toFixed(1) + 's / ' + this.shotDuration + 's',
            autoCycle: this.autoCycle,
            fov: this._currentFOV.toFixed(1)
        };
    }

    dispose() {
        this.target = null;
        this._flyByPos = null;
        console.log('[CinematicCamera] Disposed');
    }
}

export { ShotType };