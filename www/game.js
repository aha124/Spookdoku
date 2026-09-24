// Pumpkin Patch UI: rendering, input, feedback, timer, storage.
import { SIZES, generatePuzzle, findConflicts, regionAdjacency, randomSeed, createRng } from './puzzle.js';
import { sound, buzz, unlockAudio, settings as fx, canVibrate, HAPTIC } from './fx.js';

const EMPTY = 0;
const MARK = 1;
const PUMPKIN = 2;

// Muted Halloween palette. `light` colours get dark twig X's instead of bone ones.
const PALETTE = [
  { name: 'burnt orange', hex: '#b0561e' },
  { name: 'deep purple', hex: '#4a3470' },
  { name: 'sickly green', hex: '#8f9a2e' },
  { name: 'blood red', hex: '#7d1d22' },
  { name: 'bone', hex: '#c9bc9c', light: true },
  { name: 'midnight blue', hex: '#243a66' },
  { name: 'moss', hex: '#3f5a2c' },
  { name: 'plum', hex: '#6e3558' },
  { name: 'rust', hex: '#8a4424' },
];

// Gradients (#pp-*) and the bone shape live in the hidden <svg class="defs"> in index.html.
const PUMPKIN_HTML = `<span class="piece pumpkin">
  <span class="pk-shadow"></span>
  <span class="pk-body">
    <svg class="pk-svg" viewBox="0 0 64 64" aria-hidden="true">
      <path class="pk-stem" d="M29.5 17c-.6-6.5 1.8-10.5 6.5-13l2.8 3.2c-3.6 2-4.9 5-4.3 9.6z"/>
      <ellipse class="pk-side" cx="19.5" cy="40" rx="15" ry="19.5"/>
      <ellipse class="pk-side" cx="44.5" cy="40" rx="15" ry="19.5"/>
      <ellipse class="pk-mid" cx="32" cy="40" rx="15.5" ry="21.5"/>
      <path class="pk-rib" d="M25.8 20.5Q21 40 25.8 60.5M38.2 20.5Q43 40 38.2 60.5M13 28Q9.5 40 13 52M51 28Q54.5 40 51 52"/>
      <ellipse class="pk-hi" cx="25.5" cy="27" rx="6.5" ry="3.2" transform="rotate(-26 25.5 27)"/>
      <g class="pk-face">
        <path d="M18.5 34h9l-4.5-8z"/>
        <path d="M36.5 34h9l-4.5-8z"/>
        <path d="M30 40.5h4l-2-3.5z"/>
        <path d="M16.5 43.5Q32 61 47.5 43.5l-3.8 2.4-2.9-2.6-3 3.9-3.3-3.1-2.5 3.3-2.5-3.3-3.3 3.1-3-3.9-2.9 2.6z"/>
      </g>
    </svg>
    <span class="halo"></span>
  </span>
</span>`;

// Two crossed bones as plain paths (no <use>), so each X is cheap to style and paint.
const MARK_HTML = `<span class="piece mark">
  <svg class="bones" viewBox="0 0 24 24" aria-hidden="true">
    <path class="bone-shadow" d="M9.62 8.36L17.54 16.28A1.9 1.9 0 1 1 18.39 18.69A1.9 1.9 0 1 1 15.98 17.84L8.06 9.92A1.9 1.9 0 1 1 7.21 7.51A1.9 1.9 0 1 1 9.62 8.36ZM8.06 16.28L15.98 8.36A1.9 1.9 0 1 1 18.39 7.51A1.9 1.9 0 1 1 17.54 9.92L9.62 17.84A1.9 1.9 0 1 1 7.21 18.69A1.9 1.9 0 1 1 8.06 16.28Z"/>
    <path class="bone-fill" d="M8.82 7.26L16.74 15.18A1.9 1.9 0 1 1 17.59 17.59A1.9 1.9 0 1 1 15.18 16.74L7.26 8.82A1.9 1.9 0 1 1 6.41 6.41A1.9 1.9 0 1 1 8.82 7.26ZM7.26 15.18L15.18 7.26A1.9 1.9 0 1 1 17.59 6.41A1.9 1.9 0 1 1 16.74 8.82L8.82 16.74A1.9 1.9 0 1 1 6.41 17.59A1.9 1.9 0 1 1 7.26 15.18Z"/>
  </svg>
</span>`;

