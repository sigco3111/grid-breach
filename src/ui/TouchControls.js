import { settings } from '../config/settings.js';

/**
 * Touch controls: a dynamic left stick for movement, the right half of the
 * screen as an aim drag, and two buttons (fire, jump).
 *
 * Only constructed on touch devices (see `App.js`); on a desktop none of this
 * exists. Everything it does lands on the same three inputs the keyboard and
 * mouse already drive, so nothing downstream knows the difference:
 *
 * - the stick writes `Input#touchAxis`, which `Input#sample` prefers over keys
 * - the aim drag spends into `CameraRig#look`, the same call PointerLook makes
 * - the buttons go to `Gunplay#setTrigger` and `Input#pressJump`
 */
const STICK_RADIUS = 56; // px of travel from the stick's origin to full deflection

export class TouchControls {
  /**
   * @param {import('../core/Input.js').Input} options.input
   * @param {import('../core/CameraRig.js').CameraRig} options.rig
   * @param {import('../combat/Gunplay.js').Gunplay} options.gunplay
   */
  constructor({ input, rig, gunplay, onMenu = null }) {
    this.input = input;
    this.rig = rig;
    this.gunplay = gunplay;
    this.onMenu = onMenu;
    // No pointer lock exists here to lose — tell the gun to stop standing
    // down for one (see `Gunplay#locked`).
    gunplay.touchMode = true;

    /** Pointer id of the moving stick touch, and where it started. */
    this._moveId = null;
    this._moveOrigin = { x: 0, y: 0 };
    /** Pointer id of the aiming drag, and its last position. */
    this._aimId = null;
    this._aimLast = { x: 0, y: 0 };
    /** Aim-stick origin (twin-stick scheme), and whether it is firing. */
    this._aimOrigin = { x: 0, y: 0 };
    this._stickFiring = false;
    /** Pointer id holding the fire button. */
    this._fireId = null;

    this._buildDom();

    this._onPointerDown = (event) => this._down(event);
    this._onPointerMove = (event) => this._move(event);
    this._onPointerUp = (event) => this._up(event);
    window.addEventListener('pointerdown', this._onPointerDown, { passive: false });
    window.addEventListener('pointermove', this._onPointerMove, { passive: false });
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
    // A focus change cancels touches without pointer events: the gun hears
    // `blur` and stands down, and without this the sticks would keep their
    // state and a hard-pushed aim stick would never fire again afterwards.
    this._onWindowBlur = () => this._releaseAll();
    window.addEventListener('blur', this._onWindowBlur);
  }

  /**
   * The label follows the screen it opens, so it doubles as the way back.
   * While that screen is up the play controls come off it — a FIRE tapped
   * against the studio would otherwise cock the trigger for the moment the
   * screen closed — and any finger already on a stick is let go.
   */
  setMenuOpen(open) {
    this._menuBlocked = open === true;
    // One close affordance is enough: while the screen is up, its own bar
    // carries 닫기 and this floating button would only overlap it.
    this._menu.style.display = open ? 'none' : 'flex';
    this._menu.textContent = open ? '닫기' : '메뉴';
    this._fire.style.display = open ? 'none' : 'flex';
    this._jump.style.display = open ? 'none' : 'flex';
    this._hint.style.display = open ? 'none' : 'block';
    if (open) this._releaseAll();
  }

  /** Every finger gone at once: sticks centred, aim and fire released. */
  _releaseAll() {
    this._moveId = null;
    this.input.touchAxis = null;
    this._stick.style.display = 'none';
    this._knob.style.transform = 'translate(-50%,-50%)';
    this._aimId = null;
    this.gunplay.stickAim = null;
    this._stickR.style.display = 'none';
    this._knobR.style.transform = 'translate(-50%,-50%)';
    if (this._stickFiring || this._fireId !== null) {
      this._stickFiring = false;
      this.gunplay.setTrigger(false);
    }
    this._fireId = null;
    this._fire.classList.remove('tc-on');
  }

