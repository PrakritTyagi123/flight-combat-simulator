/**
 * assetLoader.js — Asset Loader
 * 
 * Centralized asset loading system that handles models (GLTF), textures,
 * audio files, map JSON data, and game data JSON. Provides progress tracking,
 * caching, and batch loading with Promise-based API.
 * 
 * Since we're using placeholder/procedural assets for now, this loader
 * also provides factory methods that generate placeholder geometry and
 * synthetic audio buffers when real asset files aren't available.
 */

import * as THREE from 'three';

// ─── Asset Types ─────────────────────────────────────────────────────────────
export const AssetType = Object.freeze({
    TEXTURE:  'texture',
    MODEL:    'model',
    AUDIO:    'audio',
    JSON:     'json',
    SHADER:   'shader'
});

// ─── Asset Loader Class ──────────────────────────────────────────────────────
export class AssetLoader {
    constructor() {
        /** @type {Map<string, *>} Cache of loaded assets keyed by path */
        this.cache = new Map();

        /** @type {THREE.LoadingManager} Three.js loading manager for progress */
        this.loadingManager = new THREE.LoadingManager();

        /** @type {THREE.TextureLoader} Texture loader instance */
        this.textureLoader = new THREE.TextureLoader(this.loadingManager);

        /** @type {AudioContext|null} Web Audio context for audio loading */
        this.audioContext = null;

        /** @type {number} Total items to load in current batch */
        this.totalItems = 0;

        /** @type {number} Items loaded so far in current batch */
        this.loadedItems = 0;

        /** @type {Function|null} Progress callback */
        this.onProgress = null;

        /** @type {Function|null} Completion callback */
        this.onComplete = null;

        /** @type {Function|null} Error callback */
        this.onError = null;

        // Configure the loading manager
        this._setupLoadingManager();

        console.log('[AssetLoader] Initialized');
    }

    // ─── Loading Manager Setup ───────────────────────────────────────────────

    /**
     * Configure Three.js LoadingManager callbacks
     * @private
     */
    _setupLoadingManager() {
        this.loadingManager.onStart = (url, loaded, total) => {
            console.log(`[AssetLoader] Starting: ${url} (${loaded}/${total})`);
        };

        this.loadingManager.onProgress = (url, loaded, total) => {
            this.loadedItems = loaded;
            this.totalItems = total;
            const progress = total > 0 ? loaded / total : 0;
            if (this.onProgress) {
                this.onProgress(progress, url, loaded, total);
            }
        };

        this.loadingManager.onLoad = () => {
            console.log('[AssetLoader] All assets loaded');
            if (this.onComplete) this.onComplete();
        };

        this.loadingManager.onError = (url) => {
            console.error(`[AssetLoader] Error loading: ${url}`);
            if (this.onError) this.onError(url);
        };
    }

    // ─── Progress Tracking ───────────────────────────────────────────────────

    /**
     * Set the progress callback
     * @param {Function} callback - (progress: 0-1, url, loaded, total)
     */
    setProgressCallback(callback) {
        this.onProgress = callback;
    }

    /**
     * Set the completion callback
     * @param {Function} callback
     */
    setCompleteCallback(callback) {
        this.onComplete = callback;
    }

    /**
     * Get current loading progress
     * @returns {{ loaded: number, total: number, progress: number }}
     */
    getProgress() {
        return {
            loaded: this.loadedItems,
            total: this.totalItems,
            progress: this.totalItems > 0 ? this.loadedItems / this.totalItems : 1
        };
    }

    // ─── Individual Asset Loaders ────────────────────────────────────────────

