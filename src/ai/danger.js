/**
 * Danger map and safe paths: the heart of the artificial opponent.
 *
 * Everything is pure, with no DOM, no clock and no randomness. That is not an
 * affectation: these functions run INSIDE THE RELAY, which simulates the arena,
 * and they must give the same result as in the page in solo play. One single
 * call to the browser's random source here, and two machines would see two
 * different bots.
 *
 * The map gives, for each cell, the number of STEPS before it burns, or `SAFE`
 * when nothing threatens it. A bot never consults the bombs directly:
 * everything it needs to know about danger is in that array, and that is what
 * saves it from reasoning about ranges and walls on every decision.
 */

import { COLS, ROWS, VECTORS, FLAME_STEPS } from '../engine/constants.js';
import { index, cellAt, isFree, cellOnAxis } from '../engine/grid.js';
import { ray } from '../engine/explosion.js';

/** Value of a cell nothing threatens. */
export const SAFE = 30000;

/**
 * Danger map of the state.
 *
 * Chains are not simulated: a bomb caught in another's explosion will go off
 * sooner than its fuse says. So we take the minimum of the fuses covering the
 * cell, which sometimes underestimates the danger by a step or two. Simulating
 * chains would cost a queue per call, sixty times a second and per bot, for a
 * caution the bot does not need: it already keeps a safety margin.
 *
 * @param {import('../engine/state.js').State} state
 * @returns {Int32Array}
 */
export function dangerMap(state) {
  const map = new Int32Array(COLS * ROWS).fill(SAFE);

  for (const flame of state.flames) {
    const i = index(flame.cx, flame.cy);
    if (i >= 0 && i < map.length) map[i] = 0;
  }

  for (const bomb of state.bombs) {
    // A trigger bomb has no fuse: it can go off this very instant, at the whim
    // of a finger. So we count it as zero, that is at maximum danger. That is
    // not excessive caution, it is the truth of the game: there is no delay a
    // bot could claim.
    const fuse = bomb.fuse === null ? 0 : Math.max(0, bomb.fuse);
    const centre = index(bomb.cx, bomb.cy);
    if (map[centre] > fuse) map[centre] = fuse;
    for (const v of VECTORS) {
      for (let step = 1; step <= bomb.range; step += 1) {
        const x = bomb.cx + v.dx * step;
        const y = bomb.cy + v.dy * step;
        if (!isFree(cellAt(state, x, y))) break;
        const i = index(x, y);
        if (map[i] > fuse) map[i] = fuse;
      }
    }
  }

  return map;
}

/**
 * The danger map as it would be if the bomber dropped a bomb now.
 *
 * It is the question the bot asks itself before every drop: "if I let this go
 * here, do I still have a way out?". Without it, a bot walls itself into a dead
 * end, and that is the most visible flaw a Bomberman AI can have.
 *
 * @param {import('../engine/state.js').State} state
 * @param {import('../engine/state.js').Player} player
 * @param {Int32Array} base
 * @param {number} fuse
 */
export function dangerWithBomb(state, player, base, fuse) {
  const map = base.slice();
  const cx = cellOnAxis(player.x);
  const cy = cellOnAxis(player.y);
  const centre = index(cx, cy);
  if (map[centre] > fuse) map[centre] = fuse;
  for (const v of VECTORS) {
    for (let step = 1; step <= player.range; step += 1) {
      const x = cx + v.dx * step;
      const y = cy + v.dy * step;
      if (!isFree(cellAt(state, x, y))) break;
      const i = index(x, y);
      if (map[i] > fuse) map[i] = fuse;
    }
  }
  return map;
}

/** Can a bot walk onto this cell? Bombs block, all of them. */
export function open(state, cx, cy) {
  if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return false;
  if (!isFree(cellAt(state, cx, cy))) return false;
  for (const bomb of state.bombs) {
    if (bomb.cx === cx && bomb.cy === cy) return false;
  }
  return true;
}

/**
 * Breadth-first walk from a bomber's cell.
 *
 * Returns, for every reachable cell, the distance in cells and the FIRST
 * direction to take to get there. Keeping the first direction rather than the
 * whole path is enough: the bot decides again before it has finished walking.
 *
 * The walk is done in the order of the directions in `VECTORS`, always the same:
 * at equal distance, two machines pick the same cell.
 *
 * `avoid` makes threatened cells impassable. It is essential as soon as we look
 * for a destination rather than an escape: without it, a bot that has taken
 * cover sets off towards a brick by CROSSING BACK through its own bomb's blast,
 * and arrives just in time to die. That was the cause of almost every drawn
 * round.
 *
 * @param {import('../engine/state.js').State} state
 * @param {number} fromX
 * @param {number} fromY
 * @param {{ avoid?: Int32Array }} options
 * @returns {{ distance: Int32Array, first: Int8Array }}
 */
