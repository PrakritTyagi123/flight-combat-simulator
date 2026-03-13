/**
 * missileCamera.js — Missile Camera
 * 
 * Follows a launched missile/projectile with dramatic tracking:
 *   - Behind mode: chases behind the missile as it flies toward the target
 *   - Side mode: views the missile from a fixed side angle
 *   - Target mode: looks from the target back at the incoming missile
 *   - Impact mode: freezes near the impact point after detonation
 * 
 * When no missile is active, falls back to showing the player aircraft.
 */

import * as THREE from 'three';

const _tmpVec = new THREE.Vector3();

// ─── Missile Camera Modes ────────────────────────────────────────────────────
const MissileCamMode = Object.freeze({
    BEHIND: 'behind',   // Chase behind the missile
    SIDE:   'side',     // Side angle tracking
    TARGET: 'target',   // From the target looking at incoming
    IMPACT: 'impact'    // Freeze at impact point
});

// ─── MissileCamera Class ─────────────────────────────────────────────────────
export class MissileCamera {
    /**
     * @param {THREE.PerspectiveCamera} camera
     */
    constructor(camera) {
        /** @type {THREE.PerspectiveCamera} */
        this.camera = camera;

        /** @type {THREE.Object3D|null} Missile being tracked */
        this.missile = null;

        /** @type {THREE.Object3D|null} Missile's target (for target-view mode) */
        this.missileTarget = null;

        /** @type {THREE.Object3D|null} Fallback subject when no missile active */
        this.fallbackTarget = null;

        // ─── Mode ────────────────────────────────────────────────────────
        /** @type {string} Current camera mode */
        this.mode = MissileCamMode.BEHIND;

        // ─── Behind Mode Config ──────────────────────────────────────────
        /** @type {THREE.Vector3} Offset behind the missile in local space */
        this.behindOffset = new THREE.Vector3(-8, 2, 0);

        /** @type {number} Look-ahead distance */
        this.lookAheadDist = 30;

        // ─── Side Mode Config ────────────────────────────────────────────
        /** @type {number} Side viewing distance */
        this.sideDistance = 15;

        /** @type {number} Side viewing height */
        this.sideHeight = 3;

        // ─── Impact Mode ─────────────────────────────────────────────────
        /** @type {THREE.Vector3|null} Frozen impact position */
        this._impactPos = null;

        /** @type {THREE.Vector3|null} Frozen look target at impact */
        this._impactLook = null;

        /** @type {number} Time remaining in impact freeze */
        this._impactTimer = 0;

        /** @type {number} How long to hold the impact shot */
        this.impactDuration = 2.0;

        // ─── Smoothing ───────────────────────────────────────────────────
        /** @type {THREE.Vector3} Smoothed position */
        this._smoothPos = new THREE.Vector3();

        /** @type {THREE.Vector3} Smoothed look target */
        this._smoothLook = new THREE.Vector3();

        /** @type {number} Smoothing speed */
        this.smoothing = 8.0;

        /** @type {boolean} Snap on next frame */
        this._needsSnap = true;

        // ─── FOV ─────────────────────────────────────────────────────────
        /** @type {number} Base FOV for missile cam */
        this.baseFOV = 55;

        /** @type {number} Current FOV */
        this._currentFOV = 55;

        /** @type {boolean} Whether a missile is currently active */
        this.active = false;

        console.log('[MissileCamera] Created');
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    /**
     * Start tracking a missile
     * @param {THREE.Object3D} missile - The missile object
     * @param {THREE.Object3D} [missileTarget] - What the missile is aimed at
     */
    trackMissile(missile, missileTarget = null) {
        this.missile = missile;
        this.missileTarget = missileTarget;
        this.mode = MissileCamMode.BEHIND;
        this.active = true;
        this._needsSnap = true;
        this._impactPos = null;
        this._impactTimer = 0;
        console.log('[MissileCamera] Tracking missile');
    }

    /**
     * Notify that the missile has impacted
     * @param {THREE.Vector3} impactPoint - World position of impact
     */
    onImpact(impactPoint) {
        this.mode = MissileCamMode.IMPACT;
        this._impactPos = this._smoothPos.clone();
        this._impactLook = impactPoint.clone();
        this._impactTimer = this.impactDuration;
        console.log('[MissileCamera] Impact!');
    }

    /**
     * Stop tracking (missile destroyed or expired)
     */
    stopTracking() {
        this.missile = null;
        this.missileTarget = null;
        this.active = false;
        this.mode = MissileCamMode.BEHIND;
    }

    /**
     * Set fallback target (player aircraft) for when no missile is active
     * @param {THREE.Object3D} target
     */
    setFallbackTarget(target) {
        this.fallbackTarget = target;
    }

    /**
     * Set the camera mode
     * @param {string} mode - MissileCamMode value
     */
    setMode(mode) {
        this.mode = mode;
        this._needsSnap = true;
    }

    // ─── Update ──────────────────────────────────────────────────────────────

    update(dt) {
        let desiredPos, lookTarget;

        // Impact freeze
        if (this.mode === MissileCamMode.IMPACT) {
            this._impactTimer -= dt;
            if (this._impactTimer <= 0) {
                this.stopTracking();
            }
            if (this._impactPos && this._impactLook) {
                this.camera.position.copy(this._impactPos);
                this.camera.lookAt(this._impactLook);
                return;
            }
        }

        // Determine subject
        const subject = this.missile || this.fallbackTarget;
        if (!subject) return;

        // Compute position based on mode
        switch (this.mode) {
            case MissileCamMode.BEHIND:
                [desiredPos, lookTarget] = this._updateBehind(subject);
                break;
            case MissileCamMode.SIDE:
                [desiredPos, lookTarget] = this._updateSide(subject);
                break;
            case MissileCamMode.TARGET:
                [desiredPos, lookTarget] = this._updateTargetView(subject);
                break;
            default:
                [desiredPos, lookTarget] = this._updateBehind(subject);
        }

        // Snap or smooth
        if (this._needsSnap) {
            this._smoothPos.copy(desiredPos);
            this._smoothLook.copy(lookTarget);
            this._needsSnap = false;
        } else {
            const factor = 1 - Math.exp(-this.smoothing * dt);
            this._smoothPos.lerp(desiredPos, factor);
            this._smoothLook.lerp(lookTarget, factor);
        }

        // Ground avoidance
        if (this._smoothPos.y < 2) this._smoothPos.y = 2;

        this.camera.position.copy(this._smoothPos);
        this.camera.lookAt(this._smoothLook);

        // FOV
        this.camera.fov = this.baseFOV;
        this.camera.updateProjectionMatrix();
    }

    // ─── Mode Updates ────────────────────────────────────────────────────────

    /**
     * @private
     * @param {THREE.Object3D} subject
     * @returns {[THREE.Vector3, THREE.Vector3]}
     */
    _updateBehind(subject) {
        // Behind the missile/aircraft
        _tmpVec.copy(this.behindOffset);
        _tmpVec.applyQuaternion(subject.quaternion);
        _tmpVec.add(subject.position);

        const look = new THREE.Vector3(this.lookAheadDist, 0, 0);
        look.applyQuaternion(subject.quaternion);
        look.add(subject.position);

        return [_tmpVec.clone(), look];
    }

    /**
     * @private
     * @param {THREE.Object3D} subject
     * @returns {[THREE.Vector3, THREE.Vector3]}
     */
    _updateSide(subject) {
        _tmpVec.set(-3, this.sideHeight, this.sideDistance);
        _tmpVec.applyQuaternion(subject.quaternion);
        _tmpVec.add(subject.position);

        return [_tmpVec.clone(), subject.position.clone()];
    }

    /**
     * @private
     * @param {THREE.Object3D} subject
     * @returns {[THREE.Vector3, THREE.Vector3]}
     */
    _updateTargetView(subject) {
        // View from the target looking at the incoming missile
        if (this.missileTarget) {
            const pos = this.missileTarget.position.clone();
            pos.y += 5;
            return [pos, subject.position.clone()];
        }
        // Fallback to behind
        return this._updateBehind(subject);
    }

    // ─── Debug ───────────────────────────────────────────────────────────────

    getDebugInfo() {
        return {
            type: 'missile',
            active: this.active,
            mode: this.mode,
            hasMissile: !!this.missile,
            hasTarget: !!this.missileTarget,
            impactTimer: this._impactTimer.toFixed(1)
        };
    }

    dispose() {
        this.missile = null;
        this.missileTarget = null;
        this.fallbackTarget = null;
        console.log('[MissileCamera] Disposed');
    }
}

export { MissileCamMode };