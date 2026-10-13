/**
 * Bombs: dropping, fuse, kick, triggers.
 *
 * A dropped bomb ALWAYS occupies a whole cell, located by `cx, cy` in tiles. A
 * kicked bomb additionally keeps `slide.x / slide.y` in sub-units for display,
 * but logically it still occupies the cell `cx, cy` until it reaches the centre
 * of the next one. That is what saves us from handling a bomb astride two cells
 * — and a bomb astride is a flame whose origin nobody knows.
 *
 * Bombs are stored in drop order, and their id grows. That order IS the
 * determinism: fuses are collected by increasing id, and the trigger sets off
 * the oldest one.
 */

import {
  FUSE_STEPS,
  VECTORS,
  BOMB_SPEED,
  JELLY_BOMB_SPEED,
  UNITS,
  GLOVE_RANGE,
  FLIGHT_STEPS_PER_CELL,
  COLS,
  ROWS,
} from './constants.js';
import { cellAt, isFree, cellOnAxis, centreOnAxis, boxOnCell, wrap } from './grid.js';
import { record } from './state.js';

/**
 * The bomb on this cell, or null.
 *
 * A bomb CARRIED above a head is not on any cell: it has left the grid with the
 * blue glove, and it blocks nobody, stops no flame and takes no square. Its
 * coordinates follow its carrier all the same, so that it goes off on their own
 * square if the fuse wins — which is what this one line hides from everybody
 * else.
 */
export function bombAt(state, cx, cy) {
  for (const bomb of state.bombs) {
    if (bomb.held !== null) continue;
    if (bomb.cx === cx && bomb.cy === cy) return bomb;
  }
  return null;
}

/**
 * The bomb LYING on this cell, ignoring those in flight.
 *
 * A punched bomb already belongs to the cell it is heading for — that is what
 * makes flames and the danger map find it in the right place — but it is in the
 * air, so it still blocks nobody. You can walk across the cell it is going to
 * land on as long as it is not there yet.
 */
export function bombDroppedAt(state, cx, cy) {
  const bomb = bombAt(state, cx, cy);
  return bomb && !bomb.flight ? bomb : null;
}

/** The bomb carrying this id, or null. */
export function bombById(state, id) {
  if (id === null || id === undefined) return null;
  for (const bomb of state.bombs) {
    if (bomb.id === id) return bomb;
  }
  return null;
}

/**
 * Can a bomb be dropped here, now?
 *
 * @param {import('./state.js').State} state
 * @param {import('./state.js').Player} player
 */
export function canDrop(state, player) {
  if (!player.alive) return false;
  if (player.dropped >= player.bombs) return false;
  const cx = cellOnAxis(player.x);
  const cy = cellOnAxis(player.y);
  return bombAt(state, cx, cy) === null;
}

/**
 * Drops a bomb under the bomber's feet.
 *
 * `onBomb` is armed by the same gesture: without it the bomber would be blocked
 * by its own bomb the instant it drops it, and the whole game — which consists
 * of dropping then fleeing — would become unplayable.
 *
 * A BOMB FROM A TRIGGER CARRIER HAS NO FUSE. Its `fuse` is `null`, and it waits
 * indefinitely: that is how the bonus works, and all of its flavour. With a
 * fuse, the trigger would only be a way of going faster; without one it becomes
 * a weapon of patience — you drop in front of a corridor and wait for the
 * opponent to walk into it. Atomic Bomberman even tells it apart on screen, and
 * the renderer does the same.
 *
 * THE CHARGE IS TAKEN HERE, ON THE DROP, and not on detonation. The reserve
 * therefore counts delayed bombs left to drop, not presses on the button: that
 * is what you read on screen — three bombs of that kind left — and that is what
 * lets them all go off without one of them costing an extra charge. Once
 * dropped, the bomb is paid for; it will obey the button as many times as
 * needed, and in any case it only goes off once.
 *
 * The number of droppable bombs stays the limit: a trigger carrier cannot blanket
 * the arena, it has to detonate to drop again.
 *
 * @param {import('./state.js').State} state
 * @param {import('./state.js').Player} player
 * @returns {import('./state.js').Bomb | null}
 */
