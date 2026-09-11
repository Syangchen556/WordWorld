import test from "node:test";
import assert from "node:assert/strict";
import {
  adjacent,
  createMines,
  expand,
  generateLayout,
  minesView,
  neighbors,
  reveal,
  type Difficulty,
} from "../server/minesweeper";
import { StateStore } from "../server/state-store";
import { Game } from "../server/game";
import { resumeGame, saveLive } from "../server/live";
import { createEmbeddedDatabase } from "../server/test-database";
import { migrate, transact } from "../server/database";

function fixture(difficulty: Difficulty = "easy") {
  const store = new StateStore(undefined, 10000);
  store.accept(store.token("setup", null), ["A", "B"], "Room");
  store.saveRoom({ ...store.room()!, mode: "minesweeper", difficulty });
  const game = new Game(store, () => store.now);
  game.connect(1);
  game.connect(2);
  game.action(1, "ready");
  game.action(2, "ready");
  return { store, game, board: game.round!.mines! };
}
function move(game: Game, player: number, cell: number, extra = {}) {
  game.action(player, "reveal", {
    matchId: game.match!.id,
    roundId: game.round!.id,
    cell,
    turn: game.round!.mines!.moves.length,
    requestId: `request-${game.round!.mines!.moves.length}`,
    ...extra,
  });
}
for (const [difficulty, count] of [
  ["easy", 10],
  ["medium", 25],
  ["hard", 50],
] as const)
  test(`${difficulty}: exact mine count and safe first cell and neighbors`, () => {
    for (let first = 0; first < createMines(difficulty).rows ** 2; first++) {
      const board = createMines(difficulty),
        layout = generateLayout(board, first);
      assert.equal(layout.length, count);
      assert.equal(new Set(layout).size, count);
      for (const cell of [
        first,
        ...neighbors(first, board.rows, board.columns),
      ])
        assert.ok(!layout.includes(cell));
      assert.ok(layout.every((i) => i >= 0 && i < board.rows * board.columns));
    }
  });
