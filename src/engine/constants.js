/**
 * Game constants.
 *
 * Two choices of unit govern the whole engine, and both have the same reason:
 * the arena is simulated by the relay and replayed by the tests, so two runs
 * must produce exactly the same state, bit for bit.
 *
 * 1. Positions are INTEGERS in tile sub-units (UNITS per tile), never floating
 *    pixels. A float accumulated over ten thousand steps ends up differing from
 *    one machine to the next, and a player is dead on one side and alive on the
 *    other.
 * 2. Durations are counted in simulation STEPS, not milliseconds. The step is
 *    fixed; only the calling loop decides how many steps to catch up.
 */

/** Classic grid: odd both ways, so that the corners are corridors. */
export const COLS = 15;
export const ROWS = 13;

/** What a cell is made of. */
export const EMPTY = 0;
export const SOLID = 1;
export const BRICK = 2;

/** Sub-units per tile. A power of two: divisions stay exact. */
export const UNITS = 1024;

/** Arena size in sub-units. */
export const WIDTH_U = COLS * UNITS;
export const HEIGHT_U = ROWS * UNITS;

/** Simulation rate. Fixed, and never negotiated with the caller. */
export const STEP_HZ = 60;
export const STEP_MS = 1000 / STEP_HZ;

/**
 * Network broadcast rate: one snapshot per step.
 *
 * It used to be 30 Hz, one step out of two, and that was the cause of the "lag"
 * felt online — wrongly, because it was not lag. The round trip to the relay is
 * FOURTEEN milliseconds, measured: the network had nothing to do with it. But
 * the engine runs at 60 Hz and the screen refreshes at 60 Hz, while positions
 * only arrived at 30: the bomber jumped two steps at once, every other frame.
 * That was not delay, it was stutter.
 *
 * At 60 Hz every displayed frame has its own position. The cost is one more
 * frame per step and per player — a few hundred bytes, against the sixty
 * intents per second the page used to send for nothing.
 */
export const TICK_HZ = 60;

/**
 * Half-width of a bomber's box: 0.37 tile, so 0.74 tile wide in a one-tile
 * corridor. Narrow enough to turn without getting stuck, wide enough that
 * flames do not slip past.
 */
export const HALF_BOMBER = Math.round(0.37 * UNITS);

/**
 * Half-width of the box that CATCHES FIRE, smaller than the one that collides.
 *
 * The two used to be the same, and that was an unfairness the original game
 * does not commit. The collision box must be wide — otherwise the bomber walks
 * into walls — but using it for death kills 0.13 tile away from the fire, so
 * BEFORE reaching it. It showed best on a brick that had just fallen: the
 * player sheltering behind it stepped into the hole and died of the flame next
 * door, without ever entering it.
 *
 * 0.28 IS NOT A ROUND NUMBER BUT A MEASURED FLOOR. Lower than that, the game
 * defuses itself: at 0.25 the bots can no longer finish each other off and
 * twenty-two matches out of forty stall — proof, incidentally, that a good
 * share of deaths came from this side effect rather than from a real hit. The
 * "four bots play a whole match" test fixes this limit, and it is the one to
 * re-read before touching this value.
 *
 * It stays non-zero on purpose: a bomber halfway into the flames must die,
 * otherwise one parks at the edge of the blast and the game loses its danger.
 * The cell next to a blaze becomes safe over 72 % of its width instead of 63 —
 * enough to stand in a brick's hole, not enough to linger there.
 */
export const HALF_DEADLY = Math.round(0.28 * UNITS);

/**
 * Speeds, in sub-units per step.
 *
 * 94 u/step ~= 5.5 tiles/s: the speed of Atomic Bomberman, where one crosses
 * the grid in two and a half seconds. The increments are integers so that the
 * sum over steps does not depend on the order of the additions.
 */
export const BASE_SPEED = 94;
export const SPEED_STEP = 18;
export const MAX_SPEED = 184;
export const BOMB_SPEED = 240;

/**
 * Speed of a JELLY bomb: half that of a plain kick.
 *
 * A kicked bomb only travels a few cells before hitting a wall; at 14 tiles per
 * second its run is brief and the player only has to step aside once. A jelly
 * bomb never stops: at the same pace it swept the arena in zigzags faster than
 * the eye can follow, and dying under it was a lottery rather than a matter of
 * placement.
 *
 * At half — 7 tiles per second — you see it coming, you go around it, you take
 * it back with a kick. It stays faster than a plain bomber, who does 5.5:
 * fleeing in a straight line is not enough, you have to turn. Whoever picked up
 * skates outruns it — and so much the better, a bonus should be worth
 * something.
 */
export const JELLY_BOMB_SPEED = 120;

/** Fuse length: 2.4 s. Time to back off two cells, not three. */
export const FUSE_STEPS = 144;

/** Flame lifetime: 0.5 s on screen, and deadly for all of it. */
export const FLAME_STEPS = 30;

/**
 * How long a brick falls: 0.32 s, during which it still BLOCKS.
 *
 * The cell did not empty progressively, it emptied at once: the brick vanished
 * the instant of the explosion and the falling animation was only scenery
 * painted over empty ground. One walked through a brick still seen falling.
 *
 * It stays a BRICK for this countdown, hence impassable, and a second blast
 * stops at it as before. The engine holds this duration and the renderer reads
 * it: two separate countdowns would have drifted apart, and the way would have
 * opened before or after what the screen shows.
 */
