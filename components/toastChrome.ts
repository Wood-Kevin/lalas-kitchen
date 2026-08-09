import { ViewStyle } from 'react-native';

// Shared material for the three transient "toast" pills that float over the
// board — ScorePopup, ComboStreakBanner, LalaMomentBanner. All three
// shipped as a flat single-color fill with a thin (1.5px) border and zero
// shadow — reasonable when it was the only chrome on screen, but a real
// gap once the HUD's own Kitchen Tray redesign (a shadow, a warm material)
// and the mascot art landed: the toasts were the one remaining flat surface
// on the board. A direct architect call ("toasts need a facelift after
// this new art work"), not a reversal of anything — the calm-not-frantic
// motion/timing these three already use (fade in/hold/fade out, no
// scale/bounce) is untouched; only the material gets real depth.
//
// Matches Board.tsx's own toolbarBadge shadow exactly (shadowOpacity 0.16,
// radius 4, offset {0,2}, elevation 3) and Hud.tsx's tray border width (2,
// via toolbarBadge) rather than inventing a fourth register — one shared
// constant so the three toasts and the chrome around them read as the same
// design language, not three independently-tuned facelifts drifting apart
// over time.
export const TOAST_SHADOW: ViewStyle = {
  shadowColor: '#000000',
  shadowOpacity: 0.16,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 2 },
  elevation: 3,
};

export const TOAST_BORDER_WIDTH = 2;
