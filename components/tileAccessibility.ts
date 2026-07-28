import { Piece } from '../engine/matrix';

// Turns a piece's own matchType id into a readable word ("tomato" ->
// "Tomato") — a generic string transform, not a per-name lookup table, the
// same leak-test reasoning spriteLabel.ts's own header comment documents:
// this works unchanged for any skin's own ingredient ids, never a hardcoded
// "tomato" reference.
function capitalize(id: string): string {
  const spaced = id.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// A screen-reader label for a single board tile — what it is, plus its grid
// position, so a VoiceOver/TalkBack player gets the same "there's a tomato
// at row 2, column 3" information a sighted player reads from the sprite
// and its position on the grid. Row/col are 1-indexed here (matching how a
// player would count tiles out loud), unlike the engine's 0-indexed
// internals. Selection state is deliberately NOT folded into this string —
// Tile.tsx sets that via the separate accessibilityState prop, which
// VoiceOver/TalkBack already announce natively ("selected"), rather than
// hand-crafting it into label text.
export function describeTileForAccessibility(piece: Piece, row: number, col: number): string {
  const position = `row ${row + 1}, column ${col + 1}`;

  if (piece.type === 'blocker') {
    // Matches this game's own player-facing copy for blockers (see
    // BlockerTutorialOverlay.tsx's "A Covered Dish" and
    // SpecialTutorialOverlay.tsx's "A Sealed Jar" headlines) rather than the
    // internal skin id ("cling", "dish_stack", "pot_lid", "sealed_jar") —
    // a screen-reader player should hear the same words a sighted player
    // reads in the tutorial card.
    const kind = piece.specialOnly ? 'Sealed jar' : 'Covered dish';
    const hits = piece.hitsRemaining ?? 1;
    return `${kind}, ${hits} hit${hits === 1 ? '' : 's'} to clear, ${position}`;
  }

  if (piece.type === 'color_bomb') return `Color bomb, ${position}`;
  if (piece.type === 'area_bomb') return `Area blast, ${position}`;
  if (piece.type === 'dropdown') return `Delivery basket, ${position}`;

  const ingredient = piece.matchType ? capitalize(piece.matchType) : 'Ingredient';
  if (piece.type === 'striped') {
    const line = piece.direction === 'col' ? 'column' : 'row';
    return `Striped ${ingredient.toLowerCase()}, sweeps its ${line}, ${position}`;
  }

  return `${ingredient}, ${position}`;
}
