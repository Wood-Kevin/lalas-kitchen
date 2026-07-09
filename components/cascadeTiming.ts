import { CascadeFallSpeed } from './skinConfig';

// config.animationProfile.cascadeFallSpeed is a qualitative string, not a
// duration — this is the one place that maps it to an actual millisecond
// value for Reanimated. The specific numbers are a rendering-layer judgment
// call (not specified anywhere in the build spec), documented in
// components/NOTES.md rather than guessed silently.
//
// `medium` was retuned from 350 to 480 (and lalas-kitchen's own
// matchDurationMs from 220 to 300 alongside it, in config.json) so a
// cascade chain resolves slowly enough for a player to actually see what
// cleared and why, rather than the pieces just vanishing in a blur — a
// direct read on CLAUDE.md's "calm, not frantic" pacing constraint.
// `swapDurationMs` (140) is untouched: that duration is the direct response
// to a player's own tap, not a passive animation they're just watching.
const CASCADE_FALL_DURATIONS_MS: Record<CascadeFallSpeed, number> = {
  slow: 500,
  medium: 480,
  fast: 220,
};

export function cascadeFallDurationMs(cascadeFallSpeed: CascadeFallSpeed): number {
  return CASCADE_FALL_DURATIONS_MS[cascadeFallSpeed] ?? CASCADE_FALL_DURATIONS_MS.medium;
}

// A blocker can clear several cascade steps away from the match a player
// actually tapped, with nothing else on screen drawing the eye there first
// (see engine/DECISIONS.md's adjacent-damage entry — this is a presentation
// gap, not an engine bug). Tile.tsx plays this brief highlight pulse on a
// clearing blocker before its normal pop-and-shrink, so the disappearance
// reads as "something hit this" rather than an unexplained glitch. Kept
// short and proportionate to matchDurationMs's 300ms default per CLAUDE.md's
// calm-not-frantic constraint — a glow pulse, not a shake, since this
// player's phone plays with sound off and doesn't need a jarring cue.
export const BLOCKER_CLEAR_HIGHLIGHT_MS = 200;

// A striped piece's row/column sweep clears a whole line at once in the engine,
// but clearing every tile in that line simultaneously reads as a flat wash that
// just appears and vanishes — it never looks like the beam actually *travelled*
// (real play feedback: the sweep felt lackluster). Instead the presentation
// layer staggers each tile's pop by its distance (in tiles) from the striped
// piece, so a gentle glow visibly runs down the line one tile at a time (see
// components/sweepAnimation.ts + Tile.tsx's ExitingTile sweep branch).
//
// 55ms per tile is a calm-pacing judgment call, not a spec value: it's slow
// enough that each tile clearly reacts at its own moment (the whole point) yet
// keeps even the longest beam legible — the 8-row board's worst case, an
// edge-origin column sweep across 7 tiles, travels for ~385ms, in the same
// unhurried register as the 480ms between-cascade beat. Deliberately a travel
// cadence, not a speed-up: per CLAUDE.md this player wants more visual weight,
// not more intensity. Larger would start to drag; smaller collapses back toward
// the flat all-at-once wash this replaces.
export const SWEEP_TILE_STAGGER_MS = 55;

// Once the beam reaches a tile, that tile brightens and swells slightly (the
// "pop") before it shrinks away — this is the brighten phase's duration, the
// texture that makes each tile's reaction read as a deliberate beat rather than
// a plain fade. Kept a small fraction of matchDurationMs (300ms) so the pop is a
// gentle swell folded into the front of the normal pop-and-shrink, not an extra
// stage that stretches the clear. See ExitingTile's sweep branch.
export const SWEEP_GLOW_POP_MS = 110;

// The color bomb detonation's radial ripple spends its whole travel budget
// here, regardless of board size (see specialEffectAnimation.ts's
// radialDelaysForClears, which normalizes distance-from-bomb to this fixed
// total rather than a fixed per-tile stagger) — a bomb's reach is the WHOLE
// board, and a per-tile constant like SWEEP_TILE_STAGGER_MS would make the
// wave's total travel time balloon on a larger/shaped level. Chosen close to
// SWEEP_TILE_STAGGER_MS's own worst-case linear-sweep travel time (~385ms on
// this app's largest board) so a board-spanning detonation reads as roughly
// the same calm "one beat" weight as a single line sweep, not slower just
// because it covers more area.
export const COLOR_BOMB_WAVE_MS = 280;

