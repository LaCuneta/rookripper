// Sounds are synthesised with the Web Audio API rather than shipped as files.
// Lichess's own samples are separately-licensed assets, and synthesis keeps the
// static bundle asset-free and working offline.
//
// A piece landing on a board is modelled as a struck wooden bar: a very short
// contact click, then a few inharmonic partials ringing and dying away. Noise
// is kept minimal on purpose — a noise-dominant hit reads as percussion (a
// drum) rather than as wood. Every parameter is tunable live from /sounds.

export interface WoodParams {
  /** Fundamental of the wood's lowest mode, Hz. Lower = bigger, heavier piece. */
  freq: number;
  /** Inharmonic mode ratios. A free-free bar rings at ~1 : 2.76 : 5.40. */
  partials: number[];
  /** Ring time of the fundamental, seconds. */
  decay: number;
  /** How much faster each higher mode dies (>1 = higher modes shorter). */
  decayScale: number;
  /** Level of the initial contact noise, 0..1. Keep low or it sounds like a drum. */
  click: number;
  /** Centre frequency of that contact noise, Hz. */
  clickTone: number;
  /** Overall output level, 0..1. */
  gain: number;
}

export interface WrongParams {
  freq: number;
  endFreq: number;
  dur: number;
  tremolo: number;
  lowpass: number;
  gain: number;
}

export interface SoundParams {
  move: WoodParams;
  capture: WoodParams;
  wrong: WrongParams;
}

export const DEFAULT_SOUND: SoundParams = {
  move: {
    freq: 430,
    partials: [1, 2.76, 5.4],
    decay: 0.09,
    decayScale: 1.7,
    click: 0.1,
    clickTone: 2600,
    gain: 0.5
  },
  capture: {
    freq: 290,
    partials: [1, 2.76, 5.4],
    decay: 0.13,
    decayScale: 1.6,
    click: 0.22,
    clickTone: 1700,
    gain: 0.7
  },
  wrong: {
    freq: 165,
    endFreq: 120,
    dur: 0.17,
    tremolo: 58,
    lowpass: 950,
    gain: 0.16
  }
};

const PARAMS_KEY = 'rookripper_sound_params';

let params: SoundParams | null = null;

export function loadSoundParams(): SoundParams {
  if (params) return params;
  if (typeof window === 'undefined') return DEFAULT_SOUND;
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    params = {
      move: { ...DEFAULT_SOUND.move, ...saved.move },
      capture: { ...DEFAULT_SOUND.capture, ...saved.capture },
      wrong: { ...DEFAULT_SOUND.wrong, ...saved.wrong }
    };
  } catch {
    params = DEFAULT_SOUND;
  }
  return params;
}

/** Update in memory (live preview) and persist. */
export function saveSoundParams(p: SoundParams): void {
  params = p;
  try {
    localStorage.setItem(PARAMS_KEY, JSON.stringify(p));
  } catch {
    /* storage full or blocked — in-memory update still applies */
  }
}

export function resetSoundParams(): void {
  params = null;
  try {
    localStorage.removeItem(PARAMS_KEY);
  } catch {
    /* ignore */
  }
}

// ── Audio engine ────────────────────────────────────────────────────────────

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    // Autoplay policy suspends the context until a user gesture; every caller
    // here runs from a click or drag, so resuming is safe.
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function noiseBuffer(ac: AudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ac.sampleRate * seconds));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function wood(ac: AudioContext, p: WoodParams): void {
  const t0 = ac.currentTime;

  const out = ac.createGain();
  out.gain.value = p.gain;
  out.connect(ac.destination);

  // Contact transient: brief and quiet, just enough to imply the strike.
  if (p.click > 0) {
    const dur = 0.012;
    const noise = ac.createBufferSource();
    noise.buffer = noiseBuffer(ac, dur);
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = p.clickTone;
    band.Q.value = 0.7;
    const g = ac.createGain();
    g.gain.setValueAtTime(p.click, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    noise.connect(band).connect(g).connect(out);
    noise.start(t0);
    noise.stop(t0 + dur + 0.005);
  }

  // Modal ring: the part that actually sounds like wood.
  p.partials.forEach((ratio, i) => {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = p.freq * ratio;

    const amp = 1 / (i + 1.6); // higher modes carry less energy
    const dur = Math.max(0.02, p.decay / Math.pow(p.decayScale, i));

    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(amp, t0 + 0.002); // near-instant attack
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.01);
  });
}

export function playMove(p?: WoodParams): void {
  const ac = getCtx();
  if (ac) wood(ac, p ?? loadSoundParams().move);
}

/** Heavier and lower than a plain move — one piece displacing another. */
export function playCapture(p?: WoodParams): void {
  const ac = getCtx();
  if (ac) wood(ac, p ?? loadSoundParams().capture);
}

/**
 * Wrong move: a soft low buzz, deliberately not an error klaxon — closer to a
 * terminal bell at the end of a scroll buffer.
 */
export function playWrong(p?: WrongParams): void {
  const ac = getCtx();
  if (!ac) return;
  const w = p ?? loadSoundParams().wrong;
  const t0 = ac.currentTime;

  const osc = ac.createOscillator();
  osc.type = 'triangle'; // softer harmonics than a square wave
  osc.frequency.setValueAtTime(w.freq, t0);
  osc.frequency.linearRampToValueAtTime(w.endFreq, t0 + w.dur);

  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = w.lowpass;

  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(w.gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + w.dur);

  // Tremolo gives it the "bzzt" rasp without making it harsh.
  const lfo = ac.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = w.tremolo;
  const lfoDepth = ac.createGain();
  lfoDepth.gain.value = w.gain * 0.4;
  lfo.connect(lfoDepth).connect(g.gain);

  osc.connect(lp).connect(g).connect(ac.destination);
  osc.start(t0);
  lfo.start(t0);
  osc.stop(t0 + w.dur);
  lfo.stop(t0 + w.dur);
}
