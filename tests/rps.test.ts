import test from "node:test";
import assert from "node:assert/strict";
import { choices, rpsWinner, type Choice } from "../server/rps";
import { StateStore } from "../server/state-store";
import { Game } from "../server/game";
import { heartbeat, resumeGame, saveLive } from "../server/live";
import { createEmbeddedDatabase } from "../server/test-database";
import { migrate, transact } from "../server/database";
import type { Format } from "../server/types";

function fixture(format: Format = "single") {
  const store = new StateStore(undefined, 10000);
  const one = store.accept(store.token("setup", null), ["A", "B"], "Room");
  const two = store.accept(one.invitation!);
  store.saveRoom({ ...store.room()!, mode: "rps", format });
  const game = new Game(store, () => store.now);
  heartbeat(store, game, 1, "tab-one", one.session);
  heartbeat(store, game, 2, "tab-two", two.session);
  game.action(1, "ready");
  game.action(2, "ready");
  return { game, store, one, two };
}
function lock(game: Game, id: number, choice: Choice, extra = {}) {
  game.action(id, "rpsLock", {
    matchId: game.match!.id,
    roundId: game.round!.id,
    choice,
    requestId: `choice-${id}-${game.round!.number}`,
    ...extra,
  });
}
function open(f: ReturnType<typeof fixture>) {
  f.store.now = f.game.round!.start;
  f.game.tick();
}

const outcomes = [
  [null, 2, 1],
  [1, null, 2],
  [2, 1, null],
];
for (const [i, one] of choices.entries())
  for (const [j, two] of choices.entries())
    test(`${one} against ${two}: winner ${outcomes[i][j] ?? "draw"}`, () => {
      assert.equal(rpsWinner(one, two), outcomes[i][j]);
      const f = fixture();
      open(f);
      lock(f.game, 1, one);
      lock(f.game, 2, two);
      assert.equal(f.game.match!.winner, outcomes[i][j]);
      assert.equal(f.game.match!.status, "completed");
      assert.equal(f.game.round!.reason, "rps_normal");
      assert.equal(
        f.game.match!.score[1] + f.game.match!.score[2],
        one === two ? 0 : 1,
      );
    });
