import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Board as BoardMatrix,
  GameState,
  LevelConfig,
  Position,
  applyMove,
  createGameState,
  grantBonusMoves,
} from '../engine/gameState';
import { canStartLevel, findBlockerMatchType, shouldShowBlockerTutorial, BLOCKER_TUTORIAL_ID } from '../appPersistence';
import { RecipeCard, SkinConfig } from './skinConfig';
import { diffBoards } from './boardDiff';
import { getSpriteForMatchType, getSpriteForPiece } from './spriteMap';
import { resolveSpriteAsset, SpriteAssetMap } from './spriteAsset';
import { cascadeFallDurationMs } from './cascadeTiming';
import { Hud } from './Hud';
import { BlockerTutorialOverlay } from './BlockerTutorialOverlay';
import { PausedOverlay } from './PausedOverlay';
import { WonOverlay } from './WonOverlay';
import { ExitingTile, Tile } from './Tile';
import { ComboStreakBanner } from './ComboStreakBanner';

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
  // WonOverlay's primary action — advances to the next level (hand-built or
  // generated; App.tsx decides which). Distinct from Board's own
  // handlePlayAgain below, which replays this same level and stays
  // entirely internal.
  onNextLevel: () => void;
  // WonOverlay's secondary action — routes to the level-select dashboard.
  // Board has no notion of a level queue or dashboard beyond handing this
  // callback through.
  onOpenDashboard: () => void;
  // Returns to Home immediately, no confirmation — wired to both the
  // persistent HUD close button (visible whenever status is 'in_progress')
  // and PausedOverlay's "Exit" option. Board never calls saveProgress
  // itself (see App.tsx), so leaving this way is a plain unmount: whatever
  // progress this attempt made simply isn't persisted, same as it wasn't
  // before this session.
  onExit: () => void;
  // The account's *current* persisted lives count — kept fresh by App.tsx
  // (regen + loss decrements both happen there), not the frozen
  // `levelConfig.lives` snapshot from whenever this Board instance first
  // mounted. handlePlayAgain reads this (not levelConfig.lives) so a
  // restart after a loss reflects the life that was just spent, and gates
  // on it the same way every other level-start entry point does (see
  // appPersistence.ts's canStartLevel).
  lives: number;
  // Routes to the same "out of lives" screen Home's "Start cooking" and an
  // All Levels row already route to when blocked — Play again is the one
  // level-start entry point that lives entirely inside Board and never
  // otherwise calls back into App.tsx.
  onOutOfLives: () => void;
  // Display-only — App.tsx already keys Board by this value to force a
  // remount per level, so threading it through as a prop too is just
  // exposing existing data to WonOverlay/PausedOverlay for their "LEVEL N"
  // label, not new state.
  levelIndex: number;
  // The account's persisted one-time-tutorial-seen list (App.tsx's
  // seenTutorials, loaded from SaveData) — read once at mount to decide
  // whether the blocker tutorial should show (see appPersistence.ts's
  // shouldShowBlockerTutorial), same "real prop, not hardcoded" reasoning
  // as `lives`/`seenTutorials` elsewhere in this file.
  seenTutorials: string[];
  // Fired once, when the blocker tutorial is dismissed — App.tsx adds the
  // id to its own seenTutorials and persists immediately (see App.tsx's
  // handleTutorialSeen), the same "must survive an app close" reasoning as
  // handleGrantLife's explicit save.
  onTutorialSeen: (id: string) => void;
  // The recipe card this exact win unlocked for the first time, or null —
  // computed by App.tsx at the same win transition completedLevels updates
  // from (see App.tsx's handleBoardStateChange), threaded straight through
  // to WonOverlay unchanged. Board has no opinion about milestone mapping
  // or the persisted unlocked-cards list; it only renders whatever App.tsx
  // resolves.
  unlockedRecipeCard: RecipeCard | null;
}

interface ExitingEntry {
  key: string;
  pieceId: string;
  matchType: string | undefined;
  row: number;
  col: number;
  // From diff.cleared's own piece.type — a blocker cleared by adjacent
  // damage rather than a direct match gets its own highlight beat (see
  // Tile.tsx's ExitingTile). Reusing data diffBoards already computes, not
  // a new engine field.
  isBlockerClear: boolean;
}

const BOARD_HORIZONTAL_PADDING = 12;

