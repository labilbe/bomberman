/**
 * The only module that knows the DOM, the clock and the engine at once.
 *
 * Everything else is pure or specialised: the engine knows nothing of the
 * browser, the renderer decides nothing, the keyboard emits nothing, the
 * transport draws nothing. This page is where those four worlds meet, and that
 * is deliberate: when something does not work, there is only one file to look
 * in.
 */

import { createScene, START_SLOWNESS } from './render/scene.js';
import { loadVectors } from './render/vectors.js';
import { fromDrawings, fromVectors } from './render/spriteSet.js';
import { createKeyboard, KEYS } from './input/keyboard.js';
import { createGamepads } from './input/gamepads.js';
import { merge } from './input/merge.js';
import { createHud, createBanner } from './view/hud.js';
import { createLocalTransport } from './net/transport.js';
import { createOnlineTransport } from './net/online.js';
import { createSounds } from './audio/sounds.js';
import { createPilot } from './ai/pilot.js';
import { randomSeed } from './engine/rng.js';
import { MAX_PLAYERS, STEP_MS } from './engine/constants.js';
import { placeColour, PLACES } from './render/palette.js';
import {
  randomRoom,
  cleanRoom,
  cleanName,
  randomName,
  HUMAN_NAMES,
  BOT_NAMES,
  NAME_MAX,
  MIN_PLACES,
  MAX_PLACES,
  cleanColours,
  preferColour,
} from './net/protocol.js';

const menu = document.querySelector('#menu');
const game = document.querySelector('#game');
const canvas = document.querySelector('#canvas');
const arena = document.querySelector('#arena');
const nicknameInput = document.querySelector('#nickname');
const roomInput = document.querySelector('#room');
const playersSelect = document.querySelector('#players');
const seatsList = document.querySelector('#seats');
const formatSelect = document.querySelector('#format');
const colourSelect = document.querySelector('#colour');
const defaultRoomInput = document.querySelector('#default-room');
const netPlayersSelect = document.querySelector('#net-players');
const netSeatsList = document.querySelector('#net-seats');
const createRoomInput = document.querySelector('#create-room');
const playLocalButton = document.querySelector('#play-local');
const playOnlineButton = document.querySelector('#play-online');
const createOnlineButton = document.querySelector('#play-create');
const quitButton = document.querySelector('#quit');
const netState = document.querySelector('#net-state');
const track = document.querySelector('#track');
const screens = [...document.querySelectorAll('.screen')];

const PREF_NICKNAME = 'bomberman.nickname';
const PREF_ROOM = 'bomberman.room';
const PREF_PLAYERS = 'bomberman.players';
const PREF_SEATS = 'bomberman.seats';
const PREF_FORMAT = 'bomberman.format';
const PREF_NET_SEATS = 'bomberman.netSeats';
const PREF_COLOUR = 'bomberman.colour';

/**
 * The keys this page used to write, when the code was in French.
 *
 * They are already on the players' machines: dropping them would silently reset
 * everyone's nickname, colours and controls. So they are read once, copied under
 * their English name, and erased. This table is the only thing left to delete
 * the day nobody has an old browser profile any more.
 */
const OLD_PREFS = [
  ['bomberman.pseudo', PREF_NICKNAME],
  ['bomberman.salon', PREF_ROOM],
  ['bomberman.joueurs', PREF_PLAYERS],
  ['bomberman.sieges', PREF_SEATS],
];

/** Tolerant reading of storage: a browser in private mode refuses it. */
function readPref(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Never mind: the preference will not survive the tab being closed.
  }
}

/**
 * Moves the preferences written under the old French names.
 *
 * Done before anything reads them, and only when the new name is still empty: a
 * setting changed since the rename must not be overwritten by the one from
 * before.
 */
function migratePrefs() {
  for (const [old, now] of OLD_PREFS) {
    try {
      const value = localStorage.getItem(old);
      if (value !== null && localStorage.getItem(now) === null) localStorage.setItem(now, value);
      localStorage.removeItem(old);
    } catch {
      // Storage refused: there is nothing to migrate, and nothing to lose.
    }
  }
}

migratePrefs();

/**
 * Atomic Bomberman's sprites if they have been extracted, otherwise those
 * painted in code.
 *
 * The await is at the top of the module, before anything is built: the cell size
 * depends on the sprite set, so the scene cannot be born before knowing which
 * one it will have. A freshly cloned repository has no assets and goes straight
 * to the drawn sprites — that is the normal case, not a breakdown.
 */
const vectors = await loadVectors().catch((error) => {
  // We fall back on the drawn sprites, but not silently: a silent fallback gives
  // a game that works and an extraction you believe is plugged in.
  console.warn('sprites vectoriels indisponibles, repli sur le dessin au code', error);
  return null;
});
const spriteSet = vectors ? fromVectors(vectors) : fromDrawings();
const scene = createScene(canvas, spriteSet);
const hud = createHud(document.querySelector('#hud'));
const banner = createBanner(document.querySelector('#banner'));
const keyboard = createKeyboard({ count: KEYS.length });
const gamepads = createGamepads({ count: KEYS.length });

/**
 * The intent of a local seat, keyboard and gamepad taken together.
 *
 * BOTH sources are read on every frame, even when only one is in use. That is
 * necessary, not wasteful: their pulses are consumed on reading, so skipping the
 * one that looks idle would lose the bomb dropped at the very moment the player
 * changes hands.
 */
const localIntent = (seat) => merge(keyboard.read(seat), gamepads.read(seat));
const sounds = createSounds();
const soundButton = document.querySelector('#sound');

/**
 * What can drive a bomber, and where to read it.
 *
 * A control is a SOURCE OF INTENT, not a setting: keyboard and gamepad are read
 * the same way, and the bot is not one of them — it is the engine that plays for
 * it. So the list is short and closed, and the frame loop only has to ask each
 * one for `read()`.
 */
const CONTROLS = [
  { code: 'clavier1', label: 'Clavier 1', read: () => keyboard.read(0) },
  { code: 'clavier2', label: 'Clavier 2', read: () => keyboard.read(1) },
  { code: 'manette1', label: 'Manette 1', read: () => gamepads.read(0), gamepad: 0 },
  { code: 'manette2', label: 'Manette 2', read: () => gamepads.read(1), gamepad: 1 },
  { code: 'bot', label: 'Bot' },
];

const controlOf = (code) => CONTROLS.find((choice) => choice.code === code) ?? null;

/**
 * A run of sprites redrawn on ONE canvas size, each frame kept on its anchor.
 *
 * THE BOMB SWELLS, and that swelling IS the animation: its frames go from 22 to
 * 37 pixels as it breathes in. In the arena the sprite is drawn at its own size,
 * standing on its anchor, so it is seen to grow. In the menu it is a CSS
 * background fitted with `contain`, which brings EVERY frame back to the same
 * box: the growth was divided straight out, and what was left was a wobble —
 * worse, the fattest frames, being shrunk the most, read as the smallest. That
 * is the difference with the game that was reported, and no change of rate could
 * have fixed it, since it is not a matter of timing.
 *
 * So each frame is laid on the box the whole run needs, placed BY ITS ANCHOR,
 * which for a bomb is its bottom centre — exactly where the scene puts it. Every
 * frame then carries the same scale, and `contain` has nothing left to correct.
 *
 * @param {{ canvas: HTMLCanvasElement, anchorX?: number, anchorY?: number }[]} run
 * @returns {HTMLCanvasElement[]}
 */
