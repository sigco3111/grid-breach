import { BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial, Vector3 } from 'three';

import { Renderer } from './Renderer.js';
import { Time } from './Time.js';
import { CameraRig } from './CameraRig.js';
import { PointerLook } from './PointerLook.js';
import { Input } from './Input.js';
import { frame } from './FrameUniforms.js';

import { Environment } from '../world/Environment.js';
import { Atmosphere } from '../world/Atmosphere.js';
import { Sky } from '../world/Sky.js';
import { Moon } from '../world/Moon.js';
import { Ground } from '../world/Ground.js';
import { Terrain } from '../world/Terrain.js';
import { GroundFog } from '../world/GroundFog.js';
import { Leaves } from '../world/Leaves.js';
import { LogisticsYard } from '../world/LogisticsYard.js';
import { YardTurrets } from '../world/YardTurrets.js';
import { Progression } from '../meta/Progression.js';
import { Missions } from '../meta/Missions.js';
import { ProgressionHUD } from '../ui/ProgressionHUD.js';
import { MissionHUD } from '../ui/MissionHUD.js';
import { ContactShadows } from '../world/ContactShadows.js';

import { AssetLoader } from '../loaders/AssetLoader.js';
import { CharacterController } from '../animation/CharacterController.js';
import { ThirdPersonController } from '../animation/ThirdPersonController.js';
import { EnemyManager } from '../combat/EnemyManager.js';
import { nearestBody, debugJoints } from '../combat/Hitboxes.js';
import { Gunplay } from '../combat/Gunplay.js';

import { PostProcessing } from '../postprocessing/PostProcessing.js';
import { BloodBurst } from '../vfx/BloodBurst.js';
import { TargetRings } from '../vfx/TargetRings.js';
import { HealthBars } from '../vfx/HealthBars.js';
import { CharacterScreen } from '../screens/CharacterScreen.js';
import { findItem } from '../equipment/EquipmentCatalog.js';
import { LoadingScreen } from '../ui/LoadingScreen.js';
import { TouchControls } from '../ui/TouchControls.js';
import { Editor } from '../ui/Editor.js';
import { Toast } from '../ui/Toast.js';
import { Stats } from '../ui/Stats.js';
import { ActionHUD } from '../ui/ActionHUD.js';

import { settings } from '../config/settings.js';

const HDR_URL = './hdri/spruit_sunrise.hdr';

/** Where a thrown cut leaves the body, resolved per beat and never held. */
const _blade = new Vector3();
const _toPlayer = new Vector3();
const _closest = new Vector3();
const _far = new Vector3();

/**
 * Application root: owns every subsystem and the frame loop.
 *
 * The wiring is deliberately one-directional — App builds the systems and then
 * does nothing but order the per-frame updates. No subsystem reaches back into
 * App.
 *
 * What is on screen is a lit stage with a character standing on it: the key,
 * the rim, the air and the grade come from `config/settings.js`, and the body
 * loops its idle. Equipment goes on through the character screen (`Tab`), which is a second
 * scene the same body is moved into — see `screens/CharacterScreen.js`.
 *
 * There are therefore two modes, and exactly one thing switches between them:
 * `characterScreen.active` decides which scene the post pipeline draws, which
 * camera it draws it through, which grade block is in force, and which of the
 * two update paths runs. Neither mode knows about the other.
 */
