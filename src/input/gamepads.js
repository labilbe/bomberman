/**
 * Gamepads: one per local seat, alongside the keyboard.
 *
 * This module returns exactly what the keyboard returns — `read(seat)` gives an
 * intent, `forget()` releases everything — and for the same reason: the game
 * loop must not know where a direction comes from. That is what lets gamepads be
 * plugged in without touching the renderer, the engine or the transport.
 *
 * THE BIG DIFFERENCE FROM THE KEYBOARD IS THAT WE POLL INSTEAD OF LISTENING.
 * There is no "button pressed" event: the API only gives a snapshot of the
 * state, which has to be read again on every frame. Two consequences, accepted:
 *
 * - pulses are deduced from an EDGE. We keep each button's previous state, and
 *   dropping a bomb means "released on the previous frame, pressed on this one".
 *   Without that, holding the button would drop a bomb every step.
 * - a press shorter than a frame goes unnoticed. That is inherent to polling,
 *   and harmless at sixty frames a second: nobody presses and releases in less
 *   than sixteen milliseconds.
 *
 * Gamepads are assigned IN THE ORDER OF THEIR SLOTS, not by their raw index.
 * Unplugging the first of two gamepads leaves a hole in the array the browser
 * returns; reading the raw index, the remaining player would lose their gamepad
 * although it is still plugged in.
 *
 * Nothing here touches `navigator` directly: the probe is injected, like the
 * keyboard's event target. That is what makes the module testable without a
 * browser.
 */

import { UP, RIGHT, DOWN, LEFT } from '../engine/constants.js';

/**
 * Buttons, in the "standard" layout the browser normalises to.
 *
 * 0 and 1 are the two bottom-right buttons — A and B on an Xbox pad, cross and
 * circle on a PlayStation. We take the two most reachable for the right thumb:
 * dropping a bomb and detonating it are the game's two gestures — and the second
 * also carries the punch, whether the glove has been picked up or not, so that a
 * two-button pad is always enough.
 */
export const BUTTONS = { bomb: 0, trigger: 1 };

/** The d-pad, always at the same indexes in the standard layout. */
export const DPAD = { up: 12, down: 13, left: 14, right: 15 };

/** The left stick: horizontal axis, vertical axis. */
export const AXES = { x: 0, y: 1 };

/**
 * How far the stick must tilt before it counts as a direction.
 *
 * It is deliberately high. The game only knows four directions, and a stick at
 * rest never returns exactly zero: with a low threshold a slightly worn pad
 * makes the bomber walk off on its own, and a diagonal push makes it hesitate
 * between two corridors on every frame.
 */
export const DEAD_ZONE = 0.45;

/** Is a button pressed? Triggers are analogue, hence the threshold. */
const pressed = (button) => {
  if (!button) return false;
  if (typeof button === 'number') return button > 0.5;
  return button.pressed === true || button.value > 0.5;
};

const DIRECTIONS = { up: UP, down: DOWN, left: LEFT, right: RIGHT };
const ROLES = /** @type {const} */ (['up', 'down', 'left', 'right']);

/** The gamepads actually plugged in, in the order of their slots. */
function connected(probe) {
  const raw = probe() ?? [];
  return Array.from(raw).filter((pad) => pad && pad.connected !== false);
}

/**
 * Direction taken from the stick: the axis tilted furthest wins.
 *
 * We never return two directions. Taking both axes as soon as they leave the
 * dead zone would make the bomber shake between two corridors on a diagonal
 * push, which is the normal push when aiming at a corner.
 */
function fromStick(axes, deadZone) {
  const x = Number(axes?.[AXES.x]) || 0;
  const y = Number(axes?.[AXES.y]) || 0;
  if (Math.abs(x) < deadZone && Math.abs(y) < deadZone) return -1;
  if (Math.abs(x) >= Math.abs(y)) return x > 0 ? RIGHT : LEFT;
  return y > 0 ? DOWN : UP;
}

/**
 * @param {{ probe?: () => ArrayLike<unknown>, count?: number, deadZone?: number }} options
 */
export function createGamepads({
  probe = () => (typeof navigator === 'undefined' ? [] : navigator.getGamepads?.() ?? []),
  count = 2,
  deadZone = DEAD_ZONE,
} = {}) {
  const seats = Array.from({ length: count }, () => ({
    /** D-pad directions still held, in the order they were pressed. */
    held: [],
    /** State of the two buttons on the previous frame, to read their edges. */
    before: { bomb: false, trigger: false },
    /**
     * True as long as this gamepad has not been seen yet.
     *
     * The first read only records the state of the buttons, without drawing a
     * pulse from it. Without that, landing on the page or plugging a pad back in
     * while holding the trigger would drop a bomb nobody asked for: a button
     * already pressed is not an edge, it is a state we are discovering.
     */
    resumed: true,
  }));

  /**
   * Updates a seat from a gamepad's state, and returns its intent.
   *
   * The d-pad follows the LAST direction pressed that is still held, like the
   * keyboard, and for the same reason: keeping the first one, a player who
   * anticipates their turn before releasing would carry straight on. The stick
   * has no order — it only has a tilt — so it only serves when the d-pad is
   * silent.
   */
  function poll(seat, pad) {
    const buttons = pad?.buttons ?? [];

    for (const role of ROLES) {
      const down = pressed(buttons[DPAD[role]]);
      const already = seat.held.includes(role);
      if (down && !already) seat.held.push(role);
      else if (!down && already) seat.held = seat.held.filter((r) => r !== role);
    }

    const pulse = {};
    const down = {};
    for (const role of /** @type {const} */ (['bomb', 'trigger'])) {
      const now = pressed(buttons[BUTTONS[role]]);
      pulse[role] = now && !seat.before[role] && !seat.resumed;
      down[role] = now;
      seat.before[role] = now;
    }
    // A pad discovered with the button already down holds nothing yet: the same
    // caution as for the pulse, and for the same reason — it is a state we are
    // finding, not a gesture somebody made.
    const holding = down.bomb && !seat.resumed;
    seat.resumed = false;

    const last = seat.held[seat.held.length - 1];
    return {
      dir: last === undefined ? fromStick(pad?.axes, deadZone) : DIRECTIONS[last],
      drop: pulse.bomb,
      detonate: pulse.trigger,
      hold: holding,
    };
  }

  /** Resets a seat, without emitting a pulse when it comes back. */
  function clear(seat) {
    seat.held = [];
    seat.before.bomb = false;
    seat.before.trigger = false;
    seat.resumed = true;
  }

  return {
    /**
     * The intent of a local place, polled on the spot.
     *
     * @param {number} index
     * @returns {import('../engine/inputs.js').Input}
     */
    read(index) {
      const seat = seats[index];
      if (!seat) return { dir: -1, drop: false, detonate: false, hold: false };

      const pad = connected(probe)[index];
      if (!pad) {
        // Gamepad unplugged mid-game: we release everything rather than let the
        // bomber run into a wall with its last direction.
        clear(seat);
        return { dir: -1, drop: false, detonate: false, hold: false };
      }
      return poll(seat, pad);
    },

    /** How many gamepads are plugged in, to say so on screen. */
    howMany() {
      return connected(probe).length;
    },

    forget() {
      for (const seat of seats) clear(seat);
    },
  };
}
