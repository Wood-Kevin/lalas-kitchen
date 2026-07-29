import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { curveSegmentToPathD, LevelMapCurveSegment } from './levelMapLayout';

export interface LevelMapPathProps {
  segments: LevelMapCurveSegment[];
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

// The real, smooth-curve rendering path — Metro can bundle react-native-svg
// for a native target cleanly, so this is a straightforward per-segment
// <Path> pair (a wide, low-opacity shadow stroke and a narrower color
// stroke on top), one true cubic-bezier curve per node-to-node segment.
// See LevelMapPath.web.tsx's sibling file for why web needs a different
// implementation, and engine/DECISIONS.md's level-map-curve entry for the
// full reasoning behind this platform split existing at all.
export function LevelMapPath({
  segments,
  mapWidth,
  contentHeight,
  currentIndex,
  walkedColor,
  litColor,
  lockedColor,
  shadowColor,
  strokeWidth,
  shadowWidth,
}: LevelMapPathProps) {
  return (
    <Svg
      pointerEvents="none"
      style={styles.svg}
      width={mapWidth}
      height={contentHeight}
      viewBox={`0 0 ${mapWidth} ${contentHeight}`}
    >
      {segments.map((segment, i) => {
        const walked = currentIndex >= 0 && i < currentIndex;
        const lit = currentIndex >= 0 && (i === currentIndex - 1 || i === currentIndex);
        const d = curveSegmentToPathD(segment);
        return (
          <React.Fragment key={`segment-${i}`}>
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
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

const styles = StyleSheet.create({
  svg: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
});
