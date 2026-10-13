/**
 * Explosions, chains, bricks, burnt bonuses, deaths.
 *
 * Two decisions drive this module.
 *
 * 1. A chain resolves ENTIRELY within the same step, through a queue. That is
 *    Atomic Bomberman's behaviour, and above all it is the only one that does
 *    not depend on the order of the bomb array: spreading it over several steps
 *    would make the result depend on drop order, hence on everyone's latency.
 *
 * 2. A bonus is only destroyed by a FRESH flame, never by a flame that was
 *    already there. Without that nuance, a bonus revealed by an explosion would
 *    at once be burnt by the flame that just uncovered it, and breaking a brick
 *    would never pay off.
 */

import {
  FLAME_STEPS,
  FALL_STEPS,
  HALF_DEADLY,
  VECTORS,
  EMPTY,
  BRICK,
  COLS,
  ROWS,
  BOMBS_AT_START,
  RANGE_AT_START,
  BASE_SPEED,
  SPEED_STEP,
  TRIGGERS_PER_BONUS,
} from './constants.js';
import { cellAt, setCell, index, isFree, boxOnCell, cellOnAxis } from './grid.js';
import { record } from './state.js';
import { draw } from './rng.js';
import { bombAt, restoreFuses, carriedBy } from './bombs.js';
import { isHidden, isVisible, codeOf, apply, BONUS_NAMES, BONUS_CODES } from './bonus.js';

/** Causes of death, as they go out on the network. */
export const BY_FLAME = 0;
export const BY_LEAVING = 1;
export const BY_START = 2;

/**
 * Actual reach of one branch of the explosion.
 *
 * Stops at the first hard wall, destroys ONE brick and stops there. A flame
 * going through two bricks would make every shelter illusory.
 *
 * A bonus lying on the ground stops the branch the same way: it is destroyed,
 * and nothing goes past it. The difference from a brick is that ITS cell does
 * burn: the bonus does not block the way, you can stand on it, so you can die
 * on it.
 *
 * THE BRICK'S CELL IS NOT SET ALIGHT, and that is a rule of the game, not a
 * detail. The brick ABSORBS the blast: it falls, and the fire does not take its
 * place. Setting it alight gave a cell that was both EMPTY and deadly for half
 * a second — a player sheltered behind the brick who walked towards the
 * explosion stepped into the hole just opened and died, although they were
 * precisely on the right side of the shelter. Atomic Bomberman does not punish
 * that, and it is right: the shelter did its job.
 *
 * What you see on that cell while it burns is therefore not an engine flame but
 * the animation of the falling brick, fired by the `brick` event — and in Atomic
 * Bomberman that animation is called, aptly, "flame brick". The fire is drawn
 * there, it is not deadly there.
 *
 * @param {import('./state.js').State} state
 * @returns {{ cells: number[][], brick: number[] | null, bombs: number[] }}
 */
export function ray(state, cx, cy, dir, range) {
  const v = VECTORS[dir];
  const cells = [];
  const bombs = [];
  let brick = null;

  for (let i = 1; i <= range; i += 1) {
    const x = cx + v.dx * i;
    const y = cy + v.dy * i;
    const tile = cellAt(state, x, y);
    if (tile === BRICK) {
      brick = [x, y];
      break;
    }
    if (!isFree(tile)) break;
    cells.push([x, y]);
    const bomb = bombAt(state, x, y);
    if (bomb !== null) bombs.push(bomb.id);
    // A BONUS ON THE GROUND STOPS THE BLAST, like a brick. It burns — its cell
    // is set alight, since it stays walkable — but the branch goes no further.
    // Without that, a bonus on the ground was destroyed while covering nothing,
    // and two players separated by a bonus were exposed to each other although a
    // plain wall of bricks would have sheltered them.
    if (isVisible(state.items[index(x, y)])) break;
  }

  return { cells, brick, bombs };
}

