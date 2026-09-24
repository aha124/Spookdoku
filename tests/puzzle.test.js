import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIZES,
  generatePuzzle,
  solve,
  isValidSolution,
  checkRegions,
  findConflicts,
  createRng,
} from '../www/puzzle.js';

const PER_SIZE = 12;

for (const { size } of SIZES) {
  test(`${size}x${size}: every generated puzzle has exactly one solution`, () => {
    for (let i = 0; i < PER_SIZE; i++) {
      const p = generatePuzzle({ size, seed: `unique-${i}` });
      assert.equal(p.size, size);
      assert.equal(p.regions.length, size);
      for (const row of p.regions) assert.equal(row.length, size);
      const { count } = solve(p.regions, 3);
      assert.equal(count, 1, `seed unique-${i} has ${count} solutions`);
    }
  });

  test(`${size}x${size}: exactly N contiguous regions`, () => {
    for (let i = 0; i < PER_SIZE; i++) {
      const p = generatePuzzle({ size, seed: `regions-${i}` });
      const { count, contiguous } = checkRegions(p.regions);
      assert.equal(count, size);
      assert.ok(contiguous, `seed regions-${i} has a split region`);
      const ids = new Set(p.regions.flat());
      assert.deepEqual([...ids].sort((a, b) => a - b), [...Array(size).keys()]);
    }
  });

  test(`${size}x${size}: solver solution satisfies every rule`, () => {
    for (let i = 0; i < PER_SIZE; i++) {
      const p = generatePuzzle({ size, seed: `rules-${i}` });
      const [sol] = solve(p.regions, 1).solutions;
      assert.deepEqual(sol, p.solution);
      assertRules(p.regions, sol);
      assert.ok(isValidSolution(p.regions, sol));
    }
  });
}

function assertRules(regions, cols) {
  const n = regions.length;
  assert.equal(cols.length, n, 'one pumpkin per row');
  assert.equal(new Set(cols).size, n, 'one pumpkin per column');
  assert.equal(new Set(cols.map((c, r) => regions[r][c])).size, n, 'one pumpkin per region');
  for (let r = 1; r < n; r++) {
    assert.ok(Math.abs(cols[r] - cols[r - 1]) > 1, `pumpkins in rows ${r - 1} and ${r} touch`);
  }
}

test('same seed produces the same puzzle', () => {
  for (const { size } of SIZES) {
    const a = generatePuzzle({ size, seed: 'boo-42' });
    const b = generatePuzzle({ size, seed: 'boo-42' });
    assert.deepEqual(a, b);
  }
  const x = generatePuzzle({ size: 8, seed: 12345 });
  const y = generatePuzzle({ size: 8, seed: '12345' });
  assert.deepEqual(x.regions, y.regions);
});

test('different seeds produce different puzzles', () => {
  const a = generatePuzzle({ size: 8, seed: 'a' });
  const b = generatePuzzle({ size: 8, seed: 'b' });
  assert.notDeepEqual(a.regions, b.regions);
});

test('seeded rng is deterministic', () => {
  const r1 = createRng('x');
  const r2 = createRng('x');
  for (let i = 0; i < 100; i++) assert.equal(r1(), r2());
});

test('generating a 9x9 takes under 2 seconds', () => {
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    generatePuzzle({ size: 9, seed: `speed-${i}` });
    const ms = performance.now() - start;
    assert.ok(ms < 2000, `9x9 seed speed-${i} took ${ms.toFixed(0)}ms`);
  }
});

test('findConflicts flags row, column, region and touching pumpkins', () => {
  const regions = [
    [0, 0, 1, 1],
    [0, 2, 2, 1],
    [3, 2, 2, 1],
    [3, 3, 3, 1],
  ];
  assert.equal(findConflicts(regions, [[0, 0], [0, 3]]).size, 2); // same row
  assert.equal(findConflicts(regions, [[0, 2], [3, 2]]).size, 2); // same column
  assert.equal(findConflicts(regions, [[0, 3], [2, 3]]).size, 2); // same column and region
  assert.equal(findConflicts(regions, [[1, 1], [2, 2]]).size, 2); // diagonal touch
  assert.equal(findConflicts(regions, [[0, 1], [2, 0]]).size, 0); // knight's move apart, different regions
});

test('isValidSolution rejects broken placements', () => {
  const p = generatePuzzle({ size: 6, seed: 'reject' });
  assert.ok(isValidSolution(p.regions, p.solution));
  const swapped = p.solution.slice();
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  assert.equal(isValidSolution(p.regions, swapped), false);
  assert.equal(isValidSolution(p.regions, p.solution.slice(1)), false);
});
