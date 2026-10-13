/**
 * Moving the bombers, and this is the trickiest module in the engine.
 *
 * The bomber is a 0.74-tile box in a one-tile corridor: 0.26 tile of play is
 * left. Without recentring you get stuck at every intersection as soon as you
 * start a turn one sub-unit too early — and that is precisely why most
 * Bomberman clones are unplayable.
 *
 * The handling comes down to two rules, applied on every step:
 *
 * 1. You only move on ONE axis. No diagonals: this game is played on a grid.
 * 2. While moving along one axis, you RECENTRE on the other. A turn asked for
 *    too early is therefore not refused, it is deferred by a few steps during
 *    which the bomber lines itself up in the corridor. That is what gives the
 *    impression it "looks for" the gap, and on its own it replaces an explicit
 *    corner slide.
 *
 * Bombers do not block each other, as in Atomic Bomberman: four in a corridor,
 * getting in each other's way would be the first cause of death, and the most
 * unfair.
 */

import { VECTORS, HALF_BOMBER, UNITS } from './constants.js';
import { cellAt, isFree, touchedCells, cellOnAxis, centreOnAxis, boxOnCell } from './grid.js';
import { bombDroppedAt, bombById, pushBomb } from './bombs.js';

/**
 * Can the bomber occupy this cell?
 *
 * Its own bomb does not block it as long as it stands on it: `onBomb` carries
 * that permission, granted on the drop and withdrawn as soon as it steps off.
 *
 * @param {import('./state.js').State} state
 * @param {import('./state.js').Player} player
 */
export function passable(state, player, cx, cy) {
  if (!isFree(cellAt(state, cx, cy))) return false;
  // A bomb IN FLIGHT does not block: it is above the cell, and you walk under
  // it. Otherwise the glove would close a corridor before the bomb had even
  // landed in it.
  const bomb = bombDroppedAt(state, cx, cy);
  if (bomb === null) return true;
  return bomb.id === player.onBomb;
}

/** Are all the cells touched by the box at this position free? */
function freeBox(state, player, x, y) {
  for (const { cx, cy } of touchedCells(x, y)) {
    if (!passable(state, player, cx, cy)) return false;
  }
  return true;
}

/**
 * Brings a coordinate back towards the centre of its cell, by at most `speed`.
 *
 * The centre of the current cell is always reachable: the bomber is already
 * there by definition, since it is its own cell. Recentring can therefore never
 * push it into a wall.
 *
 * @param {number} value
 * @param {number} speed
 */
export function recentre(value, speed) {
  const target = centreOnAxis(cellOnAxis(value));
  const gap = target - value;
  if (gap === 0) return value;
  if (Math.abs(gap) <= speed) return target;
  return value + Math.sign(gap) * speed;
}

/**
 * Corner slide: going round the obstacle by lining up with the neighbouring
 * corridor, when you are already biting into it.
 *
 * The recentring of rule 2 is not enough, and this is the flaw it fixes. It
 * brings the bomber back to the centre of ITS cell — the one whose way is
 * blocked. Stuck against the top edge of a rock with a free corridor just
 * above, the player was therefore pulled downwards, into the rock, the exact
 * opposite of what they asked for. You had to release the key, go back up, then
 * set off again.
 *
 * The rule of engagement invents no tolerance: the bomber slides if its BOX IS
 * ALREADY BITING into the neighbouring cell, and if the way is free there. The
 * box is 0.74 tile, so it can only bite into one at a time — there is never any
 * ambiguity about the side, and never a slide from a centred position, where
 * being blocked is clear-cut and must stay so.
 *
 * @param {import('./state.js').State} state
 * @param {import('./state.js').Player} player
 * @param {{ dx: number, dy: number }} v
 * @param {number} speed
 * @returns {boolean} true when the bomber has lined up
 */
