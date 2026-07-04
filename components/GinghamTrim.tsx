import React from 'react';
import { StyleSheet, View } from 'react-native';

export interface GinghamTrimProps {
  accentColor: string;
  panelColor: string;
  height?: number;
  cellCount?: number;
}

// The design mockups render this as a CSS repeating-linear-gradient
// checkerboard (two overlapping gradients at 0deg/90deg over a translucent
// accent color) — React Native has no gradient primitive without adding a
// dependency neither asked for nor otherwise needed here. At the thin strip
// heights this trim actually renders at (10-16px), the 90deg axis barely
// completes one cycle anyway, so the readable pattern is really just
// alternating vertical bands — this reproduces that same banded look with
// plain solid-color cells instead of a gradient.
export function GinghamTrim({ accentColor, panelColor, height = 14, cellCount = 24 }: GinghamTrimProps) {
  const tint = toRgba(accentColor, 0.38);
  const cells = Array.from({ length: cellCount }, (_, i) => i);

  return (
    <View style={[styles.row, { height, backgroundColor: panelColor }]}>
      {cells.map((i) => (
        <View key={i} style={[styles.cell, { backgroundColor: i % 2 === 0 ? tint : 'transparent' }]} />
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
  row: {
    flexDirection: 'row',
    width: '100%',
  },
  cell: {
    flex: 1,
    height: '100%',
  },
});
