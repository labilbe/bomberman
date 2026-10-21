/**
 * The arena closing in, once the round's time is up.
 *
 * Atomic Bomberman calls it the ENCLOSEMENT, and its options let you choose how
 * far it goes — "None", "A Little", "A Lot", "All the way!". This is all the
 * way: blocks fall one after another along a spiral that starts at the top left
 * of the playable area and turns inwards until it reaches the middle.
 *
 * WHAT IT IS FOR. A round between two careful bombers can last for ever: each
 * holds a corner, neither has to come out, and nothing in the rules obliges
 * them to meet. The closing is that obligation. It does not decide the round —
 * it takes the ground away until the round decides itself, which is a different
 * thing, and the reason the time limit is not simply a draw.
 *
 * Nothing here draws from the RNG, and nothing depends on who is playing: at a
 * given step, the arena has closed exactly as far on every machine. That is
 * what lets it run inside the relay and in the page without a word passing
 * between them beyond the events it records.
 */

import { ROUND_TIME_STEPS, ENCLOSURE_STEPS, SOLID } from './constants.js';
import { ENCLOSURE } from './arena.js';
import { index, setCell, boxOnCell } from './grid.js';
import { record } from './state.js';
import { isVisible } from './bonus.js';
import { kill, BY_WALL } from './explosion.js';

/**
 * How many blocks should have fallen by a given step.
 *
 * READ OFF THE CLOCK rather than counted in the state, and that is deliberate:
 * a counter is one more field to clone, to serialise and to put back after a
 * reconnection, and a single missed increment would leave two arenas closing at
 * different rates. A step gives the same answer to everybody, for ever.
 *
 * @param {number} step
 * @returns {number} between 0 and the whole spiral
 */
export function wallsDue(step) {
  if (step <= ROUND_TIME_STEPS) return 0;
  const fallen = Math.floor((step - ROUND_TIME_STEPS - 1) / ENCLOSURE_STEPS) + 1;
  return Math.min(ENCLOSURE.length, fallen);
}

/** Seconds left before the arena starts closing, for the dashboard. */
export function timeLeft(step) {
  return Math.max(0, ROUND_TIME_STEPS - step);
}

/** Has the arena started closing? */
export function closing(step) {
  return step > ROUND_TIME_STEPS;
}

/**
 * Drops one block, and takes whatever was on that cell with it.
 *
 * THE BLOCK CRUSHES WHOEVER IT LANDS ON, measured on the COLLISION box and not
 * on the smaller deadly box the flames use. The two are different questions: a
 * flame asks "did you walk into the fire", and half a foot in the doorway is
 * not walking in. A block asks "is there anything of you under me" — and a
 * bomber whose box overlaps a cell that has just turned to wall has to die,
 * because the alternative is a bomber standing inside a wall, unable to move in
 * any direction and waiting for a flame that can no longer reach them.
 *
 * @param {import('./state.js').State} state
 * @param {number} cx
 * @param {number} cy
 */
function dropWall(state, cx, cy) {
  setCell(state, cx, cy, SOLID);

  // The bombers first: killing frees the bomb a dying one was carrying onto
  // this very cell, and the sweep below then takes it with the rest.
  for (const player of state.players) {
    if (!player.alive) continue;
    if (!boxOnCell(player.x, player.y, cx, cy)) continue;
    kill(state, player, BY_WALL);
  }

  // A bomb under a block is GONE, not set off. Letting it burn would send
  // flames out of a cell that is now solid wall — through the block that just
  // buried it — and nothing on screen would explain where the fire came from.
  // Bombs held in a carrier's hands are left alone: they are above the ground,
  // and their carrier has just been crushed anyway, which drops them.
  for (let i = state.bombs.length - 1; i >= 0; i -= 1) {
    const bomb = state.bombs[i];
    if (bomb.cx !== cx || bomb.cy !== cy) continue;
    if (bomb.held !== null) continue;
    state.bombs.splice(i, 1);
  }

  // And the pack lying there, hidden under a brick or out in the open.
  const i = index(cx, cy);
  if (state.items[i] !== 0) {
    const shown = isVisible(state.items[i]);
    state.items[i] = 0;
    // Only an item somebody could SEE is worth announcing: the client only ever
    // knew about the visible ones, and telling it about a pack buried under a
    // brick would be telling it what was hidden there.
    if (shown) record(state, ['itemgone', cx, cy]);
  }

  record(state, ['wall', cx, cy]);
}

/**
 * Closes the arena by however much this step owes.
 *
 * The difference between two consecutive steps, so that a step skipped while
 * catching up still lays every block it should: the relay advances several
 * steps in a row after a hitch, and an arena that closed one cell per CALL
 * rather than per step would fall behind its own clock.
 *
 * @param {import('./state.js').State} state
 */
export function closeArena(state) {
  const due = wallsDue(state.step);
  for (let i = wallsDue(state.step - 1); i < due; i += 1) {
    dropWall(state, ENCLOSURE[i][0], ENCLOSURE[i][1]);
  }
}
