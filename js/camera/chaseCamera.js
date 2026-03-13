/**
 * chaseCamera.js — Chase (Third-Person) Camera
 * 
 * A smooth third-person camera that follows behind and above the player aircraft.
 * Features:
 *   - Configurable offset (distance, height, side)
 *   - Smooth position/rotation interpolation with separate speeds
 *   - Velocity-based dynamic offset (pulls back at high speed)
 *   - Free-look: hold a key/button to orbit the camera around the aircraft with mouse
 *   - Look-back: instantly flip 180° to see behind
 *   - Camera shake from impacts, afterburner, speed
 *   - Ground avoidance (won't clip through terrain)
 */

import * as THREE from 'three';

// ─── Reusable temp vectors (avoid per-frame allocation) ──────────────────────
const _tmpVec  = new THREE.Vector3();
const _tmpVec2 = new THREE.Vector3();
const _tmpVec3 = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();

// ─── ChaseCamera Class ──────────────────────────────────────────────────────
export class ChaseCamera {
    /**
     * @param {THREE.PerspectiveCamera} camera - The Three.js camera to control
     */
    constructor(camera) {
        /** @type {THREE.PerspectiveCamera} */
        this.camera = camera;

        /** @type {THREE.Object3D|null} Target to follow (the aircraft) */
        this.target = null;

        // ─── Offset Configuration ────────────────────────────────────────
        /** @type {THREE.Vector3} Base offset in target's local space (x=behind, y=above, z=side) */
        this.baseOffset = new THREE.Vector3(-45, 15, 0);

        /** @type {THREE.Vector3} Current smoothed offset (dynamically adjusted) */
        this.currentOffset = this.baseOffset.clone();

        /** @type {THREE.Vector3} Look-ahead offset in target's local space */
        this.lookAheadOffset = new THREE.Vector3(40, 0, 0);

        // ─── Smoothing ───────────────────────────────────────────────────
        /** @type {number} Position follow speed (higher = tighter follow) */
        this.positionSmoothing = 5.0;

        /** @type {number} Rotation follow speed */
        this.rotationSmoothing = 4.0;

        /** @type {THREE.Vector3} Current smoothed camera world position */
        this._smoothedPosition = new THREE.Vector3();

        /** @type {THREE.Vector3} Current smoothed look target */
        this._smoothedLookTarget = new THREE.Vector3();

        /** @type {boolean} Whether the camera position has been initialized */
        this._initialized = false;

        // ─── Speed-Based Dynamic Offset ──────────────────────────────────
        /** @type {number} Maximum extra pullback distance at max speed */
        this.speedPullback = 15;

        /** @type {number} Maximum speed reference for pullback scaling (m/s) */
        this.maxSpeedRef = 300;

        /** @type {number} Current speed of target (set externally) */
        this.targetSpeed = 0;

        // ─── Freelook ────────────────────────────────────────────────────
        /** @type {boolean} Whether freelook is currently active */
        this.freelookActive = false;

        /** @type {number} Freelook horizontal angle (radians) */
        this.freelookYaw = 0;

        /** @type {number} Freelook vertical angle (radians) */
        this.freelookPitch = 0;

        /** @type {number} Freelook orbit distance */
        this.freelookDistance = 50;

        /** @type {number} Freelook sensitivity */
        this.freelookSensitivity = 0.003;

        /** @type {number} Max freelook vertical angle */
        this.freelookPitchMax = Math.PI * 0.4;

        /** @type {number} Min freelook vertical angle */
        this.freelookPitchMin = -Math.PI * 0.3;

        // ─── Look-Back ───────────────────────────────────────────────────
        /** @type {boolean} Whether look-back is active */
        this.lookBackActive = false;

        // ─── Camera Shake ────────────────────────────────────────────────
        /** @type {THREE.Vector3} Current shake offset */
        this.shakeOffset = new THREE.Vector3();

        /** @type {number} Current shake intensity (0–1, decays over time) */
        this.shakeIntensity = 0;

        /** @type {number} Shake decay rate per second */
        this.shakeDecay = 5.0;

        /** @type {number} Shake magnitude multiplier */
        this.shakeMagnitude = 1.0;

        /** @type {number} Continuous shake from speed / afterburner */
        this.continuousShake = 0;

        // ─── Ground Avoidance ────────────────────────────────────────────
        /** @type {number} Minimum height above ground */
        this.minHeight = 3.0;

        // ─── FOV ─────────────────────────────────────────────────────────
        /** @type {number} Base FOV */
        this.baseFOV = 70;

        /** @type {number} Extra FOV at max speed */
        this.speedFOVBoost = 15;

        /** @type {number} Current smoothed FOV */
        this._currentFOV = this.baseFOV;

        console.log('[ChaseCamera] Created');
    }

