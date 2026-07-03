import { Objective } from '../engine/gameState';

export interface WonSummary {
  message: string;
  detail: string;
}

// Builds the congratulatory copy from the final objective state — kept
// separate from WonOverlay.tsx the same way getPauseAction is kept separate
// from PausedOverlay.tsx, so "what does this say" is testable without
// mounting a component. `currentCount` can be greater than `targetCount`
// (a single cascade can clear more of the objective's piece type than
// exactly the remaining amount — see engine/gameState.ts's win check),
// so this always reports the real final numbers rather than clamping.
export function getWonSummary(objective: Objective): WonSummary {
  return {
    message: 'Level complete!',
    detail: `${objective.currentCount}/${objective.targetCount} collected`,
  };
}
