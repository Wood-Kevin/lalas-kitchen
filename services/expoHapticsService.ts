import * as Haptics from 'expo-haptics';
import type { HapticsService } from './hapticsService';

// The real device-haptics adapter. impactAsync(ImpactFeedbackStyle.Light) is
// the soft, light tap this game calls for — Medium/Heavy exist on the same
// enum for a noticeably stronger thud, which would read as buzzy against
// CLAUDE.md's calm-not-frantic brief. Fire-and-forget: impactAsync returns a
// Promise that resolves once the OS call completes, but nothing here needs
// to await it — a rejected/unsupported-hardware promise is swallowed so a
// haptics failure can never surface as an unhandled rejection or interrupt
// gameplay.
export const expoHapticsService: HapticsService = {
  fire(): void {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
};
