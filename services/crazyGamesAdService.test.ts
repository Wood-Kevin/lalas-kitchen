import { createCrazyGamesAdService } from './crazyGamesAdService';
import { adMobAdService } from './adMobAdService';

describe('CrazyGames Basic Launch (monetization disabled)', () => {
  const service = createCrazyGamesAdService(false);

  test('grants the rewarded-ad reward for free instead of gating on a request that cannot succeed', async () => {
    await expect(service.requestRewardedAd()).resolves.toBe(true);
  });

  test('reports no banner to show', async () => {
    await expect(service.requestBannerAd()).resolves.toBe(false);
  });

  test('reports the rewarded ad as unavailable, so callers can adjust their copy', () => {
    expect(service.isRewardedAdAvailable()).toBe(false);
  });
});

describe('CrazyGames Full Launch (monetization enabled)', () => {
  const service = createCrazyGamesAdService(true);

  test('requires the real ad request, matching AdMob (mobile) behavior exactly', async () => {
    await expect(service.requestRewardedAd()).resolves.toBe(await adMobAdService.requestRewardedAd());
  });

  test('shows a banner, matching AdMob (mobile) behavior exactly', async () => {
    await expect(service.requestBannerAd()).resolves.toBe(await adMobAdService.requestBannerAd());
  });

  test('reports the rewarded ad as available', () => {
    expect(service.isRewardedAdAvailable()).toBe(true);
  });
});