  _buildDom() {
    const style = document.createElement('style');
    style.textContent = `
      .tc-stick { position: fixed; width: 112px; height: 112px; border-radius: 50%;
        border: 2px solid rgba(255,255,255,0.35); background: rgba(255,255,255,0.06);
        display: none; pointer-events: none; z-index: 40; transform: translate(-50%,-50%); }
      .tc-knob { position: absolute; left: 50%; top: 50%; width: 48px; height: 48px;
        border-radius: 50%; background: rgba(255,255,255,0.45);
        transform: translate(-50%,-50%); }
      .tc-btn { position: fixed; width: 76px; height: 76px; border-radius: 50%;
        border: 2px solid rgba(255,255,255,0.4); background: rgba(255,255,255,0.10);
        color: rgba(255,255,255,0.85); font: 600 13px/1 'NanumGothic', system-ui, sans-serif;
        display: flex; align-items: center; justify-content: center; z-index: 41;
        touch-action: none; user-select: none; -webkit-user-select: none; }
      .tc-btn.tc-on { background: rgba(255,120,80,0.35); }
      #tc-fire { right: 24px; bottom: 96px; width: 88px; height: 88px; }
      #tc-jump { right: 128px; bottom: 32px; }
      /* The only door to the character screen on a phone — top-right, away
         from both sticks (bottom corners) and the growth/mission HUD (top
         left and centre). */
      #tc-menu { right: 24px; top: 16px; width: 60px; height: 60px; font-size: 12px; }
      .tc-hint { position: fixed; left: 16px; bottom: 16px; color: rgba(255,255,255,0.4);
        font: 12px/1.4 'NanumGothic', system-ui, sans-serif; z-index: 40; pointer-events: none; }
      /* Two fingers on the play surface must not become a browser pinch —
         that is what cancelled the FIRE hold when the second finger tapped
         the HUD. Scoped to the control surfaces only, so anything that ever
         needs pinch-zoom keeps it. */
      #viewport, .tc-btn, .progression { touch-action: none; }
      /* Key hints are desktop furniture. */
      .kbd-hint { display: none !important; }
      /* The stage editor is a desktop development tool; on a phone it only
         covers the aim zone. */
      .lil-gui { display: none !important; }
      /* The keyboard/mouse hints and the dev stats read as noise on a phone. */
      .hint, .look-hint, .stats { display: none !important; }
      /* The keyboard chips along the bottom are keys made visible; the touch
         buttons replace them, and the strip only overlaps them on a phone. */
      .hud { display: none !important; }
    `;
    document.head.appendChild(style);

    this._stick = document.createElement('div');
    this._stick.className = 'tc-stick';
    this._knob = document.createElement('div');
    this._knob.className = 'tc-knob';
    this._stick.appendChild(this._knob);
    document.body.appendChild(this._stick);

    // The aim stick of the twin-stick scheme: same look, right hand.
    this._stickR = document.createElement('div');
    this._stickR.className = 'tc-stick';
    this._knobR = document.createElement('div');
    this._knobR.className = 'tc-knob';
    this._stickR.appendChild(this._knobR);
    document.body.appendChild(this._stickR);

    this._fire = this._makeButton('tc-fire', '발사');
    this._jump = this._makeButton('tc-jump', '점프');
    this._menu = this._makeButton('tc-menu', '메뉴');

    const hint = document.createElement('div');
    hint.className = 'tc-hint';
    this._hint = hint;
    hint.textContent = settings.controls.touchAim === 'stick'
      ? '왼쪽: 이동 · 오른쪽: 조준(세게 밀면 발사)'
      : '왼쪽: 이동 · 오른쪽: 조준';
    document.body.appendChild(hint);
  }

  _makeButton(id, label) {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'tc-btn';
    el.textContent = label;
    document.body.appendChild(el);
    return el;
  }

