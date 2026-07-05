import { AdService } from './adService';

// The mobile (AdMob) adapter — selected for every non-web platform (see
// adService.ts's selectAdService). Still a stub: no real SDK integration
// exists yet, so both methods just instantly resolve the reward/shown
// result, matching the exact behavior the game's two live grant flows had
// before this abstraction existed. When a real AdMob integration lands, this
// is the one file that changes — no call site anywhere else in the game
// needs to know.
export const adMobAdService: AdService = {
  async requestRewardedAd(): Promise<boolean> {
    return true;
  },
  async requestBannerAd(): Promise<boolean> {
    return true;
  },
  // Mobile has no CrazyGames-style launch-phase gap — AdMob is expected to
  // work from day one, so this is unconditionally true.
  isRewardedAdAvailable(): boolean {
    return true;
  },
};
