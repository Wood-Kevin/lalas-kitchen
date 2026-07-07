import { useFonts, Baloo2_700Bold } from '@expo-google-fonts/baloo-2';
import { NunitoSans_400Regular, NunitoSans_700Bold } from '@expo-google-fonts/nunito-sans';

// The two custom Google Fonts the original design mockups specify (see
// DEFERRED_COMPLEXITY.md's now-resolved font-loading entry): Baloo 2 for
// headings, Nunito Sans for body text. Only the weights this skin's actual
// styles use are loaded — every heading style here is fontWeight '700', and
// body text is either unweighted (400) or '700' for a few bold labels — so
// there's no unused weight file bloating the bundle.
export const Fonts = {
  headingBold: 'Baloo2_700Bold',
  bodyRegular: 'NunitoSans_400Regular',
  bodyBold: 'NunitoSans_700Bold',
} as const;

// React Native doesn't synthesize font weights for custom (non-system)
// fonts, so every text style must reference one of these exact loaded family
// names directly rather than relying on a separate `fontWeight` value.
export function useAppFonts() {
  return useFonts({
    Baloo2_700Bold,
    NunitoSans_400Regular,
    NunitoSans_700Bold,
  });
}
