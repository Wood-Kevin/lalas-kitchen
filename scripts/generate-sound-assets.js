// One-off generator for this repo's three real sound effects (match, cascade,
// win). No audio generation tool, sample library, or licensed sound-asset
// access exists in the environment this was built in (confirmed: no
// ffmpeg/sox, no numpy, no configured royalty-free library credentials) —
// scraping arbitrary audio off the open web would carry real, unverifiable
// licensing risk, so these are synthesized directly as plain sine-wave
// tones with a soft attack/decay envelope. That's a deliberate, zero-license-
// risk choice, not a placeholder: the output is real, playable PCM audio.
//
// REDESIGNED after a real on-device listen reported the first version read
// as a bright, exciting slot machine — the opposite of CLAUDE.md's calm-not-
// frantic brief. See engine/DECISIONS.md's sound-redesign entry for that
// writeup (fundamentals dropped a fourth-to-an-octave, attack lengthened,
// the bright overtone replaced with a warm sub-octave, win's ascending
// arpeggio replaced with a slow two-note interval).
//
// REDESIGNED AGAIN (third pass) because the second pass, despite fixing
// register/attack/overtone/shape, still used a SINGLE-rate exponential decay
// and a hard linear attack ramp — technically correct but not the actual
// envelope shape a real acoustic bell/chime/kalimba has. This pass changes
// two things: (1) the decay is now a two-stage exponential (a fast initial
// component blended with a slow tail component, not one constant rate), and
// (2) the attack is now a raised-cosine ease rather than a straight linear
// ramp. A quiet decaying echo tail is also added for a sense of space/warmth.
// See engine/DECISIONS.md's third sound-redesign entry for the full writeup.
// Re-run with `node scripts/generate-sound-assets.js` to regenerate.
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const OUTPUT_DIR = path.join(__dirname, '..', 'skins', 'lalas-kitchen', 'sounds');

// A soft, gradual RAISED-COSINE attack (eases in with zero slope at both
// ends, unlike a linear ramp's constant-slope "wedge") into a TWO-STAGE
// exponential decay: a fast component (short time constant) blended with a
// slow component (long time constant), rather than one single decay rate.
// This is the actual curve shape real struck/plucked acoustic instruments
// (bells, chimes, kalimba) have — a quick initial falloff of the attack
// transient, trailing into a much slower-decaying gentle tail — which a
// single-rate exponential, despite also curving, doesn't reproduce: a
// single rate decays the same *proportion* every instant, so it never has a
// distinct "fast part" and "slow part" the way a real resonant body does.
// Still layered on a fundamental plus a quiet SUB-octave (half frequency)
// for warmth, with deliberately no overtone above the fundamental.
function synthNote({
  freq,
  duration,
  peak,
  attack = 0.05,
  subOctaveAmp = 0.14,
  fastTauRatio = 0.12,
  slowTauRatio = 0.55,
  fastWeight = 0.55,
}) {
  const numSamples = Math.round(duration * SAMPLE_RATE);
  const samples = new Float32Array(numSamples);
  const fastTau = duration * fastTauRatio;
  const slowTau = duration * slowTauRatio;
  const slowWeight = 1 - fastWeight;
  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    const attackEnv = t < attack ? 0.5 * (1 - Math.cos((Math.PI * t) / attack)) : 1;
    const decayEnv = fastWeight * Math.exp(-t / fastTau) + slowWeight * Math.exp(-t / slowTau);
    const envelope = attackEnv * decayEnv;
    const fundamental = Math.sin(2 * Math.PI * freq * t);
    const subOctave = subOctaveAmp * Math.sin(2 * Math.PI * (freq / 2) * t);
    samples[i] = peak * envelope * (fundamental + subOctave);
  }
  return samples;
}

// Mixes several notes into one buffer, each starting at its own offset —
// used for win's two-note interval, entered slowly one after the other
// rather than a fast staggered run.
function mixNotes(notes) {
  const totalLength = Math.max(...notes.map((n) => n.offsetSamples + n.samples.length));
  const mix = new Float32Array(totalLength);
  for (const { samples, offsetSamples } of notes) {
    for (let i = 0; i < samples.length; i++) {
      mix[offsetSamples + i] += samples[i];
    }
  }
  // Clamp defensively — the notes are staggered and kept quiet enough that
  // overlap shouldn't clip, but a hard clamp costs nothing and guarantees a
  // valid PCM range regardless.
  for (let i = 0; i < mix.length; i++) {
    mix[i] = Math.max(-1, Math.min(1, mix[i]));
  }
  return mix;
}

