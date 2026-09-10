import { createHash, randomBytes } from "node:crypto";
import { Records } from "./records";
import type { Match, Profile, Room } from "./types";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export type GameStore = Records & {
  profiles(): Profile[];
  room(): Room | null;
  saveRoom(room: Room): void;
  saveMatch(match: Match): void;
  saveProfile(id: number, name: string, avatar: string): void;
  swapColors(): void;
};
type Token = {
  kind: "setup" | "access";
  player_id: number | null;
  expires: number;
};
type Session = { player_id: number; expires: number };
export type Data = {
  version: 1;
  profiles: Profile[];
  room: Room | null;
  tokens: Record<string, Token>;
  sessions: Record<string, Session>;
  matches: Record<string, Match>;
  live: {
    matchId: string | null;
    ready: number[];
    rematch: number[];
    swapRequest: number | null;
    tabs: Record<
      string,
      { player: number; sessionHash: string; until: number }
    >;
    until: Record<number, number>;
    updatedAt: number;
  };
  limits: Record<string, { count: number; until: number }>;
};
export const emptyData = (): Data => ({
  version: 1,
  profiles: [],
  room: null,
  tokens: {},
  sessions: {},
  matches: {},
  live: {
    matchId: null,
    ready: [],
    rematch: [],
    swapRequest: null,
    tabs: {},
    until: {},
    updatedAt: 0,
  },
  limits: {},
});
export class StateStore extends Records implements GameStore {
  constructor(
    public data: Data = emptyData(),
    public now = Date.now(),
  ) {
    super();
  }
  profiles() {
    return this.data.profiles;
  }
  room() {
    return this.data.room;
  }
  saveRoom(room: Room) {
    this.data.room = room;
  }
  saveProfile(id: number, name: string, avatar: string) {
    const p = this.data.profiles.find((p) => p.id === id);
    if (!p) throw Error("Unknown player.");
    p.name = name;
    p.avatar = avatar;
  }
  swapColors() {
    for (const p of this.data.profiles)
      p.color = p.color === "purple" ? "yellow" : "purple";
  }
  token(kind: Token["kind"], player: number | null, ttl = 86400000) {
    const token = randomBytes(32).toString("base64url");
    this.data.tokens[hash(token)] = {
      kind,
      player_id: player,
      expires: this.now + ttl,
    };
    return token;
  }
  inspect(token: string) {
    const t = this.data.tokens[hash(token)];
    return t && t.expires > this.now ? t : undefined;
  }
  session(token: string) {
    return this.sessionHash(hash(token));
  }
  sessionHash(key: string) {
    const s = this.data.sessions[key];
    return s && s.expires > this.now ? s.player_id : undefined;
  }
  accept(token: string, names?: string[], roomName?: string) {
    const t = this.inspect(token);
    if (!t)
      throw Error(
        "This link has expired or has already been used. Ask for a replacement link.",
      );
    let invitation: string | undefined;
    if (t.kind === "setup") {
      if (this.room()) throw Error("WordWorld is already set up.");
      if (
        !Array.isArray(names) ||
        names.length !== 2 ||
        names.some(
          (n) => typeof n !== "string" || !n.trim() || n.length > 24,
        ) ||
        typeof roomName !== "string" ||
        !roomName.trim() ||
        roomName.length > 40
      )
        throw Error(
          "Add two names (up to 24 characters) and a room name (up to 40).",
        );
      this.data.profiles = names.map((name, i) => ({
        id: i + 1,
        name: name.trim(),
        avatar: i === 0 ? "✿" : "✦",
        color: i === 0 ? "purple" : "yellow",
      }));
      this.saveRoom({
        name: roomName.trim(),
        description: "A little friendly competition. A lot of us.",
        icon: "✦",
        mode: "race",
        format: "single",
      });
      invitation = this.token("access", 2);
    }
    delete this.data.tokens[hash(token)];
    const session = randomBytes(32).toString("base64url"),
      player = t.player_id || 1;
    this.data.sessions[hash(session)] = {
      player_id: player,
      expires: this.now + 90 * 86400000,
    };
    return { session, player, invitation };
  }
  revoke(id: number, sessions = false) {
    for (const [h, t] of Object.entries(this.data.tokens))
      if (t.player_id === id) delete this.data.tokens[h];
    if (sessions) {
      for (const [h, s] of Object.entries(this.data.sessions))
        if (s.player_id === id) delete this.data.sessions[h];
      for (const [h, t] of Object.entries(this.data.live.tabs))
        if (t.player === id) delete this.data.live.tabs[h];
      this.data.live.until[id] = this.now;
    }
  }
  saveMatch(m: Match) {
    this.data.matches[m.id] = structuredClone(m);
  }
  history() {
    return Object.values(this.data.matches).sort((a, b) => b.start - a.start);
  }
  limit(key: string, max: number, window = 60000) {
    let l = this.data.limits[key];
    if (!l || l.until <= this.now)
      l = this.data.limits[key] = { count: 0, until: this.now + window };
    return ++l.count <= max;
  }
  prune() {
    for (const collection of [this.data.tokens, this.data.sessions])
      for (const [key, value] of Object.entries(collection))
        if (value.expires <= this.now) delete collection[key];
    for (const [key, value] of Object.entries(this.data.limits))
      if (value.until <= this.now) delete this.data.limits[key];
  }
}