function onOneCanvas(run) {
  if (run.length === 0) return [];
  // The anchor, or the bottom centre: the sprites drawn in code carry one too,
  // but a provider that did not would still be laid the right way up.
  const anchorX = (sprite) => sprite.anchorX ?? sprite.canvas.width / 2;
  const anchorY = (sprite) => sprite.anchorY ?? sprite.canvas.height;
  const most = (measure) => Math.max(...run.map(measure));
  const left = most(anchorX);
  const right = most((sprite) => sprite.canvas.width - anchorX(sprite));
  const top = most(anchorY);
  const bottom = most((sprite) => sprite.canvas.height - anchorY(sprite));

  return run.map((sprite) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(left + right);
    canvas.height = Math.ceil(top + bottom);
    // Rounded: the frames are pixel art, enlarged by the page with
    // `image-rendering: pixelated`, and half a pixel of offset blurs a whole
    // edge.
    canvas.getContext('2d').drawImage(
      sprite.canvas,
      Math.round(left - anchorX(sprite)),
      Math.round(top - anchorY(sprite)),
    );
    return canvas;
  });
}

/**
 * THE MENU'S BOMB BEATS EXACTLY LIKE THE ONE YOU DROP.
 *
 * It is the trigger bomb — the one carrying "BOOM" across it — and these are its
 * own frames, the ones the scene draws in the arena: the menu and the game
 * therefore show exactly the same object. It is GREEN, like the bomber on the
 * screen: it is the colour in the file, the one before the per-player
 * recolouring.
 *
 * THE BEAT IS THE SCENE'S, down to the formula: the frame is READ OFF THE CLOCK
 * — `bombCycle` for a whole run, a run and a half at the start of a fuse — and
 * not advanced one step per timer tick. That is what the arena does for a bomb
 * with no fuse, and the two are now in phase: the bomb of the row you are on
 * shows the frame a bomb dropped at that instant would show.
 *
 * It used to run on a `setInterval` of its own, clamped to sixty milliseconds a
 * frame: eighteen frames at that pace made a beat of 1080 ms, where the game's
 * is 810 — the home screen's bomb lagged a third behind the one you drop, and
 * that is what was reported. The clamp was there to keep the timer from
 * outrunning the screen; reading the clock makes it pointless, since a frame
 * drawn twice is a frame drawn twice and not a beat lost.
 *
 * A bomb with a fuse ACCELERATES as it burns down, and this one does not: it
 * never goes off, and looping an acceleration would make it stall every run.
 * The arena answers the same question the same way for the trigger bomb.
 *
 * The frames go through a CSS variable rather than through an animated element:
 * the marker is a pseudo-element laid on EVERY row, and a variable set once on
 * the root serves them all at a stroke, visible or not.
 *
 * The beat stops during a game: nothing is watching it, and a loop running for
 * nobody is one loop too many.
 */
function animateMenuBomb() {
  const run =
    spriteSet.menuBomb ?? spriteSet.bombTrigger?.[0] ?? spriteSet.bomb?.[0] ?? [];
  const frames = onOneCanvas(run).map((canvas) => `url(${canvas.toDataURL()})`);
  if (frames.length === 0) return;

  const duration = (spriteSet.bombCycle ?? 660) * START_SLOWNESS;
  let beating = false;
  /** The frame on screen: setting the variable again for nothing costs a repaint. */
  let shown = -1;

  const beat = (time) => {
    if (!beating) return;
    const frame = Math.floor((time / duration) * frames.length) % frames.length;
    if (frame !== shown) {
      shown = frame;
      document.documentElement.style.setProperty('--bomb', frames[frame]);
    }
    requestAnimationFrame(beat);
  };

  const follow = () => {
    const onMenu = !menu.hidden;
    if (onMenu === beating) return;
    beating = onMenu;
    // The same clock as the render loop's, which is handed `requestAnimationFrame`'s
    // own stamp: that is what puts the menu and the arena in phase rather than
    // merely at the same pace.
    if (beating) requestAnimationFrame(beat);
  };

  follow();
  // The menu opens and closes through several paths — end of match, departure,
  // network cut — and watching them all would amount to listing them here. So we
  // watch the attribute, which is the only thing they have in common.
  new MutationObserver(follow).observe(menu, { attributes: true, attributeFilter: ['hidden'] });
}

animateMenuBomb();

/**
 * Builds the sprite series of the chosen colours in advance.
 *
 * They are assembled on demand — the game offers ten, a game never shows more
 * than four — and without this wake-up, the round's first frame would pay for
 * the recolouring, some sixty milliseconds per colour. Worse: the DEATH series
 * would only be claimed the moment somebody dies, and the game would stutter at
 * the worst possible instant.
 *
 * So we do it here, with the menu screen still up, where nobody is counting
 * frames.
 *
 * @param {number[]} colours colour indexes, one per place
 */
function warmUpColours(colours) {
  for (const colour of new Set(colours)) {
    // A plain access is enough: these are accessors that build themselves then
    // replace themselves with their result.
    void spriteSet.bombers?.[colour];
    void spriteSet.idle?.[colour];
    void spriteSet.dead?.[colour];
    void spriteSet.punches?.[colour];
    void spriteSet.bomb?.[colour];
    void spriteSet.bombTrigger?.[colour];
    void spriteSet.flame?.[colour];
  }
}

/** The game in progress, or null when we are in the menu. */
let session = null;

/**
 * Scales the arena to the room available.
 *
 * An INTEGER factor would be ideal — pixels all of the same width — but it is
 * out of reach in practice: the arena is 416 pixels tall, so factor 2 asks for
 * 832 pixels for it alone, which a laptop screen does not have once the header
 * and the dashboard are in place. The game would stay tiny in the middle of an
 * empty screen.
 *
 * So we take the exact factor that fills the room, and snap it to the integer
 * when it comes very close. The rendering stays crisp: `image-rendering:
 * pixelated` never interpolates, it duplicates — one pixel may be a row wider
 * than its neighbour, but none is blurred. And on a screen with a display factor
 * of 1.25 or 1.5, like most Windows screens, an integer factor in CSS was not an
 * integer in real pixels anyway.
 */
const MAX_SCALE = 3;

function adjustScale() {
  // The width is measured on the PARENT, never on the arena's frame: that one
  // sizes itself on the canvas it contains, and measuring it amounted to asking
  // the canvas what size it wanted to be — it never grew.
  const availableWidth = Math.max(240, (arena.parentElement?.clientWidth ?? 0) - 40);
  const availableHeight = Math.max(200, window.innerHeight - arena.getBoundingClientRect().top - 96);
  const raw = Math.min(availableWidth / scene.width, availableHeight / scene.height, MAX_SCALE);
  const near = Math.round(raw);
  const factor = Math.max(1, Math.abs(raw - near) < 0.08 ? near : raw);
  canvas.style.width = `${Math.round(scene.width * factor)}px`;
  canvas.style.height = `${Math.round(scene.height * factor)}px`;
}

