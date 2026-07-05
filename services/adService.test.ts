import { selectAdService } from './adService';
import { adMobAdService } from './adMobAdService';
import { crazyGamesAdService } from './crazyGamesAdService';

describe('selectAdService', () => {
  test('resolves to the CrazyGames adapter on web', () => {
    expect(selectAdService('web')).toBe(crazyGamesAdService);
  });

  test('resolves to the AdMob adapter on every non-web platform', () => {
    expect(selectAdService('ios')).toBe(adMobAdService);
    expect(selectAdService('android')).toBe(adMobAdService);
  });
});

describe('stub adapters', () => {
  test('both adapters instantly resolve a rewarded ad as completed', async () => {
    await expect(adMobAdService.requestRewardedAd()).resolves.toBe(true);
    await expect(crazyGamesAdService.requestRewardedAd()).resolves.toBe(true);
  });

  test('AdMob instantly resolves a banner ad as shown', async () => {
    await expect(adMobAdService.requestBannerAd()).resolves.toBe(true);
  });

  test("CrazyGames' banner reflects today's real Basic Launch state (no banner to show)", async () => {
    // See crazyGamesAdService.test.ts for both phases exercised directly.
    await expect(crazyGamesAdService.requestBannerAd()).resolves.toBe(false);
  });
});

describe('isRewardedAdAvailable', () => {
  test('AdMob is always available — mobile has no launch-phase gap', () => {
    expect(adMobAdService.isRewardedAdAvailable()).toBe(true);
  });

  test("CrazyGames reflects today's real Basic Launch state (disabled)", () => {
    // See crazyGamesAdService.test.ts for both phases exercised directly via
    // the factory — this just confirms the exported singleton matches
    // today's actual CRAZY_GAMES_MONETIZATION_ENABLED flag.
    expect(crazyGamesAdService.isRewardedAdAvailable()).toBe(false);
  });
});
