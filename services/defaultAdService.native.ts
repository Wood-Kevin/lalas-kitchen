import { Platform } from 'react-native';
import { selectAdService } from './adService';
import { expoGoogleMobileAdsService } from './expoGoogleMobileAdsService';
import { crazyGamesAdService } from './crazyGamesAdService';

// Metro's platform-extension resolution (.native.ts) picks this file only
// for iOS/Android bundles — see defaultAdService.web.ts's sibling file and
// engine/DECISIONS.md's real-crazygames-sdk entry for why this split
// exists: react-native-google-mobile-ads transitively imports a native-only
// codegen component (GoogleMobileAdsBannerViewNativeComponent) that Metro
// cannot bundle for web at all, a real build break discovered live while
// verifying the CrazyGames work, not a hypothetical. Splitting the two
// platforms into separate files (rather than one shared file with a runtime
// `Platform.OS` check) keeps the AdMob import out of the web bundle's
// module graph entirely, not just unreached at runtime.
export const adService = selectAdService(Platform.OS, expoGoogleMobileAdsService, crazyGamesAdService);
