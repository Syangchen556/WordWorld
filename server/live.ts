import { Game } from "./game";
import { StateStore, hash } from "./state-store";
const PRESENCE_TTL = 5000;
export function resumeGame(store: StateStore) {
  const live = store.data.live;
  const game = new Game(store, () => store.now);
  game.match = live.matchId
    ? structuredClone(store.data.matches[live.matchId] || null)
    : null;
  game.ready = [...live.ready];
  game.rematch = [...live.rematch];
  game.swapRequest = live.swapRequest;
  const presence = (time: number) => {
    for (const id of [1, 2]) {
      const count = Object.values(live.tabs).filter(
        (t) =>
          t.player === id &&
          t.until > time &&
          store.sessionHash(t.sessionHash) === id,
      ).length;
      game.online.set(id, count);
      if (count) game.offlineAt.delete(id);
      else {
        game.offlineAt.set(id, live.until[id] || time);
        game.ready = game.ready.filter((p) => p !== id);
      }
    }
  };
  // Settle elapsed boundaries in chronological order, before a returning player
  // becomes online. At a tie, Game.tick settles the deadline before disconnects.
  // Recalculate after every boundary: an RPS result can schedule the next
  // countdown, whose start and deadline must also be settled chronologically.
  let cursor = live.updatedAt;
  while (cursor < store.now) {
    const r = game.round;
    const t = [
      r?.start,
      r?.deadline,
      r?.rps?.nextAt,
      ...Object.values(live.until).map((t) => t + 30000),
      store.now,
    ]
      .filter(
        (t): t is number =>
          typeof t === "number" && t > cursor && t <= store.now,
      )
      .sort((a, b) => a - b)[0];
    if (t === undefined) break;
    presence(t);
    game.now = () => t;
    game.tick();
    cursor = t;
  }
  game.now = () => store.now;
  presence(store.now);
  return game;
}
export function heartbeat(
  store: StateStore,
  game: Game,
  id: number,
  tab: string,
  session: string,
  leave = false,
) {
  const live = store.data.live,
    key = `${id}:${tab}`;
  const until = store.now + (leave ? 0 : PRESENCE_TTL);
  live.tabs[key] = { player: id, sessionHash: hash(session), until };
  live.until[id] = Math.max(
    until,
    ...Object.values(live.tabs)
      .filter((t) => t.player === id)
      .map((t) => t.until),
  );
  for (const player of [1, 2]) {
    game.online.set(
      player,
      Object.values(live.tabs).filter(
        (t) =>
          t.player === player &&
          t.until > store.now &&
          store.sessionHash(t.sessionHash) === player,
      ).length,
    );
    if (game.online.get(player)) game.offlineAt.delete(player);
    else game.offlineAt.set(player, live.until[player] || store.now);
  }
  // Resume a waiting RPS series only after current presence is known.
  if (game.round?.rps && game.round.phase === "ended") game.tick();
}
export function saveLive(store: StateStore, game: Game) {
  for (const [key, t] of Object.entries(store.data.live.tabs))
    if (t.until + 30000 < store.now || !store.sessionHash(t.sessionHash))
      delete store.data.live.tabs[key];
  game.persist();
  Object.assign(store.data.live, {
    matchId: game.match?.id || null,
    ready: game.ready,
    rematch: game.rematch,
    swapRequest: game.swapRequest,
    updatedAt: store.now,
  });
}
