/**
 * The artificial opponent.
 *
 * `decide` is pure: same state + same memory = same intent, and it never
 * touches the state it is given. That is what lets it run in the relay (where
 * the online bots live), in the page in solo play, and under `node --test` with
 * no graphical arena.
 *
 * Bots run in the relay and not in a tab, unlike those of the Tetris project
 * which opened a real WebSocket. Three reasons: the simulation is in the relay,
 * so a bot-client would pay a round trip per decision — 60 to 100 ms of extra
 * reaction time, in a game where you die for less than that; it would live in
 * one player's tab, who by closing it would freeze three opponents mid-round;
 * and each would count as a connection.
 *
 * Four rules, in this order, and that is the whole behaviour:
 *   1. my cell is going to burn      -> flee
 *   2. an opponent is in range and I have a way out -> drop
 *   3. a brick is next to me and I have a way out   -> drop
 *   4. otherwise                     -> walk towards the most interesting cell
 *
 * The rule that matters is the "and I have a way out" condition: it is what
 * prevents the most visible flaw of a Bomberman AI, the one that walls itself
 * into a dead end.
 */

import { COLS, VECTORS, FUSE_STEPS, FLAME_STEPS, DOUBLE_TAP_STEPS } from '../engine/constants.js';
import { index, cellAt, isFree, isBrick, cellOnAxis, touchedCells } from '../engine/grid.js';
import { isVisible } from '../engine/bonus.js';
import { EMPTY_INPUT } from '../engine/inputs.js';
import {
  dangerMap,
  dangerWithBomb,
  walk,
  escape,
  open,
  blastCovers,
  SAFE,
} from './danger.js';

/**
 * Steps between two decisions, when nothing is threatening.
 *
 * A bot does not decide again on every step: it would hold plans a tenth of a
 * cell long. But the exact value shows on screen — it is what makes a bot look
 * settled or jittery — and it was set by measurement, over 150 four-bot rounds
 * and 50 complete matches, rather than by judgement:
 *
 *    4 steps   6.9 direction changes/s   jittery; 2 matches in 50 bog down
 *    8 steps   4.7 /s                    no bogging down in 50
 *   12 steps   3.5 /s                    calmer, but 1 match bogs down
 *   16 steps   2.9 /s                    and deaths on one's own bomb rise
 *
 * Eight is the compromise: almost twice as calm as before, without a match
 * getting stuck. Beyond that, two cautious survivors circle each other without
 * ever committing, and the round runs out.
 *
 * Mind what that figure MEASURES: two thirds of the remaining direction changes
 * are the normal "I drop against a brick and back off" gesture, not hesitation.
 */
export const REFLEX_STEPS = 8;

/** Levels: how far the bot looks, hence how strong it is. */
export const LEVELS = {
  quiet: { sight: 6, aggression: 0 },
  normal: { sight: 10, aggression: 1 },
  nasty: { sight: 18, aggression: 2 },
};

/** @typedef {{ dir: number, drop: boolean, since: number }} Memory */

/** A fresh memory. */
export function createMemory() {
  return { dir: -1, drop: false, since: -999 };
}

/** Is there a brick to break in one of the four directions, within range? */
function brickInRange(state, player) {
  const cx = cellOnAxis(player.x);
  const cy = cellOnAxis(player.y);
  for (const v of VECTORS) {
    for (let step = 1; step <= player.range; step += 1) {
      const tile = cellAt(state, cx + v.dx * step, cy + v.dy * step);
      if (isBrick(tile)) return true;
      if (!isFree(tile)) break;
    }
  }
  return false;
}

/** Is a living opponent lined up, within range, with no wall between us? */
function opponentInRange(state, player) {
  const cx = cellOnAxis(player.x);
  const cy = cellOnAxis(player.y);
  for (const v of VECTORS) {
    for (let step = 1; step <= player.range; step += 1) {
      const x = cx + v.dx * step;
      const y = cy + v.dy * step;
      if (!isFree(cellAt(state, x, y))) break;
      for (const other of state.players) {
        if (other.place === player.place || !other.alive) continue;
        if (cellOnAxis(other.x) === x && cellOnAxis(other.y) === y) return true;
      }
    }
  }
  return false;
}