/**
 * Lights, or relights, a flame on a cell.
 *
 * The flame remembers the PLACE of whoever dropped the bomb. It serves no rule —
 * nothing depends on who lit what — but Atomic Bomberman colours the explosion
 * in the player's colours, and that is how you see who has just killed you. The
 * renderer could not guess it: all it sees is burning cells.
 *
 * A cell already on fire keeps its first owner. At the instant two blasts meet,
 * the choice is arbitrary; making it stable at least keeps the cell from
 * flickering between two colours.
 */
function light(state, cx, cy, place, fresh) {
  const existing = state.flames.find((flame) => flame.cx === cx && flame.cy === cy);
  if (existing) {
    existing.left = FLAME_STEPS;
  } else {
    state.flames.push({ cx, cy, left: FLAME_STEPS, place });
  }
  fresh.push([cx, cy]);
}

/**
 * Makes a bomb explode: flames, bricks, and bombs to chain.
 *
 * @param {import('./state.js').State} state
 * @param {import('./state.js').Bomb} bomb
 * @param {number[]} queue ids of the bombs to handle next
 * @param {number[][]} fresh newly lit cells, for the bonuses
 * @param {number[][]} bricks destroyed bricks, to reveal afterwards
 */
export function explode(state, bomb, queue, fresh, bricks) {
  const rank = state.bombs.indexOf(bomb);
  if (rank >= 0) state.bombs.splice(rank, 1);

  const owner = state.players.find((player) => player.place === bomb.place);
  if (owner) owner.dropped = Math.max(0, owner.dropped - 1);

  // The permission to walk through this bomb dies with it: its id will be
  // handed out again, and would then apply to somebody else's bomb.
  for (const player of state.players) {
    if (player.onBomb === bomb.id) player.onBomb = null;
  }

  light(state, bomb.cx, bomb.cy, bomb.place, fresh);

  const lengths = [0, 0, 0, 0];
  for (let dir = 0; dir < 4; dir += 1) {
    const branch = ray(state, bomb.cx, bomb.cy, dir, bomb.range);
    lengths[dir] = branch.cells.length;
    for (const [x, y] of branch.cells) light(state, x, y, bomb.place, fresh);
    if (branch.brick) fell(state, branch.brick[0], branch.brick[1]);
    for (const id of branch.bombs) queue.push(id);
  }

  record(state, [
    'boom',
    bomb.id,
    bomb.cx,
    bomb.cy,
    lengths[0],
    lengths[1],
    lengths[2],
    lengths[3],
  ]);
}

/**
 * Brings a brick down: it falls, but it still blocks.
 *
 * THE CELL IS NOT EMPTIED NOW. It stays BRICK for the whole fall, hence
 * impassable, and that fixes an inaccuracy: the brick used to disappear at the
 * instant of the explosion and the animation was only scenery painted over
 * nothing. You walked through a brick you could still see falling, which Atomic
 * Bomberman does not allow.
 *
 * A brick already coming down is not felled twice: a second blast reaching it
 * during its fall stops there — it is still present — but restarts neither its
 * animation nor its countdown.
 */
function fell(state, cx, cy) {
  if (state.rubble.some((debris) => debris.cx === cx && debris.cy === cy)) return;
  state.rubble.push({ cx, cy, left: FALL_STEPS });
  record(state, ['brick', cx, cy]);
}

/**
 * Brings the bricks down by one step, and empties those that have finished.
 *
 * It is HERE that the cell opens, and that the bonus hidden underneath shows
 * itself. Revealing it earlier would have made it appear under a brick still
 * standing.
 *
 * Writing the cell is the ONLY write in a brick's life cycle, so the version
 * counter only moves by one per brick — which the client can reproduce without
 * asking for the whole grid.
 *
 * @param {import('./state.js').State} state
 */
export function ageRubble(state) {
  for (let i = state.rubble.length - 1; i >= 0; i -= 1) {
    const debris = state.rubble[i];
    debris.left -= 1;
    if (debris.left > 0) continue;
    state.rubble.splice(i, 1);
    setCell(state, debris.cx, debris.cy, EMPTY);
    record(state, ['brickgone', debris.cx, debris.cy]);
    revealBonuses(state, [[debris.cx, debris.cy]]);
  }
}

