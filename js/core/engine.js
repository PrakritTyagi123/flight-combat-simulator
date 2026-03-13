/**
 * engine.js — Core Engine
 * 
 * The engine owns the Three.js renderer, manages the primary camera,
 * handles window resizing, provides the render pipeline, and coordinates
 * between the scene manager and the game loop. It's the hardware-facing
 * layer that all visual output flows through.
 */

import * as THREE from 'three';

// ─── Engine Configuration Defaults ───────────────────────────────────────────
const DEFAULT_CONFIG = {
    // Renderer settings
    antialias: true,
    shadowMapEnabled: true,
    shadowMapType: THREE.PCFSoftShadowMap,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1.0,
    outputEncoding: THREE.sRGBEncoding,
    pixelRatio: Math.min(window.devicePixelRatio, 2), // Cap at 2x for performance
    powerPreference: 'high-performance',

    // Camera defaults
    fov: 70,
    nearClip: 0.5,
    farClip: 50000,    // Very far clip plane for large terrain

    // Performance
    maxPixelRatio: 2,
    enablePostProcessing: true
};

// ─── Engine Class ────────────────────────────────────────────────────────────
export class Engine {
    /**
     * @param {HTMLElement} container - DOM element to mount the renderer into
     * @param {import('./sceneManager.js').SceneManager} sceneManager - Scene manager instance
     * @param {Object} [config={}] - Engine configuration overrides
     */
    constructor(container, sceneManager, config = {}) {
        /** @type {Object} Merged configuration */
        this.config = { ...DEFAULT_CONFIG, ...config };

        /** @type {HTMLElement} Container DOM element */
        this.container = container;

        /** @type {import('./sceneManager.js').SceneManager} Scene manager reference */
        this.sceneManager = sceneManager;

        /** @type {THREE.WebGLRenderer} The Three.js WebGL renderer */
        this.renderer = null;

        /** @type {THREE.PerspectiveCamera} Primary camera */
        this.camera = null;

        /** @type {THREE.Clock} Three.js clock for time tracking */
        this.clock = new THREE.Clock();

        /** @type {{ width: number, height: number, aspect: number }} Current viewport */
        this.viewport = { width: 0, height: 0, aspect: 1 };

        /** @type {Object} Renderer statistics */
        this.renderStats = {
            drawCalls: 0,
            triangles: 0,
            points: 0,
            lines: 0,
            textures: 0,
            geometries: 0
        };

        /** @type {boolean} Whether the engine has been initialized */
        this.initialized = false;

        // Bind resize handler
        this._onResize = this._onResize.bind(this);

        console.log('[Engine] Created');
    }

    // ─── Initialization ──────────────────────────────────────────────────────

