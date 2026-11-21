/**
 * The growth HUD: credits on hand and the current damage rank, with the one
 * shop action the game has so far — press B to buy the next rank. Text is
 * Korean, matching the player's language.
 */
export class ProgressionHUD {
  /**
   * @param {import('../meta/Progression.js').Progression} progression
   * @param {() => boolean} buy purchases the next damage rank
   */
  /**
   * @param {import('../meta/Progression.js').Progression} progression
   * @param {{damage: () => boolean, health: () => boolean, speed: () => boolean}} buys
   */
  constructor(progression, buys) {
    this.progression = progression;
    this.buys = buys;
    this.element = document.createElement('div');
    this.element.className = 'progression';
    this.element.style.cssText = `
      position: fixed; left: 12px; top: 96px; z-index: 30;
      font: 13px/1.5 'NanumGothic', system-ui, sans-serif; color: #ffd;
      background: rgba(10, 14, 24, 0.55); border: 1px solid rgba(255, 220, 150, 0.35);
      border-radius: 8px; padding: 6px 10px;
      text-shadow: 0 1px 2px #000;`;
    document.body.appendChild(this.element);
    // The buy action is a real button, so touch players can tap it too.
    this.label = document.createElement('span');
    // One button per track. Each is a real button, so touch players can tap
    // it too — and on a phone the tap is a pointerdown (a second finger never
    // produces a click), with preventDefault keeping the click from buying
    // twice.
    this._buttons = {};
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; gap: 6px; margin-bottom: 4px;';
    for (const track of ['damage', 'health', 'speed']) {
      const button = document.createElement('button');
      button.type = 'button';
      button.style.cssText = `
        font: 12px/1.3 'NanumGothic', system-ui, sans-serif;
        color: #ffe9b0; background: rgba(80, 60, 20, 0.6);
        border: 1px solid rgba(255, 220, 150, 0.6); border-radius: 6px;
        padding: 3px 7px; cursor: pointer; touch-action: none;`;
      button.addEventListener('click', () => this._buy(track));
      button.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'touch') return;
        event.preventDefault();
        this._buy(track);
      });
      this._buttons[track] = button;
      row.appendChild(button);
    }
    // Buttons first: the label grows with the credit count, and a button that
    // slides as you earn is a button you tap-miss on a phone.
    this.element.appendChild(row);
    this.element.appendChild(this.label);
    this._last = '';
    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyB') this._buy('damage');
    });
    this.update(true);
  }

  _buy(track) {
    this.buys[track]?.();
    this.update(true);
  }

  /** Re-render only when the numbers actually moved. */
  update(force = false) {
    const p = this.progression;
    const costs = { damage: p.damageCost, health: p.healthCost, speed: p.speedCost };
    const names = { damage: '피해', health: '체력', speed: '속도' };
    const text = `크레딧 ${p.credits} · 피해 Lv${p.damageRank} (+${Math.round((p.damageMultiplier - 1) * 100)}%) · 체력 Lv${p.healthRank} (+${p.healthBonus}) · 속도 Lv${p.speedRank} (+${Math.round((p.speedMultiplier - 1) * 100)}%)`;
    if (!force && text === this._last) return;
    this._last = text;
    this.label.textContent = text;
    for (const track of ['damage', 'health', 'speed']) {
      const button = this._buttons[track];
      button.textContent = `${names[track]} ${costs[track]}`;
      // Dim what the wallet cannot buy, so the price answers at a glance.
      button.style.opacity = p.credits >= costs[track] ? '1' : '0.45';
    }
    const hint = document.createElement('span');
    hint.className = 'kbd-hint';
    hint.textContent = ' [B]';
    this.label.appendChild(hint);
    this.onUpdate?.();
  }

  dispose() {
    this.element.remove();
  }
}
