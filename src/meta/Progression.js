/**
 * Meta-progression — the permanent growth loop, persisted to localStorage.
 *
 * Kills pay credits; credits buy permanent upgrades. The store is the whole
 * truth of it: plain JSON, one key, loaded once and written on every change.
 * Combat reads the damage multiplier through `EnemyManager#damageScale`, so
 * the store itself never touches the fighting.
 */

const STORAGE_KEY = 'soldier-tpl.progression.v1';

/** What a kill pays, and what each damage rank costs and buys. */
export const ECONOMY = {
  killCredits: 10,
  damage: {
    baseCost: 100,
    costGrowth: 1.5,
    perRank: 0.15
  },
  /** Max-health track: flat points per rank. */
  health: {
    baseCost: 80,
    costGrowth: 1.5,
    perRank: 20
  },
  /** Move-speed track: fraction per rank, multiplied into the controller. */
  speed: {
    baseCost: 80,
    costGrowth: 1.5,
    perRank: 0.04
  }
};

export class Progression {
  constructor() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    } catch {
      saved = null;
    }
    this.credits = saved?.credits ?? 0;
    this.damageRank = saved?.damageRank ?? 0;
    this.healthRank = saved?.healthRank ?? 0;
    this.speedRank = saved?.speedRank ?? 0;
  }

  /** Damage multiplier for the player's rounds, from the purchased ranks. */
  get damageMultiplier() {
    return 1 + this.damageRank * ECONOMY.damage.perRank;
  }

  /** Cost of the next damage rank. */
  get damageCost() {
    return Math.round(ECONOMY.damage.baseCost * ECONOMY.damage.costGrowth ** this.damageRank);
  }

  /** Bonus max health from the purchased ranks, in points. */
  get healthBonus() {
    return this.healthRank * ECONOMY.health.perRank;
  }

  get healthCost() {
    return Math.round(ECONOMY.health.baseCost * ECONOMY.health.costGrowth ** this.healthRank);
  }

  /** Move-speed multiplier for the controller, from the purchased ranks. */
  get speedMultiplier() {
    return 1 + this.speedRank * ECONOMY.speed.perRank;
  }

  get speedCost() {
    return Math.round(ECONOMY.speed.baseCost * ECONOMY.speed.costGrowth ** this.speedRank);
  }

  addCredits(amount) {
    this.credits += amount;
    this._save();
  }

  /** @returns {boolean} whether the purchase went through */
  buyDamageRank() {
    if (this.credits < this.damageCost) return false;
    this.credits -= this.damageCost;
    this.damageRank += 1;
    this._save();
    return true;
  }

  /** @returns {boolean} whether the purchase went through */
  buyHealthRank() {
    if (this.credits < this.healthCost) return false;
    this.credits -= this.healthCost;
    this.healthRank += 1;
    this._save();
    return true;
  }

  /** @returns {boolean} whether the purchase went through */
  buySpeedRank() {
    if (this.credits < this.speedCost) return false;
    this.credits -= this.speedCost;
    this.speedRank += 1;
    this._save();
    return true;
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        credits: this.credits,
        damageRank: this.damageRank,
        healthRank: this.healthRank,
        speedRank: this.speedRank
      }));
    } catch {
      // Private mode and friends: growth just does not persist there.
    }
  }
}