export function drop(state, player) {
  if (!canDrop(state, player)) return null;
  const bomb = dropOn(state, player, cellOnAxis(player.x), cellOnAxis(player.y));
  // The permission to walk through one's own bomb applies ONLY to the one under
  // one's feet: those of a burst are dropped ahead, and they have to block,
  // otherwise the burst no longer bars anything.
  player.onBomb = bomb.id;
  return bomb;
}

/**
 * Creates one of the bomber's bombs on a given cell. Checks nothing: the callers
 * have already judged the cell, and each has its own rules for that.
 *
 * @param {import('./state.js').State} state
 * @param {import('./state.js').Player} player
 * @returns {import('./state.js').Bomb}
 */
function dropOn(state, player, cx, cy) {
  // The flag is read BEFORE the charge is taken: otherwise the last charge would
  // remove its own delay, and the bomb just paid for would go off on a fuse.
  const delayed = player.triggers > 0;
  if (delayed) player.triggers -= 1;
  const bomb = {
    id: state.nextId,
    cx,
    cy,
    place: player.place,
    range: player.range,
    fuse: delayed ? null : FUSE_STEPS,
    slide: null,
    // THE JELLY IS A PROPERTY OF THE BOMB, taken on the drop, and not of the
    // player who pushes it. That is what makes a bomb stay mad when the one who
    // dropped it dies, and what lets you recognise, by its course, the bomb of
    // the opponent who picked the bonus up — conversely, reading the bonus at
    // kick time would have made the same bomb tame or mad depending on who
    // touched it.
    bounce: player.jelly,
    /** Red-glove flight: non-null as long as the bomb is in the air. */
    flight: null,
    /** Place of the bomber carrying it in its hands, or null. */
    held: null,
  };
  state.nextId += 1;
  state.bombs.push(bomb);
  player.dropped += 1;
  record(state, ['bomb', cx, cy, player.place]);
  return bomb;
}

/**
 * THE BURST: lines up every bomb left in front of oneself.
 *
 * Triggered by a DOUBLE TAP on the bomb button. The first press drops under the
 * feet as always; the second, if it follows closely, empties the magazine in a
 * queue in the direction being faced — cell after cell, until bombs run out or
 * something gets in the way.
 *
 * It is the gesture that gives a big stock of bombs a point. With eight bombs
 * and only one pair of hands you could drop just one per cell walked, hence
 * never more than two or three before the first went off; the burst turns them
 * into a wall, or into a whole corridor condemned at once.
 *
 * It stops at the first obstacle — wall, brick, bomb, bomber — rather than
 * skipping it: a queue full of holes bars nothing, and barring is the whole
 * point. The bomber does NOT get permission to walk through those bombs: they
 * are in front of it, not under it, and they must block it as they block
 * everyone else.
 *
 * @param {import('./state.js').State} state
 * @param {import('./state.js').Player} player
 * @returns {number} how many bombs were lined up
 */
export function lineUp(state, player) {
  if (!player.alive) return 0;
  const v = VECTORS[player.dir];
  let cx = cellOnAxis(player.x);
  let cy = cellOnAxis(player.y);
  let linedUp = 0;

  while (player.dropped < player.bombs) {
    cx += v.dx;
    cy += v.dy;
    if (!cellOpenForBomb(state, cx, cy)) break;
    dropOn(state, player, cx, cy);
    linedUp += 1;
  }
  return linedUp;
}

/**
 * Burns the fuses down by one step and collects those that have run out.
 *
 * Collected in id order: if two fuses end on the same step, the oldest goes off
 * first, and the result does not depend on the order of the array.
 *
 * @param {import('./state.js').State} state
 * @returns {import('./state.js').Bomb[]}
 */
