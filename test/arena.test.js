import test from 'node:test';
import assert from 'node:assert/strict';

import { generateArena, STARTS, isHardWall, drawBonus, clearings } from '../src/engine/arena.js';
import { createRng } from '../src/engine/rng.js';
import { index } from '../src/engine/grid.js';
import { COLS, ROWS, EMPTY, SOLID, BRICK } from '../src/engine/constants.js';
import { isHidden, codeOf, BONUS_TABLE } from '../src/engine/bonus.js';

test('the same seed gives exactly the same arena', () => {
  const a = generateArena(createRng(12345));
  const b = generateArena(createRng(12345));
  assert.deepEqual([...a.tiles], [...b.tiles]);
  assert.deepEqual([...a.items], [...b.items]);
  assert.equal(a.rng.seed, b.rng.seed);
});

test('two different seeds give two different arenas', () => {
  const a = generateArena(createRng(1));
  const b = generateArena(createRng(2));
  assert.notDeepEqual([...a.tiles], [...b.tiles]);
});

test('the edges and the checkerboard are hard walls', () => {
  const { tiles } = generateArena(createRng(99));
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (isHardWall(x, y)) assert.equal(tiles[index(x, y)], SOLID, `(${x},${y}) should be hard`);
      else assert.notEqual(tiles[index(x, y)], SOLID, `(${x},${y}) should not be hard`);
    }
  }
});

test('every start is cleared, and has two ways out', () => {
  // Without that clearing a bomber is born locked in and loses before moving.
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { tiles } = generateArena(createRng(seed), STARTS.length);
    for (const start of STARTS) {
      const cells = clearings(start);
      assert.equal(cells.length, 3, `(${start.x},${start.y}) has to open three cells`);
      for (const cell of cells) {
        assert.equal(tiles[index(cell.x, cell.y)], EMPTY, `(${cell.x},${cell.y}) should be clear`);
      }
      // The two others are neighbours of the start, and nothing else.
      for (const cell of cells.slice(1)) {
        const step = Math.abs(cell.x - start.x) + Math.abs(cell.y - start.y);
        assert.equal(step, 1, 'a way out has to touch the start');
      }
    }
  }
});

test('a round only clears the starts it uses', () => {
  // A game of two is played on the arena it has always been played on: without
  // this, ten clearings would open thirty cells nobody is born on.
  const few = generateArena(createRng(404), 2);
  const many = generateArena(createRng(404), STARTS.length);
  assert.notDeepEqual([...few.tiles], [...many.tiles]);

  // The two bombers of a game of two find exactly the arena they always found:
  // the brick draw comes before any clearing, so only the cells cleared differ.
  for (const start of STARTS.slice(0, 2)) {
    for (const cell of clearings(start)) {
      assert.equal(few.tiles[index(cell.x, cell.y)], EMPTY);
    }
  }
  for (const start of STARTS.slice(2)) {
    const open = clearings(start).every((cell) => many.tiles[index(cell.x, cell.y)] === EMPTY);
    assert.equal(open, true, 'a start in play is clear');
    const kept = clearings(start).some((cell) => few.tiles[index(cell.x, cell.y)] !== EMPTY);
    assert.equal(kept, true, 'a start nobody is born on keeps its bricks');
  }
});

test('the ten starts are distinct and opposite in pairs', () => {
  assert.equal(new Set(STARTS.map((d) => `${d.x},${d.y}`)).size, STARTS.length);
  assert.equal(STARTS.length, 10, "the original game's count");
  for (const start of STARTS) {
    assert.equal(isHardWall(start.x, start.y), false, `(${start.x},${start.y}) is a wall`);
  }
  // Each place is born away from the one before: with two players you are not
  // born side by side, and with ten nobody has a neighbour at arm's length.
  for (let place = 1; place < STARTS.length; place += 2) {
    const [a, b] = [STARTS[place - 1], STARTS[place]];
    const apart = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    assert.ok(apart >= 10, `places ${place - 1} and ${place} are ${apart} apart`);
  }
  // Nobody shares a corridor with a neighbour either.
  for (const [i, a] of STARTS.entries()) {
    for (const b of STARTS.slice(i + 1)) {
      const apart = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      assert.ok(apart >= 4, `(${a.x},${a.y}) and (${b.x},${b.y}) are ${apart} apart`);
    }
  }
});

test('bonuses are only sown under bricks, and in reasonable proportion', () => {
  let bricks = 0;
  let hidden = 0;
  // OVER SEVERAL ARENAS, because the proportion is a property of the draw and
  // not of one seed: sixty-odd bricks are few enough that an unlucky arena
  // strays by a third, and the test then reports chance rather than a rule.
  for (let seed = 2024; seed < 2044; seed += 1) {
    const { tiles, items } = generateArena(createRng(seed));
    for (let i = 0; i < tiles.length; i += 1) {
      if (tiles[i] === BRICK) bricks += 1;
      if (items[i] === 0) continue;
      hidden += 1;
      assert.equal(isHidden(items[i]), true, 'no bonus must be visible at the start');
      assert.equal(tiles[i], BRICK, 'a hidden bonus must be under a brick');
    }
  }
  const share = hidden / bricks;
  assert.ok(share > 0.25 && share < 0.45, `unexpected proportion: ${share}`);
});

test('drawBonus consumes one draw only and stays within the table', () => {
  const codes = new Set(BONUS_TABLE.map(([code]) => code));
  let rng = createRng(555);
  const drawn = [];
  for (let i = 0; i < 200; i += 1) {
    const choice = drawBonus(rng);
    assert.equal(codes.has(choice.bonus), true);
    rng = choice.rng;
    drawn.push(choice.bonus);
  }
  // Reproducible: replayed from the same seed, the same sequence.
  let again = createRng(555);
  for (const expected of drawn) {
    const choice = drawBonus(again);
    assert.equal(choice.bonus, expected);
    again = choice.rng;
  }
  // Every bonus in the table comes out at least once in 200 draws.
  assert.equal(new Set(drawn).size, BONUS_TABLE.length);
});

test('a hidden bonus decodes to a valid code', () => {
  const { items } = generateArena(createRng(31337));
  const codes = new Set(BONUS_TABLE.map(([code]) => code));
  for (const value of items) {
    if (value === 0) continue;
    assert.equal(codes.has(codeOf(value)), true);
  }
});