function slideRound(state, player, v, speed) {
  const cx = cellOnAxis(player.x);
  const cy = cellOnAxis(player.y);

  // The look ahead is at the next CELL, not the next pixel, and that is the
  // point that makes it all work. Tested pixel-wise, the obstacle is only seen
  // once you are flush against it — but recentring moves at the same speed as
  // the bomber and has already had time to bring it to the centre of the
  // blocked corridor. The slide then had nothing left to bite into, and only
  // engaged from a huge offset. At cell scale, the blocked way is seen early
  // enough for recentring never to have run the wrong way.
  if (passable(state, player, cx + v.dx, cy + v.dy)) return false;

  const horizontal = v.dx !== 0;
  // The slide axis is PERPENDICULAR to the requested movement.
  const value = horizontal ? player.y : player.x;
  const fixed = horizontal ? player.x : player.y;

  for (const side of [-1, 1]) {
    const neighbour = (horizontal ? cy : cx) + side;
    // Are we already biting into the neighbouring corridor? If not, no slide: a
    // bomber centred in its corridor must stop dead.
    if (cellOnAxis(value + side * HALF_BOMBER) !== neighbour) continue;

    // It must be possible to line up there AND to leave in the requested
    // direction.
    const inside = horizontal ? [cx, neighbour] : [neighbour, cy];
    const beyond = horizontal ? [cx + v.dx, neighbour] : [neighbour, cy + v.dy];
    if (!passable(state, player, inside[0], inside[1])) continue;
    if (!passable(state, player, beyond[0], beyond[1])) continue;

    // We line up by at most one step, checking the intermediate position: the
    // corridor is free on arrival, not necessarily all the way there.
    const centre = centreOnAxis(neighbour);
    const gap = centre - value;
    const moved = Math.abs(gap) <= speed ? centre : value + Math.sign(gap) * speed;
    if (!(horizontal ? freeBox(state, player, fixed, moved) : freeBox(state, player, moved, fixed))) {
      continue;
    }

    if (horizontal) player.y = moved;
    else player.x = moved;
    return true;
  }

  return false;
}

/**
 * A BOMB THAT APPEARS UNDER A BOMBER DOES NOT LOCK IT IN.
 *
 * The permission to walk through a bomb used to be granted by the gesture of
 * dropping it, to its author alone. But two bombers share a square every time
 * they cross — they do not collide with each other — so the one who dropped
 * walked away while the other was walled in on its own square, with nothing to
 * do but wait for the explosion that would kill it. The same went for a bomb
 * landing from a glove, and for the burst that lines bombs up in front.
 *
 * Granted on the bomber's OWN square and not on the cells its box touches: a
 * bomber standing beside a bomb overlaps that square by a few sub-units, and
 * granting it there would open a free passage over every bomb in the arena.
 *
 * It takes nothing away from anybody: the only way to find oneself on a bomb
 * without permission is to have had it arrive there, since walking onto it is
 * exactly what is refused.
 */
function adoptBombUnderfoot(state, player) {
  if (player.onBomb !== null) return;
  const bomb = bombDroppedAt(state, cellOnAxis(player.x), cellOnAxis(player.y));
  if (bomb !== null) player.onBomb = bomb.id;
}

/**
 * Releases the permission to walk through one's own bomb.
 *
 * The moment of release is the trap: too early — when crossing the centre — and
 * the bomber ends up astride its bomb, hence stuck in mid-air; too late, and it
 * could come back onto it. So we release exactly when the box NO LONGER touches
 * the bomb's cell at all.
 *
 * We also release when the bomb is gone: its id would otherwise be recycled, and
 * the bomber would inherit a permission on somebody else's bomb.
 *
 * @param {import('./state.js').State} state
 * @param {import('./state.js').Player} player
 */
export function leaveOwnBomb(state, player) {
  if (player.onBomb === null) return;
  const bomb = bombById(state, player.onBomb);
  if (bomb === null) {
    player.onBomb = null;
    return;
  }
  if (!boxOnCell(player.x, player.y, bomb.cx, bomb.cy)) player.onBomb = null;
}