const BAT_SVG = `<svg viewBox="0 0 64 32" aria-hidden="true"><path d="M32 11c1.4-2.6 2.8-4 4.3-5l.9 3.3c4.6-3.6 11.6-6 19.8-4.4-4.2 2-6.6 5.8-6.4 10.6-3.4-2.4-7.2-2.2-10 .8-2-3-5-3.6-8.6-.6-3.6-3-6.6-2.4-8.6.6-2.8-3-6.6-3.2-10-.8.2-4.8-2.2-8.6-6.4-10.6 8.2-1.6 15.2.8 19.8 4.4l.9-3.3c1.5 1 2.9 2.4 4.3 5z"/></svg>`;

function fromHTML(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
const PUMPKIN_TPL = fromHTML(PUMPKIN_HTML);
const MARK_TPL = fromHTML(MARK_HTML);

const $ = (sel) => document.querySelector(sel);
const boardEl = $('#board');
const timerEl = $('#timer');
const bestEl = $('#best');
const seedEl = $('#seed');
const autoXEl = $('#autox');
const soundEl = $('#sound');
const hapticsEl = $('#haptics');
const muteBtn = $('#mute');
const undoBtn = $('#undo');
const winEl = $('#win');
const toastEl = $('#toast');
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? { matches: false };

// ---------- Storage (every call guarded: private mode, quota, disabled storage) ----------

const PREFIX = 'pumpkin-patch:';
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* storage unavailable */
    }
  },
};

// ---------- State ----------

let puzzle = null; // { size, seed, regions, solution }
let n = 6;
let cells = new Uint8Array(0);
let hinted = new Uint8Array(0);
let seq = new Uint32Array(0); // placement order of pumpkins, for the win light-up
let seqCounter = 0;
let undoStack = [];
let won = false;
let hintsUsed = 0;
let views = []; // per cell: { el, tile, fx, piece, state, conflict, hinted }
let colors = [];
let groups = []; // [{ key, cells: [indices in sweep order], axis }]
let groupsOf = []; // per cell: indices into `groups`
let lastConflicts = new Set();
let lastComplete = new Set();
let gameToken = 0; // bumps on every new puzzle so stale timers do nothing

const timer = { acc: 0, startedAt: 0, running: false };
let tickHandle = 0;

// ---------- Colours ----------

