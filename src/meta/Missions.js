/**
 * Mission loop — a short chain of kill orders on top of the economy.
 *
 * Each mission is a number of confirmed kills and a credit bounty. Progress
 * persists next to the growth store, so a reload does not restart the chain.
 * The chain is deliberately short: it is the spine that gives the first
 * minutes a direction, not a campaign.
 */

const STORAGE_KEY = 'soldier-tpl.missions.v1';

export const MISSION_LIST = [
  { id: 'first-contact', label: '정찰: 적 3기 처치', target: 3, reward: 50 },
  { id: 'sweep', label: '소탕: 적 8기 처치', target: 8, reward: 120 },
  { id: 'purge', label: '제거: 적 15기 처치', target: 15, reward: 250 },
  { id: 'annihilate', label: '섬멸: 적 30기 처치', target: 30, reward: 600 },
];

export class Missions {
  constructor() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    } catch {
      saved = null;
    }
    this.index = Math.min(saved?.index ?? 0, MISSION_LIST.length - 1);
    this.progress = Math.min(saved?.progress ?? 0, MISSION_LIST[this.index].target);
    this.done = saved?.done === true;
  }

  /** The mission on the table, or null once the chain is finished. */
  get current() {
    return this.done ? null : MISSION_LIST[this.index];
  }

  /**
   * Record one confirmed kill.
   * @returns {{completed: object, next: object|null}|null} when this kill
   *   finished a mission: the finished order and the one that replaces it.
   */
  onKill() {
    const current = this.current;
    if (!current) return null;
    this.progress += 1;
    if (this.progress < current.target) {
      this._save();
      return null;
    }
    this.index += 1;
    this.progress = 0;
    if (this.index >= MISSION_LIST.length) this.done = true;
    this._save();
    return { completed: current, next: this.current };
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        index: this.index,
        progress: this.progress,
        done: this.done
      }));
    } catch {
      // Same rule as the growth store: private mode just does not persist.
    }
  }
}
