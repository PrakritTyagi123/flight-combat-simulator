/**
 * game.js — Main Game Initialization
 * 
 * The top-level orchestrator. Creates and wires together all core systems
 * (engine, game loop, scene manager, asset loader, game state), then boots
 * the game through its initialization sequence:
 * 
 *   BOOT → LOADING → MENU → (player selects) → PLAYING
 * 
 * Also exposes a global `window.game` reference for debugging in the console.
 */

import * as THREE from 'three';
import { GameState, GameStates } from './gameState.js';
import { SceneManager, RenderLayers } from './sceneManager.js';
import { AssetLoader, AssetType } from './assetLoader.js';
import { GameLoop } from './gameLoop.js';
import { Engine } from './engine.js';
import { InputManager } from '../input/inputManager.js';
import { Actions } from '../input/controlBindings.js';

// ─── Game Class ──────────────────────────────────────────────────────────────
export class Game {
    /**
     * @param {Object} [options={}] - Game configuration
     * @param {string} [options.containerId='game-container'] - DOM container ID
     * @param {boolean} [options.debug=false] - Enable debug mode
     */
    constructor(options = {}) {
        /** @type {Object} Game options */
        this.options = {
            containerId: 'game-container',
            debug: false,
            ...options
        };

        /** @type {HTMLElement|null} DOM container */
        this.container = null;

        // ─── Core Systems ────────────────────────────────────────────────
        /** @type {GameState} State machine */
        this.state = new GameState();

        /** @type {SceneManager} Three.js scene management */
        this.sceneManager = null;

        /** @type {AssetLoader} Asset loading pipeline */
        this.assetLoader = new AssetLoader();

        /** @type {GameLoop} Fixed-timestep game loop */
        this.gameLoop = new GameLoop({
            fixedTimestep: 1 / 60,
            enableMetrics: true
        });

        /** @type {Engine} Rendering engine */
        this.engine = null;

        // ─── Sub-System References (populated by later Parts) ────────────
        // These will be set when Parts 2–N are integrated
        /** @type {Object|null} Input manager */
        this.input = null;
        /** @type {Object|null} Physics engine */
        this.physics = null;
        /** @type {Object|null} Camera manager */
        this.cameraManager = null;
        /** @type {Object|null} HUD manager */
        this.hud = null;
        /** @type {Object|null} Audio engine */
        this.audio = null;
        /** @type {Object|null} Weather system */
        this.weather = null;
        /** @type {Object|null} Mission manager */
        this.missionManager = null;
        /** @type {Object|null} Combat / weapons */
        this.combat = null;
        /** @type {Object|null} AI controller */
        this.ai = null;
        /** @type {Object|null} World / terrain manager */
        this.world = null;
        /** @type {Object|null} Effects system */
        this.effects = null;
        /** @type {Object|null} Debug UI */
        this.debugUI = null;

        // ─── Game Data ───────────────────────────────────────────────────
        /** @type {Object} Loaded game data (stats, loadouts, etc.) */
        this.gameData = {};

        /** @type {Object|null} Currently loaded map data */
        this.currentMap = null;

        /** @type {Object|null} Player aircraft reference */
        this.playerAircraft = null;

        /** @type {Array} Active enemy aircraft */
        this.enemies = [];

        /** @type {boolean} Whether the game has been fully initialized */
        this.ready = false;

        console.log('[Game] Instance created');
    }

    // ─── Boot Sequence ───────────────────────────────────────────────────────

    /**
     * Initialize the game — this is the main entry point.
     * Call this after constructing the Game instance.
     * @returns {Promise<Game>}
     */
    async init() {
        console.log('[Game] ═══════════════════════════════════════════');
        console.log('[Game] Flight Combat Simulator — Initializing...');
        console.log('[Game] ═══════════════════════════════════════════');

        try {
            // ── Step 1: Find the DOM container ───────────────────────────
            this.container = document.getElementById(this.options.containerId);
            if (!this.container) {
                // Create a default full-screen container
                this.container = document.createElement('div');
                this.container.id = this.options.containerId;
                this.container.style.cssText = 'width:100vw;height:100vh;overflow:hidden;position:relative;';
                document.body.appendChild(this.container);
                console.log('[Game] Created default container');
            }

            // ── Step 2: Initialize Scene Manager ─────────────────────────
            this.sceneManager = new SceneManager(this.state);

            // ── Step 3: Initialize Engine (renderer + camera) ────────────
            this.engine = new Engine(this.container, this.sceneManager);
            this.engine.init();

            // ── Step 4: Initialize Input System ──────────────────────────
            this.input = new InputManager(this.state, this.engine.getCanvas());
            this.input.init();

            // ── Step 5: Register state callbacks ─────────────────────────
            this._registerStateCallbacks();

            // ── Step 6: Wire up the Game Loop ────────────────────────────
            this._setupGameLoop();

            // ── Step 6: Transition to LOADING state ──────────────────────
            this.state.setState(GameStates.LOADING);

            // ── Step 7: Load core assets and game data ───────────────────
            await this._loadCoreAssets();

            // ── Step 8: Set up the initial scene (a simple demo scene) ───
            this._setupDemoScene();

            // ── Step 9: Start the game loop ──────────────────────────────
            this.gameLoop.start();

            // ── Step 10: Transition to MENU (or PLAYING for testing) ─────
            this.state.setState(GameStates.MENU);

            // Expose globally for console debugging
            window.game = this;

            this.ready = true;
            console.log('[Game] ═══════════════════════════════════════════');
            console.log('[Game] Initialization complete! Game is running.');
            console.log('[Game] Type `game.getDebugInfo()` in console for status.');
            console.log('[Game] ═══════════════════════════════════════════');

            return this;

        } catch (error) {
            console.error('[Game] Fatal initialization error:', error);
            this._showErrorScreen(error);
            throw error;
        }
    }

