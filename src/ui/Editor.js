import GUI from 'lil-gui';
import { settings } from '../config/settings.js';
import { LITTER_CELLS } from '../world/LeafLitter.js';
import { PresetManager } from './PresetManager.js';

/**
 * Real-time stage editor.
 *
 * Every control binds straight to a field in `config/settings.js`. Because the
 * lights, the floor shader, the dust, the camera rig and the post stack all
 * *read* those fields each frame, no controller needs an onChange handler:
 * moving a slider re-lights the scene on the next frame, with no rebuild and no
 * shader recompilation.
 *
 * That holds while the clock is paused (`P`) — which is the point, since the
 * pose worth lighting is usually a frozen one. The two exceptions are noted
 * where they occur: the floor's stone maps flip a shader define, and the
 * character's scale is resolved once at load.
 */
export class Editor {
  /**
   * @param {object} hooks { onToast, onRespawnEnemies, onCastAscendance,
   *   onCastShadowBoost }
   */
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.presets = new PresetManager();

    this.gui = new GUI({ title: '스테이지 에디터', width: 330 });
    this.gui.domElement.style.setProperty('--title-height', '30px');

    this._presetState = { name: 'My preset', selected: this.presets.names[0] ?? '' };
    // Starts hidden: opened over a third of the screen it hid the play field. G opens it.
    this._hidden = true;

    this._buildPresets();
    this._buildEnvironment();
    this._buildAir();
    this._buildTerrain();
    this._buildLeaves();
    // The light/dark boon casts were the fantasy template's party tricks;
    // their dev buttons have no place in the SF build's panel.
    this._buildPost();
    this._buildCamera();
    this._buildCharacter();
    this._buildLocomotion();
    this._buildWeapons();
    this._buildGunplay();
    this._buildCombat();
    this._buildStudio();

