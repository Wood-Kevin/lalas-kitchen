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