export function advanceFuses(state) {
  const done = [];
  for (const bomb of state.bombs) {
    // `null` means "no fuse": a trigger bomb, waiting. It does not age, and that
    // is all that sets it apart here.
    if (bomb.fuse === null) continue;
    // A BOMB IN THE HANDS DOES NOT BURN DOWN, as in the original game: carrying
    // it is a way of moving it, not a race against its own fuse. Letting the
    // fuse run meant blowing up in the carrier's own face, which no gesture
    // could avoid — the glove then cost more than it gave.
    if (bomb.held !== null) continue;
    bomb.fuse -= 1;
    if (bomb.fuse <= 0) done.push(bomb);
  }
  return done.sort((a, b) => a.id - b.id);
}

/** Can a bomb slide onto this cell? */
function cellOpenForBomb(state, cx, cy) {
  if (!isFree(cellAt(state, cx, cy))) return false;
  if (bombAt(state, cx, cy)) return false;
  // A bomber stops the bomb: otherwise it would pass through them, and they
  // would die of a bomb they never saw go by.
  for (const player of state.players) {
    if (player.alive && boxOnCell(player.x, player.y, cx, cy)) return false;
  }
  return true;
}

/**
 * Sends a bomb off in a direction, if the way is clear.
 *
 * @param {import('./state.js').State} state
 * @param {import('./state.js').Bomb} bomb
 * @param {number} dir
 * @returns {boolean} true when it sets off
 */
export function pushBomb(state, bomb, dir) {
  if (bomb.slide) return false;
  const v = VECTORS[dir];
  if (!cellOpenForBomb(state, bomb.cx + v.dx, bomb.cy + v.dy)) return false;
  bomb.slide = { dir, x: centreOnAxis(bomb.cx), y: centreOnAxis(bomb.cy) };
  record(state, ['kick', bomb.id, dir]);
  return true;
}

/**
 * Advances the kicked bombs by one step.
 *
 * Called BEFORE the bombers: a bomb moving after them would pass through them in
 * one step, since each would see the other at its previous position.
 *
 * Snapping back to the centre is done by assignment, never by division: the bomb
 * therefore lands exactly on a cell, and a bomb off by one sub-unit does not
 * send its flame off askew.
 *
 * THE JELLY IS PLAYED HERE. An ordinary bomb stops at the first obstacle; that
 * of a jelly carrier sets off the other way and keeps running until its fuse
 * catches up with it. The bounce is only decided at cell centres, like the stop:
 * a bomb changing direction between two cells would end up astride, and a bomb
 * astride is a flame whose origin nobody knows.
 *
 * @param {import('./state.js').State} state
 */
export function advanceSlides(state) {
  for (const bomb of state.bombs) {
    if (!bomb.slide) continue;
    const v = VECTORS[bomb.slide.dir];
    const targetX = centreOnAxis(bomb.cx + v.dx);
    const targetY = centreOnAxis(bomb.cy + v.dy);
    const leftX = targetX - bomb.slide.x;
    const leftY = targetY - bomb.slide.y;
    const remaining = Math.abs(leftX) + Math.abs(leftY);
    // A jelly bomb rolls half as fast: it no longer stops, so its run is not a
    // matter of two cells any more but of the whole round, and at kick pace you
    // could not see it coming.
    const speed = bomb.bounce ? JELLY_BOMB_SPEED : BOMB_SPEED;

    if (remaining > speed) {
      bomb.slide.x += Math.sign(leftX) * speed;
      bomb.slide.y += Math.sign(leftY) * speed;
      continue;
    }

    // It has just reached the centre of the next cell: it occupies it.
    bomb.cx += v.dx;
    bomb.cy += v.dy;
    bomb.slide.x = targetX;
    bomb.slide.y = targetY;

    if (cellOpenForBomb(state, bomb.cx + v.dx, bomb.cy + v.dy)) continue;

    // A FUSED BOMB WAKES THE ONE THAT WAITS. Hitting a delayed bomb sets it off
    // on the spot instead of letting it sleep: the kick becomes an answer to the
    // ambush, and the one who dropped it no longer picks the moment of their
    // bomb alone. The reverse would be unplayable — a waiting bomb pushed against
    // another must not light itself, otherwise it would no longer serve to set a
    // trap.
    const hit = bombAt(state, bomb.cx + v.dx, bomb.cy + v.dy);
    if (hit && hit.fuse === null && bomb.fuse !== null) hit.fuse = 1;

    // The way is blocked. An ordinary bomb stops here; a jelly bomb BOUNCES and
    // sets off the other way, and only stops if the way back is blocked too —
    // wedged between two walls, it settles rather than shaking in place.
    const back = (bomb.slide.dir + 2) % 4;
    const r = VECTORS[back];
    if (bomb.bounce && cellOpenForBomb(state, bomb.cx + r.dx, bomb.cy + r.dy)) {
      bomb.slide.dir = back;
      record(state, ['bounce', bomb.id, back]);
      continue;
    }
    bomb.slide = null;
  }
}

