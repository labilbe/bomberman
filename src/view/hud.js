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
import { MAX_BOMBS, MAX_RANGE, BASE_SPEED, SPEED_STEP } from '../engine/constants.js';

/**
 * @param {HTMLElement} root
 */
export function createHud(root) {
  /** @type {Map<number, { block: HTMLElement, rounds: HTMLElement, powers: HTMLElement }>} */
  const rows = new Map();

  /**
   * @param {number} places
   * @param {string[]} names
   * @param {number[] | null} colours colour index per place, when the players
   *   have chosen one. Without it, the place gives the colour, as online where
   *   everyone is handed theirs on arrival.
   */
  function build(places, names, colours = null) {
    root.textContent = '';
    rows.clear();
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

  /** A bomber's powers, on one line legible at a glance. */
  function powersOf(player) {
    const speed = 1 + Math.round((player.speed - BASE_SPEED) / SPEED_STEP);
    const parts = [
      `<span>Bombes <b>${player.bombs}${player.bombs >= MAX_BOMBS ? ' max' : ''}</b></span>`,
      `<span>Flamme <b>${player.range}${player.range >= MAX_RANGE ? ' max' : ''}</b></span>`,
      `<span>Vitesse <b>${speed}</b></span>`,
    ];
    if (player.kick) parts.push('<span class="on">Kick</span>');
    // Two gloves, told apart by their colour, exactly as the game tells them
    // apart: red throws what is in front of you, blue picks up what is under
    // your feet. "Gant" alone was enough while there was only one.
    if (player.glove) parts.push('<span class="on">Gant rouge</span>');
    if (player.grab) parts.push('<span class="on">Gant bleu</span>');
    if (player.jelly) parts.push('<span class="on">Goutte</span>');
    // The trigger is a reserve, not a state: we show what is left of it. The
    // count is that of the DELAYED BOMBS left to drop, since the charge is taken
    // on the drop — without it, you drop one more than expected and discover at
    // the worst moment that it has a fuse.
    if (player.triggers) {
      parts.push(`<span class="on">Détonateur <b>${player.triggers}</b></span>`);
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
      for (const player of state.players) {
        const row = rows.get(player.place);
        if (!row) continue;
        row.block.classList.toggle('dead', !player.alive);
        const won = match?.scores?.[player.place] ?? 0;
        const toWin = match?.toWin ?? 0;
        row.rounds.textContent =
          toWin > 0 ? '★'.repeat(won) + '·'.repeat(Math.max(0, toWin - won)) : '';
        row.powers.innerHTML = powersOf(player);
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