function isAdjacent(a: Position, b: Position): boolean {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

// Reads GameState + the active skin's config and renders the board. Never
// contains a literal piece name — every piece is drawn purely from its
// matchType id via getSpriteForMatchType, so this file would render an
// entirely different skin unchanged.
export function Board({
  levelConfig,
  skinConfig,
  spriteAssets,
  onStateChange,
  onNextLevel,
  onOpenDashboard,
  onExit,
  lives,
  onOutOfLives,
  levelIndex,
  seenTutorials,
  onTutorialSeen,
  unlockedRecipeCard,
}: BoardProps) {
  const [gameState, setGameState] = useState<GameState>(() => createGameState(levelConfig));
  // Computed once at mount, from this level's initial board only — not
  // re-derived on every render as blockers get cleared mid-level (see
  // appPersistence.ts's shouldShowBlockerTutorial for why). Surviving a
  // "Play again" restart mid-session correctly stays false here even
  // though that regenerates `gameState` with a new seed/board, since this
  // is independent state, not something re-derived from `gameState`.
  const [showBlockerTutorial, setShowBlockerTutorial] = useState(() =>
    shouldShowBlockerTutorial(gameState.board, seenTutorials)
  );
  const [selected, setSelected] = useState<Position | null>(null);
  const [exiting, setExiting] = useState<ExitingEntry[]>([]);
  const [spawnedIds, setSpawnedIds] = useState<Set<string>>(new Set());
  const [swapDurationIds, setSwapDurationIds] = useState<Set<string>>(new Set());
  const [snapBack, setSnapBack] = useState<{ a: Position; b: Position } | null>(null);
  // A unique key per combo_streak event (see engine/gameState.ts), not just
  // a boolean — ComboStreakBanner is keyed by this so back-to-back combos
  // each mount a fresh instance and replay the fade from the start, rather
  // than a second event landing mid-fade doing nothing because the banner
  // was already mounted.
  const [comboKey, setComboKey] = useState<string | null>(null);
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
  // While a multi-pass cascade is animating, the tiles render from this
  // intermediate snapshot instead of gameState.board — applyMove now returns
  // one board per cascade pass (see engine/gameState.ts's ApplyMoveResult),
  // and we walk them in sequence so each pass reads as its own beat rather
  // than the whole chain resolving at once. Null whenever nothing is
  // mid-animation, in which case the live gameState.board is shown directly.
  const [displayBoard, setDisplayBoard] = useState<BoardMatrix | null>(null);
  // Synchronous input lock: gameState isn't committed until the cascade
  // finishes animating (so the win/paused overlay doesn't pop mid-chain), so
  // without this a tap during the animation would call applyMove against the
  // stale pre-move state. A ref, not state, because handleTilePress must see
  // the current value the instant it's set, not on the next render.
  const animatingRef = useRef(false);
  // Pending step/cleanup timers, cleared on unmount and on "play again" so a
  // cascade animation from an abandoned attempt can't fire into a fresh one.
  const stepTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Monotonic per-move id, used only to key exiting tiles uniquely across
  // moves (a piece clears at most once per move, so id+move is unique).
  const moveCounterRef = useRef(0);

  // The board actually drawn: the mid-cascade snapshot when animating, else
  // the committed game state. Grid dimensions are identical either way, so
  // deriving rows/cols/tileSize from this is always correct.
  const renderBoard = displayBoard ?? gameState.board;
  const rows = renderBoard.length;
  const cols = renderBoard[0]?.length ?? 0;

  const tileSize = useMemo(() => {
    if (!boardArea) return 0;
    const availableWidth = boardArea.width - BOARD_HORIZONTAL_PADDING * 2;
    const byWidth = Math.floor(availableWidth / cols);
    const byHeight = Math.floor(boardArea.height / rows);
    // Bounded by whichever axis is tighter, so the board fills the taller
    // available height on a phone-shaped screen instead of only ever being
    // sized off screen width (see CLAUDE.md's edge-to-edge board constraint).
    // On a wide/short viewport (desktop), height is the tighter axis, so the
    // rendered board ends up narrower than boardArea itself.
    return Math.max(0, Math.min(byWidth, byHeight));
  }, [boardArea, rows, cols]);

  const boardWidth = cols * tileSize;

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
  // Delay between one cascade pass's clears settling and the next pass's
  // clears beginning. Reuses the existing per-pass fall duration as the beat
  // rather than inventing a new number or stretching one value across the
  // whole chain — each pass gets the same calm, legible pacing a single
  // cascade already has (see CLAUDE.md's calm-not-frantic constraint).
  const cascadeStepIntervalMs = cascadeDurationMs;

  useEffect(() => {
    // Clear any in-flight cascade timers if this Board unmounts mid-animation
    // (e.g. the player exits to Home), so a queued step can't fire into a
    // torn-down component. stepTimersRef is a ref, so this effect needs no
    // deps — it only ever runs its cleanup on unmount.
    return () => {
      stepTimersRef.current.forEach((timer) => clearTimeout(timer));
      stepTimersRef.current = [];
    };
  }, []);

  function handleTilePress(pos: Position) {
    if (gameState.status !== 'in_progress' || snapBack || showBlockerTutorial || animatingRef.current)
      return;

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

    const tappedIds = new Set([
      gameState.board[posA.row][posA.col].id,
      gameState.board[posB.row][posB.col].id,
    ]);
    // result.events surfaces combo_streak the same way the step diffs surface
    // cleared/spawned pieces — both are derived from the same applyMove call.
    // Fired when the chain finishes animating (see animateCascade), so the
    // acknowledgment lands on the completed streak, not its first pass.
    const hasCombo = result.events.some((event) => event.type === 'combo_streak');

    animateCascade(gameState.board, result.state, result.steps, tappedIds, hasCombo);
  }

  // Walks the per-pass board snapshots applyMove returned, animating each as
  // its own beat: pass i's clears/refill are diffed against the previously
  // shown board, played, then a fixed interval later pass i+1 begins. The
  // committed gameState (and any win/paused overlay it implies) is deferred
  // to the final pass so overlays never appear over a still-resolving board.
  // A single-pass move (steps.length === 1) collapses to exactly the prior
  // one-shot behavior: one diff from the pre-move board straight to the
  // settled board, gameState committed immediately.
  function animateCascade(
    fromBoard: BoardMatrix,
    finalState: GameState,
    steps: BoardMatrix[],
    tappedIds: Set<string>,
    hasCombo: boolean
  ) {
    animatingRef.current = true;
    const moveId = moveCounterRef.current++;
    let previous = fromBoard;

    const runStep = (i: number) => {
      const next = steps[i];
      const diff = diffBoards(previous, next);

      // Only the first pass carries the just-tapped pair, which uses the
      // snappier swap duration; every later pass is a passive fall.
      setSwapDurationIds(i === 0 ? tappedIds : new Set());
      setSpawnedIds(new Set(diff.spawned.map((s) => s.piece.id)));
      // Append (don't replace): a pass's exit tiles keep animating out while
      // the next pass's clears begin, giving the layered, sequential read.
      // Each ExitingTile removes itself on completion (see removeExiting).
      setExiting((current) => [
        ...current,
        ...diff.cleared.map(({ piece, from }) => ({
          key: `${piece.id}-${moveId}`,
          pieceId: piece.id,
          matchType: piece.matchType,
          row: from.row,
          col: from.col,
          isBlockerClear: piece.type === 'blocker',
        })),
      ]);

      previous = next;

      if (i + 1 < steps.length) {
        setDisplayBoard(next);
        stepTimersRef.current.push(setTimeout(() => runStep(i + 1), cascadeStepIntervalMs));
      } else {
        // Final pass: commit the real game state (its board is this exact
        // last snapshot) and drop the intermediate display board in the same
        // render, so nothing jumps. Fire the combo ack here, on the settled
        // chain.
        if (hasCombo) setComboKey(`combo-${moveId}`);
        setGameState(finalState);
        setDisplayBoard(null);
        animatingRef.current = false;
        stepTimersRef.current.push(
          setTimeout(() => {
            setSwapDurationIds(new Set());
            setSpawnedIds(new Set());
          }, transitionWindowMs)
        );
      }
    };

    runStep(0);
  }

  function handleGrant(amount: number) {
    setGameState((current) => grantBonusMoves(current, amount));
  }

  function handleDismissBlockerTutorial() {
    setShowBlockerTutorial(false);
    onTutorialSeen(BLOCKER_TUTORIAL_ID);
  }

  function removeExiting(key: string) {
    setExiting((current) => current.filter((entry) => entry.key !== key));
  }

  function handlePlayAgain() {
    if (!canStartLevel(lives)) {
      onOutOfLives();
      return;
    }
    const seed = nextSeedRef.current;
    nextSeedRef.current += 1;
    // Cancel any cascade animation still in flight (from the attempt being
    // replayed) so its queued steps can't commit the old state or exit tiles
    // over the fresh board.
    stepTimersRef.current.forEach((timer) => clearTimeout(timer));
    stepTimersRef.current = [];
    animatingRef.current = false;
    // Seeds the fresh attempt with the current `lives` prop, not
    // `levelConfig.lives` — the level's original mount-time snapshot could
    // be stale if this restart follows a loss (see the `lives` prop's doc
    // comment above).
    setGameState(createGameState({ ...levelConfig, seed, lives }));
    setDisplayBoard(null);
    setSelected(null);
    setExiting([]);
    setSpawnedIds(new Set());
    setSwapDurationIds(new Set());
    setSnapBack(null);
    setComboKey(null);
  }

  return (
    <View style={[styles.container, { backgroundColor: skinConfig.palette.background[0] }]}>
      {gameState.status === 'in_progress' && (
        // Persistent exit, not just a paused-state option — a small corner
        // button rather than a fourth HUD panel, so it never competes with
        // Target/Moves/Lives for width. Immediate, no confirmation dialog,
        // matching this app's calm/low-friction tone everywhere else.
        <View style={styles.topBar}>
          <Pressable
            onPress={onExit}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[styles.exitButton, { borderColor: skinConfig.palette.accent, backgroundColor: skinConfig.palette.panel }]}
          >
            <Text style={[styles.exitLabel, { color: skinConfig.palette.accent }]}>✕</Text>
          </Pressable>
        </View>
      )}
      <Hud
        objectives={gameState.objectives}
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
          <View style={[styles.board, { width: boardWidth, height: rows * tileSize }]}>
            {renderBoard.flatMap((rowPieces, r) =>
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
                    sprite={resolveSpriteAsset(getSpriteForPiece(piece, skinConfig), spriteAssets)}
                    accentColor={skinConfig.palette.accent}
                    panelColor={skinConfig.palette.panel}
                    selected={!!selected && selected.row === r && selected.col === c}
                    durationMs={duration}
                    enterFromRow={isSpawn ? r - 2 : undefined}
                    // Only a striped piece carries a direction; every other
                    // piece passes undefined, so Tile renders no badge. This
                    // is the one place the row/column sweep a striped piece
                    // will perform is made visible before the player commits.
                    direction={piece.type === 'striped' ? piece.direction : undefined}
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
                isBlockerClear={entry.isBlockerClear}
                onExited={() => removeExiting(entry.key)}
              />
            ))}
            {comboKey && (
              <ComboStreakBanner
                key={comboKey}
                accentColor={skinConfig.palette.accent}
                panelColor={skinConfig.palette.panel}
                onDone={() => setComboKey(null)}
              />
            )}
          </View>
        )}
      </View>
      {showBlockerTutorial && (
        <BlockerTutorialOverlay
          config={skinConfig}
          spriteAssets={spriteAssets}
          blockerMatchType={findBlockerMatchType(gameState.board)}
          onDismiss={handleDismissBlockerTutorial}
        />
      )}
      {gameState.status === 'paused_awaiting_input' && (
        <PausedOverlay
          reason={gameState.pauseReason}
          movesRemaining={gameState.movesRemaining}
          levelIndex={levelIndex}
          config={skinConfig}
          onGrant={handleGrant}
          onPlayAgain={handlePlayAgain}
          onExit={onExit}
        />
      )}
      {gameState.status === 'won' && (
        <WonOverlay
          objectives={gameState.objectives}
          levelIndex={levelIndex}
          config={skinConfig}
          spriteAssets={spriteAssets}
          onPlayAgain={handlePlayAgain}
          onNext={onNextLevel}
          onOpenDashboard={onOpenDashboard}
          unlockedRecipeCard={unlockedRecipeCard}
        />
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
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 4,
  },
  exitButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitLabel: {
    fontSize: 14,
    fontWeight: '700',
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
