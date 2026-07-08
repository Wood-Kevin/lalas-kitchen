import { PauseReason } from '../engine/gameState';

export interface PauseAction {
  message: string;
  buttonLabel: string;
  bonusAmount: number;
}

// Decides which grant button to show for a given pause reason. The engine
// only exposes *which* resource hit zero (PauseReason) — copy, button
// label, and the placeholder bonus amount are all presentation-layer
// choices that live here, not in gameState.ts. See components/NOTES.md for
// why this specific bonus amount was picked.
//
// 'moves' is the only reason left to handle — the 'lives' branch this used
// to have was removed alongside PauseReason's 'lives' value (see
// engine/DECISIONS.md): losing a level now spends a life at the account
// level, not mid-level, so a pause can no longer be *caused* by lives
// hitting zero.
export function getPauseAction(pauseReason: PauseReason): PauseAction | null {
  if (pauseReason === 'moves') {
    return {
      message: 'Out of moves!',
      buttonLabel: '+5 Moves',
      bonusAmount: 5,
    };
  }
  return null;
}

// How many times a single level attempt may take the "watch a video for more
// moves" grant. A per-attempt cap, not a lifetime or daily one: the counter it
// gates lives in Board's per-attempt state and resets to zero on every fresh
// start or restart (see Board.tsx's handlePlayAgain and its mount-time
// useState). Two feels like a genuine second chance without turning a stuck
// board into an unlimited stall — matching the calm, low-pressure tone the rest
// of this screen keeps (see PausedOverlay.tsx).
export const MOVE_GRANTS_PER_ATTEMPT = 2;

// Pure decision for whether the bonus-moves grant should still be offered,
// given how many grants this attempt has already used. Kept here beside
// getPauseAction — "should we show the grant button" is the same kind of
// presentation choice as "which grant button" — so it's testable without
// mounting PausedOverlay. Once this returns false the overlay drops the video
// CTA and leaves Play Again / Exit as the way forward.
export function canGrantBonusMoves(grantsUsed: number): boolean {
  return grantsUsed < MOVE_GRANTS_PER_ATTEMPT;
}

// How many times a single level attempt may tap the player-initiated
// stuck-hint button (see Board.tsx's handleRequestHint and
// engine/DECISIONS.md's stuck-player-hint entry). A sibling cap to
// MOVE_GRANTS_PER_ATTEMPT above, deliberately the same number today, but a
// genuinely independent knob — nothing ties the two together, so either can
// be retuned later without touching the other.
export const HINT_USES_PER_ATTEMPT = 2;

// Same shape as canGrantBonusMoves, applied to the hint button instead: once
// this returns false, Board.tsx drops the button entirely rather than leaving
// a dead tap target on screen.
export function canUseHint(hintUsesUsed: number): boolean {
  return hintUsesUsed < HINT_USES_PER_ATTEMPT;
}

// The two things that move a per-attempt use counter: taking a use ('use',
// +1) and starting the attempt over ('restart', back to zero — Play Again, or
// a re-entry that remounts Board). Generic over which resource it's counting
// — the bonus-moves grant and the stuck-hint button both call this same
// function against their own independent counters, rather than each growing
// its own copy of "increment, or reset on restart." Pure so Board's cap
// wiring — including the crucial "a fresh attempt resets the count" behaviour
// — is testable without mounting anything, the same reason getPauseAction
// lives out here. A brand-new mount trivially starts at zero and doesn't need
// this.
export type AttemptUseEvent = 'use' | 'restart';
export function nextAttemptUseCount(used: number, event: AttemptUseEvent): number {
  return event === 'restart' ? 0 : used + 1;
}

// Whether a moves-exhausted pause should show ContinueOffer (a rescue,
// offered before the life for this attempt is spent) instead of PausedOverlay
// (the terminal loss screen, shown only once no rescue is left to offer).
// Board.tsx's runStep spends the life at the exact moment this returns false
// for a fresh pause — see its own comment on why life-spend timing had to
// move out of App.tsx's generic state-transition check and in here, beside
// the grant cap it now depends on.
export function shouldOfferContinue(pauseReason: PauseReason, grantsUsed: number): boolean {
  return pauseReason === 'moves' && canGrantBonusMoves(grantsUsed);
}
