// Polyphonic stereo PCM WAV music synthesizer for local track streaming

const SAMPLE_RATE = 24000;
const CHANNELS = 2;

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createRng(seedStr) {
  let a = hashSeed(seedStr) || 1;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11]
};

function getChordVoicing(rootMidi, chordOffset, scaleName) {
  const scale = SCALES[scaleName] || SCALES.minor;
  const base = rootMidi + chordOffset;
  // Find nearest scale intervals above chordOffset to build lush 7th/9th chord
  const isMinorQuality = scaleName === 'minor' || scaleName === 'dorian';
  const third = chordOffset === 0 ? (isMinorQuality ? 3 : 4) : chordOffset === 3 || chordOffset === 8 || chordOffset === 10 ? 4 : 3;
  const seventh = chordOffset === 0 ? (isMinorQuality ? 10 : 11) : 10;
  return [base, base + third, base + 7, base + seventh];
}

function addStereoSample(left, right, idx, val, pan) {
  const angle = (pan + 1) * 0.25 * Math.PI;
  left[idx] += val * Math.cos(angle);
  right[idx] += val * Math.sin(angle);
}

// Smooth warm electric piano / felt piano / pluck voice
function renderTone(left, right, totalSamples, {
  startSec,
  durSec,
  freq,
  amp = 0.14,
  pan = 0,
  attackSec = 0.015,
  releaseSec = 0.25,
  harmonics = [1, 0.35, 0.12],
  detune = 0.002,
  vibratoRate = 0,
  vibratoDepth = 0,
  decayRate = 2.2
}) {
  const start = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const end = Math.min(totalSamples, Math.floor((startSec + durSec + releaseSec) * SAMPLE_RATE));
  const noteEnd = Math.floor((startSec + durSec) * SAMPLE_RATE);
  const atkSamples = Math.max(1, Math.floor(attackSec * SAMPLE_RATE));
  const relSamples = Math.max(1, Math.floor(releaseSec * SAMPLE_RATE));

  const angle = (pan + 1) * 0.25 * Math.PI;
  const gL = Math.cos(angle) * amp;
  const gR = Math.sin(angle) * amp;
  const twoPi = Math.PI * 2;
  const f1 = freq;
  const f2 = freq * (1 + detune);

  for (let i = start; i < end; i++) {
    const t = (i - start) / SAMPLE_RATE;
    let env = 1;
    if (i - start < atkSamples) {
      env = (i - start) / atkSamples;
    } else if (i > noteEnd) {
      const relPos = (i - noteEnd) / relSamples;
      env = Math.max(0, 1 - relPos);
      env = env * env;
    }
    if (decayRate > 0) {
      env *= Math.exp(-t * decayRate);
    }
    if (env <= 0.0002) continue;

    const vib = vibratoDepth ? Math.sin(twoPi * vibratoRate * t) * vibratoDepth : 0;
    const ph1 = twoPi * (f1 * (1 + vib)) * t;
    const ph2 = twoPi * (f2 * (1 + vib)) * t;

    let s = Math.sin(ph1) * harmonics[0];
    if (harmonics[1]) s += Math.sin(ph1 * 2) * harmonics[1];
    if (harmonics[2]) s += Math.sin(ph1 * 3) * harmonics[2];
    if (detune > 0) {
      s = s * 0.65 + Math.sin(ph2) * harmonics[0] * 0.35;
    }

    const out = s * env;
    left[i] += out * gL;
    right[i] += out * gR;
  }
}

// Lush detuned pad with optional rhythmic sidechain pump
function renderPad(left, right, totalSamples, {
  startSec,
  durSec,
  freq,
  amp = 0.06,
  pan = 0,
  brightness = 0.6,
  pumpBpm = 0
}) {
  const fade = 0.35;
  const start = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const end = Math.min(totalSamples, Math.floor((startSec + durSec + fade) * SAMPLE_RATE));
  const atk = Math.floor(0.25 * SAMPLE_RATE);
  const rel = Math.floor(fade * SAMPLE_RATE);
  const noteEnd = Math.floor((startSec + durSec) * SAMPLE_RATE);

  const angle = (pan + 1) * 0.25 * Math.PI;
  const gL = Math.cos(angle) * amp;
  const gR = Math.sin(angle) * amp;
  const twoPi = Math.PI * 2;
  const beatDur = pumpBpm > 0 ? 60 / pumpBpm : 0;

  let lp = 0;
  const cutoff = 0.04 + brightness * 0.16;

  for (let i = start; i < end; i++) {
    const t = i / SAMPLE_RATE;
    let env = 1;
    if (i - start < atk) env = (i - start) / atk;
    else if (i > noteEnd) {
      const r = Math.max(0, 1 - (i - noteEnd) / rel);
      env = r * r;
    }

    if (beatDur > 0) {
      const beatPhase = (t % beatDur) / beatDur;
      env *= 0.38 + 0.62 * Math.min(1, beatPhase * 2.2);
    }

    // Soft sawtooth approximation (3 harmonics) with gentle detune
    const w1 = Math.sin(twoPi * freq * t) + 0.4 * Math.sin(twoPi * freq * 2 * t) + 0.18 * Math.sin(twoPi * freq * 3 * t);
    const w2 = Math.sin(twoPi * freq * 1.004 * t) + 0.35 * Math.sin(twoPi * freq * 2.008 * t);
    const raw = (w1 + w2) * 0.5;
    lp += (raw - lp) * cutoff;

    const out = lp * env;
    left[i] += out * gL;
    right[i] += out * gR;
  }
}