    // ─── State Callbacks ─────────────────────────────────────────────────────

    /**
     * Register enter/exit callbacks for each game state
     * @private
     */
    _registerStateCallbacks() {
        // LOADING state
        this.state.onEnter(GameStates.LOADING, () => {
            this._showLoadingUI(true);
        });
        this.state.onExit(GameStates.LOADING, () => {
            this._showLoadingUI(false);
        });

        // MENU state
        this.state.onEnter(GameStates.MENU, () => {
            this._showMenuUI(true);
            this.gameLoop.pause();
        });
        this.state.onExit(GameStates.MENU, () => {
            this._showMenuUI(false);
        });

        // PLAYING state
        this.state.onEnter(GameStates.PLAYING, () => {
            this.gameLoop.resume();
            this._showHUD(true);
        });
        this.state.onExit(GameStates.PLAYING, () => {
            this._showHUD(false);
        });

        // PAUSED state
        this.state.onEnter(GameStates.PAUSED, () => {
            this.gameLoop.pause();
            this._showPauseUI(true);
        });
        this.state.onExit(GameStates.PAUSED, () => {
            this._showPauseUI(false);
        });

        // Log all state changes
        this.state.on('stateChange', ({ from, to }) => {
            console.log(`[Game] State: ${from} → ${to}`);
        });
    }

    // ─── Game Loop Wiring ────────────────────────────────────────────────────

    /**
     * Connect the game loop callbacks to the appropriate systems
     * @private
     */
    _setupGameLoop() {
        // Fixed update — physics, AI, game logic (60 Hz)
        this.gameLoop.setFixedUpdate((fixedDelta, tickCount) => {
            this._fixedUpdate(fixedDelta, tickCount);
        });

        // Variable update — animations, interpolation (every frame)
        this.gameLoop.setUpdate((dt, elapsed) => {
            this._update(dt, elapsed);
        });

        // Late update — camera, post-processing (after game logic)
        this.gameLoop.setLateUpdate((dt) => {
            this._lateUpdate(dt);
        });

        // Render — draw the scene
        this.gameLoop.setRender((interpolation) => {
            this.engine.render(interpolation);

            // Process deferred scene removals
            this.sceneManager.processPendingRemovals();
        });
    }

    // ─── Update Callbacks ────────────────────────────────────────────────────

    /**
     * Fixed-timestep update (physics, AI, combat logic)
     * Called at a constant rate regardless of frame rate.
     * @private
     * @param {number} fixedDelta - Fixed time step (e.g., 1/60)
     * @param {number} tickCount - Current tick number
     */
    _fixedUpdate(fixedDelta, tickCount) {
        // Only update game logic when actually playing
        if (!this.state.is(GameStates.PLAYING)) return;

        // Physics update (Part 3)
        if (this.physics) {
            this.physics.update(fixedDelta);
        }

        // AI update (Part 4)
        if (this.ai) {
            this.ai.update(fixedDelta);
        }

        // Combat update (Part 5)
        if (this.combat) {
            this.combat.update(fixedDelta);
        }

        // Mission update (Part 6)
        if (this.missionManager) {
            this.missionManager.update(fixedDelta);
        }
    }

