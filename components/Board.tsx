import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  GameState,
  LevelConfig,
  Position,
  applyMove,
  createGameState,
  grantBonusLife,
  grantBonusMoves,
} from '../engine/gameState';
import { SkinConfig } from './skinConfig';
import { diffBoards } from './boardDiff';
import { getSpriteForMatchType } from './spriteMap';
import { resolveSpriteAsset, SpriteAssetMap } from './spriteAsset';
import { cascadeFallDurationMs } from './cascadeTiming';
import { Hud } from './Hud';
import { PausedOverlay } from './PausedOverlay';
import { WonOverlay } from './WonOverlay';
import { ExitingTile, Tile } from './Tile';

export interface BoardProps {
  levelConfig: LevelConfig;
  skinConfig: SkinConfig;
  // Per-skin bundled sprite images, keyed by the same filenames
  // skinConfig.pieceTypes/blockers point at. A separate prop from
  // skinConfig because it's built from static require() calls (see
  // skins/lalas-kitchen/spriteRegistry.ts), not JSON-serializable data.
  spriteAssets: SpriteAssetMap;
  // Fired after every gameState change (a resolved move, a bonus grant),
  // including once on mount — a plain state mirror, not an event stream.
  // The app shell uses it to know the current `lives` value at the moment
  // it needs to persist (level end, backgrounding), without Board owning
  // any opinion about when or where saving happens.
  onStateChange?: (state: GameState) => void;
}

interface ExitingEntry {
  key: string;
  pieceId: string;
  matchType: string | undefined;
  row: number;
  col: number;
}

const BOARD_HORIZONTAL_PADDING = 12;

