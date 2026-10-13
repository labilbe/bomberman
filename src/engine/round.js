/**
 * Rounds, scores and end of match.
 *
 * Everything here is pure and immutable, unlike the arena's state: a match
 * changes five to nine times in an evening, not thirty times a second, and it
 * is the value we display, persist in SQL and compare in tests. Immutability is
 * free here and it keeps a score from being changed by surprise in the middle
 * of a broadcast.
 *
 * The verdict only looks at the FINAL state of the step, never at the order in
 * which the deaths arrived. Two bombers killed on the same step make a drawn
 * round, not a win for whoever happened to sit further down the array.
 */

/** Match formats on offer: first to 2, to 3, or to 4 rounds. */
export const FORMATS = [3, 5, 7];

/**
 * Caps repeated draws. Without it, two bombers who kill each other every round
 * play until the end of time.
 */
export const MAX_ROUNDS = 9;

/**
 * @typedef {{ winningPlace: number | null, draw: boolean }} Verdict
 * @typedef {{ total: number, toWin: number, round: number, scores: number[], draws: number, over: boolean }} Match
 */

/**
 * @param {{ places: number, total?: number }} options
 * @returns {Match}
 */
export function createMatch({ places, total = FORMATS[0] }) {
  const format = FORMATS.includes(total) ? total : FORMATS[0];
  return {
    total: format,
    toWin: Math.ceil(format / 2),
    round: 1,
    scores: Array.from({ length: places }, () => 0),
    draws: 0,
    over: false,
  };
}

/**
 * Verdict of a round, or null while it is not over.
 *
 * With a single bomber in the arena — practice — the round only ends on its
 * death: waiting for "one survivor" to be left would have ended it before it
 * began.
 *
 * @param {import('./state.js').State} state
 * @returns {Verdict | null}
 */
export function roundVerdict(state) {
  const alive = state.players.filter((player) => player.alive);
  const threshold = state.players.length > 1 ? 1 : 0;
  if (alive.length > threshold) return null;
  if (alive.length === 1) return { winningPlace: alive[0].place, draw: false };
  return { winningPlace: null, draw: true };
}

/**
 * Writes a verdict on the board and moves on by one round.
 *
 * @param {Match} match
 * @param {Verdict} verdict
 * @returns {Match}
 */
export function recordRound(match, verdict) {
  const scores = match.scores.slice();
  if (verdict.winningPlace !== null && scores[verdict.winningPlace] !== undefined) {
    scores[verdict.winningPlace] += 1;
  }
  const draws = match.draws + (verdict.draw ? 1 : 0);
  const reached = scores.some((score) => score >= match.toWin);
  const exhausted = match.round >= MAX_ROUNDS;
  return {
    ...match,
    scores,
    draws,
    round: match.round + 1,
    over: reached || exhausted,
  };
}

/** @param {Match} match */
export function matchOver(match) {
  return match.over;
}

/**
 * The place that wins the match, or null when nobody stands out.
 *
 * @param {Match} match
 * @returns {number | null}
 */
export function winner(match) {
  let best = null;
  let bestScore = -1;
  let tied = false;
  match.scores.forEach((score, place) => {
    if (score > bestScore) {
      bestScore = score;
      best = place;
      tied = false;
    } else if (score === bestScore) {
      tied = true;
    }
  });
  if (bestScore <= 0 || tied) return null;
  return best;
}

/**
 * Standings, from best to worst. Ties are broken by place number, so that the
 * order is the same everywhere and does not depend on whether the runtime's sort
 * is stable.
 *
 * @param {Match} match
 */
export function standings(match) {
  return match.scores
    .map((score, place) => ({ place, score }))
    .sort((a, b) => b.score - a.score || a.place - b.place);
}

/**
 * Seed of round n, derived from the match's own.
 *
 * A different arena every round, but reproducible from the match seed alone:
 * that is what lets the log replay a whole evening without storing four arenas.
 *
 * @param {number} matchSeed
 * @param {number} round
 */
export function roundSeed(matchSeed, round) {
  // Mixed by a large odd integer: incrementing a xorshift's seed gives twin
  // arenas, because its first bits barely move.
  return (Math.imul(matchSeed ^ (round * 0x9e3779b9), 0x85ebca6b) >>> 0) || 1;
}
