import test from 'node:test';
import assert from 'node:assert/strict';

import { generateArena, STARTS, isHardWall, drawBonus } from '../src/engine/arena.js';
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

test('every starting corner is cleared in an L', () => {
  // Without that clearing a bomber is born locked in and loses before moving.
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { tiles } = generateArena(createRng(seed));
    for (const start of STARTS) {
      const towardsX = start.x === 1 ? 1 : -1;
      const towardsY = start.y === 1 ? 1 : -1;
      assert.equal(tiles[index(start.x, start.y)], EMPTY);
      assert.equal(tiles[index(start.x + towardsX, start.y)], EMPTY);
      assert.equal(tiles[index(start.x, start.y + towardsY)], EMPTY);
    }
  }
});

test('the four starts are distinct and diagonal in pairs', () => {
  assert.equal(new Set(STARTS.map((d) => `${d.x},${d.y}`)).size, 4);
  // Places 0 and 1 face each other: with two players you are not born side by
  // side.
  assert.equal(STARTS[0].x !== STARTS[1].x && STARTS[0].y !== STARTS[1].y, true);
});

test('bonuses are only sown under bricks, and in reasonable proportion', () => {
  const { tiles, items } = generateArena(createRng(2024));
  let bricks = 0;
  let hidden = 0;
  for (let i = 0; i < tiles.length; i += 1) {
    if (tiles[i] === BRICK) bricks += 1;
    if (items[i] === 0) continue;
    hidden += 1;
    assert.equal(isHidden(items[i]), true, 'no bonus must be visible at the start');
    assert.equal(tiles[i], BRICK, 'a hidden bonus must be under a brick');
  }
  const share = hidden / bricks;
  assert.ok(share > 0.2 && share < 0.5, `unexpected proportion: ${share}`);
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
