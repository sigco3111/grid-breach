/**
 * The glyph for each move, drawn rather than written.
 *
 * One 24×24 line drawing per ability id, in the same brush language: a single
 * stroke weight, round caps, and the faint marks — impact, trail, speed —
 * carried at lower opacity so the shape of the move reads first and the motion
 * second. Everything is `currentColor`, so a chip's state colours its icon by
 * setting `color` and nothing else.
 *
 * These are markup, not files: an inline `<svg>` costs no request, inherits the
 * chip's colour and transitions, and cannot arrive late and pop in over a HUD
 * that is already on screen.
 */

/** @param {string} body inner markup, in a 24×24 box */
const stroke = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/**
 * Icon markup by ability id.
 *
 * Keyed by the same `id` that names the settings block and the clip, so adding
 * a move means adding one entry here and one in `config/abilities.js`.
 *
 * @type {Record<string, string>}
 */
export const ABILITY_ICONS = {
  // An arc of travel with the leap's own arrowhead at the far end, dashed
  // because the ground under it is the part that is not there.
  leap: stroke(
    `<path d="M3 19.2c1.4-7.4 6.2-11.6 13.4-11.6" stroke-dasharray="2.4 2.6" opacity="0.8"/>` +
      `<path d="M12.8 4.4 17 7.6 13.6 11"/>` +
      `<circle cx="3" cy="19.2" r="1.5" fill="currentColor" stroke="none"/>`
  ),

  // A blade and a barrel crossed, with the swap arrows turning between them.
  // Neither weapon is drawn whole: at 24px a katana and a rifle differ by their
  // *ends*, so the glyph is a hilt and a stock meeting at the centre and the
  // two silhouettes reading off each other.
  weapon: stroke(
    // The blade, up to the right, with its guard.
    `<path d="M4.6 19.4 15.4 8.6" stroke-width="1.9"/>` +
      `<path d="M2.8 21.2 4.6 19.4" stroke-width="2.4"/>` +
      `<path d="M3.4 17.6 6.4 20.6" stroke-width="1.4"/>` +
      // The rifle, down to the right: barrel, then the drop of the grip.
      `<path d="M8.6 5.4h11.8" stroke-width="1.9"/>` +
      `<path d="M20.4 5.4v2.2" stroke-width="1.4"/>` +
      `<path d="M12.6 5.6 11 9.4" stroke-width="1.6"/>` +
      // And the exchange, turning between the two.
      `<path d="M17.4 13.2a3.6 3.6 0 0 1-5.2 3" stroke-width="1.3" opacity="0.72"/>` +
      `<path d="M12.9 18.3 11.6 16 14 15.1" stroke-width="1.3" opacity="0.72"/>` +
      `<path d="M14.2 19.6a3.6 3.6 0 0 0 5.2-3" stroke-width="1.3" opacity="0.72"/>` +
      `<path d="M18.7 14.5 20 16.8 17.6 17.7" stroke-width="1.3" opacity="0.72"/>`
  ),

  // A body on the stand, with a slot open either side of it — the studio is
  // where gear goes on, so the glyph is the fitting rather than the armour.
  customize: stroke(
    `<circle cx="12" cy="5.4" r="2.5"/>` +
      `<path d="M7.3 20.6c0-4.9.9-7.8 4.7-7.8s4.7 2.9 4.7 7.8" stroke-width="1.8"/>` +
      `<path d="M9.2 9.1 12 10.6l2.8-1.5" opacity="0.85"/>` +
      `<rect x="1.4" y="10.2" width="3.8" height="3.8" rx="1" opacity="0.6"/>` +
      `<rect x="18.8" y="10.2" width="3.8" height="3.8" rx="1" opacity="0.6"/>` +
      `<path d="M5.6 12.1h1.8M16.6 12.1h1.8" stroke-width="1.4" opacity="0.45"/>`
  ),

  // The lens crossing behind the body: the figure on its own axis, a lens
  // either side of it, and the arc the camera travels between the two. Drawn
  // symmetrically on purpose — the chip's own label says which side it is on
  // now, and a glyph that also tried to would be two answers to one question.
  shoulder: stroke(
    `<path d="M12 4.6v14.8" opacity="0.5"/>` +
      `<circle cx="4.6" cy="16.4" r="2.5"/>` +
      `<circle cx="19.4" cy="16.4" r="2.5"/>` +
      `<path d="M5.6 11.2a8.2 8.2 0 0 1 12.8 0" opacity="0.8"/>` +
      `<path d="M15.9 9.6 18.6 11.4 17.2 14.1" opacity="0.8"/>`
  ),

};

/**
 * The icon for an ability, as an element ready to append.
 *
 * Falls back to an empty span when an id has no drawing yet — a new move should
 * cost a missing glyph, not a HUD that fails to build.
 *
 * @param {string} id
 * @param {string} [className]
 */
export function createIcon(id, className = 'hud__icon') {
  const holder = document.createElement('span');
  holder.className = className;
  holder.innerHTML = ABILITY_ICONS[id] ?? '';
  return holder;
}