/**
 * Resolves a chain of explosions until it runs out.
 *
 * The set of bombs already handled is essential: two touching bombs put each
 * other in the queue, and without it the loop would never stop.
 *
 * @param {import('./state.js').State} state
 * @param {import('./state.js').Bomb[]} initial
 * @returns {{ fresh: number[][], bricks: number[][] }}
 */
export function resolveChain(state, initial) {
  const fresh = [];
  const bricks = [];
  const seen = new Set();
  const queue = initial.map((bomb) => bomb.id);

  while (queue.length > 0) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const bomb = state.bombs.find((candidate) => candidate.id === id);
    if (!bomb) continue;
    explode(state, bomb, queue, fresh, bricks);
  }

  return { fresh, bricks };
}

/**
 * Destroys the visible bonuses reached by a fresh flame.
 *
 * @param {import('./state.js').State} state
 * @param {number[][]} fresh
 */
export function burnItems(state, fresh) {
  for (const [cx, cy] of fresh) {
    const i = index(cx, cy);
    if (!isVisible(state.items[i])) continue;
    state.items[i] = 0;
    record(state, ['itemgone', cx, cy]);
  }
}

/**
 * Reveals the bonuses hidden under the bricks that have just fallen.
 *
 * Called AFTER `burnItems`: that order, and that order alone, is what makes a
 * bonus survive the explosion that uncovers it.
 *
 * @param {import('./state.js').State} state
 * @param {number[][]} bricks
 */
export function revealBonuses(state, bricks) {
  for (const [cx, cy] of bricks) {
    const i = index(cx, cy);
    if (!isHidden(state.items[i])) continue;
    const code = codeOf(state.items[i]);
    state.items[i] = code;
    record(state, ['item', cx, cy, BONUS_NAMES[code]]);
  }
}

/**
 * Kills every bomber a flame touches.
 *
 * A full sweep, not "the first one found": every death of the step is marked
 * before any conclusion is drawn from it. Without that, "the last one to die
 * wins" would depend on the order of the player array — the classic, invisible
 * bug of Bomberman clones.
 *
 * @param {import('./state.js').State} state
 */
export function burnPlayers(state) {
  for (const player of state.players) {
    if (!player.alive) continue;
    for (const flame of state.flames) {
      // The DEADLY box, smaller than the collision one: you die on entering the
      // fire, not on coming near it.
      if (!boxOnCell(player.x, player.y, flame.cx, flame.cy, HALF_DEADLY)) continue;
      kill(state, player, BY_FLAME);
      break;
    }
  }
}

/**
 * Everything a bomber picked up, as bonus codes, one per item.
 *
 * We count the GAP from the starting kit, not the pickups: the engine does not
 * remember those, and the gap says exactly the same thing — three bombs when you
 * started with one means two bomb bonuses.
 */
function loot(player) {
  const codes = [];
  const add = (code, count) => {
    for (let i = 0; i < count; i += 1) codes.push(code);
  };
  add(BONUS_CODES.BOMB, player.bombs - BOMBS_AT_START);
  add(BONUS_CODES.FLAME, player.range - RANGE_AT_START);
  add(BONUS_CODES.SPEED, Math.round((player.speed - BASE_SPEED) / SPEED_STEP));
  if (player.kick) add(BONUS_CODES.KICK, 1);
  if (player.glove) add(BONUS_CODES.GLOVE, 1);
  if (player.jelly) add(BONUS_CODES.JELLY, 1);
  if (player.grab) add(BONUS_CODES.GRAB, 1);
  // One pack per part-used pack: three charges out of five left is still a
  // trigger, and giving it back whole is better than losing it.
  add(BONUS_CODES.TRIGGER, Math.ceil(player.triggers / TRIGGERS_PER_BONUS));
  return codes;
}

