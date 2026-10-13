/**
 * Sound effects: Atomic Bomberman's own if they have been extracted, otherwise
 * synthesised.
 *
 * Synthesis stays the default path, and that is not a stopgap: a freshly cloned
 * repository has no assets, and the game has to sound all the same. Everything
 * then comes out of oscillators and white noise.
 *
 * When the bank is there, it only replaces the roles for which the original game
 * has a sound. Breaking a brick, revealing a bonus or announcing a round have
 * none — Atomic Bomberman covers them with the explosion — so they stay
 * synthesised.
 *
 * The audio context is created on the user's FIRST GESTURE, never on load:
 * browsers refuse to start a sound without interaction, and a context created
 * too early stays stuck in "suspended" for the whole game, without the slightest
 * error to say so.
 *
 * Sounds are driven by the engine's EVENTS, not by the renderer. That is what
 * makes them sound the same in solo and online play: the relay sends the same
 * events the local game produces.
 */

/** Overall volume. Low: one explosion a second with four players is plenty. */
const VOLUME = 0.22;

import { loadBank } from './bank.js';

export function createSounds() {
  // The download starts at once; decoding will wait for the context.
  const bankPromise = loadBank().catch(() => null);
  /** @type {Awaited<ReturnType<typeof loadBank>>} */
  let bank = null;
  /** @type {AudioContext | null} */
  let ctx = null;
  let master = null;
  let on = true;
  /** Pre-computed white noise: regenerating it on every explosion would cost. */
  let noise = null;

  function start() {
    if (ctx || !on) return;
    const Audio = window.AudioContext ?? window.webkitAudioContext;
    if (!Audio) return;
    ctx = new Audio();
    master = ctx.createGain();
    master.gain.value = VOLUME;
    master.connect(ctx.destination);

    // Decoding cannot begin before there is a context: it is here, and not at
    // download time, that the bank becomes playable.
    bankPromise.then((loaded) => {
      bank = loaded;
      return loaded?.prepare(ctx);
    }).catch(() => {
      bank = null;
    });

    const duration = 1;
    noise = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }

  function ready() {
    if (!on) return false;
    if (!ctx) start();
    if (!ctx) return false;
    // A tab back from the background finds a suspended context.
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  /** A simple note: waveform, pitch, duration, envelope. */
  function note(shape, from, to, duration, gain = 1, delay = 0) {
    if (!ready()) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const volume = ctx.createGain();
    osc.type = shape;
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + duration);
    volume.gain.setValueAtTime(0.0001, t);
    volume.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    volume.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(volume);
    volume.connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  /** A puff of filtered noise: everything that breaks or explodes. */
  function blast(duration, cutoffFrom, cutoffTo, gain = 1, delay = 0) {
    if (!ready()) return;
    const t = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoffFrom, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, cutoffTo), t + duration);
    const volume = ctx.createGain();
    volume.gain.setValueAtTime(gain, t);
    volume.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter);
    filter.connect(volume);
    volume.connect(master);
    source.start(t);
    source.stop(t + duration);
  }

  const sounds = {
    bomb: () => note('square', 420, 180, 0.09, 0.5),
    boom: () => {
      blast(0.42, 1800, 120, 0.9);
      note('sine', 90, 36, 0.3, 0.8);
    },
    brick: () => blast(0.12, 2600, 700, 0.35),
    item: () => {
      note('triangle', 700, 700, 0.07, 0.4);
      note('triangle', 1050, 1050, 0.09, 0.4, 0.07);
    },
    pick: () => {
      note('square', 620, 620, 0.06, 0.45);
      note('square', 880, 880, 0.06, 0.45, 0.06);
      note('square', 1240, 1240, 0.1, 0.45, 0.12);
    },
    itemgone: () => note('sine', 300, 120, 0.12, 0.3),
    kick: () => note('sawtooth', 240, 520, 0.12, 0.35),
    // The jelly's bounce: the kick backwards, shorter and higher. A mad bomb
    // crosses the arena while nobody is watching it, and it is the ear that has
    // to warn you it is coming back.
    bounce: () => note('square', 520, 300, 0.07, 0.3),
    death: () => {
      note('sawtooth', 420, 60, 0.5, 0.5);
      blast(0.3, 900, 100, 0.4);
    },
    round: () => {
      note('square', 523, 523, 0.12, 0.4);
      note('square', 659, 659, 0.12, 0.4, 0.12);
      note('square', 784, 784, 0.22, 0.4, 0.24);
    },
    end: () => {
      const notes = [523, 659, 784, 1046];
      notes.forEach((pitch, i) => note('square', pitch, pitch, 0.18, 0.45, i * 0.11));
    },
  };

  return {
    /** To call on the first click: it is the only chance to open the audio. */
    wake: start,

    /** Mutes or unmutes. */
    toggle() {
      on = !on;
      if (master) master.gain.value = on ? VOLUME : 0;
      return on;
    },

    get on() {
      return on;
    },

    /**
     * Plays what a simulation step has to tell.
     *
     * Simultaneous explosions are merged into one: a chain of six bombs would
     * play the same blast six times at the same instant, which clips and sounds
     * like a mistake rather than like a big explosion.
     *
     * @param {unknown[][]} events
     */
    react(events) {
      if (!on || events.length === 0) return;
      const seen = new Set();
      for (const event of events) {
        const name = event[0];
        // 'bomb' is in the lot since the burst: eight bombs dropped on the same
        // step played the same sound eight times, which clips instead of
        // impressing.
        if (name === 'boom' || name === 'brick' || name === 'itemgone' || name === 'bomb') {
          if (seen.has(name)) continue;
          seen.add(name);
        }
        if (bank?.play(name, master)) continue;
        sounds[name]?.();
      }
    },

    /**
     * Round announcement, and end-of-match music.
     *
     * Atomic Bomberman has no jingle for the START of a round: so we keep ours,
     * synthesised. For the end it has three pieces — won, lost, drawn — and
     * those are the ones we play.
     *
     * @param {{ type: string, verdict?: { draw: boolean } }} transition
     */
    transition(transition) {
      const type = typeof transition === 'string' ? transition : transition.type;
      if (type === 'round') {
        bank?.stopMusic();
        sounds.round();
        return;
      }
      if (type === 'score') {
        if (!bank?.music(transition.verdict?.draw ? 'draw' : 'win', master)) sounds.end();
        return;
      }
      if (type === 'finished') {
        if (!bank?.music('win', master)) sounds.end();
      }
    },

    /** Menu music, looping. Silent when the bank is not there. */
    menuMusic() {
      bank?.music('menu', master, { loop: true });
    },

    /** Stops any music currently playing. */
    silence() {
      bank?.stopMusic();
    },
  };
}