function hexToOklab(hex) {
  const v = parseInt(hex.slice(1), 16);
  const [r, g, b] = [v >> 16, (v >> 8) & 255, v & 255].map((x) => {
    x /= 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const LAB = PALETTE.map((p) => hexToOklab(p.hex));
const labDist = (a, b) => Math.hypot(LAB[a][0] - LAB[b][0], LAB[a][1] - LAB[b][1], LAB[a][2] - LAB[b][2]);

// Pick colours so neighbouring regions are as different as possible.
function assignColors(regions, seed) {
  const adj = regionAdjacency(regions);
  const rng = createRng(`colors:${seed}`);
  let best = null;
  let bestScore = [-1, -1];
  for (let t = 0; t < 600; t++) {
    const perm = [...PALETTE.keys()];
    for (let i = perm.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    let min = Infinity;
    let sum = 0;
    adj.forEach((set, a) => set.forEach((b) => {
      if (b < a) return;
      const d = labDist(perm[a], perm[b]);
      min = Math.min(min, d);
      sum += d;
    }));
    if (min > bestScore[0] || (min === bestScore[0] && sum > bestScore[1])) {
      bestScore = [min, sum];
      best = perm;
    }
  }
  return best.slice(0, regions.length).map((i) => PALETTE[i]);
}

// ---------- Groups (rows, columns, regions) ----------

function buildGroups() {
  groups = [];
  groupsOf = Array.from({ length: n * n }, () => []);
  const add = (key, idxs, axis) => {
    const g = groups.length;
    groups.push({ key, cells: idxs, axis });
    for (const i of idxs) groupsOf[i].push(g);
  };
  for (let r = 0; r < n; r++) add(`r${r}`, [...Array(n).keys()].map((c) => r * n + c), 'x');
  for (let c = 0; c < n; c++) add(`c${c}`, [...Array(n).keys()].map((r) => r * n + c), 'y');
  const byRegion = Array.from({ length: n }, () => []);
  for (let i = 0; i < n * n; i++) byRegion[puzzle.regions[Math.floor(i / n)][i % n]].push(i);
  byRegion.forEach((idxs, id) => {
    // Diagonal sweep order for irregular regions.
    idxs.sort((a, b) => (Math.floor(a / n) + (a % n)) - (Math.floor(b / n) + (b % n)) || a - b);
    add(`g${id}`, idxs, 'd');
  });
}

// A group is "complete" when every cell is decided: one pumpkin (not clashing) and X's elsewhere.
function completeGroups(conflicts) {
  const done = new Set();
  for (const g of groups) {
    let pumpkins = 0;
    let empty = 0;
    let bad = false;
    for (const i of g.cells) {
      if (cells[i] === PUMPKIN) {
        pumpkins++;
        if (conflicts.has(`${Math.floor(i / n)},${i % n}`)) bad = true;
      } else if (cells[i] === EMPTY) {
        empty++;
      }
    }
    if (pumpkins === 1 && empty === 0 && !bad) done.add(g.key);
  }
  return done;
}

// ---------- Puzzle lifecycle ----------

function startPuzzle(size, seed, saved = null) {
  puzzle = generatePuzzle({ size, seed });
  n = puzzle.size;
  gameToken++;
  colors = assignColors(puzzle.regions, puzzle.seed);
  cells = new Uint8Array(n * n);
  hinted = new Uint8Array(n * n);
  seq = new Uint32Array(n * n);
  seqCounter = 0;
  undoStack = [];
  won = false;
  hintsUsed = 0;
  timer.acc = 0;

  if (saved && saved.cells?.length === n * n) {
    cells = Uint8Array.from(saved.cells);
    if (saved.hinted?.length === n * n) hinted = Uint8Array.from(saved.hinted);
    if (saved.seq?.length === n * n) seq = Uint32Array.from(saved.seq);
    seqCounter = Math.max(0, ...seq);
    hintsUsed = saved.hintsUsed || 0;
    timer.acc = saved.elapsed || 0;
  }

  store.set('size', n);
  try {
    window.history.replaceState(null, '', `?size=${n}&seed=${encodeURIComponent(puzzle.seed)}`);
  } catch {
    /* file:// or sandboxed */
  }
  seedEl.textContent = puzzle.seed;
  document.querySelectorAll('.sizes button').forEach((b) => {
    b.setAttribute('aria-checked', String(Number(b.dataset.size) === n));
  });
  winEl.hidden = true;
  $('#bats').innerHTML = '';
  boardEl.classList.remove('won');
  buildGroups();
  buildBoard();
  lastConflicts = render({ animate: false });
  lastComplete = completeGroups(lastConflicts);
  showBest();
  timer.running = false;
  resumeTimer();
}

function newPuzzle(size = n) {
  store.remove('save');
  startPuzzle(size, randomSeed());
}

function save() {
  if (won || !puzzle) {
    store.remove('save');
    return;
  }
  store.set('save', {
    size: n,
    seed: puzzle.seed,
    cells: [...cells],
    hinted: [...hinted],
    seq: [...seq],
    hintsUsed,
    elapsed: elapsed(),
  });
}

// ---------- Board rendering ----------

function buildBoard() {
  boardEl.style.setProperty('--n', n);
  boardEl.textContent = '';
  views = [];
  const R = puzzle.regions;
  const wall = '2px solid var(--wall)';
  const thin = '1px solid var(--grid)';
  const frag = document.createDocumentFragment();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const id = R[r][c];
      const el = document.createElement('div');
      el.className = 'cell';
      el.setAttribute('role', 'gridcell');
      el.dataset.i = r * n + c;
      // Walls straddle region boundaries (2px each side); thin grooves inside a region.
      el.style.borderTop = r > 0 && R[r - 1][c] !== id ? wall : 'none';
      el.style.borderLeft = c > 0 && R[r][c - 1] !== id ? wall : 'none';
      el.style.borderBottom = r < n - 1 ? (R[r + 1][c] !== id ? wall : thin) : 'none';
      el.style.borderRight = c < n - 1 ? (R[r][c + 1] !== id ? wall : thin) : 'none';
      const tile = document.createElement('div');
      tile.className = colors[id].light ? 'tile light' : 'tile';
      tile.style.setProperty('--rc', colors[id].hex);
      const fxEl = document.createElement('div');
      fxEl.className = 'fx';
      tile.appendChild(fxEl);
      el.appendChild(tile);
      frag.appendChild(el);
      views.push({ el, tile, fx: fxEl, piece: null, state: EMPTY, conflict: false, hinted: false });
    }
  }
  boardEl.appendChild(frag);
}

function makePiece(state) {
  const el = (state === PUMPKIN ? PUMPKIN_TPL : MARK_TPL).cloneNode(true);
  if (state === PUMPKIN) {
    // Each lantern flickers on its own clock.
    el.style.setProperty('--fd', `${(1.7 + Math.random() * 1.8).toFixed(2)}s`);
    el.style.setProperty('--fdl', `${(-Math.random() * 3.5).toFixed(2)}s`);
  }
  return el;
}

function cellLabel(i) {
  const r = Math.floor(i / n);
  const c = i % n;
  const what = cells[i] === PUMPKIN ? 'pumpkin' : cells[i] === MARK ? 'marked' : 'empty';
  return `Row ${r + 1}, column ${c + 1}, ${colors[puzzle.regions[r][c]].name}, ${what}`;
}

/** Sync one cell's piece with `cells[i]`, animating the change unless told not to. */
function updateCell(i, animate = true, delay = 0) {
  const v = views[i];
  const state = cells[i];
  if (v.state === state) return;
  if (v.piece) {
    const old = v.piece;
    v.piece = null;
    if (animate) {
      old.classList.add('out');
      setTimeout(() => old.remove(), 130);
    } else {
      old.remove();
    }
  }
  if (state !== EMPTY) {
    const p = makePiece(state);
    if (!animate) p.classList.add('still');
    else if (delay) p.style.setProperty('--d', `${delay}ms`);
    v.tile.appendChild(p);
    v.piece = p;
  }
  v.state = state;
  v.conflict = false;
  v.hinted = false;
  v.el.setAttribute('aria-label', cellLabel(i));
}

function pumpkinList() {
  const list = [];
  for (let i = 0; i < cells.length; i++) if (cells[i] === PUMPKIN) list.push([Math.floor(i / n), i % n]);
  return list;
}

/** Bring every cell up to date. Returns the current conflict set. */
function render({ animate = true } = {}) {
  const pumpkins = pumpkinList();
  const conflicts = findConflicts(puzzle.regions, pumpkins);
  for (let i = 0; i < views.length; i++) {
    updateCell(i, animate);
    const v = views[i];
    if (v.state !== PUMPKIN) continue;
    const bad = conflicts.has(`${Math.floor(i / n)},${i % n}`);
    if (bad !== v.conflict) {
      v.conflict = bad;
      v.piece.classList.toggle('conflict', bad);
      v.tile.classList.toggle('bad', bad);
    }
    const h = hinted[i] === 1;
    if (h !== v.hinted) {
      v.hinted = h;
      v.piece.classList.toggle('hinted', h);
    }
  }
  // Clear stale red tiles left by pumpkins that were removed.
  for (const v of views) if (v.state !== PUMPKIN && v.tile.classList.contains('bad')) v.tile.classList.remove('bad');
  undoBtn.disabled = undoStack.length === 0 || won;
  if (!won && pumpkins.length === n && conflicts.size === 0) win();
  return conflicts;
}

// ---------- Feedback: conflicts shake, completed lines glow ----------

function shake(i) {
  const p = views[i].piece;
  if (!p || reducedMotion.matches) return;
  p.classList.remove('shake');
  void p.offsetWidth; // restart the animation if it was already shaking
  p.classList.add('shake');
  p.addEventListener('animationend', () => p.classList.remove('shake'), { once: true });
}

function sweep(g) {
  const spans = [];
  g.cells.forEach((i, k) => {
    const s = document.createElement('span');
    s.className = `sweep ${g.axis}`;
    s.style.setProperty('--d', `${k * 30}ms`);
    views[i].fx.appendChild(s);
    spans.push(s);
  });
  setTimeout(() => spans.forEach((s) => s.remove()), g.cells.length * 30 + 600);
}

/** After any move: react to new conflicts and newly completed groups. Returns true on a new clash. */
function feedback(conflicts) {
  let clash = false;
  for (const key of conflicts) {
    if (lastConflicts.has(key)) continue;
    const [r, c] = key.split(',').map(Number);
    shake(r * n + c);
    clash = true;
  }
  if (clash) {
    sound.conflict();
    buzz(HAPTIC.conflict);
  }
  const complete = won ? new Set() : completeGroups(conflicts);
  for (const g of groups) if (complete.has(g.key) && !lastComplete.has(g.key)) sweep(g);
  lastConflicts = conflicts;
  lastComplete = complete;
  return clash;
}

// ---------- Moves ----------

function snapshot() {
  return { cells: cells.slice(), hinted: hinted.slice(), seq: seq.slice(), hintsUsed };
}

function pushHistory(snap) {
  undoStack.push(snap);
  if (undoStack.length > 300) undoStack.shift();
}

function sameCells(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// X out every empty cell a pumpkin rules out. Returns the cells marked, nearest first.
function autoMark(i) {
  const r = Math.floor(i / n);
  const c = i % n;
  const region = puzzle.regions[r][c];
  const marked = [];
  for (let j = 0; j < cells.length; j++) {
    if (j === i || cells[j] !== EMPTY) continue;
    const rr = Math.floor(j / n);
    const cc = j % n;
    if (rr === r || cc === c || puzzle.regions[rr][cc] === region || (Math.abs(rr - r) <= 1 && Math.abs(cc - c) <= 1)) {
      cells[j] = MARK;
      marked.push(j);
    }
  }
  const dist = (j) => Math.max(Math.abs(Math.floor(j / n) - r), Math.abs((j % n) - c));
  return marked.sort((a, b) => dist(a) - dist(b));
}

// Auto-X marks ripple outward from the pumpkin.
function rippleMarks(marked, origin) {
  const r = Math.floor(origin / n);
  const c = origin % n;
  for (const j of marked) {
    const d = Math.max(Math.abs(Math.floor(j / n) - r), Math.abs((j % n) - c));
    updateCell(j, true, 120 + d * 20);
  }
}

function placePumpkin(i) {
  seq[i] = ++seqCounter;
  updateCell(i, true);
  if (autoXEl.checked) rippleMarks(autoMark(i), i);
}

function cycle(i) {
  if (hinted[i]) {
    toast('Hinted pumpkins stay put (undo removes them)');
    return;
  }
  pushHistory(snapshot());
  cells[i] = (cells[i] + 1) % 3;
  if (cells[i] === PUMPKIN) {
    placePumpkin(i);
    sound.thunk();
    buzz(HAPTIC.pumpkin);
  } else if (cells[i] === MARK) {
    sound.tick();
    buzz(HAPTIC.mark);
  } else {
    sound.pluck();
  }
  commit();
}

function commit() {
  feedback(render());
  save();
}

function undo() {
  if (won) return;
  const snap = undoStack.pop();
  if (!snap) return;
  cells = snap.cells;
  hinted = snap.hinted;
  seq = snap.seq;
  hintsUsed = snap.hintsUsed;
  sound.untick();
  // Undo shouldn't shake or sweep: resync feedback state silently.
  lastConflicts = render();
  lastComplete = completeGroups(lastConflicts);
  save();
}

function clearBoard() {
  if (won || cells.every((v) => v === EMPTY)) return;
  pushHistory(snapshot());
  cells.fill(EMPTY);
  hinted.fill(0);
  sound.untick();
  commit();
}

function hint() {
  if (won) return;
  const sol = puzzle.solution;
  const missing = [];
  for (let r = 0; r < n; r++) if (cells[r * n + sol[r]] !== PUMPKIN) missing.push(r * n + sol[r]);
  if (missing.length) {
    pushHistory(snapshot());
    const i = missing[Math.floor(Math.random() * missing.length)];
    cells[i] = PUMPKIN;
    hinted[i] = 1;
    placePumpkin(i);
    sound.thunk();
    buzz(HAPTIC.pumpkin);
  } else {
    // Every correct pumpkin is down, so the problem is an extra one. Remove it.
    const wrong = [];
    for (let i = 0; i < cells.length; i++) if (cells[i] === PUMPKIN && sol[Math.floor(i / n)] !== i % n) wrong.push(i);
    if (!wrong.length) return;
    pushHistory(snapshot());
    cells[wrong[0]] = MARK;
    sound.pluck();
    toast('Removed a pumpkin that doesn’t belong');
  }
  hintsUsed++;
  commit();
}

// ---------- Pointer input: tap to cycle, drag to paint X ----------

let drag = null;

// Board geometry, measured once per gesture. Hit-testing with arithmetic instead of
// elementFromPoint avoids forcing a style/layout pass after every painted X.
let geom = null;

function measureBoard() {
  const r = boardEl.getBoundingClientRect();
  geom = { x: r.left + boardEl.clientLeft, y: r.top + boardEl.clientTop, size: boardEl.clientWidth / n };
}

function cellIndexAt(x, y) {
  if (!geom) measureBoard();
  const c = Math.floor((x - geom.x) / geom.size);
  const r = Math.floor((y - geom.y) / geom.size);
  return r >= 0 && r < n && c >= 0 && c < n ? r * n + c : null;
}

function press(i) {
  if (drag.pressed != null) views[drag.pressed]?.el.classList.remove('pressed');
  drag.pressed = i;
  if (i != null) views[i].el.classList.add('pressed');
}

// Cells on the straight line from a to b (exclusive of a), so fast swipes don't skip any.
function lineCells(a, b) {
  const r0 = Math.floor(a / n);
  const c0 = a % n;
  const r1 = Math.floor(b / n);
  const c1 = b % n;
  const steps = Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0));
  const out = [];
  for (let s = 1; s <= steps; s++) {
    const r = Math.round(r0 + ((r1 - r0) * s) / steps);
    const c = Math.round(c0 + ((c1 - c0) * s) / steps);
    const i = r * n + c;
    if (out[out.length - 1] !== i) out.push(i);
  }
  return out;
}

// Paint a batch of cells, staggering each by 20ms so a swipe ripples.
function paintBatch(list) {
  let k = 0;
  for (const i of list) {
    if (hinted[i]) continue;
    const from = cells[i];
    if (drag.mode === 'paint' && from === EMPTY) cells[i] = MARK;
    else if (drag.mode === 'erase' && from === MARK) cells[i] = EMPTY;
    else continue;
    updateCell(i, true, k * 20);
    if (drag.mode === 'paint') sound.tick(k * 0.02);
    else if (k === 0) sound.untick();
    k++;
  }
  if (k) {
    buzz(HAPTIC.mark, 35);
    // Completed rows/columns light up mid-swipe.
    const complete = completeGroups(lastConflicts);
    for (const g of groups) if (complete.has(g.key) && !lastComplete.has(g.key)) sweep(g);
    lastComplete = complete;
  }
}

boardEl.addEventListener('pointerdown', (e) => {
  unlockAudio();
  if (won || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
  measureBoard();
  const i = cellIndexAt(e.clientX, e.clientY);
  if (i == null) return;
  e.preventDefault();
  drag = { id: e.pointerId, start: i, last: i, moved: false, mode: null, before: snapshot(), pressed: null, queue: [], raf: 0 };
  press(i);
  try {
    boardEl.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
});

// Pointer events can arrive several times per frame. Hit-test them as they come
// (pure arithmetic), but touch the DOM at most once per frame.
function flushDrag() {
  if (!drag) return;
  drag.raf = 0;
  if (drag.queue.length) {
    paintBatch(drag.queue);
    drag.queue = [];
  }
  if (drag.pressed !== drag.last) press(drag.last);
}

boardEl.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  // Coalesced events give every sample from a fast swipe, not just one per frame.
  const samples = e.getCoalescedEvents?.() || [e];
  for (const s of samples.length ? samples : [e]) {
    const i = cellIndexAt(s.clientX, s.clientY);
    if (i == null || i === drag.last) continue;
    if (!drag.moved) {
      drag.moved = true;
      // Dragging from an X erases X's; from anywhere else it paints them.
      drag.mode = cells[drag.start] === MARK ? 'erase' : 'paint';
      drag.queue.push(drag.start);
    }
    drag.queue.push(...lineCells(drag.last, i));
    drag.last = i;
  }
  if (!drag.raf && (drag.queue.length || drag.pressed !== drag.last)) drag.raf = requestAnimationFrame(flushDrag);
});

function endDrag(e, cancelled) {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.raf) cancelAnimationFrame(drag.raf);
  flushDrag();
  const d = drag;
  press(null);
  drag = null;
  if (!d.moved) {
    if (!cancelled) cycle(d.start);
    return;
  }
  if (!sameCells(d.before.cells, cells)) pushHistory(d.before);
  commit();
}

