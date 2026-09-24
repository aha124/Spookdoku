// Pumpkin Patch puzzle engine: seeded generator, solver and rule checks.
// Pure logic, no DOM. Works in the browser and in Node as an ES module.

export const SIZES = [
  { size: 6, label: 'Easy' },
  { size: 7, label: 'Medium' },
  { size: 8, label: 'Tricky' },
  { size: 9, label: 'Hard' },
];

const MAX_ATTEMPTS = 200000;

// ---------- Seeded randomness ----------

export function hashSeed(seed) {
  const s = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32: small, fast, good enough for puzzle shuffling.
export function createRng(seed) {
  let a = hashSeed(seed);
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0');
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// ---------- Generation ----------

// One pumpkin per row and column, none touching (so adjacent rows differ by 2+ columns).
export function placePumpkins(n, rng) {
  const cols = new Array(n);
  const used = new Array(n).fill(false);
  const place = (r) => {
    if (r === n) return true;
    const order = shuffle([...Array(n).keys()], rng);
    for (const c of order) {
      if (used[c] || (r > 0 && Math.abs(cols[r - 1] - c) <= 1)) continue;
      used[c] = true;
      cols[r] = c;
      if (place(r + 1)) return true;
      used[c] = false;
    }
    return false;
  };
  if (!place(0)) throw new Error(`No valid pumpkin layout for size ${n}`);
  return cols;
}

// Grow one contiguous region outward from each pumpkin until the grid is full.
// Each region gets a random growth weight so sizes vary (small regions make
// unique puzzles far more likely).
export function growRegions(n, cols, rng) {
  const grid = Array.from({ length: n }, () => new Array(n).fill(-1));
  const frontier = [];
  const weight = [];
  let unassigned = n * n;

  const claim = (r, c, id) => {
    grid[r][c] = id;
    unassigned--;
    for (const [dr, dc] of ORTHO) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < n && nc >= 0 && nc < n && grid[nr][nc] === -1) {
        frontier[id].push([nr, nc]);
      }
    }
  };

  for (let id = 0; id < n; id++) {
    frontier.push([]);
    const w = 0.15 + rng();
    weight.push(w * w);
  }
  for (let r = 0; r < n; r++) claim(r, cols[r], r);

  while (unassigned > 0) {
    // Drop stale frontier cells, then pick a region by weight.
    let total = 0;
    for (let id = 0; id < n; id++) {
      frontier[id] = frontier[id].filter(([r, c]) => grid[r][c] === -1);
      if (frontier[id].length) total += weight[id];
    }
    let pick = rng() * total;
    let id = 0;
    for (; id < n; id++) {
      if (!frontier[id].length) continue;
      pick -= weight[id];
      if (pick <= 0) break;
    }
    if (id === n) id = frontier.findIndex((f) => f.length);
    const f = frontier[id];
    const [r, c] = f[Math.floor(rng() * f.length)];
    claim(r, c, id);
  }
  return grid;
}

// Renumber regions in reading order so ids don't leak the planted solution.
function normalizeRegions(regions) {
  const map = new Map();
  return regions.map((row) =>
    row.map((id) => {
      if (!map.has(id)) map.set(id, map.size);
      return map.get(id);
    }),
  );
}

/**
 * Generate a puzzle with exactly one solution.
 * @param {{size?: number, seed?: string|number}} [opts]
 * @returns {{size: number, seed: string, regions: number[][], solution: number[], attempts: number}}
 *   regions[row][col] is a region id 0..size-1; solution[row] is the pumpkin's column.
 */
export function generatePuzzle({ size = 6, seed = randomSeed() } = {}) {
  const n = size;
  if (!Number.isInteger(n) || n < 5 || n > 12) throw new Error(`Unsupported size ${size}`);
  const rng = createRng(`${n}:${seed}`);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const cols = placePumpkins(n, rng);
    const regions = growRegions(n, cols, rng);
    const { count, solutions } = solve(regions, 2);
    if (count === 1) {
      return { size: n, seed: String(seed), regions: normalizeRegions(regions), solution: solutions[0], attempts: attempt };
    }
  }
  throw new Error(`Could not generate a unique ${n}x${n} puzzle`);
}

// ---------- Solver ----------

/**
 * Backtracking solver, row by row with bitmasks. Stops once `limit` solutions are found.
 * @returns {{count: number, solutions: number[][]}} each solution is an array of columns by row.
 */
