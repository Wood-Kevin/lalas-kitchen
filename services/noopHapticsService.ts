import type { HapticsService } from './hapticsService';

export const noopHapticsService: HapticsService = {
  fire(): void {
    // Intentional no-op — see hapticsService.ts's selectHapticsService.
  },
};