    // ─── Configuration ───────────────────────────────────────────────────────

    /**
     * Set the target object to follow
     * @param {THREE.Object3D} target
     */
    setTarget(target) {
        this.target = target;
        this._initialized = false;
    }

    /**
     * Set the chase offset (behind, above, side)
     * @param {number} behind - Distance behind target (positive = further back)
     * @param {number} above - Height above target
     * @param {number} side - Side offset (0 = centered)
     */
    setOffset(behind, above, side = 0) {
        this.baseOffset.set(-Math.abs(behind), above, side);
        console.log('[ChaseCamera] Offset set to', this.baseOffset.toArray());
    }

    // ─── Update ──────────────────────────────────────────────────────────────

    /**
     * Update the chase camera position and orientation
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
        if (!this.target) return;

        // ── First-frame snap ─────────────────────────────────────────────
        if (!this._initialized) {
            this._snapToTarget();
            this._initialized = true;
            return;
        }

        // ── Compute desired world position ───────────────────────────────
        let desiredPos;
        let lookTarget;

        if (this.freelookActive) {
            // Freelook: orbit around the target
            desiredPos = this._computeFreelookPosition();
            lookTarget = this._getTargetWorldPos();

        } else if (this.lookBackActive) {
            // Look back: camera stays roughly in place, looks behind aircraft
            desiredPos = this._computeLookBackPosition();
            lookTarget = this._computeLookBackTarget();

        } else {
            // Normal chase: behind and above, with speed pullback
            desiredPos = this._computeChasePosition();
            lookTarget = this._computeLookAheadTarget();
        }

        // ── Ground avoidance ─────────────────────────────────────────────
        if (desiredPos.y < this.minHeight) {
            desiredPos.y = this.minHeight;
        }

        // ── Smooth interpolation ─────────────────────────────────────────
        const posLerp = 1 - Math.exp(-this.positionSmoothing * dt);
        const rotLerp = 1 - Math.exp(-this.rotationSmoothing * dt);

        this._smoothedPosition.lerp(desiredPos, posLerp);
        this._smoothedLookTarget.lerp(lookTarget, rotLerp);

        // ── Apply shake ──────────────────────────────────────────────────
        this._updateShake(dt);

        // ── Apply to camera ──────────────────────────────────────────────
        this.camera.position.copy(this._smoothedPosition).add(this.shakeOffset);
        this.camera.lookAt(this._smoothedLookTarget);

        // ── Dynamic FOV ──────────────────────────────────────────────────
        const speedRatio = Math.min(this.targetSpeed / this.maxSpeedRef, 1);
        const targetFOV = this.baseFOV + speedRatio * this.speedFOVBoost;
        this._currentFOV += (targetFOV - this._currentFOV) * 2.0 * dt;
        this.camera.fov = this._currentFOV;
        this.camera.updateProjectionMatrix();
    }

    // ─── Position Computation ────────────────────────────────────────────────

    /**
     * Compute the normal chase camera world position
     * @private
     * @returns {THREE.Vector3}
     */
    _computeChasePosition() {
        // Speed-based pullback
        const speedRatio = Math.min(this.targetSpeed / this.maxSpeedRef, 1);
        const pullback = speedRatio * this.speedPullback;

        // Compute offset with pullback
        _tmpVec.copy(this.baseOffset);
        _tmpVec.x -= pullback; // Pull further behind

        // Transform to world space using target's quaternion
        _tmpVec.applyQuaternion(this.target.quaternion);
        _tmpVec.add(this.target.position);

        return _tmpVec.clone();
    }

    /**
     * Compute look-ahead target point
     * @private
     * @returns {THREE.Vector3}
     */
    _computeLookAheadTarget() {
        _tmpVec2.copy(this.lookAheadOffset);
        _tmpVec2.applyQuaternion(this.target.quaternion);
        _tmpVec2.add(this.target.position);
        return _tmpVec2.clone();
    }

    /**
     * Compute freelook orbit position
     * @private
     * @returns {THREE.Vector3}
     */
    _computeFreelookPosition() {
        const targetPos = this._getTargetWorldPos();

        // Spherical coordinates around target
        const x = this.freelookDistance * Math.cos(this.freelookPitch) * Math.sin(this.freelookYaw);
        const y = this.freelookDistance * Math.sin(this.freelookPitch);
        const z = this.freelookDistance * Math.cos(this.freelookPitch) * Math.cos(this.freelookYaw);

        return new THREE.Vector3(
            targetPos.x + x,
            targetPos.y + y + 5, // Slight upward bias
            targetPos.z + z
        );
    }

