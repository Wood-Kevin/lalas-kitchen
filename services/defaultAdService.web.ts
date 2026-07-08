import { Platform } from 'react-native';
import { AdService, selectAdService } from './adService';
import { crazyGamesAdService } from './crazyGamesAdService';

// Metro's platform-extension resolution (.web.ts) picks this file only for
// web bundles — see defaultAdService.native.ts's sibling file for the full
// reasoning. This file must NEVER import services/expoGoogleMobileAdsService
// (or react-native-google-mobile-ads at all): that was the real bug this
// split fixes, a native-only codegen component breaking the entire web
// bundle. `unreachableMobileService` is a defensive stub, not a real
// fallback — Platform.OS is always 'web' in a web bundle, so
// selectAdService should never actually pick this branch; if it somehow did
// (a genuinely impossible platform mismatch), throwing loudly here beats
// silently misbehaving, matching CLAUDE.md's no-silent-failures rule.
const unreachableMobileService: AdService = {
  async requestRewardedAd() {
    throw new Error('defaultAdService.web.ts: mobile ad path reached on a web bundle — this should be impossible');
  },
  async requestBannerAd() {
    throw new Error('defaultAdService.web.ts: mobile ad path reached on a web bundle — this should be impossible');
  },
  isRewardedAdAvailable() {
    throw new Error('defaultAdService.web.ts: mobile ad path reached on a web bundle — this should be impossible');
  },
};

export const adService = selectAdService(Platform.OS, unreachableMobileService, crazyGamesAdService);