    /**
     * Variable update (animations, visual interpolation, UI updates)
     * Called once per frame with the real delta time.
     * @private
     * @param {number} dt - Frame delta time in seconds
     * @param {number} elapsed - Total elapsed time
     */
    _update(dt, elapsed) {
        // Input polling — always active for menu navigation too
        if (this.input) {
            this.input.update(dt);

            // ── Global actions (work in any state) ───────────────────────
            if (this.input.wasTriggered(Actions.PAUSE)) {
                if (this.state.is(GameStates.PLAYING)) {
                    this.state.setState(GameStates.PAUSED);
                } else if (this.state.is(GameStates.PAUSED)) {
                    this.state.setState(GameStates.PLAYING);
                }
            }

            if (this.input.wasTriggered(Actions.DEBUG_TOGGLE)) {
                this.options.debug = !this.options.debug;
                console.log(`[Game] Debug mode: ${this.options.debug}`);
            }
        }

        // Only update gameplay systems when playing
        if (this.state.is(GameStates.PLAYING)) {
            // ── Input-driven aircraft control (temporary until full physics) ──
            if (this.input && this.playerAircraft) {
                this._applyInputToAircraft(dt);
            }

            // Weather / environment update
            if (this.weather) {
                this.weather.update(dt);
            }

            // World / terrain streaming
            if (this.world) {
                this.world.update(dt, this.engine.getCamera().position);
            }

            // Effects update (particles, explosions)
            if (this.effects) {
                this.effects.update(dt);
            }

            // Audio update (3D positioning)
            if (this.audio) {
                this.audio.update(dt, this.engine.getCamera());
            }

            // HUD update
            if (this.hud) {
                this.hud.update(dt);
            }

            // Debug overlay
            if (this.debugUI && this.options.debug) {
                this.debugUI.update(dt);
            }
        }

        // ── Flush input per-frame buffers (ALWAYS, even when paused) ─────
        if (this.input) {
            this.input.flush();
        }
    }

    /**
     * Late update (camera follow, post-processing)
     * Called after all game logic, before rendering.
     * @private
     * @param {number} dt - Frame delta time
     */
    _lateUpdate(dt) {
        // Camera update (Part 3) — follows player aircraft
        if (this.cameraManager) {
            this.cameraManager.update(dt);
            // Sync the engine's active camera with whatever the camera manager chose
            const activeCamera = this.cameraManager.getActiveCamera();
            if (activeCamera) {
                this.engine.setCamera(activeCamera);
            }
        }
    }

    // ─── Asset Loading ───────────────────────────────────────────────────────

    /**
     * Load essential game data and assets
     * @private
     */
    async _loadCoreAssets() {
        console.log('[Game] Loading core assets...');

        // Set up progress tracking
        this.assetLoader.setProgressCallback((progress, url) => {
            this._updateLoadingProgress(progress, url);
        });

        // Load game data JSONs
        this.gameData = await this.assetLoader.loadGameData();

        // If game data files are empty (as in our placeholder setup),
        // provide sensible defaults
        if (!this.gameData.aircraftStats || Object.keys(this.gameData.aircraftStats).length === 0) {
            this.gameData.aircraftStats = this._getDefaultAircraftStats();
        }
        if (!this.gameData.weaponStats || Object.keys(this.gameData.weaponStats).length === 0) {
            this.gameData.weaponStats = this._getDefaultWeaponStats();
        }
        if (!this.gameData.missionTemplates || Object.keys(this.gameData.missionTemplates).length === 0) {
            this.gameData.missionTemplates = this._getDefaultMissionTemplates();
        }

        console.log('[Game] Core assets loaded', Object.keys(this.gameData));
    }

    // ─── Demo Scene (For Testing Part 1) ─────────────────────────────────────