    /**
     * Compute look-back camera position (stay near current position but shift)
     * @private
     * @returns {THREE.Vector3}
     */
    _computeLookBackPosition() {
        // Position ahead of the aircraft (so we look back at it)
        _tmpVec.set(20, 8, 0);
        _tmpVec.applyQuaternion(this.target.quaternion);
        _tmpVec.add(this.target.position);
        return _tmpVec.clone();
    }

    /**
     * Compute look-back target (behind the aircraft)
     * @private
     * @returns {THREE.Vector3}
     */
    _computeLookBackTarget() {
        _tmpVec2.set(-60, 0, 0);
        _tmpVec2.applyQuaternion(this.target.quaternion);
        _tmpVec2.add(this.target.position);
        return _tmpVec2.clone();
    }

    /**
     * Get target's world position
     * @private
     * @returns {THREE.Vector3}
     */
    _getTargetWorldPos() {
        _tmpVec3.setFromMatrixPosition(this.target.matrixWorld);
        return _tmpVec3.clone();
    }

    /**
     * Snap camera instantly to the desired chase position (no interpolation)
     * @private
     */
    _snapToTarget() {
        const pos = this._computeChasePosition();
        const look = this._computeLookAheadTarget();
        this._smoothedPosition.copy(pos);
        this._smoothedLookTarget.copy(look);
        this.camera.position.copy(pos);
        this.camera.lookAt(look);
        this._currentFOV = this.baseFOV;
        this.camera.fov = this.baseFOV;
        this.camera.updateProjectionMatrix();
    }

    // ─── Freelook ────────────────────────────────────────────────────────────

    /**
     * Enable freelook mode
     */
    enableFreelook() {
        if (!this.freelookActive) {
            // Initialize freelook angles from current camera orientation
            this.freelookYaw = 0;
            this.freelookPitch = 0.15; // Slight upward angle
            this.freelookActive = true;
        }
    }

    /**
     * Disable freelook mode (returns to normal chase)
     */
    disableFreelook() {
        this.freelookActive = false;
    }

    /**
     * Apply mouse delta to freelook orbit
     * @param {number} dx - Mouse delta X
     * @param {number} dy - Mouse delta Y
     */
    applyFreelookDelta(dx, dy) {
        if (!this.freelookActive) return;
        this.freelookYaw += dx * this.freelookSensitivity;
        this.freelookPitch -= dy * this.freelookSensitivity;
        this.freelookPitch = Math.max(this.freelookPitchMin, Math.min(this.freelookPitchMax, this.freelookPitch));
    }

    // ─── Look-Back ───────────────────────────────────────────────────────────

    /**
     * Enable look-back (instant 180° view)
     */
    enableLookBack() {
        this.lookBackActive = true;
    }

    /**
     * Disable look-back
     */
    disableLookBack() {
        this.lookBackActive = false;
    }

    // ─── Camera Shake ────────────────────────────────────────────────────────

    /**
     * Trigger a one-shot camera shake (e.g., from explosion, hit)
     * @param {number} intensity - Shake strength (0–1)
     */
    addShake(intensity) {
        this.shakeIntensity = Math.min(1, this.shakeIntensity + intensity);
    }

    /**
     * Set continuous shake level (e.g., from afterburner, speed)
     * @param {number} level - Continuous shake amount (0–1)
     */
    setContinuousShake(level) {
        this.continuousShake = Math.max(0, Math.min(1, level));
    }

    /**
     * Update shake offset
     * @private
     * @param {number} dt
     */
    _updateShake(dt) {
        // Decay one-shot shake
        this.shakeIntensity = Math.max(0, this.shakeIntensity - this.shakeDecay * dt);

        // Combined shake level
        const totalShake = Math.min(1, this.shakeIntensity + this.continuousShake * 0.3);

        if (totalShake > 0.001) {
            const mag = totalShake * this.shakeMagnitude;
            this.shakeOffset.set(
                (Math.random() - 0.5) * 2 * mag,
                (Math.random() - 0.5) * 2 * mag,
                (Math.random() - 0.5) * 2 * mag
            );
        } else {
            this.shakeOffset.set(0, 0, 0);
        }
    }

    // ─── Debug ───────────────────────────────────────────────────────────────

    getDebugInfo() {
        return {
            type: 'chase',
            target: !!this.target,
            freelook: this.freelookActive,
            lookBack: this.lookBackActive,
            speed: this.targetSpeed.toFixed(1),
            fov: this._currentFOV.toFixed(1),
            shakeIntensity: this.shakeIntensity.toFixed(3),
            position: this.camera.position.toArray().map(v => v.toFixed(1))
        };
    }

    dispose() {
        this.target = null;
        console.log('[ChaseCamera] Disposed');
    }
}