export class App {
  constructor(canvas) {
    this.canvas = canvas;
    this.time = new Time();
    this.elapsed = 0;
    this.paused = false;
    this._raf = 0;

    /* ---- core ---- */
    this.renderer = new Renderer(canvas);
    this.rig = new CameraRig(canvas);
    this.camera = this.rig.camera;

    // The mouse, for the whole stage: a click takes it and it turns the view,
    // `Esc` gives it back for a menu (`core/PointerLook.js`). Built here rather
    // than inside the shooter because it is not the shooter's — the sword, the
    // summons and an empty hand all look around with it too. The gun's only
    // share is the sights, which slow the turn while they are up.
    this.pointerLook = new PointerLook({
      domElement: canvas,
      rig: this.rig,
      // The one place a cursor is wanted: the studio is a room you point at
      // things in. Every other panel — the editor, the chips along the bottom —
      // is reached by pressing `Esc` first, which is what makes one key the
      // answer everywhere.
      blocked: () => this.inCharacterScreen,
      sensitivity: () =>
        this.gunplay?.sighting ? settings.gunplay.camera.adsSensitivity : 1
    });

    this.environment = new Environment(this.renderer, this.camera);
    this.scene = this.environment.scene;

    /* ---- world ---- */
    // The air comes first because almost everything else is shaded through it:
    // the ground and the sky both bind the same uniform block, which is what
    // keeps the horizon and the haze one colour instead of two.
    this.atmosphere = new Atmosphere();
    this.sky = new Sky(this.atmosphere);
    // The body in that sky. It hangs itself at the angles the sky resolves, so
    // it is only ever as right as the sky is — and it takes the sky's own disc
    // off the moment its maps are in (see `world/Moon.js`).
    this.moon = new Moon();
    // Then the terrain, because it is the surface everything else is placed on:
    // the floor mesh is displaced by it, and the character, camera and shadow
    // focus all read it on the CPU.
    this.terrain = new Terrain();
    this.yard = new LogisticsYard(this.terrain);
    this.turrets = new YardTurrets(this.terrain, this.yard);
    this.ground = new Ground(this.environment, {
      terrain: this.terrain,
      atmosphere: this.atmosphere
    });
    // After the ground, because it reads the floor's own baked height field —
    // that shared texture is what lets a puff blowing across a hollow go down
    // into the hollow for the price of one fetch.
    this.scene.add(this.yard.group);
    this.scene.add(this.turrets.group);

    this.groundFog = new GroundFog({
      terrain: this.terrain,
      cache: this.ground.cache,
      atmosphere: this.atmosphere
    });
    // What is actually lying on that floor. Both populations read the same
    // baked height field the floor is displaced by, so the litter lies flat on
    // the slope the ground is drawing rather than on a guess at it — and the
    // meshes themselves are not built until the sheet is in (`load`), so a
    // failed download costs a warning and nothing else.
    this.leaves = new Leaves({
      terrain: this.terrain,
      cache: this.ground.cache,
      environment: this.environment,
      atmosphere: this.atmosphere
    });
    this.contactShadows = new ContactShadows(this.renderer, {
      size: 2.6,
      height: 2.4,
      blur: 2.0,
      terrain: this.terrain
    });

    this.scene.add(
      this.sky.mesh,
      this.moon.mesh,
      this.ground.mesh,
      this.groundFog.mesh,
      this.leaves.group,
      this.contactShadows.group
    );

    /* ---- character ---- */
    this.character = new CharacterController(this.environment);
    this.scene.add(this.character.root);

    this.input = new Input();
    this.controller = new ThirdPersonController(this.character, this.input, this.rig);

    /* ---- combat ---- */
    // What a body cut in half throws off. A pool with nothing in it until
    // something is cut, and it runs on the *simulation's* clock, so a burst is
    // held by the hit-stop of the blow that caused it.
    this.blood = new BloodBurst();
    this.scene.add(this.blood.mesh);

    // The bodies to kick. The rig they clone is loaded in `load()`; until then
    // this is an empty field, and everything that reads it copes with that.
    // A body decides nothing about how a cut *looks* — it only says where and
    // how hard it bleeds, and this draws it.
    this.enemies = new EnemyManager({
      terrain: this.terrain,
      effects: {
        onBlood: (point, direction, count, speed) =>
          this.blood.emit(point, direction, count, speed)
      }
    });
    this.enemies.onPlayerStrike = (amount) => this._damagePlayer(amount);
    this.scene.add(this.enemies.group);
    this.controller.setEnemies(this.enemies);
    this.controller.setYard(this.yard);

    // Who a press would actually go to, drawn on the ground. It is told what to
    // mark and works nothing out itself — the answer comes from the same call
    // the attacks lock their targets with (`_updateTargetRings`).
    this.targetRings = new TargetRings({ terrain: this.terrain });
    this.scene.add(this.targetRings.mesh);

    /**
     * Who each enabled attack has locked this frame: body → the config keys of
     * the moves that would take it. Rebuilt in place every frame, and the ring
     * and the key caps are both drawn straight off it.
     * @type {Map<object, string[]>}
     */
    this._locked = new Map();
    /** Which of those keys would fire right now, rather than merely aim. */
    this._readyMoves = new Set();
    /** Key lists handed back by dead entries, so a frame allocates nothing. */
    this._keyLists = [];

    /**
     * Seconds of hit-stop left to run.
     *
     * The oldest impact trick there is: on contact the whole simulation drops
     * to a crawl for a few dozen milliseconds, so the frame the foot lands is
     * held long enough to be *seen*. It is deliberately a scale on `dt` rather
     * than a pause — the animation, the ragdoll and the mist all slow together,
     * which is what makes it read as weight rather than as a dropped frame.
     *
     * The scale is taken from whichever move landed rather than read per frame:
     * a slash stops the world harder and for longer than a kick, and the
     * blow it belongs to is over by the time the freeze runs out.
     */
    this._hitStop = 0;
    this._hitStopScale = 1;


    // The shooter. Dormant until the rifle is the weapon in the hand, and from
    // that moment it owns four things nothing else does: where the lens sits,
    // where the reticle's ray lands, which way the torso points and what the
    // trigger costs (`combat/Gunplay.js`). It *asks* for the loadout rather than
    // holding one — neither the weapons nor the gear exist until `load()`
    // builds the character screen.
    this.gunplay = new Gunplay({
      camera: this.camera,
      rig: this.rig,
      character: this.character,
      controller: this.controller,
      enemies: this.enemies,
      terrain: this.terrain,
      cover: this.yard,
      weapons: () => this.characterScreen?.weapons ?? null,
      equipment: () => this.characterScreen?.equipment ?? null,
      look: this.pointerLook,
      // The one thing that wants the body and the ground back. The gun does not
      // argue with it: it simply stands down and lets the lens come back off the
      // shoulder. The pointer is not in that list — it belongs to the stage.
      blocked: () => this.inCharacterScreen,
      onBlood: (point, direction, count, speed) =>
        this.blood.emit(point, direction, count, speed),
      // A gun kill freezes the world too, and for the same reason a kick does —
      // but the freeze itself belongs to the frame loop, which is here.
      onHitStop: (seconds, scale) => {
        this._hitStop = Math.max(this._hitStop, seconds);
        this._hitStopScale = scale;
      }
    });

    // Touch controls: a stick, an aim drag and two buttons, all of which land
    // on the same inputs the keyboard and mouse already drive. Only where
    // there is a touchscreen — on a desktop none of it exists.
    this.touchControls =
      'ontouchstart' in window || navigator.maxTouchPoints > 0
        ? new TouchControls({
            input: this.input, rig: this.rig, gunplay: this.gunplay,
            onMenu: () => this.toggleCharacterScreen(),
          })
        : null;
    this.scene.add(this.gunplay.group);

    // What the rifle leaves on screen that no melee blow ever could: a body
    // shot twice is a body with a question over it, and this is the answer. It
    // is built after the gun because it is the gun's — it comes up when the
    // rifle is drawn and fades when it is put away (`vfx/HealthBars.js`).
    this.healthBars = new HealthBars();
    this.scene.add(this.healthBars.mesh);


    /* ---- post ---- */
    this.post = new PostProcessing(this.renderer, this.scene, this.camera);

    /* ---- UI ---- */
    this.loading = new LoadingScreen();
    this.toast = new Toast();
    this.stats = new Stats();
    // The moves and their keys, along the bottom — one panel per category. Fed a
    // state per ability every frame from `_syncAbilities`; it decides nothing.
    // The one chip that is also a control routes its click back here, so the
    // weapon swap is a button and a key saying the same thing.
    this.actionHUD = new ActionHUD({ onPress: (id) => this._onAction(id) });
    this.editor = new Editor({
      onToast: (message) => this.toast.show(message),
      onRespawnEnemies: () => {
        this.enemies.respawnAll();
        this.toast.show('A fresh ring of them');
      }
    });

    /**
     * The equipment studio. Built in `load()`, because it needs the rig's
     * skeleton and material palette — neither exists until the character is in.
     * @type {CharacterScreen|null}
     */
    this.characterScreen = null;

    this._bindEvents();
  }

