import { CascadeFallSpeed } from './skinConfig';

// config.animationProfile.cascadeFallSpeed is a qualitative string — this is
// the one place that maps it to actual motion numbers for Reanimated, so the
// skin never knows about cell counts or milliseconds (the leak test).
//
// It used to map to one flat DURATION (480ms for `medium`), which the
// game-feel overhaul (SPEC.md, 2026-08-08) identified as the single biggest
// "doesn't feel like other match-3s" contributor: a fixed duration means a
// 6-cell fall travels six times FASTER than a 1-cell fall in the same
// cascade, so pieces visibly move at different speeds. The genre's falls
// read as physical because their VELOCITY is consistent and arrival times
// vary. So a speed now maps to a velocity profile — a small fixed `baseMs`
// (unstick time), a `perCellMs` rate, and a `capMs` so a full-board fall on
// a tall level can never drag — and each tile's real duration is derived
// from its own travel distance via fallDurationForCells below.
//
// The `medium` numbers keep a typical 2-3 cell cascade fall in the same
// unhurried register the old flat 480ms gave it (2 cells ≈ 380ms, 3 ≈
// 540ms), while a 1-cell fall (220ms) stops being glacial. Hand-picked, not
// playtested — disclosed in DEFERRED_COMPLEXITY.md like every other motion
// constant here.
export interface FallSpeedProfile {
  baseMs: number;
  perCellMs: number;
  capMs: number;
}

const FALL_SPEED_PROFILES: Record<CascadeFallSpeed, FallSpeedProfile> = {
  slow: { baseMs: 70, perCellMs: 200, capMs: 800 },
  medium: { baseMs: 60, perCellMs: 160, capMs: 640 },
  fast: { baseMs: 40, perCellMs: 90, capMs: 400 },
};

export function fallSpeedProfile(cascadeFallSpeed: CascadeFallSpeed): FallSpeedProfile {
  return FALL_SPEED_PROFILES[cascadeFallSpeed] ?? FALL_SPEED_PROFILES.medium;
}

// A tile's actual motion duration for `cells` of travel. 0 cells → 0 (no
// motion, no animation); otherwise base + perCell × cells, capped. Fractional
// cell counts are legal — a tile retargeted mid-flight computes its remaining
// distance from its current animated position, so the duration always matches
// the distance genuinely left to cover.
export function fallDurationForCells(profile: FallSpeedProfile, cells: number): number {
  if (cells <= 0) return 0;
  return Math.min(profile.capMs, Math.round(profile.baseMs + profile.perCellMs * cells));
}

// How long a spawn that cannot stream from the board's top edge (an enclosed
// void segment — see boardDiff.ts's planSpawnEntries) takes to fade in at its
// landing cell. The only remaining fade in the refill pipeline: edge-streamed
// spawns enter fully opaque above the board and are clipped by the board
// frame, per SPEC.md's spawn-streaming decision.
export const SPAWN_FADE_MS = 200;

// Tile POSITION never overshoots — this is a deliberate reversal of three
// earlier attempts in this same investigation (see engine/DECISIONS.md's
// swap-smoothness entries), and the reasoning is worth keeping close to the
// code it explains, not just in the decision log.
//
// A spring's overshoot is proportional to distance travelled, so any single
// damping ratio that looks right for a one-tile swap looks proportionally
// wilder on a multi-row fall (Follow-up 3), and even correctly scoped to
// exactly one tile of travel, real play still reported it as "bounces like
// crazy... not a smooth settle" (Follow-up 4) — because a tile sliding PAST
// its own grid cell and back is a structurally different thing from a spring
// overshooting in open space. It briefly overlaps its neighbour's cell,
// which reads as the grid itself flexing, not as a satisfying settle. No
// damping ratio fixes that; the position motion itself has to stop exactly
// at the cell.
//
// So position now runs on a CRITICALLY DAMPED spring (dampingRatio 1 — the
// fastest response with zero overshoot), and the "juice" moves to
// SQUASH-AND-STRETCH instead: a brief scale distortion that stays entirely
// inside the tile's own footprint, played on arrival. This is the standard
// technique this genre (and 2D game feel generally) actually uses for
// impact — see Tile.tsx's squash block — and it was the missing piece across
// three rounds of damping-ratio tuning: the bounce was never a duration or
// ratio problem, it was the wrong axis (position instead of scale).
export const TILE_MOVE_DAMPING_RATIO = 1;