/**
 * Scatters a dead bomber's loot AT RANDOM ACROSS THE WHOLE ARENA.
 *
 * Not around the body: the bonuses would fall into the blast that has just
 * killed it, hence in the middle of a place nobody can reach, and the killer —
 * the only one present — would pick them all up on the way through. Spread at
 * random, they force a trip across the board to collect them, and whoever is
 * behind has as good a chance of finding one as whoever has just killed.
 *
 * The draw goes through the state's SEEDED GENERATOR, like the one for bricks
 * and hidden bonuses. The browser's randomness would have given the relay and
 * the replay two different arenas — which the engine has forbidden itself since
 * day one, and a test checks it by re-reading its sources.
 *
 * Cells ON FIRE are avoided: a bonus would survive there, since only a FRESH
 * flame burns, and you would see an untouched pack in the middle of the flames.
 * Whatever finds no room — a full arena — is lost.
 */
function scatter(state, player) {
  const codes = loot(player);
  if (codes.length === 0) return;

  const free = [];
  for (let cy = 0; cy < ROWS; cy += 1) {
    for (let cx = 0; cx < COLS; cx += 1) {
      if (cellAt(state, cx, cy) !== EMPTY) continue;
      if (state.items[index(cx, cy)] !== 0) continue;
      if (bombAt(state, cx, cy)) continue;
      if (state.flames.some((flame) => flame.cx === cx && flame.cy === cy)) continue;
      free.push([cx, cy]);
    }
  }

  for (const code of codes) {
    if (free.length === 0) return;
    // The drawn cell is removed from the list: two bonuses never land on top of
    // each other, which would lose one without anybody seeing it.
    const [cx, cy] = free.splice(Math.floor(draw(state) * free.length), 1)[0];
    state.items[index(cx, cy)] = code;
    record(state, ['item', cx, cy, BONUS_NAMES[code]]);
  }
}

/**
 * Kills a bomber, whatever the cause.
 *
 * IT DROPS EVERYTHING IT HAD PICKED UP. Without that, killing the best-equipped
 * player removed their bonuses from the round for good, and whoever was left had
 * nothing to covet any more; the last duels were played between two naked
 * bombers in an arena without bricks. Giving them back makes every death a
 * prize, and gives whoever is behind one last reason to step forward.
 *
 * @param {import('./state.js').State} state
 * @param {import('./state.js').Player} player
 * @param {number} cause
 */
export function kill(state, player, cause) {
  if (!player.alive) return;
  player.alive = false;
  player.walking = false;
  player.diedAt = state.step;
  player.onBomb = null;

  // What it was carrying falls where it stood: hands that open let go, they do
  // not throw. The bomb comes back to the grid on the square of the body, which
  // is burning — it will go off in the fire, and that reads right.
  const carried = carriedBy(state, player.place);
  if (carried) carried.held = null;

  // Its trigger bombs are waiting for nobody any more: we give them a fuse back.
  restoreFuses(state, player.place);
  scatter(state, player);

  record(state, ['death', player.place, cause]);
}

/**
 * Picking bonuses up.
 *
 * Called AFTER the deaths: you do not pick up while dying. A last survivor
 * taking a posthumous bonus is visible on screen, and absurd.
 *
 * @param {import('./state.js').State} state
 */
export function pickBonuses(state) {
  for (const player of state.players) {
    if (!player.alive) continue;
    const cx = cellOnAxis(player.x);
    const cy = cellOnAxis(player.y);
    const i = index(cx, cy);
    const value = state.items[i];
    if (!isVisible(value)) continue;
    state.items[i] = 0;
    record(state, ['pick', cx, cy, player.place, BONUS_NAMES[value]]);
    apply(player, value);
  }
}

/**
 * Ages the flames by one step and removes those going out.
 *
 * @param {import('./state.js').State} state
 */
export function ageFlames(state) {
  for (let i = state.flames.length - 1; i >= 0; i -= 1) {
    state.flames[i].left -= 1;
    if (state.flames[i].left <= 0) state.flames.splice(i, 1);
  }
}
