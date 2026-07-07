// One-off generator for this repo's three real sound effects (match, cascade,
// win). No audio generation tool, sample library, or licensed sound-asset
// access exists in the environment this was built in (confirmed: no
// ffmpeg/sox, no numpy, no configured royalty-free library credentials) —
// scraping arbitrary audio off the open web would carry real, unverifiable
// licensing risk, so these are synthesized directly as plain sine-wave
// tones with a soft attack/decay envelope. That's a deliberate, zero-license-
// risk choice, not a placeholder: the output is real, playable PCM audio,
// mixed and kept deliberately quiet/soft per CLAUDE.md's calm-not-frantic
// brief. Re-run with `node scripts/generate-sound-assets.js` to regenerate.
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const OUTPUT_DIR = path.join(__dirname, '..', 'skins', 'lalas-kitchen', 'sounds');

// A short exponential-decay envelope with a fast linear attack, applied on
// top of a fundamental plus a quiet upper harmonic — reads as a soft bell/
// marimba tone rather than a flat, sharp beep.
function synthNote({ freq, duration, peak, attack = 0.006, harmonicAmp = 0.18 }) {
  const numSamples = Math.round(duration * SAMPLE_RATE);
  const samples = new Float32Array(numSamples);
  const decayRate = -Math.log(0.04) / duration;
  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    const attackEnv = t < attack ? t / attack : 1;
    const decayEnv = Math.exp(-decayRate * t);
    const envelope = attackEnv * decayEnv;
    const fundamental = Math.sin(2 * Math.PI * freq * t);
    const harmonic = harmonicAmp * Math.sin(2 * Math.PI * freq * 2 * t);
    samples[i] = peak * envelope * (fundamental + harmonic);
  }
  return samples;
}

// Mixes several notes into one buffer, each starting at its own offset —
// used for the win arpeggio's staggered ascending notes.
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

// match: a single soft "ding" — the everyday cue, so kept gentle and short.
writeWav(
  path.join(OUTPUT_DIR, 'match.wav'),
  synthNote({ freq: 880, duration: 0.35, peak: 0.3 })
);

// cascade: quieter and shorter than match — this can fire several times in
// a fast chain, so it must recede rather than compound into noise.
writeWav(
  path.join(OUTPUT_DIR, 'cascade.wav'),
  synthNote({ freq: 660, duration: 0.18, peak: 0.2 })
);

// win: a calm ascending four-note arpeggio (C5-E5-G5-C6), staggered so each
// note overlaps the tail of the last rather than interrupting it.
const winNoteDuration = 0.3;
const winStagger = 0.11;
const winFreqs = [523.25, 659.25, 783.99, 1046.5];
writeWav(
  path.join(OUTPUT_DIR, 'win.wav'),
  mixNotes(
    winFreqs.map((freq, i) => ({
      samples: synthNote({ freq, duration: winNoteDuration, peak: 0.26 }),
      offsetSamples: Math.round(i * winStagger * SAMPLE_RATE),
    }))
  )
);

console.log('Wrote match.wav, cascade.wav, win.wav to', OUTPUT_DIR);
