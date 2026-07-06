import React, { useEffect, useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { ResolvedSprite } from './spriteAsset';
import { BLOCKER_CLEAR_HIGHLIGHT_MS, SWEEP_GLOW_POP_MS } from './cascadeTiming';
import { resolveDragTarget } from './dragDirection';
import { StripeDirection } from '../engine/matrix';

export interface TileProps {
  pieceId: string;
  row: number;
  col: number;
  tileSize: number;
  sprite: ResolvedSprite;
  accentColor: string;
  panelColor: string;
  selected: boolean;
  durationMs: number;
  // Set only on the render where this piece first appears (a cascade
  // spawn). Read once, at mount, to make the tile animate down into place
  // instead of popping directly into its landing row — see
  // components/NOTES.md.
  enterFromRow?: number;
  // Present only for a striped piece — which line it will sweep when matched
  // ('row' = horizontal, 'col' = vertical). Drives the small corner badge
  // that replaces the visual signal the old stripe overlay used to carry (see
  // DirectionBadge). Undefined for every ordinary piece, so no badge renders.
  direction?: StripeDirection;
  // Set on the one ordinary cell a denial zone is about to spread into, for the
  // single move before the spread lands (see engine/gameState.ts's
  // stepDenialZone). Drives a calm "growing crack + dimming glow" overlay so the
  // spread is always something the player sees coming, never a silent, sudden
  // change — per CLAUDE.md's brief against unexplained effects. Undefined on
  // every other tile, and on every level without the dynamic spread mechanic.
  spreadWarning?: boolean;
  // Set only on a resting area bomb (engine type 'area_bomb'). Drives the calm,
  // continuously-looping powder wisp that drifts up from the tied top of the
  // bag, signalling "this is a volatile bundle" without competing with ordinary
  // tiles for attention (see PowderWispOverlay). Undefined/false on every other
  // piece, so no wisp renders. Presentation only — invisible to the engine.
  powderWisp?: boolean;
  // Set on exactly the two tiles engine/matrix.ts's findAnyLegalMove picked,
  // once Board.tsx's calm stuck-player timer decides the player has genuinely
  // stopped interacting (see components/stuckHintTiming.ts). Drives a slow
  // breathing glow — no dim wash, no crack, nothing urgent — since this is a
  // friendly nudge, not a warning (contrast SpreadWarningOverlay, which reuses
  // the same breathing mechanism for an actual hazard). Presentation only —
  // the engine has no notion of a "hinted" piece, and the tile underneath
  // stays fully tappable/draggable throughout.
  hint?: boolean;
  onPress: () => void;
  // --- Drag-to-swap (an addition alongside tap-to-select, never a
  // replacement) ---
  // Whether this tile is currently the neighbour a live drag is pointing at.
  // Board.tsx sets it from resolveDragDirection's output; drives the soft
  // destination highlight so the player sees the target before releasing.
  dragTargeted?: boolean;
  // Turns the pan gesture on/off. Off during overlays / non-in-progress
  // states so tiles can't be dragged when a move wouldn't be accepted anyway;
  // the tap Pressable is unaffected either way. Defaults to on.
  dragEnabled?: boolean;
  // Fires continuously while a drag is active, with the finger's total offset
  // from where it grabbed this tile (screen px). Board resolves it to a
  // targeted neighbour for the live highlight.
  onDragMove?: (dx: number, dy: number) => void;
  // Fires once on release, with the final offset. Board resolves it to a
  // neighbour and, if any, calls the same applyMove path a tap-swap uses.
  onDragEnd?: (dx: number, dy: number) => void;
  // Board's grid dimensions, plus the px distance a drag must travel to commit
  // (Board's tileSize * DRAG_SWAP_THRESHOLD_FRACTION). The release handler uses
  // these to answer, on the UI thread, "will this drag commit a swap?" — the
  // same question Board answers on the JS thread — so it knows whether the
  // committed slide will fold the finger-offset back to rest (it will, via the
  // position effect) or whether this tile must spring itself back instead.
  rows?: number;
  cols?: number;
  dragSwapThresholdPx?: number;
}

// A single animated board tile. Position is driven entirely by Reanimated
// shared values so a full cascade resolves on the UI thread, not via
// per-frame React state (see CLAUDE.md's testing/perf note on the JS
// bridge bottlenecking on a 15-piece cascade).
export function Tile({
  pieceId,
  row,
  col,
  tileSize,
  sprite,
  accentColor,
  panelColor,
  selected,
  durationMs,
  enterFromRow,
  direction,
  spreadWarning,
  powderWisp,
  hint,
  onPress,
  dragTargeted,
  dragEnabled = true,
  onDragMove,
  onDragEnd,
  rows = 0,
  cols = 0,
  dragSwapThresholdPx = 0,
}: TileProps) {
  const rowShared = useSharedValue(enterFromRow ?? row);
  const colShared = useSharedValue(col);
  const opacity = useSharedValue(enterFromRow !== undefined ? 0 : 1);
  // Live finger-follow offset while this tile is being dragged. Layered as a
  // transform on top of the row/col position, so the grid layout is untouched
  // and the tile springs back to 0 on release; a committed swap then animates
  // via the normal row/col path once Board applies the move.
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);

  useEffect(() => {
    rowShared.value = withTiming(row, { duration: durationMs });
    colShared.value = withTiming(col, { duration: durationMs });
    opacity.value = withTiming(1, { duration: durationMs });
    // Fold any live drag offset back to rest on the SAME clock as the row/col
    // slide above. When a drag commits a swap, this tile re-renders with its new
    // cell, so the grid slide and the finger-offset decay start on the same
    // frame with the same duration/easing — their sum stays monotonic, and the
    // tile flows continuously from where the finger left it straight to its
    // landing cell. This is the fix for the drag "jump": previously the offset
    // decayed on its own DRAG_RETURN_MS clock (see onFinalize) that started a
    // few frames earlier than the grid slide, so the tile briefly retreated
    // toward its origin before sliding out to the destination. A no-op (0 → 0)
    // on every non-drag render, which is every render for a tapped swap.
    dragX.value = withTiming(0, { duration: durationMs });
    dragY.value = withTiming(0, { duration: durationMs });
    // Only the target position/duration should retrigger the animation —
    // reanimated shared values are stable across renders by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, col, durationMs]);

  // A pan that only activates after a few px of travel, so a plain tap never
  // triggers it and falls straight through to the Pressable below — that's
  // what keeps tap-to-select fully intact. onUpdate/onEnd run on the UI
  // thread; the finger-follow is set there directly, and the target/commit
  // decisions hop to JS via runOnJS since they touch React state / applyMove.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(dragEnabled)
        // Activation slop: below this a touch is a tap, above it a drag. Kept
        // well under the swap threshold Board applies at release, so the tile
        // starts following the finger before the swap is committed.
        .minDistance(DRAG_ACTIVATION_SLOP)
        .onUpdate((event) => {
          'worklet';
          // Clamp the follow so a long drag only ever peeks one tile toward
          // the neighbour instead of sliding across the whole board.
          const clamp = tileSize;
          dragX.value = Math.max(-clamp, Math.min(clamp, event.translationX));
          dragY.value = Math.max(-clamp, Math.min(clamp, event.translationY));
          if (onDragMove) runOnJS(onDragMove)(event.translationX, event.translationY);
        })
        .onEnd((event) => {
          'worklet';
          if (onDragEnd) runOnJS(onDragEnd)(event.translationX, event.translationY);
        })
        .onFinalize((event) => {
          'worklet';
          // Does this release resolve to a real, in-bounds neighbour? If so a
          // swap is about to commit (or, if illegal, snap back) — either way the
          // tile re-renders and the position effect folds this offset back to
          // rest on the grid slide's own clock. Starting a competing decay here
          // would put the follow-offset and the committed slide on two different
          // clocks again — the exact jump this change removes — so we leave the
          // offset untouched and let the re-render carry it home.
          //
          // Only when the drag resolved to nothing (below threshold or off the
          // board edge) does Board make no move and nothing re-renders, so this
          // is the one case where the tile must spring itself back. Same origin
          // cell the grid slide reads from: rowShared/colShared are at rest on
          // an integer cell here, since a drag can only start when no animation
          // is in flight (see Board's dragEnabled). resolveDragTarget is the same
          // decision Board.dragNeighbor makes; a non-null target means a swap
          // commits and re-renders (position effect folds the offset), so we skip.
          const target = resolveDragTarget(
            event.translationX,
            event.translationY,
            { row: Math.round(rowShared.value), col: Math.round(colShared.value) },
            rows,
            cols,
            dragSwapThresholdPx
          );
          if (!target) {
            dragX.value = withTiming(0, { duration: DRAG_RETURN_MS });
            dragY.value = withTiming(0, { duration: DRAG_RETURN_MS });
          }
        }),
    [dragEnabled, tileSize, onDragMove, onDragEnd, dragX, dragY, rowShared, colShared, rows, cols, dragSwapThresholdPx]
  );

  const animatedStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    top: rowShared.value * tileSize,
    left: colShared.value * tileSize,
    width: tileSize,
    height: tileSize,
    opacity: opacity.value,
    transform: [{ translateX: dragX.value }, { translateY: dragY.value }],
    // Lift the actively-dragged tile above its neighbours so its follow-offset
    // is never occluded by an adjacent tile.
    zIndex: dragX.value !== 0 || dragY.value !== 0 ? 2 : 0,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={animatedStyle} testID={`tile-${pieceId}`}>
        <Pressable
          onPress={onPress}
          style={[
            styles.tile,
            {
              backgroundColor: panelColor,
              borderColor: accentColor,
              borderWidth: selected || dragTargeted ? 3 : 1,
            },
          ]}
        >
          <SpriteContent sprite={sprite} accentColor={accentColor} />
          {direction && (
            <DirectionBadge
              direction={direction}
              tileSize={tileSize}
              accentColor={accentColor}
              panelColor={panelColor}
            />
          )}
          {dragTargeted && (
            // Soft accent wash marking this tile as the drag's destination —
            // the same calm, full-tile overlay language the blocker/sweep
            // highlights use (no ring or particle), just shown live during a
            // drag instead of on a clear. pointerEvents none so it never
            // interferes with the gesture.
            <View
              pointerEvents="none"
              testID={`drag-target-${pieceId}`}
              style={[styles.dragTargetHighlight, { backgroundColor: accentColor }]}
            />
          )}
          {spreadWarning && <SpreadWarningOverlay tileSize={tileSize} accentColor={accentColor} />}
          {powderWisp && <PowderWispOverlay tileSize={tileSize} />}
          {hint && <HintGlowOverlay accentColor={accentColor} />}
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

// How far a finger must travel before a touch is treated as a drag rather than
// a tap. Small, so dragging feels responsive; anything shorter stays a tap and
// reaches the Pressable untouched.
const DRAG_ACTIVATION_SLOP = 6;
// How long the follow-offset takes to ease back to rest on release.
const DRAG_RETURN_MS = 120;

// The small corner badge that tells a player, at a glance, whether a striped
// piece will sweep its row or its column before they commit the move. It
// exists because dedicated striped art replaced the old full-tile stripe
// overlay that used to carry this direction cue implicitly; the engine still
// enforces the real direction (gameState.ts's resolveCascades), this just
// makes it visible again. Deliberately small and informational — a single
// double-headed arrow (↔ horizontal for a row sweep, ↕ vertical for a column
// sweep), not a celebratory effect — per CLAUDE.md's calm-not-frantic rule.
// Sits above the sprite and renders identically whether the sprite is
// dedicated art or the text-label placeholder, since it's layered over
// SpriteContent rather than baked into either path. pointerEvents="none" so
// it never steals the tile's tap.
function DirectionBadge({
  direction,
  tileSize,
  accentColor,
  panelColor,
}: {
  direction: StripeDirection;
  tileSize: number;
  accentColor: string;
  panelColor: string;
}) {
  // Scale with the tile so it stays a consistent, small fraction of the piece
  // across screen sizes, with a floor so it can't shrink below legibility on
  // a very small board.
  const badgeSize = Math.max(14, Math.round(tileSize * 0.32));
  const glyph = direction === 'row' ? '↔' : '↕';
  return (
    <View
      pointerEvents="none"
      testID={`direction-badge-${direction}`}
      style={[
        styles.directionBadge,
        {
          width: badgeSize,
          height: badgeSize,
          borderRadius: badgeSize / 2,
          backgroundColor: panelColor,
          borderColor: accentColor,
        },
      ]}
    >
      <Text
        style={[styles.directionGlyph, { color: accentColor, fontSize: Math.round(badgeSize * 0.7) }]}
      >
        {glyph}
      </Text>
    </View>
  );
}

// How long one breath of the warning glow takes (fade up, fade down). Slow and
// gentle on purpose — a calm "this is coming" pulse, not an urgent flashing
// alarm, per CLAUDE.md's calm-not-frantic brief for this specific player.
const SPREAD_WARNING_PULSE_MS = 900;

// The visible warning that a denial zone is about to spread INTO this cell,
// shown for the one move before the spread lands. Combines the two cues
// CLAUDE.md's brief names — a "dimming glow" (a steady dark wash, so the cell
// visibly reads as being consumed) and a "growing crack" (a thin diagonal
// fissure in the accent color) — plus a slow accent breath over the top so the
// warning gently pulses rather than sitting inert. The dark wash and the crack
// are steady (not opacity-animated), so a still screenshot always shows the
// warning unambiguously regardless of where the breath is in its cycle.
// pointerEvents none throughout: the warned cell is still an ordinary, tappable,
// matchable piece (matching it is how a player defuses the spread), so the
// overlay must never intercept the gesture.
function SpreadWarningOverlay({
  tileSize,
  accentColor,
}: {
  tileSize: number;
  accentColor: string;
}) {
  const breath = useSharedValue(0.18);
  useEffect(() => {
    breath.value = withRepeat(
      withTiming(0.5, { duration: SPREAD_WARNING_PULSE_MS }),
      -1,
      true
    );
  }, [breath]);
  const breathStyle = useAnimatedStyle(() => ({ opacity: breath.value }));

  // A single thin diagonal bar reads as a crack/fissure across the tile. Scales
  // with the tile so it stays a consistent fraction across screen sizes.
  const crackWidth = Math.max(2, Math.round(tileSize * 0.05));
  const crackLength = Math.round(tileSize * 0.62);

  return (
    <View pointerEvents="none" testID="spread-warning" style={styles.spreadWarningFill}>
      <View style={styles.spreadWarningDim} />
      <Animated.View
        style={[styles.spreadWarningGlow, { backgroundColor: accentColor }, breathStyle]}
      />
      <View
        style={[
          styles.spreadCrack,
          {
            width: crackWidth,
            height: crackLength,
            backgroundColor: accentColor,
          },
        ]}
      />
    </View>
  );
}

// The calm stuck-player hint's timing knob — see Board.tsx's HINT_IDLE_MS for
// how long the player must be genuinely quiet before this ever mounts. A
// separate constant from SPREAD_WARNING_PULSE_MS (same value today) rather
// than sharing one: these are two different features whose pacing might need
// to diverge later, and nothing here should couple their tuning by accident.
const HINT_GLOW_PULSE_MS = 900;

// Reuses SpreadWarningOverlay's exact breathing mechanism (a looped opacity
// ramp, withRepeat + withTiming reversing) — the same calm visual language —
// but deliberately drops that overlay's dark dimming wash and crack: those
// read as "something bad is about to happen to this cell," which is the
// opposite of what a friendly nudge should feel like. This is just a soft,
// slow glow: no flashing arrow, no urgency, nothing that reads as "hurry up."
// pointerEvents none, same reasoning as every other tile overlay — the hinted
// tile stays fully tappable/draggable underneath.
function HintGlowOverlay({ accentColor }: { accentColor: string }) {
  const breath = useSharedValue(0.15);
  useEffect(() => {
    breath.value = withRepeat(withTiming(0.4, { duration: HINT_GLOW_PULSE_MS }), -1, true);
  }, [breath]);
  const breathStyle = useAnimatedStyle(() => ({ opacity: breath.value }));

  return (
    <View pointerEvents="none" testID="hint-glow" style={styles.hintFill}>
      <Animated.View style={[styles.hintGlow, { backgroundColor: accentColor }, breathStyle]} />
    </View>
  );
}

// One calm loop of a single powder wisp drifting up from the bag's tied top.
// Matches SteamWisp's established wisp motion exactly — a rise-and-fade cycle
// (opacity envelope + upward translate, no scale spike, no burst) so the area
// bomb's ambient effect reads as a sibling of the app's other wisps rather
// than a new visual language. Reusing SteamWisp's 1800ms/Easing.out(quad)
// pacing is deliberate: per the brief, no unchecked new timing.
const POWDER_WISP_CYCLE_MS = 1800;
// The soft pale-tan of every wisp in this app (WonOverlay/PausedOverlay steam,
// via SteamWisp). Reused so powder and steam read as the same calm material.
const POWDER_WISP_COLOR = '#E9D9AE';

function PowderWisp({
  tileSize,
  delayMs,
  offsetX,
}: {
  tileSize: number;
  delayMs: number;
  offsetX: number;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(
      delayMs,
      withRepeat(
        withSequence(
          withTiming(1, { duration: POWDER_WISP_CYCLE_MS, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 0 })
        ),
        -1,
        false
      )
    );
  }, [delayMs, progress]);

  // Same envelope shape SteamWisp uses: fade in over the first ~15% of the
  // cycle, then fade out across the rest while drifting upward. Scaled to the
  // tile so the drift stays a small, consistent fraction of the piece on any
  // board size — the wisp rises about a third of a tile and never leaves the
  // cell's airspace, keeping it subtle.
  const rise = tileSize * 0.34;
  const animatedStyle = useAnimatedStyle(() => ({
    opacity:
      (progress.value < 0.15
        ? progress.value / 0.15
        : 1 - (progress.value - 0.15) / 0.85) * 0.7,
    transform: [{ translateY: -rise * progress.value }],
  }));

  const wispWidth = Math.max(2, Math.round(tileSize * 0.09));
  const wispHeight = Math.max(6, Math.round(tileSize * 0.26));
  // Both wisps are absolutely positioned so they share the bag-knot anchor
  // (top-centre) and rise independently, overlapping in the air; offsetX gives
  // them a small horizontal separation so the drift reads as a natural plume,
  // not a single bar. Left/top are px from the tile's own box.
  return (
    <Animated.View
      style={[
        styles.powderWisp,
        {
          width: wispWidth,
          height: wispHeight,
          borderRadius: wispWidth,
          backgroundColor: POWDER_WISP_COLOR,
          top: Math.round(tileSize * 0.14),
          left: Math.round(tileSize / 2 - wispWidth / 2 + offsetX),
        },
        animatedStyle,
      ]}
    />
  );
}

// The area bomb's ambient effect: a soft wisp of powder drifting gently and
// continuously up from the tied top of the bag while it rests unmatched on the
// board. Two wisps on a half-cycle stagger so there is always some powder in
// the air (the "continuous" part) without either wisp being large or fast
// enough to compete with ordinary tiles — per CLAUDE.md's calm-not-frantic,
// plays-with-sound-off brief. Anchored near the top-centre of the tile (the
// bag's knot) and pointerEvents none so it never touches the piece's gesture.
function PowderWispOverlay({ tileSize }: { tileSize: number }) {
  const spread = tileSize * 0.07;
  return (
    <View pointerEvents="none" testID="powder-wisp" style={styles.powderWispFill}>
      <PowderWisp tileSize={tileSize} delayMs={0} offsetX={-spread} />
      <PowderWisp tileSize={tileSize} delayMs={POWDER_WISP_CYCLE_MS / 2} offsetX={spread} />
    </View>
  );
}

export interface ExitingTileProps {
  pieceId: string;
  row: number;
  col: number;
  tileSize: number;
  sprite: ResolvedSprite;
  accentColor: string;
  panelColor: string;
  durationMs: number;
  // True when this piece is a blocker cleared by adjacent-match damage
  // (engine/matrix.ts's applyAdjacentDamage) rather than a direct match —
  // set by Board.tsx purely from diffBoards' existing `cleared` list
  // filtered by piece.type, no new engine data. See
  // BLOCKER_CLEAR_HIGHLIGHT_MS's comment for why this needs its own beat.
  isBlockerClear?: boolean;
  // Present only for a tile swept by a striped piece's row/column clear — how
  // long this tile waits, after the pass begins, before it brightens and pops.
  // Board.tsx derives it from the tile's distance to the striped piece (see
  // sweepAnimation.ts), so a larger value = further down the line = later, which
  // is what makes the glow read as a beam travelling rather than a flat wash.
  // Undefined for an ordinary match cell, which clears immediately as before.
  sweepDelayMs?: number;
  // True when this exiting piece is a detonating area bomb (engine type
  // 'area_bomb' — it lands in diff.cleared, carrying its type, whenever it
  // fires its 3×3 blast). Drives the powder poof that puffs outward from the
  // bag as it clears, so the burst visibly reads as the cause of the
  // surrounding 3×3 clearing rather than an unrelated flourish. Derived the
  // same way isBlockerClear is (piece.type check), no new engine data.
  isPowderBurst?: boolean;
  onExited: () => void;
}

// A piece that just matched. Plays a calm pop-and-shrink (per the
// lalas-kitchen config's matchStyle) and unmounts itself once the
// animation finishes — deliberately no particle burst or flash, per
// CLAUDE.md's "calm, not frantic" design constraint.
export function ExitingTile({
  pieceId,
  row,
  col,
  tileSize,
  sprite,
  accentColor,
  panelColor,
  durationMs,
  isBlockerClear,
  sweepDelayMs,
  isPowderBurst,
  onExited,
}: ExitingTileProps) {
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);
  // Animates for a blocker clear or a striped sweep; stays at 0 (invisible)
  // for an ordinary match cell.
  const highlightOpacity = useSharedValue(0);
  // The powder-poof cloud for a detonating area bomb — a soft cloud that
  // expands past the tile and fades as the bag clears. Its own shared values,
  // kept off the bag's shrink transform (the cloud lives in a sibling view, so
  // it grows outward while the bag shrinks away underneath it). At rest for
  // every non-area-bomb exit.
  const burstScale = useSharedValue(0.4);
  const burstOpacity = useSharedValue(0);

  useEffect(() => {
    if (isPowderBurst) {
      // Puff outward from the bag on the same clock as the clear (durationMs):
      // a quick swell to full, then an ease-out expansion past the tile's
      // bounds into the 3×3 it's about to clear, fading as it grows. One soft
      // cloud, no particles/flash — per CLAUDE.md's calm-not-frantic brief and
      // the blocker/sweep overlays' soft-wash language. Starts at the front of
      // the clear so the burst reads as the cause, not an afterthought.
      burstOpacity.value = withSequence(
        withTiming(0.85, { duration: Math.round(durationMs * 0.25) }),
        withTiming(0, { duration: Math.round(durationMs * 0.75) })
      );
      burstScale.value = withTiming(2.1, {
        duration: durationMs,
        easing: Easing.out(Easing.quad),
      });
      // Fall through to the ordinary pop-and-shrink below for the bag sprite
      // itself — an area bomb is never a blocker or a swept tile.
    }
    if (sweepDelayMs !== undefined) {
      // A striped sweep tile: sit still until the beam reaches it (sweepDelayMs),
      // then brighten-and-swell (the "pop"), then shrink away like any cleared
      // tile. Staggering these delays down the line is what makes the glow read
      // as travelling. The pop + shrink together still total durationMs, so a
      // swept tile takes exactly the normal clear time *after* the beam arrives
      // — the stagger adds the travel, not extra intensity (see CLAUDE.md's
      // calm-not-frantic constraint and SWEEP_TILE_STAGGER_MS's rationale).
      const shrinkMs = Math.max(0, durationMs - SWEEP_GLOW_POP_MS);
      highlightOpacity.value = withDelay(
        sweepDelayMs,
        withSequence(
          withTiming(0.5, { duration: SWEEP_GLOW_POP_MS }),
          withTiming(0, { duration: shrinkMs })
        )
      );
      scale.value = withDelay(
        sweepDelayMs,
        withSequence(
          withTiming(1.15, { duration: SWEEP_GLOW_POP_MS }),
          withTiming(0, { duration: shrinkMs })
        )
      );
      // Hold fully opaque through the brighten so the pop is visible on a solid
      // tile, then fade during the shrink.
      opacity.value = withDelay(
        sweepDelayMs + SWEEP_GLOW_POP_MS,
        withTiming(0, { duration: shrinkMs })
      );
      const timeout = setTimeout(onExited, sweepDelayMs + durationMs);
      return () => clearTimeout(timeout);
    }
    if (isBlockerClear) {
      const halfPulse = BLOCKER_CLEAR_HIGHLIGHT_MS / 2;
      // A brief glow-and-pop draws the eye here first, then the same
      // pop-and-shrink every other cleared tile gets — so a blocker cleared
      // several cascade steps from the player's tap still reads as "this
      // just got hit" instead of vanishing with no explanation.
      highlightOpacity.value = withSequence(
        withTiming(0.35, { duration: halfPulse }),
        withTiming(0, { duration: halfPulse })
      );
      scale.value = withSequence(
        withTiming(1.18, { duration: halfPulse }),
        withTiming(1, { duration: halfPulse }),
        withTiming(0, { duration: durationMs })
      );
      opacity.value = withDelay(BLOCKER_CLEAR_HIGHLIGHT_MS, withTiming(0, { duration: durationMs }));
      const timeout = setTimeout(onExited, BLOCKER_CLEAR_HIGHLIGHT_MS + durationMs);
      return () => clearTimeout(timeout);
    }
    opacity.value = withTiming(0, { duration: durationMs });
    scale.value = withTiming(0, { duration: durationMs });
    const timeout = setTimeout(onExited, durationMs);
    return () => clearTimeout(timeout);
    // Runs once on mount — an exiting tile never changes position, duration,
    // or its blocker-clear flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    top: row * tileSize,
    left: col * tileSize,
    width: tileSize,
    height: tileSize,
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const highlightStyle = useAnimatedStyle(() => ({
    opacity: highlightOpacity.value,
  }));

  // The poof lives in a SEPARATE positioned view, not inside the tile above —
  // the tile's own transform shrinks the bag to 0, and the cloud must instead
  // grow outward while that happens. Scales about the cell's centre, so it
  // expands symmetrically into the surrounding 3×3.
  const burstStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    top: row * tileSize,
    left: col * tileSize,
    width: tileSize,
    height: tileSize,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: burstOpacity.value,
    transform: [{ scale: burstScale.value }],
  }));

  return (
    <>
      <Animated.View style={animatedStyle} pointerEvents="none" testID={`exiting-${pieceId}`}>
        <Animated.View style={[styles.tile, { backgroundColor: panelColor, borderColor: accentColor }]}>
          <SpriteContent sprite={sprite} accentColor={accentColor} />
          {isBlockerClear && (
            <Animated.View
              style={[styles.blockerHighlight, { backgroundColor: accentColor }, highlightStyle]}
              testID={`blocker-highlight-${pieceId}`}
            />
          )}
          {sweepDelayMs !== undefined && (
            <Animated.View
              style={[styles.sweepGlow, { backgroundColor: accentColor }, highlightStyle]}
              testID={`sweep-glow-${pieceId}`}
            />
          )}
        </Animated.View>
      </Animated.View>
      {isPowderBurst && (
        <Animated.View style={burstStyle} pointerEvents="none" testID={`powder-burst-${pieceId}`}>
          <View
            style={[
              styles.powderBurstCloud,
              {
                width: tileSize,
                height: tileSize,
                borderRadius: tileSize / 2,
                backgroundColor: POWDER_WISP_COLOR,
              },
            ]}
          />
        </Animated.View>
      )}
    </>
  );
}