boardEl.addEventListener('pointerup', (e) => endDrag(e, false));
boardEl.addEventListener('pointercancel', (e) => endDrag(e, true));
boardEl.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Timer ----------

function elapsed() {
  return timer.acc + (timer.running ? Date.now() - timer.startedAt : 0);
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

let shownTime = '';
function tick() {
  const t = formatTime(elapsed());
  if (t !== shownTime) timerEl.textContent = shownTime = t;
}

function pauseTimer() {
  if (!timer.running) return;
  timer.acc = elapsed();
  timer.running = false;
  clearInterval(tickHandle);
  tick();
}

function resumeTimer() {
  if (timer.running || won || document.hidden) {
    tick();
    return;
  }
  timer.startedAt = Date.now();
  timer.running = true;
  clearInterval(tickHandle);
  tickHandle = setInterval(tick, 250);
  tick();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pauseTimer();
    save();
  } else {
    resumeTimer();
  }
});
window.addEventListener('pagehide', save);

// ---------- Best times ----------

function showBest() {
  const best = store.get(`best:${n}`, null);
  bestEl.textContent = typeof best === 'number' ? formatTime(best) : '–';
}

// ---------- Win ----------

function win() {
  won = true;
  pauseTimer();
  const time = timer.acc;
  const token = gameToken;
  store.remove('save');

  const prev = store.get(`best:${n}`, null);
  let bestLine;
  if (hintsUsed > 0) {
    bestLine = `${hintsUsed} hint${hintsUsed > 1 ? 's' : ''} used, so no best time this round.`;
  } else if (typeof prev !== 'number' || time < prev) {
    store.set(`best:${n}`, time);
    bestLine = typeof prev === 'number' ? `New best! Old record ${formatTime(prev)}.` : 'First solve at this size. New best!';
  } else {
    bestLine = `Best for ${n}×${n}: ${formatTime(prev)}`;
  }
  showBest();
  undoBtn.disabled = true;
  boardEl.classList.add('won');
  $('#win-time').textContent = `Solved in ${formatTime(time)}`;
  $('#win-best').textContent = bestLine;

  // Light the pumpkins one at a time in the order they were placed, then release the bats.
  const order = [];
  for (let i = 0; i < cells.length; i++) if (cells[i] === PUMPKIN) order.push(i);
  order.sort((a, b) => seq[a] - seq[b] || a - b);
  const step = reducedMotion.matches ? 90 : 230;
  const later = (fn, ms) => setTimeout(() => token === gameToken && won && fn(), ms);
  order.forEach((i, k) => later(() => {
    views[i].piece?.classList.add('lit');
    sound.light(k);
    buzz(10);
  }, 350 + k * step));
  const batsAt = 350 + order.length * step + 150;
  later(() => {
    sound.chime();
    buzz(HAPTIC.win);
    releaseBats();
  }, batsAt);
  later(() => {
    winEl.hidden = false;
    $('#win-new').focus();
  }, batsAt + 1400);
}

