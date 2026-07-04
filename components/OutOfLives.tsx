import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { msUntilNextLifeRegen } from '../appPersistence';
import { SkinConfig } from './skinConfig';
import { resolveSpriteAsset, ResolvedSprite, SpriteAssetMap } from './spriteAsset';

export interface OutOfLivesProps {
  config: SkinConfig;
  spriteAssets: SpriteAssetMap;
  // The account's real persisted lives count — always 0 whenever App.tsx
  // actually routes here (canStartLevel gates every entry point), but read
  // as a real prop rather than hardcoded so the flame row stays honest if
  // that ever changes.
  lives: number;
  // The real regen anchor App.tsx already tracks (livesLastRegenAtRef) —
  // this screen only ever reads it to project a countdown, never writes
  // it. See msUntilNextLifeRegen's own comment on why the projection
  // deliberately stops at the next tick rather than guessing further.
  livesLastRegenAt: number;
  // Present only when App.tsx wired a real instant-grant mechanism (see
  // appPersistence.ts's grantInstantLife) — this session's investigation
  // found no such mechanism for this context (the old grantBonusMoves/
  // grantBonusLife pair was a mid-level pause mechanic, deleted alongside
  // PauseReason's 'lives' branch; this screen blocks a level from
  // *starting* instead). Optional rather than required so this component
  // still renders correctly with the button omitted if that ever changes
  // back, without a crash.
  onGrantLife?: () => void;
  onBack: () => void;
}

// Mirrors WonOverlay.tsx/PausedOverlay.tsx's card/backdrop shape and their
// one-primary-plus-quiet-secondary-link structure — the third sibling in
// that family, not a visually distinct fourth screen. Differentiated from
// them by context, not tone: this blocks a brand new level from starting
// at all (account-level lives, not a mid-level pause), so there is no
// objective chip and no "Play Again" (there is nothing yet to replay).
export function OutOfLives({ config, spriteAssets, lives, livesLastRegenAt, onGrantLife, onBack }: OutOfLivesProps) {
  const { max, regenMinutes, icon } = config.lives;
  const { accent, secondaryAccent, mutedText, text, panel, border } = config.palette;
  const flameSprite = resolveSpriteAsset(icon, spriteAssets);

  // Ticks once a second purely to re-render the countdown text below — the
  // actual remaining time is always recomputed fresh from `livesLastRegenAt`
  // (a prop, not owned state), matching the rest of this app's "recompute
  // from wall-clock time, no ticking game clock" convention (see
  // appPersistence.ts's applyLivesRegen comment).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = msUntilNextLifeRegen(lives, livesLastRegenAt, max, regenMinutes, now);
  const ready = remainingMs <= 0;

  return (
    <View style={[styles.backdrop, { backgroundColor: 'rgba(59, 38, 26, 0.6)' }]}>
      <View style={[styles.card, { backgroundColor: panel, borderColor: border }]}>
        <View style={styles.flameRow}>
          {Array.from({ length: max }, (_, i) => (
            <FlameSlot key={i} filled={i < lives} sprite={flameSprite} dimColor={border} />
          ))}
        </View>

        <Text style={[styles.headline, { color: text }]}>The Kitchen&apos;s Resting</Text>
        <Text style={[styles.subtext, { color: mutedText }]}>
          Lives refill over time, up to 5. Come back soon, or watch a video to speed things up.
        </Text>

        <View style={[styles.countdownPill, { borderColor: secondaryAccent }]}>
          <Text style={[styles.countdownText, { color: secondaryAccent }]}>
            {ready ? 'A life should be ready' : `Next life in ${formatCountdown(remainingMs)}`}
          </Text>
        </View>

        {onGrantLife && (
          <Pressable style={[styles.primaryButton, { backgroundColor: FLAME }]} onPress={onGrantLife}>
            <Text style={styles.primaryButtonLabel}>Watch a video for a life</Text>
          </Pressable>
        )}
        <Pressable style={styles.secondaryLink} onPress={onBack}>
          <Text style={[styles.secondaryLinkLabel, { color: text }]}>Back to Home</Text>
        </Pressable>
      </View>
    </View>
  );
}

function FlameSlot({ filled, sprite, dimColor }: { filled: boolean; sprite: ResolvedSprite; dimColor: string }) {
  if (sprite.kind === 'image') {
    return (
      <Image
        source={sprite.source}
        style={[styles.flameImage, !filled && styles.flameImageEmpty]}
        resizeMode="contain"
      />
    );
  }
  return <Text style={[styles.flameLabel, { color: filled ? FLAME : dimColor }]}>{sprite.label}</Text>;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// Same fixed brand accent WonOverlay.tsx/PausedOverlay.tsx use — the
// bonus-video CTA and the lives icon both read from this warm flame
// orange, not skin-configurable (see WonOverlay.tsx's matching note).
const FLAME = '#F2793A';

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: 320,
    maxWidth: '88%',
    borderWidth: 2,
    borderRadius: 26,
    paddingVertical: 24,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  flameRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 14,
  },
  flameImage: {
    width: 26,
    height: 26,
  },
  flameImageEmpty: {
    opacity: 0.25,
  },
  flameLabel: {
    fontSize: 22,
    fontWeight: '700',
  },
  headline: {
    fontSize: 21,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtext: {
    marginTop: 6,
    fontSize: 13.5,
    fontWeight: '500',
    textAlign: 'center',
  },
  countdownPill: {
    marginTop: 16,
    borderWidth: 1.5,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 14,
  },
  countdownText: {
    fontSize: 12,
    fontWeight: '700',
  },
  primaryButton: {
    width: '100%',
    marginTop: 18,
    paddingVertical: 13,
    paddingHorizontal: 10,
    borderRadius: 16,
    alignItems: 'center',
  },
  primaryButtonLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14.5,
    textAlign: 'center',
  },
  secondaryLink: {
    marginTop: 10,
    paddingVertical: 4,
  },
  secondaryLinkLabel: {
    fontWeight: '600',
    fontSize: 14,
    opacity: 0.85,
  },
});
