import { silentSoundService } from './silentSoundService';

// The three cues actually triggered today — see components/soundEffects.ts's
// triggerPassEffects for the exact call sites. Kept as a closed union (not a
// bare string) so an unregistered/misspelled id is a compile error, not a
// silent no-op discovered at runtime.
export type SoundEffectId = 'match' | 'cascade' | 'win';

export interface SoundService {
  // Fire-and-forget: plays the named effect if a real asset is registered
  // for it, no-ops silently otherwise — mirrors components/spriteAsset.ts's
  // resolveSpriteAsset never-throws discipline for missing sprite art. No
  // sound files exist in this repo yet (see
  // skins/lalas-kitchen/soundRegistry.ts), so every real call site must be
  // safe to call unconditionally.
  play(effect: SoundEffectId): void;
}

// Picks the real implementation for a given platform. Takes the platform as
// a plain string rather than reading react-native's Platform.OS itself, so
// this whole file (and everything it imports) stays safely importable from
// a test — see services/defaultSoundService.ts for why the real Platform.OS
// read is deliberately kept out of here (mirrors services/adService.ts).
export function selectSoundService(platformOS: string): SoundService {
  // Both platforms resolve to the same silent stub today — no real adapter
  // split exists yet (unlike adService's genuine AdMob/CrazyGames split),
  // since no sound assets or playback backend are wired in. Kept as a real
  // selector (not a bare export) so a future native-vs-web split has an
  // obvious seam to grow into, matching adService.ts's own shape.
  return silentSoundService;
}