function releaseBats() {
  const layer = $('#bats');
  layer.innerHTML = '';
  for (let b = 0; b < 9; b++) {
    const bat = document.createElement('div');
    bat.className = b % 2 ? 'bat rtl' : 'bat';
    bat.innerHTML = BAT_SVG;
    bat.style.setProperty('--size', `${40 + Math.random() * 40}px`);
    bat.style.setProperty('--top', `${5 + Math.random() * 70}vh`);
    bat.style.setProperty('--dy', `${(Math.random() - 0.5) * 30}vh`);
    bat.style.setProperty('--dur', `${2.2 + Math.random() * 1.6}s`);
    bat.style.setProperty('--wait', `${Math.random() * 0.9}s`);
    layer.appendChild(bat);
  }
  const token = gameToken;
  setTimeout(() => {
    if (token === gameToken) layer.innerHTML = '';
  }, 5000);
}

// ---------- Toast ----------

let toastHandle = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastHandle);
  toastHandle = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

// ---------- Controls & settings ----------

const sizesEl = $('.sizes');
for (const { size, label } of SIZES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.size = size;
  b.setAttribute('role', 'radio');
  b.innerHTML = `<strong>${size}×${size}</strong><span>${label}</span>`;
  b.addEventListener('click', () => {
    if (size !== n || won) newPuzzle(size);
  });
  sizesEl.appendChild(b);
}

