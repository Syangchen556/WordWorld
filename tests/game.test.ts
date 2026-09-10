import test from "node:test";
import assert from "node:assert/strict";
import { Store, hash } from "../server/store";
import { Game, validWord } from "../server/game";
import { score } from "../server/types";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
function fixture(
  mode: "race" | "swap" = "race",
  format: "single" | "series" = "single",
) {
  const store = new Store(":memory:");
  const access = store.accept(
    store.token("setup", null),
    ["Violet", "Sunny"],
    "Our room",
  );
  const session2 = store.accept(access.invitation!);
  store.saveRoom({ ...store.room()!, mode, format });
  let time = 10000;
  const game = new Game(
    store,
    () => time,
    () => "APPLE",
  );
  game.connect(1);
  game.connect(2);
  return {
    store,
    game,
    access,
    session2,
    advance: (ms: number) => {
      time += ms;
      game.tick();
    },
    start: () => {
      game.action(1, "ready");
      game.action(2, "ready");
    },
    guess: (id: number, word: string, requestId = `request-${Math.random()}`) =>
      game.action(id, "guess", {
        word,
        roundId: game.round!.id,
        requestId: requestId.replace(".", "-"),
      }),
  };
}
test("repeated letters are scored exact-first with bounded counts", () => {
  assert.deepEqual(score("ALLEY", "APPLE"), [
    "correct",
    "present",
    "absent",
    "present",
    "absent",
  ]);
  assert.deepEqual(score("PUPPY", "APPLE"), [
    "present",
    "absent",
    "correct",
    "absent",
    "absent",
  ]);
  assert.deepEqual(score("APPLE", "APPLE"), Array(5).fill("correct"));
});
test("dictionary rejects malformed and nonsense input", () => {
  assert.ok(validWord("CRANE"));
  assert.ok(validWord("APPLE"));
  for (const s of ["XXXXX", "apple", "TOO", "AAAAAA", "12ABC"])
    assert.equal(validWord(s), false);
});
test("setup requires a generated secret and accepts only once; sessions survive", () => {
  const f = fixture();
  assert.equal(f.store.session(f.access.session), 1);
  assert.equal(f.store.session(f.session2.session), 2);
  assert.equal(f.store.session("made-up"), undefined);
  assert.throws(() => f.store.accept(f.access.invitation!));
  assert.equal(f.store.profiles().length, 2);
  const rows = f.store.db.prepare("SELECT hash FROM sessions").all() as {
    hash: string;
  }[];
  assert.ok(
    rows.every((r) => r.hash !== f.access.session && r.hash.length === 64),
  );
  assert.throws(() => f.store.accept("unknown"));
});
test("access inspection does not consume links; expiry and revocation work", () => {
  const f = fixture();
  const t = f.store.token("access", 1);
  assert.ok(f.store.inspect(t));
  assert.ok(f.store.inspect(t));
  f.store.accept(t);
  assert.equal(f.store.inspect(t), undefined);
  const expired = f.store.token("access", 2, -1);
  assert.equal(f.store.inspect(expired), undefined);
  f.store.db
    .prepare("DELETE FROM sessions WHERE hash=?")
    .run(hash(f.access.session));
  assert.equal(f.store.session(f.access.session), undefined);
});
test("countdown, secret privacy, invalid guesses and idempotent retries", () => {
  const f = fixture();
  f.start();
  assert.equal(f.game.round!.phase, "countdown");
  assert.throws(() => f.guess(1, "CRANE"));
  f.advance(3000);
  assert.equal(f.game.round!.phase, "playing");
  assert.throws(() => f.guess(1, "ZZZZZ"));
  assert.equal(f.game.round!.guesses[1].length, 0);
  f.guess(1, "CRANE", "request-one");
  f.guess(1, "CRANE", "request-one");
  assert.equal(f.game.round!.guesses[1].length, 1);
  const snap = f.game.snapshot(2);
  assert.equal(snap.match!.round!.answers, undefined);
  assert.equal(snap.match!.round!.guesses[1], undefined);
  assert.equal(snap.match!.round!.counts[1], 1);
  assert.ok(!JSON.stringify(snap).includes("APPLE"));
  assert.ok(!JSON.stringify(snap).includes("CRANE"));
});
test("first accepted correct guess wins and finalization is immutable", () => {
  const f = fixture();
  f.start();
  f.advance(3000);
  f.guess(2, "APPLE", "winner-id");
  assert.throws(() => f.guess(1, "APPLE"));
  f.guess(2, "APPLE", "winner-id");
  assert.equal(f.game.match!.winner, 2);
  assert.equal(f.store.stats()[1].wins, 1);
  assert.equal(f.store.history().length, 1);
  assert.equal(f.game.snapshot(1).match!.round!.answers![1], "APPLE");
});
test("attempt limit allows partner to continue, then draws", () => {
  const f = fixture();
  f.start();
  f.advance(3000);
  for (let i = 0; i < 6; i++) f.guess(1, "CRANE");
  assert.equal(f.game.match!.status, "active");
  assert.throws(() => f.guess(1, "APPLE"));
  for (let i = 0; i < 6; i++) f.guess(2, "CRANE");
  assert.equal(f.game.match!.winner, null);
  assert.equal(f.game.match!.status, "completed");
  assert.equal(f.store.stats()[0].draws, 1);
});
test("deadline rejects late correct guess and wins over disconnect expiry", () => {
  const f = fixture();
  f.start();
  f.advance(3000);
  f.game.disconnect(1);
  f.advance(180000);
  assert.equal(f.game.match!.reason, "time_up");
  assert.equal(f.game.match!.winner, null);
  assert.throws(() => f.guess(2, "APPLE"));
});
test("Word Swap locks private words for opposite players and starts together", () => {
  const f = fixture("swap");
  f.start();
  const roundId = f.game.round!.id;
  assert.equal(f.game.round!.phase, "preparing");
  assert.throws(() => f.game.action(1, "lock", { roundId, word: "QQQQQ" }));
  f.game.action(1, "lock", { roundId, word: "HEART" });
  assert.throws(() => f.game.action(1, "lock", { roundId, word: "APPLE" }));
  assert.ok(!JSON.stringify(f.game.snapshot(2)).includes("HEART"));
  f.game.action(2, "lock", { roundId, word: "CLOUD" });
  assert.equal(f.game.round!.phase, "countdown");
  f.advance(3000);
  f.guess(1, "CLOUD");
  assert.equal(f.game.match!.winner, 1);
  assert.equal(f.game.round!.answers[2], "HEART");
});
test("series requires mutual readiness, draws add no points, first to three wins", () => {
  const f = fixture("race", "series");
  f.start();
  f.advance(183000);
  assert.equal(f.game.match!.status, "active");
  assert.equal(f.game.match!.score[1], 0);
  for (let i = 0; i < 3; i++) {
    const roundId = f.game.round!.id;
    f.game.action(1, "ready", { roundId });
    assert.equal(f.game.round!.phase, "ended");
    f.game.action(2, "ready", { roundId });
    assert.notEqual(f.game.round!.id, roundId);
    assert.throws(() =>
      f.game.action(1, "guess", {
        roundId,
        word: "APPLE",
        requestId: "stale-request",
      }),
    );
    f.advance(3000);
    f.guess(1, "APPLE");
  }
  assert.equal(f.game.match!.status, "completed");
  assert.equal(f.game.match!.score[1], 3);
  assert.equal(f.store.stats()[0].wins, 1);
  assert.equal(f.store.stats()[0].rounds, 4);
});
test("concession is a labeled match result and rematches require two accepts", () => {
  const f = fixture();
  f.start();
  const old = f.game.match!.id;
  f.game.action(1, "concede", { matchId: old });
  assert.equal(f.store.stats()[1].wins, 1);
  assert.equal(f.game.match!.reason, "conceded");
  f.game.action(1, "rematch", { matchId: old });
  assert.equal(f.game.match!.id, old);
  f.game.action(2, "rematch", { matchId: old });
  assert.notEqual(f.game.match!.id, old);
  assert.throws(() => f.game.action(1, "concede", { matchId: old }));
});
test("multiple tabs keep presence; reconnection keeps the same board", () => {
  const f = fixture();
  f.start();
  f.advance(3000);
  f.guess(1, "CRANE");
  f.game.connect(1);
  f.game.disconnect(1);
  assert.equal(f.game.snapshot(2).profiles[0].online, true);
  f.game.disconnect(1);
  f.advance(29000);
  f.game.connect(1);
  f.advance(1001);
  assert.equal(f.game.match!.status, "active");
  assert.equal(f.game.snapshot(1).match!.round!.guesses[1].length, 1);
});
test("disconnect grace forfeits to remaining player; two absent abandon", () => {
  const f = fixture();
  f.start();
  f.game.disconnect(1);
  f.advance(30000);
  assert.equal(f.game.match!.winner, 2);
  assert.equal(f.game.match!.reason, "disconnect");
  const g = fixture();
  g.start();
  g.game.disconnect(1);
  g.game.disconnect(2);
  g.advance(30000);
  assert.equal(g.game.match!.status, "abandoned");
  assert.equal(g.store.stats()[0].played, 0);
  const lobby = fixture();
  lobby.game.disconnect(1);
  lobby.advance(999999);
  assert.equal(lobby.store.history().length, 0);
});
test("room edits reset readiness and stable identity survives name/color swaps", () => {
  const f = fixture();
  f.game.action(1, "ready");
  f.game.action(2, "settings", { ...f.store.room(), name: "New name" });
  assert.deepEqual(f.game.ready, []);
  f.game.action(1, "profile", { name: "Iris", avatar: "♡" });
  f.game.action(1, "swapColors");
  assert.equal(f.store.profiles()[0].color, "purple");
  f.game.action(2, "swapColors");
  assert.equal(f.store.profiles()[0].color, "yellow");
  assert.equal(f.store.profiles()[0].id, 1);
  assert.equal(f.store.room()!.name, "New name");
});
test("statistics use correct solves, include draws and forfeits, and separate modes", () => {
  const f = fixture();
  f.start();
  f.advance(4000);
  f.guess(1, "CRANE");
  f.advance(1000);
  f.guess(1, "APPLE");
  let s = f.store.stats()[0];
  assert.equal(s.fastest, 2000);
  assert.equal(s.averageGuesses, 2);
  assert.equal(s.solveRate, 1);
  assert.equal(s.currentStreak, 1);
  f.game.action(1, "return");
  f.start();
  f.advance(183000);
  s = f.store.stats()[0];
  assert.equal(s.played, 2);
  assert.equal(s.winRate, 0.5);
  assert.equal(s.currentStreak, 0);
  assert.equal(s.bestStreak, 1);
  assert.equal(s.solveRate, 0.5);
  assert.equal(f.store.stats("swap")[0].played, 0);
});
test("restart abandons unresolved state and preserves completed records", () => {
  const f = fixture();
  f.start();
  f.store.recover();
  const m = f.store.history()[0];
  assert.equal(m.status, "abandoned");
  assert.equal(m.rounds[0].phase, "abandoned");
  assert.equal(f.store.stats()[0].wins, 0);
  assert.equal(f.store.room()!.name, "Our room");
});
test("SQLite online backup is consistent and restores persistent identities/results", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wordworld-test-"));
  try {
    const f = fixture();
    f.start();
    f.advance(3000);
    f.guess(1, "APPLE");
    const path = join(dir, "backup.sqlite");
    await f.store.db.backup(path);
    const copy = new Store(path);
    assert.equal(copy.db.pragma("integrity_check", { simple: true }), "ok");
    assert.equal(copy.stats()[0].wins, 1);
    assert.equal(copy.profiles().length, 2);
    assert.equal(copy.session(f.access.session), 1);
    copy.db.close();
    f.store.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("personal bests are strict improvements and update during a series", () => {
  const f = fixture("race", "series");
  f.start();
  f.advance(4000);
  f.guess(1, "APPLE");
  const first = f.game.round!.id;
  assert.ok(f.store.personalBests()[first].includes(1));
  assert.equal(f.store.stats()[0].played, 0);
  assert.equal(f.store.stats()[0].solved, 1);
  f.game.action(1, "ready", { roundId: first });
  f.game.action(2, "ready", { roundId: first });
  f.advance(4000);
  f.guess(1, "APPLE");
  assert.equal(f.store.personalBests()[f.game.round!.id], undefined);
  f.store.recover();
  assert.equal(f.store.stats()[0].played, 0);
  assert.equal(f.store.stats()[0].solved, 2);
});
test("forfeit during countdown does not count an unstarted round", () => {
  const f = fixture();
  f.start();
  f.game.action(1, "concede", { matchId: f.game.match!.id });
  assert.equal(f.store.stats()[0].rounds, 0);
  assert.equal(f.store.stats()[1].wins, 1);
});
test("unauthorized identity and stale events cannot mutate the room", () => {
  const f = fixture();
  assert.throws(() => f.game.action(3, "ready"));
  assert.deepEqual(f.game.ready, []);
  f.start();
  assert.throws(() =>
    f.game.action(1, "settings", { ...f.store.room(), name: "Changed" }),
  );
  assert.equal(f.store.room()!.name, "Our room");
});
