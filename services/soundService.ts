// Only 'match'/'cascade'/'win' are actually triggered by real gameplay —
// see components/soundEffects.ts's triggerPassEffects, whose call site never
// reads any other id. Kept as a closed union (not a bare string) so an
// unregistered/misspelled id is a compile error, not a silent no-op
// discovered at runtime.
//
// 'match'/'cascade'/'win' are now sourced from a real, licensed sound pack
// (Chequered Ink's "400 Sounds Pack", see soundRegistry.ts's own comment for
// which files and the license) rather than the original procedurally-
// synthesized tones — that swap is disclosed as unconfirmed-by-ear for
// win_chime specifically in DEFERRED_COMPLEXITY.md, since a "level complete"
// cue in a generic pack is exactly the kind of fanfare that previously read
// as "slot machine" here.
//
// The three `_juice`/`special_trigger` ids below are NOT reachable from real
// gameplay at all — a real on-device listen (2026-08-09) confirmed they read
// as exactly the "slot machine" character the calm match/cascade/win set was
// redesigned three times to get away from (see scripts/generate-sound-
// assets.js's own redesign history), so `triggerPassEffects` was corrected
// to stop selecting them for any real player, at any soundEnabled state —
// this had briefly regressed to gating them on soundEnabled instead of
// removing them from the live path entirely, which is what actually caused
// the on-device report. Left registered (real, synthesized WAV assets,
// still valid) rather than deleted, in case the dev-only game-feel-
// comparison harness (`experiments/game-feel-comparison/`, SPEC.md's Track A
// scope) is ever revisited — but nothing in production code plays them.
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