window.addEventListener('resize', () => {
  if (session) adjustScale();
});

/**
 * Slides the track onto the requested screen.
 *
 * The screen is SHOWN BEFORE the slide and hidden AFTER the return: the track is
 * as tall as the taller of its two sides, so a manual left in place would
 * reserve its height under a six-line list.
 *
 * The focus follows, failing which the keyboard would stay on a row that has
 * just left the screen — you would tab into the void.
 */
function openScreen(name) {
  const target = document.querySelector(`#screen-${name}`);
  if (!target) return;
  if (name === 'join' || name === 'create') proposeRooms();
  // The nickname may have been changed in the options since the rows were built:
  // the first row wears it, so it is re-read here rather than at the start.
  if (name === 'game') refreshProposals();
  for (const screen of screens) screen.hidden = screen !== target;
  // `data-screen` on the track, `data-open` on the rows, and the two names must
  // STAY DIFFERENT: the click handler walks up from whatever was clicked looking
  // for `[data-open]`, so a track carrying the same attribute answered for the
  // "Retour" button inside it — and going back reopened the screen instead.
  track.dataset.screen = name;
  // The focus goes to THE SCREEN and not to its first field: placed in a text
  // field, Backspace deletes a character there instead of going back, and the
  // arrow keys belong to the drop-down list you have just reached. From the
  // screen, Tab leads to the settings when you want them.
  target.tabIndex = -1;
  target.focus({ preventScroll: true });
}

function closeScreen({ focus = true } = {}) {
  const open = track.dataset.screen;
  if (!open) return;
  delete track.dataset.screen;
  const row = document.querySelector(`[data-open="${open}"]`);
  if (focus) row?.focus({ preventScroll: true });

  const hide = () => {
    // Another screen may have opened in the meantime: we only hide when the
    // track really has come back to the list.
    if (track.dataset.screen) return;
    for (const screen of screens) screen.hidden = true;
  };
  const animated = getComputedStyle(track).transitionDuration !== '0s';
  if (animated) track.addEventListener('transitionend', hide, { once: true });
  else hide();
}

track?.addEventListener('click', (event) => {
  const row = event.target.closest('[data-open]');
  if (row) {
    sounds.wake();
    openScreen(row.dataset.open);
    return;
  }
  if (event.target.closest('.back')) closeScreen();
});

/*
 * THE MOUSE MOVES THE SELECTION, it does not merely highlight on the way past.
 *
 * The bomb used to follow both the hover and the focus: hovering one row while
 * another was chosen showed TWO of them, and nothing said any more which one
 * Enter was going to confirm. By giving the focus to the row hovered, the mouse
 * and the keyboard drive the same thing, and there is only one bomb on screen.
 */
track?.addEventListener('mouseover', (event) => {
  const row = event.target.closest('.row');
  if (row && row !== document.activeElement) row.focus({ preventScroll: true });
});

/**
 * The menu's keyboard: the ARROWS walk the list, ENTER confirms, BACKSPACE and
 * ESCAPE bring you back to it.
 *
 * The arrows only count on the list, and outside a field: within an open screen
 * they belong to the drop-down lists, which use them to change value. Taking
 * them away would make a menu where you can no longer choose your colour with
 * the keyboard.
 */
window.addEventListener('keydown', (event) => {
  if (menu.hidden) return;
  const inAField = /^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName ?? '');

  if (event.key === 'Escape') {
    closeScreen();
    return;
  }

  // Backspace: the game's gesture for going up one screen. Not from a field,
  // where it deletes a character — that is its first job, and the room code is
  // corrected with it.
  if (event.key === 'Backspace' && !inAField) {
    event.preventDefault();
    closeScreen();
    return;
  }

  // ENTER AND SPACE CONFIRM, and it is the page that has to see to it: those two
  // keys belong to the game — trigger and bomb — so the engine's keyboard
  // neutralises them from the menu on, which kept the focused button from
  // activating by itself as it otherwise would have.
  //
  // On a button only: in a field, Enter submits a form and Space writes a space,
  // and neither must start a game.
  if (event.key === 'Enter' || event.key === ' ') {
    const target = document.activeElement;
    if (!inAField && target?.tagName === 'BUTTON' && !target.disabled) {
      event.preventDefault();
      target.click();
    }
    return;
  }

  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  if (track?.dataset.screen) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName ?? '')) return;

  const rows = [...document.querySelectorAll('.choices .row')];
  if (rows.length === 0) return;
  event.preventDefault();
  const current = rows.indexOf(document.activeElement);
  const step = event.key === 'ArrowDown' ? 1 : -1;
  // From anywhere else, the first arrow takes the top or the bottom of the list
  // depending on its direction, rather than jumping arbitrarily to the first
  // entry.
  const next =
    current === -1
      ? (step === 1 ? 0 : rows.length - 1)
      : (current + step + rows.length) % rows.length;
  rows[next].focus();
});

/**
 * Puts the bomb on "Lancer une partie" when nothing is chosen.
 *
 * The marker follows the focus: with no focus, no row is marked and the menu
 * looks dead. We force nothing when a row is already chosen — the mouse hovering
 * a row, or the arrow just pressed, have the upper hand.
 */
function selectByDefault() {
  if (menu.hidden) return;
  if (document.activeElement?.closest?.('.choices .row')) return;
  document.querySelector('.choices .row')?.focus({ preventScroll: true });
}

function showMenu() {
  // We always come back to the list: keeping the launch screen open after a game
  // would suggest another one is being started.
  closeScreen({ focus: false });
  menu.hidden = false;
  game.hidden = true;
  banner.hide();
  netState.textContent = '';
  selectByDefault();
}

function stopSession() {
  if (!session) return;
  cancelAnimationFrame(session.frame);
  session.transport.close();
  session = null;
  keyboard.forget();
  gamepads.forget();
  // The menu music only starts HERE, on coming back: when the page loads the
  // audio context does not exist yet, and the browser would refuse to start it
  // without a gesture. Somebody who clicks "Jouer" straight away therefore never
  // downloads it.
  sounds.menuMusic();
  showMenu();
}

/** A place's label, for the HUD and the banners. */
function nameOf(place, humans, names, colours = null) {
  if (names?.[place]) return names[place];
  const tint = placeColour(colours?.[place] ?? place);
  if (place < humans) return `${tint.name} — vous`;
  return tint.name;
}

/**
 * Builds one row per player: its colour, and what drives it.
 *
 * The rows are REBUILT on every change rather than updated: there are four at
 * most, and a rebuild keeps the list of controls in step with the hardware
 * plugged in at that instant — an unplugged gamepad must disappear from the
 * choice, not sit there waiting.
 *
 * The choices already made are read back before the rows are rebuilt: so player
 * 3's colour is not lost because player 1 took a gamepad.
 */
/**
 * Where the drawn names start, for this page load.
 *
 * Drawn ONCE and not at each build: the list of rows is rebuilt on the slightest
 * change — a colour swapped, a gamepad plugged in — and names that reshuffled
 * under the hand would look like a field clearing itself. Two games in a row
 * still do not have the same cast, which is the point of the draw.
 */