test("locked selection stays private through snapshots and unresolved choice statistics", () => {
  const f = fixture();
  open(f);
  lock(f.game, 1, "scissors");
  const own = f.game.snapshot(1),
    other = f.game.snapshot(2);
  assert.equal(own.match!.round!.rps!.choices[1], "scissors");
  assert.deepEqual(other.match!.round!.rps!.choices, {});
  assert.deepEqual(other.match!.round!.locked, [1]);
  assert.equal(
    other.match!.round!.rps && "requests" in other.match!.round!.rps!,
    false,
  );
  assert.equal(other.rpsStats[0].choices.scissors, 0);
  lock(f.game, 2, "paper");
  assert.deepEqual(f.game.snapshot(2).match!.round!.rps!.choices, {
    1: "scissors",
    2: "paper",
  });
  assert.equal(f.store.rpsStats()[0].choices.scissors, 1);
});
test("authentication, IDs, choices, countdown, locking and retry validation", () => {
  const f = fixture();
  assert.throws(() => lock(f.game, 1, "rock"), /closed/);
  open(f);
  assert.throws(() => lock(f.game, 3, "rock"), /Unauthorized/);
  assert.throws(() => lock(f.game, 1, "rock", { matchId: "old" }), /changed/);
  assert.throws(() => lock(f.game, 1, "rock", { roundId: "old" }), /changed/);
  assert.throws(
    () => lock(f.game, 1, "rock", { choice: "lizard" }),
    /Choose rock/,
  );
  assert.throws(
    () => lock(f.game, 1, "rock", { requestId: "x" }),
    /request ID/,
  );
  lock(f.game, 1, "rock");
  const before = JSON.stringify(f.game.match);
  lock(f.game, 1, "rock");
  assert.equal(JSON.stringify(f.game.match), before);
  assert.throws(() => lock(f.game, 1, "paper"), /locked/);
  lock(f.game, 2, "scissors");
  lock(f.game, 2, "scissors");
  assert.equal(f.game.match!.score[1], 1);
  assert.throws(
    () => lock(f.game, 2, "paper", { requestId: "different" }),
    /closed/,
  );
});
test("one lock wins by deadline; late second lock is rejected; neither lock abandons", () => {
  const f = fixture();
  open(f);
  lock(f.game, 2, "paper");
  f.store.now = f.game.round!.deadline;
  assert.throws(() => lock(f.game, 1, "scissors"), /closed/);
  assert.equal(f.game.match!.winner, 2);
  assert.equal(f.game.match!.reason, "rps_timeout");
  assert.equal(f.game.round!.rps!.choices[1], undefined);
  const empty = fixture();
  empty.store.now = empty.game.round!.deadline;
  empty.game.tick();
  assert.equal(empty.game.match!.status, "abandoned");
  assert.equal(empty.game.match!.reason, "inactivity");
  assert.equal(empty.store.stats("rps")[0].played, 0);
  assert.equal(empty.store.rpsStats()[0].draws, 0);
});
for (const [format, target] of [
  ["series", 3],
  ["first5", 5],
] as const)
  test(`${format} draws continue and stops exactly at ${target} wins`, () => {
    const f = fixture(format);
    open(f);
    lock(f.game, 1, "rock");
    lock(f.game, 2, "rock");
    assert.equal(f.game.match!.score[1], 0);
    assert.equal(f.game.match!.status, "active");
    for (let win = 1; win <= target; win++) {
      f.store.now = f.game.round!.rps!.nextAt;
      f.game.tick();
      assert.equal(f.game.round!.phase, "countdown");
      open(f);
      lock(f.game, 1, "paper");
      lock(f.game, 2, "rock");
      assert.equal(f.game.match!.score[1], win);
    }
    const id = f.game.round!.id;
    f.store.now += 99999;
    f.game.tick();
    assert.equal(f.game.match!.status, "completed");
    assert.equal(f.game.match!.winner, 1);
    assert.equal(f.game.round!.id, id);
    assert.equal(f.game.match!.rounds.length, target + 1);
    assert.equal(f.store.rpsStats()[0].wins, target);
    assert.equal(f.store.rpsStats()[0].draws, 1);
    assert.equal(f.store.stats("race")[0].played, 0);
    assert.equal(f.store.stats()[0].rounds, 0);
  });
