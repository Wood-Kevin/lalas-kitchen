import { PauseReason } from '../engine/gameState';

export interface PauseAction {
  resource: 'moves' | 'lives';
  message: string;
  buttonLabel: string;
  bonusAmount: number;
}

// Decides which grant button to show for a given pause reason. The engine
// only exposes *which* resource hit zero (PauseReason) — copy, button
// label, and the placeholder bonus amount are all presentation-layer
// choices that live here, not in gameState.ts. See components/NOTES.md for
// why these specific bonus amounts were picked.
export function getPauseAction(pauseReason: PauseReason): PauseAction | null {
  if (pauseReason === 'moves') {
    return {
      resource: 'moves',
      message: 'Out of moves!',
      buttonLabel: '+5 Moves',
      bonusAmount: 5,
    };
  }
  if (pauseReason === 'lives') {
    return {
      resource: 'lives',
      message: 'Out of lives!',
      buttonLabel: '+1 Life',
      bonusAmount: 1,
    };
  }
  return null;
}
