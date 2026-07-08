import type { SoundService } from './soundService';

// The only concrete SoundService today. No sound files exist in the repo yet
// (see skins/lalas-kitchen/soundRegistry.ts), so every call is necessarily a
// no-op — this is not a placeholder for "assets before the real adapter
// lands" the way adMobAdService/crazyGamesAdService stub a real ad network;
// it's the correct real behavior until sound assets exist. When real assets
// land, this file (or a sibling adapter selected instead of it) is the one
// thing that changes — no call site elsewhere needs to know.
export const silentSoundService: SoundService = {
  play(): void {
    // Intentional no-op.
  },
  playMusic(): void {
    // Intentional no-op.
  },
  stopMusic(): void {
    // Intentional no-op.
  },
};
