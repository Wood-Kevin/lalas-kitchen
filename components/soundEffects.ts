import type { SoundService } from '../services/soundService';
import type { HapticsService } from '../services/hapticsService';

export interface SoundEffectsOptions {
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  soundService: SoundService;
  hapticsService: HapticsService;
  // Dev-only, opt-in via the game-feel-comparison harness (see
  // Board.tsx's BoardProps.experimentalJuice and SPEC.md's Track A scope).
  // Swaps the calm production match/cascade cues for brighter `_juice`
  // variants and, when specialEffectFired is also true, layers in a
  // `special_trigger` cue. Both default false/undefined, so every existing
  // real-gameplay call site (which never sets either) plays exactly the
  // calm-tuned match/cascade/win set it always has.
  experimentalJuice?: boolean;
  // Whether THIS pass fires a special effect (a striped sweep, a bomb/combo
  // detonation) — see Board.tsx's own `specialEffectFired` derivation from
  // buildPassAnimation's sweep/radial delay maps. Only consulted when
  // experimentalJuice is true.
  specialEffectFired?: boolean;
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
  {
    soundEnabled,
    hapticsEnabled,
    soundService,
    hapticsService,
    experimentalJuice = false,
    specialEffectFired = false,
  }: SoundEffectsOptions
): void {
  if (i === 0) {
    if (soundEnabled) soundService.play(experimentalJuice ? 'match_juice' : 'match');
    // Haptic fires only on the first pass (the player's own move), never on
    // a later cascade pass — a haptic pulse on every fast pass of a long
    // chain would read as a buzzy alarm, against CLAUDE.md's calm-not-
    // frantic brief. Sound alone still lets a long chain register audibly.
    if (hapticsEnabled) hapticsService.fire('light');
  } else if (soundEnabled) {
    soundService.play(experimentalJuice ? 'cascade_juice' : 'cascade');
  }

  // Dev-only, layered ON TOP of the match_juice/cascade_juice cue above (not
  // instead of it) — a genuinely new cue with no calm-gameplay counterpart,
  // so "I made a match" and "...and it triggered something" both register
  // as distinct beats, on whichever pass the special actually fires (an
  // in-cascade trigger, like the fixed comparison scenario's striped sweep,
  // fires on a later pass — never assume i === 0 here).
  if (soundEnabled && experimentalJuice && specialEffectFired) {
    soundService.play('special_trigger');
  }

  if (isFinalPass && finalOutcome === 'won' && soundEnabled) {
    soundService.play('win');
  }
}