    /**
     * Load a texture from a URL or return a placeholder
     * @param {string} path - Texture file path
     * @param {Object} [options={}] - Texture options
     * @returns {Promise<THREE.Texture>}
     */
    async loadTexture(path, options = {}) {
        // Return cached version if available
        if (this.cache.has(path)) {
            return this.cache.get(path);
        }

        try {
            const texture = await new Promise((resolve, reject) => {
                this.textureLoader.load(
                    path,
                    tex => resolve(tex),
                    undefined,
                    () => {
                        // On error, create a placeholder texture
                        console.warn(`[AssetLoader] Texture not found: ${path}, using placeholder`);
                        resolve(this.createPlaceholderTexture(options.color));
                    }
                );
            });

            // Apply texture options
            if (options.wrapS) texture.wrapS = options.wrapS;
            if (options.wrapT) texture.wrapT = options.wrapT;
            if (options.repeat) texture.repeat.set(options.repeat[0], options.repeat[1]);
            if (options.encoding) texture.encoding = options.encoding;

            this.cache.set(path, texture);
            return texture;

        } catch (error) {
            console.warn(`[AssetLoader] Failed to load texture: ${path}`, error);
            const placeholder = this.createPlaceholderTexture(options.color);
            this.cache.set(path, placeholder);
            return placeholder;
        }
    }

    /**
     * Load a JSON data file
     * @param {string} path - JSON file path
     * @returns {Promise<Object>}
     */
    async loadJSON(path) {
        if (this.cache.has(path)) {
            return this.cache.get(path);
        }

        try {
            const response = await fetch(path);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            this.cache.set(path, data);
            console.log(`[AssetLoader] Loaded JSON: ${path}`);
            return data;

        } catch (error) {
            console.warn(`[AssetLoader] Failed to load JSON: ${path}`, error);
            // Return empty object as fallback
            return {};
        }
    }

    /**
     * Load a GLSL shader file as text
     * @param {string} path - Shader file path
     * @returns {Promise<string>}
     */
    async loadShader(path) {
        if (this.cache.has(path)) {
            return this.cache.get(path);
        }

        try {
            const response = await fetch(path);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const text = await response.text();
            this.cache.set(path, text);
            console.log(`[AssetLoader] Loaded shader: ${path}`);
            return text;

        } catch (error) {
            console.warn(`[AssetLoader] Failed to load shader: ${path}`, error);
            // Return a minimal passthrough shader
            return 'void main() { gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); }';
        }
    }

    /**
     * Load an audio buffer
     * @param {string} path - Audio file path
     * @returns {Promise<AudioBuffer|null>}
     */
    async loadAudio(path) {
        if (this.cache.has(path)) {
            return this.cache.get(path);
        }

        // Lazily create AudioContext
        if (!this.audioContext) {
            try {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            } catch (e) {
                console.warn('[AssetLoader] Web Audio API not available');
                return null;
            }
        }

        try {
            const response = await fetch(path);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            this.cache.set(path, audioBuffer);
            console.log(`[AssetLoader] Loaded audio: ${path}`);
            return audioBuffer;

        } catch (error) {
            console.warn(`[AssetLoader] Failed to load audio: ${path}, creating synthetic`);
            const synthetic = this.createSyntheticAudio();
            this.cache.set(path, synthetic);
            return synthetic;
        }
    }

    // ─── Batch Loading ───────────────────────────────────────────────────────

    /**
     * Load a manifest of assets in parallel
     * @param {Object[]} manifest - Array of { type, path, options? }
     * @returns {Promise<Map<string, *>>} Map of path → loaded asset
     */
    async loadManifest(manifest) {
        this.totalItems = manifest.length;
        this.loadedItems = 0;

        const results = new Map();

        const promises = manifest.map(async (entry) => {
            let asset = null;

            switch (entry.type) {
                case AssetType.TEXTURE:
                    asset = await this.loadTexture(entry.path, entry.options);
                    break;
                case AssetType.JSON:
                    asset = await this.loadJSON(entry.path);
                    break;
                case AssetType.SHADER:
                    asset = await this.loadShader(entry.path);
                    break;
                case AssetType.AUDIO:
                    asset = await this.loadAudio(entry.path);
                    break;
                case AssetType.MODEL:
                    // For now, models are generated procedurally
                    asset = this.createPlaceholderModel(entry.options?.type || 'aircraft');
                    break;
                default:
                    console.warn(`[AssetLoader] Unknown asset type: ${entry.type}`);
            }

            this.loadedItems++;
            const progress = this.loadedItems / this.totalItems;
            if (this.onProgress) {
                this.onProgress(progress, entry.path, this.loadedItems, this.totalItems);
            }

            results.set(entry.path, asset);
        });

        await Promise.all(promises);
        console.log(`[AssetLoader] Manifest loaded: ${results.size} assets`);
        return results;
    }