// The squash-and-stretch landing beat: a quick compress-and-widen the instant
// a tile arrives, springing back to its normal shape. Values are a real,
// deliberate exaggeration (this genre's tiles squish noticeably, not
// subtly) but stay well short of anything read as damage or alarm — a soft
// cartoon "thud," per CLAUDE.md's calm-not-frantic constraint, not a shake.
export const SQUASH_SCALE_Y = 0.82;
export const SQUASH_SCALE_X = 1.14;
// The compress phase is quick (impact should read as sudden); the recover
// phase is a touch slower so the return to normal shape is visible rather
// than snapping back invisibly fast.
export const SQUASH_DOWN_MS = 70;
export const SQUASH_RECOVER_MS = 130;
export const SQUASH_TOTAL_MS = SQUASH_DOWN_MS + SQUASH_RECOVER_MS;

// How long a moved tile waits, after arriving, before its clear animation (or
// anything else gated on "this tile is done") may begin — the position move
// itself has no overshoot to wait out anymore, but the squash landing beat
// still needs to finish playing first (real play: "the match needs to settle
// then disappear" — see Follow-up 2). 0 for a tile that never moved, so every
// ordinary cascade/sweep/blast/blocker clear keeps its prior timing exactly.
export function springSettleMs(perceptualMs: number): number {
  return perceptualMs > 0 ? perceptualMs + SQUASH_TOTAL_MS : 0;
}

// The quiet breathing beat between one cascade pass's motion finishing and
// the next pass beginning (and between the final pass finishing and the
// terminal overlay appearing). This replaces the old fixed 480ms
// `cascadeStepIntervalMs` metronome: pass scheduling is now content-driven
// (see passDurationMs below) — a pass runs exactly as long as its own
// longest motion, then this one short beat of stillness, so a small pass no
// longer waits out dead air and a long fall is no longer cut off. It also
// gives a landing tile's squash-and-stretch beat (SQUASH_TOTAL_MS's 200ms)
// most of its room before the next pass's clears begin, matching the old
// schedule's behaviour of not gating passes on the squash itself.
//
// Note on the former COLUMN_DROP_STAGGER_MS (a 25ms/column left-to-right
// drop ripple): removed outright by the game-feel overhaul rather than kept
// beside it. It was choreography standing in for physics — with fall
// durations now proportional to distance, arrival times vary naturally per
// column and the artificial ripple would just fight the real one.
export const PASS_BEAT_MS = 140;

// The ordinary-match anticipation beat (SPEC.md's resolved fork): a matched
// tile brightens and swells briefly BEFORE it shrinks away, so the game's
// most common event gets the same "recognize → celebrate → remove" grammar
// every special effect already has, instead of just evaporating. Folded into
// the FRONT of matchDurationMs — exactly the pattern the sweep's
// SWEEP_GLOW_POP_MS established — so a clear's total time, and therefore the
// pass schedule, is unchanged. Milder than the sweep/radial pops on every
// axis (smaller swell, fainter wash) because it plays on every single match,
// not on a special moment. Calm brief: a soft acknowledgement, not a flash.
export const MATCH_POP_MS = 90;
export const MATCH_POP_SCALE = 1.08;
export const MATCH_POP_OPACITY = 0.25;

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

// One chain LINK's worth of stagger: every cell a chain reaction cleared at
// wave w (see engine/gameState.ts's ApplyMoveResult.chainWaveByPieceId) waits
// w × this before its own clear animation begins, so a caught special visibly
// fires AFTER the effect that caught it reached it — the per-link staging the
// chaining work deferred (each link reads as its own beat) instead of the
// whole chain vanishing as one flat clear. 260ms sits deliberately between
// COLOR_BOMB_WAVE_MS (280, one board-spanning effect's full travel) and the
// longest linear sweep (~385ms): late enough that link w's cells clearly
// start after link w-1's wave is most of the way through its travel, short
// enough that a 3-link chain (~780ms of stagger) still resolves inside the
// same unhurried register as a 2-pass cascade (2 × 480ms beats) — sequential
// and legible, never a drawn-out stall. Calm pacing per CLAUDE.md: this
// SLOWS the chain's read into deliberate beats; it adds no flash or shake.
export const CHAIN_LINK_STAGGER_MS = 260;