/** Appeal of a cell: a bonus beats a brick, which beats nothing. */
function appeal(state, player, i, level) {
  let value = 0;
  if (isVisible(state.items[i])) value += 60;

  const cx = i % COLS;
  const cy = Math.floor(i / COLS);
  for (const v of VECTORS) {
    if (isBrick(cellAt(state, cx + v.dx, cy + v.dy))) {
      value += 14;
      break;
    }
  }

  if (level.aggression > 0) {
    for (const other of state.players) {
      if (other.place === player.place || !other.alive) continue;
      const distance = Math.abs(cellOnAxis(other.x) - cx) + Math.abs(cellOnAxis(other.y) - cy);
      if (distance <= 2) value += 10 * level.aggression;
    }
  }

  return value;
}

/**
 * Can a bomb be dropped here without condemning oneself?
 *
 * We never drop without having checked that a cell out of the explosion stays
 * reachable before the end of the fuse.
 */
function wayOutAfterDrop(state, player, danger) {
  const projected = dangerWithBomb(state, player, danger, FUSE_STEPS);
  const way = escape(state, player, projected);
  // A fallback is not enough: we demand a cell NOTHING threatens, otherwise the
  // bot settles for backing one cell into its own blast.
  if (way === null || !way.safe) return false;
  const stepsPerCell = Math.ceil(1024 / Math.max(1, player.speed));
  return way.distance * stepsPerCell + FLAME_STEPS < FUSE_STEPS;
}

/**
 * Decides a bot's intent.
 *
 * @param {import('../engine/state.js').State} state
 * @param {number} place
 * @param {Memory} memory
 * @param {{ level?: keyof typeof LEVELS }} options
 * @returns {{ input: import('../engine/inputs.js').Input, memory: Memory }}
 */
export function decide(state, place, memory = createMemory(), options = {}) {
  const player = state.players.find((candidate) => candidate.place === place);
  if (!player || !player.alive) {
    return { input: { ...EMPTY_INPUT }, memory: createMemory() };
  }

  // The trigger is decided APART from the movement, and adds to whatever the
  // rest of the function chooses. Pressing does not take the legs: a bot taking
  // cover can blow its bomb up in the same step, and that is exactly what a
  // player does.
  const choice = chooseMove(state, place, memory, options, player);
  if (wantsToDetonate(state, player)) choice.input.detonate = true;
  return choice;
}

/**
 * Does the bot set its bomb off from a distance, on this step?
 *
 * It waits until it is OUT of its own blast. Without that condition, a bot that
 * picks the trigger up kills itself on the first bomb: it drops it and presses
 * right after, since nothing else stops it — a trigger bomb has no fuse, hence
 * no delay to give it time to leave.
 *
 * We judge the OLDEST of its bombs, because that is the one the engine will blow
 * up. Judging another would mean deciding on one bomb and detonating a second
 * one, somewhere else.
 *
 * @param {import('../engine/state.js').State} state
 * @param {import('../engine/state.js').Player} player
 */
function wantsToDetonate(state, player) {
  // No guard on the reserve: it empties ON THE DROP, and a bomb already waiting
  // still obeys the button. Demanding a payload here left the bot planting its
  // last bomb and watching it wait until the end of the round — four bots never
  // finished each other off.

  let oldest = null;
  for (const bomb of state.bombs) {
    if (bomb.place !== player.place) continue;
    if (oldest === null || bomb.id < oldest.id) oldest = bomb;
  }
  // A fused bomb goes off by itself: we do not waste the trigger, and above all
  // we do not bring it forward while the bot may still be inside it.
  if (oldest === null || oldest.fuse !== null) return false;

  // We ask about EVERY cell the bomber's box bites into, and not only its
  // central cell. The engine kills on box overlap: a bomber whose centre has
  // just crossed the border still sticks well out over the previous cell.
  // Judged on its centre, the bot pressed a fraction of a second too early and
  // killed itself one time in four.
  for (const { cx, cy } of touchedCells(player.x, player.y)) {
    if (blastCovers(state, oldest, cx, cy)) return false;
  }
  return true;
}

/**
 * Chooses the movement and the drop. The trigger is decided by `decide`.
 *
 * @param {import('../engine/state.js').State} state
 * @param {number} place
 * @param {Memory} memory
 * @param {{ level?: keyof typeof LEVELS }} options
 * @param {import('../engine/state.js').Player} player
 * @returns {{ input: import('../engine/inputs.js').Input, memory: Memory }}
 */