/**
 * Punches the bomb ahead — or the one under one's feet: it flies off.
 *
 * THAT IS THE DIFFERENCE FROM THE KICK, and the whole use of the bonus. The kick
 * pushes at ground level and stops at the first obstacle; the glove makes the
 * bomb FLY OVER walls, bricks and players, to drop it behind them. So you can
 * send a bomb you have just received back to your opponent, even if they have
 * taken cover.
 *
 * IT AIMS FOR THE FULL RANGE, THEN THE FIRST HOLE. The bomb flies over three
 * cells whatever lies beneath, and if the third is taken — a wall, a brick,
 * another bomb — it carries straight on to the first free cell. So it never
 * stops short: stopping before the range would have made it fall on the side of
 * the wall you are hiding behind, which is a riposte for nobody, and giving up
 * on the punch would have made the bonus inert in the narrowest corridors —
 * precisely those where you need it.
 *
 * Nothing sets off if the whole line is taken: the bomb stays where it is,
 * rather than vanishing or being dropped on a wall.
 *
 * The arena WRAPS for this gesture alone: a bomb punched upwards leaves through
 * the top of the screen and comes back from the bottom, on the same column.
 * Cornered against an edge, you therefore keep a riposte.
 *
 * The bomb ahead comes before the one underneath: the first is the intended
 * riposte, while the second is only a convenience.
 *
 * @param {import('./state.js').State} state
 * @param {import('./state.js').Player} player
 * @returns {import('./state.js').Bomb | null} the punched bomb, or null
 */
export function punch(state, player) {
  if (!player.glove || !player.alive) return null;

  const v = VECTORS[player.dir];
  let fromX = cellOnAxis(player.x) + v.dx;
  let fromY = cellOnAxis(player.y) + v.dy;
  let bomb = bombAt(state, fromX, fromY);

  // WE ALSO PUNCH THE ONE UNDER OUR FEET, and that is what makes the bonus
  // usable. Without it you had to have left your bomb's cell entirely to aim at
  // it: as long as you still touched it, pressing towards it made you WALK BACK
  // onto it — you stepped over it instead of facing it — and the button did
  // nothing at all, since a cell carries only one bomb. The glove looked dead.
  // Pressing while standing on one's own bomb had no other meaning anyway: it
  // goes off ahead.
  if (!bomb || bomb.flight) {
    fromX = cellOnAxis(player.x);
    fromY = cellOnAxis(player.y);
    bomb = bombAt(state, fromX, fromY);
  }

  // A bomb already in the air is not punched again: you do not catch one in
  // flight.
  if (!bomb || bomb.flight) return null;

  return sendFlying(state, bomb, player.dir, fromX, fromY);
}

/**
 * Sends a bomb over the arena, from a cell towards the first hole.
 *
 * Shared by the two gloves: the red one punches what is in front of it, the blue
 * one throws what it carries. Their flights are the same — and they must be, or
 * the same bomb would land in two different places depending on how it left.
 *
 * @param {import('./state.js').State} state
 * @param {import('./state.js').Bomb} bomb
 * @param {number} dir
 * @param {number} fromX cell it sets off from
 * @param {number} fromY
 * @returns {import('./state.js').Bomb | null} the bomb, or null when nothing can take it
 */
