/**
 * What the player can *do*, in one list.
 *
 * Three things read this and nothing else describes a move: `core/Input.js`
 * builds its key map from the entries marked `attack` (so a rebind here rebinds
 * the game), `ui/ActionHUD.js` draws the panels along the bottom of the screen
 * from all of them, and `core/App.js` resolves a state per `id` each frame.
 *
 * `id` is the contract between the three. For an attack it is also the
 * `configKey` its `Attack` instance reads out of `config/settings.js` — one
 * word that names the clip, its tuning block, its glyph in `ui/icons.js` and
 * its chip in the HUD.
 *
 * `category` is the second contract, and it is a statement about *kind*, not
 * about layout: a technique is something the body does with the sword and the
 * feet, an ability is something rarer that the body alone could not, and a buff
 * is not thrown at anybody at all — it is called down on yourself and carried.
 * The HUD gives each kind its own panel and its own heading so the difference
 * is visible before any of it is read — see `ui/ActionHUD.js`.
 */

/**
 * @typedef {object} Category
 * @property {string} id matches an ability's `category`
 * @property {string} label the panel's heading
 * @property {string} kanji the mark beside it
 * @property {'top'|'main'} row which band of the HUD the panel sits in
 */

/**
 * The kinds of thing a move can be, in the order their panels are laid out.
 *
 * @type {Record<string, Category>}
 */
export const CATEGORIES = {
  /**
   * Getting somewhere, and getting dressed. Quiet, above the rest — neither is
   * a way to hurt anyone, and neither should compete with the panels that are.
   */
  movement: { id: 'movement', label: '이동', kanji: '歩', row: 'top' },
  /** Sword and body. The three the fight is actually fought with. */
  technique: { id: 'technique', label: '기술', kanji: '技', row: 'main' },
  /**
   * The rarer things — asking for something rather than doing it.
   *
   * Both of them (`swordCombo`, `voidBeam`) are thrown at whoever is in front
   * of you exactly as a technique is, because what makes a move an ability here
   * is *what it calls on*, not how it is aimed.
   */
  ability: { id: 'ability', label: '능력', kanji: '術', row: 'main' },
  /**
   * The boons: called down on yourself and then carried for a while.
   *
   * The other panels are all a thing you do *to* somebody, and these two are
   * the only moves with nowhere to point them — what they change is the body
   * throwing them, and they keep changing it for ten seconds after the key is
   * let go. That is a different kind of move from "a thing that happens now",
   * so it is a panel of its own: while one is up its chip is a countdown, and a
   * player scanning for "how long have I got" should be reading one place.
   */
  buff: { id: 'buff', label: '가호', kanji: '加', row: 'main' }
};

/**
 * @typedef {object} Ability
 * @property {string} id matches the settings block, the `Attack` config key and the icon
 * @property {keyof typeof CATEGORIES} category which panel it is drawn in
 * @property {string} label what the chip says
 * @property {string} hotkey what the chip's key cap says
 * @property {string} code the physical `KeyboardEvent.code` behind it
 * @property {string} note one line, for the chip's tooltip
 * @property {boolean} [attack] buffered as an edge and routed to an `Attack`
 * @property {boolean} [press] the chip is a control as well as a readout — it
 *   can be clicked, and the click means the same as the key. Only for the ones
 *   that are a plain switch: anything aimed has to be aimed, and a button
 *   cannot say where.
 */

/** @type {Ability[]} */
export const ABILITIES = [
  {
    id: 'leap',
    category: 'movement',
    label: '도약',
    hotkey: 'Space',
    code: 'Space',
    note: '달리는 중에는 멀리뛰기, 그보다 느리면 제자리 점프.'
  },
  {
    id: 'weapon',
    category: 'movement',
    // Rewritten each frame with the name of what is actually in the hand, so
    // the chip is the answer to "what am I holding" as well as the way to
    // change it — see `ActionHUD#setLabel`.
    label: '라이플',
    hotkey: '1',
    code: 'Digit1',
    note: '무기를 바꿉니다. 손에 든 무기가 사라지고 다른 무기가 나타납니다.',
    press: true
  },
  {
    id: 'shoulder',
    category: 'movement',
    // Rewritten each frame with the side the lens is actually on, so the chip
    // answers "which shoulder am I over" as well as changing it.
    label: '오른쪽 어깨',
    hotkey: 'H',
    code: 'KeyH',
    note:
      '카메라를 반대 어깨로 넘깁니다. 라이플을 든 상태에서만 의미가 있습니다. ' +
      '가운데 마우스 버튼으로도 됩니다.',
    press: true
  },
  {
    id: 'customize',
    category: 'movement',
    label: '캐릭터',
    hotkey: 'Tab',
    code: 'Tab',
    note: '장비 스튜디오: 외형을 보고 꾸미는 별도 화면.'
  },
];

/** The attacks, in the order a press is offered to them. */
export const ATTACK_ABILITIES = ABILITIES.filter((ability) => ability.attack);
