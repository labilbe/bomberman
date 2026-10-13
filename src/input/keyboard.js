/**
 * Keyboard: two sets of keys on the same machine.
 *
 * Keys are read by `event.code`, never by `event.key`. A physical `KeyW` is a Z
 * on an AZERTY keyboard: reading `key`, the second player would have to press
 * keys scattered all over, and the game would look broken to half the people who
 * try it.
 *
 * This module emits no message and knows neither the engine nor the network. It
 * holds one intent per local place, and it is the caller that comes to read it
 * on every frame. `drop` and `detonate` are pulses: they are read once, then
 * they fall back — otherwise holding the space bar would drop a bomb on every
 * simulation step.
 *
 * The direction follows the LAST key pressed that is still held. That is what
 * makes turns clean: keeping the first one, a player who anticipates by pressing
 * the next key before releasing the previous one would carry straight on.
 */

import { UP, RIGHT, DOWN, LEFT } from '../engine/constants.js';

/** The two sets of keys, in the order of the local places. */
export const KEYS = [
  {
    name: 'Flèches',
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    bomb: 'Space',
    // Enter punches AND detonates: see step.js, which says why the two share a
    // button.
    trigger: 'Enter',
    label: { bomb: 'Espace', trigger: 'Entrée' },
  },
  {
    name: 'ZQSD',
    up: 'KeyW',
    down: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    bomb: 'ShiftLeft',
    trigger: 'ControlLeft',
    label: { bomb: 'Maj gauche', trigger: 'Ctrl gauche' },
  },
];

const DIRECTIONS = { up: UP, down: DOWN, left: LEFT, right: RIGHT };

/**
 * @param {{ target?: EventTarget, count?: number }} options
 */
export function createKeyboard({ target = window, count = 2 } = {}) {
  const seats = Array.from({ length: count }, () => ({
    held: [],
    drop: false,
    detonate: false,
    hold: false,
  }));

  /** Code -> { seat, role }. Built once: the lookup is O(1). */
  const plan = new Map();
  for (let seat = 0; seat < count; seat += 1) {
    const set = KEYS[seat % KEYS.length];
    for (const role of ['up', 'down', 'left', 'right', 'bomb', 'trigger']) {
      plan.set(set[role], { seat, role });
    }
  }

  const shortcuts = new Map();

  function onKeyDown(event) {
    // Without this guard, typing a nickname in the room field would drop bombs.
    const origin = event.target;
    if (origin && /^(INPUT|TEXTAREA|SELECT)$/.test(origin.tagName ?? '')) return;

    const shortcut = shortcuts.get(event.code);
    if (shortcut) {
      event.preventDefault();
      shortcut();
      return;
    }

    const found = plan.get(event.code);
    if (!found) return;
    event.preventDefault();
    const seat = seats[found.seat];
    if (found.role === 'bomb') {
      // The press is a pulse, the key being down is a state: the first drops a
      // bomb, the second carries one with the blue glove. Auto-repeat gives
      // neither — it is the same press, told over again.
      if (!event.repeat) seat.drop = true;
      seat.hold = true;
      return;
    }
    if (found.role === 'trigger') {
      if (!event.repeat) seat.detonate = true;
      return;
    }
    if (!seat.held.includes(found.role)) seat.held.push(found.role);
  }

  function onKeyUp(event) {
    const found = plan.get(event.code);
    if (!found) return;
    const seat = seats[found.seat];
    if (found.role === 'bomb') seat.hold = false;
    seat.held = seat.held.filter((role) => role !== found.role);
  }

  /**
   * A tab that loses focus keeps its keys "pressed": the bomber would set off
   * into a wall on its own until it came back.
   */
  function forget() {
    for (const seat of seats) {
      seat.held = [];
      // The bomb key too: a tab coming back with a bomb "still held" would throw
      // it the moment its player pressed anything.
      seat.hold = false;
    }
  }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', forget);

  return {
    /**
     * The intent of a local place. Pulses are consumed.
     *
     * @param {number} index
     * @returns {import('../engine/inputs.js').Input}
     */
    read(index) {
      const seat = seats[index];
      if (!seat) return { dir: -1, drop: false, detonate: false, hold: false };
      const last = seat.held[seat.held.length - 1];
      const input = {
        dir: last === undefined ? -1 : DIRECTIONS[last],
        drop: seat.drop,
        detonate: seat.detonate,
        hold: seat.hold,
      };
      seat.drop = false;
      seat.detonate = false;
      return input;
    },

    /** Adds an interface key, never sent to the engine. */
    shortcut(code, action) {
      shortcuts.set(code, action);
    },

    forget,

    detach() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', forget);
    },
  };
}