function renderKick(left, right, totalSamples, startSec, amp = 0.42, punch = 1) {
  const start = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const dur = Math.floor(0.24 * SAMPLE_RATE);
  const end = Math.min(totalSamples, start + dur);
  let phase = 0;
  for (let i = start; i < end; i++) {
    const t = (i - start) / SAMPLE_RATE;
    const freq = 46 + 115 * punch * Math.exp(-t * 34);
    phase += (2 * Math.PI * freq) / SAMPLE_RATE;
    const env = Math.exp(-t * 13) * Math.min(1, t * 400);
    const s = Math.sin(phase) * env * amp;
    left[i] += s;
    right[i] += s;
  }
}

function renderSnare(left, right, totalSamples, startSec, rng, amp = 0.2, tight = 1) {
  const start = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const dur = Math.floor(0.18 * SAMPLE_RATE);
  const end = Math.min(totalSamples, start + dur);
  let lp = 0;
  for (let i = start; i < end; i++) {
    const t = (i - start) / SAMPLE_RATE;
    const noise = rng() * 2 - 1;
    lp += (noise - lp) * 0.45;
    const body = Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 28);
    const env = Math.exp(-t * (18 * tight)) * Math.min(1, t * 800);
    const s = (noise * 0.55 + lp * 0.35 + body * 0.45) * env * amp;
    left[i] += s * 0.96;
    right[i] += s * 1.04;
  }
}

function renderHat(left, right, totalSamples, startSec, rng, amp = 0.08, open = false, pan = 0.18) {
  const start = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const dur = Math.floor((open ? 0.16 : 0.05) * SAMPLE_RATE);
  const end = Math.min(totalSamples, start + dur);
  let prev = 0;
  for (let i = start; i < end; i++) {
    const t = (i - start) / SAMPLE_RATE;
    const white = rng() * 2 - 1;
    const hp = white - prev * 0.72;
    prev = white;
    const env = Math.exp(-t * (open ? 22 : 75));
    addStereoSample(left, right, i, hp * env * amp, pan);
  }
}

function encodeWav(left, right, totalSamples) {
  const dataBytes = totalSamples * CHANNELS * 2;
  const buf = Buffer.allocUnsafe(44 + dataBytes);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM
  buf.writeUInt16LE(1, 20); // Linear PCM
  buf.writeUInt16LE(CHANNELS, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * CHANNELS * 2, 28);
  buf.writeUInt16LE(CHANNELS * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);

  // Find peak or apply gentle soft saturation limiter (Math.tanh)
  const fadeSamples = Math.floor(1.4 * SAMPLE_RATE);
  const introSamples = Math.floor(0.06 * SAMPLE_RATE);
  let offset = 44;

  for (let i = 0; i < totalSamples; i++) {
    let gain = 0.88;
    if (i < introSamples) {
      gain *= i / introSamples;
    } else if (i > totalSamples - fadeSamples) {
      const rem = (totalSamples - i) / fadeSamples;
      gain *= Math.max(0, rem);
    }

    const sL = Math.tanh(left[i] * gain * 1.15);
    const sR = Math.tanh(right[i] * gain * 1.15);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sL * 32000))), offset);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sR * 32000))), offset + 2);
    offset += 4;
  }

  return buf;
}