    /**
     * Load all game data JSONs (aircraft stats, weapon stats, etc.)
     * @returns {Promise<Object>} Object with all game data
     */
    async loadGameData() {
        const [aircraftStats, aircraftLoadouts, weaponStats, missionTemplates] = await Promise.all([
            this.loadJSON('data/aircraftStats.json'),
            this.loadJSON('data/aircraftLoadouts.json'),
            this.loadJSON('data/weaponStats.json'),
            this.loadJSON('data/missionTemplates.json')
        ]);

        const gameData = {
            aircraftStats,
            aircraftLoadouts,
            weaponStats,
            missionTemplates
        };

        console.log('[AssetLoader] Game data loaded');
        return gameData;
    }

    /**
     * Load a map JSON file
     * @param {string} mapName - Map name (e.g., 'desert', 'island', 'mountain')
     * @returns {Promise<Object>}
     */
    async loadMap(mapName) {
        return this.loadJSON(`assets/maps/${mapName}Map.json`);
    }

    // ─── Placeholder Generators ──────────────────────────────────────────────

    /**
     * Create a colored placeholder texture
     * @param {number} [color=0xff00ff] - Hex color for the texture
     * @returns {THREE.Texture}
     */
    createPlaceholderTexture(color = 0xff00ff) {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        // Draw a checkerboard pattern
        const c = new THREE.Color(color);
        const hex = '#' + c.getHexString();
        ctx.fillStyle = hex;
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = '#ffffff';
        for (let y = 0; y < 64; y += 16) {
            for (let x = 0; x < 64; x += 16) {
                if ((x / 16 + y / 16) % 2 === 0) {
                    ctx.fillRect(x, y, 16, 16);
                }
            }
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        return texture;
    }

    /**
     * Create a placeholder 3D model based on type
     * @param {string} type - 'aircraft', 'building', 'tree', etc.
     * @returns {THREE.Group}
     */
    createPlaceholderModel(type = 'aircraft') {
        const group = new THREE.Group();
        group.userData.isPlaceholder = true;

        switch (type) {
            case 'aircraft':
                return this._createPlaceholderAircraft();
            case 'building':
                return this._createPlaceholderBuilding();
            default:
                // Generic box placeholder
                const geo = new THREE.BoxGeometry(2, 2, 2);
                const mat = new THREE.MeshStandardMaterial({ color: 0xff00ff });
                group.add(new THREE.Mesh(geo, mat));
                return group;
        }
    }

    /**
     * Create a simple aircraft shape from primitives
     * @private
     * @returns {THREE.Group}
     */
    _createPlaceholderAircraft() {
        const group = new THREE.Group();
        const bodyMat = new THREE.MeshStandardMaterial({
            color: 0x888888,
            metalness: 0.6,
            roughness: 0.4
        });

        // Fuselage
        const fuselage = new THREE.Mesh(
            new THREE.CylinderGeometry(0.5, 0.3, 6, 8),
            bodyMat
        );
        fuselage.rotation.z = Math.PI / 2;
        group.add(fuselage);

        // Wings
        const wingGeo = new THREE.BoxGeometry(8, 0.1, 1.5);
        const wings = new THREE.Mesh(wingGeo, bodyMat);
        wings.position.set(0, 0, 0);
        group.add(wings);

        // Tail vertical stabilizer
        const tailVGeo = new THREE.BoxGeometry(0.1, 1.5, 0.8);
        const tailV = new THREE.Mesh(tailVGeo, bodyMat);
        tailV.position.set(-2.8, 0.7, 0);
        group.add(tailV);

        // Tail horizontal stabilizer
        const tailHGeo = new THREE.BoxGeometry(2.5, 0.08, 0.6);
        const tailH = new THREE.Mesh(tailHGeo, bodyMat);
        tailH.position.set(-2.8, 0.2, 0);
        group.add(tailH);

        // Nose cone
        const noseGeo = new THREE.ConeGeometry(0.5, 1.5, 8);
        const nose = new THREE.Mesh(noseGeo, bodyMat);
        nose.rotation.z = -Math.PI / 2;
        nose.position.set(3.5, 0, 0);
        group.add(nose);

        // Cockpit glass
        const cockpitMat = new THREE.MeshStandardMaterial({
            color: 0x4488ff,
            transparent: true,
            opacity: 0.6
        });
        const cockpit = new THREE.Mesh(
            new THREE.SphereGeometry(0.4, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
            cockpitMat
        );
        cockpit.position.set(1.5, 0.4, 0);
        group.add(cockpit);

        group.userData.isPlaceholder = true;
        group.userData.type = 'aircraft';
        return group;
    }

    /**
     * Create a simple building shape
     * @private
     * @returns {THREE.Group}
     */
    _createPlaceholderBuilding() {
        const group = new THREE.Group();
        const height = 5 + Math.random() * 20;
        const width = 3 + Math.random() * 5;

        const geo = new THREE.BoxGeometry(width, height, width);
        const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color().setHSL(0, 0, 0.3 + Math.random() * 0.4),
            roughness: 0.8
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = height / 2;
        group.add(mesh);

        group.userData.isPlaceholder = true;
        group.userData.type = 'building';
        return group;
    }

    /**
     * Create a synthetic audio buffer (white noise burst)
     * @param {number} [duration=0.5] - Duration in seconds
     * @returns {AudioBuffer|null}
     */
    createSyntheticAudio(duration = 0.5) {
        if (!this.audioContext) {
            try {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            } catch (e) {
                return null;
            }
        }

        const sampleRate = this.audioContext.sampleRate;
        const length = Math.floor(sampleRate * duration);
        const buffer = this.audioContext.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);

        // Generate a simple tone with decay
        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            const envelope = Math.exp(-t * 5); // exponential decay
            data[i] = Math.sin(2 * Math.PI * 440 * t) * envelope * 0.3;
        }

        return buffer;
    }