const NAME_START = Math.floor(Math.random() * HUMAN_NAMES.length);
const BOT_START = Math.floor(Math.random() * BOT_NAMES.length);

/**
 * The name offered to a row that has not been named.
 *
 * The first human takes the nickname from the options — it is the one holding
 * the keyboard, and they have already said what they are called. The others are
 * drawn, from two lists that share nothing: at a glance in a four-way scrum, a
 * bot's first name is not a human's.
 *
 * Indexed BY PLACE and not by rank among the humans, so that turning row 2 into
 * a bot does not rename row 3.
 */
function proposedName(place, control, first) {
  if (control === 'bot') return BOT_NAMES[(BOT_START + place) % BOT_NAMES.length];
  const drawn = HUMAN_NAMES[(NAME_START + place) % HUMAN_NAMES.length];
  if (place === first) return cleanName(nicknameInput.value, drawn);
  return drawn;
}

/**
 * Rewrites the names nobody has typed.
 *
 * Called rather than rebuilding the rows, because this happens WHILE the player
 * is in a drop-down list: rebuilding would take the focus away from the select
 * they have just used.
 */
function refreshProposals() {
  const rows = [...seatsList.querySelectorAll('.seat')];
  const controls = rows.map((row) => row.querySelector('.control').value);
  const first = controls.findIndex((code) => code !== 'bot');
  rows.forEach((row, place) => {
    const nick = row.querySelector('.nick');
    if (nick.dataset.typed) return;
    nick.value = proposedName(place, controls[place], first);
  });
}

function buildSeats() {
  const count = Math.max(2, Math.min(MAX_PLAYERS, Number(playersSelect.value) || 2));
  const previous = readSeats();
  const connected = gamepads.howMany();
  // A gamepad we do not have cannot drive a row: the control falls back to a bot,
  // and it has to be known BEFORE the rows are built, since it is what decides
  // which name each one is offered.
  const usable = (code) =>
    CONTROLS.some(
      (choice) => choice.code === code && (choice.gamepad === undefined || choice.gamepad < connected),
    );
  const controls = Array.from({ length: count }, (_, place) => {
    const wanted = previous[place]?.control ?? (place === 0 ? 'clavier1' : 'bot');
    return usable(wanted) ? wanted : 'bot';
  });
  // Two bombers of the same colour cannot be told apart: the first row to ask
  // for it gets it, the following ones take the first one free.
  const taken = new Set();
  const assign = (wanted) => {
    if (Number.isInteger(wanted) && !taken.has(wanted) && wanted < PLACES.length) {
      taken.add(wanted);
      return wanted;
    }
    for (let i = 0; i < PLACES.length; i += 1) {
      if (taken.has(i)) continue;
      taken.add(i);
      return i;
    }
    return 0;
  };

  // THE FIRST ROW IS YOURS. It wears what you picked on it, or failing that the
  // colour from the options. Claimed BEFORE the others are handed out, so the
  // row that had it falls back on the next free colour rather than the other
  // way round.
  const mine = firstRowColour('local', previous[0]?.colour);
  assign(mine);

  seatsList.textContent = '';
  for (let place = 0; place < count; place += 1) {
    const old = previous[place] ?? {};
    const rowTint = place === 0 ? mine : assign(old.colour ?? place);
    const row = document.createElement('li');
    row.className = 'seat';

    const dot = document.createElement('span');
    dot.className = 'dot';

    const label = document.createElement('span');
    label.className = 'seat-name';
    label.textContent = `Joueur ${place + 1}`;

    // A NAME TYPED BY HAND IS KEPT, a name merely offered is replaced: that is
    // what `typed` marks. Without it the drawn name would be remembered as a
    // choice, and the nickname from the options would never reach the first row
    // again — the same rule as the room fields, which remember what they
    // proposed.
    const nick = document.createElement('input');
    nick.className = 'nick';
    nick.type = 'text';
    nick.maxLength = NAME_MAX;
    nick.autocomplete = 'off';
    nick.spellcheck = false;
    if (old.name) {
      nick.value = old.name;
      nick.dataset.typed = '1';
    }
    nick.addEventListener('change', () => {
      nick.value = cleanName(nick.value, '');
      // Emptying the field hands the row back to the draw rather than leaving a
      // nameless bomber.
      if (nick.value === '') delete nick.dataset.typed;
      else nick.dataset.typed = '1';
      refreshProposals();
      rememberSeats();
    });

    const colour = colourPicker({ list: seatsList, dot, start: rowTint, remember: rememberSeats });

    const control = document.createElement('select');
    control.className = 'control';
    for (const choice of CONTROLS) {
      // A gamepad we do not have is not offered: it would never answer, and you
      // would think the game broken rather than the gamepad absent.
      if (choice.gamepad !== undefined && choice.gamepad >= connected) continue;
      const option = document.createElement('option');
      option.value = choice.code;
      option.textContent = choice.label;
      control.append(option);
    }
    control.value = controls[place];

    // Changing the control changes who is a human and who is a bot, therefore
    // the names offered: a row that becomes a bot takes a bot's first name.
    control.addEventListener('change', () => {
      refreshProposals();
      rememberSeats();
    });

    row.append(dot, label, wrap('Nom', nick), wrap('Couleur', colour), wrap('Commande', control));
    seatsList.append(row);
  }

  // After the rows, since the proposal of one depends on the controls of all.
  refreshProposals();
}

/**
 * The colour selector of one row, tied to its dot and to its neighbours.
 *
 * Shared by the two screens that lay out an arena — the local launch and the
 * network creation — because they ask exactly the same question, and the swap
 * below is a rule, not a decoration.
 *
 * Two bombers of the same colour cannot be told apart in play. Rather than
 * refusing the choice, we SWAP with whoever had it: that is what the game's own
 * selection screen does, and nobody has a mistake to correct.
 *
 * The colour handed back is the one this row carried AT THAT INSTANT, kept up to
 * date in `held`: reading it back from the preferences gave a THIRD colour, the
 * one from before the last game, and the swap was no longer one.
 *
 * @param {{ list: HTMLElement, dot: HTMLElement, start: number, remember: () => void }} options
 */
function colourPicker({ list, dot, start, remember }) {
  const colour = document.createElement('select');
  colour.className = 'colour';
  PLACES.forEach((tint, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = tint.name;
    colour.append(option);
  });
  colour.value = String(start);

  const paint = () => {
    dot.style.background = placeColour(Number(colour.value)).vivid;
  };
  paint();

  let held = start;
  colour.addEventListener('change', () => {
    const chosen = Number(colour.value);
    for (const other of list.querySelectorAll('.colour')) {
      if (other === colour || Number(other.value) !== chosen) continue;
      other.value = String(held);
      other.dispatchEvent(new Event('swap'));
    }
    held = chosen;
    paint();
    remember();
  });
  // The swap repaints the yielding row without restarting the search, which
  // would bounce from one row to the next.
  colour.addEventListener('swap', () => {
    held = Number(colour.value);
    paint();
  });

  return colour;
}