    /**
     * Set up a minimal demo scene to verify the engine works.
     * This creates a ground plane, a placeholder aircraft, some lights,
     * and a simple skybox color — enough to visually confirm rendering.
     * @private
     */
    _setupDemoScene() {
        console.log('[Game] Setting up demo scene...');
        const scene = this.sceneManager;

        // ── Lighting ─────────────────────────────────────────────────────
        // Directional sun light
        const sunLight = new THREE.DirectionalLight(0xffeedd, 1.5);
        sunLight.position.set(500, 800, 300);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.set(2048, 2048);
        sunLight.shadow.camera.near = 1;
        sunLight.shadow.camera.far = 3000;
        sunLight.shadow.camera.left = -500;
        sunLight.shadow.camera.right = 500;
        sunLight.shadow.camera.top = 500;
        sunLight.shadow.camera.bottom = -500;
        scene.add(sunLight, { name: 'sunLight', tags: ['light'] });

        // Ambient light for fill
        const ambient = new THREE.AmbientLight(0x445566, 0.6);
        scene.add(ambient, { name: 'ambientLight', tags: ['light'] });

        // Hemisphere light for sky/ground color blending
        const hemiLight = new THREE.HemisphereLight(0x88aacc, 0x445533, 0.4);
        scene.add(hemiLight, { name: 'hemiLight', tags: ['light'] });

        // ── Ground Plane ─────────────────────────────────────────────────
        const groundGeo = new THREE.PlaneGeometry(10000, 10000, 64, 64);
        const groundMat = new THREE.MeshStandardMaterial({
            color: 0x3a7d44,
            roughness: 0.9,
            metalness: 0.0
        });

        // Add some vertex displacement for hills
        const posAttr = groundGeo.getAttribute('position');
        for (let i = 0; i < posAttr.count; i++) {
            const x = posAttr.getX(i);
            const y = posAttr.getY(i);
            const height = Math.sin(x * 0.005) * Math.cos(y * 0.005) * 30
                         + Math.sin(x * 0.02) * Math.cos(y * 0.015) * 10;
            posAttr.setZ(i, height);
        }
        groundGeo.computeVertexNormals();

        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scene.add(ground, { name: 'ground', tags: ['terrain'], layer: 1 });

        // ── Placeholder Aircraft ─────────────────────────────────────────
        const aircraft = this.assetLoader.createPlaceholderModel('aircraft');
        aircraft.position.set(0, 100, 0);
        aircraft.castShadow = true;
        aircraft.scale.set(5, 5, 5);
        scene.add(aircraft, { name: 'playerAircraft', tags: ['aircraft', 'player'] });
        this.playerAircraft = aircraft;

        // ── Ocean Plane ──────────────────────────────────────────────────
        const oceanGeo = new THREE.PlaneGeometry(20000, 20000);
        const oceanMat = new THREE.MeshStandardMaterial({
            color: 0x1a5276,
            transparent: true,
            opacity: 0.85,
            roughness: 0.3,
            metalness: 0.1
        });
        const ocean = new THREE.Mesh(oceanGeo, oceanMat);
        ocean.rotation.x = -Math.PI / 2;
        ocean.position.y = -5;
        scene.add(ocean, { name: 'ocean', tags: ['water'] });

        // ── Grid Helper (debug) ──────────────────────────────────────────
        if (this.options.debug) {
            const grid = new THREE.GridHelper(2000, 100, 0x444444, 0x222222);
            grid.position.y = 0.1;
            scene.add(grid, { name: 'debugGrid', tags: ['debug'] });

            const axes = new THREE.AxesHelper(100);
            scene.add(axes, { name: 'debugAxes', tags: ['debug'] });
        }

        // ── Set Camera Position ──────────────────────────────────────────
        const cam = this.engine.getCamera();
        cam.position.set(-30, 120, 60);
        cam.lookAt(aircraft.position);

        // ── Sky Color ────────────────────────────────────────────────────
        this.sceneManager.setBackground(new THREE.Color(0x6eb5ff));
        this.sceneManager.setFog('exponential', {
            color: 0x8ec5fc,
            density: 0.00006
        });

        console.log('[Game] Demo scene ready');
    }

    // ─── Simple UI Helpers (placeholder until full UI in later Parts) ─────────

    /**
     * Show/hide loading screen
     * @private
     * @param {boolean} show
     */
    _showLoadingUI(show) {
        let el = document.getElementById('loading-screen');
        if (show) {
            if (!el) {
                el = document.createElement('div');
                el.id = 'loading-screen';
                el.innerHTML = `
                    <div style="position:fixed;top:0;left:0;width:100%;height:100%;
                        background:#0a0a1a;display:flex;flex-direction:column;
                        align-items:center;justify-content:center;z-index:1000;
                        font-family:'Courier New',monospace;color:#00ff88;">
                        <h1 style="font-size:2em;margin-bottom:20px;">FLIGHT COMBAT SIMULATOR</h1>
                        <div id="loading-bar-container" style="width:400px;height:4px;background:#222;border-radius:2px;">
                            <div id="loading-bar" style="width:0%;height:100%;background:#00ff88;border-radius:2px;transition:width 0.3s;"></div>
                        </div>
                        <p id="loading-text" style="margin-top:15px;font-size:0.9em;color:#668;">Loading...</p>
                    </div>`;
                document.body.appendChild(el);
            }
            el.style.display = 'block';
        } else if (el) {
            el.style.display = 'none';
        }
    }

    /**
     * Update loading progress bar
     * @private
     * @param {number} progress - 0 to 1
     * @param {string} [item=''] - Current item being loaded
     */
    _updateLoadingProgress(progress, item = '') {
        const bar = document.getElementById('loading-bar');
        const text = document.getElementById('loading-text');
        if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
        if (text) text.textContent = item ? `Loading: ${item}` : `${Math.round(progress * 100)}%`;
    }

