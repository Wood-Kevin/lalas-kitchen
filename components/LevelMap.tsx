import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SkinConfig } from './skinConfig';
import { GinghamTrim } from './GinghamTrim';
import { LivesBadge } from './LivesBadge';
import { SpriteAssetMap } from './spriteAsset';
import { Fonts } from './fonts';
import { LevelStatus, LevelSummary } from './levelProgress';
import { StarRating } from './wonActions';
import {
  computeLevelMapNodePositions,
  computeLevelMapPathSegments,
  computeScrollOffsetToCenter,
  levelMapContentHeight,
} from './levelMapLayout';

export interface LevelMapRow extends LevelSummary {
  status: LevelStatus;
  // Best-ever rating (appPersistence.ts's recordLevelStars). Undefined for
  // a locked or current level (nothing to show yet) — and also undefined
  // for a COMPLETED level with no persisted rating, which real saves can
  // have: every win recorded before this feature existed has no honestly
  // knowable past score. That case renders as unrated (see StarRow below),
  // never a fabricated 3, per this game's honest-numbers principle
  // elsewhere (the recipe book's plain count, objective chips' real
  // uncapped totals).
  stars?: StarRating;
}

export interface LevelMapProps {
  config: SkinConfig;
  spriteAssets: SpriteAssetMap;
  levels: LevelMapRow[];
  completedCount: number;
  // The real account-level lives count (App.tsx's own `lives` state, the
  // same reactive value Hud.tsx and Home.tsx's badge already read) — shown
  // here as a calm corner badge in the header, never a new value tracked
  // by LevelMap itself.
  lives: number;
  onBack: () => void;
  onPlayLevel: (levelIndex: number) => void;
}

// A fixed decorative accent from the approved design brief, not
// skin-configurable palette data — the exact same value as WonOverlay.tsx's
// own YOLK constant, reused here rather than promoted into SkinPalette for
// a two-file visual pass (same reasoning as that file's own comment on it).
const GLOW = '#E3A43B';

const MEDALLION_DIAMETER = 72;
const CURRENT_MEDALLION_DIAMETER = 92;
// Fixed (not radius-derived): keeps every node's x safely clear of the
// screen edge even at the larger current-node diameter, and clear of the
// caption pill / PLAY button, both wider than any medallion.
const SIDE_INSET = 74;
const NODE_BOX_WIDTH = 140;
const PATH_STROKE_WIDTH = 10;
// Height reserved above the medallion for the current level's "LEVEL N"
// caption pill (its own height plus the gap below it) — see the node
// vertical-centering comment on CURRENT_TOP_OFFSET below.
const CAPTION_BLOCK_HEIGHT = 32;