function sendFlying(state, bomb, dir, fromX, fromY) {
  const v = VECTORS[dir];
  // The flight line goes round the board and comes back to the start: walking it
  // whole means having seen every possible cell. Beyond that we would be going
  // round in circles, literally.
  const line = v.dx !== 0 ? COLS : ROWS;

  let toX = null;
  let toY = null;
  let cells = 0;
  for (let i = GLOVE_RANGE; i < GLOVE_RANGE + line; i += 1) {
    // THE BOMB LEAVES THE SCREEN AND COMES BACK FROM THE OTHER EDGE, on the same
    // column or the same row. That is what gives a riposte to whoever is
    // cornered against an edge: punched upwards from the first row, their bomb
    // flies over the border wall, disappears, and falls back at the bottom of the
    // column — the first hole it meets past its range.
    const { cx, cy } = wrap(fromX + v.dx * i, fromY + v.dy * i);
    if (!isFree(cellAt(state, cx, cy))) continue;
    if (bombAt(state, cx, cy)) continue;
    toX = cx;
    toY = cy;
    // The number of cells TRAVELLED, not the distance as the crow flies: a bomb
    // that has wrapped lands ten cells from its start although it only flew over
    // four, and its flight would last twice too long.
    cells = i;
    break;
  }
  // A line taken from end to end takes nothing: the bomb stays where it is.
  if (toX === null) return null;

  bomb.cx = toX;
  bomb.cy = toY;
  bomb.slide = null;
  bomb.held = null;
  // The bomb ALREADY belongs to the cell it is heading for: flames, chains and
  // the danger map therefore reason about where it is going to fall, not about
  // where it left. `flight` only drives how it is drawn and the fact that it
  // still blocks nobody.
  bomb.flight = {
    dir,
    fromX,
    fromY,
    left: cells * FLIGHT_STEPS_PER_CELL,
    duration: cells * FLIGHT_STEPS_PER_CELL,
  };
  record(state, ['punch', bomb.id, fromX, fromY, toX, toY]);
  return bomb;
}

/** The bomb this bomber is carrying above its head, or null. */
export function carriedBy(state, place) {
  for (const bomb of state.bombs) {
    if (bomb.held === place) return bomb;
  }
  return null;
}

/**
 * THE BLUE GLOVE: takes the bomb underfoot into one's hands.
 *
 * It is the other way of moving a bomb, and the one that asks for nerve: the
 * kick sends it away at once and the red glove throws it over the walls, but
 * this one keeps it — the fuse goes on burning two hands away from the face.
 * Carrying it is how you walk a bomb round a corner, into a corridor no blow
 * reaches, or simply onto somebody.
 *
 * A carried bomb LEAVES THE GRID: it blocks nobody, no flame chains it, and the
 * danger map stops counting it where it used to be. It travels with its carrier,
 * cell by cell, so that the explosion — should the fuse win — goes off on the
 * carrier's own square.
 *
 * @param {import('./state.js').State} state
 * @param {import('./state.js').Player} player
 * @returns {import('./state.js').Bomb | null} the bomb taken, or null
 */
export function grabBomb(state, player) {
  if (!player.grab || !player.alive) return null;
  if (carriedBy(state, player.place)) return null;

  const cx = cellOnAxis(player.x);
  const cy = cellOnAxis(player.y);
  const bomb = bombAt(state, cx, cy);
  // Nothing underfoot, or a bomb still in the air: you catch neither.
  if (!bomb || bomb.flight) return null;
  // The bomb dropped by this very press is left alone — see `holdDropped`.
  if (bomb.id === player.holdDropped) return null;

  bomb.held = player.place;
  bomb.slide = null;
  // The permission to walk through it goes with it: the cell is free again, and
  // keeping it would let its owner walk through the NEXT bomb dropped there.
  if (player.onBomb === bomb.id) player.onBomb = null;
  record(state, ['grab', bomb.id, player.place]);
  return bomb;
}

/**
 * Throws the carried bomb ahead, exactly as the red glove punches.
 *
 * @param {import('./state.js').State} state
 * @param {import('./state.js').Player} player
 * @returns {import('./state.js').Bomb | null}
 */
