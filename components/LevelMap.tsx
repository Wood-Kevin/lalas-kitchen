import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, LayoutChangeEvent, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from './AppText';
import { SkinConfig } from './skinConfig';
import { GinghamTrim } from './GinghamTrim';
import { LivesBadge } from './LivesBadge';
import { LevelMapPath } from './LevelMapPath';
import { ResolvedSprite, resolveSpriteAsset, SpriteAssetMap } from './spriteAsset';
import { Fonts } from './fonts';
import { LevelStatus, LevelSummary } from './levelProgress';
import { StarRating } from './wonActions';
import {
  computeLevelMapCurveSegments,
  computeLevelMapNodePositions,
  computeLevelMapVisibleRange,
  computeScrollOffsetToCenter,
  levelMapContentHeight,
} from './levelMapLayout';

export interface LevelMapRow extends LevelSummary {
  status: LevelStatus;
  stars?: StarRating;
}

export interface LevelMapProps {
  config: SkinConfig;
  spriteAssets: SpriteAssetMap;
  levels: LevelMapRow[];
  completedCount: number;
  lives: number;
  onBack: () => void;
  onPlayLevel: (levelIndex: number) => void;
}

const GLOW = '#E3A43B';
const MEDALLION_DIAMETER = 74;
const CURRENT_MEDALLION_DIAMETER = 96;
const SIDE_INSET = 74;
const NODE_BOX_WIDTH = 156;
const PATH_STROKE_WIDTH = 14;
const PATH_SHADOW_WIDTH = 26;
const PATH_SHADOW_COLOR = '#A58B67';
const CAPTION_BLOCK_HEIGHT = 32;
const MAP_BOTTOM_PADDING = 180;

// How far beyond the raw viewport (in both directions) a node/segment/
// landmark stays mounted — see computeLevelMapVisibleRange's own doc
// comment for why this windowing exists at all. Generous relative to a
// typical phone viewport so SCROLL_EVENT_THROTTLE_MS's lag between updates
// never causes visible pop-in; still a small, bounded window regardless of
// how deep a save's level count grows.
const VISIBLE_RANGE_BUFFER = 900;
// A scroll-position listener doesn't need every frame — this only feeds the
// windowing range above, which already has a wide buffer built in to
// absorb the lag between updates.
const SCROLL_EVENT_THROTTLE_MS = 50;
// The background tile's own real pixel dimensions (skins/lalas-kitchen/
// sprites/levelmap-background-tile.webp is a 512x512 WebP) — see the
// background-tile render below for why this is hand-tiled instead of using
// Image's resizeMode="repeat".
const TILE_SIZE = 512;

const START_GATE_SPRITE = 'levelmap_garden_gate.webp';
const RECIPE_BOX_SPRITE = 'levelmap_recipe_box.webp';
const JOURNEY_LANDMARK_SPRITES = [
  'levelmap_lemon_basket.webp',
  'levelmap_herb_garden.webp',
  'levelmap_garlic_crate.webp',
  'levelmap_simmering_pot.webp',
] as const;

interface LandmarkPlacement {
  key: string;
  spritePath: string;
  xFraction: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
  title?: string;
  subtitle?: string;
}

function renderResolvedSprite(
  sprite: ResolvedSprite,
  style: object,
  resizeMode: 'contain' | 'cover' = 'contain'
) {
  if (sprite.kind === 'image') {
    return <Image source={sprite.source} style={style} resizeMode={resizeMode} />;
  }
  return (
    <View style={[style, styles.landmarkFallback]}>
      <Text style={styles.landmarkFallbackLabel}>{sprite.label}</Text>
    </View>
  );
}

function describeLevelNodeForAccessibility(level: LevelMapRow, isCompleted: boolean, isCurrent: boolean): string {
  const base = `Level ${level.levelIndex}: ${level.displayName}`;
  if (isCurrent) return `${base}, next level, play`;
  if (isCompleted) {
    return level.stars ? `${base}, completed, ${level.stars} of 3 stars` : `${base}, completed`;
  }
  return `${base}, locked`;
}