function isAdjacent(a: Position, b: Position): boolean {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

// Reads GameState + the active skin's config and renders the board. Never
// contains a literal piece name — every piece is drawn purely from its
// matchType id via getSpriteForMatchType, so this file would render an
// entirely different skin unchanged.
export function Board({ levelConfig, skinConfig, spriteAssets, onStateChange }: BoardProps) {
  const [gameState, setGameState] = useState<GameState>(() => createGameState(levelConfig));
  const [selected, setSelected] = useState<Position | null>(null);
  const [exiting, setExiting] = useState<ExitingEntry[]>([]);
  const [spawnedIds, setSpawnedIds] = useState<Set<string>>(new Set());
  const [swapDurationIds, setSwapDurationIds] = useState<Set<string>>(new Set());
  const [snapBack, setSnapBack] = useState<{ a: Position; b: Position } | null>(null);
  // Measured via onLayout rather than Dimensions.get('window'), since the
  // board area's actual available space is whatever's left after the HUD
  // and safe-area insets are applied — Dimensions.get('window') only knows
  // the raw screen size, not what this component actually has to work with,
  // which is what left the board undersized with empty space below it.
  const [boardArea, setBoardArea] = useState<{ width: number; height: number } | null>(null);
  // Advances on every "play again" tap so a fresh attempt doesn't hand the
  // seeded generator (see engine/generator.ts) the exact same seed it just
  // started from — each replay gets a different, still-deterministic board.
  const nextSeedRef = useRef(levelConfig.seed + 1);

  const rows = gameState.board.length;
  const cols = gameState.board[0]?.length ?? 0;

  const tileSize = useMemo(() => {
    if (!boardArea) return 0;
    const availableWidth = boardArea.width - BOARD_HORIZONTAL_PADDING * 2;
    const byWidth = Math.floor(availableWidth / cols);
    const byHeight = Math.floor(boardArea.height / rows);
    // Bounded by whichever axis is tighter, so the board fills the taller
    // available height on a phone-shaped screen instead of only ever being
    // sized off screen width (see CLAUDE.md's edge-to-edge board constraint).
    return Math.max(0, Math.min(byWidth, byHeight));
  }, [boardArea, rows, cols]);

  useEffect(() => {
    onStateChange?.(gameState);
    // Only gameState identity should retrigger this — onStateChange is
    // frequently a fresh closure per parent render, and re-firing on that
    // alone would report the same state repeatedly for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState]);

  const cascadeDurationMs = cascadeFallDurationMs(skinConfig.animationProfile.cascadeFallSpeed);
  const swapDurationMs = skinConfig.animationProfile.swapDurationMs;
  const matchDurationMs = skinConfig.animationProfile.matchDurationMs;
  // How long the swap-specific duration should apply to the just-tapped
  // pair before falling back to the (longer-lived) cascade duration for any
  // subsequent move — bounds the bookkeeping Sets below instead of letting
  // them grow for the life of the level.
  const transitionWindowMs = Math.max(cascadeDurationMs, swapDurationMs);

  function handleTilePress(pos: Position) {
    if (gameState.status !== 'in_progress' || snapBack) return;

    if (!selected) {
      setSelected(pos);
      return;
    }
    if (selected.row === pos.row && selected.col === pos.col) {
      setSelected(null);
      return;
    }
    if (!isAdjacent(selected, pos)) {
      setSelected(pos);
      return;
    }

    const posA = selected;
    const posB = pos;
    setSelected(null);

    const result = applyMove(gameState, posA, posB);

    if (result.state === gameState) {
      // Illegal move: applyMove's contract returns the identical state
      // object for a rejected swap (see engine/DECISIONS.md), which is what
      // makes this reference check a reliable "was this legal?" signal.
      // Play a brief visual swap-and-snap-back; no state change underneath.
      setSnapBack({ a: posA, b: posB });
      setTimeout(() => setSnapBack(null), swapDurationMs * 2);
      return;
    }

    const diff = diffBoards(gameState.board, result.state.board);
    const tappedIds = new Set([
      gameState.board[posA.row][posA.col].id,
      gameState.board[posB.row][posB.col].id,
    ]);

    setSwapDurationIds(tappedIds);
    setSpawnedIds(new Set(diff.spawned.map((s) => s.piece.id)));
    setExiting(
      diff.cleared.map(({ piece, from }) => ({
        key: `${piece.id}-${gameState.movesRemaining}`,
        pieceId: piece.id,
        matchType: piece.matchType,
        row: from.row,
        col: from.col,
      }))
    );
    setGameState(result.state);

    setTimeout(() => {
      setSwapDurationIds(new Set());
      setSpawnedIds(new Set());
    }, transitionWindowMs);
  }

  function handleGrant(resource: 'moves' | 'lives', amount: number) {
    setGameState((current) =>
      resource === 'moves' ? grantBonusMoves(current, amount) : grantBonusLife(current, amount)
    );
  }

  function removeExiting(key: string) {
    setExiting((current) => current.filter((entry) => entry.key !== key));
  }

  function handlePlayAgain() {
    const seed = nextSeedRef.current;
    nextSeedRef.current += 1;
    setGameState(createGameState({ ...levelConfig, seed }));
    setSelected(null);
    setExiting([]);
    setSpawnedIds(new Set());
    setSwapDurationIds(new Set());
    setSnapBack(null);
  }

  return (
    <View style={[styles.container, { backgroundColor: skinConfig.palette.background[0] }]}>
      <Hud
        objective={gameState.objective}
        movesRemaining={gameState.movesRemaining}
        lives={gameState.lives}
        config={skinConfig}
        spriteAssets={spriteAssets}
      />
      <View
        style={styles.boardArea}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setBoardArea((current) =>
            current && current.width === width && current.height === height
              ? current
              : { width, height }
          );
        }}
      >
        {tileSize > 0 && (
          <View style={[styles.board, { width: cols * tileSize, height: rows * tileSize }]}>
            {gameState.board.flatMap((rowPieces, r) =>
              rowPieces.map((piece, c) => {
                let displayRow = r;
                let displayCol = c;
                if (snapBack) {
                  if (r === snapBack.a.row && c === snapBack.a.col) {
                    displayRow = snapBack.b.row;
                    displayCol = snapBack.b.col;
                  } else if (r === snapBack.b.row && c === snapBack.b.col) {
                    displayRow = snapBack.a.row;
                    displayCol = snapBack.a.col;
                  }
                }
                const duration =
                  snapBack || swapDurationIds.has(piece.id) ? swapDurationMs : cascadeDurationMs;
                const isSpawn = spawnedIds.has(piece.id);

                return (
                  <Tile
                    key={piece.id}
                    pieceId={piece.id}
                    row={displayRow}
                    col={displayCol}
                    tileSize={tileSize}
                    sprite={resolveSpriteAsset(getSpriteForMatchType(piece.matchType, skinConfig), spriteAssets)}
                    accentColor={skinConfig.palette.accent}
                    panelColor={skinConfig.palette.panel}
                    selected={!!selected && selected.row === r && selected.col === c}
                    durationMs={duration}
                    enterFromRow={isSpawn ? r - 2 : undefined}
                    onPress={() => handleTilePress({ row: r, col: c })}
                  />
                );
              })
            )}
            {exiting.map((entry) => (
              <ExitingTile
                key={entry.key}
                pieceId={entry.pieceId}
                row={entry.row}
                col={entry.col}
                tileSize={tileSize}
                sprite={resolveSpriteAsset(getSpriteForMatchType(entry.matchType, skinConfig), spriteAssets)}
                accentColor={skinConfig.palette.accent}
                panelColor={skinConfig.palette.panel}
                durationMs={matchDurationMs}
                onExited={() => removeExiting(entry.key)}
              />
            ))}
          </View>
        )}
      </View>
      {gameState.status === 'paused_awaiting_input' && (
        <PausedOverlay reason={gameState.pauseReason} config={skinConfig} onGrant={handleGrant} />
      )}
      {gameState.status === 'won' && (
        <WonOverlay objective={gameState.objective} config={skinConfig} onPlayAgain={handlePlayAgain} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: BOARD_HORIZONTAL_PADDING,
    paddingTop: 12,
  },
  boardArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  board: {
    position: 'relative',
  },
});
