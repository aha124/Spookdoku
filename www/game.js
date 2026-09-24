// Pumpkin Patch UI: rendering, input, timer, storage.
import { SIZES, generatePuzzle, findConflicts, regionAdjacency, randomSeed, createRng } from './puzzle.js';

const EMPTY = 0;
const MARK = 1;
const PUMPKIN = 2;

// Muted Halloween palette. `light` colours get dark X marks.
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

const PUMPKIN_SVG = `<svg class="pk" viewBox="0 0 64 64" aria-hidden="true">
  <path class="stem" d="M29.5 16c-.6-6 1.8-10 6.5-12.5l2.6 3.2c-3.6 2-4.8 4.8-4.2 9.3z"/>
  <ellipse class="lobe side" cx="20" cy="39" rx="15" ry="20"/>
  <ellipse class="lobe side" cx="44" cy="39" rx="15" ry="20"/>
  <ellipse class="lobe mid" cx="32" cy="39" rx="15.5" ry="22"/>
  <g class="face">
    <path d="M18.5 33h9l-4.5-8z"/>
    <path d="M36.5 33h9l-4.5-8z"/>
    <path d="M30 39.5h4l-2-3.5z"/>
    <path d="M16.5 42.5Q32 60 47.5 42.5l-3.8 2.4-2.9-2.6-3 3.9-3.3-3.1-2.5 3.3-2.5-3.3-3.3 3.1-3-3.9-2.9 2.6z"/>
  </g>
</svg>`;
const MARK_SVG = `<svg class="x" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.6 2.6l4.8 4.8M7.4 2.6L2.6 7.4"/></svg>`;
const BAT_SVG = `<svg viewBox="0 0 64 32" aria-hidden="true"><path d="M32 11c1.4-2.6 2.8-4 4.3-5l.9 3.3c4.6-3.6 11.6-6 19.8-4.4-4.2 2-6.6 5.8-6.4 10.6-3.4-2.4-7.2-2.2-10 .8-2-3-5-3.6-8.6-.6-3.6-3-6.6-2.4-8.6.6-2.8-3-6.6-3.2-10-.8.2-4.8-2.2-8.6-6.4-10.6 8.2-1.6 15.2.8 19.8 4.4l.9-3.3c1.5 1 2.9 2.4 4.3 5z"/></svg>`;

const $ = (sel) => document.querySelector(sel);
const boardEl = $('#board');
const timerEl = $('#timer');
const bestEl = $('#best');
const seedEl = $('#seed');
const autoXEl = $('#autox');
const undoBtn = $('#undo');
const winEl = $('#win');
const toastEl = $('#toast');

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
let undoStack = [];
let won = false;
let hintsUsed = 0;
let cellEls = [];
let colors = [];

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

// ---------- Puzzle lifecycle ----------

function startPuzzle(size, seed, saved = null) {
  puzzle = generatePuzzle({ size, seed });
  n = puzzle.size;
  colors = assignColors(puzzle.regions, puzzle.seed);
  cells = new Uint8Array(n * n);
  hinted = new Uint8Array(n * n);
  undoStack = [];
  won = false;
  hintsUsed = 0;
  timer.acc = 0;

  if (saved && saved.cells?.length === n * n) {
    cells = Uint8Array.from(saved.cells);
    hinted = Uint8Array.from(saved.hinted || []);
    if (hinted.length !== n * n) hinted = new Uint8Array(n * n);
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
  boardEl.classList.remove('won');
  buildBoard();
  render();
  showBest();
  timer.running = false;
  resumeTimer();
}

function newPuzzle(size = n) {
  store.remove('save');
  startPuzzle(size, randomSeed());
}

function save() {
  if (won) {
    store.remove('save');
    return;
  }
  store.set('save', {
    size: n,
    seed: puzzle.seed,
    cells: [...cells],
    hinted: [...hinted],
    hintsUsed,
    elapsed: elapsed(),
  });
}

// ---------- Board rendering ----------

function buildBoard() {
  boardEl.style.setProperty('--n', n);
  boardEl.innerHTML = '';
  cellEls = [];
  const R = puzzle.regions;
  const wall = '2px solid var(--wall)';
  const thin = '1px solid var(--grid)';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const el = document.createElement('div');
      const id = R[r][c];
      el.className = 'cell';
      el.setAttribute('role', 'gridcell');
      el.dataset.i = r * n + c;
      el.style.setProperty('--rc', colors[id].hex);
      if (colors[id].light) el.classList.add('light');
      // Walls straddle region boundaries (2px each side); thin lines inside a region.
      el.style.borderTop = r > 0 && R[r - 1][c] !== id ? wall : 'none';
      el.style.borderLeft = c > 0 && R[r][c - 1] !== id ? wall : 'none';
      el.style.borderBottom = r < n - 1 ? (R[r + 1][c] !== id ? wall : thin) : 'none';
      el.style.borderRight = c < n - 1 ? (R[r][c + 1] !== id ? wall : thin) : 'none';
      boardEl.appendChild(el);
      cellEls.push(el);
    }
  }
}

