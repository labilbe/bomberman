/**
 * Drawing a state of the arena.
 *
 * The renderer decides NOTHING: it receives a view — grid, items, bombers,
 * bombs, flames — and paints it. In solo play that view is the engine's state;
 * online, it is a snapshot received from the relay, put back into the same
 * shape. One rendering path for both, hence one single thing to look at when the
 * screen does not show what was expected.
 *
 * Nor does it know where its images come from: it receives a sprite set (see
 * spriteSet.js), painted in code or extracted from Atomic Bomberman. The two
 * have neither the same cell size nor the same sprite size, and that is why
 * everything goes through `put()` and through the anchor point: no measurement
 * is hard-coded here.
 */

import {
  COLS,
  ROWS,
  UNITS,
  SOLID,
  BRICK,
  FLAME_STEPS,
  FUSE_STEPS,
  FALL_STEPS,
  STEP_MS,
  BASE_SPEED,
  VECTORS,
  PUNCH_STEPS,
  FLIGHT_STEPS_PER_CELL,
  WIDTH_U,
  HEIGHT_U,
} from '../engine/constants.js';
import { index, isFree } from '../engine/grid.js';
import { isVisible, BONUS_NAMES } from '../engine/bonus.js';
import { fromDrawings } from './spriteSet.js';
import { BACKGROUND, BONUS_COLOURS } from './palette.js';

/**
 * How much slower a bomb's first beat is than its last.
 *
 * The bomb finishes its fuse AT THE ORIGINAL GAME'S PACE — the duration comes
 * from the sequences themselves, not from a setting here — and starts one and a
 * half times slower. The pulse therefore stays a legible countdown without ever
 * going faster than Interplay intended.
 *
 * It fixes the previous setting, invented out of nothing: it ended at
 * sixty-seven frames a second, above the screen's refresh rate, so frames were
 * skipped and the bomb flickered instead of beating.
 */
const START_SLOWNESS = 1.5;

/**
 * How long a brick takes to fall, in milliseconds.
 *
 * It comes from the ENGINE, which holds that countdown because it also drives
 * the blocking: the cell stays impassable while the brick falls. A separate
 * setting here, and the way would have opened before or after what the screen
 * shows.
 */
const FALL_MS = FALL_STEPS * STEP_MS;

/**
 * Height of the top of a glove flight, in cells, and that of a bounce.
 *
 * TWO GAITS, and what is flown over decides between them. Above free ground the
 * bomb GLIDES: a single arc, from the start to the fall, which says it was sent
 * far in one go. As soon as a wall or a brick passes beneath it, it BOUNCES on
 * them, once per cell, until it finds the hole to drop into.
 *
 * The bounce is not an ornament: it is what makes a punch looking for its hole
 * legible. Stretched over eight cells, the single parabola became a soft bell
 * whose top glided two rows higher, far from the column being followed — you
 * could no longer tell where the bomb was going to land. A bounce therefore
 * rises less high: half a cell is enough to show it leaves the ground, and does
 * not hide the neighbouring cell.
 */
const FLIGHT_HEIGHT = 1.1;
const BOUNCE_HEIGHT = 0.55;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {ReturnType<typeof fromDrawings>} [set]
 */