export function walk(state, fromX, fromY, { avoid = null } = {}) {
  const distance = new Int32Array(COLS * ROWS).fill(-1);
  const first = new Int8Array(COLS * ROWS).fill(-1);
  const queue = [index(fromX, fromY)];
  distance[queue[0]] = 0;

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const cx = current % COLS;
    const cy = Math.floor(current / COLS);
    for (let dir = 0; dir < VECTORS.length; dir += 1) {
      const x = cx + VECTORS[dir].dx;
      const y = cy + VECTORS[dir].dy;
      if (!open(state, x, y)) continue;
      const next = index(x, y);
      if (distance[next] >= 0) continue;
      if (avoid !== null && avoid[next] < SAFE) continue;
      distance[next] = distance[current] + 1;
      first[next] = distance[current] === 0 ? dir : first[current];
      queue.push(next);
    }
  }

  return { distance, first };
}

/**
 * Looks for the nearest way out of danger.
 *
 * A shelter is a cell NOTHING threatens. That is the nuance that decides how
 * good the bot is: the first version accepted any cell you reach before the
 * fire, which included the cell you are standing on — you have just dropped a
 * bomb there, its fuse lasts two and a half seconds, so you "arrive in time".
 * The bot sat on its own bomb and died. Seven deaths out of ten came from that.
 *
 * Failing a shelter, we return a fallback: the reachable cell that will burn
 * latest. It does not always save you, but buying time beats not moving, and a
 * chain may well clear the way in the meantime.
 *
 * @param {import('../engine/state.js').State} state
 * @param {import('../engine/state.js').Player} player
 * @param {Int32Array} danger
 * @returns {{ dir: number, distance: number, safe: boolean } | null}
 */
export function escape(state, player, danger) {
  const cx = cellOnAxis(player.x);
  const cy = cellOnAxis(player.y);
  const stepsPerCell = Math.ceil(1024 / Math.max(1, player.speed));

  // A DATED walk: each cell carries the step at which we would get there. It
  // fixes this bot's most expensive flaw — it used to look for the nearest
  // shelter without ever checking that it got there in time, nor that the path
  // was still walkable. A bot that had just dropped therefore set off along its
  // own blast and exploded on the way: one death in five.
  //
  // We only CROSS a threatened cell if we leave it before it burns, and we only
  // STOP on a cell nothing threatens.
  const distance = new Int32Array(COLS * ROWS).fill(-1);
  const first = new Int8Array(COLS * ROWS).fill(-1);
  const start = index(cx, cy);
  const queue = [start];
  distance[start] = 0;

  let shelter = null;
  let fallback = null;

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const ax = current % COLS;
    const ay = Math.floor(current / COLS);

    for (let dir = 0; dir < VECTORS.length; dir += 1) {
      const x = ax + VECTORS[dir].dx;
      const y = ay + VECTORS[dir].dy;
      if (!open(state, x, y)) continue;
      const next = index(x, y);
      if (distance[next] >= 0) continue;

      const stepsTaken = distance[current] + 1;
      const arrival = stepsTaken * stepsPerCell;
      // To get through, the cell must be left before it lights up.
      if (danger[next] < SAFE && arrival + stepsPerCell >= danger[next]) continue;

      distance[next] = stepsTaken;
      first[next] = distance[current] === 0 ? dir : first[current];
      queue.push(next);

      if (danger[next] >= SAFE) {
        // The breadth-first walk yields cells by increasing distance: the first
        // safe cell met is the nearest.
        if (shelter === null) shelter = { dir: first[next], distance: stepsTaken, safe: true };
      } else if (danger[next] > arrival + FLAME_STEPS
        && (fallback === null || danger[next] > fallback.delay)) {
        fallback = { dir: first[next], distance: stepsTaken, safe: false, delay: danger[next] };
      }
    }

    if (shelter) break;
  }

  if (shelter) return shelter;
  if (fallback) return { dir: fallback.dir, distance: fallback.distance, safe: false };
  return null;
}

/**
 * Is the cell in this bomb's blast?
 *
 * We go through `ray`, which is the engine's definition, rather than redoing the
 * walk: the shape of a blast has already changed once — the brick's cell is no
 * longer part of it — and a second version would have lied from that day on, by
 * making a bot flee a cell where it was no longer at risk.
 *
 * @param {import('../engine/state.js').State} state
 * @param {import('../engine/state.js').Bomb} bomb
 */
export function blastCovers(state, bomb, cx, cy) {
  if (bomb.cx === cx && bomb.cy === cy) return true;
  for (let dir = 0; dir < VECTORS.length; dir += 1) {
    for (const [x, y] of ray(state, bomb.cx, bomb.cy, dir, bomb.range).cells) {
      if (x === cx && y === cy) return true;
    }
  }
  return false;
}
