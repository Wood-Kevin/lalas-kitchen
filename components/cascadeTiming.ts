import { CascadeFallSpeed } from './skinConfig';

// config.animationProfile.cascadeFallSpeed is a qualitative string, not a
// duration — this is the one place that maps it to an actual millisecond
// value for Reanimated. The specific numbers are a rendering-layer judgment
// call (not specified anywhere in the build spec), documented in
// components/NOTES.md rather than guessed silently.
//
// `medium` was retuned from 350 to 480 (and lalas-kitchen's own
// matchDurationMs from 220 to 300 alongside it, in config.json) so a
// cascade chain resolves slowly enough for a player to actually see what
// cleared and why, rather than the pieces just vanishing in a blur — a
// direct read on CLAUDE.md's "calm, not frantic" pacing constraint.
// `swapDurationMs` (140) is untouched: that duration is the direct response
// to a player's own tap, not a passive animation they're just watching.
const CASCADE_FALL_DURATIONS_MS: Record<CascadeFallSpeed, number> = {
  slow: 500,
  medium: 480,
  fast: 220,
};

export function cascadeFallDurationMs(cascadeFallSpeed: CascadeFallSpeed): number {
  return CASCADE_FALL_DURATIONS_MS[cascadeFallSpeed] ?? CASCADE_FALL_DURATIONS_MS.medium;
}

// A blocker can clear several cascade steps away from the match a player
// actually tapped, with nothing else on screen drawing the eye there first
// (see engine/DECISIONS.md's adjacent-damage entry — this is a presentation
// gap, not an engine bug). Tile.tsx plays this brief highlight pulse on a
// clearing blocker before its normal pop-and-shrink, so the disappearance
// reads as "something hit this" rather than an unexplained glitch. Kept
// short and proportionate to matchDurationMs's 300ms default per CLAUDE.md's
// calm-not-frantic constraint — a glow pulse, not a shake, since this
// player's phone plays with sound off and doesn't need a jarring cue.
export const BLOCKER_CLEAR_HIGHLIGHT_MS = 200;