function pumpkinList() {
  const list = [];
  for (let i = 0; i < cells.length; i++) if (cells[i] === PUMPKIN) list.push([Math.floor(i / n), i % n]);
  return list;
}

function render() {
  const pumpkins = pumpkinList();
  const conflicts = findConflicts(puzzle.regions, pumpkins);
  for (let i = 0; i < cellEls.length; i++) {
    const el = cellEls[i];
    const state = cells[i];
    const r = Math.floor(i / n);
    const c = i % n;
    if (el._state !== state) {
      el.innerHTML = state === PUMPKIN ? PUMPKIN_SVG : state === MARK ? MARK_SVG : '';
      el._state = state;
    }
    el.classList.toggle('conflict', state === PUMPKIN && conflicts.has(`${r},${c}`));
    el.classList.toggle('hinted', state === PUMPKIN && hinted[i] === 1);
    const what = state === PUMPKIN ? 'pumpkin' : state === MARK ? 'marked' : 'empty';
    el.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}, ${colors[puzzle.regions[r][c]].name}, ${what}`);
  }
  undoBtn.disabled = undoStack.length === 0 || won;
  if (!won && pumpkins.length === n && conflicts.size === 0) win();
}

// ---------- Moves ----------

function snapshot() {
  return { cells: cells.slice(), hinted: hinted.slice(), hintsUsed };
}

function pushHistory(snap) {
  undoStack.push(snap);
  if (undoStack.length > 300) undoStack.shift();
}

function sameCells(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// X out every empty cell a pumpkin rules out.
function autoMark(i) {
  const r = Math.floor(i / n);
  const c = i % n;
  const region = puzzle.regions[r][c];
  for (let j = 0; j < cells.length; j++) {
    if (j === i || cells[j] !== EMPTY) continue;
    const rr = Math.floor(j / n);
    const cc = j % n;
    if (rr === r || cc === c || puzzle.regions[rr][cc] === region || (Math.abs(rr - r) <= 1 && Math.abs(cc - c) <= 1)) {
      cells[j] = MARK;
    }
  }
}

function cycle(i) {
  if (hinted[i]) {
    toast('Hinted pumpkins stay put (undo removes them)');
    return;
  }
  pushHistory(snapshot());
  cells[i] = (cells[i] + 1) % 3;
  if (cells[i] === PUMPKIN && autoXEl.checked) autoMark(i);
  commit();
}

function commit() {
  render();
  save();
}

function undo() {
  if (won) return;
  const snap = undoStack.pop();
  if (!snap) return;
  cells = snap.cells;
  hinted = snap.hinted;
  hintsUsed = snap.hintsUsed;
  commit();
}

function clearBoard() {
  if (won || cells.every((v) => v === EMPTY)) return;
  pushHistory(snapshot());
  cells.fill(EMPTY);
  hinted.fill(0);
  commit();
}

function hint() {
  if (won) return;
  const sol = puzzle.solution;
  const missing = [];
  for (let r = 0; r < n; r++) if (cells[r * n + sol[r]] !== PUMPKIN) missing.push(r * n + sol[r]);
  pushHistory(snapshot());
  if (missing.length) {
    const i = missing[Math.floor(Math.random() * missing.length)];
    cells[i] = PUMPKIN;
    hinted[i] = 1;
    if (autoXEl.checked) autoMark(i);
  } else {
    // Every correct pumpkin is down, so the problem is an extra one. Remove it.
    const wrong = [];
    for (let i = 0; i < cells.length; i++) if (cells[i] === PUMPKIN && sol[Math.floor(i / n)] !== i % n) wrong.push(i);
    if (!wrong.length) {
      undoStack.pop();
      return;
    }
    cells[wrong[0]] = MARK;
    toast('Removed a pumpkin that doesn’t belong');
  }
  hintsUsed++;
  commit();
}

// ---------- Pointer input: tap to cycle, drag to paint X ----------

let drag = null;

function cellIndexAt(x, y) {
  const el = document.elementFromPoint(x, y)?.closest?.('.cell');
  return el && boardEl.contains(el) ? Number(el.dataset.i) : null;
}

function paint(i) {
  if (hinted[i]) return;
  if (drag.mode === 'paint' && cells[i] === EMPTY) cells[i] = MARK;
  else if (drag.mode === 'erase' && cells[i] === MARK) cells[i] = EMPTY;
  render();
}

boardEl.addEventListener('pointerdown', (e) => {
  if (won || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const i = cellIndexAt(e.clientX, e.clientY);
  if (i == null) return;
  e.preventDefault();
  drag = { id: e.pointerId, start: i, last: i, moved: false, mode: null, before: snapshot() };
  try {
    boardEl.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
});

boardEl.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const i = cellIndexAt(e.clientX, e.clientY);
  if (i == null || i === drag.last) return;
  if (!drag.moved) {
    drag.moved = true;
    // Dragging from an X erases X's; from anywhere else it paints them.
    drag.mode = cells[drag.start] === MARK ? 'erase' : 'paint';
    paint(drag.start);
  }
  drag.last = i;
  paint(i);
});

function endDrag(e, cancelled) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
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

function tick() {
  timerEl.textContent = formatTime(elapsed());
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

  // Light the pumpkins one after another.
  let k = 0;
  cellEls.forEach((el, i) => {
    if (cells[i] === PUMPKIN) el.style.setProperty('--delay', `${k++ * 110}ms`);
  });
  boardEl.classList.add('won');
  releaseBats();

  $('#win-time').textContent = `Solved in ${formatTime(time)}`;
  $('#win-best').textContent = bestLine;
  setTimeout(() => {
    if (won) {
      winEl.hidden = false;
      $('#win-new').focus();
    }
  }, 1300);
}

function releaseBats() {
  const layer = $('#bats');
  layer.innerHTML = '';
  const count = 9;
  for (let b = 0; b < count; b++) {
    const bat = document.createElement('div');
    bat.className = 'bat';
    bat.innerHTML = BAT_SVG;
    const size = 40 + Math.random() * 40;
    bat.style.setProperty('--size', `${size}px`);
    bat.style.setProperty('--top', `${5 + Math.random() * 70}vh`);
    bat.style.setProperty('--dy', `${(Math.random() - 0.5) * 30}vh`);
    bat.style.setProperty('--dur', `${2.2 + Math.random() * 1.6}s`);
    bat.style.setProperty('--wait', `${Math.random() * 0.9}s`);
    if (b % 2) bat.classList.add('rtl');
    layer.appendChild(bat);
  }
  setTimeout(() => {
    layer.innerHTML = '';
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

// ---------- Controls ----------

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

autoXEl.checked = store.get('autoX', false) === true;
autoXEl.addEventListener('change', () => store.set('autoX', autoXEl.checked));

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
