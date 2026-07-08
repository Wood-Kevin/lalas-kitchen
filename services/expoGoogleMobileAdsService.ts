import { AdEventType, RewardedAd, RewardedAdEventType, TestIds } from 'react-native-google-mobile-ads';
import { AdService } from './adService';

// The real mobile (AdMob) adapter, replacing adMobAdService.ts's old instant-
// grant stub — see engine/DECISIONS.md's real-admob-sdk entry. Kept in its
// own file, never imported by any test, for the same reason
// expoHapticsService.ts/expoAudioSoundService.ts are: react-native-google-
// mobile-ads transitively imports 'react-native', which fails to parse
// under this repo's plain ts-jest config (confirmed directly — the same
// limitation those two files already document). adService.ts's
// selectAdService takes this as an injected param rather than importing it
// directly, so that factory logic stays testable with fakes.
//
// TestIds.REWARDED resolves to Google's own publicly documented demo ad
// unit id per platform (developers.google.com/admob/android/test-ads,
// developers.google.com/admob/ios/test-ads) — genuinely usable without a
// real AdMob developer account, not tied to any specific person. Swap for a
// real ad unit id once a real AdMob account exists (see app.json's
// androidAppId/iosAppId for the matching test App IDs, which need the same
// swap).
const REWARDED_AD_UNIT_ID = TestIds.REWARDED;

// Loads a fresh RewardedAd and shows it the instant it's ready, resolving
// true only if the player actually watched to completion and earned the
// reward (RewardedAdEventType.EARNED_REWARD) — false on a load/show error
// or if the ad closes without that event firing (dismissed early). Listeners
// are torn down on whichever terminal event fires first so a single
// requestRewardedAd() call never double-resolves or leaks a subscription.
function loadAndShowRewarded(): Promise<boolean> {
  return new Promise((resolve) => {
    const rewarded = RewardedAd.createForAdRequest(REWARDED_AD_UNIT_ID);
    let earnedReward = false;

    const unsubscribeLoaded = rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
      rewarded.show();
    });
    const unsubscribeEarned = rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
      earnedReward = true;
    });
    const unsubscribeClosed = rewarded.addAdEventListener(AdEventType.CLOSED, () => {
      cleanup();
      resolve(earnedReward);
    });
    const unsubscribeError = rewarded.addAdEventListener(AdEventType.ERROR, (error) => {
      console.error('[expoGoogleMobileAdsService] rewarded ad failed to load or show:', error);
      cleanup();
      resolve(false);
    });

    function cleanup() {
      unsubscribeLoaded();
      unsubscribeEarned();
      unsubscribeClosed();
      unsubscribeError();
    }

    rewarded.load();
  });
}

export const expoGoogleMobileAdsService: AdService = {
  requestRewardedAd: loadAndShowRewarded,
  // No banner-ad UI exists anywhere in the game yet (see adService.ts's own
  // AdService.requestBannerAd doc comment) — there's nothing to load a real
  // banner FOR, and loading one that's never displayed is exactly the kind
  // of behavior real ad networks discourage. Stays an honest stub, same as
  // before, until a banner surface is actually built.
  async requestBannerAd(): Promise<boolean> {
    return true;
  },
  // Mobile has no CrazyGames-style launch-phase gap — AdMob is expected to
  // work from day one.
  isRewardedAdAvailable(): boolean {
    return true;
  },
};
