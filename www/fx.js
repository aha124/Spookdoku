// Sound (synthesized with Web Audio, no files) and haptics (navigator.vibrate).
// Everything is optional: unsupported APIs and blocked audio fail silently.

export const settings = { sound: true, haptics: true };

export const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

// ---------- Haptics ----------

let lastBuzz = 0;

/** Vibrate if enabled and supported. `minGap` throttles rapid calls (drag painting). */
export function buzz(pattern, minGap = 0) {
  if (!settings.haptics || !canVibrate) return;
  const now = performance.now();
  if (minGap && now - lastBuzz < minGap) return;
  lastBuzz = now;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}

export const HAPTIC = {
  mark: 8,
  pumpkin: 15,
  conflict: [14, 60, 14],
  win: [30, 70, 30, 70, 60, 110, 160],
};

// ---------- Audio ----------

let ctx = null;
let master = null;
let noiseBuf = null;
let tickBuf = null;
let untickBuf = null;

// Pre-render the wooden tick once, so each X costs one buffer source instead of a
// handful of oscillators and filters. Matters when a swipe paints a dozen X's.
function renderTick(sr, { noiseGain, toneGain, f0, f1, len = 0.05 }) {
  const buf = ctx.createBuffer(1, Math.floor(sr * len), sr);
  const d = buf.getChannelData(0);
  let phase = 0;
  let lp = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const f = f0 * (f1 / f0) ** Math.min(1, t / 0.035);
    phase += (2 * Math.PI * f) / sr;
    const white = Math.random() * 2 - 1;
    lp += 0.3 * (white - lp);
    const bright = white - lp; // crude high-pass: the "wood" click
    const attack = Math.min(1, i / (sr * 0.0008));
    d[i] = attack * (noiseGain * bright * Math.exp(-t / 0.007) + toneGain * Math.sin(phase) * Math.exp(-t / 0.012));
  }
  return buf;
}

/** Create/resume the AudioContext. Call from a user gesture so browsers allow playback. */
export function unlockAudio() {
  if (!settings.sound) return;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.3), ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      tickBuf = renderTick(ctx.sampleRate, { noiseGain: 0.5, toneGain: 0.22, f0: 1250, f1: 820 });
      untickBuf = renderTick(ctx.sampleRate, { noiseGain: 0.22, toneGain: 0.04, f0: 900, f1: 700, len: 0.035 });
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
}

function ready() {
  if (!settings.sound) return null;
  unlockAudio();
  return ctx && ctx.state === 'running' ? ctx : null;
}

function play(buf, t, rate = 1) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  src.connect(master);
  src.start(t);
}

function envelope(g, t, attack, peak, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function tone({ type = 'sine', freq, freqEnd, t, attack = 0.005, decay = 0.2, gain = 0.3, dest = master }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
  envelope(g, t, attack, gain, decay);
  o.connect(g);
  g.connect(dest);
  o.start(t);
  o.stop(t + attack + decay + 0.05);
}

function noise({ t, decay, gain, freq, q = 1, type = 'bandpass' }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  envelope(g, t, 0.002, gain, decay);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + decay + 0.05);
}

// Diminished-ish scale for the win lights: spooky but still musical.
const LIGHT_NOTES = [293.66, 349.23, 415.3, 440, 523.25, 622.25, 698.46, 830.61, 880, 1046.5];

export const sound = {
  /** Soft wooden tick (X mark). `delay` in seconds lets drag ripples line up with visuals. */
  tick(delay = 0) {
    const c = ready();
    if (!c) return;
    // Slight pitch variety so a swipe doesn't sound like a machine gun.
    play(tickBuf, c.currentTime + delay, 0.94 + Math.random() * 0.12);
  },

  /** Quieter tick for erasing. */
  untick() {
    const c = ready();
    if (!c) return;
    play(untickBuf, c.currentTime);
  },

  /** Hollow thunk (pumpkin lands). Timed to the squash in the drop animation. */
  thunk() {
    const c = ready();
    if (!c) return;
    const t = c.currentTime + 0.15;
    tone({ freq: 200, freqEnd: 82, t, attack: 0.004, decay: 0.18, gain: 0.6 });
    tone({ type: 'triangle', freq: 410, freqEnd: 180, t, attack: 0.002, decay: 0.08, gain: 0.12 });
    noise({ t, decay: 0.06, gain: 0.16, freq: 450, type: 'lowpass' });
  },

  /** Pumpkin removed: small dry pop. */
  pluck() {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    tone({ freq: 320, freqEnd: 520, t, attack: 0.002, decay: 0.06, gain: 0.15 });
  },

  /** Low dissonant tone (a clash). */
  conflict() {
    const c = ready();
    if (!c) return;
    const t = c.currentTime + 0.2;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 650;
    lp.connect(master);
    tone({ type: 'sawtooth', freq: 110, t, attack: 0.02, decay: 0.42, gain: 0.16, dest: lp });
    tone({ type: 'sawtooth', freq: 116.54, t, attack: 0.02, decay: 0.42, gain: 0.16, dest: lp });
    tone({ type: 'sine', freq: 55, t, attack: 0.02, decay: 0.4, gain: 0.25 });
  },

  /** One pumpkin lighting up during the win sequence. */
  light(k) {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    const f = LIGHT_NOTES[k % LIGHT_NOTES.length];
    tone({ freq: f, t, attack: 0.004, decay: 0.45, gain: 0.12 });
    tone({ freq: f * 2.76, t, attack: 0.002, decay: 0.15, gain: 0.03 });
  },

  /** Short spooky chime: a diminished arpeggio of bell tones. */
  chime() {
    const c = ready();
    if (!c) return;
    const t0 = c.currentTime;
    [659.25, 783.99, 932.33, 1318.51].forEach((f, k) => {
      const t = t0 + k * 0.14;
      tone({ freq: f, t, attack: 0.004, decay: 1.5, gain: 0.16 });
      tone({ freq: f * 2.76, t, attack: 0.002, decay: 0.5, gain: 0.04 });
      tone({ freq: f * 0.5, t, attack: 0.01, decay: 1.2, gain: 0.05 });
    });
  },
};
