// The three cues actually triggered today — see components/soundEffects.ts's
// triggerPassEffects for the exact call sites. Kept as a closed union (not a
// bare string) so an unregistered/misspelled id is a compile error, not a
// silent no-op discovered at runtime.
//
// The three `_juice`/`special_trigger` ids below are dev-only, opt-in via
// the RN-vs-Unity game-feel-comparison harness (SPEC.md, Board.tsx's
// BoardProps.experimentalJuice) — brighter/punchier stand-ins for match/
// cascade plus a genuinely new "a special effect just fired" cue, all
// deliberately overriding this game's calm-tuned production match/cascade/
// win set (see scripts/generate-sound-assets.js's own redesign history) for
// the comparison only. See components/soundEffects.ts's triggerPassEffects
// for exactly when each plays; never triggered on a real level.
export type SoundEffectId =
  | 'match'
  | 'cascade'
  | 'win'
  | 'match_juice'
  | 'cascade_juice'
  | 'special_trigger';

export interface SoundService {
  // Fire-and-forget: plays the named effect if a real asset is registered
  // for it, no-ops silently otherwise — mirrors components/spriteAsset.ts's
  // resolveSpriteAsset never-throws discipline for missing sprite art. Every
  // real call site must be safe to call unconditionally.
  play(effect: SoundEffectId): void;
}

// Picks the real implementation to use. Takes the real service as an
// injected param rather than importing services/expoAudioSoundService.ts
// directly, so this file (and everything it imports) stays safely
// importable from a test — expo-audio's import fails to parse under this
// repo's plain ts-jest config, the same reason hapticsService.ts injects
// its services instead of importing expo-haptics itself. See
// services/defaultSoundService.ts for the real construction.
export function selectSoundService(realService: SoundService): SoundService {
  // Unlike expo-haptics (which needs a real native/no-op split — see
  // hapticsService.ts's selectHapticsService), expo-audio plays correctly
  // on every platform Expo targets (confirmed: Android, iOS, tvOS, and
  // web), so there's no platform branch to make here — the real service is
  // always the right answer once one is injected.
  return realService;
}