function chooseMove(state, place, memory, options, player) {
  const level = LEVELS[options.level ?? 'normal'] ?? LEVELS.normal;
  const danger = dangerMap(state);
  const cx = cellOnAxis(player.x);
  const cy = cellOnAxis(player.y);
  const here = index(cx, cy);
  const threatened = danger[here] < SAFE;

  // Between two decisions we hold the course already chosen. The drop, on the
  // other hand, is never repeated: it is a pulse.
  //
  // EXCEPT when the cell is going to burn: fear does not look at the clock.
  // Separating the two is what lets a bot be slowed down without making it
  // suicidal — as long as the reaction delay applied to danger too, lengthening
  // it to calm the to-and-fro pushed deaths on one's own bomb back up to 17 %,
  // the bot no longer being allowed to react at the moment it should have.
  if (!threatened && state.step - memory.since < REFLEX_STEPS) {
    return {
      input: { dir: memory.dir, drop: false, detonate: false },
      memory,
    };
  }

  // 1. My cell is going to burn: everything else waits.
  if (threatened) {
    const way = escape(state, player, danger);
    const dir = way === null ? memory.dir : way.dir;
    const next = { dir, drop: false, since: state.step };
    return { input: { dir, drop: false, detonate: false }, memory: next };
  }

  // 2 and 3. Drop, if there is something to break and a way out is left.
  //
  // We do not require the bomber to be centred on its cell: the engine drops the
  // bomb under the character's centre, and its own bomb does not block it as
  // long as it stands on it. Requiring centring prevented any drop in practice,
  // the bot being almost always in transit at the moment it decides.
  //
  // Two drops close together mean BURST to the engine: a bot dropping again
  // straight away would empty its magazine ahead of itself instead of sowing its
  // bombs one by one. So it lets the double-tap window pass — a handful of steps
  // — before asking for another one.
  const justDropped =
    player.droppedAt !== null && state.step - player.droppedAt <= DOUBLE_TAP_STEPS;
  if (!justDropped && (opponentInRange(state, player) || brickInRange(state, player))) {
    if (wayOutAfterDrop(state, player, danger)) {
      const projected = dangerWithBomb(state, player, danger, FUSE_STEPS);
      const way = escape(state, player, projected);
      const dir = way === null ? memory.dir : way.dir;
      return {
        input: { dir, drop: true, detonate: false },
        memory: { dir, drop: true, since: state.step },
      };
    }
  }

  // 4. Walk towards the most interesting cell, among those that are safe.
  //
  // The current cell is excluded from the search. Without that it won almost
  // every time — same appeal as its neighbours, but zero distance — the bot had
  // no target, fell back on exploration and went to and fro between two cells
  // until the end of the round.
  //
  // The walk avoids threatened cells: the destination AND the path must be safe,
  // otherwise the bot sets off towards a brick through its own blast.
  const { distance, first } = walk(state, cx, cy, { avoid: danger });

  let best = 0;
  let choice = -1;
  for (let i = 0; i < distance.length; i += 1) {
    if (distance[i] <= 0 || distance[i] > level.sight) continue;
    const score = appeal(state, player, i, level) - distance[i];
    if (score > best) {
      best = score;
      choice = i;
    }
  }

  let dir = choice >= 0 ? first[choice] : -1;
  if (dir < 0) {
    // Nothing to do nearby: we carry straight on as long as the way is open,
    // and turn otherwise. Holding the course is what avoids oscillation: a bot
    // that picks its direction again on every decision goes nowhere.
    const free = (v) =>
      v !== null && open(state, cx + v.dx, cy + v.dy) && danger[index(cx + v.dx, cy + v.dy)] >= SAFE;

    dir = memory.dir;
    if (!free(VECTORS[dir] ?? null)) {
      dir = -1;
      for (let candidate = 0; candidate < VECTORS.length; candidate += 1) {
        // Offsetting by place number keeps four bots stuck in the same spot from
        // all choosing the same way out, without calling on randomness.
        const attempt = (candidate + place) % VECTORS.length;
        if (free(VECTORS[attempt])) {
          dir = attempt;
          break;
        }
      }
    }
  }

  return {
    input: { dir, drop: false, detonate: false },
    memory: { dir, drop: false, since: state.step },
  };
}

/**
 * Builds a pilot ready to plug into a transport: it keeps its own memory and
 * only presents `(state, place) -> input`.
 *
 * @param {{ level?: keyof typeof LEVELS }} options
 */
export function createPilot(options = {}) {
  let memory = createMemory();
  return (state, place) => {
    const result = decide(state, place, memory, options);
    memory = result.memory;
    return result.input;
  };
}