/**
 * The colour one prefers to play, as the options hold it.
 *
 * It dresses the FIRST ROW of the two screens that lay out an arena, and is
 * asked of the relay when one joins somebody else's. White failing anything —
 * the first colour of the game's own list, which is what the first place wore
 * before the option existed.
 */
function preferredColour() {
  const colour = Number(readPref(PREF_COLOUR, '0'));
  return Number.isInteger(colour) && colour >= 0 && colour < PLACES.length ? colour : 0;
}

/**
 * The preferred colour as each seat screen last offered it: 'local' for the
 * launch screen, 'net' for the creation screen.
 *
 * It starts at the option's own value, because LOADING THE PAGE IS NOT CHANGING
 * THE OPTION: the rows remember what the player last chose — the option
 * included, since choosing it writes the rows down — so taking them over again
 * on every load would undo, one refresh later, the very choice this rule is
 * there to protect.
 */
const offered = { local: preferredColour(), net: preferredColour() };

/**
 * What the first row — yours — should wear.
 *
 * THE OPTION IS A DEFAULT, NOT AN ORDER, and that is the difference with the
 * default room, whose rule this followed at first. A room code is typed on
 * another screen and is a one-off; a colour is picked on the very list that is
 * about to be played, row by row, deliberately. Forcing the option back onto
 * the first row at every rebuild took that choice away — changing the number of
 * players was enough to lose it, and the game then started in a colour nobody
 * had asked for.
 *
 * So the option takes the row as long as nobody has moved it, AND AGAIN the
 * moment it is changed in the options, since it then differs from what was last
 * offered. That is what makes the option visibly alive without it overruling a
 * choice made two seconds earlier on the row itself.
 *
 * @param {'local' | 'net'} screen
 * @param {number | null | undefined} chosen the colour that row already wears
 */
function firstRowColour(screen, chosen) {
  const wanted = preferredColour();
  if (offered[screen] === wanted && typeof chosen === 'number') return chosen;
  offered[screen] = wanted;
  return wanted;
}

/** A field dressed in its label, like those of the options. */
function wrap(title, control) {
  const label = document.createElement('label');
  label.className = 'field';
  const span = document.createElement('span');
  span.textContent = title;
  label.append(span, control);
  return label;
}

/**
 * What the launch screen says, row by row.
 *
 * `name` is what was TYPED — empty when the row wears an offered name — and
 * `label` what the bomber will be called either way. The first is what gets
 * remembered, the second what the game is given.
 */
function readSeats() {
  return [...seatsList.querySelectorAll('.seat')].map((row, place) => {
    const nick = row.querySelector('.nick');
    return {
      colour: Number(row.querySelector('.colour').value),
      control: row.querySelector('.control').value,
      name: nick?.dataset.typed ? nick.value : '',
      label: cleanName(nick?.value ?? '', `Joueur ${place + 1}`),
    };
  });
}

function rememberSeats() {
  const seats = readSeats();
  writePref(
    PREF_SEATS,
    JSON.stringify(seats.map(({ colour, control, name }) => ({ colour, control, name }))),
  );
  writePref(PREF_PLAYERS, String(seats.length));
}

/**
 * The seats of a room being created: what colour each place wears, who waits for
 * a human and who is a bot.
 *
 * THE COLOURS ARE SETTLED HERE, BEFORE THE ROOM EXISTS, and that is why they can
 * be chosen at all: they leave with the arrival that opens the room, the relay
 * cleans them up and announces them, and every screen then draws the same
 * arena. Offering the choice later — on each player's own screen, in the waiting
 * room — would have let two players swap colours between themselves, and one
 * would be aiming at a green bomber the other sees as red.
 *
 * Whoever joins therefore chooses nothing: they take the colour of the seat they
 * are given, and the waiting room tells them which one it is. That is the price
 * of a single arena, and it is the same price the original game paid — the
 * colours belong to the table, not to the guests.
 *
 * The first row is you, and that much is not a choice: whoever lays the table
 * sits at it. It is shown all the same, so that the list reads as the arena will
 * look — four rows, four corners, four colours.
 */
function buildNetSeats() {
  const count = Math.max(MIN_PLACES, Math.min(MAX_PLACES, Number(netPlayersSelect.value) || MIN_PLACES));
  const previous = readNetSeats();
  // The defaults, and the repair of a remembered list that no longer fits —
  // the same rule as the relay's, from the same function: every place gets a
  // colour, and no two get the same one. The first place is yours, and the
  // others move aside for it.
  const tints = cleanColours(
    [firstRowColour('net', previous[0]?.colour), ...previous.slice(1).map((seat) => seat.colour)],
    count,
  );

  netSeatsList.textContent = '';
  for (let place = 0; place < count; place += 1) {
    const row = document.createElement('li');
    row.className = 'seat';

    const dot = document.createElement('span');
    dot.className = 'dot';

    const label = document.createElement('span');
    label.className = 'seat-name';
    label.textContent = `Joueur ${place + 1}`;

    const colour = colourPicker({
      list: netSeatsList,
      dot,
      start: tints[place],
      remember: rememberNetSeats,
    });

    row.append(dot, label, wrap('Couleur', colour));

    if (place === 0) {
      const mine = document.createElement('span');
      mine.className = 'seat-you';
      mine.textContent = 'Vous';
      row.append(mine);
    } else {
      const control = document.createElement('select');
      control.className = 'control';
      for (const [value, text] of [['human', 'Joueur en réseau'], ['bot', 'Bot']]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        control.append(option);
      }
      control.value = previous[place] === 'bot' ? 'bot' : 'human';
      control.addEventListener('change', rememberNetSeats);
      row.append(wrap('Commande', control));
    }

    netSeatsList.append(row);
  }
}

/**
 * What the creation screen says, row by row: its colour, and whether the seat
 * waits for a human or is a bot.
 *
 * @returns {{ control: 'human' | 'bot', colour: number }[]}
 */
function readNetSeats() {
  const rows = [...netSeatsList.querySelectorAll('.seat')];
  if (rows.length === 0) {
    // Before the first build — the join screen asks too, for the number of
    // places — the remembered list stands in. Failing that, a room for two: the
    // smallest thing that is a game.
    try {
      const remembered = JSON.parse(readPref(PREF_NET_SEATS, '[]'));
      if (Array.isArray(remembered) && remembered.length >= MIN_PLACES) {
        return remembered.map(netSeat);
      }
    } catch {
      // Unreadable preference: the default below is just as good.
    }
    return [netSeat('human'), netSeat('human')];
  }
  return rows.map((row, place) => ({
    // The first row is the host's, and it is never a bot: whoever lays the table
    // sits at it.
    control: place > 0 && row.querySelector('.control')?.value === 'bot' ? 'bot' : 'human',
    colour: Number(row.querySelector('.colour').value),
  }));
}

/**
 * One remembered row, whatever shape it was written in.
 *
 * The preference used to be a plain list of 'human' and 'bot', before the
 * colours could be chosen: a profile that has not played since still holds one,
 * and reading it as an object gave a screen of undefined colours. A string is
 * therefore still understood — the colour then comes from the place, which is
 * exactly what that version did.
 */
