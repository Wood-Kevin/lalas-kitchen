# Sound redesign — frequency/timing verification

Real playtest feedback (an actual on-device listen) reported the original
match/cascade/win tones read as a bright, exciting slot machine — the
opposite of CLAUDE.md's calm-not-frantic brief. See `engine/DECISIONS.md`'s
"Fixed: the real-audio-backend tones read as a slot machine on a real
listen" entry for the full design writeup.

No human on this build has ears, so the actual "does this sound calm"
question cannot be verified here — that requires the same real on-device
listen that caught the original problem, and **is still outstanding**. What
follows is verification that the redesigned synthesis parameters actually
took effect in the regenerated PCM output, not a substitute for that listen.

## Method

A Goertzel-algorithm narrowband magnitude check against each generated WAV,
run directly against `skins/lalas-kitchen/sounds/*.wav` after
`node scripts/generate-sound-assets.js` regenerated them:

```js
function goertzelMag(samples, freq, sr) {
  const N = samples.length;
  const k = Math.round(N * freq / sr);
  const w = 2 * Math.PI * k / N;
  const cosine = Math.cos(w), sine = Math.sin(w), coeff = 2 * cosine;
  let q0 = 0, q1 = 0, q2 = 0;
  for (let i = 0; i < N; i++) { q0 = coeff * q1 - q2 + samples[i]; q2 = q1; q1 = q0; }
  const real = q1 - q2 * cosine, imag = q2 * sine;
  return Math.sqrt(real * real + imag * imag) / N;
}
```

## Results

```
--- match.wav (0.420s) ---
  mag@880Hz    = 0.00000   (old bright fundamental — now silent)
  mag@349.23Hz = 0.02658   (new F4 fundamental — present)

--- cascade.wav (0.220s) ---
  mag@660Hz    = 0.00000   (old bright fundamental — now silent)
  mag@261.63Hz = 0.01481   (new C4 fundamental — present)

--- win.wav (full, 1.450s) ---
  mag@523.25Hz  = 0.00000  (old arpeggio note C5 — now silent)
  mag@659.25Hz  = 0.00000  (old arpeggio note E5 — now silent)
  mag@783.99Hz  = 0.00000  (old arpeggio note G5 — now silent)
  mag@1046.5Hz  = 0.00000  (old arpeggio note C6 — now silent)
  mag@220Hz     = 0.02444  (new A3 root — present)
  mag@329.63Hz  = 0.01774  (new E4 fifth — present)

--- win.wav (first 0.4s window only) ---
  mag@220Hz     = 0.06090  (root already sounding)
  mag@329.63Hz  = 0.00012  (fifth ~500x weaker — not yet entered)
```

## What this confirms

- The old bright fundamentals (880Hz/660Hz) and all four old arpeggio notes
  are genuinely gone from the regenerated files — not just removed from the
  source code, but absent from the actual output PCM.
- The new, lower fundamentals (F4/C4/A3+E4) are present and dominant.
- Win's two notes genuinely stagger in as a slow interval rather than firing
  as a fast run: the fifth is essentially silent for the first 400ms while
  the root is already sounding, then enters and lingers — the opposite
  timing shape from the old arpeggio's four notes stacking up within 330ms.

## What this does NOT confirm

- Whether the new tones actually sound calm, warm, or "not arcade-like" to a
  human ear. That is a perceptual judgment this analysis cannot make.
- Whether the softened attack (40-90ms) or the sub-octave warmth addition
  read as intended — only that the parameters are present in the waveform.

**This redesign is not considered done until a real on-device listen
confirms the calm result — the same standard that caught the original
problem.**

## Third pass: envelope-shape verification (two-stage decay, eased attack, echo tail)

The second pass above fixed register/attack-length/overtone/melodic-shape
but was still, technically, a single-rate exponential decay with a linear
attack ramp — not the actual envelope shape a real acoustic instrument has.
See `engine/DECISIONS.md`'s "Sound redesign, third pass" entry for the full
writeup. This section verifies the regenerated PCM after that change.

### Method

A 20ms-window RMS sweep across each regenerated file (`node` one-liner
reading the WAV header/PCM directly), to check the decay genuinely changes
rate over the note (two-stage) rather than decaying by a constant ratio
every window (single-rate), and a max-absolute-sample check for clipping.

### Results

```
--- match.wav (0.520s incl. echo tail) ---
maxAbs: 0.1534  (no clipping)
rms (20ms steps): 0.022 0.078 0.096 0.079 0.065 0.056 0.050 0.044 0.039 0.035
                  0.032 0.029 0.026 0.024 0.022 0.020 0.018 0.016 0.015 0.014
                  0.013 0.000 ...
decay ratio immediately after peak: ~0.82/window
decay ratio by the tail:            ~0.93/window

--- cascade.wav (0.265s incl. echo tail) ---
maxAbs: 0.0880  (no clipping)
rms (20ms steps): 0.028 0.055 0.040 0.032 0.025 0.021 0.017 0.014 0.012 0.010
                  0.008 0.000 ...

--- win.wav (1.720s incl. echo tail) ---
maxAbs: 0.1930  (no clipping)
rms (20ms steps): 0.015 0.061 0.107 0.122 0.117 0.108 0.098 0.091 0.086 0.082
                  0.076 0.068 0.064 0.061 0.059 0.056 0.051 0.048 0.046 0.045
                  0.043 0.040 0.039 0.043 0.060 0.083 0.098 0.097 0.087 0.077
                  0.070 0.068 0.064 0.060 0.055 0.050 0.049 0.049 0.047 0.043
                  0.040 0.039 0.038 0.037 0.035 0.032 0.031 0.031 0.031 0.029
                  0.026 0.025 0.025 0.025 0.024 0.019 0.018 0.018 0.017 0.016
                  0.016 0.015 0.014 0.014 0.014 0.013 0.013 0.012 0.012 0.011
                  0.011 0.011 0.007 0.000 ...
```

### What this confirms

- The decay ratio window-over-window genuinely changes across the note
  (~0.82 right after the peak, easing to ~0.93 by the tail) instead of
  staying constant — a single-rate exponential would produce the same ratio
  every window; this is direct evidence the two-stage fast/slow blend is
  actually shaping the output, not just present in the source.
- All three files run longer than their dry note duration (match's dry note
  is 0.42s, the file is 0.52s; cascade's dry note is 0.22s, the file is
  0.265s; win's mixed dry signal is ~1.45s, the file is 1.72s) — the extra
  tail is the added echo, confirmed present rather than a no-op.
- No clipping on any file (`maxAbs` well under the 1.0 ceiling on all
  three), so the echo mix didn't push the signal out of range.
- Win's rms sweep shows two distinct bumps (a rise then partial fall around
  window 10-11, then a second rise around window 24-26) — the root peaking,
  receding, then the fifth entering and peaking in turn — confirming the
  slow staggered two-note entry survived this pass unchanged.

### What this does NOT confirm

- Whether the new envelope shape or echo tail actually sound like a real
  acoustic instrument / a sense of space to a human ear. That is a
  perceptual judgment this analysis cannot make.
- Whether the echo tail's specific spacing/decay/mix values (tuned by
  judgment, not measurement) read as "warm and spacious" versus "muddy" or
  "too quiet to notice" on real hardware/speakers.

**This redesign is still not considered done until a real on-device listen
confirms the calm, warm result — the same standard every prior pass was
held to.**
