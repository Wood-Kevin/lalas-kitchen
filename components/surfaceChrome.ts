import { ViewStyle } from 'react-native';

// Shared material for any elevated surface across this app's screens — the
// board's toast pills (ScorePopup/ComboStreakBanner/LalaMomentBanner) and,
// from the Home-screen facelift, its cards/primary button/objective badge.
// Originally toast-only (components/toastChrome.ts, since renamed here —
// see engine/DECISIONS.md's home-screen-facelift entry) once it became
// clear the same "flat fill, thin border, zero shadow -> real material"
// gap wasn't unique to the board: a real DOM check found ZERO elements
// anywhere on Home had a shadow, the same flatness the toasts had before
// their own facelift. One shared constant so every screen's "has real
// depth now" surfaces read as the same design language rather than each
// screen arriving at its own approximation.
//
// Matches Board.tsx's own toolbarBadge shadow exactly (shadowOpacity 0.16,
// radius 4, offset {0,2}, elevation 3) and the toast pills' border width
// (2) — Board.tsx's toolbarBadge itself still holds its own inline copy of
// these values (predates this file), a disclosed, not-yet-collapsed
// duplication, not an oversight; see DEFERRED_COMPLEXITY.md.
export const SURFACE_SHADOW: ViewStyle = {
  shadowColor: '#000000',
  shadowOpacity: 0.16,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 2 },
  elevation: 3,
};

export const SURFACE_BORDER_WIDTH = 2;