function netSeat(remembered) {
  const control = (typeof remembered === 'string' ? remembered : remembered?.control) === 'bot'
    ? 'bot'
    : 'human';
  const colour = Number(remembered?.colour);
  return { control, colour: Number.isInteger(colour) ? colour : null };
}

function rememberNetSeats() {
  writePref(PREF_NET_SEATS, JSON.stringify(readNetSeats()));
}

/**
 * Starts a local game, as the launch screen describes it.
 *
 * Each row gives a bomber: its colour, and what drives it — a set of keys, a
 * gamepad, or nobody, in which case the engine plays for it. The bots keep
 * increasing levels, so that a four-way game has a slope rather than a wall.
 */
function playLocal() {
  stopSession();

  const seats = readSeats();
  const places = seats.length;
  const format = Number(formatSelect.value) || 3;
  rememberSeats();
  writePref(PREF_FORMAT, String(format));
  writePref(PREF_NICKNAME, cleanName(nicknameInput.value, nicknameInput.value));

  const levels = ['quiet', 'normal', 'nasty'];
  const pilots = {};
  const sources = {};
  const names = [];
  const colours = seats.map((seat) => seat.colour);
  let botRank = 0;
  let humanRank = 0;

  for (let place = 0; place < places; place += 1) {
    const choice = controlOf(seats[place].control);
    // EVERY NAME COMES FROM ITS ROW, typed there or offered there. The screen
    // showed it before the game started: announcing another one in the HUD would
    // make a liar of the field one has just filled in.
    names[place] = seats[place].label;
    if (!choice || choice.code === 'bot') {
      pilots[place] = createPilot({ level: levels[botRank % levels.length] });
      botRank += 1;
      continue;
    }
    sources[place] = choice.read;
    humanRank += 1;
  }

  const transport = createLocalTransport({
    seed: randomSeed(),
    places,
    humans: humanRank,
    format,
    pilots,
  });

  startSession(transport, { places, names, sources, colours });
}

/**
 * Plugs a transport into the screen, the keyboard and the render loop. The same
 * code will serve the online game: only the transport changes.
 */
async function startSession(transport, { humans = 1, places, names, sources = null, colours = null }) {
  // THE SESSION EXISTS AS SOON AS THE TRANSPORT IS CREATED, and not when the
  // first arena arrives. Online, `start()` only returns once the room is full: as
  // long as we are waiting for an opponent, a session set further down would not
  // exist yet, `stopSession()` would return without doing anything, and a second
  // click on "Jouer en ligne" would open a SECOND connection without closing the
  // first. Each took a seat, and the room filled up with the same player
  // repeated.
  //
  // The token tells sessions apart: if somebody goes back to the menu while
  // waiting, this one has to keep quiet instead of taking over when its arena
  // arrives late.
  const token = Symbol('session');
  session = { transport, frame: 0, token };

  const start = await transport.start();
  if (session?.token !== token) {
    transport.close();
    return;
  }

  const count = start.places ?? places;
  // ONLINE, THE COLOURS COME BACK FROM THE RELAY: the creation screen chose
  // them, the room cleaned them up, and everybody — host and guests alike —
  // draws the list it announces. In solo play nothing comes back, and the screen's
  // own choice stands.
  const tints = start.colours ?? colours;
  const labels = Array.from({ length: count }, (_, place) =>
    nameOf(place, humans, start.names ?? names, tints),
  );

  // The colours chosen apply to the rendering AND to the dashboard: a blue
  // bomber must have a blue row, otherwise you hunt for yours at every glance.
  scene.colours(tints);
  warmUpColours(tints ?? Array.from({ length: count }, (_, place) => place));
  hud.build(count, labels, tints);
  menu.hidden = true;
  game.hidden = false;
  // The waiting room has done its job: the game is starting. We close it here
  // rather than wait for the first round's announcement, which does not come
  // when a game already under way is rejoined.
  banner.hide();
  // The wait is over, since the game is starting. We clear it HERE and not on a
  // message from the relay: the one that announces it goes out before the page
  // has subscribed — `start()` only returns once the game is formed — and
  // "waiting" would have stayed on screen for the whole round.
  netState.textContent = '';
  adjustScale();

  let view = null;
  let match = null;

  transport.onView((state, currentMatch) => {
    view = state;
    match = currentMatch;
  });

  transport.onEvents((list) => {
    scene.events(list, performance.now());
    sounds.react(list);
  });

  transport.onTransition((transition) => {
    sounds.transition(transition);
    if (transition.type === 'round') {
      // The duration comes from the engine: it is exactly how long it holds the
      // arena frozen. A separate setting here, and the announcement would
      // disappear before the round started, or stay on after it.
      banner.show({ title: `Manche ${transition.round}`, duration: transition.wait * STEP_MS });
      return;
    }
    if (transition.type === 'score') {
      const title = transition.verdict.draw
        ? 'Manche nulle'
        : `${labels[transition.verdict.winningPlace] ?? 'Personne'} gagne la manche`;
      banner.show({
        title,
        detail: transition.scores.map((score, place) => `${labels[place]} : ${score}`).join('  ·  '),
      });
      return;
    }
    if (transition.type === 'finished') {
      banner.show({
        title:
          transition.winner === null
            ? 'Match nul'
            : `${labels[transition.winner]} remporte le match`,
        detail: transition.scores.map((score, place) => `${labels[place]} : ${score}`).join('  ·  '),
        buttons: [{ text: 'Retour au menu', action: stopSession }],
      });
    }
  });

  transport.onNetState((state) => {
    netState.textContent = state?.message ?? '';
  });

  const mine = start.mine ?? [];

  function frame(now) {
    if (!session) return;
    if (sources) {
      // Locally, every place has ITS control: keyboard 2 drives the place that
      // chose it, not the second one in the list.
      for (const [place, read] of Object.entries(sources)) {
        transport.intent(Number(place), read());
      }
    } else {
      // Online, the relay says which places are ours — one in practice — and we
      // pour keyboard and gamepad into them together.
      for (let seat = 0; seat < mine.length; seat += 1) {
        transport.intent(mine[seat], localIntent(seat));
      }
    }
    transport.beat(now);
    if (view) {
      scene.draw(view, now);
      hud.refresh(view, match);
    }
    session.frame = requestAnimationFrame(frame);
  }

  session.frame = requestAnimationFrame(frame);
}

/**
 * The page's first gesture, whatever it is: audio and menu music.
 *
 * The music cannot be started on load — browsers refuse any sound until the user
 * has done something, and a context opened too early stays stuck in "suspended"
 * for the whole session. So the first click or the first key is as early as
 * possible, and that counts anywhere in the page, not only on the "Jouer"
 * button.
 *
 * The small wait saves a download for nothing: the menu music weighs two and a
 * half megabytes, and somebody whose very first gesture is to click "Jouer"
 * would not hear a second of it.
 */
function firstGesture() {
  document.removeEventListener('pointerdown', firstGesture);
  document.removeEventListener('keydown', firstGesture);
  sounds.wake();
  setTimeout(() => {
    if (!session) sounds.menuMusic();
  }, 300);
}
document.addEventListener('pointerdown', firstGesture);
document.addEventListener('keydown', firstGesture);

