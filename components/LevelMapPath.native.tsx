import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { curveSegmentToPathD, LevelMapCurveSegment } from './levelMapLayout';

export interface LevelMapPathSegmentEntry {
  segment: LevelMapCurveSegment;
  // The segment's own absolute index into the FULL segments array — not its
  // position in `segments` below, which may be a windowed slice (see
  // LevelMap.tsx's segmentRange). walked/lit color decisions compare this
  // against currentIndex, which is itself an absolute index, so using the
  // slice position here would miscolor every segment once windowing trims
  // anything before it.
  index: number;
}

export interface LevelMapPathProps {
  segments: LevelMapPathSegmentEntry[];
  mapWidth: number;
  contentHeight: number;
  currentIndex: number;
  walkedColor: string;
  litColor: string;
  lockedColor: string;
  shadowColor: string;
  strokeWidth: number;
  shadowWidth: number;
}

// A real crash, caught live on a real Android device for the first time
// (2026-08-11) — this file's original version wrapped every segment in ONE
// <Svg width={mapWidth} height={contentHeight}>. contentHeight grows
// unboundedly with a save's total level count (NODE_SPACING_Y=230px/level,
// no windowing — see levelMapLayout.ts), so a save with meaningful play
// history produces a single SVG canvas tens of thousands of CSS px tall —
// and react-native-svg rasterizes that as one real bitmap, at real device
// pixel density (2-3x on a modern phone), which blew past Android's
// available texture/bitmap memory and force-closed the app with no JS
// error (a native-level crash bypasses ErrorBoundary entirely, which is
// exactly what the field report showed: force-close, no error screen).
// This was disclosed as "never confirmed on a real device" when the true-
// curve rendering was first built — that gap is exactly where this lived.
//
// Fix: one small <Svg> PER SEGMENT instead of one giant one. Each segment's
// own d-string keeps its real, unmodified absolute content-space
// coordinates (curveSegmentToPathD is untouched) — only the *canvas* a
// segment rasterizes into shrinks, via `viewBox` panning into just that
// segment's own local Y-slice of the shared coordinate space while the
// <Svg> itself is absolutely positioned at that same slice's top. A cubic
// bezier is guaranteed to lie within the convex hull of its 4 control
// points, so bounding each segment's local canvas by the min/max Y across
// {start, control1, control2, end} (plus a shadowWidth margin so the wide
// shadow stroke's rounded cap never clips at a segment boundary) is a real
// mathematical guarantee, not a visual approximation — the curve never
// looks different, only how many small bitmaps it's split across.
export function LevelMapPath({
  segments,
  mapWidth,
  currentIndex,
  walkedColor,
  litColor,
  lockedColor,
  shadowColor,
  strokeWidth,
  shadowWidth,
}: LevelMapPathProps) {
  return (
    <>
      {segments.map(({ segment, index: i }) => {
        const walked = currentIndex >= 0 && i < currentIndex;
        const lit = currentIndex >= 0 && (i === currentIndex - 1 || i === currentIndex);
        const d = curveSegmentToPathD(segment);
        const ys = [segment.start.y, segment.control1.y, segment.control2.y, segment.end.y];
        const margin = shadowWidth;
        const top = Math.min(...ys) - margin;
        const bottom = Math.max(...ys) + margin;
        const height = bottom - top;
        return (
          <Svg
            key={`segment-${i}`}
            pointerEvents="none"
            style={[styles.svg, { top, height }]}
            width={mapWidth}
            height={height}
            viewBox={`0 ${top} ${mapWidth} ${height}`}
          >
            <Path
              d={d}
              fill="none"
              stroke={shadowColor}
              strokeWidth={shadowWidth}
              strokeLinecap="round"
              strokeOpacity={walked || lit ? 0.34 : 0.16}
            />
            <Path
              d={d}
              fill="none"
              stroke={walked ? walkedColor : lit ? litColor : lockedColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeOpacity={walked ? 0.92 : lit ? 0.9 : 0.62}
            />
          </Svg>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  svg: {
    position: 'absolute',
    left: 0,
  },
});
