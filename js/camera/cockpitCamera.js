/**
 * cockpitCamera.js — Cockpit (First-Person) Camera
 * 
 * Places the camera inside the aircraft cockpit with:
 *   - Fixed position relative to the aircraft (pilot's head position)
 *   - Head look via mouse (limited arc, like turning your head)
 *   - G-force head bob (head pushes down/back under high G)
 *   - Vibration from speed and turbulence
 *   - Narrower default FOV for cockpit immersion
 *   - Instrument panel visibility (future: cockpit mesh overlay)
 */

import * as THREE from 'three';

const _tmpVec = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();

// ─── CockpitCamera Class ─────────────────────────────────────────────────────
export class CockpitCamera {
    /**
     * @param {THREE.PerspectiveCamera} camera - Camera to control
     */
    constructor(camera) {
        /** @type {THREE.PerspectiveCamera} */
        this.camera = camera;

        /** @type {THREE.Object3D|null} Aircraft to sit inside */
        this.target = null;

        // ─── Cockpit Position ────────────────────────────────────────────
        /** @type {THREE.Vector3} Pilot head position in aircraft local space */
        this.seatOffset = new THREE.Vector3(1.8, 0.7, 0); // Just behind the nose, above center

        // ─── Head Look ───────────────────────────────────────────────────
        /** @type {number} Head yaw angle (radians, 0 = forward) */
        this.headYaw = 0;

        /** @type {number} Head pitch angle (radians, 0 = level) */
        this.headPitch = 0;

        /** @type {number} Max head yaw (how far you can turn left/right) */
        this.maxHeadYaw = Math.PI * 0.55; // ~100°

        /** @type {number} Max head pitch up */
        this.maxHeadPitchUp = Math.PI * 0.35; // ~63°

        /** @type {number} Max head pitch down */
        this.maxHeadPitchDown = Math.PI * 0.25; // ~45°

        /** @type {number} Head look sensitivity */
        this.headSensitivity = 0.002;

        /** @type {number} Head return-to-center speed (when not freelooking) */
        this.headReturnSpeed = 3.0;

        /** @type {boolean} Whether freelook (head look) is active */
        this.freelookActive = false;

        // ─── G-Force Effects ─────────────────────────────────────────────
        /** @type {THREE.Vector3} Current G-force offset applied to head position */
        this.gForceOffset = new THREE.Vector3();

        /** @type {number} Current G-force magnitude (set externally by physics) */
        this.gForce = 1.0;

        /** @type {number} G-force head bob magnitude */
        this.gForceMagnitude = 0.15;

        // ─── Vibration ───────────────────────────────────────────────────
        /** @type {THREE.Vector3} High-frequency vibration offset */
        this.vibrationOffset = new THREE.Vector3();

        /** @type {number} Vibration intensity (0–1) */
        this.vibrationLevel = 0;

        /** @type {number} Speed reference for auto-vibration */
        this.maxSpeedRef = 300;

        /** @type {number} Current target speed (set externally) */
        this.targetSpeed = 0;

        // ─── FOV ─────────────────────────────────────────────────────────
        /** @type {number} Cockpit base FOV (narrower for realism) */
        this.baseFOV = 65;

        /** @type {number} FOV boost under high G */
        this.gForceFOVBoost = 8;

        /** @type {number} Current smoothed FOV */
        this._currentFOV = this.baseFOV;

        // ─── Look-Back ───────────────────────────────────────────────────
        /** @type {boolean} Whether looking backward */
        this.lookBackActive = false;

        /** @type {boolean} Whether position has been initialized */
        this._initialized = false;

        console.log('[CockpitCamera] Created');
    }

    // ─── Configuration ───────────────────────────────────────────────────────

    /**
     * Set the target aircraft
     * @param {THREE.Object3D} target
     */
    setTarget(target) {
        this.target = target;
        this._initialized = false;
    }

    /**
     * Set the cockpit seat position in local space
     * @param {number} x - Forward/back (positive = forward toward nose)
     * @param {number} y - Up/down (positive = higher)
     * @param {number} z - Left/right
     */
    setSeatPosition(x, y, z) {
        this.seatOffset.set(x, y, z);
    }

    // ─── Update ──────────────────────────────────────────────────────────────