export function synthesizeTrackWav(track) {
  const rng = createRng(track.id + ':' + track.title);
  const durationSec = track.duration || 26;
  const totalSamples = Math.floor(durationSec * SAMPLE_RATE);
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);

  const synth = track.synth || {};
  const style = synth.style || 'lofi';
  const bpm = track.bpm || 100;
  const beatSec = 60 / bpm;
  const barSec = beatSec * 4;
  const stepSec = beatSec / 4; // 16th note
  const swing = synth.swing || 0;
  const brightness = synth.brightness ?? 0.6;
  const rootMidi = synth.rootMidi || 45;
  const chords = synth.chords || [0, 5, 7, 3];
  const scaleName = synth.scale || 'minor';
  const scaleIntervals = SCALES[scaleName] || SCALES.minor;

  const totalBars = Math.ceil(durationSec / barSec);

  // Subtle warm vinyl noise for lo-fi and hiphop
  if (style === 'lofi' || style === 'hiphop') {
    let lpNoise = 0;
    for (let i = 0; i < totalSamples; i++) {
      const n = rng() * 2 - 1;
      lpNoise += (n - lpNoise) * 0.12;
      const crackle = rng() > 0.9992 ? (rng() - 0.5) * 0.08 : 0;
      const v = lpNoise * 0.008 + crackle;
      left[i] += v;
      right[i] += v * 0.9;
    }
  }

  // Generate memorable deterministic melodic motif over 8 steps
  const motif = [];
  for (let s = 0; s < 16; s++) {
    if (rng() > 0.42) {
      const deg = Math.floor(rng() * scaleIntervals.length);
      const oct = rng() > 0.72 ? 24 : 12;
      motif.push(rootMidi + 12 + scaleIntervals[deg] + oct - 12);
    } else {
      motif.push(null);
    }
  }

  for (let bar = 0; bar < totalBars; bar++) {
    const barStart = bar * barSec;
    if (barStart >= durationSec) break;
    const chordOffset = chords[bar % chords.length];
    const voicing = getChordVoicing(rootMidi + 12, chordOffset, scaleName);
    const bassMidi = rootMidi + chordOffset - 12;
    const isIntro = bar === 0 && style !== 'ambient' && style !== 'piano';
    const isLift = bar % 4 === 3;

    // 1. Chords / Pads
    if (style === 'synthwave' || style === 'house' || style === 'ambient') {
      voicing.forEach((midi, idx) => {
        renderPad(left, right, totalSamples, {
          startSec: barStart,
          durSec: barSec,
          freq: midiToFreq(midi),
          amp: style === 'ambient' ? 0.068 : 0.048,
          pan: (idx - 1.5) * 0.25,
          brightness,
          pumpBpm: style === 'house' ? bpm : 0
        });
      });
    } else if (style === 'lofi' || style === 'jazz' || style === 'hiphop') {
      const chordHits = style === 'jazz' ? [0, 1.5, 2.75] : [0, 2.5];
      chordHits.forEach((beatOff) => {
        const hitTime = barStart + beatOff * beatSec;
        if (hitTime >= durationSec) return;
        voicing.forEach((midi, idx) => {
          renderTone(left, right, totalSamples, {
            startSec: hitTime + idx * 0.012,
            durSec: beatSec * 1.4,
            freq: midiToFreq(midi),
            amp: 0.065,
            pan: (idx - 1.5) * 0.22,
            attackSec: 0.014,
            releaseSec: 0.35,
            harmonics: [1, 0.22, 0.08],
            detune: 0.0025,
            vibratoRate: style === 'lofi' ? 3.2 : 0,
            vibratoDepth: style === 'lofi' ? 0.0022 : 0,
            decayRate: 1.6
          });
        });
      });
    } else if (style === 'indie') {
      // Bright rhythmic 8th-note chord plucks
      for (let e = 0; e < 8; e++) {
        if (e % 2 === 1 && rng() > 0.7) continue;
        const hitTime = barStart + e * (beatSec / 2);
        if (hitTime >= durationSec) break;
        voicing.slice(0, 3).forEach((midi, idx) => {
          renderTone(left, right, totalSamples, {
            startSec: hitTime + idx * 0.008,
            durSec: beatSec * 0.42,
            freq: midiToFreq(midi),
            amp: e % 2 === 0 ? 0.058 : 0.04,
            pan: (idx - 1) * 0.28,
            attackSec: 0.008,
            releaseSec: 0.22,
            harmonics: [1, 0.45, 0.18],
            detune: 0.003,
            decayRate: 3.4
          });
        });
      }
    } else if (style === 'piano') {
      // Expressive felt-piano broken arpeggio in left hand
      const pattern = [0, 2, 1, 3, 2, 1, 3, 2];
      for (let e = 0; e < 8; e++) {
        const hitTime = barStart + e * (beatSec / 2);
        if (hitTime >= durationSec) break;
        const noteMidi = voicing[pattern[e] % voicing.length];
        renderTone(left, right, totalSamples, {
          startSec: hitTime,
          durSec: beatSec * 0.85,
          freq: midiToFreq(noteMidi),
          amp: e === 0 ? 0.11 : 0.075,
          pan: -0.25 + (e % 4) * 0.15,
          attackSec: 0.012,
          releaseSec: 0.65,
          harmonics: [1, 0.28, 0.09],
          detune: 0.001,
          decayRate: 1.9
        });
      }
    }

    // 2. Bassline
    if (style === 'synthwave') {
      for (let e = 0; e < 8; e++) {
        const t = barStart + e * (beatSec / 2);
        if (t >= durationSec) break;
        const oct = e % 2 === 1 && isLift ? 12 : 0;
        renderTone(left, right, totalSamples, {
          startSec: t,
          durSec: beatSec * 0.36,
          freq: midiToFreq(bassMidi + oct),
          amp: 0.17,
          pan: 0,
          attackSec: 0.008,
          releaseSec: 0.12,
          harmonics: [1, 0.55, 0.28],
          detune: 0.002,
          decayRate: 4.5
        });
      }
    } else if (style === 'house') {
      for (let b = 0; b < 4; b++) {
        const t = barStart + (b + 0.5) * beatSec;
        if (t >= durationSec) break;
        renderTone(left, right, totalSamples, {
          startSec: t,
          durSec: beatSec * 0.45,
          freq: midiToFreq(bassMidi),
          amp: 0.21,
          pan: 0,
          attackSec: 0.01,
          releaseSec: 0.14,
          harmonics: [1, 0.42, 0.14],
          detune: 0,
          decayRate: 4.2
        });
      }
    } else if (style === 'lofi' || style === 'hiphop' || style === 'jazz') {
      const bassSteps = style === 'jazz' ? [0, 1, 2, 3] : [0, 1.5, 2.5];
      bassSteps.forEach((b, idx) => {
        const t = barStart + b * beatSec;
        if (t >= durationSec) return;
        const walkOffset = style === 'jazz' && idx > 0 ? scaleIntervals[(idx * 2) % scaleIntervals.length] : 0;
        renderTone(left, right, totalSamples, {
          startSec: t,
          durSec: beatSec * 0.8,
          freq: midiToFreq(bassMidi + walkOffset),
          amp: style === 'hiphop' ? 0.24 : 0.18,
          pan: 0,
          attackSec: 0.012,
          releaseSec: 0.22,
          harmonics: [1, 0.25, 0.05],
          detune: 0,
          decayRate: 2.8
        });
      });
    } else if (style === 'indie') {
      for (let b = 0; b < 4; b++) {
        const t = barStart + b * beatSec;
        if (t >= durationSec) break;
        renderTone(left, right, totalSamples, {
          startSec: t,
          durSec: beatSec * 0.7,
          freq: midiToFreq(bassMidi + (b === 3 ? 7 : 0)),
          amp: 0.16,
          pan: 0,
          attackSec: 0.01,
          releaseSec: 0.18,
          harmonics: [1, 0.36, 0.12],
          detune: 0,
          decayRate: 3.1
        });
      }
    } else if (style === 'ambient') {
      renderPad(left, right, totalSamples, {
        startSec: barStart,
        durSec: barSec,
        freq: midiToFreq(bassMidi),
        amp: 0.09,
        pan: 0,
        brightness: 0.22
      });
    }

    // 3. Lead Melody / Arpeggio / Shimmer
    if (style === 'ambient') {
      for (let c = 0; c < 3; c++) {
        const t = barStart + (c * 1.3 + rng() * 0.4) * beatSec;
        if (t >= durationSec) break;
        const note = voicing[Math.floor(rng() * voicing.length)] + 12;
        renderTone(left, right, totalSamples, {
          startSec: t,
          durSec: beatSec * 1.8,
          freq: midiToFreq(note),
          amp: 0.055,
          pan: (rng() - 0.5) * 1.3,
          attackSec: 0.08,
          releaseSec: 0.9,
          harmonics: [1, 0.15, 0],
          detune: 0.003,
          decayRate: 1.2
        });
      }
    } else if (style === 'synthwave' || style === 'house') {
      // Sparkling 16th-note arpeggiator
      for (let s = 0; s < 16; s++) {
        if (isIntro && s % 2 === 1) continue;
        const t = barStart + s * stepSec;
        if (t >= durationSec) break;
        const note = voicing[s % voicing.length] + (s % 8 >= 4 ? 12 : 0);
        renderTone(left, right, totalSamples, {
          startSec: t,
          durSec: stepSec * 0.85,
          freq: midiToFreq(note),
          amp: isIntro ? 0.045 : 0.068,
          pan: Math.sin(s * 0.6) * 0.55,
          attackSec: 0.005,
          releaseSec: 0.15,
          harmonics: [1, 0.45, 0.2],
          detune: 0.003,
          decayRate: 5.5
        });
      }
    } else {
      // Melodic motif for lofi, jazz, indie, hiphop, piano
      for (let s = 0; s < 16; s++) {
        const mNote = motif[s];
        if (!mNote) continue;
        if (bar % 2 === 0 && s > 10) continue;
        const sw = s % 2 === 1 ? stepSec * swing : 0;
        const t = barStart + s * stepSec + sw;
        if (t >= durationSec) break;
        const shifted = mNote + (chordOffset % 5);
        renderTone(left, right, totalSamples, {
          startSec: t,
          durSec: stepSec * 1.9,
          freq: midiToFreq(shifted),
          amp: style === 'piano' ? 0.095 : 0.065,
          pan: style === 'piano' ? 0.2 : Math.cos(s) * 0.32,
          attackSec: 0.01,
          releaseSec: 0.35,
          harmonics: style === 'piano' ? [1, 0.24, 0.07] : [1, 0.18, 0.05],
          detune: 0.0015,
          decayRate: 2.4
        });
      }
    }

    // 4. Percussion Layer
    if (!isIntro && style !== 'ambient' && style !== 'piano') {
      for (let s = 0; s < 16; s++) {
        const sw = s % 2 === 1 ? stepSec * swing : 0;
        const t = barStart + s * stepSec + sw;
        if (t >= durationSec) break;

        if (style === 'house') {
          if (s % 4 === 0) renderKick(left, right, totalSamples, t, 0.44, 1.15);
          if (s === 4 || s === 12) renderSnare(left, right, totalSamples, t, rng, 0.16, 1.3);
          if (s % 4 === 2) renderHat(left, right, totalSamples, t, rng, 0.09, true, 0.2);
          else if (s % 2 === 1) renderHat(left, right, totalSamples, t, rng, 0.045, false, -0.2);
        } else if (style === 'synthwave') {
          if (s === 0 || s === 8 || (isLift && s === 14)) renderKick(left, right, totalSamples, t, 0.42, 1.1);
          if (s === 4 || s === 12) renderSnare(left, right, totalSamples, t, rng, 0.24, 0.8);
          if (s % 2 === 0) renderHat(left, right, totalSamples, t, rng, 0.055, s === 10, 0.22);
        } else if (style === 'hiphop') {
          if (s === 0 || s === 7 || s === 10) renderKick(left, right, totalSamples, t, 0.46, 1.0);
          if (s === 4 || s === 12) renderSnare(left, right, totalSamples, t, rng, 0.22, 1.1);
          if (s % 2 === 0) renderHat(left, right, totalSamples, t, rng, 0.05, s === 14, -0.18);
        } else if (style === 'lofi') {
          if (s === 0 || s === 10) renderKick(left, right, totalSamples, t, 0.34, 0.8);
          if (s === 4 || s === 12) renderSnare(left, right, totalSamples, t, rng, 0.13, 1.25);
          if (s % 2 === 0) renderHat(left, right, totalSamples, t, rng, 0.036, false, 0.15);
        } else if (style === 'jazz') {
          if (s === 0 || s === 10) renderKick(left, right, totalSamples, t, 0.24, 0.65);
          if (s === 12) renderSnare(left, right, totalSamples, t, rng, 0.09, 1.4);
          if (s === 0 || s === 4 || s === 7 || s === 8 || s === 12 || s === 15) {
            renderHat(left, right, totalSamples, t, rng, 0.05, s === 7 || s === 15, 0.28);
          }
        } else if (style === 'indie') {
          if (s === 0 || s === 6 || s === 8) renderKick(left, right, totalSamples, t, 0.38, 1.0);
          if (s === 4 || s === 12) renderSnare(left, right, totalSamples, t, rng, 0.2, 1.0);
          if (s % 2 === 0) renderHat(left, right, totalSamples, t, rng, 0.06, s === 12, -0.2);
        }
      }
    }
  }

  return encodeWav(left, right, totalSamples);
}
