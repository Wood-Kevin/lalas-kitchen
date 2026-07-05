import { AdService } from './adService';

// CrazyGames disables all monetization during "Basic Launch" — the phase
// every game starts in — and only re-enables it once CrazyGames reviews the
// game and graduates it to "Full Launch" (see docs.crazygames.com's ads
// requirements page). Investigation confirmed there is no SDK call to check
// this proactively: `requestAd()` can report an `adsDisabledBasicLaunch`
// error code, but only *after* attempting a request that was doomed from the
// start — exactly the dead-button behavior this flag exists to avoid. So
// this is a manually flipped build-time flag, not a runtime read: false
// (today's real state) while the game sits in Basic Launch, flipped to true
// the day CrazyGames actually notifies of Full Launch graduation. See
// engine/DECISIONS.md's crazygames-basic-launch entry.
export const CRAZY_GAMES_MONETIZATION_ENABLED = false;

// A factory rather than a bare object so tests can exercise both phases
// deterministically (see crazyGamesAdService.test.ts) without mutating
// module-level state. The real singleton below is just this factory called
// with today's actual flag value.
export function createCrazyGamesAdService(monetizationEnabled: boolean): AdService {
  return {
    async requestRewardedAd(): Promise<boolean> {
      if (!monetizationEnabled) {
        // No ad exists to request during Basic Launch — grant the reward
        // directly rather than gating it behind a call that can only fail.
        return true;
      }
      // Real ad request path once Full Launch lands — still a stub, no SDK
      // wired in yet (matches adMobAdService's own stub exactly).
      return true;
    },
    async requestBannerAd(): Promise<boolean> {
      if (!monetizationEnabled) {
        // No banner exists to show during Basic Launch either.
        return false;
      }
      return true;
    },
    isRewardedAdAvailable(): boolean {
      return monetizationEnabled;
    },
  };
}

export const crazyGamesAdService: AdService = createCrazyGamesAdService(CRAZY_GAMES_MONETIZATION_ENABLED);
