/**
 * sceneManager.js — Scene Manager
 * 
 * Manages Three.js scenes, object registration/removal, scene switching,
 * layer management, and object queries. Provides a clean abstraction over
 * raw Three.js scene manipulation so other systems don't touch the scene directly.
 */

import * as THREE from 'three';

// ─── Render Layers ───────────────────────────────────────────────────────────
// Three.js supports 32 layers (0-31); we reserve specific ones for categories
export const RenderLayers = Object.freeze({
    DEFAULT:     0,   // Standard geometry
    TERRAIN:     1,   // Terrain chunks
    BUILDINGS:   2,   // City buildings
    AIRCRAFT:    3,   // Player + enemy aircraft
    PROJECTILES: 4,   // Bullets, missiles
    EFFECTS:     5,   // Particles, explosions, smoke
    SKY:         6,   // Skybox, clouds, weather
    WATER:       7,   // Ocean surfaces
    UI_3D:       8,   // 3D UI elements (markers, waypoints)
    DEBUG:       9    // Debug visualizations (collision boxes, AI paths)
});

// ─── Scene Manager Class ─────────────────────────────────────────────────────
export class SceneManager {
    /**
     * @param {import('./gameState.js').GameState} gameState - Reference to game state manager
     */
    constructor(gameState) {
        /** @type {import('./gameState.js').GameState} */
        this.gameState = gameState;

        /** @type {THREE.Scene} The main Three.js scene */
        this.scene = new THREE.Scene();

        /** @type {Map<string, THREE.Object3D>} Named object registry for fast lookup */
        this.registry = new Map();

        /** @type {Map<string, THREE.Object3D[]>} Tagged groups of objects */
        this.tagGroups = new Map();

        /** @type {Set<THREE.Object3D>} Objects flagged for removal at end of frame */
        this.pendingRemoval = new Set();

        /** @type {THREE.Fog|null} Current fog settings */
        this.fog = null;

        /** @type {Object} Scene statistics for debug */
        this.stats = {
            totalObjects: 0,
            registeredObjects: 0,
            tagGroups: 0
        };

        // Initialize the scene with default settings
        this._initScene();

        console.log('[SceneManager] Initialized');
    }

    // ─── Initialization ──────────────────────────────────────────────────────

    /**
     * Set up default scene properties
     * @private
     */
    _initScene() {
        // Set a dark blue-grey background as default (sky system will override)
        this.scene.background = new THREE.Color(0x1a1a2e);

        // Default fog for depth perception
        this.scene.fog = new THREE.FogExp2(0x8899aa, 0.00008);
        this.fog = this.scene.fog;

        // Enable auto-update of world matrices
        this.scene.autoUpdate = true;
    }

    // ─── Object Management ───────────────────────────────────────────────────

    /**
     * Add an object to the scene with optional name and tags
     * @param {THREE.Object3D} object - The Three.js object to add
     * @param {Object} [options={}] - Configuration options
     * @param {string} [options.name] - Unique name for registry lookup
     * @param {string[]} [options.tags] - Tags for group queries
     * @param {number} [options.layer] - Render layer to assign
     * @returns {THREE.Object3D} The added object
     */
    add(object, options = {}) {
        const { name, tags = [], layer } = options;

        // Add to Three.js scene
        this.scene.add(object);

        // Register by name if provided
        if (name) {
            if (this.registry.has(name)) {
                console.warn(`[SceneManager] Overwriting registered object: "${name}"`);
            }
            this.registry.set(name, object);
            object.userData.registryName = name;
        }

        // Add tags
        if (tags.length > 0) {
            object.userData.tags = tags;
            tags.forEach(tag => {
                if (!this.tagGroups.has(tag)) {
                    this.tagGroups.set(tag, []);
                }
                this.tagGroups.get(tag).push(object);
            });
        }

        // Set render layer
        if (layer !== undefined) {
            object.layers.set(layer);
            // Also enable the default layer so the camera can see it
            object.layers.enable(RenderLayers.DEFAULT);
        }

        this._updateStats();
        return object;
    }

    /**
     * Remove an object from the scene and clean up all references
     * @param {THREE.Object3D|string} objectOrName - The object or its registry name
     * @param {boolean} [dispose=true] - Whether to dispose geometry/materials
     */
    remove(objectOrName, dispose = true) {
        let object;

        if (typeof objectOrName === 'string') {
            object = this.registry.get(objectOrName);
            if (!object) {
                console.warn(`[SceneManager] Object not found in registry: "${objectOrName}"`);
                return;
            }
        } else {
            object = objectOrName;
        }

        // Remove from scene
        this.scene.remove(object);

        // Remove from registry
        const regName = object.userData.registryName;
        if (regName) {
            this.registry.delete(regName);
        }

        // Remove from tag groups
        const tags = object.userData.tags || [];
        tags.forEach(tag => {
            const group = this.tagGroups.get(tag);
            if (group) {
                const idx = group.indexOf(object);
                if (idx !== -1) group.splice(idx, 1);
                if (group.length === 0) this.tagGroups.delete(tag);
            }
        });

        // Dispose GPU resources if requested
        if (dispose) {
            this._disposeObject(object);
        }

        this._updateStats();
    }

    /**
     * Schedule an object for removal at the end of the current frame
     * (safe to call during iteration)
     * @param {THREE.Object3D} object - Object to remove
     */
    scheduleRemoval(object) {
        this.pendingRemoval.add(object);
    }