    // Everything starts collapsed, top-level folders included: the panel opens
    // as a list of sections and the user picks one.
    this.gui.foldersRecursive().forEach((folder) => folder.close());
    this.gui.show(!this._hidden);
  }

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */

  static range(folder, object, key, min, max, step, label) {
    return folder.add(object, key, min, max, step).name(label ?? key);
  }

  /** Re-read every control from settings — after a preset load or a reset. */
  refresh() {
    this.gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
  }

  /** @returns {boolean} whether the panel is now on screen */
  toggle() {
    this._hidden = !this._hidden;
    this.gui.show(!this._hidden);
    return !this._hidden;
  }

  /* ------------------------------------------------------------------ */
  /* folders                                                             */
  /* ------------------------------------------------------------------ */

  _buildPresets() {
    const folder = this.gui.addFolder('프리셋');
    const state = this._presetState;

    let selector = folder
      .add(state, 'selected', this.presets.names.length ? this.presets.names : [''])
      .name('preset');

    // lil-gui rebuilds the controller when the option list changes, so the
    // reference has to be replaced rather than mutated.
    const refreshOptions = () => {
      const names = this.presets.names;
      selector = selector.options(names.length ? names : ['']).name('preset');
      selector.setValue(names.includes(state.selected) ? state.selected : (names[0] ?? ''));
    };

    folder.add(state, 'name').name('name');

    folder
      .add(
        {
          save: () => {
            this.presets.save(state.name);
            state.selected = state.name;
            refreshOptions();
            this.hooks.onToast?.(`Saved preset "${state.name}"`);
          }
        },
        'save'
      )
      .name('Save preset');

    folder
      .add(
        {
          load: () => {
            if (this.presets.load(state.selected)) {
              this.refresh();
              this.hooks.onToast?.(`Loaded "${state.selected}"`);
            }
          }
        },
        'load'
      )
      .name('Load preset');

    folder
      .add(
        {
          duplicate: () => {
            const copy = this.presets.duplicate(state.selected);
            if (copy) {
              state.selected = copy;
              refreshOptions();
              this.hooks.onToast?.(`Duplicated to "${copy}"`);
            }
          }
        },
        'duplicate'
      )
      .name('Duplicate');

    folder
      .add(
        {
          remove: () => {
            if (this.presets.remove(state.selected)) {
              refreshOptions();
              this.hooks.onToast?.('Preset deleted');
            }
          }
        },
        'remove'
      )
      .name('Delete');

    folder
      .add({ exportOne: () => this.presets.exportJSON() }, 'exportOne')
      .name('Export current (JSON)');
    folder.add({ exportAll: () => this.presets.exportAll() }, 'exportAll').name('Export all presets');

    folder
      .add(
        {
          import: async () => {
            const result = await this.presets.importFromFile();
            refreshOptions();
            this.refresh();
            this.hooks.onToast?.(
              result.applied
                ? 'Settings imported'
                : result.imported.length
                  ? `Imported ${result.imported.length} preset(s)`
                  : 'Nothing imported'
            );
          }
        },
        'import'
      )
      .name('Import JSON…');

    folder
      .add(
        {
          reset: () => {
            this.presets.reset();
            this.refresh();
            this.hooks.onToast?.('Reset to defaults');
          }
        },
        'reset'
      )
      .name('Reset to defaults');

    this.presetFolder = folder;
  }

  /* ------------------------------------------------------------------ */

  _buildEnvironment() {
    const folder = this.gui.addFolder('환경');
    const e = settings.environment;
    const R = Editor.range;

    // The key and the rim are the character's own lights. three cannot exclude
    // an object from a light, so the world's surfaces are patched to drop every
    // directional light instead — see `Environment#excludeFromKeyLights`. Off,
    // and the pair go back to lighting the whole landscape.
    folder.add(e, 'keyCharacterOnly').name('key & rim: character only');
    R(folder, e, 'sunIntensity', 0, 8, 0.01, 'key intensity');
    folder.addColor(e, 'sunColor').name('key colour');
    R(folder, e, 'sunAzimuth', 0, Math.PI * 2, 0.01, 'key azimuth');
    R(folder, e, 'sunElevation', 0.05, 1.5, 0.01, 'key elevation');
    R(folder, e, 'ambientIntensity', 0, 3, 0.01, 'ambient');
    folder.addColor(e, 'ambientColor').name('ambient colour');
    R(folder, e, 'hemiIntensity', 0, 3, 0.01, 'hemisphere');
    R(folder, e, 'envIntensity', 0, 3, 0.01, 'env (IBL)');
    R(folder, e, 'shadowRadius', 0, 8, 0.05, 'shadow softness');
    R(folder, e, 'shadowBias', -0.01, 0.001, 0.0001, 'shadow bias');
    // The pair the character screen has always had and this one did not. Bias
    // works in depth and has to be re-dialled whenever `shadow box` moves; the
    // normal bias is in metres of world and does not. Speckle on a lit surface
    // wants this one raised, a shadow detaching from its feet wants it lowered.
    R(folder, e, 'shadowNormalBias', 0, 0.15, 0.001, 'shadow normal bias');
    R(folder, e, 'contactShadow', 0, 1.5, 0.01, 'contact shadow');
    // Half-width of the sun's shadow box. Bigger reaches further out for
    // casters and costs sharpness — the map is a fixed 4096², so this is
    // metres per texel in disguise. The distance below only has to be far
    // enough up-sun to clear the canopy; at a low elevation that is a long way.
    R(folder, e, 'shadowExtent', 12, 120, 1, 'shadow box (m)');
    R(folder, e, 'shadowDistance', 40, 400, 5, 'sun distance (m)');

    const rim = folder.addFolder('Rim light');
    R(rim, e, 'rimIntensity', 0, 4, 0.01, 'rim intensity');
    rim.addColor(e, 'rimColor').name('rim colour');
    R(rim, e, 'rimAzimuth', 0, Math.PI * 2, 0.01, 'rim azimuth');
    R(rim, e, 'rimElevation', 0.05, 1.5, 0.01, 'rim elevation');
    rim.addColor(e, 'hemiSkyColor').name('hemi sky');
    rim.addColor(e, 'hemiGroundColor').name('hemi bounce');

    // `tiled surface` flips USE_MAP, so it costs one shader recompile — fine for
    // an editor toggle, and free while it stays put. Switching sets downloads
    // the other one the first time it is picked.
    const floor = folder.addFolder('Stage floor');
    floor.add(e, 'floorTexture').name('tiled surface');
    floor.add(e, 'floorTextureSet', ['terrain', 'stone']).name('surface');
    R(floor, e, 'floorTextureScale', 0.5, 24, 0.1, 'tile size (m)');
    R(floor, e, 'floorNormalScale', 0, 3, 0.01, 'relief strength');
    R(floor, e, 'floorTexTint', 0, 1, 0.01, 'tint toward floor');
    floor.addColor(e, 'floorColor').name('floor colour');
    floor.addColor(e, 'floorTint').name('floor tint');
    R(floor, e, 'floorRoughness', 0.05, 1, 0.01, 'roughness');
    R(floor, e, 'floorSheen', 0, 1, 0.01, 'sheen');
    R(floor, e, 'floorPool', 0, 1, 0.01, 'light pool');
  }

  /* ------------------------------------------------------------------ */

  /**
   * Haze, sky and ground mist — one look, in one folder.
   *
   * They are together because they cannot be tuned apart. The sky's horizon *is*
   * the haze colour (bound by identity, which is why there is no control for it
   * under Sky); the mist is lit from the same moon direction the haze glows
   * along, and the moon's own angles live under Sky; and the ground fog's job is
   * to sit in front of a distance the haze has already dissolved. Move one and
   * the others are suddenly wrong.
   */
  _buildAir() {
    const folder = this.gui.addFolder('공기·하늘·안개');
    const R = Editor.range;

    const h = settings.haze;
    const haze = folder.addFolder('Distance haze');
    haze.add(h, 'enabled').name('haze enabled');
    haze.addColor(h, 'color').name('haze colour');
    haze.addColor(h, 'sunColor').name('into-moon colour');
    // 1/m, so the number itself means very little; the readout under it is what
    // you actually aim.
    R(haze, h, 'density', 0, 0.03, 0.0002, 'distance haze (1/m)');
    R(haze, h, 'start', 0, 40, 0.5, 'clear air (m)');
    haze
      .add(
        {
          get halfAt() {
            const d = settings.haze.density;
            return d > 1e-5 ? Math.round(Math.LN2 / d + settings.haze.start) : 9999;
          }
        },
        'halfAt'
      )
      .name('half hidden at (m)')
      .listen()
      .disable();
    // The layer that pools in the hollows. `mist floor` is the world height it
    // sits on and `mist depth` is how fast it thins going up — between them
    // they decide whether it is a ground effect or a wall.
    R(haze, h, 'ground', 0, 0.12, 0.001, 'ground mist (1/m)');
    R(haze, h, 'base', -12, 12, 0.1, 'mist floor (m)');
    R(haze, h, 'falloff', 0.5, 40, 0.1, 'mist depth (m)');
    // How far the air goes toward the moon's colour looking down the beam. The
    // highest-value control in this folder: at 0 the haze is a flat wash from
    // every angle, which is the one thing real air never is.
    R(haze, h, 'inscatter', 0, 1, 0.01, 'moon inscatter');
    R(haze, h, 'sunPower', 1, 24, 0.1, 'inscatter tightness');
    R(haze, h, 'max', 0, 1, 0.01, 'haze ceiling');

    const s = settings.sky;
    const sky = folder.addFolder('Sky');
    sky.add(s, 'enabled').name('sky enabled');
    sky.addColor(s, 'zenith').name('zenith');
    R(sky, s, 'gradient', 0.1, 3, 0.01, 'gradient');
    R(sky, s, 'sunGlow', 0, 12, 0.05, 'moon glare');
    R(sky, s, 'sunGlowPower', 1, 60, 0.5, 'glare tightness');
    R(sky, s, 'broadGlow', 0, 3, 0.01, 'broad wash');
    R(sky, s, 'exposure', 0, 3, 0.01, 'sky exposure');

    // The moon. `disc size` is 1 - cos of the half-angle, so the numbers look
    // small — 0.006 is about six degrees across, which is a dozen times life
    // size and exactly what the reference is.
    const moon = sky.addFolder('Moon');
    // Where it hangs — and the world's one light direction with it: the sky's
    // glare, the haze's inscatter lobe and the mist's lit side all resolve from
    // this pair (`Sky#_placeMoon` writes `frame.uLightDir`). The character's key
    // is a *different* angle, over in Environment.
    //
    // Elevation is capped low on purpose. The rig cannot aim much above 30°
    // (`camera.maxPolar`), so a moon parked higher than this is off the top of
    // the frame and only its glare is ever on screen — which is exactly why it
    // used to be invisible at the old 0.72.
    R(moon, s.moon, 'azimuth', 0, Math.PI * 2, 0.01, 'rotation (azimuth)');
    R(moon, s.moon, 'elevation', -0.05, 0.6, 0.005, 'elevation');
    R(moon, s, 'disc', 0, 40, 0.1, 'brightness');
    R(moon, s, 'discSize', 0.0005, 0.05, 0.0005, 'size');
    moon.addColor(s.moon, 'color').name('colour');

    // The body — a displaced sphere wearing a real lunar surface material
    // (`world/Moon.js`). Off, and the sky goes back to drawing the disc itself,
    // which is the only thing the two `maria` sliders at the bottom still feed.
    const body = moon.addFolder('Surface');
    body.add(s.moon, 'geometry').name('textured body');
    // The body's own two masters. `brightness` above is `sky.disc`, which is
    // also the glare's and what the haze's lobe is sized against — these two
    // are the ones to reach for when the sphere itself is too hot or too solid,
    // because they move it and nothing else. Both at 1 is untouched.
    R(body, s.moon, 'brightness', 0, 3, 0.01, 'body brightness');
    R(body, s.moon, 'opacity', 0, 1, 0.01, 'body opacity');
    // The one control here that changes the picture rather than the finish:
    // where the moon's *own* sun is, from full through half to new.
    R(body, s.moon, 'phase', 0, Math.PI, 0.01, 'phase (full → new)');
    R(body, s.moon, 'phaseTilt', -1.2, 1.2, 0.01, 'phase tilt');
    R(body, s.moon, 'terminator', 0.005, 0.5, 0.005, 'terminator softness');
    R(body, s.moon, 'flatten', 0.1, 2, 0.01, 'limb flatness');
    R(body, s.moon, 'earthshine', 0, 0.4, 0.005, 'earthshine');
    R(body, s.moon, 'edge', 0.001, 0.4, 0.001, 'limb fade');
    R(body, s.moon, 'displacement', 0, 0.25, 0.005, 'relief (geometry)');
    R(body, s.moon, 'relief', 0, 1, 0.01, 'relief (normals)');
    R(body, s.moon, 'ao', 0, 1, 0.01, 'crater shadow (AO)');
    R(body, s.moon, 'sheen', 0, 0.5, 0.005, 'sheen');
    R(body, s.moon, 'textureScale', 0.2, 6, 0.05, 'crater scale');
    R(body, s.moon, 'blendSharpness', 1, 16, 0.5, 'projection blend');
    R(body, s.moon, 'tilt', -Math.PI, Math.PI, 0.01, 'face tilt');
    R(body, s.moon, 'spin', -Math.PI, Math.PI, 0.01, 'face spin');

    // Fallback disc only: with the body up, `Sky` is not drawing a disc at all.
    R(moon, s.moon, 'detail', 0, 1, 0.01, 'maria (disc only)');
    R(moon, s.moon, 'detailScale', 1, 24, 0.1, 'maria size (disc only)');

    // One hash per lattice cell, so the whole sky of them is about the price of
    // a single texture lookup. `density` is cells per unit direction: up packs
    // more in and shrinks each one.
    const stars = sky.addFolder('Stars');
    const st = s.stars;
    stars.add(st, 'enabled').name('stars enabled');
    R(stars, st, 'density', 40, 600, 5, 'density');
    R(stars, st, 'brightness', 0, 6, 0.05, 'brightness');
    R(stars, st, 'twinkle', 0, 1, 0.01, 'twinkle');
    R(stars, st, 'horizon', 0, 0.6, 0.01, 'gone below (sin elev)');

    this._buildGroundFog(folder);
  }

  /**
   * The mist that rolls over the ground — see `world/GroundFog.js`.
   *
   * A sub-folder of the air rather than a folder of its own, because it is the
   * near half of the same effect: the haze above dissolves the distance, and
   * this puts something between you and it that has a shape and moves.
   *
   * Everything here is live. `count` is the only control that touches a buffer,
   * and even that only reveals or hides slots that were allocated at boot — the
   * mist never rebuilds.
   */
  _buildGroundFog(parent) {
    const folder = parent.addFolder('Ground fog (emitter)');
    const f = settings.groundFog;
    const R = Editor.range;

    folder.add(f, 'enabled').name('enabled');
    // Density is `count` against `life`: a slot respawns the instant it dies, so
    // the emitter is releasing count/life puffs a second. `count` is also the
    // fill-rate dial — it is the first thing to turn down if the frame is tight.
    R(folder, f, 'count', 0, 512, 1, 'puffs (cost)');
    R(folder, f, 'life', 1, 60, 0.5, 'life (s)');
    R(folder, f, 'lifeVariance', 0, 0.95, 0.01, 'life spread');
    R(folder, f, 'opacity', 0, 1, 0.01, 'opacity');

    // Where it comes from. `follow` parks the emitter on the character, which is
    // what keeps mist around the camera on an endless floor; off, x/z are a
    // fixed world position and the bank stays in the hollow you put it in.
    const emitter = folder.addFolder('Emitter');
    emitter.add(f, 'follow').name('follow character');
    R(emitter, f, 'x', -200, 200, 0.5, 'x / offset X (m)');
    R(emitter, f, 'z', -200, 200, 0.5, 'z / offset Z (m)');
    R(emitter, f, 'radius', 0, 120, 0.5, 'spawn radius (m)');
    // The hole kept clear around the lens. Nothing else in this panel can fix a
    // puff sitting between you and the character: raise this until the closest
    // mist is behind the camera's own distance to them.
    R(emitter, f, 'nearFade', 0, 40, 0.25, 'clear of camera (m)');
    R(emitter, f, 'nearFadeRange', 0.5, 40, 0.25, 'clear ramp (m)');

    const drift = folder.addFolder('Drift');
    R(drift, f, 'windX', -8, 8, 0.05, 'wind X (m/s)');
    R(drift, f, 'windZ', -8, 8, 0.05, 'wind Z (m/s)');
    R(drift, f, 'rise', -1, 2, 0.01, 'rise (m/s)');
    R(drift, f, 'hover', -1, 8, 0.05, 'hover above ground (m)');
    R(drift, f, 'swirl', 0, 8, 0.05, 'wander (m)');
    R(drift, f, 'swirlSpeed', 0, 1.5, 0.01, 'wander speed');
    R(drift, f, 'spin', 0, 1, 0.005, 'roll (rad/s)');

    const look = folder.addFolder('Look');
    R(look, f, 'sizeStart', 0.2, 40, 0.1, 'size at birth (m)');
    R(look, f, 'sizeEnd', 0.2, 60, 0.1, 'size at death (m)');
    look.addColor(f, 'color').name('mist colour');
    look.addColor(f, 'litColor').name('into-moon colour');
    R(look, f, 'moonlight', 0, 1.5, 0.01, 'moonlight');
    R(look, f, 'moonPower', 0.5, 12, 0.1, 'moonlight tightness');
    R(look, f, 'softness', 0.02, 1, 0.01, 'edge softness');
    R(look, f, 'fadeIn', 0.01, 0.9, 0.01, 'fade in (of life)');
    R(look, f, 'fadeOut', 0.01, 0.9, 0.01, 'fade out (of life)');
    // What hides the line where a billboard crosses the terrain. Too small and
    // the cut shows; too large and the mist floats off the ground.
    R(look, f, 'groundFade', 0.05, 8, 0.05, 'dissolve into ground (m)');
    R(look, f, 'detail', 0, 1, 0.01, 'noise breakup');
    R(look, f, 'detailScale', 0.5, 12, 0.1, 'breakup size');
  }

  /* ------------------------------------------------------------------ */

  /**
   * The shape of the ground — see `world/Terrain.js`.
   *
   * Every control here is a shader uniform read by the floor *and* the CPU that
   * stands the character up, so the landscape can be redialled while walking
   * over it and the body keeps its feet on whatever comes out. The two that are
   * not free are called out below.
   */
  _buildTerrain() {
    const folder = this.gui.addFolder('지형');
    const t = settings.terrain;
    const R = Editor.range;

    folder.add(t, 'enabled').name('terrain enabled');
    R(folder, t, 'amplitude', 0, 20, 0.05, 'height (m)');
    R(folder, t, 'scale', 8, 200, 1, 'hill size (m)');
    // The one real cost dial: the floor evaluates this field five times per
    // vertex (the height and its normal), so an octave here is paid for by
    // every vertex of the grid.
    R(folder, t, 'octaves', 1, 6, 1, 'detail (cost)');
    R(folder, t, 'warp', 0, 2, 0.01, 'warp (valleys)');
    R(folder, t, 'ridge', 0, 1, 0.01, 'ridges');

    const shape = folder.addFolder('Fine shape');
    R(shape, t, 'lacunarity', 1.5, 3, 0.01, 'octave step');
    R(shape, t, 'gain', 0.2, 0.7, 0.01, 'octave falloff');
    R(shape, t, 'seed', 0, 60, 0.1, 'seed').listen();
    shape
      .add(
        {
          randomize: () => {
            t.seed = Math.random() * 60;
          }
        },
        'randomize'
      )
      .name('Randomise landscape');
    // The only control in this folder that rebuilds anything: it swaps the
    // floor's grid, which is a one-frame hitch and 400 m / segments of vertex
    // spacing. Below about 128 the hills go visibly faceted in silhouette.
    shape
      .add(t, 'segments', [64, 128, 192, 256, 384, 512, 768])
      .name('floor mesh detail')
      .onChange((value) => {
        this.hooks.onToast?.(`Floor grid: ${(400 / value).toFixed(2)} m between vertices`);
      });
  }

  /**
   * The litter on the floor and the leaves in the air — see `world/Leaves.js`.
   *
   * One folder, because they are one look: the sheet, the grade, the backlight
   * and the wind at the top are shared by both populations by identity, and only
   * the two sub-folders differ. Everything here is live — the one control that
   * recompiles is the coverage switch, and it is called out where it sits.
   *
   * The control worth reaching for first is `backlight`. Leaves are one cell
   * thick and they glow when the moon is behind them; at 0 they are opaque chips
   * and the whole field reads as stickers on the ground.
   */
  _buildLeaves() {
    const folder = this.gui.addFolder('낙엽');
    const g = settings.leaves;
    const R = Editor.range;

    folder.add(g, 'enabled').name('leaves enabled');
    R(folder, g, 'size', 0.02, 0.6, 0.005, 'leaf length (m)');
    R(folder, g, 'sizeVariance', 0, 0.9, 0.01, 'size spread');

    // The sheet is a daylight photograph of a green beech and this stage is a
    // blue night. Without this the leaves are the one summer-coloured thing in
    // the frame.
    const look = folder.addFolder('Grade & backlight');
    look.addColor(g, 'tint').name('tint toward');
    R(look, g, 'tintAmount', 0, 1, 0.01, 'tint amount');
    look.addColor(g, 'backlightColor').name('through-leaf colour');
    R(look, g, 'backlight', 0, 3, 0.01, 'backlight');
    R(look, g, 'backlightPower', 1, 24, 0.5, 'backlight tightness');
    R(look, g, 'roughness', 0.02, 1, 0.01, 'roughness');
    R(look, g, 'normalScale', 0, 3, 0.05, 'relief (normals)');

    // The cut-out. Lower is a fatter leaf and a rougher edge; the coverage
    // switch is what keeps that edge from crawling, and it is the only control
    // in this folder that recompiles. It does nothing until there is MSAA to
    // resolve against — raise `samples` under Post processing first.
    const cut = look.addFolder('Cut-out');
    R(cut, g, 'alphaTest', 0.05, 0.95, 0.01, 'alpha cutoff');
    cut
      .add(g, 'alphaToCoverage')
      .name('smooth edge (needs MSAA)')
      .onChange((value) => {
        if (value && (settings.post.samples ?? 0) === 0) {
          this.hooks.onToast?.('Smooth leaf edges need post → samples above 0');
        }
      });
    R(cut, g, 'atlasInset', 0, 0.15, 0.005, 'sheet inset');

    // One wind for both populations: it quivers the litter where it lies and
    // carries the leaves in the air, so a gust crosses the whole field at once.
    const wind = folder.addFolder('Wind');
    R(wind, g, 'windX', -8, 8, 0.05, 'wind X (m/s)');
    R(wind, g, 'windZ', -8, 8, 0.05, 'wind Z (m/s)');
    R(wind, g, 'gustSpeed', 0, 3, 0.01, 'gust speed');
    R(wind, g, 'gustScale', 0.005, 0.4, 0.005, 'gust size (rad/m)');
    R(wind, g, 'gustStrength', 0, 3, 0.01, 'gust strength');

    /* ---- the ground ---- */
    const l = g.litter;
    const litter = folder.addFolder('Litter (on the ground)');
    litter.add(l, 'enabled').name('litter enabled');
    // The two cost dials. Live like everything else — they only decide where
    // the leaves are laid out, so moving one re-lays the grid rather than
    // rebuilding a buffer. `perCell` × 400 is the leaf count.
    R(litter, l, 'perCell', 1, 20, 1, 'per cell (cost)');
    R(litter, l, 'field', 20, 120, 1, 'window (m)');
    litter
      .add(
        {
          get leaves() {
            return Math.round(settings.leaves.litter.perCell) * LITTER_CELLS * LITTER_CELLS;
          }
        },
        'leaves'
      )
      .name('leaves drawn')
      .listen()
      .disable();
    R(litter, l, 'hover', 0, 0.2, 0.002, 'float above floor (m)');
    R(litter, l, 'rustle', 0, 1, 0.01, 'wind quiver (rad)');
    // Keep `gone by` inside half the window, or the edge of the field itself
    // comes into view.
    R(litter, l, 'fadeStart', 2, 80, 0.5, 'erodes from (m)');
    R(litter, l, 'fadeEnd', 3, 100, 0.5, 'gone by (m)');

    // What a foot does to them. `push speed` is the dead band that stops the
    // leaves under a standing character boiling; `forward blend` is what turns
    // the throw from an explosion underneath you into a sweep.
    const push = litter.addFolder('Underfoot');
    R(push, l, 'pushRadius', 0.1, 3, 0.05, 'sweep radius (m)');
    R(push, l, 'pushLead', -1, 2, 0.05, 'sweep ahead of body (m)');
    R(push, l, 'pushForce', 0, 3, 0.01, 'force');
    R(push, l, 'pushLift', 0, 2, 0.01, 'lift');
    R(push, l, 'pushForward', 0, 1, 0.01, 'forward blend');
    R(push, l, 'pushSpeed', 0, 3, 0.05, 'moves at least (m/s)');
    R(push, l, 'pushBudget', 1, 200, 1, 'leaves per frame (cap)');

    // And what the wind does: a few a second come unstuck and skitter downwind.
    const skitter = litter.addFolder('Blown along');
    R(skitter, l, 'gustRate', 0, 60, 0.5, 'lifted per second');
    R(skitter, l, 'gustForce', 0, 3, 0.01, 'force');
    R(skitter, l, 'gustLift', 0, 2, 0.01, 'lift');
    R(skitter, l, 'gustSpread', 0, 3.2, 0.05, 'fan (rad)');

    // The flight itself. The swirl and the spin both die out exactly as the leaf
    // lands, which is what makes the landing place computable — and that is what
    // lets a leaf be kicked again from where it came down.
    const flight = litter.addFolder('Flight');
    R(flight, l, 'flight', 0.1, 5, 0.05, 'flight (s)');
    R(flight, l, 'drag', 0.1, 8, 0.05, 'drag');
    R(flight, l, 'swirl', 0, 1.5, 0.01, 'swirl (m)');
    R(flight, l, 'swirlSpeed', 0, 20, 0.1, 'swirl speed');
    R(flight, l, 'spin', 0, 60, 0.5, 'tumble (rad/s)');

    /* ---- the air ---- */
    const d = g.drift;
    const drift = folder.addFolder('Drift (in the air)');
    drift.add(d, 'enabled').name('drift enabled');
    R(drift, d, 'count', 0, 1024, 1, 'leaves (cost)');
    R(drift, d, 'radius', 2, 90, 0.5, 'spawn radius (m)');
    R(drift, d, 'life', 2, 60, 0.5, 'life (s)');
    R(drift, d, 'lifeVariance', 0, 0.9, 0.01, 'life spread');
    R(drift, d, 'heightMin', 0, 20, 0.1, 'born from (m)');
    R(drift, d, 'heightMax', 0, 40, 0.1, 'born to (m)');
    R(drift, d, 'sizeScale', 0.1, 4, 0.05, 'size against litter');

    // The glide. A leaf is a wing: it does not drop, it swings across its own
    // fall, and this pair is most of why these read as leaves.
    const fall = drift.addFolder('Fall & flutter');
    R(fall, d, 'fall', 0, 4, 0.01, 'sink (m/s)');
    R(fall, d, 'flutter', 0, 3, 0.01, 'swing (m)');
    R(fall, d, 'flutterSpeed', 0, 8, 0.05, 'swing speed');
    R(fall, d, 'tumble', 0, 4, 0.01, 'turn over');
    R(fall, d, 'yawDrift', 0, 3, 0.01, 'yaw drift (rad/s)');
    // What makes one land instead of stopping dead on its edge.
    R(fall, d, 'settle', 0.05, 5, 0.05, 'flatten over (m)');
    R(fall, d, 'hover', 0, 0.3, 0.005, 'rests above floor (m)');

    const seen = drift.addFolder('Fade');
    R(seen, d, 'fadeIn', 0.005, 0.5, 0.005, 'in (of life)');
    R(seen, d, 'fadeOut', 0.005, 0.6, 0.005, 'out (of life)');
    R(seen, d, 'fadeStart', 2, 90, 0.5, 'erodes from (m)');
    R(seen, d, 'fadeEnd', 3, 120, 0.5, 'gone by (m)');
    // Nothing else can fix a leaf sitting on the lens.
    R(seen, d, 'nearFade', 0, 6, 0.05, 'clear of camera (m)');
    R(seen, d, 'nearFadeRange', 0.05, 6, 0.05, 'clear ramp (m)');
  }

  /**
   * Ascendance — the light, and the ten seconds it leaves behind.
   *
   * Five layers, one folder each, because that is how the effect is built and
   * dialling one of them means turning the other four off in your head first.
   *
   * The three worth reaching for before any of the rest are `duration` (how
   * long the boon is up), `haste` and `might` (what it is actually worth), and
   * `pillar -> height`, the number that decides whether the shaft came out of
   * the sky or out of a lamp just above the frame. "Call it down" fires the
   * whole thing on the spot, which is the only sane way to tune a move whose
   * first second is an intro.
   */
  /**
   * Shadow Boost — the dark, and the seconds it leaves behind.
   *
   * Five layers again, one folder each, and laid out in the order they are
   * drawn rather than the order they are noticed: the pool is at the bottom of
   * the stack and is doing more for the read than anything above it.
   *
   * Three to reach for before the rest. `might` is what the ability is *worth*
   * (it is the heavier of the two boons and the slower). `swirl -> stretch` is
   * the single number that decides whether the shadow going round the body is a
   * *spiral* or a cloud of blobs — it is how far each puff is drawn out along
   * its own orbit, and at 1 the layer stops working. And `column -> shade`,
   * which darkens the shaft's **edges** (not its middle — see
   * `vfx/DarkPillar.js`): it is what gives the column an outside, and it is the
   * slider to reach for if the shaft looks like a neon tube.
   */
  _buildPost() {
    const folder = this.gui.addFolder('후처리');
    const p = settings.post;
    const R = Editor.range;

    folder.add(p, 'enabled').name('enabled');
    // The only anti-aliasing in the project — the scene never touches the canvas
    // directly, so the renderer's own flag has nothing to act on. It is also the
    // heaviest thing in the stack, hence a dial rather than a constant.
    folder.add(p, 'samples', [0, 2, 4, 8]).name('anti-aliasing');
    R(folder, p, 'exposure', 0.1, 3, 0.01, 'exposure');
    R(folder, p, 'bloomStrength', 0, 3, 0.01, 'bloom intensity');
    R(folder, p, 'bloomRadius', 0, 1.5, 0.01, 'bloom radius');
    R(folder, p, 'bloomThreshold', 0, 2, 0.01, 'bloom threshold');
    R(folder, p, 'contrast', 0.5, 2, 0.01, 'contrast');
    R(folder, p, 'saturation', 0, 2.5, 0.01, 'saturation');
    R(folder, p, 'temperature', -0.5, 0.5, 0.01, 'temperature');
    R(folder, p, 'lift', -0.2, 0.2, 0.005, 'lift');
    R(folder, p, 'gain', 0.5, 2, 0.01, 'gain');
    R(folder, p, 'vignette', 0, 1.5, 0.01, 'vignette');
    R(folder, p, 'chromaticAberration', 0, 3, 0.01, 'chromatic aberration');
    R(folder, p, 'grain', 0, 0.2, 0.001, 'film grain');
  }

  _buildCamera() {
    const folder = this.gui.addFolder('카메라');
    const c = settings.camera;
    const R = Editor.range;

    // The wheel writes `distance` straight into settings, so the slider listens.
    R(folder, c, 'distance', 1, 40, 0.1, 'distance').listen();
    R(folder, c, 'minDistance', 1, 20, 0.1, 'min distance');
    R(folder, c, 'maxDistance', 4, 40, 0.1, 'max distance');
    R(folder, c, 'zoomSpeed', 0.1, 3, 0.01, 'zoom speed');
    R(folder, c, 'fov', 20, 90, 0.5, 'field of view');
    R(folder, c, 'targetHeight', 0, 4, 0.01, 'target height');
    R(folder, c, 'minPolar', 0.05, 1.5, 0.01, 'min pitch');
    // Past π/2 the camera drops below its target and the view tilts up, which is
    // the only way anything in the sky gets into frame. Nothing collides the
    // lens against the floor, so a long zoom at the top of this range will go
    // through the ground — which is why the default stops just past level.
    R(folder, c, 'maxPolar', 0.2, 2.2, 0.01, 'max pitch');
    R(folder, c, 'damping', 0.001, 0.5, 0.001, 'follow damping');
    // The captured pointer's turn rate, for every weapon and none — the sights
    // only multiply it (see the gunplay folder).
    R(folder, c, 'sensitivity', 0.0004, 0.008, 0.0001, 'mouse (rad/px)');
  }

  _buildCharacter() {
    const folder = this.gui.addFolder('캐릭터');
    const c = settings.character;
    const R = Editor.range;

    // The mixer's own rate.
    R(folder, settings.global, 'animationSpeed', 0.1, 3, 0.01, 'playback rate');
    R(folder, settings.global, 'timeScale', 0.02, 2, 0.01, 'time scale');

    // The turntable advances `facing` itself, so that slider listens.
    R(folder, c, 'spin', -0.5, 0.5, 0.005, 'turntable (rev/s)');
    R(folder, c, 'facing', -Math.PI, Math.PI * 3, 0.01, 'facing').listen();

    // The skin's response to the stage's lights. The body wears the glTF
    // palette's authored maps, so these two only reach it once the override is
    // on — off, they still drive any material the palette had no match for.
    const material = folder.addFolder('Skin');
    material.add(c, 'overrideSurface').name('override authored PBR');
    R(material, c, 'roughness', 0, 1, 0.01, 'roughness');
    R(material, c, 'metalness', 0, 1, 0.01, 'metalness');

    // The rig is re-normalised against `targetHeight` every frame, so this
    // rescales the body live — and anything attached to a bone with it.
    const rig = folder.addFolder('Rig');
    R(rig, c, 'targetHeight', 1, 3, 0.01, 'height (m)');
    R(rig, c, 'turnRate', 0.000001, 0.02, 0.000001, 'turn follow');
  }

  _buildLocomotion() {
    const folder = this.gui.addFolder('이동');
    const l = settings.locomotion;
    const R = Editor.range;

    folder.add(l, 'enabled').name('controls enabled');

    // How fast the body travels. The stride rate divides these by the clip
    // speeds below, so raising one speeds the legs up to match.
    R(folder, l, 'walkSpeed', 0.2, 4, 0.01, 'walk (m/s)');
    R(folder, l, 'runSpeed', 1, 12, 0.01, 'run (m/s)');
    R(folder, l, 'acceleration', 1, 60, 0.1, 'acceleration');
    R(folder, l, 'deceleration', 1, 60, 0.1, 'deceleration');
    R(folder, l, 'blendRate', 0.000001, 0.05, 0.000001, 'blend follow');
    // The cross-fade between the two idles — the plain stand and the rifle one.
    // Faster than the gait blend: it is answering a weapon appearing in the
    // hand and has to be done by the time the burn is (see `Weapons` below).
    R(folder, l, 'stanceRate', 0.0000001, 0.01, 0.0000001, 'stance follow');

    const gait = folder.addFolder('Gait');
    R(gait, l, 'idleThreshold', 0, 0.5, 0.001, 'idle below (m/s)');
    // The speeds the clips themselves cover at rate 1 — the divisor. Tune these
    // once against the animation; move `walkSpeed`/`runSpeed` for design.
    R(gait, l, 'clipWalkSpeed', 0.2, 4, 0.01, 'walk clip (m/s)');
    R(gait, l, 'clipRunSpeed', 1, 12, 0.01, 'run clip (m/s)');
    // Trim on top of that division, per gait — for the part of the mismatch the
    // clip speeds do not account for. Blended between the two by the same curve
    // the weights use, and bounded by the stride clamp below.
    R(gait, l, 'walkAnimSpeed', 0.25, 3, 0.01, 'walk anim ×');
    R(gait, l, 'runAnimSpeed', 0.25, 3, 0.01, 'run anim ×');
    R(gait, l, 'strideMin', 0.2, 1, 0.01, 'stride min');
    R(gait, l, 'strideMax', 1, 5, 0.01, 'stride max');

    // Space, from a run. `distance` renormalises the clip's own travel, so it is
    // the reach of the jump in metres — 0 hands it back to the animation.
    const jump = folder.addFolder('Long jump');
    const j = settings.jump;
    jump.add(j, 'enabled').name('long jump enabled');
    R(jump, j, 'distance', 0, 20, 0.1, 'distance (m)');
    R(jump, j, 'minRunFraction', 0, 1, 0.01, 'launch above run ×');
    R(jump, j, 'landAt', 0.4, 1, 0.01, 'control returns at');
    R(jump, j, 'blendIn', 0.01, 0.6, 0.01, 'blend in (s)');
    R(jump, j, 'blendOut', 0.01, 0.8, 0.01, 'blend out (s)');

    // Space at anything less. It covers no ground of its own, so what there is
    // to tune is how it sits over the gait: `gaitBleed` is how much of the walk
    // or run keeps playing under it, which is what keeps the legs carrying the
    // body instead of planting while the controller travels.
    const hop = folder.addFolder('Hop');
    const h = settings.hop;
    hop.add(h, 'enabled').name('hop enabled');
    R(hop, h, 'gaitBleed', 0, 1, 0.01, 'gait under hop');
    R(hop, h, 'landAt', 0.4, 1, 0.01, 'feet down at');
    R(hop, h, 'blendIn', 0.01, 0.6, 0.01, 'blend in (s)');
    R(hop, h, 'blendOut', 0.01, 0.8, 0.01, 'blend out (s)');
  }

  /**
   * The kick and the bodies it lands on.
   *
   * Two halves that meet in one place. The **kick** half is the animation
   * contract: `hitAt`, `recoverAt` and `approach` are normalised times in the
   * clip, and they are the three numbers to reach for after watching the move
   * once — the foot connects here, control comes back there, and the warp has
   * that long to put the body where the animator assumed it was standing.
   *
   * The **enemies** half is the sandbox around it. Everything is live except
   * the height and the ring, which are read when a body is spawned — hit
   * "Respawn all" after moving those.
   */
  /**
   * The swap between the katana and the rifle — see `equipment/WeaponSwitch.js`.
   *
   * All of it is the *look* of one exchange: how long it takes, how much its
   * two halves overlap, and what the mask that eats each weapon looks like
   * while it does. Nothing here decides which weapon is out — that is `1`, the
   * chip along the bottom, or the Weapon buttons on the character screen.
   */
  _buildWeapons() {
    const folder = this.gui.addFolder('무기');
    const w = settings.weapons;
    const R = Editor.range;

    R(folder, w, 'switchTime', 0.1, 2.5, 0.01, 'swap takes (s)');
    // 0 empties the hand between the two; past about half and both are simply
    // on screen together. A quarter reads as one becoming the other.
    R(folder, w, 'overlap', 0, 0.9, 0.01, 'halves overlap');
    // Where in that the body's grip changes — it belongs to the weapon
    // arriving, not to either end of the swap.
    R(folder, w, 'handover', 0, 1, 0.01, 'grip changes at');

    const mask = folder.addFolder('The mask');
    mask.addColor(w, 'edgeColor').name('edge colour');
    R(mask, w, 'edgeEmissive', 0, 24, 0.1, 'edge glow');
    R(mask, w, 'edgeWidth', 0.01, 0.6, 0.005, 'edge width');
    // Features per metre. Weapons are small, so this runs far higher than the
    // same control on a body.
    R(mask, w, 'detail', 2, 120, 0.5, 'noise detail');
    // 1 is a clean line travelling the length of the piece; 0 is static eating
    // it from everywhere at once.
    R(mask, w, 'rise', 0, 1, 0.01, 'burn along piece');
  }

  /**
   * The shooter, in the order the numbers are actually reached for.
   *
   * The lens first, because where the camera stands is the whole mode; then the
   * body, because a torso that will not come round far enough is the next thing
   * anyone notices; then the gun; then what it costs to be hit. The look — the
   * tracer, the flash, the sparks — is last, on the grounds that nobody tunes a
   * muzzle flash before they have decided how the gun handles.
   */
  _buildGunplay() {
    const folder = this.gui.addFolder('사격');
    const g = settings.gunplay;
    const R = Editor.range;

    folder.add(g, 'enabled').name('enabled');
    // The key and the middle mouse button both write this, so it listens.
    folder.add(g, 'shoulder', { Left: -1, Right: 1 }).name('shoulder').listen();

    const lens = folder.addFolder('The lens');
    const c = g.camera;
    // The number the whole mode stands on: with it at 0 the body is in front of
    // its own aim and there is nowhere honest to put a reticle.
    R(lens, c, 'offset', 0, 1.6, 0.01, 'off the axis (m)');
    R(lens, c, 'rise', -0.4, 0.4, 0.01, 'rise (m)');
    R(lens, c, 'distance', 0.8, 6, 0.05, 'distance (m)');
    R(lens, c, 'targetHeight', 0.6, 2.4, 0.01, 'looks at (m)');
    R(lens, c, 'fov', 25, 80, 0.5, 'field of view');
    R(lens, c, 'blend', 0.00001, 0.02, 0.00001, 'comes up over');

    const sights = lens.addFolder('Down the sights');
    R(sights, c, 'adsOffset', 0, 1.6, 0.01, 'off the axis (m)');
    R(sights, c, 'adsDistance', 0.6, 4, 0.05, 'distance (m)');
    R(sights, c, 'adsTargetHeight', 0.6, 2.4, 0.01, 'looks at (m)');
    R(sights, c, 'adsFov', 15, 70, 0.5, 'field of view');
    R(sights, c, 'adsSensitivity', 0.2, 1.5, 0.01, 'mouse multiplier');

    const body = folder.addFolder('The body');
    const a = g.aim;
    R(body, a, 'maxYaw', 10, 120, 1, 'torso twist (deg)');
    R(body, a, 'maxPitch', 10, 85, 1, 'torso pitch (deg)');
    // The one that decides whether a strafe reads as a person or as a body on
    // rails: how far the hips are allowed off the lens toward the travel.
    R(body, a, 'lean', 0, 90, 1, 'legs lean (deg)');
    R(body, a, 'rate', 0.000001, 0.005, 0.000001, 'twist follow');
    R(body, a, 'turnRate', 0.0000001, 0.001, 0.0000001, 'heading follow');
    R(body, a, 'enter', 0.00001, 0.05, 0.00001, 'aim comes up over');
    R(body, a, 'range', 20, 400, 5, 'reticle reaches (m)');

    const gun = folder.addFolder('The gun');
    const f = g.fire;
    R(gun, f, 'rate', 1, 20, 0.1, 'rounds / second');
    gun.add(f, 'auto').name('holds down');
    R(gun, f, 'speed', 30, 400, 5, 'round speed (m/s)');
    R(gun, f, 'drop', 0, 20, 0.1, 'round falls (m/s²)');
    R(gun, f, 'spread', 0, 6, 0.01, 'spread standing (deg)');
    R(gun, f, 'moveSpread', 0, 10, 0.01, 'spread moving (deg)');
    R(gun, f, 'adsSpread', 0, 3, 0.01, 'spread sighted (deg)');
    R(gun, f, 'bloom', 0, 2, 0.01, 'per round (deg)');
    R(gun, f, 'bloomMax', 0, 10, 0.1, 'piles up to (deg)');
    R(gun, f, 'bloomRecover', 0.5, 20, 0.1, 'bleeds off (deg/s)');
    R(gun, f, 'recoilPitch', 0, 3, 0.01, 'kick up (deg)');
    R(gun, f, 'recoilYaw', 0, 2, 0.01, 'kick sideways (deg)');
    R(gun, f, 'recoilRecover', 0.0000001, 0.001, 0.0000001, 'kick returns');
    R(gun, f, 'shake', 0, 0.3, 0.001, 'lens knock (m)');

    const hurt = folder.addFolder('What a round costs');
    const d = g.damage;
    // Three of these into a hundred is the whole design: change `body` and the
    // rifle changes from a three-round weapon to something else.
    R(hurt, d, 'health', 10, 400, 5, 'a body is worth');
    R(hurt, d, 'body', 1, 200, 1, 'body shot');
    R(hurt, d, 'head', 1, 400, 1, 'head shot');
    R(hurt, d, 'impulse', 0, 12, 0.1, 'shove (m/s)');
    R(hurt, d, 'lift', 0, 8, 0.1, 'lift (m/s)');
    R(hurt, d, 'spin', 0, 5, 0.05, 'fold');
    R(hurt, d, 'headImpulse', 0, 12, 0.1, 'head shove (m/s)');
    R(hurt, d, 'headLift', 0, 8, 0.1, 'head lift (m/s)');
    R(hurt, d, 'headSpin', 0, 6, 0.05, 'head fold');
    R(hurt, d, 'flinch', 0, 1, 0.01, 'flare lasts (s)');
    R(hurt, d, 'flinchRim', 0, 20, 0.1, 'flare brightness');
    R(hurt, d, 'hitShake', 0, 0.2, 0.001, 'knock on a hit (m)');
    R(hurt, d, 'killShake', 0, 0.4, 0.001, 'knock on a kill (m)');
    R(hurt, d, 'killHitStop', 0, 0.3, 0.005, 'kill freeze (s)');
    R(hurt, d, 'killHitStopScale', 0.01, 1, 0.01, 'freeze depth');
    R(hurt, d, 'bodyBlood', 0, 80, 1, 'droplets, body');
    R(hurt, d, 'headBlood', 0, 120, 1, 'droplets, head');
    R(hurt, d, 'bloodSpeed', 0.2, 12, 0.1, 'droplet speed (m/s)');

    // The bar over a head, which exists only because the rifle spends health a
    // piece at a time — see `vfx/HealthBars.js`.
    const bars = hurt.addFolder('The bar over a head');
    const b = g.healthBar;
    bars.add(b, 'enabled').name('bars shown');
    bars.add(b, 'onlyWounded').name('only once hit');
    bars.addColor(b, 'color').name('health left');
    bars.addColor(b, 'trackColor').name('ground behind');
    bars.addColor(b, 'frameColor').name('frame');
    R(bars, b, 'width', 0.1, 1.5, 0.01, 'width (m)');
    R(bars, b, 'height', 0.01, 0.3, 0.005, 'height (m)');
    R(bars, b, 'lift', 0, 1.2, 0.01, 'above the head (m)');
    // What keeps a bar readable once the body is a speck.
    R(bars, b, 'minWidth', 0, 120, 1, 'never under (px)');
    R(bars, b, 'range', 5, 200, 5, 'shown within (m)');
    R(bars, b, 'trackOpacity', 0, 1, 0.01, 'ground opacity');
    R(bars, b, 'frameOpacity', 0, 1, 0.01, 'frame opacity');
    R(bars, b, 'border', 0, 0.5, 0.01, 'frame thickness');
    R(bars, b, 'fadeIn', 0.02, 1, 0.01, 'comes up over (s)');
    R(bars, b, 'fadeOut', 0.02, 2, 0.01, 'fades over (s)');

    const boxes = folder.addFolder('Hitboxes');
    const h = g.hitbox;
    // The head is deliberately a shade larger than a head — see `Hitboxes.js`.
    R(boxes, h, 'headRadius', 0.05, 0.4, 0.005, 'head (m)');
    R(boxes, h, 'torsoRadius', 0.1, 0.6, 0.005, 'torso (m)');
    R(boxes, h, 'legRadius', 0.05, 0.5, 0.005, 'legs (m)');

    const look = folder.addFolder('The look');
    const t = g.tracer;
    look.addColor(t, 'color').name('tracer colour');
    R(look, t, 'brightness', 0.2, 20, 0.1, 'tracer glow');
    R(look, t, 'length', 0.2, 12, 0.1, 'tracer length (m)');
    R(look, t, 'width', 0.005, 0.2, 0.005, 'tracer width (m)');
    R(look, t, 'life', 0.2, 6, 0.1, 'round lives (s)');

    const flash = look.addFolder('Muzzle');
    const m = g.muzzle;
    flash.addColor(m, 'color').name('colour');
    R(flash, m, 'size', 0.05, 1.2, 0.01, 'size (m)');
    R(flash, m, 'life', 0.01, 0.3, 0.005, 'lasts (s)');
    R(flash, m, 'light', 0, 40, 0.5, 'light');
    R(flash, m, 'lightRange', 1, 30, 0.5, 'light reach (m)');
    // The three that fix a barrel this project guessed the end of.
    R(flash, m, 'forward', -0.6, 0.6, 0.005, 'along barrel (m)');
    R(flash, m, 'up', -0.3, 0.3, 0.005, 'above barrel (m)');
    R(flash, m, 'right', -0.3, 0.3, 0.005, 'beside barrel (m)');

    const sparks = look.addFolder('Impact');
    const i = g.impact;
    sparks.addColor(i, 'color').name('spark colour');
    R(sparks, i, 'brightness', 0.2, 10, 0.1, 'spark glow');
    R(sparks, i, 'sparks', 0, 60, 1, 'sparks per round');
    R(sparks, i, 'speed', 0.5, 20, 0.1, 'thrown at (m/s)');
    R(sparks, i, 'life', 0.05, 2, 0.01, 'last (s)');
    R(sparks, i, 'size', 0.01, 0.3, 0.005, 'size (m)');
    R(sparks, i, 'gravity', -40, 0, 0.5, 'fall (m/s²)');

    this._buildFocus(folder);
  }

  /**
   * The held shot, in the order it happens: what earns it, what it costs the
   * thing it hits, and only then what it looks like.
   *
   * The seven layers of the burst each get their own sub-folder rather than one
   * long list, because the way anyone actually tunes a stack this deep is by
   * switching six of them off — and a `*Enabled` box at the top of its own
   * folder is a solo button.
   */
  _buildFocus(parent) {
    const R = Editor.range;
    const f = settings.gunplay.focus;
    const folder = parent.addFolder('The held shot (hold right button)');

    folder.add(f, 'enabled').name('enabled');
    // The number the whole gesture is: three seconds of standing still in the
    // open. Under about one and it is not a decision, over about five and
    // nobody ever takes the shot.
    R(folder, f, 'charge', 0.2, 8, 0.1, 'held for (s)');
    // 0 is "the offer stands while the button is down", which is the default.
    R(folder, f, 'hold', 0, 6, 0.1, 'offer lapses after (s)');
    R(folder, f, 'speed', 50, 500, 5, 'round speed (m/s)');
    R(folder, f, 'drop', 0, 10, 0.1, 'round falls (m/s²)');
    R(folder, f, 'tracer', 1, 8, 0.1, 'tracer × ordinary');

    const cost = folder.addFolder('What it costs');
    R(cost, f, 'damage', 10, 500, 5, 'body shot');
    R(cost, f, 'headDamage', 10, 600, 5, 'head shot');
    // The one that decides whether this is an anti-body round or a way of
    // clearing a group.
    R(cost, f, 'blastRadius', 0, 12, 0.1, 'blast reaches (m)');
    R(cost, f, 'blastDamage', 0, 400, 5, 'blast at the centre');
    R(cost, f, 'impulse', 0, 20, 0.1, 'shove (m/s)');
    R(cost, f, 'lift', 0, 12, 0.1, 'lift (m/s)');
    R(cost, f, 'spin', 0, 8, 0.05, 'fold');

    const feel = folder.addFolder('What it feels like');
    R(feel, f, 'recoilPitch', 0, 8, 0.05, 'kick up (deg)');
    R(feel, f, 'recoilYaw', 0, 4, 0.05, 'kick sideways (deg)');
    R(feel, f, 'shake', 0, 0.5, 0.005, 'knock firing (m)');
    R(feel, f, 'blastShake', 0, 0.6, 0.005, 'knock landing (m)');
    R(feel, f, 'hitStop', 0, 0.4, 0.005, 'freeze (s)');
    R(feel, f, 'hitStopScale', 0.01, 1, 0.01, 'freeze depth');

    const b = f.burst;
    const burst = folder.addFolder('The burst');
    burst.add(b, 'enabled').name('burst enabled');
    // The two masters. `radius` sets the scale of every shaped layer at once;
    // `life` is what the shell's and the core's own fractions are measured on.
    R(burst, b, 'radius', 0.5, 8, 0.05, 'opens to (m)');
    R(burst, b, 'life', 0.2, 4, 0.05, 'lasts (s)');
    R(burst, b, 'intensity', 0.1, 4, 0.05, 'brightness');
    R(burst, b, 'light', 0, 300, 1, 'light');
    R(burst, b, 'lightRange', 2, 80, 0.5, 'light reach (m)');
    burst.addColor(b, 'lightColor').name('light colour');

    const shell = burst.addFolder('1. The arc mesh');
    shell.add(b, 'shellEnabled').name('shown');
    shell.addColor(b, 'shellColor').name('colour');
    shell.addColor(b, 'shellCoreColor').name('line colour');
    R(shell, b, 'meridians', 1, 16, 1, 'meridians');
    R(shell, b, 'parallels', 1, 12, 1, 'parallels');
    // A fraction of the gap between two lines, so it means the same thing at
    // any count.
    R(shell, b, 'arcWidth', 0.005, 0.4, 0.005, 'arc width');
    R(shell, b, 'shellRim', 0.5, 8, 0.1, 'rim falloff');
    R(shell, b, 'shellWarp', 0, 0.6, 0.005, 'boil (m)');
    R(shell, b, 'shellDetail', 0.5, 8, 0.1, 'boil detail');
    R(shell, b, 'shellLife', 0.05, 1, 0.01, 'share of the life');

    const core = burst.addFolder('2. The core');
    core.add(b, 'coreEnabled').name('shown');
    core.addColor(b, 'coreColor').name('colour');
    core.addColor(b, 'coreHalo').name('halo');
    R(core, b, 'coreSize', 0.2, 10, 0.05, 'size (m)');
    R(core, b, 'coreLife', 0.02, 1, 0.01, 'share of the life');
    R(core, b, 'coreSpikes', 0, 12, 1, 'spikes');
    R(core, b, 'coreSpikeLength', 0, 4, 0.05, 'spike reach');

    const decal = burst.addFolder('3. The cracks');
    decal.add(b, 'decalEnabled').name('shown');
    decal.addColor(b, 'decalColor').name('colour');
    decal.addColor(b, 'decalCoreColor').name('hot colour');
    R(decal, b, 'decalRadius', 0.2, 12, 0.1, 'radius (m)');
    // Above this much floor clearance the round leaves no mark at all.
    R(decal, b, 'decalReach', 0.2, 10, 0.1, 'fades over (m) up');
    R(decal, b, 'decalDetail', 0.5, 16, 0.1, 'web detail');
    R(decal, b, 'decalSpokes', 0, 24, 1, 'big cracks');
    R(decal, b, 'decalScorch', 0, 2, 0.05, 'burn');
    R(decal, b, 'decalWrite', 0.01, 1, 0.01, 'written over');

    const debris = burst.addFolder('4. The debris');
    debris.add(b, 'debrisEnabled').name('shown');
    debris.addColor(b, 'debrisColor').name('colour');
    R(debris, b, 'debris', 0, 48, 1, 'chunks');
    R(debris, b, 'debrisSize', 0.01, 0.6, 0.005, 'size (m)');
    R(debris, b, 'debrisSpeed', 0.5, 30, 0.1, 'thrown at (m/s)');
    R(debris, b, 'debrisSpread', 0, 2, 0.01, 'spread');
    R(debris, b, 'debrisGravity', -40, 0, 0.5, 'fall (m/s²)');
    R(debris, b, 'debrisLife', 0.1, 4, 0.05, 'last (s)');

    const shower = burst.addFolder('5. The sparks');
    shower.add(b, 'sparksEnabled').name('shown');
    shower.addColor(b, 'sparkColor').name('colour');
    R(shower, b, 'sparks', 0, 200, 1, 'sparks');
    R(shower, b, 'sparkSpeed', 0.5, 40, 0.5, 'thrown at (m/s)');
    R(shower, b, 'sparkSize', 0.005, 0.4, 0.005, 'size (m)');
    R(shower, b, 'sparkLife', 0.05, 3, 0.05, 'last (s)');
    R(shower, b, 'sparkStretch', 0, 0.3, 0.005, 'streak');
    R(shower, b, 'sparkDrag', 0.05, 8, 0.05, 'drag');
    R(shower, b, 'sparkGravity', -40, 0, 0.5, 'fall (m/s²)');

    const shards = burst.addFolder('6. The shards');
    shards.add(b, 'shardsEnabled').name('shown');
    shards.addColor(b, 'shardColor').name('colour');
    shards.addColor(b, 'shardColorAlt').name('second colour');
    R(shards, b, 'shards', 0, 160, 1, 'shards');
    R(shards, b, 'shardSpeed', 0.5, 40, 0.5, 'thrown at (m/s)');
    R(shards, b, 'shardSize', 0.01, 0.8, 0.005, 'length (m)');
    R(shards, b, 'shardLife', 0.05, 3, 0.05, 'last (s)');
    R(shards, b, 'shardDrag', 0.05, 8, 0.05, 'drag');
    R(shards, b, 'shardGravity', -40, 0, 0.5, 'fall (m/s²)');

    const haze = burst.addFolder('7. The haze');
    haze.add(b, 'hazeEnabled').name('shown');
    haze.addColor(b, 'hazeColor').name('colour');
    R(haze, b, 'haze', 0, 32, 1, 'puffs');
    R(haze, b, 'hazeOpacity', 0, 1, 0.01, 'opacity');
    R(haze, b, 'hazeSize', 0.1, 4, 0.05, 'size (m)');
    R(haze, b, 'hazeGrowth', 1, 8, 0.05, 'grows to ×');
    R(haze, b, 'hazeRise', 0, 6, 0.05, 'climbs at (m/s)');
    R(haze, b, 'hazeLife', 0.1, 5, 0.05, 'last (s)');
  }

  _buildCombat() {
    const folder = this.gui.addFolder('전투');
    const R = Editor.range;

    // The template's melee moves are gone (the attack list is empty — the
    // gun is the whole offence), so what is left here is what the live game
    // still reads.
    this._buildTargetRing(folder);
    this._buildSlice(folder);

    const e = settings.enemies;
    const enemies = folder.addFolder('Enemies');
    enemies.add(e, 'enabled').name('enemies enabled');
    R(enemies, e, 'count', 0, 20, 1, 'standing at once');
    R(enemies, e, 'radius', 2, 40, 0.5, 'spawn radius (m)');
    R(enemies, e, 'minRadius', 1, 20, 0.5, 'no closer than (m)');
    R(enemies, e, 'separation', 0.5, 6, 0.1, 'apart from each other (m)');
    R(enemies, e, 'height', 1, 3, 0.01, 'height (m)');
    R(enemies, e, 'corpseTime', 0, 30, 0.5, 'corpse stays (s)');
    R(enemies, e, 'dissolveTime', 0.1, 6, 0.1, 'burns away over (s)');
    R(enemies, e, 'respawnDelay', 0, 15, 0.1, 'respawn after (s)');
    enemies.add(e, 'watch').name('watch the player');
    R(enemies, e, 'watchRadius', 2, 40, 0.5, 'watch within (m)');
    R(enemies, e, 'turnRate', 0.000001, 0.2, 0.000001, 'turn follow');
    enemies.add(e, 'collide').name('block the player');
    R(enemies, e, 'bodyRadius', 0.1, 1.5, 0.01, 'body radius (m)');
    enemies
      .add({ respawn: () => this.hooks.onRespawnEnemies?.() }, 'respawn')
      .name('Respawn all');

    // Authored rather than imported — the export carries no textures at all.
    const look = enemies.addFolder('Look');
    const el = e.look;
    look.addColor(el, 'color').name('body colour');
    R(look, el, 'roughness', 0, 1, 0.01, 'roughness');
    R(look, el, 'metalness', 0, 1, 0.01, 'metalness');
    look.addColor(el, 'rimColor').name('rim colour');
    R(look, el, 'rimPower', 0.2, 8, 0.05, 'rim tightness');
    R(look, el, 'rimEmissive', 0, 8, 0.01, 'rim emissive');
    look.addColor(el, 'edgeColor').name('burn colour');
    R(look, el, 'edgeEmissive', 0, 20, 0.1, 'burn emissive');
    R(look, el, 'edgeWidth', 0.01, 0.5, 0.01, 'burn width');
    R(look, el, 'dissolveDetail', 1, 40, 0.5, 'burn detail');
    R(look, el, 'dissolveRise', 0, 1, 0.01, 'burn rises');

    // The ragdoll. `brace` is the one worth understanding: bone lengths alone
    // give a rope, and these extra constraints across the pelvis and chest are
    // what give the body a shape it is trying to keep as it falls.
    const doll = enemies.addFolder('Ragdoll');
    const r = e.ragdoll;
    R(doll, r, 'gravity', -60, -1, 0.5, 'gravity (m/s²)');
    R(doll, r, 'damping', 0, 0.9, 0.01, 'air drag /s');
    R(doll, r, 'iterations', 1, 20, 1, 'solver passes');
    R(doll, r, 'substeps', 1, 6, 1, 'substeps');
    R(doll, r, 'brace', 0, 1, 0.01, 'torso stiffness');
    R(doll, r, 'radius', 0.01, 0.4, 0.005, 'joint radius (m)');
    R(doll, r, 'friction', 0, 1, 0.01, 'ground friction');
    R(doll, r, 'bounce', 0, 0.8, 0.01, 'bounce');
    R(doll, r, 'sleep', 0, 0.5, 0.005, 'sleeps below');
  }

  /**
   * One melee move's three groups: who it goes to, when it lands, what it does.
   *
   * The numbers to reach for after watching a move once are the normalised
   * times — the blow connects *here*, control comes back *there*, and the warp
   * has that long to put the body where the animator assumed it was standing.
   * Everything else follows from those three.
   *
   * @param {import('lil-gui').GUI} parent
   * @param {object} config a `settings.kick`-shaped block
   * @param {string} title what the folder is called, hotkey included
   */

  /**
   * Everything the three-hit combo throws — see `vfx/SwordCombo.js`.
   *
   * The move's own numbers are in the `Sword combo (Z)` folder above, with
   * every other attack's, because it is the same machine as they are. This is
   * only the part of it that is *light*, and it is a folder of its own because
   * there is far more of it than of the move.
   *
   * If only one control here is ever touched, make it the crescent's `razor` —
   * it is where the hard white line sits along the leading edge, and it is the
   * whole difference between a cut and a glowing ribbon.
   */
  /**
   * Everything the unmaking calls up — see `vfx/RunicBeam.js`.
   *
   * The move's own numbers are in the `Unmaking (B)` folder above, with every
   * other attack's, because it is the same machine as they are. This is the
   * part of it that is *light*, plus the one block that is neither — `unmake`,
   * which is how a body taken by the beam goes away.
   *
   * Five layers, a sub-folder each, in the order they are drawn, and every one
   * with an `enabled` at the top of its folder so it can be soloed against the
   * other four.
   *
   * If only one control here is ever touched, make it the beam's `axis gather`:
   * it is the exponent on how square a piece of the wall is to the lens, and it
   * is the whole difference between a column of light and a glowing pipe.
   */
  /**
   * Everything the crimson rite calls up — see `vfx/CrimsonRite.js`.
   *
   * The move's own numbers are in the `Crimson rite (V)` folder above, with
   * every other attack's, because it is the same machine as they are. This is
   * the part of it that is *light* — and there is a great deal more of it than
   * of the move, which is why it is a folder of its own.
   *
   * The folders are numbered in the order the layers are drawn, which is also
   * the order the reference breaks the effect into. Every one of them has an
   * `enabled` at the top so it can be soloed against the other five, and that
   * is by far the fastest way to understand what any single number is doing.
   *
   * If only one control here is ever touched, make it the strokes' `tear`: it
   * is how hard a stroke comes apart as it dies, and it is the whole difference
   * between a cut and a glowing ribbon fading out.
   */
  /**
   * The shadow execution's own layers — see `vfx/ShadowExecution.js`.
   *
   * The move itself is tuned in the plain attack folder above, exactly as the
   * rite's is. This is the part that is *light*, and there is a great deal more
   * of it than there is of the move.
   *
   * The folders are numbered in the order the layers are drawn, which is also
   * the order the reference breaks the effect into. Nearly every one has an
   * `enabled` at the top so it can be soloed against the other eight, which is
   * by far the fastest way to understand what any single number is doing.
   *
   * If only one control here is ever touched, make it **the ring's `winds up
   * to`**. The whole first half of this ability is five katanas accelerating
   * round a body, and that number is the acceleration: at 1 they drift and the
   * move is a summons followed by a stab, and past about 7 they are a blur with
   * nothing left to count.
   */
  /**
   * The circle under a body in reach — see `vfx/TargetRings.js`.
   *
   * There is nothing here about *who* wears one: that is the two moves' own
   * lock range and cone above, and this only draws the answer. `falloff` is the
   * one to reach for — it is the exponent on the radius, so low is a glow that
   * fills the circle and high is a hard rim with nothing inside it.
   */
  _buildTargetRing(parent) {
    const folder = parent.addFolder('Target ring');
    const R = Editor.range;
    const t = settings.targetRing;

    folder.add(t, 'enabled').name('enabled');
    folder.addColor(t, 'color').name('colour');
    R(folder, t, 'radius', 0.2, 3, 0.01, 'radius (m)');
    R(folder, t, 'falloff', 0.2, 12, 0.1, 'edge falloff');
    R(folder, t, 'softness', 0.01, 0.6, 0.01, 'outer feather');
    R(folder, t, 'intensity', 0, 6, 0.05, 'brightness');
    R(folder, t, 'pulse', 0, 1, 0.01, 'breath depth');
    R(folder, t, 'pulseSpeed', 0, 12, 0.1, 'breath speed');
    R(folder, t, 'lift', 0, 0.2, 0.005, 'off the floor (m)');
    R(folder, t, 'fadeIn', 0.01, 1, 0.01, 'fade in (s)');
    R(folder, t, 'fadeOut', 0.01, 1, 0.01, 'fade out (s)');
  }

  /**
   * The cut, the meat and the blood — see `combat/Enemy.js`.
   *
   * Everything here is live *except* the plane itself: `height` and `tilt` are
   * read once, at the moment of the blow, because a plane that moved afterwards
   * would slide up a corpse already lying in two pieces. Cut something new to
   * see those two move. Colours, the meat and the blood are all per-frame.
   *
   * The two multiplier groups are the ones worth playing with: `upper` is what
   * the top half takes of the move's own impulse, lift and spin, and `lower` is
   * what is left for a pair of legs. Give the lower half much of anything and
   * the body stops reading as cut and starts reading as two bodies that were
   * standing very close together.
   */
  _buildSlice(parent) {
    const folder = parent.addFolder('Slice & blood');
    const R = Editor.range;
    const s = settings.slice;

    folder.add(s, 'enabled').name('slicing enabled');

    const plane = folder.addFolder('The cut (read at the blow)');
    R(plane, s, 'height', 0.1, 0.9, 0.01, 'cuts at (× height)');
    R(plane, s, 'tilt', 0, 60, 1, 'tilt off level (°)');
    R(plane, s, 'separation', 0, 0.6, 0.01, 'halves part by (m)');
    R(plane, s, 'split', 0, 8, 0.05, 'driven apart at (m/s)');

    const halves = folder.addFolder('What each half takes');
    R(halves, s.upper, 'impulse', 0, 3, 0.05, 'top: force ×');
    R(halves, s.upper, 'lift', 0, 3, 0.05, 'top: lift ×');
    R(halves, s.upper, 'spin', 0, 3, 0.05, 'top: spin ×');
    R(halves, s.lower, 'impulse', 0, 2, 0.01, 'legs: force ×');
    R(halves, s.lower, 'lift', 0, 2, 0.01, 'legs: lift ×');
    R(halves, s.lower, 'spin', 0, 2, 0.01, 'legs: spin ×');

    // Turn this off and the torso falls through the legs, which is the clearest
    // way to see what it is doing.
    const hit = folder.addFolder('Halves against each other');
    const c = s.collide;
    hit.add(c, 'enabled').name('halves collide');
    R(hit, c, 'radius', 0, 0.3, 0.005, 'joint size (m)');
    R(hit, c, 'bounce', 0, 1, 0.01, 'bounce');
    R(hit, c, 'friction', 0, 1, 0.01, 'grip');
    R(hit, c, 'maxPush', 0.005, 0.3, 0.005, 'push cap /frame (m)');

    // The hollow the cut opens is the material's own back faces, painted as
    // meat — there is no cap geometry anywhere in this.
    const meat = folder.addFolder('The wound');
    meat.addColor(s, 'interiorColor').name('inside colour');
    R(meat, s, 'interiorEmissive', 0, 3, 0.01, 'inside glow');
    meat.addColor(s, 'edgeColor').name('cut line colour');
    R(meat, s, 'edgeEmissive', 0, 20, 0.1, 'cut line glow');
    R(meat, s, 'edgeWidth', 0.001, 0.08, 0.001, 'cut line width');

    const blood = folder.addFolder('Blood');
    const b = s.blood;
    blood.add(b, 'enabled').name('blood enabled');
    blood.addColor(b, 'color').name('blood colour');
    R(blood, b, 'brightness', 0, 4, 0.05, 'brightness');
    R(blood, b, 'burst', 0, 600, 5, 'droplets on the cut');
    R(blood, b, 'speed', 0, 15, 0.1, 'thrown at (m/s)');
    R(blood, b, 'spread', 0, 2, 0.01, 'spray spread');
    R(blood, b, 'drip', 0, 300, 1, 'stump drip (/s)');
    R(blood, b, 'dripSpeed', 0, 6, 0.05, 'drip speed (m/s)');
    R(blood, b, 'bleedTime', 0, 8, 0.1, 'bleeds for (s)');
    R(blood, b, 'size', 0.002, 0.15, 0.002, 'droplet size (m)');
    R(blood, b, 'sizeVariance', 0, 1, 0.01, 'size variance');
    R(blood, b, 'life', 0.1, 5, 0.05, 'droplet life (s)');
    R(blood, b, 'lifeVariance', 0, 0.95, 0.01, 'life variance');
    R(blood, b, 'gravity', -60, 0, 0.5, 'gravity (m/s²)');
    R(blood, b, 'drag', 0.02, 4, 0.01, 'air drag /s');
    R(blood, b, 'stretch', 0, 0.4, 0.005, 'motion streak');
    R(blood, b, 'maxStretch', 1, 20, 0.5, 'streak ceiling');
    R(blood, b, 'fade', 0.02, 1, 0.01, 'fades over (× life)');
  }

  /**
   * The character screen's set.
   *
   * Same contract as everything above — `StudioStage` re-resolves the whole rig
   * from these fields every frame, so a slider moved with the screen open
   * re-lights it on the next one. The screen has to be up (`Tab`) to see any of
   * it; the play stage next door reads none of these.
   */
  _buildStudio() {
    const folder = this.gui.addFolder('캐릭터 화면');
    const s = settings.studio;
    const R = Editor.range;

    R(folder, s, 'turntable', -0.3, 0.3, 0.005, 'turntable (rev/s)').listen();

    const camera = folder.addFolder('Camera');
    R(camera, s.camera, 'fov', 15, 80, 0.5, 'field of view');
    R(camera, s.camera, 'targetHeight', 0, 2.2, 0.01, 'look at (m)');
    R(camera, s.camera, 'minDistance', 0.2, 3, 0.05, 'min distance');
    R(camera, s.camera, 'maxDistance', 1, 20, 0.1, 'max distance');
    R(camera, s.camera, 'autoOrbit', -0.2, 0.2, 0.005, 'camera drift (rev/s)');

    // Key and fill are each a spot plus a softbox at the same angle; moving the
    // angle moves both, which is what keeps them reading as one source.
    const key = folder.addFolder('Key');
    const l = s.lights;
    R(key, l, 'keyIntensity', 0, 400, 1, 'spot (cd)');
    key.addColor(l, 'keyColor').name('colour');
    R(key, l, 'keyAzimuth', 0, Math.PI * 2, 0.01, 'azimuth');
    R(key, l, 'keyElevation', 0.05, 1.5, 0.01, 'elevation');
    R(key, l, 'keyDistance', 1, 10, 0.05, 'distance (m)');
    R(key, l, 'keyAngle', 0.1, 1.4, 0.01, 'cone');
    R(key, l, 'keyPenumbra', 0, 1, 0.01, 'penumbra');
    R(key, l, 'keySoftbox', 0, 20, 0.1, 'softbox (nits)');
    R(key, l, 'keySoftboxSize', 0.2, 8, 0.1, 'softbox size (m)');

    const fill = folder.addFolder('Fill');
    R(fill, l, 'fillIntensity', 0, 12, 0.05, 'intensity (nits)');
    fill.addColor(l, 'fillColor').name('colour');
    R(fill, l, 'fillAzimuth', 0, Math.PI * 2, 0.01, 'azimuth');
    R(fill, l, 'fillElevation', 0.05, 1.5, 0.01, 'elevation');
    R(fill, l, 'fillDistance', 1, 10, 0.05, 'distance (m)');
    R(fill, l, 'fillSize', 0.2, 8, 0.1, 'panel size (m)');

    const edges = folder.addFolder('Rim, kicker & hair');
    R(edges, l, 'rimIntensity', 0, 600, 1, 'rim (cd)');
    edges.addColor(l, 'rimColor').name('rim colour');
    R(edges, l, 'rimAzimuth', 0, Math.PI * 2, 0.01, 'rim azimuth');
    R(edges, l, 'rimElevation', 0.05, 1.5, 0.01, 'rim elevation');
    R(edges, l, 'rimDistance', 1, 10, 0.05, 'rim distance (m)');
    R(edges, l, 'kickerIntensity', 0, 400, 1, 'kicker (cd)');
    edges.addColor(l, 'kickerColor').name('kicker colour');
    R(edges, l, 'kickerAzimuth', 0, Math.PI * 2, 0.01, 'kicker azimuth');
    R(edges, l, 'kickerElevation', 0.05, 1.5, 0.01, 'kicker elevation');
    R(edges, l, 'kickerDistance', 1, 10, 0.05, 'kicker distance (m)');
    R(edges, l, 'topIntensity', 0, 300, 1, 'hair light (cd)');
    edges.addColor(l, 'topColor').name('hair colour');

    const ambient = folder.addFolder('Ambient & shadow');
    R(ambient, l, 'ambientIntensity', 0, 1, 0.005, 'ambient');
    ambient.addColor(l, 'ambientColor').name('ambient colour');
    R(ambient, l, 'envIntensity', 0, 3, 0.01, 'env (IBL)');
    R(ambient, l, 'shadowRadius', 0, 12, 0.1, 'shadow softness');
    R(ambient, l, 'shadowBias', -0.01, 0.001, 0.0001, 'shadow bias');
    R(ambient, l, 'shadowNormalBias', 0, 0.1, 0.001, 'normal bias');

    const stage = folder.addFolder('Set');
    const st = s.stage;
    stage.addColor(st, 'backdropTop').name('backdrop top');
    stage.addColor(st, 'backdropBottom').name('backdrop bottom');
    stage.addColor(st, 'backdropGlow').name('halo colour');
    R(stage, st, 'glowStrength', 0, 3, 0.01, 'halo strength');
    R(stage, st, 'glowSpread', 0, 1, 0.01, 'halo spread');
    stage.addColor(st, 'floorColor').name('floor colour');
    R(stage, st, 'floorRoughness', 0.02, 1, 0.01, 'floor roughness');
    R(stage, st, 'floorMetalness', 0, 1, 0.01, 'floor metalness');
    R(stage, st, 'floorRadius', 1, 8, 0.05, 'plinth radius (m)');
    stage.addColor(st, 'ringColor').name('ring colour');
    R(stage, st, 'ringIntensity', 0, 6, 0.01, 'ring intensity');
    R(stage, st, 'contactShadow', 0, 2, 0.01, 'contact shadow');
    R(stage, st, 'dust', 0, 3, 0.01, 'studio haze');

    const post = folder.addFolder('Grade');
    const p = s.post;
    post.add(p, 'enabled').name('enabled');
    R(post, p, 'exposure', 0.1, 3, 0.01, 'exposure');
    R(post, p, 'bloomStrength', 0, 3, 0.01, 'bloom intensity');
    R(post, p, 'bloomRadius', 0, 1.5, 0.01, 'bloom radius');
    R(post, p, 'bloomThreshold', 0, 2, 0.01, 'bloom threshold');
    R(post, p, 'contrast', 0.5, 2, 0.01, 'contrast');
    R(post, p, 'saturation', 0, 2.5, 0.01, 'saturation');
    R(post, p, 'temperature', -0.5, 0.5, 0.01, 'temperature');
    R(post, p, 'vignette', 0, 1.5, 0.01, 'vignette');
    R(post, p, 'chromaticAberration', 0, 3, 0.01, 'chromatic aberration');
    R(post, p, 'grain', 0, 0.2, 0.001, 'film grain');
  }

  dispose() {
    this.gui.destroy();
  }
}
