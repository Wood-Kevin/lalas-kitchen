import React from 'react';
import { StyleSheet, View } from 'react-native';

export interface GinghamTrimProps {
  accentColor: string;
  panelColor: string;
  height?: number;
  // Pixel size of one check. Square by default (half the strip's height),
  // matching the mockup's fine gingham weave — pass this only to make the
  // checks coarser/finer than that default, not to control how many fit.
  cellSize?: number;
}

// Generously more cells than any phone-width trim will ever need — the row
// clips the excess via overflow: hidden, the same way a tiled CSS background
// repeats past a container's edge instead of stretching to fit it. Using a
// fixed cellSize (not a count divided across the measured width) is what
// keeps the check density constant regardless of the parent's width; a
// flex-divided count is what produced the previous, oversized blocks.
const CELL_COUNT = 100;

// A real 2D checkerboard: two stacked rows of square cells whose tint
// parity is inverted between rows, so diagonal neighbors match and
// horizontal/vertical neighbors don't — the same read as the mockup's CSS
// repeating-linear-gradient checkerboard (two gradients at 0deg/90deg),
// reproduced with plain Views since no gradient dependency was added.
export function GinghamTrim({ accentColor, panelColor, height = 14, cellSize }: GinghamTrimProps) {
  const tint = toRgba(accentColor, 0.45);
  const rowHeight = height / 2;
  const size = cellSize ?? rowHeight;
  const cells = Array.from({ length: CELL_COUNT }, (_, i) => i);

  return (
    <View style={[styles.container, { height, backgroundColor: panelColor }]}>
      {[0, 1].map((rowParity) => (
        <View key={rowParity} style={[styles.row, { height: rowHeight }]}>
          {cells.map((i) => (
            <View
              key={i}
              style={[
                styles.cell,
                {
                  width: size,
                  backgroundColor: i % 2 === rowParity ? tint : 'transparent',
                },
              ]}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function toRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
  },
  cell: {
    height: '100%',
  },
});
