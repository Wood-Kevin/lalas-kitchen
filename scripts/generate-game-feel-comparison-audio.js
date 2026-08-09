// Generator for the three dev-only, opt-in "juiced" sound cues used by the
// RN-vs-Unity game-feel-comparison harness (SPEC.md, services/soundService.ts's
// match_juice/cascade_juice/special_trigger ids). These are the deliberate
// "louder end of the spectrum" counterpart to the real match/cascade/win set
// scripts/generate-sound-assets.js produces — that script's own history is a
// three-pass redesign AWAY from a bright, exciting character after a real
// on-device listen called it a "slot machine" (see engine/DECISIONS.md's
// sound-redesign entries); this script deliberately goes back the other
// direction, on purpose, for this comparison only (Kevin: "override the
// constraint for this test," the same instruction that scoped the particle
// burst). A separate script rather than extending the production one so the
// two never accidentally drift into regenerating each other's output — the
// production match.wav/cascade.wav/win.wav are untouched by this file.
//
// No audio generation tool / sample library / licensed asset access exists
// in this environment (same disclosed constraint as the production script),
// so these are synthesized PCM tones — a real, deliberate choice, not a
// placeholder standing in for something better.
//
// Re-run with `node scripts/generate-game-feel-comparison-audio.js`.
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const OUTPUT_DIR = path.join(__dirname, '..', 'skins', 'lalas-kitchen', 'sounds');

// A bright, snappy tone: a fast LINEAR attack (a wedge, not an eased ramp —
// the "quick transient" register real-world "punchy" percussive game SFX
// live in) into a SINGLE-rate exponential decay, with a genuine overtone at
// 2x the fundamental (not just a sub-octave for warmth, the calm set's own
// choice) mixed in for brightness/sparkle.
function synthPunchyNote({ freq, duration, peak, attack = 0.008, overtoneAmp = 0.35, decayTau }) {
  const numSamples = Math.round(duration * SAMPLE_RATE);
  const samples = new Float32Array(numSamples);
  const tau = decayTau ?? duration * 0.28;
  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    const attackEnv = t < attack ? t / attack : 1;
    const decayEnv = Math.exp(-t / tau);
    const envelope = attackEnv * decayEnv;
    const fundamental = Math.sin(2 * Math.PI * freq * t);
    const overtone = overtoneAmp * Math.sin(2 * Math.PI * freq * 2 * t);
    samples[i] = peak * envelope * (fundamental + overtone);
  }
  return samples;
}

function mixNotes(notes) {
  const totalLength = Math.max(...notes.map((n) => n.offsetSamples + n.samples.length));
  const mix = new Float32Array(totalLength);
  for (const { samples, offsetSamples } of notes) {
    for (let i = 0; i < samples.length; i++) {
      mix[offsetSamples + i] += samples[i];
    }
  }
  for (let i = 0; i < mix.length; i++) {
    mix[i] = Math.max(-1, Math.min(1, mix[i]));
  }
  return mix;
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

// match_juice: a single bright, snappy chime — A5 (880Hz, the calm set's own
// PRE-redesign register, deliberately reused here), short and immediate.
writeWav(
  path.join(OUTPUT_DIR, 'match_juice.wav'),
  synthPunchyNote({ freq: 880, duration: 0.22, peak: 0.3, attack: 0.006 })
);

// cascade_juice: higher and shorter still, so a fast chain of these doesn't
// blur into noise — a quick "tick-tick-tick" character as a cascade runs.
writeWav(
  path.join(OUTPUT_DIR, 'cascade_juice.wav'),
  synthPunchyNote({ freq: 1174.66, duration: 0.14, peak: 0.22, attack: 0.004 })
);

// special_trigger: a quick three-note ASCENDING arpeggio (C5-E5-G5, 90ms
// apart) — genre-standard "something big just happened" language, the exact
// shape the production win.wav's own redesign moved AWAY from (see
// scripts/generate-sound-assets.js's history) because it read as a slot
// machine. Deliberately brought back here, once, for a special-piece trigger
// only, since testing that "louder end of the spectrum" honestly is the
// entire point of this comparison.
const arpeggioNotes = [523.25, 659.25, 783.99].map((freq, idx) =>
  synthPunchyNote({ freq, duration: 0.24, peak: 0.26, attack: 0.005 })
);
writeWav(
  path.join(OUTPUT_DIR, 'special_trigger.wav'),
  mixNotes(
    arpeggioNotes.map((samples, idx) => ({
      samples,
      offsetSamples: Math.round(idx * 0.09 * SAMPLE_RATE),
    }))
  )
);

console.log('Wrote match_juice.wav, cascade_juice.wav, special_trigger.wav to', OUTPUT_DIR);