function buildLandmarkPlacements(
  levels: LevelMapRow[],
  points: Array<{ x: number; y: number }>,
  mapWidth: number,
  currentIndex: number,
  config: SkinConfig
): LandmarkPlacement[] {
  if (levels.length === 0 || mapWidth === 0) return [];

  const placements: LandmarkPlacement[] = [
    {
      key: 'start-gate',
      spritePath: START_GATE_SPRITE,
      xFraction: 0.18,
      y: Math.max(34, points[0].y - 126),
      width: 150,
      height: 184,
    },
  ];

  for (let i = 0; i < points.length - 1; i++) {
    const midpointY = (points[i].y + points[i + 1].y) / 2;
    placements.push({
      key: `journey-${i}`,
      spritePath: JOURNEY_LANDMARK_SPRITES[i % JOURNEY_LANDMARK_SPRITES.length],
      xFraction: i % 2 === 0 ? 0.78 : 0.22,
      y: midpointY - 26,
      width: i % 2 === 0 ? 124 : 138,
      height: i % 2 === 0 ? 98 : 110,
      opacity: currentIndex >= 0 && i > currentIndex + 1 ? 0.5 : 0.96,
    });
  }

  const currentLevelIndex = currentIndex >= 0 ? levels[currentIndex]?.levelIndex : undefined;
  const upcomingRecipeCard =
    currentLevelIndex == null
      ? undefined
      : config.recipeCards.find(
          (card) => card.milestoneLevel >= currentLevelIndex && levels.some((level) => level.levelIndex === card.milestoneLevel)
        );

  if (upcomingRecipeCard) {
    const recipePointIndex = levels.findIndex((level) => level.levelIndex === upcomingRecipeCard.milestoneLevel);
    if (recipePointIndex >= 0) {
      const recipePoint = points[recipePointIndex];
      placements.push({
        key: 'recipe-cue',
        spritePath: RECIPE_BOX_SPRITE,
        xFraction: recipePoint.x > mapWidth / 2 ? 0.22 : 0.78,
        y: recipePoint.y + 120,
        width: 124,
        height: 104,
        title: upcomingRecipeCard.milestoneLevel === currentLevelIndex ? 'Recipe reward' : 'Up next reward',
        subtitle: upcomingRecipeCard.title,
      });
    }
  }

  return placements;
}