export function throwCarried(state, player) {
  const bomb = carriedBy(state, player.place);
  if (!bomb) return null;
  const thrown = sendFlying(state, bomb, player.dir, cellOnAxis(player.x), cellOnAxis(player.y));
  // Nowhere to land — a line taken from end to end — so it stays in the hands
  // rather than vanishing: the carrier keeps the problem, which is fair.
  return thrown;
}

/**
 * Carries the held bombs along with their bomber.
 *
 * The bomb is kept ON the carrier's cell, step after step, and that is what
 * makes it explode under their feet when the fuse runs out — it is the whole
 * risk of the bonus. Nothing else looks at those coordinates: `bombAt` ignores a
 * held bomb, so it blocks nobody on the way.
 *
 * @param {import('./state.js').State} state
 */
export function advanceCarried(state) {
  for (const bomb of state.bombs) {
    if (bomb.held === null) continue;
    const carrier = state.players.find((player) => player.place === bomb.held);
    // The carrier is gone — eliminated, or never there: the bomb falls where it
    // was last seen rather than following a ghost.
    if (!carrier || !carrier.alive) {
      bomb.held = null;
      continue;
    }
    bomb.cx = cellOnAxis(carrier.x);
    bomb.cy = cellOnAxis(carrier.y);
  }
}

/** Advances the bombs in flight by one step, and lands those that arrive. */
export function advanceFlights(state) {
  for (const bomb of state.bombs) {
    if (!bomb.flight) continue;
    bomb.flight.left -= 1;
    if (bomb.flight.left <= 0) bomb.flight = null;
  }
}

/**
 * Sets off the bomber's oldest bomb from a distance.
 *
 * The oldest, and not all of them: that is Atomic Bomberman's behaviour, and it
 * is also the only one that leaves room to play — blowing everything up at once
 * robs the trigger of its point, which is choosing the moment of each bomb.
 *
 * ONLY WAITING BOMBS obey, and the button costs nothing: the payload was taken on
 * the drop. A fused bomb is therefore not detonated — it was never paid for that
 * — and an empty reserve does not stop what is already on the ground from going
 * off, which would have condemned its owner to watch their own bombs wait for
 * ever.
 *
 * @param {import('./state.js').State} state
 * @param {import('./state.js').Player} player
 * @returns {import('./state.js').Bomb | null}
 */
export function detonate(state, player) {
  if (!player.alive) return null;
  let chosen = null;
  for (const bomb of state.bombs) {
    if (bomb.place !== player.place || bomb.fuse !== null) continue;
    // Not the one in one's own hands: its fuse is stopped as long as it is
    // carried, so the trigger would arm a bomb that only went off once thrown,
    // one step later and in mid-flight. The button ignores it instead — and
    // with the red glove on it is the punch that answers anyway.
    if (bomb.held === player.place) continue;
    if (chosen === null || bomb.id < chosen.id) chosen = bomb;
  }
  return chosen;
}

/**
 * Gives an ordinary fuse back to the bombs of a place that had none.
 *
 * A trigger bomb waits indefinitely, which is its point as long as a finger can
 * detonate it. When that finger disappears — reserve exhausted, or carrier dead
 * — it would stay there until the end of the round: a permanent obstacle in the
 * middle of the arena that nobody can clear any more.
 *
 * @param {import('./state.js').State} state
 * @param {number} place
 * @param {number | null} except id to leave as it is
 */
export function restoreFuses(state, place, except = null) {
  for (const bomb of state.bombs) {
    if (bomb.place !== place || bomb.id === except) continue;
    if (bomb.fuse === null) bomb.fuse = FUSE_STEPS;
  }
}

/** Distance left before the bomb reaches the centre of its next cell. */
export function slideAdvance(bomb) {
  if (!bomb.slide) return 0;
  const v = VECTORS[bomb.slide.dir];
  const travelled =
    Math.abs(bomb.slide.x - centreOnAxis(bomb.cx)) + Math.abs(bomb.slide.y - centreOnAxis(bomb.cy));
  return v.dx || v.dy ? travelled / UNITS : 0;
}