playLocalButton.addEventListener('click', () => {
  sounds.wake();
  playLocal();
});
quitButton.addEventListener('click', stopSession);

function toggleSound() {
  const on = sounds.toggle();
  soundButton.textContent = on ? 'Son : actif' : 'Son : coupé';
  soundButton.setAttribute('aria-pressed', String(on));
}

soundButton.addEventListener('click', toggleSound);
keyboard.shortcut('KeyN', toggleSound);
keyboard.shortcut('Escape', () => {
  if (session) stopSession();
});

/**
 * The code the two room fields propose: the invitation first, then the room set
 * in the options, then a code drawn at random.
 *
 * Proposed AGAIN every time one of the two screens opens, and not only when the
 * page loads: the room from the options is a standing choice, and a one-off code
 * typed for one evening — a friend's — must not take its place for good. Leaving
 * the old code there made the option look as if it were ignored.
 *
 * A code TYPED BY HAND holds its ground against a drawn code, which is worth
 * nothing to anybody: going to the options to check something and coming back
 * must not lose the code being dialled.
 *
 * It does NOT hold against the room set in the options, and that is the whole
 * point of that setting: a group that always plays in the same room asks for it
 * once, and finds it on the join screen every evening. Keeping the code typed
 * for one game against a friend made the option look dead — which is how it was
 * reported.
 */
const proposed = new WeakMap();

function proposeRooms() {
  const invited = cleanRoom(new URLSearchParams(location.search).get('room') ?? '');
  const preferred = cleanRoom(readPref(PREF_ROOM, ''));
  for (const [field, code, standing] of [
    // Joining answers an invitation: the link wins over the standing choice.
    [roomInput, invited || preferred || randomRoom(), invited || preferred],
    // Creating lays a new table: the link is somebody else's room, so it is not
    // proposed here. And the code of the room one is laying is one's own
    // business — the options only fill the field in, they do not take it over.
    [createRoomInput, preferred || randomRoom(), ''],
  ]) {
    if (field.value !== '' && field.value !== proposed.get(field) && !standing) continue;
    field.value = code;
    proposed.set(field, code);
  }
}

/**
 * Address of the relay.
 *
 * It is written here rather than guessed: the page is served by GitHub Pages and
 * the relay lives at Cloudflare, so nothing in the current URL lets it be
 * deduced. `?relais=` replaces it, which serves to test against a local
 * `wrangler dev` without touching the code.
 */
const RELAY = 'wss://bomberman-relais.labilbe.workers.dev/room';

/**
 * Starts an online game.
 *
 * The room is the meeting point: two players who type the same code land in the
 * same arena. The link in the address bar carries it, so that somebody can be
 * invited by sending them a URL rather than a code to copy out.
 */
function playOnline({ fresh = false } = {}) {
  stopSession();

  // CREATING AND JOINING ARE THE SAME MESSAGE for the relay — it opens the room
  // if the code is free and seats you in it otherwise — but not the same gesture
  // for the player: one lays the table, the other answers an invitation. So
  // creating reads its own screen (code, seats, bots), joining only reads the
  // code it has been given.
  const seats = fresh ? readNetSeats() : [];
  const field = fresh ? createRoomInput : roomInput;
  const code = cleanRoom(field.value) || randomRoom();
  field.value = code;
  writePref(PREF_NICKNAME, cleanName(nicknameInput.value, nicknameInput.value));
  if (fresh) rememberNetSeats();

  // The bots are named by their SEAT, and the places left free are those that
  // await a human. Joining says nothing about any of this: the room was laid out
  // by whoever created it, and a second opinion would only be heard when the code
  // turns out to be free — that is, when there was nothing to join.
  const places = fresh
    ? seats.length
    : Math.max(MIN_PLACES, Math.min(MAX_PLACES, readNetSeats().length));
  const bots = seats.flatMap((seat, place) => (seat.control === 'bot' ? [place] : []));
  // The colours of the table being laid, and nothing when one is only joining:
  // the room already has its own, and sending ours would be an opinion the relay
  // is right to ignore.
  const colours = fresh ? cleanColours(seats.map((seat) => seat.colour), places) : null;
  const format = Number(formatSelect.value) || 3;
  const url = new URLSearchParams(location.search).get('relais') || RELAY;

  const transport = createOnlineTransport({
    url,
    room: code,
    nickname: cleanName(nicknameInput.value),
    places,
    format,
    bots,
    colours,
    // Creating already carries the colour of the options in its list, on the
    // first row; joining has no list to carry, so it asks for it.
    colour: fresh ? null : preferredColour(),
    // ONLY "CRÉER" LAYS A TABLE. Whoever comes through "Rejoindre" answers an
    // invitation, even when they turn out to be the first to arrive: they are
    // not offered the start, and the room falls back on setting off by itself
    // once full — which is how a room nobody created has always worked.
    host: fresh,
  });

  // The invitation link, without reloading the page: whoever receives it arrives
  // in this room, with the code already filled in.
  const invitation = new URL(location.href);
  invitation.searchParams.set('room', code);
  history.replaceState(null, '', invitation);

  // The waiting room opens STRAIGHT AWAY, before the slightest answer from the
  // relay. Without it, whoever creates a room stays in front of the menu not
  // knowing whether anything is happening, and clicks again — which is exactly
  // what used to fill the room with the same player.
  menu.hidden = true;
  game.hidden = false;
  adjustScale();
  showWaiting(transport, {
    code,
    seated: 1,
    total: places,
    names: [],
    colours,
    host: fresh,
    hosted: fresh,
  });
  transport.onRoom((room) => showWaiting(transport, room));

  // A single local seat online: the other bombers are elsewhere.
  startSession(transport, { humans: 1, places, names: null });
}

/**
 * The waiting room: who is seated, who is missing, and what it takes to set off.
 *
 * THE HOST ALONE STARTS, and it is the relay that says who they are. The room
 * belongs to whoever opened it: they know who is still coming, and the game used
 * to set off by itself the moment the last seat was taken — a friend arriving
 * started the game in the creator's face. The places left empty go to bots, so
 * waiting for a fourth who never comes holds nothing up.
 *
 * It redraws itself on every arrival: the banner is rebuilt rather than modified,
 * which saves keeping nodes up to date one by one for three lines of text.
 */
