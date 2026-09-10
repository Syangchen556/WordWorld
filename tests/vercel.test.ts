import test from "node:test";
import assert from "node:assert/strict";
import { StateStore, hash } from "../server/state-store";
import { Game } from "../server/game";
import { resumeGame, heartbeat, saveLive } from "../server/live";
import { createEmbeddedDatabase } from "../server/test-database";
import { migrate, transact } from "../server/database";
function fixture() {
  const store = new StateStore(undefined, 10000);
  const setup = store.token("setup", null);
  const one = store.accept(setup, ["Violet", "Sunny"], "Us");
  const two = store.accept(one.invitation!);
  const game = resumeGame(store);
  game.pick = () => "APPLE";
  heartbeat(store, game, 1, "tab-one", one.session);
  heartbeat(store, game, 2, "tab-two", two.session);
  game.action(1, "ready");
  game.action(2, "ready");
  saveLive(store, game);
  return { store, one, two };
}
test("durable access only stores hashes and consumes invitations exactly once", () => {
  const s = new StateStore();
  const token = s.token("setup", null);
  assert.ok(s.inspect(token));
  const a = s.accept(token, ["A", "B"], "Room");
  assert.throws(() => s.accept(token, ["A", "B"], "Room"));
  assert.equal(s.session(a.session), 1);
  assert.ok(!JSON.stringify(s.data).includes(a.session));
  assert.ok(!JSON.stringify(s.data).includes(a.invitation!));
  assert.equal(s.data.profiles.length, 2);
  s.revoke(1, true);
  assert.equal(s.session(a.session), undefined);
});
test("fresh server instance resumes the same board without leaking the answer", () => {
  const { store, one } = fixture();
  store.now += 3000;
  let game = resumeGame(store);
  game.action(1, "guess", {
    roundId: game.round!.id,
    word: "CRANE",
    requestId: "request-one",
  });
  saveLive(store, game);
  const fresh = new StateStore(
    JSON.parse(JSON.stringify(store.data)),
    store.now + 1000,
  );
  game = resumeGame(fresh);
  heartbeat(fresh, game, 1, "new-tab", one.session);
  assert.equal(game.round!.guesses[1].length, 1);
  assert.equal(game.snapshot(2).match!.round!.guesses[1], undefined);
  assert.equal(game.snapshot(2).match!.round!.answers, undefined);
});
test("returning after both grace periods abandons before marking a player online", () => {
  const { store, one } = fixture();
  store.now += 60000;
  store.prune();
  const game = resumeGame(store);
  assert.equal(game.match!.status, "abandoned");
  assert.equal(game.match!.winner, null);
  heartbeat(store, game, 1, "new-tab", one.session);
  assert.equal(game.match!.status, "abandoned");
});
test("elapsed disconnect boundary wins over a later deadline, with no function timer", () => {
  const { store } = fixture();
  store.data.live.tabs["2:tab-two"].until = 300000;
  store.data.live.until[2] = 300000;
  store.now = 200000;
  const game = resumeGame(store);
  assert.equal(game.match!.reason, "disconnect");
  assert.equal(game.match!.winner, 2);
  assert.equal(game.match!.end, 45000);
});
test("multiple tabs keep presence when one leaves", () => {
  const { store, one } = fixture();
  const game = resumeGame(store);
  heartbeat(store, game, 1, "extra-tab", one.session);
  heartbeat(store, game, 1, "tab-one", one.session, true);
  assert.equal(game.snapshot(2).profiles[0].online, true);
  saveLive(store, game);
  store.now += 1000;
  assert.equal(resumeGame(store).snapshot(2).profiles[0].online, true);
});
test("PostgreSQL migration, transactional concurrency and rollback preserve shared records", async () => {
  const db = await createEmbeddedDatabase();
  try {
    await migrate(db);
    await migrate(db);
    await Promise.all(
      Array.from({ length: 12 }, () =>
        transact((s) => {
          s.data.limits.counter = {
            count: (s.data.limits.counter?.count || 0) + 1,
            until: s.now + 60000,
          };
        }, db),
      ),
    );
    assert.equal(await transact((s) => s.data.limits.counter.count, db), 12);
    await assert.rejects(
      transact((s) => {
        s.data.profiles = [];
        s.data.room = {
          name: "bad",
          description: "",
          icon: "♡",
          mode: "race",
          format: "single",
        };
        throw Error("rollback");
      }, db),
    );
    assert.equal(await transact((s) => s.room(), db), null);
    const token = await transact((s) => s.token("setup", null), db);
    const accepted = await transact(
      (s) => s.accept(token, ["A", "B"], "Us"),
      db,
    );
    assert.equal(await transact((s) => s.session(accepted.session), db), 1);
    assert.equal(await transact((s) => s.inspect(token), db), undefined);
    const raw = await transact((s) => JSON.stringify(s.data), db);
    assert.ok(!raw.includes(accepted.session));
    assert.ok(raw.includes(hash(accepted.session)));
  } finally {
    await db.end();
  }
});
test("correct guesses from independent transactions produce exactly one winner", async () => {
  const db = await createEmbeddedDatabase();
  try {
    await migrate(db);
    await transact((store) => {
      const access = store.accept(store.token("setup", null), ["A", "B"], "Us");
      const two = store.accept(access.invitation!);
      const game = new Game(
        store,
        () => store.now - 4000,
        () => "APPLE",
      );
      heartbeat(store, game, 1, "tab-one", access.session);
      heartbeat(store, game, 2, "tab-two", two.session);
      game.action(1, "ready");
      game.action(2, "ready");
      saveLive(store, game);
    }, db);
    const outcomes = await Promise.all(
      [1, 2].map((id) =>
        transact((store) => {
          const game = resumeGame(store);
          try {
            game.action(id, "guess", {
              roundId: game.round!.id,
              word: "APPLE",
              requestId: `request-${id}`,
            });
            saveLive(store, game);
            return "accepted";
          } catch {
            return "closed";
          }
        }, db),
      ),
    );
    assert.deepEqual(outcomes, ["accepted", "closed"]);
    assert.equal(await transact((s) => s.history().length, db), 1);
    assert.equal(await transact((s) => s.stats()[0].wins, db), 1);
  } finally {
    await db.end();
  }
});
