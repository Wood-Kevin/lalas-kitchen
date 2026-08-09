import { SpecialEffectDescriptor } from './specialEffectAnimation';
import { ScorePopupTone } from './ScorePopup';

// Pulled out of Board.tsx's commitFinalState (the codex commercial-polish
// consolidation pass) so the tone/copy decisions are named, tested pure
// functions instead of an inline nested ternary — matching this codebase's
// established pattern for presentation-only decisions derived from a
// settled move (cascadeTiming.ts's passRewardIntensity, wonActions.ts's
// computeStarRating).

// A move's own tier, reusing the same signals SCORE_TIER_POINTS' caller
// already has at hand rather than re-deriving anything new: a fired special
// (chained or the move's own swap-triggered effect) always reads as
// 'special', a settled multi-pass move (a real cascade, even without a
// special) reads as 'cascade', and a plain single-pass match is 'ordinary'.
// Mirrors the same floor/ceiling shape scaledByReward already established
// for board effects — more juice where it's earned, not uniformly louder.
export function resolveScorePopupTone(
  multiSpecialFired: boolean,
  effectDescriptor: SpecialEffectDescriptor | undefined,
  passCount: number
): ScorePopupTone {
  if (multiSpecialFired || effectDescriptor) return 'special';
  if (passCount > 1) return 'cascade';
  return 'ordinary';
}

// Lala speaks only on meaningful moments, in descending priority — so a
// move that qualifies for more than one line only ever shows the most
// notable, per release-character-pack.md's own "show at most one line per
// move" presentation rule. Ordinary matches under the score floor stay
// quiet entirely (null), so the line reads as a warm acknowledgment of
// something real, not a notification firing on every tap.
//
// Covers 8 of the copy bank's 12 triggers (up from the original 4: hasCombo/
// multiSpecialFired/cascade/score-floor). The 4 not wired here are
// deliberate, not an oversight — see DEFERRED_COMPLEXITY.md's
// lala-moment-banner-coverage entry: "Level win" and "Recipe unlock" are
// each already carried by a richer, dedicated treatment at that exact
// moment (WonOverlay's headline/stars/burst, RecipeCardReveal), so a text
// banner underneath would be redundant at best and invisible at worst once
// the overlay covers it; "Automatic no-moves rescue" is deliberately silent
// by an earlier, still-valid design decision (see gameState.ts's applyMove,
// "a shuffle should read as silent and immediate... not an announced
// interruption") with no signal exposed for it anyway; "Special piece
// created" would need a new engine signal (detecting a newly-spawned
// special distinct from one merely activating) that doesn't cheaply exist
// today. "Manual shuffle" and "Returning home" aren't parameters of this
// function at all: the former fires directly from Board.tsx's
// handleRequestShuffle (a distinct action, not a move outcome to prioritize
// against these), and the latter is already live via a different
// mechanism (Home.tsx's own welcome-back string).
export function resolveLalaMomentCopy(
  hasCombo: boolean,
  multiSpecialFired: boolean,
  effectDescriptor: SpecialEffectDescriptor | undefined,
  passCount: number,
  isFirstMoveOfAttempt: boolean,
  movesRemaining: number,
  moveScore: number
): string | null {
  if (hasCombo) return 'Beautifully done.';
  if (multiSpecialFired) return 'A little kitchen magic.';
  if (effectDescriptor) return "Now that's a useful one.";
  if (passCount > 1) return 'Look at that little chain.';
  if (isFirstMoveOfAttempt) return 'There we are.';
  if (movesRemaining === 1) return 'One more careful stir.';
  if (moveScore >= 100) return "That'll do nicely.";
  return null;
}