export const FALL_STEPS = 19;

/**
 * What a bomber starts each round with.
 *
 * These are Atomic Bomberman's values, not ours: its DATA/RES/VALUELST.RES
 * states them in plain text, "50,1 ; number of bombs" and "51,2 ; flame length
 * (cells beyond epicenter blast)". We used to start with a single cell of
 * range, and the blast looked short to anyone who knows the game.
 */
export const BOMBS_AT_START = 1;
export const RANGE_AT_START = 2;

/**
 * How many bombs one picked-up trigger can set off.
 *
 * The trigger is not an acquired state but a RESERVE: it runs out, and one goes
 * back to fused bombs. That is what keeps it from dominating the end of a
 * round — with a permanent trigger, whoever picks it up first drops wherever
 * they like and waits forever, and the other has no answer left.
 */
export const TRIGGERS_PER_BONUS = 5;

/**
 * How long an illness lasts: 15 seconds.
 *
 * Long enough to lose the round because of it, short enough that the loser is
 * not out of the game. It is also the whole reason the skull can be PASSED ON:
 * fifteen seconds is long enough to want to go and hand it to somebody else.
 */
export const DISEASE_STEPS = 900;

/**
 * The short fuse: 0.6 s instead of 2.4.
 *
 * Not zero: a bomb that went off on the spot would kill at the press, and the
 * illness would be a death sentence rather than a handicap. At 0.6 s you can
 * still get out, but only if you were not already in a corner.
 */
export const SHORT_FUSE_STEPS = 36;

/** The tiny flame: the blast falls back to one cell, whatever was picked up. */
export const TINY_RANGE = 1;

/**
 * Leaden legs: a little over half the basic pace.
 *
 * Slower than a bomber who has picked up nothing, which is the point — the
 * illness has to be felt by somebody who had no skates either.
 */
export const SICK_SPEED = 52;

/**
 * The boxing glove: how many cells a punched bomb flies over AT LEAST, and how
 * long it takes per cell.
 *
 * Three cells, because that is what sets it apart from the kick. The kick
 * shoves along the ground and stops at the first obstacle; the glove sends the
 * bomb OVER it — walls, bricks, players — to land it behind. With one or two
 * cells the two bonuses would look alike.
 *
 * It is a minimum, not a limit: if the third cell is taken, the bomb carries
 * straight on to the first hole, leaving by an edge if it must. A flight can
 * therefore last far more than three cells — up to going round the board — and
 * the fuse burns all the while.
 *
 * Eight steps per cell, a little under half a second for three cells: slow
 * enough to see the bomb coming and have time to step out of its path, brisk
 * enough that the punch stays a riposte.
 */
export const GLOVE_RANGE = 3;
export const FLIGHT_STEPS_PER_CELL = 8;

/**
 * Length of the punching GESTURE, in steps: the time the fist goes out and back.
 *
 * It plays as soon as the button is pressed with the glove, even when nothing
 * flies off. That is what teaches the bonus: without feedback on screen, a
 * player punching at thin air believes the glove is broken, and has no way to
 * guess that all he lacked was a bomb in front of him.
 *
 * Twelve steps, two thirds of a second: long enough to be seen, too short to
 * cover two presses in a row.
 */
export const PUNCH_STEPS = 12;

/**
 * Window of the DOUBLE TAP that fires a burst of bombs, in steps.
 *
 * Twenty steps, a third of a second: the usual measure of a double click.
 * Shorter and the gesture misses one time in two; longer and two bombs dropped
 * one after the other in a corridor — which one does without thinking while
 * fleeing — would go off as a burst and seal one's own way out.
 *
 * The count is kept by the ENGINE, in simulation steps, and not by the keyboard
 * in milliseconds: the relay must see the same gesture as the page, otherwise a
 * burst fires for one and not for the other.
 */
export const DOUBLE_TAP_STEPS = 20;

/** Pick-up ceilings, so that a round does not degenerate. */
export const MAX_BOMBS = 8;
export const MAX_RANGE = 8;

/**
 * Most bombers an arena can hold, as in the original game.
 *
 * Ten on a board of this size is a scrum, and that is what it was: the arena
 * does not grow, the starts spread out along the outer corridor and more of
 * them are cleared, which is the only room ten bombers get.
 */
export const MAX_PLAYERS = 10;

/** Pause after the last death, before the round is announced. */
export const ROUND_END_STEPS = 90;

/** Directions, in the order the engine evaluates them. */
export const UP = 0;
export const RIGHT = 1;
export const DOWN = 2;
export const LEFT = 3;

/** Vectors of the four directions, indexed by the constants above. */
export const VECTORS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

/** Bonus kinds. These strings travel over the network, hence English. */
export const BONUS = {
  BOMB: 'bomb',
  FLAME: 'flame',
  SPEED: 'speed',
  KICK: 'kick',
  TRIGGER: 'trigger',
  GLOVE: 'punch',
  JELLY: 'jelly',
  GRAB: 'grab',
  SPOOGER: 'spooger',
  GOLDFLAME: 'goldflame',
  RANDOM: 'random',
  DISEASE: 'disease',
};
