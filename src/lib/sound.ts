// Sounds are synthesised with the Web Audio API rather than shipped as files.
// Lichess's own samples are separately-licensed assets, and synthesis keeps the
// static bundle asset-free and works offline. These are close in character to
// Lichess (a short wooden click, a heavier thunk for captures) but not identical.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

// A piece landing on a board: a filtered noise transient for the "clack" plus a
// short low sine for the body of the thud.
function knock(ac: AudioContext, opts: { dur: number; tone: number; thump: number; gain: number }) {
  const t0 = ac.currentTime;
  const { dur, tone, thump, gain } = opts;

  const noise = ac.createBufferSource();
  noise.buffer = noiseBuffer(ac, dur);
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = tone;
  band.Q.value = 0.8;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(gain, t0);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  noise.connect(band).connect(ng).connect(ac.destination);
  noise.start(t0);
  noise.stop(t0 + dur);

  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(thump, t0);
  osc.frequency.exponentialRampToValueAtTime(thump * 0.55, t0 + dur);
  const og = ac.createGain();
  og.gain.setValueAtTime(gain * 0.7, t0);
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(og).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur);
}

export function playMove(): void {
  const ac = getCtx();
  if (ac) knock(ac, { dur: 0.055, tone: 1900, thump: 190, gain: 0.22 });
}

/** Heavier and lower than a plain move — one piece displacing another. */
export function playCapture(): void {
  const ac = getCtx();
  if (ac) knock(ac, { dur: 0.11, tone: 1100, thump: 120, gain: 0.34 });
}

/**
 * Wrong move: a soft low buzz, deliberately not an error klaxon — closer to a
 * terminal bell at the end of a scroll buffer.
 */
export function playWrong(): void {
  const ac = getCtx();
  if (!ac) return;
  const t0 = ac.currentTime;
  const dur = 0.17;

  const osc = ac.createOscillator();
  osc.type = 'triangle'; // softer harmonics than a square wave
  osc.frequency.setValueAtTime(165, t0);
  osc.frequency.linearRampToValueAtTime(120, t0 + dur);

  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 950;

  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  // Tremolo gives it the "bzzt" rasp without making it harsh.
  const lfo = ac.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 58;
  const lfoDepth = ac.createGain();
  lfoDepth.gain.value = 0.06;
  lfo.connect(lfoDepth).connect(g.gain);

  osc.connect(lp).connect(g).connect(ac.destination);
  osc.start(t0);
  lfo.start(t0);
  osc.stop(t0 + dur);
  lfo.stop(t0 + dur);
}
