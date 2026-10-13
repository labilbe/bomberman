/**
 * Merging several input sources for one and the same seat.
 *
 * A player sitting at the machine now has two ways of playing, and should not
 * have to declare one of them: they pick up the pad, they play on the pad; they
 * put it down and go back to the arrow keys, they play on the arrows. The choice
 * is made by playing, not in a menu.
 *
 * That is also why this function stands apart. Each source reads its own
 * hardware knowing nothing of the other, and nobody arbitrates inside the game
 * loop: there is only one place where the rule is written.
 */

/**
 * Combines several intents into one.
 *
 * The DIRECTION goes to the first source that declares one. The sources are
 * therefore passed in priority order, and the order only settles a case that
 * never happens for real: holding an arrow and pushing the stick at the same
 * time. A source at rest returns -1 and so lets the next one through.
 *
 * The PULSES, on the other hand, add up. They have already been consumed at
 * their source by the time we read them — that is `read`'s contract — so losing
 * one here would really lose a bomb. We cannot simply take those of the source
 * that won the direction.
 *
 * @param {...import('../engine/inputs.js').Input} sources
 * @returns {import('../engine/inputs.js').Input}
 */
export function merge(...sources) {
  let dir = -1;
  let drop = false;
  let detonate = false;
  let hold = false;

  for (const source of sources) {
    if (!source) continue;
    if (dir === -1 && source.dir !== -1 && source.dir !== undefined) dir = source.dir;
    drop = drop || source.drop === true;
    detonate = detonate || source.detonate === true;
    // Holding is a state, not a pulse, and one hand is enough to hold: a bomb
    // carried with the keyboard must not fall because the pad's button is up.
    hold = hold || source.hold === true;
  }

  return { dir, drop, detonate, hold };
}