undoBtn.addEventListener('click', undo);
$('#clear').addEventListener('click', clearBoard);
$('#hint').addEventListener('click', hint);
$('#new').addEventListener('click', () => newPuzzle());
$('#win-new').addEventListener('click', () => newPuzzle());
$('#win-close').addEventListener('click', () => {
  winEl.hidden = true;
});
document.addEventListener('pointerdown', unlockAudio, { passive: true });

autoXEl.checked = store.get('autoX', false) === true;
autoXEl.addEventListener('change', () => store.set('autoX', autoXEl.checked));

function setSound(on) {
  fx.sound = on;
  soundEl.checked = on;
  muteBtn.setAttribute('aria-pressed', String(!on));
  muteBtn.setAttribute('aria-label', on ? 'Mute sound' : 'Unmute sound');
  muteBtn.classList.toggle('muted', !on);
  store.set('sound', on);
  if (on) unlockAudio();
}
setSound(store.get('sound', true) !== false);
soundEl.addEventListener('change', () => setSound(soundEl.checked));
muteBtn.addEventListener('click', () => {
  setSound(!fx.sound);
  if (fx.sound) sound.tick();
});

fx.haptics = canVibrate && store.get('haptics', true) !== false;
hapticsEl.checked = fx.haptics;
if (!canVibrate) {
  hapticsEl.disabled = true;
  hapticsEl.closest('.toggle').classList.add('unsupported');
}
hapticsEl.addEventListener('change', () => {
  fx.haptics = hapticsEl.checked;
  store.set('haptics', fx.haptics);
  buzz(HAPTIC.pumpkin);
});

$('#share').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?size=${n}&seed=${encodeURIComponent(puzzle.seed)}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Pumpkin Patch', text: `Try this ${n}×${n} Pumpkin Patch`, url });
    } else {
      await navigator.clipboard.writeText(url);
      toast('Puzzle link copied');
    }
  } catch {
    /* share cancelled or clipboard blocked */
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  }
});

// ---------- Boot ----------

function boot() {
  const params = new URLSearchParams(location.search);
  const saved = store.get('save', null);
  const validSize = (s) => SIZES.some((x) => x.size === s);
  const urlSize = Number(params.get('size'));
  const urlSeed = params.get('seed');

  if (validSize(urlSize) && urlSeed) {
    const match = saved && saved.size === urlSize && saved.seed === urlSeed;
    startPuzzle(urlSize, urlSeed, match ? saved : null);
  } else if (saved && validSize(saved.size) && saved.seed) {
    startPuzzle(saved.size, saved.seed, saved);
  } else {
    const size = store.get('size', 6);
    startPuzzle(validSize(size) ? size : 6, randomSeed());
  }
}

boot();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