export function solve(regions, limit = 2) {
  const n = regions.length;
  const cols = new Array(n);
  const solutions = [];
  const full = (1 << n) - 1;

  // For pruning: which regions appear in rows r..n-1.
  const regionsFrom = new Array(n + 1).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let m = 0;
    for (let c = 0; c < n; c++) m |= 1 << regions[r][c];
    regionsFrom[r] = regionsFrom[r + 1] | m;
  }

  const search = (r, colMask, regMask) => {
    if (r === n) {
      solutions.push(cols.slice());
      return solutions.length >= limit;
    }
    // Every region not yet used must still be reachable in the remaining rows.
    if (((full & ~regMask) & ~regionsFrom[r]) !== 0) return false;
    const row = regions[r];
    for (let c = 0; c < n; c++) {
      if (colMask & (1 << c)) continue;
      if (r > 0 && Math.abs(cols[r - 1] - c) <= 1) continue;
      const bit = 1 << row[c];
      if (regMask & bit) continue;
      cols[r] = c;
      if (search(r + 1, colMask | (1 << c), regMask | bit)) return true;
    }
    return false;
  };

  search(0, 0, 0);
  return { count: solutions.length, solutions };
}

// ---------- Rule checks ----------

/** True if `cols` (column per row) is a full, valid solution for `regions`. */
export function isValidSolution(regions, cols) {
  const n = regions.length;
  if (!Array.isArray(cols) || cols.length !== n) return false;
  const pumpkins = cols.map((c, r) => [r, c]);
  if (pumpkins.some(([, c]) => !Number.isInteger(c) || c < 0 || c >= n)) return false;
  return findConflicts(regions, pumpkins).size === 0 && new Set(cols).size === n &&
    new Set(pumpkins.map(([r, c]) => regions[r][c])).size === n;
}

/**
 * Return the set of "r,c" keys for pumpkins that break a rule
 * (share a row, column or region, or touch, including diagonally).
 * @param {number[][]} regions
 * @param {Array<[number, number]>} pumpkins list of [row, col]
 */
export function findConflicts(regions, pumpkins) {
  const bad = new Set();
  for (let i = 0; i < pumpkins.length; i++) {
    const [r1, c1] = pumpkins[i];
    for (let j = i + 1; j < pumpkins.length; j++) {
      const [r2, c2] = pumpkins[j];
      const clash =
        r1 === r2 ||
        c1 === c2 ||
        regions[r1][c1] === regions[r2][c2] ||
        (Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1);
      if (clash) {
        bad.add(`${r1},${c1}`);
        bad.add(`${r2},${c2}`);
      }
    }
  }
  return bad;
}

/** Number of distinct regions, and whether each one is a single connected blob. */
export function checkRegions(regions) {
  const n = regions.length;
  const cellsById = new Map();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const id = regions[r][c];
      if (!cellsById.has(id)) cellsById.set(id, []);
      cellsById.get(id).push([r, c]);
    }
  }
  let contiguous = true;
  for (const [id, cells] of cellsById) {
    const seen = new Set([`${cells[0][0]},${cells[0][1]}`]);
    const stack = [cells[0]];
    while (stack.length) {
      const [r, c] = stack.pop();
      for (const [dr, dc] of ORTHO) {
        const nr = r + dr;
        const nc = c + dc;
        const key = `${nr},${nc}`;
        if (nr >= 0 && nr < n && nc >= 0 && nc < n && regions[nr][nc] === id && !seen.has(key)) {
          seen.add(key);
          stack.push([nr, nc]);
        }
      }
    }
    if (seen.size !== cells.length) contiguous = false;
  }
  return { count: cellsById.size, contiguous };
}

/** Adjacency sets between regions (orthogonal neighbours), for colouring. */
export function regionAdjacency(regions) {
  const n = regions.length;
  const adj = Array.from({ length: n }, () => new Set());
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const a = regions[r][c];
      if (r + 1 < n && regions[r + 1][c] !== a) { adj[a].add(regions[r + 1][c]); adj[regions[r + 1][c]].add(a); }
      if (c + 1 < n && regions[r][c + 1] !== a) { adj[a].add(regions[r][c + 1]); adj[regions[r][c + 1]].add(a); }
    }
  }
  return adj;
}