// The supercombo's two beats share one timing knob: the "conversion" flash
// plays for exactly this long, and the synchronized pop-and-shrink for every
// converted piece begins the instant it ends (see specialEffectAnimation.ts's
// buildPassAnimation, which sets every converted piece's sweepDelayMs to this
// same value — a UNIFORM delay, deliberately not staggered by distance, since
// the point of beat 2 is that everything fires TOGETHER, not that it travels).
// Kept short — a quick, legible flicker rather than a held pause — so the two
// beats read as one fluid gesture (convert, then release) rather than the
// move visibly stalling before it resolves.
export const SUPERCOMBO_CONVERT_MS = 170;

// The conversion flash's own pulse rate within SUPERCOMBO_CONVERT_MS — a
// double-blink (up/down/up/down) rather than one smooth brighten, since a
// flicker reads as "this is becoming something new" in a way a single steady
// glow (the sweep/radial pop's own language, reused elsewhere) doesn't. Four
// even beats fit inside SUPERCOMBO_CONVERT_MS exactly.
export const SUPERCOMBO_FLASH_PULSE_MS = SUPERCOMBO_CONVERT_MS / 4;

// How long the terminal (Won / Paused) overlay is held back after the FINAL
// cascade pass commits, before it's allowed to appear. Board.tsx's
// animateCascade commits gameState — flipping status to 'won'/'paused' — at the
// *start* of the last pass's animation, so the overlay's underlying data is
// ready one full pass-beat before that pass has finished playing on screen.
// Without this hold the overlay pops the instant the winning move's data
// resolves, cutting off the final pass (and, on a single-pass win, the winning
// match's own pop) — the exact "overlay appears before cascades finish" bug.
// One full between-pass beat is the same pacing every earlier pass already gets
// before the next one starts, so the last pass just gets the beat it was
// missing rather than a bespoke new delay.
export function terminalOverlayHoldMs(cascadeStepIntervalMs: number): number {
  return cascadeStepIntervalMs;
}

export interface CascadeAnimationSchedule {
  // Offset in ms (from the move being applied) at which each cascade pass
  // begins animating on screen — one entry per pass, in resolution order.
  // stepStartsMs[i] === i * cascadeStepIntervalMs, because animateCascade
  // chains each pass a fixed interval after the previous one.
  stepStartsMs: number[];
  // Offset in ms at which the terminal (Won / Paused) overlay may appear. By
  // construction this is always strictly greater than every entry in
  // stepStartsMs — the overlay is gated on the LAST pass having begun AND had a
  // full beat to finish, never on the moment win data resolves mid- or
  // start-of-final-pass. This is the property the presentation layer must
  // honour, expressed as pure arithmetic so it's testable without a component.
  overlayRevealMs: number;
}

// Models when each cascade pass animates and when the terminal overlay is
// allowed to show, for a move that resolved `stepCount` passes. Board.tsx
// realises this schedule via chained setTimeouts (per-pass) plus one final
// hold timer (the overlay); this function is the single source of truth for the
// ordering, so a test can assert "every pass plays before the overlay" directly
// rather than driving React timers. stepCount is clamped at 0 for safety —
// applyMove CAN genuinely return an empty `steps` for a committed move now
// (a dropdown/escort swap that neither matches nor arrives — see
// engine/gameState.ts's ApplyMoveResult.steps comment); Board.tsx's real
// animateCascade special-cases that scenario with its own early
// commitFinalState() return rather than calling into this model at all.
export function planCascadeAnimation(
  stepCount: number,
  cascadeStepIntervalMs: number
): CascadeAnimationSchedule {
  const passes = Math.max(0, stepCount);
  const stepStartsMs = Array.from({ length: passes }, (_, i) => i * cascadeStepIntervalMs);
  const lastStartMs = passes > 0 ? stepStartsMs[passes - 1] : 0;
  return {
    stepStartsMs,
    overlayRevealMs: lastStartMs + terminalOverlayHoldMs(cascadeStepIntervalMs),
  };
}