test("series waits for offline partner, resumes on reconnect and rejects stale locks", () => {
  const f = fixture("series");
  open(f);
  lock(f.game, 1, "rock");
  lock(f.game, 2, "paper");
  const old = f.game.round!.id;
  f.game.disconnect(2);
  f.store.now += 4000;
  f.game.tick();
  assert.equal(f.game.round!.id, old);
  f.game.connect(2);
  f.game.tick();
  assert.notEqual(f.game.round!.id, old);
  open(f);
  assert.throws(() => lock(f.game, 1, "rock", { roundId: old }), /changed/);
});
test("disconnect between rounds forfeits once and does not start another countdown", () => {
  const f = fixture("series");
  open(f);
  lock(f.game, 1, "rock");
  lock(f.game, 2, "paper");
  f.game.disconnect(2);
  f.store.now += 30000;
  f.game.tick();
  assert.equal(f.game.match!.reason, "disconnect");
  assert.equal(f.game.match!.winner, 1);
  assert.equal(f.game.match!.rounds.length, 1);
  assert.equal(f.store.stats("rps")[0].wins, 1);
  assert.equal(f.store.rpsStats()[0].losses, 1);
});
test("both disconnected between rounds abandon without awarding a match win", () => {
  const f = fixture("series");
  open(f);
  lock(f.game, 1, "rock");
  lock(f.game, 2, "paper");
  f.game.disconnect(1);
  f.game.disconnect(2);
  f.store.now += 30000;
  f.game.tick();
  assert.equal(f.game.match!.status, "abandoned");
  assert.equal(f.game.match!.winner, null);
  assert.equal(f.store.stats("rps")[1].wins, 0);
});
test("fresh instance restores locked choice, tabs share one identity, timeout survives refresh", () => {
  const f = fixture();
  open(f);
  lock(f.game, 1, "rock");
  heartbeat(f.store, f.game, 1, "tab-extra", f.one.session);
  saveLive(f.store, f.game);
  f.store.now += 1000;
  const resumed = resumeGame(f.store);
  assert.equal(resumed.snapshot(1).match!.round!.rps!.choices[1], "rock");
  assert.throws(() => lock(resumed, 1, "paper"), /locked/);
  heartbeat(f.store, resumed, 1, "tab-one", f.one.session, true);
  assert.equal(resumed.snapshot(2).profiles[0].online, true);
  saveLive(f.store, resumed);
  f.store.now = f.game.round!.deadline;
  const timed = resumeGame(f.store);
  assert.equal(timed.match!.reason, "rps_timeout");
});
test("chronological resume follows new round deadlines without extending selection time", () => {
  const f = fixture("series");
  open(f);
  lock(f.game, 1, "rock");
  lock(f.game, 2, "rock");
  heartbeat(f.store, f.game, 1, "tab-one", f.one.session);
  heartbeat(f.store, f.game, 2, "tab-two", f.two.session);
  saveLive(f.store, f.game);
  // Both online at nextAt=16000. The newly started round expires at 29000.
  f.store.now = 31000;
  const resumed = resumeGame(f.store);
  assert.equal(resumed.match!.rounds.length, 2);
  assert.equal(resumed.match!.reason, "inactivity");
  assert.equal(resumed.match!.end, 29000);
});
test("rematch needs both accepts, resets locks and score, and retains first-to-five", () => {
  const f = fixture("first5");
  open(f);
  lock(f.game, 1, "rock");
  const id = f.game.match!.id;
  f.game.action(1, "concede", { matchId: id });
  f.game.action(1, "rematch", { matchId: id });
  assert.equal(f.game.match!.id, id);
  f.game.action(2, "rematch", { matchId: id });
  assert.notEqual(f.game.match!.id, id);
  assert.equal(f.game.match!.format, "first5");
  assert.deepEqual(f.game.round!.rps!.choices, {});
  assert.deepEqual(f.game.match!.score, { 1: 0, 2: 0 });
  assert.equal(f.game.round!.phase, "countdown");
  assert.equal(f.store.rpsStats()[0].choices.rock, 0);
});
test("match streaks reset on draws/losses, resolved choices exclude active rounds", () => {
  const f = fixture();
  open(f);
  lock(f.game, 1, "paper");
  lock(f.game, 2, "rock");
  f.store.now += 100;
  f.game.start("rps", "single");
  open(f);
  lock(f.game, 1, "rock");
  lock(f.game, 2, "rock");
  assert.equal(f.store.stats("rps")[0].currentStreak, 0);
  assert.equal(f.store.stats("rps")[0].bestStreak, 1);
  f.store.now += 100;
  f.game.start("rps", "single");
  open(f);
  lock(f.game, 1, "scissors");
  assert.equal(f.store.rpsStats()[0].choices.scissors, 0);
  assert.equal(f.store.rpsStats()[0].choices.rock, 1);
});
test("independent SQL transactions resolve simultaneous locked choices exactly once", async () => {
  const db = await createEmbeddedDatabase();
  try {
    await migrate(db);
    const ids = await transact((s) => {
      s.accept(s.token("setup", null), ["A", "B"], "Room");
      const g = new Game(s, () => s.now);
      g.start("rps", "single");
      g.round!.phase = "playing";
      g.round!.start = s.now - 1;
      g.round!.deadline = s.now + 60000;
      saveLive(s, g);
      return { matchId: g.match!.id, roundId: g.round!.id };
    }, db);
    await Promise.all(
      [1, 2].map((id) =>
        transact((s) => {
          const g = new Game(s, () => s.now);
          g.match = structuredClone(s.data.matches[ids.matchId]);
          g.action(id, "rpsLock", {
            ...ids,
            choice: id === 1 ? "rock" : "scissors",
            requestId: `concurrent-${id}`,
          });
        }, db),
      ),
    );
    await transact((s) => {
      assert.equal(s.data.matches[ids.matchId].score[1], 1);
      assert.equal(s.data.matches[ids.matchId].winner, 1);
      assert.equal(s.rpsStats()[0].choices.rock, 1);
    }, db);
  } finally {
    await db.end();
  }
});