test("adjacent counts respect corners and row boundaries; flood opens zero area and borders", () => {
  const b = createMines("easy");
  b.rows = 3;
  b.columns = 3;
  b.mineCount = 1;
  b.layout = [0];
  assert.equal(adjacent(b, 4), 1);
  assert.equal(adjacent(b, 8), 0);
  assert.equal(adjacent(b, 2), 0);
  expand(b, 8);
  assert.deepEqual(b.revealed.sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
});
test("safe moves switch once after expansion without losing lives; layouts persist", () => {
  const { game, board } = fixture();
  move(game, 1, 27);
  assert.ok(board.revealed.length > 1);
  assert.equal(board.currentPlayer, 2);
  assert.equal(board.moves.length, 1);
  assert.deepEqual(board.lives, { 1: 3, 2: 3 });
  const layout = [...board.layout!];
  move(game, 2, layout[0]);
  assert.deepEqual(board.layout, layout);
  assert.equal(board.currentPlayer, 1);
  assert.equal(board.lives[2], 2);
  assert.equal(board.lives[1], 3);
});
test("wrong player, revealed safe/mine, malformed, stale and duplicate moves are guarded", () => {
  const { game, board } = fixture();
  assert.throws(() => move(game, 2, 0), /opponent/);
  assert.throws(() => move(game, 1, -1), /Invalid tile/);
  assert.throws(() => move(game, 1, 0, { turn: -1 }), /turn has changed/);
  move(game, 1, 0);
  const snapshot = JSON.stringify(board);
  move(game, 1, 0, { turn: 0, requestId: "request-0" });
  assert.equal(JSON.stringify(board), snapshot);
  assert.throws(() => move(game, 2, 0), /already revealed/);
  const mine = board.layout![0];
  move(game, 2, mine);
  assert.throws(() => move(game, 1, mine), /already revealed/);
  assert.throws(
    () => move(game, 1, board.layout![1], { turn: 0 }),
    /turn has changed/,
  );
  assert.throws(
    () => move(game, 1, board.layout![1], { matchId: "old" }),
    /match has changed/,
  );
  assert.throws(() => game.action(1, "guess", {}), /Select a tile/);
});
test("third mine ends the match immediately and records a single winner", () => {
  const { game, board, store } = fixture();
  board.layout = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (const cell of [0, 1, 2, 3, 4]) move(game, board.currentPlayer, cell);
  assert.equal(board.lives[1], 0);
  assert.equal(board.lives[2], 1);
  assert.equal(game.match!.winner, 2);
  assert.equal(game.match!.reason, "three_mines");
  assert.equal(game.match!.status, "completed");
  assert.equal(store.stats("minesweeper")[1].wins, 1);
  assert.throws(() => move(game, 2, 5), /ended/);
  assert.equal(store.stats()[0].rounds, 0);
});
for (const [lives, winner] of [
  [{ 1: 3, 2: 2 }, 1],
  [{ 1: 1, 2: 2 }, 2],
  [{ 1: 3, 2: 3 }, null],
] as const)
  test(`last safe cell compares remaining lives (${winner ?? "draw"})`, () => {
    const { game, board } = fixture();
    board.layout = Array.from({ length: 10 }, (_, i) => i);
    board.revealed = Array.from({ length: 53 }, (_, i) => i + 10);
    board.lives = { ...lives };
    move(game, 1, 63);
    assert.equal(game.match!.status, "completed");
    assert.equal(game.match!.winner, winner);
    assert.equal(game.match!.reason, "safe_cleared");
  });
test("both snapshots share revealed information and never expose hidden layout", () => {
  const { game, board } = fixture();
  move(game, 1, 27);
  const a = game.snapshot(1).match!.round!.mines!,
    b = game.snapshot(2).match!.round!.mines!;
  assert.deepEqual(a, b);
  assert.ok(!("layout" in a));
  assert.ok(!("moves" in a));
  for (const i of board.layout!) assert.equal(a.cells[i], null);
  assert.equal(a.cells[27], 0);
  move(game, 2, board.layout![0]);
  assert.equal(
    game.snapshot(1).match!.round!.mines!.cells[board.layout![0]],
    -1,
  );
});
test("rematch preserves difficulty but resets layout, lives, turns and request IDs", () => {
  const { game, board } = fixture("hard");
  move(game, 1, 100);
  const oldId = game.match!.id;
  game.action(2, "concede", { matchId: oldId });
  game.action(1, "rematch", { matchId: oldId });
  game.action(2, "rematch", { matchId: oldId });
  const fresh = game.round!.mines!;
  assert.notEqual(game.match!.id, oldId);
  assert.equal(fresh.difficulty, "hard");
  assert.equal(fresh.layout, null);
  assert.deepEqual(fresh.revealed, []);
  assert.deepEqual(fresh.lives, { 1: 3, 2: 3 });
  assert.equal(fresh.currentPlayer, 1);
  assert.equal(fresh.moves.length, 0);
  move(game, 1, 255);
  assert.ok(!fresh.layout!.includes(255));
  assert.notEqual(fresh.layout, board.layout);
});
test("persisted Minesweeper resumes without a word timer and disconnect still forfeits", () => {
  const { game, store } = fixture();
  move(game, 1, 0);
  saveLive(store, game);
  store.data.live.until = { 1: 1000000, 2: 1000000 };
  // Direct engine tick verifies only Minesweeper's timer exemption.
  store.now += 200000;
  game.tick();
  assert.equal(game.match!.status, "active");
  const fresh = resumeGame(new StateStore(structuredClone(store.data), 11000));
  assert.deepEqual(fresh.round!.mines, game.round!.mines);
  game.disconnect(2);
  store.now += 30000;
  game.tick();
  assert.equal(game.match!.winner, 1);
  assert.equal(game.match!.reason, "disconnect");
});
test("old word rooms without difficulty still start race and swap unchanged", () => {
  const { store } = fixture();
  delete store.room()!.difficulty;
  for (const mode of ["race", "swap"] as const) {
    const game = new Game(store);
    game.start(mode, "series");
    assert.equal(game.round!.mines, undefined);
    assert.equal(game.match!.format, "series");
    assert.equal(
      game.round!.phase,
      mode === "race" ? "countdown" : "preparing",
    );
  }
});
test("SQL transactions reject simultaneous/stale clicks and preserve one shared move", async () => {
  const db = await createEmbeddedDatabase();
  try {
    await migrate(db);
    const { store } = fixture();
    const game = new Game(store, () => store.now);
    game.start("minesweeper", "single");
    saveLive(store, game);
    await transact((s) => {
      s.data = structuredClone(store.data);
    }, db);
    const results = await Promise.allSettled(
      [1, 2].map((cell) =>
        transact((s) => {
          const b = s.data.matches[game.match!.id].rounds[0].mines!;
          reveal(b, 1, cell, 0, `parallel-${cell}`);
        }, db),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    await transact((s) => {
      const b = s.data.matches[game.match!.id].rounds[0].mines!;
      assert.equal(b.moves.length, 1);
      assert.equal(minesView(b, false).moveCount, 1);
    }, db);
  } finally {
    await db.end();
  }
});