  _down(event) {
    if (event.pointerType !== 'touch') return;
    // Only the menu toggle itself answers while a menu owns the screen.
    if (this._menuBlocked && event.target !== this._menu) return;

    if (event.target === this._fire) {
      event.preventDefault();
      if (this._fireId === null) {
        this._fireId = event.pointerId;
        this._fire.classList.add('tc-on');
        this.gunplay.setTrigger(true);
      }
      return;
    }
    if (event.target === this._jump) {
      event.preventDefault();
      this.input.pressJump();
      return;
    }
    if (event.target === this._menu) {
      event.preventDefault();
      this.onMenu?.();
      return;
    }
    // Chips, panels and the editor stay ordinary taps.
    if (event.target.closest('.hud, .panel, .editor, button, a, input, select, textarea')) return;

    if (event.clientX < window.innerWidth * 0.45 && this._moveId === null) {
      event.preventDefault();
      this._moveId = event.pointerId;
      this._moveOrigin = { x: event.clientX, y: event.clientY };
      this._stick.style.display = 'block';
      this._stick.style.left = `${event.clientX}px`;
      this._stick.style.top = `${event.clientY}px`;
      this.input.touchAxis = { x: 0, y: 0 };
    } else if (this._aimId === null) {
      event.preventDefault();
      this._aimId = event.pointerId;
      this._aimLast = { x: event.clientX, y: event.clientY };
      if (settings.controls.touchAim === 'stick') {
        this._aimOrigin = { x: event.clientX, y: event.clientY };
        this._stickR.style.display = 'block';
        this._stickR.style.left = `${event.clientX}px`;
        this._stickR.style.top = `${event.clientY}px`;
      }
    }
  }

  _move(event) {
    if (event.pointerId === this._moveId) {
      event.preventDefault();
      let dx = event.clientX - this._moveOrigin.x;
      let dy = event.clientY - this._moveOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        dx = (dx / len) * STICK_RADIUS;
        dy = (dy / len) * STICK_RADIUS;
      }
      this._knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      // Screen up is forward (+y); the stick reads analog all the way out.
      this.input.touchAxis = { x: dx / STICK_RADIUS, y: -dy / STICK_RADIUS };
    } else if (event.pointerId === this._aimId) {
      event.preventDefault();
      if (settings.controls.touchAim === 'stick') {
        let dx = event.clientX - this._aimOrigin.x;
        let dy = event.clientY - this._aimOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > STICK_RADIUS) {
          dx = (dx / len) * STICK_RADIUS;
          dy = (dy / len) * STICK_RADIUS;
        }
        this._knobR.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        const amount = Math.min(1, len / STICK_RADIUS);
        if (amount > 0.25) {
          // Same basis the move stick reads against the camera: screen up is
          // "away from the lens", so the aim is a world direction the camera
          // only names, never picks.
          const ax = dx / STICK_RADIUS;
          const ay = -dy / STICK_RADIUS;
          const sin = Math.sin(this.rig.azimuth);
          const cos = Math.cos(this.rig.azimuth);
          this.gunplay.stickAim = Math.atan2(ay * -sin + ax * cos, ay * -cos + ax * -sin);
          // A hard push fires, so two thumbs are the whole scheme; a soft
          // tilt only points. The FIRE button stays the third option.
          const wantFire = amount >= settings.controls.stickFireThreshold;
          if (wantFire !== this._stickFiring && this._fireId === null) {
            this._stickFiring = wantFire;
            this.gunplay.setTrigger(wantFire);
          }
        }
        return;
      }
      const dx = event.clientX - this._aimLast.x;
      const dy = event.clientY - this._aimLast.y;
      this._aimLast = { x: event.clientX, y: event.clientY };
      const factor = settings.camera.sensitivity * 1.6; // drag feel, a touch faster than the mouse
      this.rig.look(dx * factor, -dy * factor);
    }
  }

  _up(event) {
    if (event.pointerId === this._moveId) {
      this._moveId = null;
      this.input.touchAxis = null;
      this._stick.style.display = 'none';
      this._knob.style.transform = 'translate(-50%,-50%)';
    } else if (event.pointerId === this._aimId) {
      this._aimId = null;
      this.gunplay.stickAim = null;
      if (this._stickFiring) {
        this._stickFiring = false;
        this.gunplay.setTrigger(false);
      }
      this._stickR.style.display = 'none';
      this._knobR.style.transform = 'translate(-50%,-50%)';
    } else if (event.pointerId === this._fireId) {
      this._fireId = null;
      this._fire.classList.remove('tc-on');
      this.gunplay.setTrigger(false);
    }
  }

  dispose() {
    window.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    window.removeEventListener('blur', this._onWindowBlur);
    if (this.input.touchAxis) this.input.touchAxis = null;
  }
}