export function createScene(canvas, set = fromDrawings()) {
  // The grid's step comes from the sprite set, and not from a constant: Atomic
  // Bomberman's tiles are 40 x 36, those drawn in code 16 x 16, and a cell that
  // does not match its drawing leaves seams between the tiles.
  const TILE_W = set.tile.width;
  const TILE_H = set.tile.height;
  const WIDTH_PX = COLS * TILE_W;
  const HEIGHT_PX = ROWS * TILE_H;

  canvas.width = WIDTH_PX;
  canvas.height = HEIGHT_PX;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  /** Rubble: purely decorative, fed by the `brick` event. */
  let rubble = [];

  /**
   * The colour of each place, when the players have chosen one.
   *
   * Sprites are recoloured IN ADVANCE, one series per colour: asking for place 2
   * amounts to asking for the third colour. This table breaks that link — place 2
   * can carry colour 0 — without recolouring anything more, simply by picking
   * from another series that is already prepared.
   */
  let tints = null;
  const tint = (place) => tints?.[place] ?? place;

  /**
   * Puts a sprite down by its anchor point.
   *
   * The coordinates given are those of the POINT in the world where the sprite
   * hangs — a bomber's feet, the bottom of a tile — and not the corner of the
   * image. All the alignment is therefore here, once, instead of an ad hoc
   * offset on every call.
   */
  function put(sprite, x, y) {
    if (!sprite) return;
    ctx.drawImage(sprite.canvas, Math.round(x - sprite.anchorX), Math.round(y - sprite.anchorY));
  }

  /** A cell's anchor point: its bottom edge, in the middle. */
  const cellAnchor = (cx, cy) => [cx * TILE_W + TILE_W / 2, (cy + 1) * TILE_H];

  /** A position from the engine, in pixels. */
  const inPixels = (x, y) => [(x / UNITS) * TILE_W, (y / UNITS) * TILE_H];

  /** Frame of a sequence, from how much is left to burn. */
  function frameOf(run, left, total) {
    const progress = 1 - left / total;
    return run[Math.min(run.length - 1, Math.max(0, Math.floor(progress * run.length)))];
  }

  /**
   * The ground, in one pass.
   *
   * When the sprite set brings the field's painted background, we repeat it
   * vertically and that is all: it is as wide as the whole arena, so nothing
   * repeats horizontally, and its light and dark rows alternate by themselves
   * since the band contains two of them. That is what was missing to get the
   * original field back — a single tile copied 195 times gave a regular
   * checkerboard the game never had.
   */
  function drawGround() {
    if (set.background) {
      for (let y = 0; y < HEIGHT_PX; y += set.background.height) {
        ctx.drawImage(set.background.canvas, 0, y);
      }
      return;
    }
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const [ax, ay] = cellAnchor(x, y);
        put(set.ground[(x + y) % set.ground.length], ax, ay);
      }
    }
  }

  function drawTiles(view, time) {
    drawGround();
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const [ax, ay] = cellAnchor(x, y);
        const tile = view.tiles[index(x, y)];
        if (tile === SOLID) put(set.wall, ax, ay);
        else if (tile === BRICK) put(set.brick, ax, ay);
      }
    }

    // Bonuses on the ground, over the ground and under everything else.
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const value = view.items[index(x, y)];
        if (!isVisible(value)) continue;
        const sprite = set.bonus[BONUS_NAMES[value]];
        if (!sprite) continue;
        // A slight float: a motionless bonus blends into the scenery.
        const float = Math.round(Math.sin(time / 220 + x + y) * 1.5);
        const [ax, ay] = cellAnchor(x, y);
        put(sprite, ax, ay + float);
      }
    }
  }

  /**
   * Position of a punched bomb, somewhere between its start and its fall.
   *
   * The bomb ALREADY belongs to the cell it is heading for as far as the engine
   * is concerned — that is what makes flames find it in the right place — so it
   * is the renderer, and it alone, that still shows it on its way. It works back
   * from the arrival towards the start with what is left of the flight.
   *
   * It glides in a single arc above free ground, and bounces from cell to cell
   * as soon as it flies over an obstacle — see FLIGHT_HEIGHT. With no height at
   * all it would slide in a straight line and you would not see that it passes
   * OVER the walls, which is the whole difference from the kick.
   *
   * @param {boolean} bounce true when something passes under the trajectory
   */
  function inFlight(bomb, bounce) {
    const progress = 1 - bomb.flight.left / bomb.flight.duration;
    const fromX = bomb.flight.fromX * UNITS + UNITS / 2;
    const fromY = bomb.flight.fromY * UNITS + UNITS / 2;
    // We follow the DIRECTION and the number of cells, and not the segment from
    // the start to the arrival: a bomb that leaves the screen comes back from
    // the opposite edge, and its arrival is then across the board. The segment
    // would have made it cross the whole arena backwards, passing under the
    // walls.
    const cells = bomb.flight.duration / FLIGHT_STEPS_PER_CELL;
    const v = VECTORS[bomb.flight.dir];
    const travelled = progress * cells * UNITS;
    // When bouncing, the height only looks at the fraction of the current cell:
    // it therefore comes back to zero on every cell crossed — the bomb touches
    // the brick, and sets off again. The last cell lands exactly on zero, and
    // the bomb settles without bouncing once more. In a glide it is the total
    // progress that counts, and the arc is single.
    const hop = bounce ? (progress * cells) % 1 : progress;
    const top = bounce ? BOUNCE_HEIGHT : FLIGHT_HEIGHT;
    const height = 4 * hop * (1 - hop) * top * UNITS;
    return [
      ((((fromX + v.dx * travelled) % WIDTH_U) + WIDTH_U) % WIDTH_U),
      // The height is taken off AFTER the wrapping: it is the position on the
      // ground that goes round the board, not the arc.
      ((((fromY + v.dy * travelled) % HEIGHT_U) + HEIGHT_U) % HEIGHT_U) - height,
    ];
  }

  /**
   * Is there a wall or a brick UNDER a punched bomb's trajectory?
   *
   * That is what decides its gait: it glides above free ground, and bounces on
   * what it flies over. The question is asked at render time and nowhere else —
   * the engine has already chosen where it falls — and the client's grid is
   * enough to answer it, in solo as well as online play.
   *
   * The arrival cell is not examined: it is free by construction, it is the hole
   * the bomb was looking for.
   */
  function fliesOverObstacle(view, bomb) {
    const cells = bomb.flight.duration / FLIGHT_STEPS_PER_CELL;
    const v = VECTORS[bomb.flight.dir];
    for (let i = 1; i < cells; i += 1) {
      const cx = (((bomb.flight.fromX + v.dx * i) % COLS) + COLS) % COLS;
      const cy = (((bomb.flight.fromY + v.dy * i) % ROWS) + ROWS) % ROWS;
      if (!isFree(view.tiles[index(cx, cy)])) return true;
    }
    return false;
  }

  function drawBombs(view, time) {
    for (const bomb of view.bombs) {
      // A carried bomb is drawn with its carrier, above the head: here it would
      // land on the ground, under the feet of the one holding it.
      if (bomb.held !== null && bomb.held !== undefined) continue;
      const airborne = bomb.flight ? inFlight(bomb, fliesOverObstacle(view, bomb)) : null;
      const x = airborne ? airborne[0] : (bomb.slide ? bomb.slide.x : bomb.cx * UNITS + UNITS / 2);
      const y = airborne ? airborne[1] : (bomb.slide ? bomb.slide.y : bomb.cy * UNITS + UNITS / 2);
      // The pulse speeds up as the fuse burns: it is the countdown, and it has to
      // read without a figure.
      //
      // It is derived from the FUSE, not from the clock. A varying rate dividing
      // an absolute timestamp — `time / rate` — does not give an animation that
      // speeds up: `time` being tens of thousands of milliseconds, shortening
      // the rate by a hair moves the quotient by several frames at once. The
      // animation followed the DERIVATIVE of the rate and span out of control.
      // Starting from the fuse removes the problem, and makes the pulse
      // identical on every screen of an online game, since it then depends only
      // on the engine's state.
      //
      // A trigger bomb, on the other hand, has no fuse: `fuse` is null. There is
      // therefore no countdown to read on it, and its sprite already carries the
      // band that sets it apart.
      const waiting = bomb.fuse === null;
      if (waiting) {
        const bank = set.bombTrigger ?? set.bomb;
        const waitingRun = bank[tint(bomb.place)] ?? bank[0];
        const [ax, ay] = inPixels(x, y);
        // It pulses like a bomb just dropped, and at that rate only: nothing
        // speeds up, since there is no countdown to tell. An invented rate, on
        // the other hand, showed at once — the trigger bomb beat to a different
        // rhythm from its neighbours, and the eye caught that before reading the
        // band.
        const duration = set.bombCycle * START_SLOWNESS;
        const frame = Math.floor((time / duration) * waitingRun.length) % waitingRun.length;
        put(waitingRun[frame], ax, ay + TILE_H / 2);
        continue;
      }
      const burnt = FUSE_STEPS - bomb.fuse;
      // Cycles per step, at the start then at the arrival; the phase is their
      // integral, which gives a continuous acceleration instead of a jump in
      // rate.
      const end = STEP_MS / set.bombCycle;
      const start = end / START_SLOWNESS;
      const cycles = start * burnt + ((end - start) * burnt * burnt) / (2 * FUSE_STEPS);
      const run = set.bomb[tint(bomb.place)] ?? set.bomb[0];
      const [px, py] = inPixels(x, y);
      put(run[Math.floor(cycles * run.length) % run.length], px, py + TILE_H / 2);
    }
  }

  /**
   * Picks a cell's flame piece: centre, middle or end.
   *
   * The engine does not say which branch a flame comes from — all it knows is
   * burning cells. We deduce it from the neighbourhood, here and not in the
   * engine: it is a matter of images, not of rules, and the sprites drawn in code
   * have no need of it at all. An end points AWAY from its neighbour, otherwise
   * the blast looks as if it were going into the wall instead of coming out of
   * it.
   */
  function flamePiece(taken, flame) {
    // The pieces are declined per place: the explosion carries the colour of
    // whoever dropped the bomb, as in Atomic Bomberman.
    const flames = set.flame[tint(flame.place)] ?? set.flame[0];
    const cx = flame.cx;
    const cy = flame.cy;
    const there = (x, y) => taken.has(`${x},${y}`);
    const up = there(cx, cy - 1);
    const down = there(cx, cy + 1);
    const left = there(cx - 1, cy);
    const right = there(cx + 1, cy);

    if ((up || down) && (left || right)) return flames.centre;
    if (left && right) return flames.mid[1];
    if (up && down) return flames.mid[0];
    if (right) return flames.end[3];
    if (left) return flames.end[1];
    if (down) return flames.end[0];
    if (up) return flames.end[2];
    return flames.centre;
  }

  function drawFlames(view) {
    const taken = new Set(view.flames.map((f) => `${f.cx},${f.cy}`));
    for (const flame of view.flames) {
      const run = flamePiece(taken, flame);
      const [ax, ay] = cellAnchor(flame.cx, flame.cy);
      put(frameOf(run, flame.left, FLAME_STEPS), ax, ay);
    }
  }

  /**
   * Frame of the walk cycle, chosen from the DISTANCE TRAVELLED.
   *
   * That is what keeps the feet from sliding on the grass. Set on the clock —
   * one frame every 100 ms — the stride knew nothing of the speed: the bomber
   * crossed a cell in 180 ms without having taken two steps, and with the speed
   * bonus the gap doubled. By counting the sub-units travelled, the leg moves
   * exactly with the ground, at any speed.
   *
   * The calibration starts from the original game's rate: at base speed, we get
   * exactly its 30 ms per frame back.
   */
  const travelled = new Map();
  const lastPosition = new Map();

  function walkFrame(player, frames) {
    const before = lastPosition.get(player.place);
    const done = travelled.get(player.place) ?? 0;
    let total = done;
    if (before) {
      // A network snapshot can make a bomber jump several cells. We cap the step
      // so that the leg does not spin like a top.
      const hop = Math.abs(player.x - before.x) + Math.abs(player.y - before.y);
      total += Math.min(hop, UNITS);
    }
    travelled.set(player.place, total);
    lastPosition.set(player.place, { x: player.x, y: player.y });

    const perFrame = (BASE_SPEED * set.walkCycle) / (frames * STEP_MS);
    return Math.floor(total / perFrame) % frames;
  }

  /**
   * Where a bomber's punch stands: from 0 to 1, or null.
   *
   * It is the engine that dates the gesture (`punchedAt`), and not the renderer:
   * online, the punch is decided by the relay, and a countdown held in the page
   * would not be the same for both players.
   */
  function punchProgress(player, view) {
    if (!player.glove || player.punchedAt === null || !player.alive) return null;
    const since = view.step - player.punchedAt;
    // A round starting again resets the step counter: the date of a punch from
    // the previous round is then in the future.
    if (since < 0 || since >= PUNCH_STEPS) return null;
    return since / PUNCH_STEPS;
  }

  /**
   * The punch, FAILING THE GAME'S OWN SEQUENCE.
   *
   * Atomic Bomberman has its own punch animation, and that is the one we play
   * when the sprite set brings it (`set.punches`, extracted from PUNCH.ANI).
   * This drawing only serves extractions that do not have it, and the sprites
   * painted in code: without it the bonus would stay silent on screen for
   * anybody who has not re-extracted their sprites.
   *
   * It imitates the gesture rather than the glove: the bomber LUNGES — its
   * sprite moves forward a few pixels then comes back — and it is its arm that
   * extends, from the shoulder, and not a glove flying off on its own in front
   * of it. The extension follows a sine: the fist is furthest away in the MIDDLE
   * of the gesture, not at the end, failing which the arm stays extended and
   * vanishes all at once.
   */
  function drawPunchArm(player, px, py, progress) {
    const reach = Math.sin(Math.PI * progress);
    const v = VECTORS[player.dir];
    // The shoulder: at the upper third of the body, offset to the side of the
    // punching arm. Head-on or from behind, an arm right in the middle would
    // read as a nose.
    const sideways = v.dy === 0 ? 0 : TILE_W * 0.22;
    const shoulderX = px + sideways;
    const shoulderY = py - TILE_H * 0.62;
    const range = (0.1 + 0.42 * reach) * TILE_W;
    const fistX = shoulderX + v.dx * range;
    const fistY = shoulderY + v.dy * range * 0.7;
    const radius = TILE_W * 0.13;

    const colours = BONUS_COLOURS.punch;
    // The arm first, from the shoulder to the fist: without it, the glove
    // floats.
    ctx.strokeStyle = colours.glyph;
    ctx.lineWidth = Math.max(2, radius * 0.8);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY);
    ctx.lineTo(fistX, fistY);
    ctx.stroke();

    ctx.fillStyle = colours.background;
    ctx.beginPath();
    ctx.arc(fistX, fistY, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colours.glyph;
    ctx.lineWidth = Math.max(1, radius * 0.3);
    ctx.stroke();
  }

  function drawBombers(view) {
    // Top to bottom: a bomber further down passes in front of the one above,
    // failing which the silhouettes overlap the wrong way round.
    const order = view.players.slice().sort((a, b) => a.y - b.y);
    for (const player of order) {
      const [px, middle] = inPixels(player.x, player.y);
      // Atomic Bomberman's sprites hang by their FEET, and the engine gives the
      // bomber's centre within its cell: so we have to go down half a cell to
      // stand the character on the ground of its own. Without that offset it
      // floated half a cell too high and bit into the row above — the tiles, for
      // their part, already hang from their bottom edge.
      const py = middle + TILE_H / 2;

      if (!player.alive) {
        const since = view.step - (player.diedAt ?? view.step);
        const run = set.dead[tint(player.place)];
        ctx.globalAlpha = since > 90 ? 0.45 : 1;
        // One frame per step: the original animation counts 83 frames, and the
        // body fades at 90 steps. The two fall right together — slowed down,
        // the death froze on its last frames before being over.
        put(run[Math.min(run.length - 1, since)], px, py);
        ctx.globalAlpha = 1;
        continue;
      }

      const punch = punchProgress(player, view);

      if (punch !== null && set.punches) {
        // The original game's sequence: it REPLACES the stance, as in Atomic
        // Bomberman — the bomber draws back, strikes and returns to guard, and
        // walking during that time does not show.
        //
        // It is stretched over the duration the ENGINE gives the gesture, and
        // not over its own: it is the engine that says when the punch starts and
        // ends, and an animation at its own pace would freeze on its last frame
        // or be cut before the end.
        const run = set.punches[tint(player.place)][player.dir];
        put(run[Math.min(run.length - 1, Math.floor(punch * run.length))], px, py);
      } else {
        // The lunge goes with the blow instead of watching it leave, and it
        // stays small: a bomber stepping out of its cell would bite into the
        // next one and would no longer be where the engine says it is.
        const lunge = punch === null ? 0 : TILE_W * 0.1 * Math.sin(Math.PI * punch);
        const v = VECTORS[player.dir];
        const ex = px + v.dx * lunge;
        const ey = py + v.dy * lunge * 0.7;
        const carried = view.bombs.find((bomb) => bomb.held === player.place);
        if (carried && set.carry) {
          // The game draws the whole thing — bomber AND bomb above the head — in
          // one sequence, so there is nothing to add on top of it.
          const run = set.carry[tint(player.place)][player.dir];
          put(run[player.walking ? walkFrame(player, run.length) : 0], ex, ey);
        } else if (player.walking) {
          const run = set.bombers[tint(player.place)][player.dir];
          put(run[walkFrame(player, run.length)], ex, ey);
        } else {
          put(set.idle[tint(player.place)][player.dir], ex, ey);
        }
        // Failing that sequence — the sprites drawn in code have none — the bomb
        // is laid on the head by hand: a bomber carrying nothing visible would
        // make the bonus unreadable, and its own bomb a surprise.
        if (carried && !set.carry) {
          const run = set.bomb[tint(carried.place)] ?? set.bomb[0];
          put(run[Math.floor(time / 120) % run.length], ex, ey - TILE_H * 0.95);
        }
        if (punch !== null) drawPunchArm(player, ex, ey, punch);
      }

      if (player.absent) {
        // A disconnected player stays in the game, motionless: that has to be
        // said on screen, otherwise the others take it for a bomber lying in
        // wait for them.
        ctx.fillStyle = 'rgba(18, 15, 28, 0.55)';
        ctx.fillRect(px - TILE_W / 2, py - TILE_H, TILE_W, TILE_H);
      }
    }
  }

  /**
   * A falling brick.
   *
   * With the original game's sprites we play the real animation; without them we
   * fall back on a handful of shards. Both last as long as the fall, so that the
   * renderer does not have to know which one is running.
   */
  function drawRubble(time) {
    rubble = rubble.filter((piece) => time - piece.born < FALL_MS);
    for (const piece of rubble) {
      const progress = (time - piece.born) / FALL_MS;
      if (set.brickBroken) {
        const run = set.brickBroken;
        const [ax, ay] = cellAnchor(piece.cx, piece.cy);
        put(run[Math.min(run.length - 1, Math.floor(progress * run.length))], ax, ay);
        continue;
      }
      ctx.globalAlpha = 1 - progress;
      ctx.fillStyle = '#7a3526';
      for (const shard of piece.shards) {
        const ex = piece.cx * TILE_W + TILE_W / 2 + shard.vx * progress * 26;
        const ey = piece.cy * TILE_H + TILE_H / 2 + shard.vy * progress * 26 + progress * progress * 34;
        ctx.fillRect(Math.round(ex), Math.round(ey), 3, 3);
      }
      ctx.globalAlpha = 1;
    }
  }

  return {
    width: WIDTH_PX,
    height: HEIGHT_PX,

    /**
     * Sets the colour of each place for the game about to start.
     *
     * @param {number[] | null} table colour index per place, or null to go back
     *   to "the place gives the colour". Online the table comes from the relay,
     *   which settled it from the creation screen's choices: one list for every
     *   screen, otherwise two players would not see the same arena.
     */
    colours(table) {
      tints = table ?? null;
    },

    /**
     * Takes note of a step's events, for the purely visual effects.
     * The renderer never reads the rules: it makes do with what it is told.
     */
    events(list, time) {
      for (const event of list) {
        if (event[0] === 'brick') {
          rubble.push({
            cx: event[1],
            cy: event[2],
            born: time,
            shards: Array.from({ length: 6 }, (_, i) => ({
              vx: Math.cos((i / 6) * Math.PI * 2),
              vy: Math.sin((i / 6) * Math.PI * 2) - 0.4,
            })),
          });
        }
      }
    },

    /**
     * @param {{ tiles: Uint8Array, items: Uint8Array, players: unknown[], bombs: unknown[], flames: unknown[], step: number }} view
     * @param {number} time animation timestamp, in ms
     */
    draw(view, time) {
      // The arena does not move. A shake on the explosion gave the blast some
      // weight, but it also moves the walls before the player's eyes at the
      // precise moment they are looking for a way out — in a game where you die
      // over one cell, the scenery has to remain the one fixed point.
      ctx.fillStyle = BACKGROUND;
      ctx.fillRect(0, 0, WIDTH_PX, HEIGHT_PX);
      drawTiles(view, time);
      drawRubble(time);
      drawBombs(view, time);
      drawBombers(view);
      drawFlames(view);
    },
  };
}