/**
 * Wedges the bomber against the obstacle it has just hit, so that it touches it
 * instead of stopping one sub-unit short. The wedged position is checked: if it
 * is not free — the case of a diagonal block — we do not wedge.
 */
function wedge(state, player, v) {
  if (v.dx !== 0) {
    const column = cellOnAxis(player.x + v.dx * HALF_BOMBER) + v.dx;
    const target =
      v.dx > 0 ? column * UNITS - HALF_BOMBER - 1 : (column + 1) * UNITS + HALF_BOMBER + 1;
    if (Math.sign(target - player.x) === v.dx && freeBox(state, player, target, player.y)) {
      player.x = target;
    }
    return;
  }
  const row = cellOnAxis(player.y + v.dy * HALF_BOMBER) + v.dy;
  const target =
    v.dy > 0 ? row * UNITS - HALF_BOMBER - 1 : (row + 1) * UNITS + HALF_BOMBER + 1;
  if (Math.sign(target - player.y) === v.dy && freeBox(state, player, player.x, target)) {
    player.y = target;
  }
}

/**
 * The bomber runs into a bomb: if it has the kick, it pushes it.
 *
 * Triggered by the collision and not by a key: that is how it works in Atomic
 * Bomberman, and it saves explaining a sixth control.
 */
function tryKick(state, player, dir) {
  if (!player.kick) return;
  const v = VECTORS[dir];
  const cx = cellOnAxis(player.x) + v.dx;
  const cy = cellOnAxis(player.y) + v.dy;
  // We do not kick a bomb in flight: it is not on the ground.
  const bomb = bombDroppedAt(state, cx, cy);
  if (bomb !== null && bomb.id !== player.onBomb) pushBomb(state, bomb, dir);
}

/**
 * Moves one bomber by a step, according to its intent.
 *
 * @param {import('./state.js').State} state
 * @param {import('./state.js').Player} player
 * @param {import('./inputs.js').Input} input
 */
export function movePlayer(state, player, input) {
  if (!player.alive) return;
  leaveOwnBomb(state, player);
  // AFTER the release and not before: a bomber that has just stepped off its own
  // bomb must not pick the permission straight back up, which would let it walk
  // backwards over the bomb it has just left.
  adoptBombUnderfoot(state, player);

  if (input.dir < 0) {
    player.walking = false;
    return;
  }

  player.dir = input.dir;
  const v = VECTORS[input.dir];
  const speed = player.speed;

  if (v.dx !== 0) {
    const aimed = player.x + v.dx * speed;
    if (freeBox(state, player, aimed, player.y)) {
      player.x = aimed;
      player.walking = true;
    } else {
      player.walking = false;
      wedge(state, player, v);
      tryKick(state, player, input.dir);
    }
    // The slide comes BEFORE recentring, and rules it out: both pull on the same
    // axis, in opposite directions. It is attempted even while still moving,
    // because it looks one cell ahead — waiting until blocked would be too late,
    // recentring would already have erased the offset.
    if (slideRound(state, player, v, speed)) player.walking = true;
    else player.y = recentre(player.y, speed);
  } else {
    const aimed = player.y + v.dy * speed;
    if (freeBox(state, player, player.x, aimed)) {
      player.y = aimed;
      player.walking = true;
    } else {
      player.walking = false;
      wedge(state, player, v);
      tryKick(state, player, input.dir);
    }
    if (slideRound(state, player, v, speed)) player.walking = true;
    else player.x = recentre(player.x, speed);
  }

  leaveOwnBomb(state, player);
}

/**
 * Moves every bomber.
 *
 * @param {import('./state.js').State} state
 * @param {import('./inputs.js').Input[]} inputs indexed by place
 */
export function movePlayers(state, inputs) {
  for (const player of state.players) {
    movePlayer(state, player, inputs[player.place] ?? { dir: -1, drop: false, detonate: false });
  }
}