    /**
     * Show/hide main menu overlay
     * @private
     * @param {boolean} show
     */
    _showMenuUI(show) {
        let el = document.getElementById('main-menu');
        if (show) {
            if (!el) {
                el = document.createElement('div');
                el.id = 'main-menu';
                el.innerHTML = `
                    <div style="position:fixed;top:0;left:0;width:100%;height:100%;
                        background:rgba(0,0,0,0.7);display:flex;flex-direction:column;
                        align-items:center;justify-content:center;z-index:900;
                        font-family:'Courier New',monospace;color:white;">
                        <h1 style="font-size:2.5em;margin-bottom:10px;color:#00ff88;">
                            ✈ FLIGHT COMBAT
                        </h1>
                        <p style="color:#889;margin-bottom:40px;">Browser-Based 3D Flight Simulator</p>
                        <button id="btn-play" style="padding:15px 60px;font-size:1.2em;
                            background:#00ff88;color:#000;border:none;cursor:pointer;
                            font-family:inherit;font-weight:bold;margin:5px;
                            border-radius:4px;">
                            ▶ START MISSION
                        </button>
                        <button id="btn-debug" style="padding:10px 40px;font-size:0.9em;
                            background:transparent;color:#556;border:1px solid #333;
                            cursor:pointer;font-family:inherit;margin-top:15px;
                            border-radius:4px;">
                            [DEBUG MODE]
                        </button>
                        <p style="color:#445;margin-top:40px;font-size:0.8em;">
                            WASD / Arrow Keys to fly • Mouse to look • Space to fire
                        </p>
                    </div>`;
                document.body.appendChild(el);

                // Button handlers
                document.getElementById('btn-play').addEventListener('click', () => {
                    this.startPlaying();
                });
                document.getElementById('btn-debug').addEventListener('click', () => {
                    this.options.debug = true;
                    this.startPlaying();
                });
            }
            el.style.display = 'block';
        } else if (el) {
            el.style.display = 'none';
        }
    }

    /**
     * Show/hide HUD
     * @private
     * @param {boolean} show
     */
    _showHUD(show) {
        let el = document.getElementById('game-hud');
        if (show) {
            if (!el) {
                el = document.createElement('div');
                el.id = 'game-hud';
                el.innerHTML = `
                    <!-- Top-left: Flight data -->
                    <div style="position:fixed;top:10px;left:10px;z-index:800;
                        font-family:'Courier New',monospace;color:#00ff88;font-size:12px;
                        background:rgba(0,0,0,0.5);padding:10px;border-radius:4px;
                        pointer-events:none;min-width:260px;">
                        <div id="hud-fps">FPS: --</div>
                        <div id="hud-state">State: --</div>
                        <div id="hud-pos">Pos: --</div>
                        <div id="hud-speed">Speed: --</div>
                        <div id="hud-alt">Alt: --</div>
                        <div style="margin-top:6px;border-top:1px solid #224;padding-top:6px;">
                            <div id="hud-throttle-label" style="margin-bottom:2px;">Throttle: 50%</div>
                            <div style="width:100%;height:6px;background:#112;border-radius:3px;overflow:hidden;">
                                <div id="hud-throttle-bar" style="width:50%;height:100%;background:#00ff88;border-radius:3px;transition:width 0.1s;"></div>
                            </div>
                        </div>
                    </div>
                    <!-- Top-right: Input axes -->
                    <div id="hud-input-panel" style="position:fixed;top:10px;right:10px;z-index:800;
                        font-family:'Courier New',monospace;color:#88aaff;font-size:11px;
                        background:rgba(0,0,0,0.5);padding:10px;border-radius:4px;
                        pointer-events:none;min-width:180px;">
                        <div style="color:#556;margin-bottom:4px;">── INPUT ──</div>
                        <div id="hud-pitch">Pitch: 0.00</div>
                        <div id="hud-roll">Roll: 0.00</div>
                        <div id="hud-yaw">Yaw: 0.00</div>
                        <div id="hud-device" style="margin-top:6px;color:#556;">Device: keyboard</div>
                        <div id="hud-actions" style="margin-top:4px;color:#446;font-size:10px;word-break:break-all;"></div>
                    </div>
                    <!-- Bottom center: Controls hint -->
                    <div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
                        z-index:800;font-family:'Courier New',monospace;color:#667;
                        font-size:11px;pointer-events:none;text-align:center;">
                        <span style="color:#889;">WASD</span> Fly &nbsp;|&nbsp;
                        <span style="color:#889;">Shift/Ctrl</span> Throttle &nbsp;|&nbsp;
                        <span style="color:#889;">Q/E</span> Rudder &nbsp;|&nbsp;
                        <span style="color:#889;">Space</span> Fire &nbsp;|&nbsp;
                        <span style="color:#889;">ESC</span> Pause &nbsp;|&nbsp;
                        <span style="color:#889;">~</span> Debug
                    </div>`;
                document.body.appendChild(el);
            }
            el.style.display = 'block';

            // Start HUD update interval
            this._hudInterval = setInterval(() => this._updateHUD(), 100);
        } else {
            if (el) el.style.display = 'none';
            if (this._hudInterval) {
                clearInterval(this._hudInterval);
                this._hudInterval = null;
            }
        }
    }

