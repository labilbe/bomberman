/**
 * Dashboard: who is playing, with what, and where the match stands.
 *
 * In the DOM and not in the canvas. The canvas is scaled up by an integer factor
 * to keep pixels crisp; text scaled the same way would be illegible. And the DOM
 * gives for free what would have had to be rewritten: selectable text, screen
 * readers, and a reflow that works on a phone.
 *
 * The HUD never reads the rules: it is handed the state and the match, and it
 * displays them.
 */

import { placeColour } from '../render/palette.js';
import { MAX_BOMBS, MAX_RANGE, BASE_SPEED, SPEED_STEP, STEP_HZ } from '../engine/constants.js';
import { ILLNESSES, isIll } from '../engine/disease.js';
import { timeLeft, closing } from '../engine/enclosure.js';

/**
 * @param {HTMLElement} root
 */
export function createHud(root) {
  /** @type {Map<number, { block: HTMLElement, rounds: HTMLElement, powers: HTMLElement }>} */
  const rows = new Map();
  /** The round's clock, rebuilt with the rows. */
  let clock = null;

  /**
   * @param {number} places
   * @param {string[]} names
   * @param {number[] | null} colours colour index per place, when the players
   *   have chosen one — on the new-game screen, which also lays the table of a
   *   room, the relay then handing the same list to everybody. Without it, the
   *   place gives the colour.
   */
  function build(places, names, colours = null) {
    root.textContent = '';
    rows.clear();

    // THE CLOCK COMES FIRST, across the whole dashboard. It is not a player's
    // business, it is the round's: the arena starts closing when it runs out,
    // and a countdown nobody can see would make that look like the game
    // breaking down rather than the rule it is.
    clock = document.createElement('div');
    clock.className = 'clock';
    root.append(clock);

    for (let place = 0; place < places; place += 1) {
      const colour = placeColour(colours?.[place] ?? place);
      const block = document.createElement('div');
      block.className = 'player';
      block.style.setProperty('--colour', colour.vivid);

      const nameRow = document.createElement('div');
      nameRow.className = 'name';
      const name = document.createElement('span');
      name.textContent = names?.[place] ?? `Joueur ${place + 1}`;
      const rounds = document.createElement('span');
      rounds.className = 'rounds';
      nameRow.append(name, rounds);

      const powers = document.createElement('div');
      powers.className = 'powers';

      block.append(nameRow, powers);
      root.append(block);
      rows.set(place, { block, rounds, powers });
    }
  }

  /**
   * The illnesses, as the player reads them.
   *
   * Named after what they DO and not after the organ: 'Colique' says more at a
   * glance than the skull's own name, and the player has at most a second to
   * understand why their bombs are going off early.
   */
  const ILLNESS_LABELS = {
    [ILLNESSES.COLIC]: 'Colique',
    [ILLNESSES.SHORT]: 'Mèche courte',
    [ILLNESSES.TINY]: 'Flamme rabougrie',
    [ILLNESSES.SLOW]: 'Jambes de plomb',
    [ILLNESSES.RUSH]: 'Jambes folles',
  };

  /**
   * When the last seconds start being counted one by one.
   *
   * Ten seconds: long enough to come out of a corner and settle something, short
   * enough that the warning is not noise for two minutes.
   */
  const URGENT_SECONDS = 10;

  /**
   * The round's clock: what is left, then what is happening.
   *
   * Once the time is up the figure is replaced rather than left at zero. A
   * countdown stuck on 0:00 says nothing about what follows; the arena closing
   * in is the one thing the player has to read, since every corner of the board
   * is about to stop being one.
   */
  function showClock(step, limit) {
    if (!clock) return;
    const seconds = Math.ceil(timeLeft(step, limit) / STEP_HZ);
    const shutting = closing(step, limit);
    clock.classList.toggle('closing', shutting);
    clock.classList.toggle('urgent', !shutting && seconds <= URGENT_SECONDS);
    clock.textContent = shutting
      ? 'Le terrain se referme'
      : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  /** A bomber's powers, on one line legible at a glance. */
  function powersOf(player, step) {
    const speed = 1 + Math.round((player.speed - BASE_SPEED) / SPEED_STEP);
    const parts = [
      `<span>Bombes <b>${player.bombs}${player.bombs >= MAX_BOMBS ? ' max' : ''}</b></span>`,
      // The gold flame is said by its name and not by its number: its reach is
      // that of the arena, and "Flamme 15" would be a figure nobody can place
      // against a ceiling of eight.
      player.goldflame
        ? "<span>Flamme <b>d'or</b></span>"
        : `<span>Flamme <b>${player.range}${player.range >= MAX_RANGE ? ' max' : ''}</b></span>`,
      `<span>Vitesse <b>${speed}</b></span>`,
    ];
    if (player.kick) parts.push('<span class="on">Kick</span>');
    // Two gloves, told apart by their colour, exactly as the game tells them
    // apart: red throws what is in front of you, blue picks up what is under
    // your feet. "Gant" alone was enough while there was only one.
    if (player.glove) parts.push('<span class="on">Gant rouge</span>');
    if (player.grab) parts.push('<span class="on">Gant bleu</span>');
    if (player.jelly) parts.push('<span class="on">Goutte</span>');
    // 'Rafale' and not 'spooger': the pack is Interplay's, the gesture is the
    // player's, and what they read is what the double tap does.
    if (player.spooger) parts.push('<span class="on">Rafale</span>');
    if (player.goldflame) parts.push('<span class="on">Flamme d\'or</span>');
    // The trigger is a reserve, not a state: we show what is left of it. The
    // count is that of the DELAYED BOMBS left to drop, since the charge is taken
    // on the drop — without it, you drop one more than expected and discover at
    // the worst moment that it has a fuse.
    if (player.triggers) {
      parts.push(`<span class="on">Détonateur <b>${player.triggers}</b></span>`);
    }
    // The illness LAST and on its own class: it is the only line of this row
    // that is bad news, and it must not be read as one more power. The seconds
    // left are shown because they are the whole question — do I go and hand it
    // to somebody, or do I sit it out.
    if (isIll(player, step)) {
      const left = Math.ceil((player.illnessUntil - step) / STEP_HZ);
      const label = ILLNESS_LABELS[player.illness] ?? 'Maladie';
      parts.push(`<span class="ill">${label} <b>${left} s</b></span>`);
    }
    return parts.join('');
  }

  return {
    build,

    /**
     * @param {import('../engine/state.js').State} state
     * @param {import('../engine/round.js').Match} match
     */
    refresh(state, match) {
      showClock(state.step, state.timeLimit);
      for (const player of state.players) {
        const row = rows.get(player.place);
        if (!row) continue;
        row.block.classList.toggle('dead', !player.alive);
        const won = match?.scores?.[player.place] ?? 0;
        const toWin = match?.toWin ?? 0;
        row.rounds.textContent =
          toWin > 0 ? '★'.repeat(won) + '·'.repeat(Math.max(0, toWin - won)) : '';
        row.powers.innerHTML = powersOf(player, state.step);
      }
    },
  };
}

/**
 * The warning thrown across the board when the round's time runs out.
 *
 * Separate from the banner although both lie over the arena, because they are
 * opposites: the banner REPLACES the game for a moment — round, score, end of
 * match — while this one asks the player to look at the board. It shows itself
 * and takes itself away, and it is told nothing but "now".
 *
 * The word is the engine's cue and not a countdown of its own: it comes from
 * the `hurry` event, which the relay broadcasts like any other, so every screen
 * flashes it on the same step.
 *
 * @param {HTMLElement} element
 * @param {number} ms how long it stays up
 */
export function createFlash(element, ms = 2100) {
  let timer = null;

  return {
    /** @param {string} text */
    show(text) {
      if (!element) return;
      if (timer) clearTimeout(timer);
      element.textContent = text;
      element.hidden = false;
      // The animation is restarted by hand: shown twice in a row — two rounds
      // running out back to back — the class is already there and the browser
      // would not replay it.
      element.style.animation = 'none';
      void element.offsetWidth;
      element.style.animation = '';
      timer = setTimeout(() => {
        element.hidden = true;
        element.textContent = '';
      }, ms);
    },

    hide() {
      if (timer) clearTimeout(timer);
      if (element) {
        element.hidden = true;
        element.textContent = '';
      }
    },
  };
}

/**
 * Full-frame banner: round, score, end of match.
 *
 * @param {HTMLElement} element
 */
export function createBanner(element) {
  let timer = null;

  function hide() {
    element.hidden = true;
    element.textContent = '';
  }

  return {
    hide,

    /**
     * @param {{ title: string, detail?: string, duration?: number, buttons?: { text: string, action: () => void }[] }} content
     */
    show({ title, detail = '', duration = 0, buttons = [] }) {
      if (timer) clearTimeout(timer);
      element.textContent = '';
      const t = document.createElement('div');
      t.className = 'title';
      t.textContent = title;
      element.append(t);
      if (detail) {
        const d = document.createElement('div');
        d.className = 'detail';
        d.textContent = detail;
        element.append(d);
      }
      if (buttons.length > 0) {
        // The buttons go in a row of their own: stacked, "Démarrer" and
        // "Quitter" pushed the text out of the banner on a short screen.
        const row = document.createElement('div');
        row.className = 'buttons';
        for (const button of buttons) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'primary';
          b.textContent = button.text;
          b.addEventListener('click', button.action);
          row.append(b);
        }
        element.append(row);
      }
      element.hidden = false;
      if (duration > 0) timer = setTimeout(hide, duration);
    },
  };
}