// Everything one cascade pass is doing that takes time, reduced to the
// numbers the schedule needs. Board.tsx's runStep derives these from the
// pass's own diff + pass animation — nothing here is new data, only the
// existing per-tile timing decisions summarised for scheduling.
export interface PassMotionInputs {
  // Longest grid motion in this pass, in cells: the deepest fall among
  // moved pieces (chebyshev distance, so a shuffle relocation counts too)
  // and the tallest spawn stream (a column's spawn count — see
  // boardDiff.ts's planSpawnEntries). 0 for a pass that only clears.
  maxMotionCells: number;
  // The largest delay any of this pass's clears waits before its own pop
  // begins — the max across the pass animation's sweep/radial maps, which
  // already includes chain-wave staging. 0 when every clear is immediate.
  maxClearDelayMs: number;
  // Whether any of this pass's clears is a blocker, whose exit plays its
  // own highlight pulse before the normal pop-and-shrink.
  hasBlockerClear: boolean;
  // The skin's per-clear pop-and-shrink budget (matchDurationMs).
  matchDurationMs: number;
  // Pass 0 of a committed swap holds every clear until the swap has landed
  // AND played its squash beat (springSettleMs(swapDurationMs)); 0 for
  // every other pass. Falls in the pass are not held — only clears are.
  settleMs: number;
}

// How long one pass's motion actually takes to finish on screen — the
// content-driven replacement for the old fixed 480ms `cascadeStepIntervalMs`.
// A pass's clears and its falls run concurrently (the refill starts the tick
// the pass is shown), so the pass is done when the LATER of the two is done:
//   clears: settle hold + the latest clear's start delay (sweep/radial/chain,
//           or the blocker highlight pulse) + the pop-and-shrink itself
//   falls:  the longest motion's distance-derived duration
// The landing squash is deliberately NOT waited out here — the old schedule
// never gated the next pass on it either, and PASS_BEAT_MS gives it most of
// its room; a beat of overlap between a settling squash and the next pass's
// clears is the continuity the overhaul is after, not a defect.
export function passDurationMs(inputs: PassMotionInputs, profile: FallSpeedProfile): number {
  const clearStartDelayMs = Math.max(
    inputs.maxClearDelayMs,
    inputs.hasBlockerClear ? BLOCKER_CLEAR_HIGHLIGHT_MS : 0
  );
  const clearsEndMs = inputs.settleMs + clearStartDelayMs + inputs.matchDurationMs;
  const fallsEndMs = fallDurationForCells(profile, inputs.maxMotionCells);
  return Math.max(clearsEndMs, fallsEndMs);
}

export interface CascadeAnimationSchedule {
  // Offset in ms (from the move being applied) at which each cascade pass
  // begins animating on screen — one entry per pass, in resolution order.
  // Each pass starts when the previous pass's own motion has finished plus
  // one PASS_BEAT_MS of stillness — content-driven, never a fixed metronome.
  stepStartsMs: number[];
  // Offset in ms at which the terminal (Won / Paused) overlay may appear. By
  // construction this is always strictly greater than every entry in
  // stepStartsMs — the overlay is gated on the LAST pass having begun AND
  // finished its own motion plus one beat, never on the moment win data
  // resolves mid- or start-of-final-pass. This is the property the
  // presentation layer must honour, expressed as pure arithmetic so it's
  // testable without a component.
  overlayRevealMs: number;
}

// Models when each cascade pass animates and when the terminal overlay is
// allowed to show, for a move whose passes take `passDurationsMs` each (one
// entry per pass, from passDurationMs above). Board.tsx realises this
// schedule via chained setTimeouts (per-pass) plus one final hold timer (the
// overlay); this function is the single source of truth for the ordering, so
// a test can assert "every pass plays before the overlay" directly rather
// than driving React timers. An empty array is legal for safety — applyMove
// CAN genuinely return empty `steps` for a committed move (a dropdown/escort
// swap that neither matches nor arrives); Board.tsx's real animateCascade
// special-cases that scenario with its own early commitFinalState() return
// rather than calling into this model at all.
export function planCascadeAnimation(
  passDurationsMs: number[],
  beatMs: number = PASS_BEAT_MS
): CascadeAnimationSchedule {
  const stepStartsMs: number[] = [];
  let cursor = 0;
  for (const duration of passDurationsMs) {
    stepStartsMs.push(cursor);
    cursor += Math.max(0, duration) + beatMs;
  }
  return {
    stepStartsMs,
    // The cursor already sits one beat past the final pass's end — exactly
    // the overlay's earliest allowed moment.
    overlayRevealMs: cursor,
  };
}
