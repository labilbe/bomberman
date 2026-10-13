/**
 * Bank of sounds extracted from Atomic Bomberman.
 *
 * Two stages, and that is what matters here. Files are DOWNLOADED when the page
 * loads, but DECODED only once the audio context exists — that is, on the user's
 * first gesture. There is no other way: `decodeAudioData` needs a context, and a
 * context created without a gesture stays stuck in "suspended" for the whole
 * game. Separating the two saves waiting for the click to start downloading two
 * megabytes.
 *
 * The music, on the other hand, is not downloaded in advance: the only piece
 * that lasts is the menu's, and it would be absurd to make somebody who clicks
 * "Play" straight away pay for it.
 *
 * Each role carries SEVERAL variants, because the original game has them: twenty
 * explosions, thirteen bonus sounds. With four players an explosion goes off
 * every second, and a single sound would become a saw within one round.
 */

/** Where the game expects the sounds, relative to the page. */
const FOLDER = 'assets/sounds';

/**
 * Downloads the bank. Returns `null` when it is not there.
 *
 * An absence is not an error: a freshly cloned repository has no assets, and the
 * caller then falls back on the synthesised sounds.
 */
export async function loadBank({ folder = FOLDER } = {}) {
  let manifest;
  try {
    const response = await fetch(`${folder}/manifest.json`);
    if (!response.ok) return null;
    manifest = await response.json();
  } catch {
    return null;
  }

  /** The raw bytes, per file: downloaded once, decoded later. */
  const bytes = new Map();
  const files = [...new Set(Object.values(manifest.roles).flat())];
  await Promise.all(files.map(async (file) => {
    try {
      const response = await fetch(`${folder}/${file}`);
      if (response.ok) bytes.set(file, await response.arrayBuffer());
    } catch {
      // A missing sound effect replaces itself: the role keeps its other
      // variants, and if none is left the caller falls back on synthesis.
    }
  }));

  /** @type {Map<string, AudioBuffer[]>} */
  const decoded = new Map();
  let context = null;

  /**
   * Decodes everything that was downloaded. To be called once the context is
   * open.
   *
   * `decodeAudioData` CONSUMES the buffer it is given: so we pass it a copy,
   * otherwise a second call — on reloading a round, for instance — would find an
   * empty buffer and stay silent without reporting anything.
   */
  async function prepare(ctx) {
    if (context) return;
    context = ctx;
    await Promise.all(Object.entries(manifest.roles).map(async ([role, list]) => {
      const buffers = [];
      for (const file of list) {
        const raw = bytes.get(file);
        if (!raw) continue;
        try {
          buffers.push(await ctx.decodeAudioData(raw.slice(0)));
        } catch {
          // Format refused by this browser: we carry on with the others.
        }
      }
      if (buffers.length) decoded.set(role, buffers);
    }));
  }

  let playing = null;

  return {
    prepare,

    /** Does the role have at least one usable variant? */
    knows(role) {
      return decoded.has(role);
    },

    /**
     * Plays a variant at random.
     *
     * Randomness is harmless here: sound does not touch the game's state, so two
     * machines can hear two different explosions without the game diverging by
     * an inch.
     */
    play(role, out) {
      const buffers = decoded.get(role);
      if (!buffers || !context) return false;
      const source = context.createBufferSource();
      source.buffer = buffers[Math.floor(Math.random() * buffers.length)];
      source.connect(out);
      source.start();
      return true;
    },

    /**
     * Starts a piece of music, downloading it the first time it is needed.
     *
     * @param {string} name menu, victoire, defaite, nulle
     * @param {{ loop?: boolean }} options
     */
    async music(name, out, { loop = false } = {}) {
      const track = manifest.music?.[name];
      if (!track || !context) return false;

      if (!decoded.has(`music:${name}`)) {
        try {
          const response = await fetch(`${folder}/${track.file}`);
          if (!response.ok) return false;
          decoded.set(`music:${name}`, [await context.decodeAudioData(await response.arrayBuffer())]);
        } catch {
          return false;
        }
      }

      this.stopMusic();
      const source = context.createBufferSource();
      [source.buffer] = decoded.get(`music:${name}`);
      source.loop = loop;
      source.connect(out);
      source.start();
      playing = source;
      return true;
    },

    stopMusic() {
      if (!playing) return;
      try {
        playing.stop();
      } catch {
        // Already finished on its own: nothing to stop.
      }
      playing = null;
    },
  };
}
