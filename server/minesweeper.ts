import { randomInt } from "node:crypto";

export type Difficulty = "easy" | "medium" | "hard";
export const difficulties = {
  easy: { rows: 8, columns: 8, mineCount: 10 },
  medium: { rows: 12, columns: 12, mineCount: 25 },
  hard: { rows: 16, columns: 16, mineCount: 50 },
} as const;
export type MinesState = {
  difficulty: Difficulty;
  rows: number;
  columns: number;
  mineCount: number;
  layout: number[] | null;
  revealed: number[];
  currentPlayer: number;
  lives: Record<number, number>;
  moves: { requestId: string; player: number; cell: number }[];
  lastMove: {
    player: number;
    cell: number;
    mine: boolean;
    adjacent: number;
    opened: number;
  } | null;
};
export type MinesView = Omit<MinesState, "layout" | "moves"> & {
  moveCount: number;
  cells: (number | null)[];
};
export function createMines(difficulty: Difficulty): MinesState {
  return {
    difficulty,
    ...difficulties[difficulty],
    layout: null,
    revealed: [],
    currentPlayer: 1,
    lives: { 1: 3, 2: 3 },
    moves: [],
    lastMove: null,
  };
}
export function neighbors(cell: number, rows: number, columns: number) {
  const result: number[] = [],
    row = Math.floor(cell / columns),
    col = cell % columns;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const y = row + dy,
        x = col + dx;
      if ((dy || dx) && y >= 0 && y < rows && x >= 0 && x < columns)
        result.push(y * columns + x);
    }
  return result;
}
export function generateLayout(
  state: MinesState,
  first: number,
  pick = randomInt,
) {
  const excluded = new Set([
    first,
    ...neighbors(first, state.rows, state.columns),
  ]);
  const candidates = Array.from(
    { length: state.rows * state.columns },
    (_, i) => i,
  ).filter((i) => !excluded.has(i));
  for (let i = 0; i < state.mineCount; i++) {
    const j = i + pick(candidates.length - i);
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, state.mineCount);
}
export function adjacent(state: MinesState, cell: number) {
  const mines = new Set(state.layout || []);
  return neighbors(cell, state.rows, state.columns).filter((i) => mines.has(i))
    .length;
}
export function expand(state: MinesState, first: number) {
  const mines = new Set(state.layout || []),
    seen = new Set(state.revealed),
    queue = [first];
  while (queue.length) {
    const cell = queue.pop()!;
    if (seen.has(cell) || mines.has(cell)) continue;
    seen.add(cell);
    if (adjacent(state, cell) === 0)
      queue.push(...neighbors(cell, state.rows, state.columns));
  }
  state.revealed = [...seen];
}
// Called inside the existing match transaction. A turn number rejects delayed clicks
// even when control has already passed back to the same player.
export function reveal(
  state: MinesState,
  player: number,
  cell: number,
  turn: number,
  requestId: string,
) {
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(requestId))
    throw Error("Invalid request ID.");
  const previous = state.moves.find((m) => m.requestId === requestId);
  if (previous) {
    if (previous.player !== player || previous.cell !== cell)
      throw Error("Request ID already used.");
    return undefined;
  }
  if (state.currentPlayer !== player)
    throw Error("It is your opponent’s turn.");
  if (turn !== state.moves.length)
    throw Error("The turn has changed. Refresh your board.");
  if (!Number.isInteger(cell) || cell < 0 || cell >= state.rows * state.columns)
    throw Error("Invalid tile.");
  if (state.revealed.includes(cell))
    throw Error("That tile is already revealed.");
  state.layout ||= generateLayout(state, cell);
  const mine = state.layout.includes(cell),
    before = state.revealed.length;
  if (mine) {
    state.revealed.push(cell);
    state.lives[player]--;
  } else expand(state, cell);
  state.moves.push({ requestId, player, cell });
  state.lastMove = {
    player,
    cell,
    mine,
    adjacent: mine ? 0 : adjacent(state, cell),
    opened: state.revealed.length - before,
  };
  const partner = player === 1 ? 2 : 1;
  if (state.lives[player] === 0)
    return { winner: partner, reason: "three_mines" };
  const safe = state.revealed.filter((i) => !state.layout!.includes(i)).length;
  if (safe === state.rows * state.columns - state.mineCount)
    return {
      winner:
        state.lives[1] === state.lives[2]
          ? null
          : state.lives[1] > state.lives[2]
            ? 1
            : 2,
      reason: "safe_cleared",
    };
  state.currentPlayer = partner;
  return undefined;
}
export function minesView(state: MinesState, over: boolean): MinesView {
  const { layout, moves, ...publicState } = state;
  const revealed = new Set(state.revealed),
    mines = new Set(layout || []);
  return {
    ...publicState,
    moveCount: moves.length,
    cells: Array.from({ length: state.rows * state.columns }, (_, i) =>
      !over && !revealed.has(i)
        ? null
        : mines.has(i)
          ? -1
          : layout
            ? adjacent(state, i)
            : null,
    ),
  };
}
