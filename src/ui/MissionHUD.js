/**
 * The mission line: one row under the growth box, naming the current order
 * and how far along it is. Korean, matching the rest of the HUD.
 */
export class MissionHUD {
  /**
   * @param {import('../meta/Missions.js').Missions} missions
   * @param {HTMLElement} anchor element this line docks under (the growth
   *   box, whose height changes as its text wraps)
   */
  constructor(missions, anchor = null) {
    this.missions = missions;
    this.anchor = anchor;
    this.element = document.createElement('div');
    this.element.className = 'mission';
    this.element.style.cssText = `
      position: fixed; left: 12px; top: 140px; z-index: 30;
      font: 13px/1.5 'NanumGothic', system-ui, sans-serif; color: #cfe6ff;
      background: rgba(10, 14, 24, 0.55); border: 1px solid rgba(150, 200, 255, 0.3);
      border-radius: 8px; padding: 6px 10px;
      text-shadow: 0 1px 2px #000;`;
    document.body.appendChild(this.element);
    this.update();
  }

  update() {
    if (this.anchor) {
      const bottom = this.anchor.offsetTop + this.anchor.offsetHeight;
      this.element.style.top = `${bottom + 8}px`;
    }
    const current = this.missions.current;
    this.element.textContent = current
      ? `임무 · ${current.label} (${this.missions.progress}/${current.target})`
      : '임무 · 전부 완료';
  }

  dispose() {
    this.element.remove();
  }
}