    // ─── Cache Management ────────────────────────────────────────────────────

    /**
     * Check if an asset is cached
     * @param {string} path - Asset path
     * @returns {boolean}
     */
    isCached(path) {
        return this.cache.has(path);
    }

    /**
     * Get a cached asset directly
     * @param {string} path - Asset path
     * @returns {*}
     */
    getCached(path) {
        return this.cache.get(path);
    }

    /**
     * Manually add an asset to the cache
     * @param {string} path - Key to store under
     * @param {*} asset - Asset to cache
     */
    addToCache(path, asset) {
        this.cache.set(path, asset);
    }

    /**
     * Remove an asset from the cache and dispose if possible
     * @param {string} path - Asset path
     */
    removeFromCache(path) {
        const asset = this.cache.get(path);
        if (asset) {
            if (asset.dispose) asset.dispose();
            this.cache.delete(path);
        }
    }

    /**
     * Clear all cached assets
     */
    clearCache() {
        this.cache.forEach((asset, path) => {
            if (asset && asset.dispose) {
                asset.dispose();
            }
        });
        this.cache.clear();
        console.log('[AssetLoader] Cache cleared');
    }

    // ─── Debug ───────────────────────────────────────────────────────────────

    /**
     * Get debug info about the loader
     * @returns {Object}
     */
    getDebugInfo() {
        return {
            cachedAssets: this.cache.size,
            loadProgress: this.getProgress(),
            cachedPaths: Array.from(this.cache.keys()).slice(0, 20)
        };
    }

    /**
     * Clean up the asset loader
     */
    dispose() {
        this.clearCache();
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
        }
        console.log('[AssetLoader] Disposed');
    }
}