import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LevelMapCurveSegment, sampleCurveSegment } from './levelMapLayout';

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

// How many short straight micro-segments approximate one real curve segment
// — enough to read as smoothly curved rather than faceted at this map's
// real node spacing (NODE_SPACING_Y, LevelMap.tsx), not tuned further than
// that.
const SAMPLES_PER_SEGMENT = 10;

// react-native-svg's own web entry point transitively imports a Fabric-only
// codegen file (`CircleNativeComponent.js`) that Metro cannot bundle for
// web at all — a real break caught live while verifying the native curve
// rendering, the same class of bug this project already hit once with
// react-native-google-mobile-ads (see engine/DECISIONS.md's real-crazygames-
// sdk entry) and fixed the same way: keep the problematic import out of the
// web module graph entirely via a platform-split file, rather than reached
// by LevelMap.tsx directly. This file never imports react-native-svg —
// instead it approximates the same Catmull-Rom curve LevelMapPath.native.tsx
// draws exactly, using many short straight rotated Views per real segment
// (sampleCurveSegment's own De Casteljau evaluation), the same "reproduce a
// curve with plain Views" house convention GinghamTrim.tsx already
// established before react-native-svg existed in this project at all.
export function LevelMapPath({
  segments,
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
      {segments.map((segment, i) => {
        const walked = currentIndex >= 0 && i < currentIndex;
        const lit = currentIndex >= 0 && (i === currentIndex - 1 || i === currentIndex);
        const points = sampleCurveSegment(segment, SAMPLES_PER_SEGMENT);
        const color = walked ? walkedColor : lit ? litColor : lockedColor;
        const shadowOpacity = walked || lit ? 0.34 : 0.16;
        const strokeOpacity = walked ? 0.92 : lit ? 0.9 : 0.62;

        return (
          <React.Fragment key={`segment-${i}`}>
            {points.slice(0, -1).map((point, j) => {
              const next = points[j + 1];
              const dx = next.x - point.x;
              const dy = next.y - point.y;
              const length = Math.sqrt(dx * dx + dy * dy);
              const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
              return (
                <React.Fragment key={`micro-${i}-${j}`}>
                  <View
                    pointerEvents="none"
                    style={[
                      styles.microSegment,
                      {
                        left: point.x,
                        top: point.y - shadowWidth / 2,
                        width: length,
                        height: shadowWidth,
                        borderRadius: shadowWidth / 2,
                        backgroundColor: shadowColor,
                        opacity: shadowOpacity,
                        transform: [{ rotate: `${angleDeg}deg` }],
                        transformOrigin: 'left center',
                      },
                    ]}
                  />
                  <View
                    pointerEvents="none"
                    style={[
                      styles.microSegment,
                      {
                        left: point.x,
                        top: point.y - strokeWidth / 2,
                        width: length,
                        height: strokeWidth,
                        borderRadius: strokeWidth / 2,
                        backgroundColor: color,
                        opacity: strokeOpacity,
                        transform: [{ rotate: `${angleDeg}deg` }],
                        transformOrigin: 'left center',
                      },
                    ]}
                  />
                </React.Fragment>
              );
            })}
          </React.Fragment>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  microSegment: {
    position: 'absolute',
  },
});