// Shared by Tile and ExitingTile so there's exactly one place that decides
// between an image and the text-label fallback — driven entirely by
// resolveSpriteAsset()'s output, never by which piece is being drawn.
function SpriteContent({ sprite, accentColor }: { sprite: ResolvedSprite; accentColor: string }) {
  if (sprite.kind === 'image') {
    return <Image source={sprite.source} style={styles.image} resizeMode="contain" />;
  }
  return <Text style={[styles.label, { color: accentColor }]}>{sprite.label}</Text>;
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    margin: 2,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Soft color wash over the whole tile, faded in/out by highlightOpacity —
  // deliberately a plain overlay (no ring/border/particle shape) to stay
  // inside CLAUDE.md's "calm, not frantic" constraint.
  blockerHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
  },
  // The traveling sweep's per-tile glow — same soft, full-tile accent wash as
  // the blocker highlight (a plain overlay, no ring/particle shape, per
  // CLAUDE.md's calm-not-frantic rule), peaked a touch brighter so the beam
  // carries more visual weight as it passes. Its own style rather than reusing
  // blockerHighlight so the two effects can be tuned independently later.
  sweepGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
  },
  // Live drag-destination wash — same soft, full-tile accent overlay as the
  // clear-time highlights, held at a low opacity so the target reads clearly
  // without competing with the pieces (per CLAUDE.md's calm-not-frantic rule).
  dragTargetHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
    opacity: 0.28,
  },
  // The spread warning's layers. A full-tile container that centers the crack;
  // a steady dark "dimming" wash so the doomed cell reads as shadowed; a slow
  // breathing accent glow above it; and a thin diagonal crack line. The dim +
  // crack are steady so a still frame always shows the warning.
  spreadWarningFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spreadWarningDim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.32)',
  },
  spreadWarningGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
  },
  spreadCrack: {
    borderRadius: 2,
    opacity: 0.85,
    transform: [{ rotate: '24deg' }],
  },
  // The stuck-player hint's layers — a full-tile container plus a single
  // breathing glow wash, deliberately just these two (no dim, no crack) so it
  // reads as a soft highlight rather than a warning.
  hintFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
  },
  // The powder-wisp overlay's container — a plain full-tile frame the two
  // absolutely-positioned wisps anchor inside. No layout of its own; each wisp
  // carries its own top/left.
  powderWispFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
  },
  // A single soft powder wisp — a small rounded pale-tan sliver, opacity/
  // position animated only (no scale spike), the same calm material as
  // SteamWisp. Absolutely positioned so it and its sibling share the knot
  // anchor and overlap as they rise.
  powderWisp: {
    position: 'absolute',
  },
  // The detonation poof — one soft round pale-tan cloud (same powder material
  // as the wisp), sized to the tile and scaled outward by burstStyle into the
  // 3×3 it clears. A plain soft disc, no ring/particles, per the calm brief.
  powderBurstCloud: {
    opacity: 0.75,
  },
  label: {
    fontSize: 20,
    fontWeight: '600',
  },
  image: {
    width: '80%',
    height: '80%',
  },
  // Pinned to the top-right corner so it sits clear of the sprite's centered
  // artwork. A bordered pill in the same panel/accent pairing the tile itself
  // uses, so it reads as part of the established chrome rather than a new
  // visual language.
  directionBadge: {
    position: 'absolute',
    top: 3,
    right: 3,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  directionGlyph: {
    fontWeight: '700',
    textAlign: 'center',
  },
});
