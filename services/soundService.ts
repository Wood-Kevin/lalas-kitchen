// The three cues actually triggered today — see components/soundEffects.ts's
// triggerPassEffects for the exact call sites. Kept as a closed union (not a
// bare string) so an unregistered/misspelled id is a compile error, not a
// silent no-op discovered at runtime.
export type SoundEffectId = 'match' | 'cascade' | 'win';

// The one continuous ambient track. Kept as its own closed union rather than
// folded into SoundEffectId — a music id is started/stopped across a whole
// level's mount lifecycle (see Board.tsx and components/backgroundMusic.ts),
// never fired once per cascade pass the way play()'s effects are, so it gets
// its own pair of calls instead of overloading play()'s one-shot contract.
export type MusicId = 'background';

export interface SoundService {
  // Fire-and-forget: plays the named effect if a real asset is registered
  // for it, no-ops silently otherwise — mirrors components/spriteAsset.ts's
  // resolveSpriteAsset never-throws discipline for missing sprite art. Every
  // real call site must be safe to call unconditionally.
  play(effect: SoundEffectId): void;
  // Starts the named track looping, from the beginning, if a real asset is
  // registered — no-ops silently otherwise. Safe to call unconditionally,
  // matching play()'s never-throws contract.
  playMusic(id: MusicId): void;
  // Stops the named track and rewinds it, so a later playMusic restarts
  // from the top rather than resuming mid-loop. Safe to call even if the
  // track was never started.
  stopMusic(id: MusicId): void;
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