    /**
     * Update HUD readouts
     * @private
     */
    _updateHUD() {
        const metrics = this.gameLoop.getMetrics();
        const aircraft = this.playerAircraft;

        const fpsEl = document.getElementById('hud-fps');
        const stateEl = document.getElementById('hud-state');
        const posEl = document.getElementById('hud-pos');
        const speedEl = document.getElementById('hud-speed');
        const altEl = document.getElementById('hud-alt');

        if (fpsEl) fpsEl.textContent = `FPS: ${metrics.fps} | Frame: ${metrics.avgFrameTime}`;
        if (stateEl) stateEl.textContent = `State: ${this.state.getState()}`;

        if (aircraft) {
            const p = aircraft.position;
            if (posEl) posEl.textContent = `Pos: ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}`;
            if (altEl) altEl.textContent = `Alt: ${p.y.toFixed(0)}m`;
        }

        // Input-driven readouts
        if (this.input) {
            const throttle = this.input.getThrottle();
            const speed = this._speed || 0;
            const kts = (speed * 1.944).toFixed(0); // m/s → knots
            if (speedEl) speedEl.textContent = `Speed: ${kts} kts | Thr: ${(throttle * 100).toFixed(0)}%`;

            // Throttle bar
            const thrBar = document.getElementById('hud-throttle-bar');
            const thrLabel = document.getElementById('hud-throttle-label');
            if (thrBar) {
                const pct = (throttle * 100).toFixed(0);
                thrBar.style.width = pct + '%';
                // Color: green < 80%, orange 80-95%, red 95%+ (afterburner)
                thrBar.style.background = throttle > 0.95 ? '#ff4444' : throttle > 0.8 ? '#ffaa00' : '#00ff88';
            }
            if (thrLabel) thrLabel.textContent = `Throttle: ${(throttle * 100).toFixed(0)}%`;

            // Input axes
            const pitchEl = document.getElementById('hud-pitch');
            const rollEl = document.getElementById('hud-roll');
            const yawEl = document.getElementById('hud-yaw');
            const deviceEl = document.getElementById('hud-device');
            const actionsEl = document.getElementById('hud-actions');

            if (pitchEl) pitchEl.textContent = `Pitch: ${this.input.getAxis('pitch').toFixed(2)}`;
            if (rollEl)  rollEl.textContent  = `Roll:  ${this.input.getAxis('roll').toFixed(2)}`;
            if (yawEl)   yawEl.textContent   = `Yaw:   ${this.input.getAxis('yaw').toFixed(2)}`;
            if (deviceEl) deviceEl.textContent = `Device: ${this.input.lastActiveDevice}${this.input.isPointerLocked() ? ' [locked]' : ''}`;

            // Show currently active actions
            if (actionsEl) {
                const kbActions = Array.from(this.input.keyboard.activeActions);
                actionsEl.textContent = kbActions.length > 0 ? kbActions.join(', ') : '';
            }
        } else {
            if (speedEl) speedEl.textContent = `Speed: -- kts`;
        }
    }

    /**
     * Show/hide pause menu
     * @private
     * @param {boolean} show
     */
    _showPauseUI(show) {
        let el = document.getElementById('pause-menu');
        if (show) {
            if (!el) {
                el = document.createElement('div');
                el.id = 'pause-menu';
                el.innerHTML = `
                    <div style="position:fixed;top:0;left:0;width:100%;height:100%;
                        background:rgba(0,0,0,0.6);display:flex;flex-direction:column;
                        align-items:center;justify-content:center;z-index:950;
                        font-family:'Courier New',monospace;color:white;">
                        <h2 style="color:#ffaa00;margin-bottom:30px;">⏸ PAUSED</h2>
                        <button id="btn-resume" style="padding:12px 50px;font-size:1.1em;
                            background:#00ff88;color:#000;border:none;cursor:pointer;
                            font-family:inherit;font-weight:bold;margin:5px;border-radius:4px;">
                            ▶ RESUME
                        </button>
                        <button id="btn-quit" style="padding:10px 40px;font-size:0.9em;
                            background:transparent;color:#ff4444;border:1px solid #ff4444;
                            cursor:pointer;font-family:inherit;margin-top:10px;border-radius:4px;">
                            ✕ QUIT TO MENU
                        </button>
                    </div>`;
                document.body.appendChild(el);

                document.getElementById('btn-resume').addEventListener('click', () => {
                    this.state.setState(GameStates.PLAYING);
                });
                document.getElementById('btn-quit').addEventListener('click', () => {
                    this.state.forceState(GameStates.MENU);
                });
            }
            el.style.display = 'block';
        } else if (el) {
            el.style.display = 'none';
        }
    }

