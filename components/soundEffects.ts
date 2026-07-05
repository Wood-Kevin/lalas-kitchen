import type { SoundService } from '../services/soundService';
import type { HapticsService } from '../services/hapticsService';

export interface SoundEffectsOptions {
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  soundService: SoundService;
  hapticsService: HapticsService;
}

// Called once per cascade pass from Board.tsx's animateCascade (runStep(i)),
// the only place applyMove's steps/events are available without widening
// Board's prop surface (see appPersistence.ts's didLevelJustEnd, which
// re-derives level-end for the same reason rather than threading events up
// to App.tsx). `i` is the pass index: 0 is the direct match from the
// player's own swap, 1+ is a chained cascade pass. `isFinalPass` and
// `finalOutcome` let this same call resolve the win cue too, without a
// second call site — engine/gameState.ts's ApplyMoveResult only ever
// surfaces a `level_summary` event ('won' | 'paused_awaiting_input') on the
// move's last pass, which is exactly what `finalOutcome` mirrors here.
//
// A plain function, not a hook: nothing here holds React state or runs an
// effect, so wrapping it in useCallback/useState would only add hook-call
// constraints (and a new render-context test dependency) with no behavior
// benefit — see engine/DECISIONS.md's sound/haptics stub-layer entry.
export function triggerPassEffects(
  i: number,
  isFinalPass: boolean,
  finalOutcome: 'won' | 'paused_awaiting_input' | undefined,
  { soundEnabled, hapticsEnabled, soundService, hapticsService }: SoundEffectsOptions
): void {
  if (i === 0) {
    if (soundEnabled) soundService.play('match');
    // Haptic fires only on the first pass (the player's own move), never on
    // a later cascade pass — a haptic pulse on every fast pass of a long
    // chain would read as a buzzy alarm, against CLAUDE.md's calm-not-
    // frantic brief. Sound alone still lets a long chain register audibly.
    if (hapticsEnabled) hapticsService.fire('light');
  } else if (soundEnabled) {
    soundService.play('cascade');
  }

  if (isFinalPass && finalOutcome === 'won' && soundEnabled) {
    soundService.play('win');
  }
}