// A simple algorithmic echo tail: several quiet, exponentially-decaying
// delayed copies of the dry signal, summed in behind it. This is what
// separates a flat synthesized tone from something that reads as recorded
// in a real space — a bare decaying sine, however well-shaped its envelope,
// still has zero sense of "room" around it. Deliberately a plain discrete
// tap-delay (not a dense diffuse reverb algorithm) and kept quiet (12% mix,
// each tap 35% quieter than the last) so it reads as ambience, not as a
// distinct, audible repeat.
function addEcho(dry, { delaySeconds = 0.06, decay = 0.35, taps = 3, mix = 0.12 } = {}) {
  const delaySamples = Math.round(delaySeconds * SAMPLE_RATE);
  const wet = new Float32Array(dry.length + delaySamples * taps);
  wet.set(dry);
  for (let k = 1; k <= taps; k++) {
    const gain = mix * Math.pow(decay, k);
    const offset = delaySamples * k;
    for (let i = 0; i < dry.length; i++) {
      wet[offset + i] += dry[i] * gain;
    }
  }
  for (let i = 0; i < wet.length; i++) {
    wet[i] = Math.max(-1, Math.min(1, wet[i]));
  }
  return wet;
}

function writeWav(filePath, floatSamples) {
  const numSamples = floatSamples.length;
  const blockAlign = 2; // mono, 16-bit
  const byteRate = SAMPLE_RATE * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, floatSamples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }

  fs.writeFileSync(filePath, buffer);
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// match: a single soft, warm tone — the everyday cue, so kept gentle and
// unobtrusive. F4 (349.23Hz), a fourth lower than the old 880Hz A5, with a
// gradual eased attack. A short, quiet echo tail (2 taps) adds a touch of
// space without smearing into the next match.
writeWav(
  path.join(OUTPUT_DIR, 'match.wav'),
  addEcho(synthNote({ freq: 349.23, duration: 0.42, peak: 0.24, attack: 0.05 }), {
    delaySeconds: 0.05,
    decay: 0.32,
    taps: 2,
    mix: 0.1,
  })
);

// cascade: quieter and shorter than match — this can fire several times in
// a fast chain, so it must recede rather than compound into noise. Lower
// still (C4, 261.63Hz) and even quieter than before. Its echo tail is the
// smallest of the three (1 tap, low mix) — a chain firing several of these
// in quick succession must not accumulate into a smeared wash.
writeWav(
  path.join(OUTPUT_DIR, 'cascade.wav'),
  addEcho(synthNote({ freq: 261.63, duration: 0.22, peak: 0.15, attack: 0.03 }), {
    delaySeconds: 0.045,
    decay: 0.3,
    taps: 1,
    mix: 0.08,
  })
);

// win: the old version was a fast four-note ascending arpeggio (C5-E5-G5-C6)
// staggered every 110ms — a rapid rising run, which real-device feedback
// named as the single biggest slot-machine signature in the whole set. This
// replaces it with a slow, gentle two-note interval: a sustained low root
// (A3, 220Hz) that a warm fifth above (E4, 329.63Hz) enters into slowly and
// long after, both with a soft attack and space to breathe and decay — a
// resolved, contented chord, not a triumphant climb. It gets the most
// generous echo tail of the three (3 taps, longest spacing) since it's a
// one-off moment allowed to linger, unlike match/cascade which repeat often.
const winRoot = synthNote({ freq: 220.0, duration: 1.1, peak: 0.24, attack: 0.07 });
const winFifth = synthNote({ freq: 329.63, duration: 1.0, peak: 0.2, attack: 0.09 });
writeWav(
  path.join(OUTPUT_DIR, 'win.wav'),
  addEcho(
    mixNotes([
      { samples: winRoot, offsetSamples: 0 },
      { samples: winFifth, offsetSamples: Math.round(0.45 * SAMPLE_RATE) },
    ]),
    { delaySeconds: 0.09, decay: 0.4, taps: 3, mix: 0.14 }
  )
);

console.log('Wrote match.wav, cascade.wav, win.wav to', OUTPUT_DIR);