    /**
     * Initialize the renderer, camera, and event listeners
     * @returns {Engine} this (for chaining)
     */
    init() {
        if (this.initialized) {
            console.warn('[Engine] Already initialized');
            return this;
        }

        // ─── Create Renderer ─────────────────────────────────────────────
        this.renderer = new THREE.WebGLRenderer({
            antialias: this.config.antialias,
            alpha: false,
            powerPreference: this.config.powerPreference,
            stencil: false
        });

        this.renderer.setPixelRatio(this.config.pixelRatio);
        this.renderer.shadowMap.enabled = this.config.shadowMapEnabled;
        this.renderer.shadowMap.type = this.config.shadowMapType;
        this.renderer.toneMapping = this.config.toneMapping;
        this.renderer.toneMappingExposure = this.config.toneMappingExposure;
        this.renderer.outputEncoding = this.config.outputEncoding;

        // Enable logarithmic depth buffer for large-scale scenes
        // (prevents z-fighting between near cockpit and far terrain)
        // Note: We use a standard depth buffer but set near/far carefully

        // Set initial size
        this._updateViewport();
        this.renderer.setSize(this.viewport.width, this.viewport.height);

        // Mount to DOM
        this.renderer.domElement.id = 'game-canvas';
        this.renderer.domElement.style.display = 'block';
        this.container.appendChild(this.renderer.domElement);

        // ─── Create Camera ───────────────────────────────────────────────
        this.camera = new THREE.PerspectiveCamera(
            this.config.fov,
            this.viewport.aspect,
            this.config.nearClip,
            this.config.farClip
        );
        this.camera.position.set(0, 100, 300);
        this.camera.lookAt(0, 0, 0);

        // Enable all render layers on the camera by default
        this.camera.layers.enableAll();

        // ─── Event Listeners ─────────────────────────────────────────────
        window.addEventListener('resize', this._onResize);

        // Handle visibility change (tab switching)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('[Engine] Tab hidden — consider pausing');
            }
        });

        this.initialized = true;
        console.log('[Engine] Initialized', {
            size: `${this.viewport.width}x${this.viewport.height}`,
            pixelRatio: this.config.pixelRatio,
            antialias: this.config.antialias
        });

        return this;
    }

    // ─── Rendering ───────────────────────────────────────────────────────────

    /**
     * Render the current scene with the current camera.
     * Called by the game loop's render callback.
     * @param {number} [interpolation=0] - Interpolation factor from game loop (0-1)
     */
    render(interpolation = 0) {
        if (!this.renderer || !this.camera) return;

        const scene = this.sceneManager.getScene();
        if (!scene) return;

        // Main render pass
        this.renderer.render(scene, this.camera);

        // Capture render stats
        this._captureRenderStats();
    }

    /**
     * Read the renderer's internal stats
     * @private
     */
    _captureRenderStats() {
        const info = this.renderer.info;
        this.renderStats.drawCalls = info.render.calls;
        this.renderStats.triangles = info.render.triangles;
        this.renderStats.points = info.render.points;
        this.renderStats.lines = info.render.lines;
        this.renderStats.textures = info.memory.textures;
        this.renderStats.geometries = info.memory.geometries;
    }

    // ─── Camera ──────────────────────────────────────────────────────────────

    /**
     * Get the active camera
     * @returns {THREE.PerspectiveCamera}
     */
    getCamera() {
        return this.camera;
    }

    /**
     * Replace the active camera (used by camera manager for switching views)
     * @param {THREE.PerspectiveCamera} camera - New camera
     */
    setCamera(camera) {
        this.camera = camera;
        // Update aspect ratio for the new camera
        this.camera.aspect = this.viewport.aspect;
        this.camera.updateProjectionMatrix();
    }

    /**
     * Update the camera's field of view
     * @param {number} fov - New FOV in degrees
     */
    setFOV(fov) {
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
    }

    /**
     * Set the near and far clipping planes
     * @param {number} near - Near clip distance
     * @param {number} far - Far clip distance
     */
    setClipPlanes(near, far) {
        this.camera.near = near;
        this.camera.far = far;
        this.camera.updateProjectionMatrix();
    }

    // ─── Viewport / Resize ───────────────────────────────────────────────────

    /**
     * Update stored viewport dimensions
     * @private
     */
    _updateViewport() {
        this.viewport.width = this.container.clientWidth || window.innerWidth;
        this.viewport.height = this.container.clientHeight || window.innerHeight;
        this.viewport.aspect = this.viewport.width / this.viewport.height;
    }

    /**
     * Handle window resize events
     * @private
     */
    _onResize() {
        this._updateViewport();

        // Update camera
        if (this.camera) {
            this.camera.aspect = this.viewport.aspect;
            this.camera.updateProjectionMatrix();
        }

        // Update renderer
        if (this.renderer) {
            this.renderer.setSize(this.viewport.width, this.viewport.height);
        }

        // Notify external resize listeners
        if (this.onResizeCallback) {
            this.onResizeCallback(this.viewport);
        }

        console.log(`[Engine] Resized to ${this.viewport.width}x${this.viewport.height}`);
    }

    /**
     * Get the current viewport dimensions
     * @returns {{ width: number, height: number, aspect: number }}
     */
    getViewport() {
        return { ...this.viewport };
    }

    // ─── Renderer Configuration ──────────────────────────────────────────────

    /**
     * Get the raw Three.js renderer (for post-processing, etc.)
     * @returns {THREE.WebGLRenderer}
     */
    getRenderer() {
        return this.renderer;
    }

    /**
     * Get the canvas DOM element
     * @returns {HTMLCanvasElement}
     */
    getCanvas() {
        return this.renderer?.domElement;
    }

    /**
     * Set the pixel ratio (for quality vs performance tradeoff)
     * @param {number} ratio - Pixel ratio (1 = normal, 2 = retina)
     */
    setPixelRatio(ratio) {
        const clamped = Math.min(ratio, this.config.maxPixelRatio);
        this.renderer.setPixelRatio(clamped);
        this.config.pixelRatio = clamped;
        // Re-apply size to account for new pixel ratio
        this.renderer.setSize(this.viewport.width, this.viewport.height);
    }

    /**
     * Enable or disable shadows
     * @param {boolean} enabled
     */
    setShadows(enabled) {
        this.renderer.shadowMap.enabled = enabled;
        this.renderer.shadowMap.needsUpdate = true;
        this.config.shadowMapEnabled = enabled;
    }

    /**
     * Set tone mapping mode
     * @param {number} mode - THREE.NoToneMapping, THREE.ACESFilmicToneMapping, etc.
     * @param {number} [exposure=1.0] - Exposure value
     */
    setToneMapping(mode, exposure = 1.0) {
        this.renderer.toneMapping = mode;
        this.renderer.toneMappingExposure = exposure;
    }

    /**
     * Take a screenshot of the current frame
     * @returns {string} Data URL (PNG)
     */
    screenshot() {
        // Force a render to ensure we capture the latest frame
        this.render();
        return this.renderer.domElement.toDataURL('image/png');
    }

    // ─── Debug ───────────────────────────────────────────────────────────────

    /**
     * Get debug/performance information about the engine
     * @returns {Object}
     */
    getDebugInfo() {
        const gl = this.renderer?.getContext();
        return {
            viewport: { ...this.viewport },
            pixelRatio: this.config.pixelRatio,
            renderStats: { ...this.renderStats },
            shadows: this.config.shadowMapEnabled,
            toneMapping: this.renderer?.toneMapping,
            webglVersion: gl ? gl.getParameter(gl.VERSION) : 'N/A',
            maxTextureSize: gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 'N/A',
            renderer: gl ? gl.getParameter(gl.RENDERER) : 'N/A'
        };
    }

    // ─── Cleanup ─────────────────────────────────────────────────────────────

    /**
     * Clean up the engine, remove renderer from DOM
     */
    dispose() {
        window.removeEventListener('resize', this._onResize);

        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.forceContextLoss();

            if (this.renderer.domElement && this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }

        this.renderer = null;
        this.camera = null;
        this.initialized = false;

        console.log('[Engine] Disposed');
    }
}