// Replaces the old All Levels scrollable list (components/AllLevels.tsx,
// now removed) with a winding path connecting level medallions, per the
// approved design mockup: a checkmark + best-ever star row for completed
// levels, a glowing ring + PLAY button for the current level, and a dimmed
// padlock for locked levels ahead — all reusing the exact same level
// progress data (completedLevels, the real next-unplayed level, locked
// levels beyond it) the old screen already computed, just rendered
// differently. No ingredient icon or display name on a node, unlike the old
// row layout — the approved mockup shows only the level number plus status
// decoration, deliberately calmer/less busy than a themed-park map.
//
// The winding path itself is straight rotated-View segments between node
// centers, not a smooth SVG curve — see components/levelMapLayout.ts's
// header comment for why (no react-native-svg dependency exists in this
// project, and GinghamTrim.tsx already established the house convention of
// reproducing a mockup effect with plain Views rather than adding a
// rendering dependency for one visual pass).
export function LevelMap({ config, spriteAssets, levels, completedCount, lives, onBack, onPlayLevel }: LevelMapProps) {
  const { accent, panel, border, text, mutedText, secondaryAccent, background } = config.palette;
  const scrollRef = useRef<ScrollView>(null);
  const [mapWidth, setMapWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const positions = useMemo(() => computeLevelMapNodePositions(levels.length), [levels.length]);
  const contentHeight = useMemo(() => levelMapContentHeight(levels.length), [levels.length]);

  const usableWidth = Math.max(0, mapWidth - SIDE_INSET * 2);
  const points = useMemo(
    () => positions.map((position) => ({ x: SIDE_INSET + position.xFraction * usableWidth, y: position.y })),
    [positions, usableWidth]
  );
  const segments = useMemo(() => computeLevelMapPathSegments(points), [points]);

  const currentIndex = levels.findIndex((level) => level.status === 'current');

  // Opens the map already scrolled to center the current level, not the top
  // of the list — this session's explicit ask. Only fires once both real
  // measurements are in (mapWidth/viewportHeight start at 0 from onLayout)
  // and there's a current level to center on; a jump, not an animated
  // scroll, since this is the map appearing already positioned, not a
  // player-visible scroll happening.
  useEffect(() => {
    if (mapWidth === 0 || viewportHeight === 0 || currentIndex < 0) return;
    const targetY = points[currentIndex]?.y ?? 0;
    scrollRef.current?.scrollTo({ y: computeScrollOffsetToCenter(targetY, viewportHeight), animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapWidth, viewportHeight, currentIndex]);

  return (
    <View style={[styles.container, { backgroundColor: background[0] }]}>
      <GinghamTrim accentColor={accent} panelColor={panel} height={12} />

      <View style={styles.header}>
        <Pressable
          style={[styles.backButton, { backgroundColor: panel, borderColor: border }]}
          onPress={onBack}
          accessibilityLabel="Back to home"
        >
          <Text style={[styles.backArrow, { color: text }]}>‹</Text>
        </Pressable>
        <View style={styles.headerTextBlock}>
          <Text style={[styles.title, { color: accent }]}>Level Map</Text>
          <Text style={[styles.statusLine, { color: mutedText }]}>
            {completedCount} cooked · pick up wherever you like
          </Text>
        </View>
        {/* Calm corner readout, same badge Home.tsx shows — placed here
            rather than competing with the back button/title as a peer nav
            element, or with the map's own path/nodes below. */}
        <LivesBadge config={config} spriteAssets={spriteAssets} lives={lives} />
      </View>

      <View
        style={styles.mapArea}
        onLayout={(event: LayoutChangeEvent) => {
          setMapWidth(event.nativeEvent.layout.width);
          setViewportHeight(event.nativeEvent.layout.height);
        }}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={{ height: contentHeight }}
          showsVerticalScrollIndicator={false}
        >
          {mapWidth > 0 &&
            segments.map((segment, i) => {
              // A real completion prefix in practice (see this component's
              // own header comment) — every level ever completed is played
              // in order via the single "current" slot, so positions before
              // currentIndex are the ones actually walked. Purely a path-
              // color heuristic; each node's own `status` (not this index
              // comparison) decides that node's own rendering.
              const walked = currentIndex >= 0 && i < currentIndex;
              return (
                <View
                  key={i}
                  pointerEvents="none"
                  style={[
                    styles.pathSegment,
                    {
                      left: segment.x,
                      top: segment.y - PATH_STROKE_WIDTH / 2,
                      width: segment.length,
                      height: PATH_STROKE_WIDTH,
                      backgroundColor: walked ? secondaryAccent : border,
                      opacity: walked ? 0.9 : 0.6,
                      transform: [{ rotate: `${segment.angleDeg}deg` }],
                      transformOrigin: 'left center',
                    },
                  ]}
                />
              );
            })}

          {mapWidth > 0 &&
            levels.map((level, i) => (
              <LevelNode
                key={level.levelIndex}
                level={level}
                config={config}
                x={points[i].x}
                y={points[i].y}
                onPlayLevel={onPlayLevel}
              />
            ))}
        </ScrollView>
      </View>
    </View>
  );
}

function LevelNode({
  level,
  config,
  x,
  y,
  onPlayLevel,
}: {
  level: LevelMapRow;
  config: SkinConfig;
  x: number;
  y: number;
  onPlayLevel: (levelIndex: number) => void;
}) {
  const { panel, border, text, mutedText, accent, secondaryAccent } = config.palette;
  const isCompleted = level.status === 'completed';
  const isCurrent = level.status === 'current';
  const isLocked = level.status === 'locked';
  const diameter = isCurrent ? CURRENT_MEDALLION_DIAMETER : MEDALLION_DIAMETER;
  const radius = diameter / 2;

  // The medallion-sized box is always the FIRST flow child for a
  // locked/completed node, so its center lands exactly at `y` when the
  // wrapper's own top is `y - radius`. The current node's caption pill sits
  // above it in flow instead, so that same box is pushed down by
  // CAPTION_BLOCK_HEIGHT — subtracting it here keeps the medallion's center
  // at `y` regardless of state, which is what makes every path segment meet
  // each node dead-center.
  const wrapTop = y - radius - (isCurrent ? CAPTION_BLOCK_HEIGHT : 0);

  const content = (
    <>
      {isCurrent && (
        <View style={[styles.caption, { backgroundColor: panel, borderColor: border }]}>
          <Text style={[styles.captionText, { color: mutedText }]}>LEVEL {level.levelIndex}</Text>
        </View>
      )}

      <View style={{ width: diameter, height: diameter, alignItems: 'center', justifyContent: 'center' }}>
        {isCurrent && (
          <View
            style={[
              styles.glowHalo,
              {
                width: diameter + 26,
                height: diameter + 26,
                borderRadius: (diameter + 26) / 2,
                backgroundColor: `${GLOW}33`,
              },
            ]}
          />
        )}
        <View
          style={[
            styles.medallion,
            {
              width: diameter,
              height: diameter,
              borderRadius: radius,
              backgroundColor: isLocked ? `${border}66` : panel,
              borderColor: isCurrent ? GLOW : isCompleted ? secondaryAccent : border,
            },
          ]}
        >
          <Text style={[styles.levelNumber, { color: isLocked ? mutedText : text, fontSize: isCurrent ? 30 : 22 }]}>
            {level.levelIndex}
          </Text>
          {isCompleted && (
            <View style={[styles.checkBadge, { backgroundColor: secondaryAccent }]}>
              <Text style={styles.checkGlyph}>{'✓'}</Text>
            </View>
          )}
          {isLocked && (
            <View style={[styles.lockBadge, { backgroundColor: panel, borderColor: border }]}>
              <Text style={styles.lockGlyph}>{'🔒'}</Text>
            </View>
          )}
        </View>
      </View>

      {isCompleted && <StarRow stars={level.stars} filledColor={GLOW} emptyColor={border} />}

      {isCurrent && (
        <View style={[styles.playButton, { backgroundColor: accent }]}>
          <Text style={styles.playButtonLabel}>PLAY</Text>
        </View>
      )}
    </>
  );

  const wrapStyle = [styles.nodeWrap, { left: x - NODE_BOX_WIDTH / 2, top: wrapTop, width: NODE_BOX_WIDTH }];

  if (isLocked) {
    // Mirrors the old AllLevels.tsx row exactly: a locked level is visually
    // present but has no Pressable wrapper at all, so there's nothing to
    // tap — not just visually disabled.
    return <View style={wrapStyle}>{content}</View>;
  }

  return (
    <Pressable style={wrapStyle} onPress={() => onPlayLevel(level.levelIndex)}>
      {content}
    </Pressable>
  );
}

// A completed level with no persisted rating (any win recorded before this
// feature existed — see LevelMapRow.stars' own comment) shows every slot
// empty rather than guessing — an honest "unrated", not a fabricated 3.
function StarRow({ stars, filledColor, emptyColor }: { stars: StarRating | undefined; filledColor: string; emptyColor: string }) {
  return (
    <View style={styles.starRow}>
      {[1, 2, 3].map((slot) => (
        <Text key={slot} style={[styles.star, { color: stars != null && slot <= stars ? filledColor : emptyColor }]}>
          {'★'}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  headerTextBlock: {
    flex: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: -2,
  },
  title: {
    fontFamily: Fonts.headingBold,
    fontSize: 23,
    fontWeight: '700',
    lineHeight: 26,
  },
  statusLine: {
    fontFamily: Fonts.bodyRegular,
    fontSize: 12,
    marginTop: 1,
  },
  mapArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  pathSegment: {
    position: 'absolute',
    borderRadius: PATH_STROKE_WIDTH / 2,
  },
  nodeWrap: {
    position: 'absolute',
    alignItems: 'center',
  },
  caption: {
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderRadius: 999,
  },
  captionText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  glowHalo: {
    position: 'absolute',
  },
  medallion: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
  },
  levelNumber: {
    fontFamily: Fonts.headingBold,
    fontWeight: '700',
  },
  checkBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkGlyph: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  lockBadge: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockGlyph: {
    fontSize: 11,
  },
  starRow: {
    flexDirection: 'row',
    gap: 2,
    marginTop: 6,
  },
  star: {
    fontSize: 13,
  },
  playButton: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 999,
  },
  playButtonLabel: {
    fontFamily: Fonts.bodyBold,
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.6,
  },
});
