// One-off (but re-runnable) optimizer for a sourced background-music bed,
// turning a long stereo 48kHz master into a short seamless loop suitable for
// a mobile game asset. No ffmpeg/sox/numpy exists in this environment
// (confirmed: none installed, no network access to `apt`/`pip` a real audio
// toolchain) — every step below (WAV parsing, loop-point search, FIR
// lowpass, resampling, crossfade) is hand-rolled in plain Node, the same
// DIY-no-dependency approach `scripts/generate-sound-assets.js` already
// established for this project's synthesized sound effects.
//
// Usage: node scripts/optimize-background-music.js <input.wav> <output.wav> [--rate 44100] [--mono|--stereo]
//
// What this does NOT do: confirm the result actually sounds seamless to a
// human ear. Every metric below is a computational proxy (amplitude/
// spectral/phase matching at the seam) — real confirmation requires an
// actual on-device listen, the same standard already held for match/
// cascade/win. See the printed report's closing section.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const inputPath = positional[0];
const outputPath = positional[1];
if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/optimize-background-music.js <input.wav> <output.wav> [--rate 44100] [--mono|--stereo]');
  process.exit(1);
}
const rateFlagIdx = args.indexOf('--rate');
const TARGET_RATE = rateFlagIdx !== -1 ? parseInt(args[rateFlagIdx + 1], 10) : 44100;
const FORCE_MONO = args.includes('--mono');
const FORCE_STEREO = args.includes('--stereo');

const MIN_LOOP_SEC = 20;
const MAX_LOOP_SEC = 40;

