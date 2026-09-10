import "dotenv/config";
import { Records } from "./records";
import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import type { Match, Profile, Room } from "./types";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export class Store extends Records {
  db: Database.Database;
  constructor(path = process.env.DATABASE_PATH || "./data/wordworld.sqlite") {
    super();
    mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(
      readFileSync(new URL("./001-initial.sql", import.meta.url), "utf8"),
    );
  }
  saveProfile(id: number, name: string, avatar: string) {
    this.db
      .prepare("UPDATE players SET name=?,avatar=? WHERE id=?")
      .run(name, avatar, id);
  }
  swapColors() {
    this.db
      .prepare(
        "UPDATE players SET color=CASE color WHEN 'purple' THEN 'yellow' ELSE 'purple' END",
      )
      .run();
  }
  profiles() {
    return this.db
      .prepare("SELECT * FROM players ORDER BY id")
      .all() as Profile[];
  }
  room() {
    const r = this.db.prepare("SELECT settings FROM room WHERE id=1").get() as
      { settings: string } | undefined;
    return r ? (JSON.parse(r.settings) as Room) : null;
  }
  saveRoom(room: Room) {
    this.db
      .prepare(
        "INSERT INTO room VALUES(1,?) ON CONFLICT(id) DO UPDATE SET settings=excluded.settings",
      )
      .run(JSON.stringify(room));
  }
  token(kind: "setup" | "access", player: number | null, ttl = 86400000) {
    const token = randomBytes(32).toString("base64url");
    this.db
      .prepare("INSERT INTO tokens VALUES(?,?,?,?)")
      .run(hash(token), kind, player, Date.now() + ttl);
    return token;
  }
  inspect(token: string) {
    return this.db
      .prepare("SELECT kind,player_id FROM tokens WHERE hash=? AND expires>?")
      .get(hash(token), Date.now()) as
      { kind: "setup" | "access"; player_id: number | null } | undefined;
  }
  accept(token: string, names?: string[], roomName?: string) {
    return this.db.transaction(() => {
      const t = this.inspect(token);
      if (!t)
        throw Error(
          "This link has expired or has already been used. Ask for a replacement link.",
        );
      let invitation: string | undefined;
      if (t.kind === "setup") {
        if (this.room()) throw Error("WordWorld is already set up.");
        if (
          !names ||
          names.length !== 2 ||
          names.some((n) => !n.trim() || n.length > 24) ||
          !roomName?.trim() ||
          roomName.length > 40
        )
          throw Error(
            "Add two names (up to 24 characters) and a room name (up to 40).",
          );
        for (let id = 1; id <= 2; id++)
          this.db
            .prepare("INSERT INTO players VALUES(?,?,?,?)")
            .run(
              id,
              names[id - 1].trim(),
              id === 1 ? "✿" : "✦",
              id === 1 ? "purple" : "yellow",
            );
        this.saveRoom({
          name: roomName.trim(),
          description: "A little friendly competition. A lot of us.",
          icon: "✦",
          mode: "race",
          format: "single",
        });
        invitation = this.token("access", 2);
      }
      const player = t.player_id || 1;
      this.db.prepare("DELETE FROM tokens WHERE hash=?").run(hash(token));
      const session = randomBytes(32).toString("base64url");
      this.db
        .prepare("INSERT INTO sessions VALUES(?,?,?)")
        .run(hash(session), player, Date.now() + 90 * 86400000);
      return { session, player, invitation };
    })();
  }
  session(token: string) {
    return (
      this.db
        .prepare("SELECT player_id FROM sessions WHERE hash=? AND expires>?")
        .get(hash(token), Date.now()) as { player_id: number } | undefined
    )?.player_id;
  }
  saveMatch(m: Match) {
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO matches VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data",
        )
        .run(m.id, m.status, m.start, JSON.stringify(m));
      for (const id of [1, 2])
        this.db
          .prepare("INSERT OR IGNORE INTO participants VALUES(?,?)")
          .run(m.id, id);
      for (const r of m.rounds) {
        this.db
          .prepare(
            "INSERT INTO rounds VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
          )
          .run(r.id, m.id, r.number, JSON.stringify(r));
        for (const id of [1, 2])
          for (const g of r.guesses[id])
            this.db
              .prepare("INSERT OR IGNORE INTO guesses VALUES(?,?,?,?,?,?)")
              .run(
                r.id,
                id,
                g.requestId,
                g.word,
                JSON.stringify(g.marks),
                g.at,
              );
      }
    })();
  }
  history() {
    return (
      this.db
        .prepare("SELECT data FROM matches ORDER BY started DESC")
        .all() as { data: string }[]
    ).map((r) => JSON.parse(r.data) as Match);
  }
  recover() {
    for (const m of this.history().filter((m) => m.status === "active")) {
      m.status = "abandoned";
      m.reason = "server_restart";
      m.end = Date.now();
      for (const r of m.rounds)
        if (!["ended", "abandoned"].includes(r.phase)) {
          r.phase = "abandoned";
          r.reason = "server_restart";
          r.end = m.end;
        }
      this.saveMatch(m);
    }
  }
}
