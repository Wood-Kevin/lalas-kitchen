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

  test('both adapters instantly resolve a banner ad as shown', async () => {
    await expect(adMobAdService.requestBannerAd()).resolves.toBe(true);
    await expect(crazyGamesAdService.requestBannerAd()).resolves.toBe(true);
  });
});
