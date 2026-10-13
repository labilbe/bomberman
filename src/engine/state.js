/**
 * State of a round: its shape, its creation, its copy.
 *
 * Immutable or mutable? The rest of the project is immutable — rooms,
 * disconnections, the referee all return a fresh value. The engine's state, on
 * the other hand, is MUTABLE, and that is a choice, not a slackening.
 *
 * Copying two Uint8Arrays and four bombers thirty times a second would produce
 * tens of kilobytes of garbage per second for a state NOBODY keeps: not the
 * relay, which only needs the latest one, and not the client, which keeps
 * serialised snapshots rather than states. Immutability pays off in Tetris
 * because its `reduce` is called on a keypress; here it would pay for nothing.
 *
 * Determinism is therefore guaranteed another way: by the fixed step, by
 * integers in sub-units, and by a seeded generator the engine alone advances.
 * Same seed + same sequence of inputs = same sequence of states, on any
 * machine. That, and not immutability, is what makes replay and tests possible.
 *
 * `clone` exists all the same: the tests need it to compare two branches, and
 * the client's local prediction to hold two states side by side.
 */

import {
  BOMBS_AT_START,
  RANGE_AT_START,
  BASE_SPEED,
  DOWN,
  MAX_PLAYERS,
} from './constants.js';
import { centreOfCell } from './grid.js';
import { createRng } from './rng.js';
import { STARTS, generateArena } from './arena.js';

/**
 * @typedef {{
 *   place: number, alive: boolean, x: number, y: number,
 *   dir: number, walking: boolean,
 *   speed: number, bombs: number, range: number,
 *   kick: boolean, triggers: number, glove: boolean, jelly: boolean, grab: boolean,
 *   punchedAt: number | null, droppedAt: number | null, holdDropped: number | null,
 *   dropped: number, onBomb: number | null, diedAt: number | null
 * }} Player
 *
 * @typedef {{
 *   id: number, cx: number, cy: number, place: number, range: number,
 *   fuse: number, slide: { dir: number, x: number, y: number } | null,
 *   bounce: boolean, held: number | null,
 *   flight: { dir: number, fromX: number, fromY: number, left: number, duration: number } | null
 * }} Bomb
 *
 * @typedef {{ cx: number, cy: number, left: number }} Flame
 *
 * @typedef {{
 *   seed: number, rng: { seed: number }, step: number,
 *   phase: 'play' | 'verdict', version: number,
 *   tiles: Uint8Array, items: Uint8Array,
 *   players: Player[], bombs: Bomb[], flames: Flame[],
 *   events: unknown[][], nextId: number,
 *   endsAt: number | null, verdict: { winningPlace: number | null, draw: boolean } | null
 * }} State
 */

/**
 * A fresh bomber, on its starting cell, with the basic kit.
 *
 * The kit is reset every round: keeping one round's bonuses into the next would
 * give the winner a lead nobody can catch up with, and round 3 would be decided
 * before it began.
 *
 * @param {number} place
 * @returns {Player}
 */
export function createPlayer(place) {
  const start = STARTS[place % STARTS.length];
  const centre = centreOfCell(start.x, start.y);
  return {
    place,
    alive: true,
    x: centre.x,
    y: centre.y,
    dir: DOWN,
    walking: false,
    speed: BASE_SPEED,
    bombs: BOMBS_AT_START,
    range: RANGE_AT_START,
    kick: false,
    triggers: 0,
    /** The boxing glove: it sends a bomb flying rather than pushing it. */
    glove: false,
    /** The jelly: its bombs bounce instead of stopping at the first wall. */
    jelly: false,
    /** The blue glove: it picks a bomb up and carries it rather than kicking it. */
    grab: false,
    /**
     * The step of the last punch, or null. It has no effect on the rules: the
     * renderer uses it to play the gesture.
     */
    punchedAt: null,
    /**
     * Step of the last press on the bomb button, or null: it is what tells a
     * double tap — hence a burst — from two separate drops.
     */
    droppedAt: null,
    /**
     * The bomb dropped during the press currently held down, or null.
     *
     * The blue glove picks up what is under one's feet, and one is always on
     * one's own bomb the instant it is dropped: without this, pressing the key
     * would drop a bomb and lift it straight back up, and no bomb could be left
     * on the ground any more. Letting go and pressing again picks it up — which
     * is the gesture one makes anyway.
     */
    holdDropped: null,
    dropped: 0,
    onBomb: null,
    diedAt: null,
  };
}

/**
 * Creates the state of a round.
 *
 * @param {{ seed: number, places?: number }} options
 * @returns {State}
 */
export function createState({ seed, places = 2 }) {
  const count = Math.max(1, Math.min(MAX_PLAYERS, places));
  const arena = generateArena(createRng(seed));
  return {
    seed,
    rng: arena.rng,
    step: 0,
    phase: 'play',
    version: 0,
    tiles: arena.tiles,
    items: arena.items,
    players: Array.from({ length: count }, (_, place) => createPlayer(place)),
    bombs: [],
    /** Bricks on their way down: they still block, but not for long. */
    rubble: [],
    flames: [],
    events: [],
    nextId: 1,
    endsAt: null,
    verdict: null,
  };
}

/**
 * Deep copy. `slice()` on a Uint8Array gives a fresh buffer, not a view: that is
 * what keeps the two copies from sharing the grid.
 *
 * @param {State} state
 * @returns {State}
 */
export function clone(state) {
  return {
    ...state,
    rng: { seed: state.rng.seed },
    tiles: state.tiles.slice(),
    items: state.items.slice(),
    players: state.players.map((player) => ({ ...player })),
    rubble: state.rubble.map((debris) => ({ ...debris })),
    bombs: state.bombs.map((bomb) => ({
      ...bomb,
      slide: bomb.slide ? { ...bomb.slide } : null,
    })),
    flames: state.flames.map((flame) => ({ ...flame })),
    events: state.events.map((event) => event.slice()),
    verdict: state.verdict ? { ...state.verdict } : null,
  };
}

/**
 * Appends an event to the current step.
 *
 * Events are tuples whose first element is a name: they go out on the network
 * as they are, and drive the sounds and animations on both sides. A tuple
 * rather than an object because there are many of them, and field names
 * repeated thirty times a second carry no information.
 *
 * @param {State} state
 * @param {unknown[]} event
 */
export function record(state, event) {
  state.events.push(event);
}

/** The bomber at that place, or undefined. */
export function playerAt(state, place) {
  return state.players.find((player) => player.place === place);
}

/** The bombers still alive. */
export function alivePlayers(state) {
  return state.players.filter((player) => player.alive);
}