    /**
     * Show a fatal error screen
     * @private
     * @param {Error} error
     */
    _showErrorScreen(error) {
        const el = document.createElement('div');
        el.innerHTML = `
            <div style="position:fixed;top:0;left:0;width:100%;height:100%;
                background:#1a0000;display:flex;flex-direction:column;
                align-items:center;justify-content:center;z-index:9999;
                font-family:'Courier New',monospace;color:#ff4444;">
                <h1>⚠ ENGINE ERROR</h1>
                <p style="color:#884444;max-width:600px;text-align:center;margin-top:20px;">
                    ${error.message}
                </p>
                <p style="color:#553333;margin-top:10px;font-size:0.8em;">
                    Check the browser console for details.
                </p>
            </div>`;
        document.body.appendChild(el);
    }

    // ─── Game Flow ───────────────────────────────────────────────────────────

    /**
     * Transition from menu to playing state
     * (Simplified — later parts add map/plane selection flow)
     */
    startPlaying() {
        // Force transition since we're skipping MAP_SELECT and PLANE_SELECT for now
        this.state.forceState(GameStates.PLAYING);

        // Initialize flight velocity for demo movement
        if (!this._flightVelocity) {
            this._flightVelocity = new THREE.Vector3(0, 0, 0);
            this._speed = 80; // Starting speed m/s
        }
    }

    /**
     * Apply input axes to the placeholder aircraft (temporary until full physics Part 3).
     * Provides immediate, tangible flight response so the input system can be tested.
     * @private
     * @param {number} dt - Delta time
     */
    _applyInputToAircraft(dt) {
        const aircraft = this.playerAircraft;
        if (!aircraft) return;

        // Read composite axes from the input manager
        const pitch = this.input.getAxis('pitch');
        const roll  = this.input.getAxis('roll');
        const yaw   = this.input.getAxis('yaw');
        const throttle = this.input.getThrottle();

        // Rotation rates (radians/second)
        const pitchRate = 1.8;
        const rollRate  = 3.0;
        const yawRate   = 1.2;

        // For our aircraft model facing +X (right-hand coordinate system):
        //   Pitch = rotation around local Z axis (positive Z-rot = nose UP)
        //   Roll  = rotation around local X axis (positive X-rot = roll RIGHT / clockwise from behind)
        //   Yaw   = rotation around local Y axis (positive Y-rot = nose LEFT)
        //
        // Axis values: W held → PITCH_DOWN active → pitch axis = +1 → we want nose DOWN
        //              S held → PITCH_UP active   → pitch axis = -1 → we want nose UP
        //              A held → ROLL_LEFT active  → roll axis = -1  → we want roll LEFT
        //              D held → ROLL_RIGHT active → roll axis = +1  → we want roll RIGHT

        aircraft.rotateZ(-pitch * pitchRate * dt);     // Pitch: +axis = nose down (negative Z rotation)
        aircraft.rotateX(roll * rollRate * dt);         // Roll:  +axis = roll right (positive X rotation)
        aircraft.rotateY(-yaw * yawRate * dt);          // Yaw:   +axis = nose right (negative Y rotation)

        // Speed from throttle (20–200 m/s range for demo)
        this._speed = 20 + throttle * 180;

        // Move forward in the aircraft's local forward direction (+X for our model)
        const forward = new THREE.Vector3(1, 0, 0);
        forward.applyQuaternion(aircraft.quaternion);
        aircraft.position.addScaledVector(forward, this._speed * dt);

        // Prevent going underground
        if (aircraft.position.y < 5) {
            aircraft.position.y = 5;
        }

        // ── Chase Camera ─────────────────────────────────────────────────
        // Simple third-person camera that follows the aircraft (until Camera Manager in Part 3)
        const cam = this.engine.getCamera();
        const behind = new THREE.Vector3(-40, 12, 0); // Behind and above in local space
        behind.applyQuaternion(aircraft.quaternion);
        const desiredPos = aircraft.position.clone().add(behind);

        // Smooth follow
        cam.position.lerp(desiredPos, 5.0 * dt);

        // Look slightly ahead of the aircraft
        const lookAhead = new THREE.Vector3(30, 0, 0);
        lookAhead.applyQuaternion(aircraft.quaternion);
        const lookTarget = aircraft.position.clone().add(lookAhead);
        cam.lookAt(lookTarget);
    }