    /**
     * Process all pending removals (called at end of frame by game loop)
     */
    processPendingRemovals() {
        if (this.pendingRemoval.size === 0) return;

        this.pendingRemoval.forEach(obj => {
            this.remove(obj, true);
        });
        this.pendingRemoval.clear();
    }

    // ─── Object Queries ──────────────────────────────────────────────────────

    /**
     * Get an object by its registered name
     * @param {string} name - Registry name
     * @returns {THREE.Object3D|undefined}
     */
    get(name) {
        return this.registry.get(name);
    }

    /**
     * Get all objects with a given tag
     * @param {string} tag - Tag to search for
     * @returns {THREE.Object3D[]}
     */
    getByTag(tag) {
        return this.tagGroups.get(tag) || [];
    }

    /**
     * Check if an object with the given name exists in the registry
     * @param {string} name - Registry name
     * @returns {boolean}
     */
    has(name) {
        return this.registry.has(name);
    }

    /**
     * Get all registered object names
     * @returns {string[]}
     */
    getRegisteredNames() {
        return Array.from(this.registry.keys());
    }

    /**
     * Find objects within a radius of a point
     * @param {THREE.Vector3} center - Search center
     * @param {number} radius - Search radius
     * @param {string} [tag] - Optional tag filter
     * @returns {THREE.Object3D[]}
     */
    findInRadius(center, radius, tag) {
        const radiusSq = radius * radius;
        const candidates = tag ? this.getByTag(tag) : Array.from(this.registry.values());

        return candidates.filter(obj => {
            const pos = new THREE.Vector3();
            obj.getWorldPosition(pos);
            return pos.distanceToSquared(center) <= radiusSq;
        });
    }

    // ─── Scene Configuration ─────────────────────────────────────────────────

    /**
     * Set the scene background
     * @param {THREE.Color|THREE.Texture|THREE.CubeTexture} background
     */
    setBackground(background) {
        this.scene.background = background;
    }

    /**
     * Set scene fog
     * @param {string} type - 'linear' or 'exponential'
     * @param {Object} params - Fog parameters
     */
    setFog(type, params = {}) {
        if (type === 'linear') {
            this.scene.fog = new THREE.Fog(
                params.color || 0x8899aa,
                params.near || 100,
                params.far || 10000
            );
        } else if (type === 'exponential') {
            this.scene.fog = new THREE.FogExp2(
                params.color || 0x8899aa,
                params.density || 0.00008
            );
        } else {
            this.scene.fog = null;
        }
        this.fog = this.scene.fog;
    }

    /**
     * Set the environment map for reflections
     * @param {THREE.Texture} envMap - Environment map texture
     */
    setEnvironmentMap(envMap) {
        this.scene.environment = envMap;
    }

    // ─── Scene Switching ─────────────────────────────────────────────────────

    /**
     * Clear the entire scene (for transitions between game states/maps)
     * @param {boolean} [keepLights=false] - Whether to preserve lights
     */
    clearScene(keepLights = false) {
        const toRemove = [];

        this.scene.traverse(child => {
            if (child === this.scene) return;
            if (keepLights && (child instanceof THREE.Light)) return;
            toRemove.push(child);
        });

        toRemove.forEach(obj => {
            this.scene.remove(obj);
            this._disposeObject(obj);
        });

        // Clear registries
        this.registry.clear();
        this.tagGroups.clear();
        this.pendingRemoval.clear();

        this._updateStats();
        console.log(`[SceneManager] Scene cleared (kept lights: ${keepLights})`);
    }

    // ─── Resource Disposal ───────────────────────────────────────────────────

    /**
     * Recursively dispose of an object's geometry, materials, and textures
     * @private
     * @param {THREE.Object3D} object
     */
    _disposeObject(object) {
        object.traverse(child => {
            // Dispose geometry
            if (child.geometry) {
                child.geometry.dispose();
            }

            // Dispose materials (can be an array or single)
            if (child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    // Dispose all texture maps
                    Object.keys(mat).forEach(key => {
                        const value = mat[key];
                        if (value instanceof THREE.Texture) {
                            value.dispose();
                        }
                    });
                    mat.dispose();
                });
            }
        });
    }

    // ─── Utility ─────────────────────────────────────────────────────────────

    /**
     * Traverse all scene objects with a callback
     * @param {Function} callback - Called with each Object3D
     */
    traverse(callback) {
        this.scene.traverse(callback);
    }

    /**
     * Get the raw Three.js scene (for renderer)
     * @returns {THREE.Scene}
     */
    getScene() {
        return this.scene;
    }

    /**
     * Update internal stats
     * @private
     */
    _updateStats() {
        let count = 0;
        this.scene.traverse(() => count++);
        this.stats.totalObjects = count - 1; // exclude scene root
        this.stats.registeredObjects = this.registry.size;
        this.stats.tagGroups = this.tagGroups.size;
    }

    /**
     * Get debug info about the scene
     * @returns {Object}
     */
    getDebugInfo() {
        this._updateStats();
        return {
            ...this.stats,
            registeredNames: this.getRegisteredNames().slice(0, 20),
            tagGroupNames: Array.from(this.tagGroups.keys()),
            pendingRemovals: this.pendingRemoval.size,
            fog: this.fog ? { type: this.fog.isFogExp2 ? 'exponential' : 'linear' } : null
        };
    }

    /**
     * Clean up the scene manager
     */
    dispose() {
        this.clearScene(false);
        this.scene = null;
        console.log('[SceneManager] Disposed');
    }
}