  /** Whether the equipment studio is the thing on screen. */
  get inCharacterScreen() {
    return this.characterScreen?.active === true;
  }

  /* ------------------------------------------------------------------ */

  _bindEvents() {
    this.renderer.onResize((width, height, pixelRatio) => {
      this.rig.resize(width, height);
      this.post.setSize(width, height, pixelRatio);
      this.characterScreen?.resize(width, height, pixelRatio);
    });

    this._onKeyDown = (event) => {
      // Ignore keys typed into a panel's own fields — the equipment inspector
      // is full of number boxes, and most of these keys are characters in them.
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (event.code) {
        case 'KeyP':
          this.paused = !this.paused;
          this.toast.show(this.paused ? 'Paused — the editor still applies' : 'Resumed');
          break;
        case 'KeyG':
          // A panel full of sliders opened under a captured pointer is a panel
          // nothing can reach, so opening it hands the cursor back — the same
          // thing `Esc` does, done for the player at the moment they have
          // clearly asked for it. Closing it takes nothing: the next click on
          // the canvas is what says they are done.
          if (this.editor.toggle()) this.pointerLook.release();
          break;
        case 'KeyF':
          this.stats.toggle();
          break;
        case 'Tab':
          // The browser would move focus into the editor's fields otherwise,
          // and the next press would be typed into a number box instead.
          event.preventDefault();
          this.toggleCharacterScreen();
          break;
        case 'Digit1': {
          // A toggle, so a held key would swap the weapon every frame.
          if (event.repeat) break;
          this._switchWeapon();
          break;
        }
        case 'KeyH': {
          // The same toggle discipline, and the same reason.
          if (event.repeat) break;
          this._swapShoulder();
          break;
        }
        case 'Escape':
          // The pointer first, whatever else this press means. The browser
          // gives it back on `Esc` on its own — and swallows the `keydown`
          // while doing so, which is why this is here for the case where it
          // does not rather than as the way it usually happens.
          this.pointerLook.release();
          if (this.inCharacterScreen) this.characterScreen.exit();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
  }

  /* ------------------------------------------------------------------ */

  /**
   * A chip along the bottom was clicked.
   *
   * The clickable ones are the plain switches (`press` in `config/abilities.js`),
   * and a click means exactly what the key means — so this routes to the same
   * place the key handler does rather than growing a second path that can
   * disagree with it.
   *
   * @param {string} id ability id
   */
  _onAction(id) {
    if (id === 'weapon') this._switchWeapon();
    else if (id === 'shoulder') this._swapShoulder();
    else if (id === 'customize') this.toggleCharacterScreen();
  }

  /**
   * Refuse a boon that is being thrown out of the air, and say so.
   *
   * Both boons come out of the ground the body is standing on — a shaft of
   * light onto it, a column of dark up through it — so neither has anywhere to
   * land while the feet are off it. The check lives here rather than in the
   * two casts because it is the same question asked twice, and a silent
   * refusal mid-jump reads as a dropped key.
   *
   * @returns {boolean} true when the press should be spent on a line of text
   */
  _groundedOnly() {
    const jump = this.character.jump;
    const hop = this.character.hop;
    if (!jump?.locked && !hop?.locked) return false;
    this.toast.show('Not in the air — a boon needs the ground under you');
    return true;
  }

  /**
   * Cross the lens to the other shoulder.
   *
   * Answered even with the sword out — the setting is real either way and the
   * rig will be standing on that side the moment the gun comes up — but the
   * line of text says which case it is, because a camera move nobody can see
   * happening reads as a dropped key.
   */
  _swapShoulder() {
    const side = this.gunplay.swapShoulder();
    this.toast.show(
      this.gunplay.drawn
        ? `Over the ${side} shoulder`
        : `Over the ${side} shoulder — draw the rifle to see it`
    );
  }

  /**
   * Draw the other weapon.
   *
   * Works on both stages: the exchange is a property of the body, and the body
   * is on screen in either of them. Nothing else moves — the loadout is
   * untouched, both weapons stay mounted, and only which one is *visible*
   * changes (see `equipment/WeaponSwitch.js`).
   */
  _switchWeapon() {
    const weapons = this.characterScreen?.weapons;
    if (!weapons || weapons.switching) return;
    const previous = weapons.current;
    if (!weapons.toggle() || weapons.current === previous) return;
    this.toast.show(`${findItem(weapons.current)?.name ?? weapons.current} in hand`);
  }

  /**
   * Swap between the play stage and the equipment studio.
   *
   * Everything mode-dependent is resolved from `inCharacterScreen` in `frame()`,
   * so this only has to move the character, park the world's controls and say
   * which view the post stack draws.
   */
  toggleCharacterScreen() {
    const screen = this.characterScreen;
    if (!screen) return;

    // Leaving goes through the screen's own exit path, so the panel's close
    // button and this key land in exactly the same place (`_onScreenExit`).
    if (screen.active) {
      screen.exit();
      return;
    }

    screen.enter();
    this.touchControls?.setMenuOpen(true);
    // The studio owns the whole screen; the play HUD does not ride on top.
    this.progressionHUD.element.style.display = 'none';
    this.missionHUD.element.style.display = 'none';
    // And the rifle's own layers, which are the one thing on the body that is
    // not driven from the frame loop's play branch: the studio has its own
    // update path, so a torso left twisted toward a reticle in another scene
    // would be the pose every placement was then judged against.
    this.character.rifle?.cancel();
    // Nothing to be in reach of on the set, and the rings are not simulated
    // while it is up — so they come off now rather than being left mid-fade.
    this.targetRings.clear();
    this.healthBars.clear();
    // And the pointer, which the stage captures. The studio is a place you
    // point at things with a cursor, and the frame loop returns before
    // `PointerLook#update` would have handed it back on its own.
    this.pointerLook.release();
    this.gunplay.standDown();
    this.rig.park(true);
    this.post.setView(screen.stage.scene, screen.camera.camera);
    this.toast.show('캐릭터 화면 — 드래그로 회전 · 우클릭 드래그로 이동 · 휠로 확대');
  }


  _syncBoon() {
    // The boons are gone; the permanent speed ranks own the scale now.
    this.controller.speedScale = this.progression?.speedMultiplier ?? 1;
  }

  /**
   * Light a ring under whoever a press would land on.
   *
   * The question is asked one move at a time, and it is the move's *own*
   * question: `findTarget` with that move's range and cone, which is the exact
   * call `ThirdPersonController` makes on the press. So a body wears a ring
   * because a key would take it — not because it happens to be standing inside
   * some cone alongside three others the swing will never reach. Two rings can
   * still come up, and when they do they are telling the truth: the kick and
   * the slash have locked different bodies.
   *
   * Every *enabled* attack is asked, rather than only the ones that could start
   * this instant: the moves lock each other out for the length of a swing (see
   * `Attack#canStart`), and a ring that blinked off for the half second the
   * body was busy would read as the target being lost. `ready` carries that
   * difference and is the single answer to "would this key do anything right
   * now" — the plate along the bottom (`_syncAbilities`) and the press itself,
   * which the controller refuses on the same `findTarget` call, both draw off
   * it. One answer, so a plate cannot come up over a body no key would reach.
   *
   * @param {number} dt
   * @param {import('three').Vector3} position
   */
  _updateTargetRings(dt, position) {
    const locked = this._locked;
    const ready = this._readyMoves;

    // Every list back to the pool before the map is emptied — the map is the
    // only thing holding them.
    for (const keys of locked.values()) {
      keys.length = 0;
      this._keyLists.push(keys);
    }
    locked.clear();
    ready.clear();

    const facing = this.character.facing;
    for (const move of this.character.attacks ?? []) {
      if (!move.available || !move.config.enabled) continue;

      const enemy = this.enemies.findTarget(position, facing, move.config);
      if (!enemy) continue;

      // Mid-swing counts as ready: the press that owns the body is committed
      // to it, so the plate along the bottom and the controller should not
      // blink the move off for the half second the swing has it.
      if (move.locked || move.canStart()) ready.add(move.configKey);

      let keys = locked.get(enemy);
      if (!keys) {
        keys = this._keyLists.pop() ?? [];
        locked.set(enemy, keys);
      }
      keys.push(move.configKey);
    }

    this.targetRings.update(dt, locked, this.elapsed);
  }

  /**
   * Say which moves the player can reach right now.
   *
   * Every answer is asked of the thing that owns it — the moves' own
   * `canStart()`, the summons' own `active` — rather than re-derived here, so
   * the row cannot claim a key will work when the press would be swallowed.
   * The attacks report `off` while another one has the body, which is exactly
   * what a press would do.
   *
   * For the techniques that is only half the question: a move also needs
   * someone inside its range and its cone, or the controller spends the press
   * and walks on (`ThirdPersonController#update`). That half is not re-asked
   * here — `_readyMoves` was filled from the same `findTarget` call the press
   * itself makes, one pass earlier in this frame, and is already "in reach
   * *and* able to start". Asking it twice is how the plate and the key drift
   * into disagreeing about the frame a body crosses the edge of the cone.
   */
  _syncAbilities() {
    const jump = this.character.jump;
    const hop = this.character.hop;
    const state = {
      leap:
        jump?.locked || hop?.locked
          ? 'active'
          : jump?.canStart(this.controller.speed, this.input.running) || hop?.canStart()
            ? 'ready'
            : 'off',
      // Always open, and never `active`: the studio hides this row while it is
      // up (`body.cs-open .hud`), so the only state it can be seen in is ready.
      customize: 'ready',
      // Lit while the exchange is burning, which is also the window in which a
      // second press is refused — the chip says so rather than swallowing it.
      weapon: this.characterScreen?.weapons.switching ? 'active' : 'ready',
      // Lit while the shooter is actually up, dimmed while the key would still
      // work but nothing on screen would change: the setting is real with the
      // sword out, and the lens is simply not on a shoulder to be crossed.
      shoulder: this.gunplay.active ? 'active' : 'off'
    };

    // The two chips that name a value rather than a move: what is in the hand,
    // and which side the lens is standing on.
    const drawn = this.characterScreen?.weapons.current;
    if (drawn) {
      this.actionHUD.setLabel('weapon', findItem(drawn)?.name ?? drawn);
    }
    this.actionHUD.setLabel(
      'shoulder',
      this.gunplay.shoulder === 'left' ? '왼쪽 어깨' : '오른쪽 어깨'
    );

    for (const move of this.character.attacks ?? []) {
      state[move.configKey] = move.locked
        ? 'active'
        : this._readyMoves.has(move.configKey)
          ? 'ready'
          : 'off';
    }

    this.actionHUD.update(state);
  }

  /** However the screen was closed, the play stage comes back here. */
  _onScreenExit() {
    this.touchControls?.setMenuOpen(false);
    this.progressionHUD.element.style.display = '';
    this.missionHUD.element.style.display = '';
    // The orbit drag comes back with the stage; the pointer does not, and is
    // not taken back for the player either. They left this stage with a cursor
    // and they arrive with one — the next click on the canvas is what says
    // they are done pointing at things.
    this.rig.park(false);
    this.post.setView(this.scene, this.camera);
    this.toast.show('Back on the stage');
  }

  /* ------------------------------------------------------------------ */

  /** Load assets, warm the shader cache, then start the loop. */
  async load() {
    const assets = new AssetLoader();

    this.loading.setProgress(0.05, 'Loading environment…');
    const hdr = await assets.loadHDR(HDR_URL);
    await this.environment.loadEnvironment(hdr);
    frame.uEnvMap.value = this.environment.equirect;

    this.loading.setProgress(0.3, 'Loading the forest floor…');
    await this.ground.loadTextures(assets);
    // And what is lying on it. Before the shader warm-up below, so the two leaf
    // materials are compiled with everything else rather than on the first frame
    // a leaf is in shot.
    await this.leaves.load(assets, this.renderer);

    // Before the shader warm-up below, so the moon is compiled with the rest and
    // the first frame has a body in it rather than a disc that swaps a moment
    // later. If the maps fail the sky keeps its own disc and nothing else knows.
    await this.moon.load(assets);

    // One build before the first frame, so the ground is shaped when the
    // loading screen lifts rather than settling a frame into it. The floor
    // follows, because it is what re-bakes the height field the terrain has just
    // described (see `world/TerrainCache.js`) — and it has to happen before the
    // shader compile below, not on the first frame after it.
    this.terrain.update();
    this.ground.update(0, 0, 0);

    this.loading.setProgress(0.4, 'Building the logistics yard…');
    await this.yard.load(assets);
    await this.turrets.load(assets);

    this.loading.setProgress(0.55, 'Loading character, materials & animations…');
    await this.character.load(assets);

    this.loading.setProgress(0.72, 'Waking the enemies…');
    this.enemies.yard = this.yard;
    const cpkWalker = await assets.loadGLTF('./models/environment/cpk/Enemy_2Legs.gltf');
    const cpkFlyer = await assets.loadGLTF('./models/environment/cpk/Enemy_Flying.gltf');
    const cpkHeavy = await assets.loadGLTF('./models/environment/cpk/Enemy_Large.gltf');
    this.enemies.mechProto = cpkWalker.scene;
    this.enemies.mechClips = cpkWalker.animations;
    this.enemies.mechProtoFlyer = cpkFlyer.scene;
    this.enemies.mechClipsFlyer = cpkFlyer.animations;
    this.enemies.mechProtoHeavy = cpkHeavy.scene;
    this.enemies.mechClipsHeavy = cpkHeavy.animations;
    await this.enemies.load(assets);
    for (const turret of this.turrets.turrets) {
      this.enemies.attach(turret);
      turret.onFire = (unit, origin, direction) => this._turretFire(unit, origin, direction);
    }
    this._nearestBody = nearestBody;
    this._debugJoints = debugJoints;
    this.progression = new Progression();
    this._syncDamageScale();
    this.enemies.onKill = (credits) => {
      this.progression.addCredits(credits);
      const finished = this.missions.onKill();
      if (finished) {
        this.progression.addCredits(finished.completed.reward);
        this.toast.show(`임무 완료 · 보상 ${finished.completed.reward} 크레딧`);
      }
      this.missionHUD.update();
    };
    this.progressionHUD = new ProgressionHUD(this.progression, {
      damage: () => this.buyDamageUpgrade(),
      health: () => this.buyHealthUpgrade(),
      speed: () => this.buySpeedUpgrade(),
    });
    // Saved speed ranks survive the reload through the controller, not just
    // the store.
    this.controller.speedScale = this.progression.speedMultiplier;
    this.missions = new Missions();
    this.missionHUD = new MissionHUD(this.missions, this.progressionHUD.element);
    this.progressionHUD.onUpdate = () => this.missionHUD.update();
    this.playerHealth = settings.player.health + this.progression.healthBonus;
    this._playerInvuln = 0;
    this._tracers = [];
    // Stood up now rather than on the first frame, so their materials are in
    // the scene for the shader warm-up below.
    this.enemies.respawnAll();

    this.loading.setProgress(0.8, 'Building the character screen…');
    // The set and its rig cost nothing until they are drawn, and building them
    // now means `C` is instant. The equipment models themselves stay on disk
    // until the screen is opened — see `EquipmentLibrary`.
    this.characterScreen = new CharacterScreen({
      renderer: this.renderer,
      canvas: this.canvas,
      character: this.character,
      worldScene: this.scene,
      envMap: this.environment.envMap,
      onToast: (message) => this.toast.show(message),
      onExit: () => this._onScreenExit()
    });

    this.loading.setProgress(0.83, 'Equipping…');
    // The starting loadout — whatever was last dialled in on the set, or the
    // catalog's defaults on a first run. Gear hangs off the skeleton rather than
    // off either stage, so equipping here puts it on the body for the play scene
    // too, and a placement tuned in the screen is the one the world shows.
    await this.characterScreen.equipment.restoreOrDefaults();
    // Which of the weapons that puts on the body is actually drawn, and the
    // idle that goes with it. After the loadout, because there is nothing to
    // draw until the mounts exist — and with no burn, because the body has not
    // been on screen yet.
    this.characterScreen.weapons.restore();

    this.loading.setProgress(0.85, 'Compiling shaders…');
    // Compile everything up front so the first frame never stutters — both
    // stages, so opening the character screen is not its own first frame.
    await this.renderer.gl.compileAsync(
      this.characterScreen.stage.scene,
      this.characterScreen.camera.camera
    );
    await this.renderer.gl.compileAsync(this.scene, this.camera);

    // Every texture has decoded by now, so the blobs the character's embedded
    // images were served from can go.
    await assets.settled();
    assets.dispose();

    this.loading.setProgress(1, 'Ready');
    this.loading.hide();
    // The moves are named by the row along the bottom, so this only has to
    // cover what the row does not: the stick, and where to look for the rest.
    this.toast.show(
      this.touchControls
        ? '왼쪽으로 이동 · 오른쪽으로 조준 · 발사/점프는 화면 버튼'
        : 'WASD 이동 · Shift 달리기 · 동작은 하단에 있습니다'
    );

    this.start();
  }

  start() {
    this.time.reset();
    this.stats.reset();
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      this.frame();
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this._raf);
  }

  /* ------------------------------------------------------------------ */

  frame() {
    const gl = this.renderer.gl;
    // The counters still standing are the ones the *previous* frame ran up, and
    // they are about to be cleared — so the readout is fed here, where a frame
    // ends for certain, rather than at each of the several places one can end.
    this.stats.sample(gl.info.render);
    gl.info.reset();

    const raw = this.time.tick();
    // The impact freeze, spent in *real* time so it lasts as long on any frame
    // rate, and applied as a scale so everything slows together (see `_hitStop`).
    let scale = settings.global.timeScale;
    if (this._hitStop > 0) {
      this._hitStop = Math.max(0, this._hitStop - raw);
      scale *= this._hitStopScale;
    }
    const dt = this.paused ? 0 : raw * scale;
    this.elapsed += dt;

    /* ---- shared uniforms ---- */
    frame.uTime.value = this.elapsed;
    frame.uDelta.value = dt;
    frame.uCameraNear.value = this.camera.near;
    frame.uCameraFar.value = this.camera.far;

    // Before anything reads the view: whether the pointer is still ours, and
    // the one line that says how to get it back.
    this.pointerLook.update();

    // Which grade is in force. Everything downstream reads this one object.
    const look = this.inCharacterScreen ? this.characterScreen.postLook : settings.post;

    /* ---- simulation ---- */
    this.renderer.syncSettings(look);

    if (this.inCharacterScreen) {
      // The play stage is not simulated while the studio is up: its lights,
      // floor and mist are not on screen, and the body is not standing on it.
      this.characterScreen.update(dt, raw);

      gl.shadowMap.needsUpdate = true;
      this.post.sync(this.elapsed, look);
      this.post.render();
      return;
    }

    // Any terrain slider moved this frame lands here, before anything reads a
    // height — so the floor and the body both see the same landscape.
    this.terrain.update();
    // The air and the sky are one look, so they are re-read together. The sky
    // drops its own disc for as long as there is a body to draw instead, and the
    // body comes second because it hangs itself on the light direction the sky
    // has just resolved.
    this.atmosphere.update();
    this.sky.discEnabled = !this.moon.active;
    this.sky.update(this.elapsed);
    this.moon.update();

    // Before the stick, because it is what the stick is resolved against while
    // the rifle is out: the aim decides the heading the body has to hold and
    // the twist the torso carries, and a frame's lag on either would have the
    // body chasing a lens that was chasing it back.
    this.gunplay.aim(dt);

    // Before the stick as well, and for a plainer reason: the boon's haste is a
    // multiplier on the pace the stick asks for, so it has to be on the
    // controller before the controller is asked for a frame of movement.
    this._syncBoon();

    // Movement first: it sets the heading and the speed the blend animates to.
    // It only ever touches XZ; which is the whole reason the body can be dropped
    // onto the ground here without the controller knowing the ground exists.
    this.controller.update(dt);
    // Stand the character on the surface. The jump's arc lives inside the model
    // (it is the clip's own hips translation), so this stays the body's *ground*
    // height throughout and a leap over a valley still lands on the far side.
    const position = this.character.position;
    const groundY = this.terrain.heightAt(position.x, position.z);
    position.y = groundY + (this.character.jump?.lift ?? 0);
    this.character.update(dt);

    // Before the bodies, not after: a blow landing this frame emits into this,
    // and a droplet has to be stamped with a clock the shader has already been
    // given or it is born a frame in the past.
    this.blood.sync(this.elapsed);

    // The bodies: their idles, their ragdolls and the ring they stand in. After
    // the character, because where the player is standing is what they watch,
    // what they are spawned around, and what the kick's reach was measured
    // against this frame.
    this.enemies.update(dt, position);
    // An enemy that drifts between the lens and the character would fill the
    // screen with its hull: fade (never hide) a body close to the lens, so its
    // attacks and hits stay readable. Materials are cloned once per body.
    {
      const cam = this.camera.position;
      for (const enemy of this.enemies.enemies) {
        const root = enemy.root;
        if (!root) continue;
        const d = enemy.alive ? Math.sqrt(root.position.distanceToSquared(cam)) : 99;
        const wanted = d < 3.2 ? Math.max(0.18, (d - 1.2) / 2.0) : 1;
        if (wanted === 1 && enemy._camFade === undefined) continue;
        if (enemy._camFade === wanted) continue;
        if (!enemy._camMats) {
          enemy._camMats = [];
          root.traverse((o) => {
            if (!o.isMesh || !o.material) return;
            const list = Array.isArray(o.material) ? o.material : [o.material];
            const cloned = list.map((m) => { const c = m.clone(); c.userData._base = [m.transparent, m.opacity]; return c; });
            o.material = Array.isArray(o.material) ? cloned : cloned[0];
            enemy._camMats.push(...cloned);
          });
        }
        for (const m of enemy._camMats) {
          const [t, o] = m.userData._base;
          m.transparent = wanted < 1 ? true : t;
          m.opacity = o * wanted;
          m.depthWrite = wanted >= 0.99 ? true : false;
          m.needsUpdate = true;
        }
        enemy._camFade = wanted === 1 ? undefined : wanted;
      }
    }
    // After them, so a body that has just been felled or has just walked out of
    // the cone loses its ring on the same frame it stops being a target.
    this._updateTargetRings(dt, position);
    // And what is left of each of them, while the gun is out. After the bodies
    // for the third time and the same reason: one felled this frame must not
    // still be wearing a bar on it.
    this.healthBars.update(dt, this.enemies.enemies, this.gunplay.active, this.camera);

    // Turret tracers fade fast; the player's safety clock runs down.
    for (let i = this._tracers.length - 1; i >= 0; i--) {
      const tracer = this._tracers[i];
      tracer.t += dt;
      tracer.line.material.opacity = Math.max(0, 1 - tracer.t / settings.turrets.tracerTime);
      if (tracer.t >= settings.turrets.tracerTime) {
        this.scene.remove(tracer.line);
        tracer.line.geometry.dispose();
        tracer.line.material.dispose();
        this._tracers.splice(i, 1);
      }
    }
    this._playerInvuln = Math.max(0, this._playerInvuln - dt);
    this.progressionHUD.update();

    this.environment.setFocus(position.x, position.z, groundY);
    this.environment.update();
    // Gear rides the skeleton, so this is mostly the mounts' scale against a rig
    // the editor may have just re-normalised — plus the clock for any piece
    // that animates itself, which is why it takes the simulation's `dt`: a
    // rifle's ring slows with the hit-stop like everything else on the body.
    this.characterScreen?.equipment.update(dt);
    // And which weapon is in the hand. On the same clock and for the same
    // reason: a swap started a frame before a blow lands is part of the blow.
    this.characterScreen?.weapons.update(dt);
    // And the trigger, after both — the muzzle is a point on a model hanging
    // off a hand that has only just finished being posed and scaled, so a round
    // fired any earlier would leave the gun where it was last frame. The real
    // clock goes with the simulation's because the flash and the reticle are
    // the player's, not the world's: a hit-stop must not hold a muzzle flash on
    // screen for three times its life.
    this.gunplay.update(dt, raw);

    // After everything that could have taken the body, so a chip lights on the
    // frame the move it names actually starts.
    this._syncAbilities();

    this.ground.update(this.elapsed, position.x, position.z);
    // After the floor, because the puffs stand on the height field the bake it
    // just refreshed describes.
    this.groundFog.update(this.elapsed, position);
    // And the leaves, for the same reason — they lie on that bake, and the
    // window of them follows the body that has just finished moving. The
    // velocity is what scatters them: it goes in raw, so a walk stirs the litter
    // and a sprint throws it, and standing still disturbs nothing.
    this.leaves.update(dt, this.elapsed, position, this.controller.velocity);

    /* ---- camera ---- */
    // The rig runs on *real* time so orbiting stays responsive while paused.
    this.rig.setAnchor(position.x, groundY, position.z);
    this.rig.update(raw);

    this.contactShadows.setPosition(position.x, position.z, groundY);
    this.contactShadows.render(this.scene);

    /* ---- render ---- */
    // Exactly one shadow map update per frame (see Renderer).
    gl.shadowMap.needsUpdate = true;
    this.post.sync(this.elapsed, look);
    this.post.render();
  }

  /* ------------------------------------------------------------------ */


  /**
   * A turret fired. The beam is a straight ray; if it passes within
   * `settings.turrets.hitRadius` of the player's chest it connects, and the
   * tracer is drawn either way so the shot reads even when it misses.
   */
  _turretFire(unit, origin, direction) {
    const target = this.character.position;
    // Cover first: a crate or a fence between the muzzle and the player ends
    // the beam there, whatever the aim says.
    const block = this.yard.blocksLine(
      origin.x, origin.z, target.x, target.z, origin.y
    );
    // Closest approach of the ray to the player's chest height.
    _toPlayer.set(target.x - origin.x, 0, target.z - origin.z);
    const along = _toPlayer.dot(direction);
    const chestY = origin.y - 0.5;
    let hitPoint = null;
    if (block !== null) {
      const distance = block * Math.hypot(target.x - origin.x, target.z - origin.z);
      _far.copy(origin).addScaledVector(direction, Math.min(distance, unit.range));
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(
        [origin.x, origin.y, origin.z, _far.x, origin.y, _far.z], 3
      ));
      const line = new Line(geometry, new LineBasicMaterial({
        color: 0xff5533, transparent: true, opacity: 1
      }));
      this.scene.add(line);
      this._tracers.push({ line, t: 0 });
      return;
    }
    if (along > 0 && along < unit.range) {
      _closest.copy(origin).addScaledVector(direction, along);
      _closest.y = chestY;
      const dx = target.x - _closest.x;
      const dz = target.z - _closest.z;
      if (Math.hypot(dx, dz) < settings.turrets.hitRadius) hitPoint = _closest.clone();
    }
    const end = hitPoint ?? _far.copy(origin).addScaledVector(direction, unit.range).clone();
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(
      [origin.x, origin.y, origin.z, end.x, end.y, end.z], 3
    ));
    const line = new Line(geometry, new LineBasicMaterial({
      color: 0xff5533, transparent: true, opacity: 1
    }));
    this.scene.add(line);
    this._tracers.push({ line, t: 0 });