    // ─── Default Game Data ───────────────────────────────────────────────────

    /**
     * Default aircraft stats (used when data files are empty)
     * @private
     * @returns {Object}
     */
    _getDefaultAircraftStats() {
        return {
            f16: {
                name: 'F-16 Fighting Falcon',
                maxSpeed: 590,         // m/s (~Mach 2)
                stallSpeed: 70,        // m/s
                maxThrust: 130000,     // Newtons
                mass: 9200,            // kg (empty)
                wingArea: 27.87,       // m²
                maxG: 9,
                climbRate: 254,        // m/s
                turnRate: 18,          // deg/s
                health: 100,
                armor: 20
            },
            f22: {
                name: 'F-22 Raptor',
                maxSpeed: 660,
                stallSpeed: 65,
                maxThrust: 156000,
                mass: 19700,
                wingArea: 78.04,
                maxG: 9.5,
                climbRate: 330,
                turnRate: 22,
                health: 120,
                armor: 30
            },
            su27: {
                name: 'Su-27 Flanker',
                maxSpeed: 610,
                stallSpeed: 60,
                maxThrust: 122500,
                mass: 16380,
                wingArea: 62,
                maxG: 9,
                climbRate: 300,
                turnRate: 20,
                health: 110,
                armor: 25
            }
        };
    }

    /**
     * Default weapon stats
     * @private
     * @returns {Object}
     */
    _getDefaultWeaponStats() {
        return {
            vulcan: { name: 'M61 Vulcan', type: 'gun', damage: 15, rateOfFire: 100, range: 2000, ammo: 500 },
            aim9:   { name: 'AIM-9 Sidewinder', type: 'missile', damage: 80, speed: 900, range: 18000, count: 4, tracking: 'ir' },
            aim120: { name: 'AIM-120 AMRAAM', type: 'missile', damage: 100, speed: 1200, range: 75000, count: 2, tracking: 'radar' }
        };
    }

    /**
     * Default mission templates
     * @private
     * @returns {Object}
     */
    _getDefaultMissionTemplates() {
        return {
            dogfight: {
                name: 'Dogfight',
                description: 'Engage and destroy enemy fighters.',
                type: 'dogfight',
                enemyCount: 3,
                timeLimit: 600
            },
            intercept: {
                name: 'Intercept',
                description: 'Intercept incoming bombers before they reach the base.',
                type: 'intercept',
                enemyCount: 5,
                timeLimit: 300
            }
        };
    }

    // ─── Debug ───────────────────────────────────────────────────────────────

    /**
     * Get comprehensive debug information about the entire game
     * @returns {Object}
     */
    getDebugInfo() {
        return {
            ready: this.ready,
            state: this.state.getDebugInfo(),
            engine: this.engine?.getDebugInfo(),
            gameLoop: this.gameLoop.getDebugInfo(),
            scene: this.sceneManager?.getDebugInfo(),
            assets: this.assetLoader.getDebugInfo(),
            input: this.input?.getDebugInfo(),
            gameData: {
                aircraftCount: Object.keys(this.gameData.aircraftStats || {}).length,
                weaponCount: Object.keys(this.gameData.weaponStats || {}).length,
                missionCount: Object.keys(this.gameData.missionTemplates || {}).length
            },
            subsystems: {
                input: !!this.input,
                physics: !!this.physics,
                camera: !!this.cameraManager,
                hud: !!this.hud,
                audio: !!this.audio,
                weather: !!this.weather,
                missions: !!this.missionManager,
                combat: !!this.combat,
                ai: !!this.ai,
                world: !!this.world,
                effects: !!this.effects,
                debug: !!this.debugUI
            }
        };
    }

    // ─── Cleanup ─────────────────────────────────────────────────────────────

    /**
     * Shut down the entire game and clean up all resources
     */
    dispose() {
        console.log('[Game] Shutting down...');

        this.gameLoop.dispose();
        this.input?.dispose();
        this.sceneManager?.dispose();
        this.engine?.dispose();
        this.assetLoader.dispose();
        this.state.dispose();

        // Remove UI elements
        ['loading-screen', 'main-menu', 'game-hud', 'pause-menu'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });

        // Clear HUD interval
        if (this._hudInterval) clearInterval(this._hudInterval);

        window.game = null;
        console.log('[Game] Disposed. Goodbye!');
    }
}