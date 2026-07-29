import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, LayoutChangeEvent, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import { SkinConfig } from './skinConfig';
import { GinghamTrim } from './GinghamTrim';
import { LivesBadge } from './LivesBadge';
import { ResolvedSprite, resolveSpriteAsset, SpriteAssetMap } from './spriteAsset';
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
const CAPTION_BLOCK_HEIGHT = 32;
const MAP_BOTTOM_PADDING = 180;

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

  const positions = useMemo(() => computeLevelMapNodePositions(levels.length), [levels.length]);
  const contentHeight = useMemo(() => levelMapContentHeight(levels.length) + MAP_BOTTOM_PADDING, [levels.length]);

  const usableWidth = Math.max(0, mapWidth - SIDE_INSET * 2);
  const points = useMemo(
    () => positions.map((position) => ({ x: SIDE_INSET + position.xFraction * usableWidth, y: position.y })),
    [positions, usableWidth]
  );
  const segments = useMemo(() => computeLevelMapPathSegments(points), [points]);
  const currentIndex = levels.findIndex((level) => level.status === 'current');
  const landmarks = useMemo(
    () => buildLandmarkPlacements(levels, points, mapWidth, currentIndex, config),
    [levels, points, mapWidth, currentIndex, config]
  );

  useEffect(() => {
    if (mapWidth === 0 || viewportHeight === 0 || currentIndex < 0) return;
    const targetY = points[currentIndex]?.y ?? 0;
    scrollRef.current?.scrollTo({ y: computeScrollOffsetToCenter(targetY, viewportHeight), animated: false });
  }, [mapWidth, viewportHeight, currentIndex, points]);

  return (
    <View style={[styles.container, { backgroundColor: background[0] }]}>
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
        <View pointerEvents="none" style={[styles.mapGlowTop, { backgroundColor: `${panel}99` }]} />
        <View pointerEvents="none" style={[styles.mapGlowBottom, { backgroundColor: `${panel}66` }]} />

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={{ height: contentHeight }}
          showsVerticalScrollIndicator={false}
        >
          {mapWidth > 0 &&
            landmarks.map((landmark) => {
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

          {mapWidth > 0 &&
            segments.map((segment, i) => {
              const walked = currentIndex >= 0 && i < currentIndex;
              const lit = currentIndex >= 0 && (i === currentIndex - 1 || i === currentIndex);
              return (
                <React.Fragment key={`segment-${i}`}>
                  <View
                    pointerEvents="none"
                    style={[
                      styles.pathShadowSegment,
                      {
                        left: segment.x,
                        top: segment.y - PATH_SHADOW_WIDTH / 2,
                        width: segment.length,
                        height: PATH_SHADOW_WIDTH,
                        opacity: walked || lit ? 0.34 : 0.16,
                        transform: [{ rotate: `${segment.angleDeg}deg` }],
                        transformOrigin: 'left center',
                      },
                    ]}
                  />
                  <View
                    pointerEvents="none"
                    style={[
                      styles.pathSegment,
                      {
                        left: segment.x,
                        top: segment.y - PATH_STROKE_WIDTH / 2,
                        width: segment.length,
                        height: PATH_STROKE_WIDTH,
                        backgroundColor: walked ? secondaryAccent : lit ? GLOW : border,
                        opacity: walked ? 0.92 : lit ? 0.9 : 0.62,
                        transform: [{ rotate: `${segment.angleDeg}deg` }],
                        transformOrigin: 'left center',
                      },
                    ]}
                  />
                </React.Fragment>
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
                isRecipeMilestone={config.recipeCards.some((card) => card.milestoneLevel === level.levelIndex)}
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
  mapGlowTop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 88,
    zIndex: 1,
  },
  mapGlowBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 140,
    zIndex: 1,
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
  pathShadowSegment: {
    position: 'absolute',
    borderRadius: PATH_SHADOW_WIDTH / 2,
    backgroundColor: '#A58B67',
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
