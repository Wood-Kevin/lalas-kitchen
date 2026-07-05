import { AdService } from './adService';

// The web (CrazyGames) adapter — selected when Platform.OS === 'web' (see
// adService.ts's selectAdService). Still a stub: no real SDK integration
// exists yet, so both methods just instantly resolve the reward/shown
// result, matching the exact behavior the game's two live grant flows had
// before this abstraction existed. When a real CrazyGames integration lands,
// this is the one file that changes — no call site anywhere else in the game
// needs to know.
export const crazyGamesAdService: AdService = {
  async requestRewardedAd(): Promise<boolean> {
    return true;
  },
  async requestBannerAd(): Promise<boolean> {
    return true;
  },
};
