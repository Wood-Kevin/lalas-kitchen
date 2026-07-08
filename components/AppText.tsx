import { Text as RNText, TextProps } from 'react-native';

// Caps how far the system's text-size setting can scale UI copy. Chosen to cover
// the large majority of real accessibility "larger text" settings while still
// leaving headroom for the tightest HUD chips after their layout was widened
// to tolerate it (see LivesBadge/Hud/Board top-bar/overlay badges).
export const FONT_SCALE_CAP = 2;

export function Text(props: TextProps) {
  return <RNText maxFontSizeMultiplier={FONT_SCALE_CAP} {...props} />;
}