    /**
     * Update the cockpit camera
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
        if (!this.target) return;

        // ── Compute world position of pilot's head ───────────────────────
        // Start with seat offset in local space
        _tmpVec.copy(this.seatOffset);

        // Add G-force offset
        this._updateGForceOffset(dt);
        _tmpVec.add(this.gForceOffset);

        // Transform to world space
        _tmpVec.applyQuaternion(this.target.quaternion);
        _tmpVec.add(this.target.position);

        // Add vibration
        this._updateVibration(dt);
        _tmpVec.add(this.vibrationOffset);

        // Set camera position
        this.camera.position.copy(_tmpVec);

        // ── Compute camera orientation ───────────────────────────────────
        // Three.js cameras look down their local -Z axis, but our aircraft
        // model faces +X. We need to rotate the camera 90° around Y so that
        // the camera's -Z aligns with the aircraft's +X (forward).
        const FORWARD_FIX = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0), Math.PI / 2
        );

        if (this.lookBackActive) {
            // Look backward: aircraft orientation + 90° forward fix + 180° flip
            this.camera.quaternion.copy(this.target.quaternion);
            this.camera.quaternion.multiply(FORWARD_FIX);
            _tmpQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
            this.camera.quaternion.multiply(_tmpQuat);

        } else {
            // Start with aircraft orientation + forward fix
            this.camera.quaternion.copy(this.target.quaternion);
            this.camera.quaternion.multiply(FORWARD_FIX);

            // Apply head look (freelook or returning to center)
            if (!this.freelookActive) {
                // Smoothly return head to center
                this.headYaw *= Math.max(0, 1 - this.headReturnSpeed * dt);
                this.headPitch *= Math.max(0, 1 - this.headReturnSpeed * dt);

                // Snap to zero when close
                if (Math.abs(this.headYaw) < 0.001) this.headYaw = 0;
                if (Math.abs(this.headPitch) < 0.001) this.headPitch = 0;
            }

            // Apply head rotation on top of aircraft orientation
            if (this.headYaw !== 0 || this.headPitch !== 0) {
                // Yaw (look left/right) around local Y
                _tmpQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -this.headYaw);
                this.camera.quaternion.multiply(_tmpQuat);

                // Pitch (look up/down) around local Z (for +X facing model)
                _tmpQuat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.headPitch);
                this.camera.quaternion.multiply(_tmpQuat);
            }
        }

        // ── Dynamic FOV ──────────────────────────────────────────────────
        const gBoost = Math.max(0, (this.gForce - 1) / 8) * this.gForceFOVBoost;
        const targetFOV = this.baseFOV + gBoost;
        this._currentFOV += (targetFOV - this._currentFOV) * 3.0 * dt;
        this.camera.fov = this._currentFOV;
        this.camera.updateProjectionMatrix();
    }

    // ─── G-Force ─────────────────────────────────────────────────────────────

    /**
     * Update the G-force head bob offset
     * @private
     * @param {number} dt
     */
    _updateGForceOffset(dt) {
        // Simulate head being pushed by G-forces
        // High positive G → head drops down and back
        // Negative G → head lifts up
        const gEffect = (this.gForce - 1) * this.gForceMagnitude;
        const targetY = -gEffect * 0.5; // Head drops under G
        const targetX = -gEffect * 0.3; // Head pushes back under G

        this.gForceOffset.x += (targetX - this.gForceOffset.x) * 4.0 * dt;
        this.gForceOffset.y += (targetY - this.gForceOffset.y) * 4.0 * dt;
    }

    /**
     * Set the current G-force (called by physics system)
     * @param {number} g - G-force value (1.0 = level flight)
     */
    setGForce(g) {
        this.gForce = g;
    }

    // ─── Vibration ───────────────────────────────────────────────────────────

    /**
     * Update cockpit vibration
     * @private
     * @param {number} dt
     */
    _updateVibration(dt) {
        // Auto-vibration from speed
        const speedVibration = Math.pow(Math.min(this.targetSpeed / this.maxSpeedRef, 1), 2) * 0.3;
        const totalVibration = Math.min(1, this.vibrationLevel + speedVibration);

        if (totalVibration > 0.001) {
            const mag = totalVibration * 0.04;
            this.vibrationOffset.set(
                (Math.random() - 0.5) * mag,
                (Math.random() - 0.5) * mag,
                (Math.random() - 0.5) * mag * 0.5
            );
        } else {
            this.vibrationOffset.set(0, 0, 0);
        }
    }

    // ─── Freelook ────────────────────────────────────────────────────────────

    /**
     * Enable freelook (head tracking via mouse)
     */
    enableFreelook() {
        this.freelookActive = true;
    }

    /**
     * Disable freelook (head returns to center)
     */
    disableFreelook() {
        this.freelookActive = false;
    }

    /**
     * Apply mouse movement to head look
     * @param {number} dx - Mouse delta X
     * @param {number} dy - Mouse delta Y
     */
    applyFreelookDelta(dx, dy) {
        if (!this.freelookActive) return;

        this.headYaw += dx * this.headSensitivity;
        this.headPitch += dy * this.headSensitivity;

        // Clamp to head rotation limits
        this.headYaw = Math.max(-this.maxHeadYaw, Math.min(this.maxHeadYaw, this.headYaw));
        this.headPitch = Math.max(-this.maxHeadPitchDown, Math.min(this.maxHeadPitchUp, this.headPitch));
    }

    // ─── Look-Back ───────────────────────────────────────────────────────────

    enableLookBack() {
        this.lookBackActive = true;
    }

    disableLookBack() {
        this.lookBackActive = false;
    }

    // ─── Debug ───────────────────────────────────────────────────────────────

    getDebugInfo() {
        return {
            type: 'cockpit',
            target: !!this.target,
            freelook: this.freelookActive,
            lookBack: this.lookBackActive,
            headYaw: (this.headYaw * 180 / Math.PI).toFixed(1) + '°',
            headPitch: (this.headPitch * 180 / Math.PI).toFixed(1) + '°',
            gForce: this.gForce.toFixed(2) + 'G',
            fov: this._currentFOV.toFixed(1),
            vibration: this.vibrationLevel.toFixed(3)
        };
    }

    dispose() {
        this.target = null;
        console.log('[CockpitCamera] Disposed');
    }
}