import type { SoundService } from '../services/soundService';

// Pure decision logic for the ambient background loop's mount-lifecycle
// effect in Board.tsx: start the track when sound is on, stop it when sound
// is off. Extracted the same way stuckHintTiming.ts's resetIdleHintTimer is
// — this repo has no React component-rendering test harness, so the one
// piece of this feature genuinely worth pinning down in a test file is this
// decision itself, not the useEffect wiring around it (verified live
// instead, over CDP).
//
// Board.tsx calls this both on mount and on every soundEnabled change (same
// effect, `[soundEnabled]` deps), and always calls stopMusic('background')
// directly from that effect's cleanup on unmount — so the loop can never
// keep playing after the level screen is left, regardless of the toggle's
// value at that moment.
export function syncBackgroundMusic(soundEnabled: boolean, soundService: SoundService): void {
  if (soundEnabled) {
    soundService.playMusic('background');
  } else {
    soundService.stopMusic('background');
  }
}