export function LevelMap({ config, spriteAssets, levels, completedCount, lives, onBack, onPlayLevel }: LevelMapProps) {
  const { accent, panel, border, text, mutedText, secondaryAccent, background } = config.palette;
  const scrollRef = useRef<ScrollView>(null);
  const [mapWidth, setMapWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  // Tracks the actual scroll offset so rendering can window around it — see
  // computeLevelMapVisibleRange. Seeded to the same y the auto-scroll-to-
  // current-level effect below jumps to, not left at 0, so the window is
  // already correct on the very first frame instead of briefly showing the
  // top of the map before the real position is known.
  const [scrollY, setScrollY] = useState(0);

  const positions = useMemo(() => computeLevelMapNodePositions(levels.length), [levels.length]);
  const contentHeight = useMemo(() => levelMapContentHeight(levels.length) + MAP_BOTTOM_PADDING, [levels.length]);

  const usableWidth = Math.max(0, mapWidth - SIDE_INSET * 2);
  const points = useMemo(
    () => positions.map((position) => ({ x: SIDE_INSET + position.xFraction * usableWidth, y: position.y })),
    [positions, usableWidth]
  );
  const segments = useMemo(() => computeLevelMapCurveSegments(points), [points]);
  const currentIndex = levels.findIndex((level) => level.status === 'current');
  const landmarks = useMemo(
    () => buildLandmarkPlacements(levels, points, mapWidth, currentIndex, config),
    [levels, points, mapWidth, currentIndex, config]
  );

  // Which node indices are actually worth mounting right now — computed
  // from real, cheap position math over the FULL levels/points/segments
  // arrays above; only the render below uses this to slice down to a small
  // window, regardless of how many levels the save has completed. See
  // computeLevelMapVisibleRange's own doc comment for the real-device lag
  // this fixes.
  const visibleRange = useMemo(
    () => computeLevelMapVisibleRange(scrollY, viewportHeight, levels.length, VISIBLE_RANGE_BUFFER),
    [scrollY, viewportHeight, levels.length]
  );
  // A segment connects node i to node i+1, so the segment just before the
  // first visible node is still on-screen (its far end lands on a visible
  // node) — widen by one on the low side to cover it.
  const segmentRange = {
    startIndex: Math.max(0, visibleRange.startIndex - 1),
    endIndex: Math.min(segments.length, visibleRange.endIndex),
  };
  const visibleTop = scrollY - VISIBLE_RANGE_BUFFER;
  const visibleBottom = scrollY + viewportHeight + VISIBLE_RANGE_BUFFER;
  const visibleLandmarks = useMemo(
    () => landmarks.filter((landmark) => landmark.y + landmark.height / 2 >= visibleTop && landmark.y - landmark.height / 2 <= visibleBottom),
    [landmarks, visibleTop, visibleBottom]
  );

  useEffect(() => {
    if (mapWidth === 0 || viewportHeight === 0 || currentIndex < 0) return;
    const targetY = points[currentIndex]?.y ?? 0;
    const offset = computeScrollOffsetToCenter(targetY, viewportHeight);
    scrollRef.current?.scrollTo({ y: offset, animated: false });
    setScrollY(offset);
  }, [mapWidth, viewportHeight, currentIndex, points]);

  return (
    // Same top-to-bottom gradient as Board.tsx/Home.tsx over the identical
    // two palette stops — a flat fill was the one screen-background
    // inconsistency left after those two facelift passes (see
    // engine/DECISIONS.md's white-stripe entry, which flagged this rather
    // than assuming it was in scope at the time).
    <LinearGradient colors={background} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.container}>
      <GinghamTrim accentColor={accent} panelColor={panel} height={12} />

      <View style={styles.header}>
        <Pressable
          style={[styles.backButton, { backgroundColor: panel, borderColor: border }]}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to home"
        >
          <Text style={[styles.backArrow, { color: text }]} allowFontScaling={false}>
            {'<'}
          </Text>
        </Pressable>
        <View style={styles.headerTextBlock}>
          <Text style={[styles.title, { color: accent }]}>Level Map</Text>
          <Text style={[styles.statusLine, { color: mutedText }]}>
            {completedCount} cooked - keep the pot going
          </Text>
        </View>
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
          onScroll={(event) => setScrollY(event.nativeEvent.contentOffset.y)}
          scrollEventThrottle={SCROLL_EVENT_THROTTLE_MS}
        >
          {mapWidth > 0 &&
            (() => {
              const backgroundTile = resolveSpriteAsset('levelmap-background-tile.webp', spriteAssets);
              if (backgroundTile.kind !== 'image') return null;
              // A real device report (2026-08-11): this rendered correctly on
              // web but was entirely invisible on a real phone. `resizeMode=
              // "repeat"` was the ONLY use of that value anywhere in this
              // codebase — every other Image uses cover/contain — and RN
              // Web's Image maps "repeat" straight onto CSS
              // background-repeat, a mature browser primitive with no native
              // equivalent guarantee; React Native's own native Image
              // implementation has long-documented inconsistent/unreliable
              // "repeat" support, particularly on Android. Not confirmed by
              // attaching to a real device this session (none available),
              // but this matches the project's own established pattern of
              // RN Web silently papering over a native-only gap (the
              // board-background sizing bug, the react-native-svg web-bundle
              // break) closely enough that it's the clear leading
              // explanation, not a guess picked at random.
              //
              // Fix: hand-roll the tiling instead of trusting "repeat" at
              // all — the same "reproduce a built-in with plain Views/Images
              // when the primitive doesn't behave the same cross-platform"
              // convention GinghamTrim.tsx and LevelMapPath.web.tsx already
              // established. Tiles are TILE_SIZE (the asset's own real
              // 512x512 native pixels) laid out on a grid ANCHORED AT THE
              // CONTENT ORIGIN (row/col derived from absolute y/x, not from
              // scrollY), so the pattern never visibly seams or shifts as
              // the window below changes which tiles are actually mounted.
              // Windowed to the same visible y-range as everything else on
              // this screen (see VISIBLE_RANGE_BUFFER) rather than the full
              // contentHeight — a 94-level-deep map at a 512px tile size
              // would otherwise be well over a hundred unconditionally-
              // mounted tile images, the exact class of problem this
              // session's other Level Map fix already solved for nodes/
              // segments/landmarks.
              const firstRow = Math.max(0, Math.floor(visibleTop / TILE_SIZE));
              const lastRow = Math.max(firstRow, Math.ceil(visibleBottom / TILE_SIZE));
              const cols = Math.ceil(mapWidth / TILE_SIZE);
              const tiles = [];
              for (let row = firstRow; row <= lastRow; row++) {
                for (let col = 0; col < cols; col++) {
                  tiles.push(
                    <Image
                      key={`bg-${row}-${col}`}
                      source={backgroundTile.source}
                      style={{
                        position: 'absolute',
                        top: row * TILE_SIZE,
                        left: col * TILE_SIZE,
                        width: TILE_SIZE,
                        height: TILE_SIZE,
                      }}
                      resizeMode="stretch"
                      pointerEvents="none"
                    />
                  );
                }
              }
              return tiles;
            })()}

          {mapWidth > 0 &&
            visibleLandmarks.map((landmark) => {
              const sprite = resolveSpriteAsset(landmark.spritePath, spriteAssets);
              const left = mapWidth * landmark.xFraction - landmark.width / 2;
              return (
                <View
                  key={landmark.key}
                  pointerEvents="none"
                  style={[
                    styles.landmarkWrap,
                    {
                      left,
                      top: landmark.y - landmark.height / 2,
                      width: landmark.width,
                      opacity: landmark.opacity ?? 1,
                    },
                  ]}
                >
                  {renderResolvedSprite(sprite, { width: landmark.width, height: landmark.height })}
                  {landmark.title ? (
                    <View style={[styles.rewardTag, { backgroundColor: panel, borderColor: border }]}>
                      <Text style={[styles.rewardEyebrow, { color: secondaryAccent }]}>{landmark.title}</Text>
                      <Text style={[styles.rewardTitle, { color: text }]} numberOfLines={2}>
                        {landmark.subtitle}
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })}

          {mapWidth > 0 && (
            <LevelMapPath
              segments={segments
                .slice(segmentRange.startIndex, segmentRange.endIndex)
                .map((segment, i) => ({ segment, index: segmentRange.startIndex + i }))}
              mapWidth={mapWidth}
              contentHeight={contentHeight}
              currentIndex={currentIndex}
              walkedColor={secondaryAccent}
              litColor={GLOW}
              lockedColor={border}
              shadowColor={PATH_SHADOW_COLOR}
              strokeWidth={PATH_STROKE_WIDTH}
              shadowWidth={PATH_SHADOW_WIDTH}
            />
          )}

          {mapWidth > 0 &&
            levels.slice(visibleRange.startIndex, visibleRange.endIndex).map((level, offset) => {
              const i = visibleRange.startIndex + offset;
              return (
                <LevelNode
                  key={level.levelIndex}
                  level={level}
                  config={config}
                  x={points[i].x}
                  y={points[i].y}
                  isRecipeMilestone={config.recipeCards.some((card) => card.milestoneLevel === level.levelIndex)}
                  onPlayLevel={onPlayLevel}
                />
              );
            })}
        </ScrollView>
      </View>
    </LinearGradient>
  );
}

function LevelNode({
  level,
  config,
  x,
  y,
  isRecipeMilestone,
  onPlayLevel,
}: {
  level: LevelMapRow;
  config: SkinConfig;
  x: number;
  y: number;
  isRecipeMilestone: boolean;
  onPlayLevel: (levelIndex: number) => void;
}) {
  const { panel, border, text, mutedText, accent, secondaryAccent } = config.palette;
  const isCompleted = level.status === 'completed';
  const isCurrent = level.status === 'current';
  const isLocked = level.status === 'locked';
  const diameter = isCurrent ? CURRENT_MEDALLION_DIAMETER : MEDALLION_DIAMETER;
  const radius = diameter / 2;
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
                width: diameter + 30,
                height: diameter + 30,
                borderRadius: (diameter + 30) / 2,
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
              backgroundColor: isLocked ? `${border}55` : panel,
              borderColor: isCurrent ? GLOW : isCompleted ? secondaryAccent : border,
            },
          ]}
        >
          <Text
            style={[styles.levelNumber, { color: isLocked ? mutedText : text, fontSize: isCurrent ? 30 : 22 }]}
            allowFontScaling={false}
          >
            {level.levelIndex}
          </Text>
          {isCompleted && (
            <View style={[styles.checkBadge, { backgroundColor: secondaryAccent }]}>
              <Text style={styles.checkGlyph} allowFontScaling={false}>
                {'\u2713'}
              </Text>
            </View>
          )}
          {isLocked && (
            <View style={[styles.lockBadge, { backgroundColor: panel, borderColor: border }]}>
              <Text style={styles.lockGlyph} allowFontScaling={false}>
                {'\u{1F512}'}
              </Text>
            </View>
          )}
          {isRecipeMilestone && !isLocked && <View style={[styles.recipeDot, { backgroundColor: GLOW }]} />}
        </View>
      </View>

      {isCompleted && <StarRow stars={level.stars} filledColor={GLOW} emptyColor={border} />}

      {isCurrent && (
        <>
          <Text style={[styles.currentLevelName, { color: text }]} numberOfLines={1}>
            {level.displayName}
          </Text>
          <View style={[styles.playButton, { backgroundColor: accent }]}>
            <Text style={styles.playButtonLabel}>PLAY</Text>
          </View>
        </>
      )}
    </>
  );

  const wrapStyle = [styles.nodeWrap, { left: x - NODE_BOX_WIDTH / 2, top: wrapTop, width: NODE_BOX_WIDTH }];

  if (isLocked) {
    return <View style={wrapStyle}>{content}</View>;
  }

  return (
    <Pressable
      style={wrapStyle}
      onPress={() => onPlayLevel(level.levelIndex)}
      accessibilityRole="button"
      accessibilityLabel={describeLevelNodeForAccessibility(level, isCompleted, isCurrent)}
    >
      {content}
    </Pressable>
  );
}

function StarRow({ stars, filledColor, emptyColor }: { stars: StarRating | undefined; filledColor: string; emptyColor: string }) {
  return (
    <View style={styles.starRow}>
      {[1, 2, 3].map((slot) => (
        <Text key={slot} style={[styles.star, { color: stars != null && slot <= stars ? filledColor : emptyColor }]}>
          {'\u2605'}
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
    overflow: 'hidden',
  },
  scroll: {
    flex: 1,
  },
  landmarkWrap: {
    position: 'absolute',
    alignItems: 'center',
    gap: 8,
  },
  landmarkFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  landmarkFallbackLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: '#6E5C49',
  },
  rewardTag: {
    width: 122,
    borderWidth: 1.5,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 2,
  },
  rewardEyebrow: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  rewardTitle: {
    fontFamily: Fonts.headingBold,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 18,
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
    fontSize: 12,
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
  recipeDot: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  starRow: {
    flexDirection: 'row',
    gap: 2,
    marginTop: 6,
  },
  star: {
    fontSize: 13,
  },
  currentLevelName: {
    fontFamily: Fonts.headingBold,
    fontSize: 17,
    fontWeight: '700',
    marginTop: 8,
    textAlign: 'center',
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
