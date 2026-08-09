import { SpecialEffectDescriptor } from './specialEffectAnimation';

// Pulled out of Board.tsx's commitFinalState (the codex commercial-polish
// consolidation pass) so the copy decision is a named, tested pure
// function instead of an inline nested ternary — matching this codebase's
// established pattern for presentation-only decisions derived from a
// settled move (cascadeTiming.ts's passRewardIntensity, wonActions.ts's
// computeStarRating).

// Lala speaks only on meaningful moments, in descending priority — so a
// move that qualifies for more than one line only ever shows the most
// notable, per release-character-pack.md's own "show at most one line per
// move" presentation rule. Ordinary matches under the score floor stay
// quiet entirely (null), so the line reads as a warm acknowledgment of
// something real, not a notification firing on every tap.
//
// Covers 9 of the copy bank's 12 triggers (up from the original 4: hasCombo/
// multiSpecialFired/cascade/score-floor). "Automatic no-moves rescue" was
// deliberately NOT wired at first — silent by an earlier design decision
// cited in gameState.ts's applyMove — but that decision was reversed by
// real playtest feedback the same session (a board silently rearranging
// itself reads as a glitch, not as calm), so `stuckBoardRescued` is now
// wired here too. It outranks every reward signal except hasCombo: a rare,
// skill-earned combo still gets top billing on the off chance it coincides
// with a rescue, but "why did my whole board just change" otherwise
// deserves a prompt explanation ahead of routine cascade/first-move/score
// flavor.
//
// The remaining 3 of 12 are still deliberate, not an oversight — see
// DEFERRED_COMPLEXITY.md's lala-moment-banner-coverage entry: "Level win"
// and "Recipe unlock" are each already carried by a richer, dedicated
// treatment at that exact moment (WonOverlay's headline/stars/burst,
// RecipeCardReveal), so a text banner underneath would be redundant at
// best and invisible at worst once the overlay covers it; "Special piece
// created" would need a new engine signal (detecting a newly-spawned
// special distinct from one merely activating) that doesn't cheaply exist
// today. "Manual shuffle" and "Returning home" aren't parameters of this
// function at all: the former fires directly from Board.tsx's
// handleRequestShuffle (a distinct action, not a move outcome to prioritize
// against these), and the latter is already live via a different
// mechanism (Home.tsx's own welcome-back string).
export function resolveLalaMomentCopy(
  hasCombo: boolean,
  stuckBoardRescued: boolean,
  multiSpecialFired: boolean,
  effectDescriptor: SpecialEffectDescriptor | undefined,
  passCount: number,
  isFirstMoveOfAttempt: boolean,
  movesRemaining: number,
  moveScore: number
): string | null {
  if (hasCombo) return 'Beautifully done.';
  if (stuckBoardRescued) return 'The board needed a little reset.';
  if (multiSpecialFired) return 'A little kitchen magic.';
  if (effectDescriptor) return "Now that's a useful one.";
  if (passCount > 1) return 'Look at that little chain.';
  if (isFirstMoveOfAttempt) return 'There we are.';
  if (movesRemaining === 1) return 'One more careful stir.';
  if (moveScore >= 100) return "That'll do nicely.";
  return null;
}