    if (!hitPoint) return;
    this._damagePlayer(settings.turrets.damage);
  }

  /** Shared player hit: respects post-respawn safety, respawns at zero. */
  _damagePlayer(amount) {
    if (this._playerInvuln > 0) return;
    this.playerHealth -= amount;
    if (this.playerHealth <= 0) this._respawnPlayer();
  }

  /** Buy the next damage rank and push the multiplier live. */
  buyDamageUpgrade() {
    if (!this.progression.buyDamageRank()) return false;
    this._syncDamageScale();
    return true;
  }

  /** Buy the next health rank: the cap goes up, and so does the current pool. */
  buyHealthUpgrade() {
    if (!this.progression.buyHealthRank()) return false;
    this.playerHealth = Math.min(
      settings.player.health + this.progression.healthBonus,
      this.playerHealth + 20
    );
    return true;
  }

  /** Buy the next speed rank and push the multiplier into the controller. */
  buySpeedUpgrade() {
    if (!this.progression.buySpeedRank()) return false;
    this.controller.speedScale = this.progression.speedMultiplier;
    return true;
  }

  _syncDamageScale() {
    this.enemies.damageScale = this.progression.damageMultiplier;
  }

  /** Back to the spawn, whole again, with a moment of safety. */
  _respawnPlayer() {
    this.playerHealth = settings.player.health + this.progression.healthBonus;
    this._playerInvuln = settings.player.respawnInvuln;
    const position = this.character.position;
    position.set(0, this.terrain.heightAt(0, 0), 0);
    this.controller.velocity.set(0, 0);
  }

  dispose() {
    this.stop();
    window.removeEventListener('keydown', this._onKeyDown);
    this.input.dispose();
    this.pointerLook.dispose();
    this.gunplay.dispose();
    this.targetRings.dispose();
    this.healthBars.dispose();
    this.enemies.dispose();
    this.blood.dispose();
    this.characterScreen?.dispose();
    this.character.dispose();
    this.sky.dispose();
    this.moon.dispose();
    this.ground.dispose();
    this.groundFog.dispose();
    this.leaves.dispose();
    this.terrain.dispose();
    this.contactShadows.dispose();
    this.post.dispose();
    this.environment.dispose();
    this.editor.dispose();
    this.toast.dispose();
    this.stats.dispose();
    this.actionHUD.dispose();
    this.rig.dispose();
    this.renderer.dispose();
  }
}
