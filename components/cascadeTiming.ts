import { CascadeFallSpeed } from './skinConfig';

// config.animationProfile.cascadeFallSpeed is a qualitative string, not a
// duration — this is the one place that maps it to an actual millisecond
// value for Reanimated. The specific numbers are a rendering-layer judgment
// call (not specified anywhere in the build spec), documented in
// components/NOTES.md rather than guessed silently.
const CASCADE_FALL_DURATIONS_MS: Record<CascadeFallSpeed, number> = {
  slow: 500,
  medium: 350,
  fast: 220,
};

export function cascadeFallDurationMs(cascadeFallSpeed: CascadeFallSpeed): number {
  return CASCADE_FALL_DURATIONS_MS[cascadeFallSpeed] ?? CASCADE_FALL_DURATIONS_MS.medium;
}