// ---------------------------------------------------------------------------
// WAV read/write — a generic chunk walker (not fixed offsets), since the
// sourced file carries a LIST chunk before its data chunk that a fixed-
// offset reader would silently misparse.
// ---------------------------------------------------------------------------
function readWav(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${filePath} is not a canonical RIFF/WAVE file`);
  }
  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataSize = -1;
  while (offset < buf.length - 8) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(offset + 8),
        channels: buf.readUInt16LE(offset + 10),
        sampleRate: buf.readUInt32LE(offset + 12),
        bitsPerSample: buf.readUInt16LE(offset + 22),
      };
    } else if (id === 'data') {
      dataOffset = offset + 8;
      dataSize = size;
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || dataOffset === -1) throw new Error(`${filePath}: missing fmt or data chunk`);
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error(`${filePath}: only 16-bit PCM is handled (got format ${fmt.audioFormat}, ${fmt.bitsPerSample}-bit)`);
  }
  const numFrames = dataSize / (fmt.channels * 2);
  const interleaved = new Int16Array(numFrames * fmt.channels);
  for (let i = 0; i < interleaved.length; i++) {
    interleaved[i] = buf.readInt16LE(dataOffset + i * 2);
  }
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, numFrames, interleaved };
}

function writeWav(filePath, interleavedInt16, sampleRate, channels) {
  const numSamples = interleavedInt16.length;
  const blockAlign = channels * 2;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    buffer.writeInt16LE(interleavedInt16[i], 44 + i * 2);
  }
  fs.writeFileSync(filePath, buffer);
}

// ---------------------------------------------------------------------------
// Analysis helpers
// ---------------------------------------------------------------------------
function toMonoFloat(interleaved, channels, numFrames) {
  const mono = new Float32Array(numFrames);
  if (channels === 1) {
    for (let i = 0; i < numFrames; i++) mono[i] = interleaved[i] / 32768;
  } else {
    for (let i = 0; i < numFrames; i++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += interleaved[i * channels + c];
      mono[i] = sum / channels / 32768;
    }
  }
  return mono;
}

function rmsEnvelope(mono, hop) {
  const n = Math.floor(mono.length / hop);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const base = i * hop;
    for (let j = 0; j < hop; j++) {
      const v = mono[base + j];
      sum += v * v;
    }
    env[i] = Math.sqrt(sum / hop);
  }
  return env;
}

function cosineSim(a, aOff, b, bOff, len) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < len; i++) {
    const av = a[aOff + i], bv = b[bOff + i];
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

// Goertzel narrowband magnitude — the same technique already trusted in
// docs/verification/sound-redesign/ for this project's synthesized tones.
function goertzelMag(samples, offset, len, freq, sr) {
  const k = Math.round((len * freq) / sr);
  const w = (2 * Math.PI * k) / len;
  const cosine = Math.cos(w), sine = Math.sin(w), coeff = 2 * cosine;
  let q0 = 0, q1 = 0, q2 = 0;
  for (let i = 0; i < len; i++) {
    q0 = coeff * q1 - q2 + samples[offset + i];
    q2 = q1;
    q1 = q0;
  }
  const real = q1 - q2 * cosine, imag = q2 * sine;
  return Math.sqrt(real * real + imag * imag) / len;
}

const SPECTRAL_BANDS = [100, 200, 400, 800, 1600, 3200, 6400, 12000];

function bandVector(mono, offset, len, sr) {
  return SPECTRAL_BANDS.map((f) => goertzelMag(mono, offset, len, f, sr));
}

function vecCosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

// ---------------------------------------------------------------------------
// Loop-point search: coarse envelope pass (musical/textural similarity)
// followed by a sample-domain refine pass (phase alignment) on the top
// coarse candidates. This two-pass structure is what makes a full ~3-minute
// track searchable at sample resolution without a brute-force scan over
// every possible (start, length) pair at 48kHz.
// ---------------------------------------------------------------------------
function findLoopPoint(mono, sr) {
  const hop = Math.round(sr * 0.02); // 20ms envelope hop
  const env = rmsEnvelope(mono, hop);
  const compareLen = Math.round(1.0 / 0.02); // 1s of envelope context at the seam
  const totalSec = mono.length / sr;

  const startMinSec = 1.0;
  const startMaxSec = totalSec - MIN_LOOP_SEC - 1.0;
  const coarseStepSec = 0.2;
  const durStepSec = 0.5;

  const coarseCandidates = [];
  for (let s = startMinSec; s <= startMaxSec; s += coarseStepSec) {
    const sEnv = Math.round(s / 0.02);
    if (sEnv < 0 || sEnv + compareLen > env.length) continue;
    for (let dur = MIN_LOOP_SEC; dur <= MAX_LOOP_SEC; dur += durStepSec) {
      const eEnv = sEnv + Math.round(dur / 0.02);
      if (eEnv - compareLen < 0 || eEnv > env.length) continue;
      // tail = envelope leading up to E ("how the loop ends"); head =
      // envelope leading away from S ("how the loop begins") — these two
      // become temporally adjacent once the loop wraps, so their contour
      // similarity is the musical-seamlessness proxy.
      const score = cosineSim(env, eEnv - compareLen, env, sEnv, compareLen);
      coarseCandidates.push({ sSec: s, dur, score });
    }
  }
  coarseCandidates.sort((a, b) => b.score - a.score);

  // Keep the top candidates, de-duplicated so they aren't all the same
  // musical moment nudged by one coarse step.
  const top = [];
  for (const c of coarseCandidates) {
    if (top.some((t) => Math.abs(t.sSec - c.sSec) < 2)) continue;
    top.push(c);
    if (top.length >= 25) break;
  }

  // Sample-domain refine: for each coarse candidate, nudge S and E (jointly,
  // then E alone) within a small window to maximize sample-level
  // cross-correlation at the seam — this is what actually determines
  // whether the cut clicks, not the coarse musical-texture match above.
  const refined = top.map((c) => refineCandidate(mono, sr, c));

  // Full metrics per candidate, snapped to zero-crossings first (the snap
  // shifts sIdx/eIdx by a few samples, so metrics must be computed AFTER
  // snapping to be representative of what actually gets exported).
  const scored = refined.map((r) => {
    const snapped = snapToZeroCrossings(mono, r.sIdx, r.eIdx, sr);
    const sIdx = snapped.s, eIdx = snapped.e;
    const winLen = Math.min(2048, eIdx - sIdx - 1);
    const startVec = bandVector(mono, sIdx, winLen, sr);
    const endVec = bandVector(mono, eIdx - winLen, winLen, sr);
    const spectralSim = vecCosineSim(startVec, endVec);
    const rmsWin = Math.round(sr * 0.05);
    const startRms = Math.sqrt(mono.slice(sIdx, sIdx + rmsWin).reduce((s, v) => s + v * v, 0) / rmsWin);
    const endRms = Math.sqrt(mono.slice(eIdx - rmsWin, eIdx).reduce((s, v) => s + v * v, 0) / rmsWin);
    const rmsDiffPct = (Math.abs(startRms - endRms) / Math.max(startRms, endRms, 1e-9)) * 100;
    // Holistic score: sample-domain phase alignment and spectral match are
    // what most directly prevent an audible click/timbre jump, so they're
    // weighted highest; amplitude match and the coarse musical-texture
    // score are secondary signals.
    const finalScore =
      0.35 * Math.max(0, r.sampleCorr) +
      0.35 * Math.max(0, spectralSim) +
      0.2 * Math.max(0, 1 - rmsDiffPct / 100) +
      0.1 * Math.max(0, r.envScore);
    return { sIdx, eIdx, sr, envScore: r.envScore, sampleCorr: r.sampleCorr, spectralSim, rmsDiffPct, finalScore };
  });
  scored.sort((a, b) => b.finalScore - a.finalScore);
  return { best: scored[0], allScored: scored };
}

function corrAt(mono, sIdx, eIdx, winSamples) {
  // Correlate the `winSamples` immediately before eIdx (the outgoing tail)
  // against the `winSamples` immediately after sIdx (the incoming head).
  if (eIdx - winSamples < 0 || sIdx + winSamples > mono.length) return -1;
  return cosineSim(mono, eIdx - winSamples, mono, sIdx, winSamples);
}

function refineCandidate(mono, sr, coarse) {
  let sIdx = Math.round(coarse.sSec * sr);
  let eIdx = Math.round((coarse.sSec + coarse.dur) * sr);
  const seamWin = Math.round(sr * 0.02); // 20ms phase-alignment window

  // Pass 1: shift S and E together (preserve duration), find the best
  // overall phase alignment in a +/-60ms neighborhood.
  const jointRangeSamples = Math.round(sr * 0.06);
  let bestShift = 0, bestScore = corrAt(mono, sIdx, eIdx, seamWin);
  for (let d = -jointRangeSamples; d <= jointRangeSamples; d += 4) {
    const s = corrAt(mono, sIdx + d, eIdx + d, seamWin);
    if (s > bestScore) { bestScore = s; bestShift = d; }
  }
  sIdx += bestShift;
  eIdx += bestShift;

  // Pass 2: fine-adjust E alone (duration free to move +/-30ms) to nail
  // exact single-sample phase alignment.
  const fineRangeSamples = Math.round(sr * 0.03);
  let bestDe = 0, bestScore2 = corrAt(mono, sIdx, eIdx, seamWin);
  for (let d = -fineRangeSamples; d <= fineRangeSamples; d++) {
    const s = corrAt(mono, sIdx, eIdx + d, seamWin);
    if (s > bestScore2) { bestScore2 = s; bestDe = d; }
  }
  eIdx += bestDe;

  const sampleCorr = corrAt(mono, sIdx, eIdx, seamWin);
  const combinedScore = 0.3 * coarse.score + 0.7 * Math.max(0, sampleCorr);
  return { sIdx, eIdx, sr, envScore: coarse.score, sampleCorr, combinedScore };
}

// Snap S and E to nearby zero-crossings (within +/-5ms), preferring the
// crossing pair that minimizes the raw sample-value jump at the seam —
// reduces the click risk a pure envelope/correlation match can still leave,
// since two waveforms can correlate well while sitting at different
// absolute sample values at the exact boundary sample.
function findZeroCrossings(mono, centerIdx, toleranceSamples) {
  const crossings = [];
  const lo = Math.max(1, centerIdx - toleranceSamples);
  const hi = Math.min(mono.length - 1, centerIdx + toleranceSamples);
  for (let i = lo; i <= hi; i++) {
    if ((mono[i - 1] <= 0 && mono[i] > 0) || (mono[i - 1] >= 0 && mono[i] < 0)) {
      crossings.push(i);
    }
  }
  if (crossings.length === 0) crossings.push(centerIdx);
  return crossings;
}

function snapToZeroCrossings(mono, sIdx, eIdx, sr) {
  const tol = Math.round(sr * 0.005); // 5ms
  const sCandidates = findZeroCrossings(mono, sIdx, tol);
  const eCandidates = findZeroCrossings(mono, eIdx, tol);
  let best = null;
  for (const s of sCandidates) {
    for (const e of eCandidates) {
      if (e <= s) continue;
      const jump = Math.abs(mono[e - 1] - mono[s]);
      if (!best || jump < best.jump) best = { s, e, jump };
    }
  }
  return best || { s: sIdx, e: eIdx, jump: Math.abs(mono[eIdx - 1] - mono[sIdx]) };
}

// ---------------------------------------------------------------------------
// Crossfade — NOT a naive "blend tail with head, aligned by position within
// the fade window." That naive version was tried first and measured worse
// than no crossfade at all: its last output sample approaches head[F-1]
// (the END of the fade-in source), which then gets played immediately
// before head[0] (the unmodified start) on the very next loop iteration —
// two points F samples apart in the original recording, with no reason to
// be adjacent-continuous, so it can introduce a seam rather than remove one.
//
// The correct construction blends the natural tail with the audio
// immediately PRECEDING the loop's own start point S, still available in
// the untrimmed source track (pre[j] = original[S - F + j]). As the fade
// approaches the very last output sample, it approaches pre[F-1] =
// original[S - 1] — the sample that, in the real unedited recording,
// naturally and continuously flows into original[S] (= this loop's own
// unmodified first sample). That's what makes the wrap smooth: the loop's
// last sample and first sample become two genuinely adjacent, continuous
// points from the original continuous recording, not two arbitrary points
// forced together.
// ---------------------------------------------------------------------------
function buildCrossfadedSegment(fullInterleaved, channels, sIdx, eIdx, crossfadeFrames) {
  const segFrames = eIdx - sIdx;
  const out = new Int16Array(segFrames * channels);
  for (let i = 0; i < segFrames; i++) {
    for (let c = 0; c < channels; c++) {
      out[i * channels + c] = fullInterleaved[(sIdx + i) * channels + c];
    }
  }
  if (sIdx - crossfadeFrames < 0) {
    throw new Error('Not enough pre-roll audio before the loop start for the requested crossfade length');
  }
  for (let j = 0; j < crossfadeFrames; j++) {
    const i = segFrames - crossfadeFrames + j;
    const theta = (j / (crossfadeFrames - 1)) * (Math.PI / 2);
    const fadeOut = Math.cos(theta);
    const fadeIn = Math.sin(theta);
    const tailAbsFrame = sIdx + i;
    const preAbsFrame = sIdx - crossfadeFrames + j;
    for (let c = 0; c < channels; c++) {
      const tailVal = fullInterleaved[tailAbsFrame * channels + c];
      const preVal = fullInterleaved[preAbsFrame * channels + c];
      const blended = tailVal * fadeOut + preVal * fadeIn;
      out[i * channels + c] = Math.max(-32768, Math.min(32767, Math.round(blended)));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Resample: windowed-sinc FIR lowpass (anti-alias guard for the downsample)
// followed by linear-interpolation resampling to the exact target rate.
// ---------------------------------------------------------------------------
function designLowpassFIR(numTaps, cutoffHz, sr) {
  const h = new Float64Array(numTaps);
  const M = (numTaps - 1) / 2;
  const fc = cutoffHz / sr; // normalized cutoff (0..0.5)
  let sum = 0;
  for (let n = 0; n < numTaps; n++) {
    const x = n - M;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const hamming = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (numTaps - 1));
    h[n] = sinc * hamming;
    sum += h[n];
  }
  for (let n = 0; n < numTaps; n++) h[n] /= sum; // unity DC gain
  return h;
}

function applyFIRPerChannel(interleaved, channels, numFrames, h) {
  const M = (h.length - 1) / 2;
  const out = new Float64Array(interleaved.length);
  for (let c = 0; c < channels; c++) {
    for (let i = 0; i < numFrames; i++) {
      let sum = 0;
      for (let k = 0; k < h.length; k++) {
        const srcFrame = i + k - M;
        if (srcFrame < 0 || srcFrame >= numFrames) continue; // zero-pad edges
        sum += h[k] * interleaved[srcFrame * channels + c];
      }
      out[i * channels + c] = sum;
    }
  }
  return out;
}

function linearResample(filtered, channels, numFrames, srcRate, targetRate) {
  const outFrames = Math.round((numFrames * targetRate) / srcRate);
  const out = new Int16Array(outFrames * channels);
  for (let j = 0; j < outFrames; j++) {
    const srcPos = (j * srcRate) / targetRate;
    const i0 = Math.floor(srcPos);
    const frac = srcPos - i0;
    const i1 = Math.min(i0 + 1, numFrames - 1);
    for (let c = 0; c < channels; c++) {
      const v0 = filtered[i0 * channels + c];
      const v1 = filtered[i1 * channels + c];
      const v = v0 * (1 - frac) + v1 * frac;
      out[j * channels + c] = Math.max(-32768, Math.min(32767, Math.round(v)));
    }
  }
  return { samples: out, outFrames };
}

function downmixToMono(interleaved, numFrames) {
  const out = new Int16Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    const l = interleaved[i * 2], r = interleaved[i * 2 + 1];
    out[i] = Math.max(-32768, Math.min(32767, Math.round((l + r) / 2)));
  }
  return out;
}

function stereoWidthMetrics(interleaved, numFrames) {
  let sumL = 0, sumR = 0, sumLR = 0, sumL2 = 0, sumR2 = 0, sumSide2 = 0, sumMid2 = 0;
  for (let i = 0; i < numFrames; i++) {
    const l = interleaved[i * 2] / 32768, r = interleaved[i * 2 + 1] / 32768;
    sumL += l; sumR += r;
    sumLR += l * r;
    sumL2 += l * l; sumR2 += r * r;
    const mid = (l + r) / 2, side = (l - r) / 2;
    sumMid2 += mid * mid; sumSide2 += side * side;
  }
  const meanL = sumL / numFrames, meanR = sumR / numFrames;
  const covLR = sumLR / numFrames - meanL * meanR;
  const varL = sumL2 / numFrames - meanL * meanL;
  const varR = sumR2 / numFrames - meanR * meanR;
  const correlation = covLR / Math.sqrt(varL * varR);
  const midRms = Math.sqrt(sumMid2 / numFrames);
  const sideRms = Math.sqrt(sumSide2 / numFrames);
  return { correlation, sideToMidRatio: sideRms / midRms };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  console.log(`Reading ${inputPath} ...`);
  const wav = readWav(inputPath);
  const durationSec = wav.numFrames / wav.sampleRate;
  console.log(`  ${wav.sampleRate}Hz, ${wav.channels}ch, ${wav.numFrames} frames, ${durationSec.toFixed(2)}s, ${(fs.statSync(inputPath).size / 1e6).toFixed(2)}MB`);

  console.log('Building mono analysis signal and searching for a loop point (20-40s)...');
  const mono = toMonoFloat(wav.interleaved, wav.channels, wav.numFrames);
  const { best, allScored } = findLoopPoint(mono, wav.sampleRate);
  const sIdx = best.sIdx, eIdx = best.eIdx;
  const loopDurSec = (eIdx - sIdx) / wav.sampleRate;

  let peak = 0;
  for (let i = sIdx; i < eIdx; i++) { const a = Math.abs(mono[i]); if (a > peak) peak = a; }
  const rawJump = Math.abs(mono[eIdx - 1] - mono[sIdx]);
  const jumpPctOfPeak = (rawJump / peak) * 100;

  console.log('\n=== Top loop-point candidates considered ===');
  console.log('  start(s)  dur(s)  phaseCorr  spectralSim  rmsDiff%  envScore  finalScore');
  for (const c of allScored.slice(0, 5)) {
    console.log(
      `  ${(c.sIdx / wav.sampleRate).toFixed(2).padStart(8)}  ${((c.eIdx - c.sIdx) / wav.sampleRate).toFixed(2).padStart(6)}` +
      `  ${(c.sampleCorr * 100).toFixed(1).padStart(9)}%  ${(c.spectralSim * 100).toFixed(1).padStart(11)}%` +
      `  ${c.rmsDiffPct.toFixed(1).padStart(8)}  ${(c.envScore * 100).toFixed(1).padStart(8)}%  ${(c.finalScore * 100).toFixed(1).padStart(9)}%`
    );
  }

  console.log('\n=== Loop point chosen ===');
  console.log(`  start: ${(sIdx / wav.sampleRate).toFixed(3)}s (sample ${sIdx})`);
  console.log(`  end:   ${(eIdx / wav.sampleRate).toFixed(3)}s (sample ${eIdx})`);
  console.log(`  loop duration: ${loopDurSec.toFixed(3)}s`);
  console.log(`  coarse envelope (musical-texture) similarity: ${(best.envScore * 100).toFixed(1)}%`);
  console.log(`  sample-domain phase correlation at seam: ${(best.sampleCorr * 100).toFixed(1)}%`);
  console.log(`  spectral content similarity (8-band Goertzel, start vs end window): ${(best.spectralSim * 100).toFixed(1)}%`);
  console.log(`  RMS amplitude difference (start 50ms vs end 50ms): ${best.rmsDiffPct.toFixed(1)}%`);
  console.log(`  raw sample-value jump at cut (pre-crossfade): ${jumpPctOfPeak.toFixed(2)}% of local peak amplitude`);

  // Crossfade safety net (see buildCrossfadedSegment's own comment for why
  // this blends with PRE-loop-start audio, not a same-index head slice).
  const crossfadeMs = 15;
  const crossfadeFrames = Math.round(wav.sampleRate * (crossfadeMs / 1000));
  const crossfaded = buildCrossfadedSegment(wav.interleaved, wav.channels, sIdx, eIdx, crossfadeFrames);
  const segFrames = eIdx - sIdx;

  // Post-crossfade discontinuity check (mono-mixed for a single number).
  let lastMono = 0, firstMono = 0;
  for (let c = 0; c < wav.channels; c++) {
    lastMono += crossfaded[(segFrames - 1) * wav.channels + c] / 32768;
    firstMono += crossfaded[0 * wav.channels + c] / 32768;
  }
  lastMono /= wav.channels;
  firstMono /= wav.channels;
  const postJumpPctOfPeak = (Math.abs(lastMono - firstMono) / peak) * 100;
  console.log(`  raw sample-value jump at cut (post ${crossfadeMs}ms crossfade): ${postJumpPctOfPeak.toFixed(2)}% of local peak amplitude`);

  // Stereo-width decision.
  const width = stereoWidthMetrics(crossfaded, segFrames);
  console.log('\n=== Stereo width ===');
  console.log(`  L/R correlation: ${width.correlation.toFixed(3)}`);
  console.log(`  side/mid RMS ratio: ${width.sideToMidRatio.toFixed(3)}`);
  let goMono = width.correlation > 0.9 && width.sideToMidRatio < 0.15;
  if (FORCE_MONO) goMono = true;
  if (FORCE_STEREO) goMono = false;
  console.log(`  decision: ${goMono ? 'mono' : 'stereo'}${FORCE_MONO || FORCE_STEREO ? ' (forced by flag)' : ' (data-driven; NOT ear-confirmed)'}`);

  const monoOrStereoInterleaved = goMono ? downmixToMono(crossfaded, segFrames) : crossfaded;
  const outChannels = goMono ? 1 : wav.channels;

  // Resample.
  console.log(`\nResampling ${wav.sampleRate}Hz -> ${TARGET_RATE}Hz ...`);
  const cutoff = Math.min(TARGET_RATE, wav.sampleRate) / 2 - 1500;
  const fir = designLowpassFIR(129, cutoff, wav.sampleRate);
  const filtered = applyFIRPerChannel(monoOrStereoInterleaved, outChannels, segFrames, fir);
  const { samples: resampled, outFrames } = linearResample(filtered, outChannels, segFrames, wav.sampleRate, TARGET_RATE);

  writeWav(outputPath, resampled, TARGET_RATE, outChannels);
  const outSize = fs.statSync(outputPath).size;
  const outDurSec = outFrames / TARGET_RATE;

  console.log('\n=== Output ===');
  console.log(`  ${outputPath}`);
  console.log(`  ${TARGET_RATE}Hz, ${outChannels}ch, ${outFrames} frames, ${outDurSec.toFixed(3)}s`);
  console.log(`  size: ${(outSize / 1e6).toFixed(2)}MB (was ${(fs.statSync(inputPath).size / 1e6).toFixed(2)}MB)`);

  console.log('\n=== Honesty check ===');
  console.log('  Every number above is a computational proxy for "will this click when');
  console.log('  it loops" — amplitude match, spectral match, sample-domain phase');
  console.log('  correlation, and a measured post-crossfade discontinuity near zero.');
  console.log('  None of that is the same as a human ear confirming the loop is');
  console.log('  genuinely seamless and that mono (if chosen) still sounds acceptable.');
  console.log('  That real listen is still required before this is considered done.');
}

main();