function showWaiting(transport, { code, seated, total, names, colours = null, host = false, hosted = false, error }) {
  // The relay has refused: this is the ONLY screen shown at that moment, hence
  // the only place to say so. Without that, you stay in front of a silent
  // waiting room, wondering why nobody arrives.
  if (error) {
    banner.show({
      title: 'Impossible de rejoindre',
      detail: error,
      buttons: [{ text: 'Retour au menu', action: stopSession }],
    });
    return;
  }

  // THE COLOUR IS SAID WITH THE NAME, and that is new: it used to come with the
  // place, so there was nothing to announce. Now that whoever lays the table
  // picks them, a guest has no other way of learning which bomber is theirs
  // before the first round starts.
  const seats = Array.from({ length: total }, (_, place) => {
    const tint = placeColour(colours?.[place] ?? place).name;
    return `${names?.[place] || '— libre —'} (${tint})`;
  });
  const missing = total - seated;

  // What the guest is waiting for is NOT the same thing as what the host is
  // waiting for: one waits for players, the other for a signal — and in a room
  // nobody laid out, for the last seat, since such a room sets off on its own.
  // Saying "le salon est complet" to somebody who has nothing to press leaves
  // them staring at a screen that looks stuck.
  const others = `${missing} joueur${missing > 1 ? 's' : ''}`;
  const detail = host
    ? missing > 0
      ? `En attente de ${others} — partage le lien de la barre d'adresse`
      : 'Le salon est complet'
    : hosted
      ? missing > 0
        ? `En attente de ${others} et du créateur du salon`
        : 'Le salon est complet — le créateur lance la partie'
      : `En attente de ${others} — la partie démarre dès que le salon est complet`;

  const start = {
    text: missing > 0 ? `Démarrer (${missing} bot${missing > 1 ? 's' : ''})` : 'Démarrer',
    action: () => transport.begin?.(),
  };

  banner.show({
    title: `Salon ${code}`,
    detail: [seats.join('   ·   '), detail].join('\n'),
    // The button is not merely disabled for a guest, it is absent: a greyed-out
    // button is something to try, and trying it is how you learn it was never
    // yours.
    buttons: [...(host ? [start] : []), { text: 'Quitter', action: stopSession }],
  });
}

playOnlineButton.addEventListener('click', () => {
  sounds.wake();
  banner.hide();
  playOnline();
});

createOnlineButton.addEventListener('click', () => {
  sounds.wake();
  banner.hide();
  playOnline({ fresh: true });
});

/**
 * Says how many gamepads are plugged in, under the table of controls.
 *
 * The browser only reveals a gamepad after a first press on it, out of concern
 * for privacy: a page must not be able to recognise a visitor by their hardware
 * without their having done anything. A gamepad that is switched on can therefore
 * stay invisible until a button is pressed, and without this counter you would
 * think the game broken when it is simply waiting for that gesture.
 */
const gamepadNote = document.querySelector('#gamepads');
const GAMEPAD_TEXT = gamepadNote?.textContent ?? '';

function announceGamepads() {
  if (!gamepadNote) return;
  const count = gamepads.howMany();
  const state = count === 0
    ? "Aucune manette détectée pour l'instant — appuie sur un bouton pour qu'elle se signale."
    : `${count} manette${count > 1 ? 's' : ''} détectée${count > 1 ? 's' : ''}.`;
  gamepadNote.textContent = `${GAMEPAD_TEXT.trim()} ${state}`;
}

/**
 * A gamepad arriving or leaving changes the choices possible: we rebuild the rows
 * of the launch screen, which keep whatever still holds on the way.
 */
function followGamepads() {
  announceGamepads();
  if (seatsList) buildSeats();
}

window.addEventListener('gamepadconnected', followGamepads);
window.addEventListener('gamepaddisconnected', followGamepads);

/** Initial state of the fields: the link wins over the local preference. */
function initialise() {
  announceGamepads();
  const invited = cleanRoom(new URLSearchParams(location.search).get('room') ?? '');
  playersSelect.value = readPref(PREF_PLAYERS, '2');
  buildSeats();
  // The choices remembered from the last game, put back if they still hold — a
  // gamepad unplugged since, and the row falls back on a bot.
  try {
    const remembered = JSON.parse(readPref(PREF_SEATS, '[]'));
    if (Array.isArray(remembered) && remembered.length > 0) {
      playersSelect.value = String(Math.max(2, Math.min(MAX_PLAYERS, remembered.length)));
      buildSeats();
      [...seatsList.querySelectorAll('.seat')].forEach((row, place) => {
        const wanted = remembered[place];
        if (!wanted) return;
        const colour = row.querySelector('.colour');
        const control = row.querySelector('.control');
        colour.value = String(wanted.colour ?? place);
        row.querySelector('.dot').style.background =
          placeColour(Number(colour.value)).vivid;
        if ([...control.options].some((o) => o.value === wanted.control)) {
          control.value = wanted.control;
        }
      });
    }
  } catch {
    // An unreadable preference must not keep anybody from playing: we keep the
    // default rows.
  }
  playersSelect.addEventListener('change', () => {
    buildSeats();
    rememberSeats();
  });
  netPlayersSelect.value = String(readNetSeats().length);
  buildNetSeats();
  netPlayersSelect.addEventListener('change', () => {
    buildNetSeats();
    rememberNetSeats();
  });

  // THE DEFAULT ROOM IS SET IN THE OPTIONS, and nowhere else. The code typed on
  // the create or join screen is a one-off — the evening's room, a friend's code
  // — and writing it back as the default would quietly replace a group's own
  // code with the last one tried.
  defaultRoomInput.value = cleanRoom(readPref(PREF_ROOM, ''));
  proposeRooms();
  nicknameInput.value = cleanName(readPref(PREF_NICKNAME, ''), randomName());
  formatSelect.value = readPref(PREF_FORMAT, '3');

  // THE COLOUR ONE PREFERS, in the game's own order so that the list reads like
  // the one on the launch screen.
  for (const [index, tint] of PLACES.entries()) {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = tint.name;
    colourSelect.append(option);
  }
  colourSelect.value = String(preferredColour());
  colourSelect.addEventListener('change', () => {
    writePref(PREF_COLOUR, colourSelect.value);
    // The two screens that lay out an arena follow AT ONCE, as the default room
    // does: a choice that only showed after a reload would look ignored.
    //
    // And what they now show is WRITTEN DOWN, since the rows are what the next
    // load reads back: without it the new colour held until the page was
    // reloaded, and the seats then put the old one back — the option undone by
    // a refresh.
    buildSeats();
    rememberSeats();
    buildNetSeats();
    rememberNetSeats();
  });
  defaultRoomInput.addEventListener('change', () => {
    defaultRoomInput.value = cleanRoom(defaultRoomInput.value);
    writePref(PREF_ROOM, defaultRoomInput.value);
    // The two screens follow at once: a default that only took effect after a
    // reload would look as if it had been ignored.
    proposeRooms();
  });
  // A ROOM CODE IS CASE-INSENSITIVE, here as in the relay: `cleanRoom` upper-cases
  // it, and the stylesheet shows it upper-cased while it is being typed, so that
  // what you read is what will be sent. Two friends reading a code out to each
  // other must land in the same room whichever way they spell it.
  for (const field of [roomInput, createRoomInput]) {
    field.addEventListener('change', () => {
      field.value = cleanRoom(field.value);
    });
  }
  showMenu();

  // "Lancer une partie" is selected from the start: the game's menu always
  // arrives with a row chosen, and that row carries the bomb.
  //
  // AFTER THE FIRST FRAME, and not straight away: the browser puts the focus
  // back on the document once loading is over, which erased ours. If the mouse
  // is already resting on a row, that row wins — `selectByDefault` only chooses
  // when nothing is chosen.
  requestAnimationFrame(selectByDefault);
}

initialise();
