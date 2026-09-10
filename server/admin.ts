import "dotenv/config";
import { migrate, transact, getDatabase } from "./database";
import { emptyData, type Data } from "./state-store";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const [command, arg] = process.argv.slice(2);
const origin = process.env.APP_ORIGIN || "http://localhost:3000";
function abandon(data: Data) {
  for (const m of Object.values(data.matches))
    if (m.status === "active") {
      m.status = "abandoned";
      m.reason = "server_restart";
      m.end = Date.now();
      for (const r of m.rounds)
        if (!["ended", "abandoned"].includes(r.phase)) {
          r.phase = "abandoned";
          r.reason = "server_restart";
          r.end = m.end;
        }
    }
  data.live = emptyData().live;
  data.tokens = {};
  data.sessions = {};
  data.limits = {};
}
try {
  if (
    ![
      "migrate",
      "setup",
      "access",
      "revoke",
      "backup",
      "restore",
      "import-sqlite",
    ].includes(command)
  )
    throw Error(
      "Commands: migrate | setup | access 1|2 | revoke 1|2 | backup <file.json> | restore <file.json> | import-sqlite <file.sqlite>",
    );
  await migrate();
  if (command === "migrate") console.log("PostgreSQL schema is ready.");
  else if (command === "setup") {
    const token = await transact((store) => {
      if (store.room())
        throw Error("Already configured. Use access 1 or access 2.");
      for (const [h, t] of Object.entries(store.data.tokens))
        if (t.kind === "setup") delete store.data.tokens[h];
      return store.token("setup", null);
    });
    console.log(
      `One-time setup link (expires in 24 hours):\n${origin}/#access=${token}`,
    );
  } else if (command === "access" || command === "revoke") {
    const id = Number(arg);
    if (![1, 2].includes(id)) throw Error("Specify player 1 or 2.");
    const token = await transact((store) => {
      if (!store.room()) throw Error("Complete setup first.");
      store.revoke(id, command === "revoke");
      return store.token("access", id);
    });
    console.log(
      `Single-use player ${id} link (expires in 24 hours):\n${origin}/#access=${token}`,
    );
  } else if (command === "backup") {
    if (!arg) throw Error("Specify a new backup filename.");
    const data = await transact((store) => structuredClone(store.data));
    writeFileSync(
      arg,
      JSON.stringify(
        {
          format: "wordworld-postgres-v1",
          exportedAt: new Date().toISOString(),
          data,
        },
        null,
        2,
      ),
      { flag: "wx", mode: 0o600 },
    );
    console.log("Consistent application backup saved. Keep it private.");
  } else {
    if (!arg || !existsSync(arg))
      throw Error("Specify an existing backup or SQLite file.");
    let data: Data;
    if (command === "restore") {
      const backup = JSON.parse(readFileSync(arg, "utf8"));
      data = backup.data;
      if (
        backup.format !== "wordworld-postgres-v1" ||
        data?.version !== 1 ||
        !Array.isArray(data.profiles) ||
        ![0, 2].includes(data.profiles.length) ||
        !data.matches ||
        typeof data.matches !== "object" ||
        Array.isArray(data.matches) ||
        data.profiles.some(
          (p, i) =>
            p.id !== i + 1 ||
            typeof p.name !== "string" ||
            !["purple", "yellow"].includes(p.color),
        )
      )
        throw Error("Invalid WordWorld backup.");
    } else {
      const { default: SQLite } = await import("better-sqlite3");
      const db = new SQLite(arg, { readonly: true, fileMustExist: true });
      try {
        data = emptyData();
        data.profiles = db
          .prepare("SELECT * FROM players ORDER BY id")
          .all() as Data["profiles"];
        const room = db
          .prepare("SELECT settings FROM room WHERE id=1")
          .get() as { settings: string } | undefined;
        data.room = room ? JSON.parse(room.settings) : null;
        for (const row of db.prepare("SELECT data FROM matches").all() as {
          data: string;
        }[]) {
          const m = JSON.parse(row.data);
          data.matches[m.id] = m;
        }
      } finally {
        db.close();
      }
    }
    abandon(data);
    await transact((store) => {
      if (store.room() || Object.keys(store.data.matches).length)
        throw Error(
          "Restore/import requires an empty target database. Use a new database or branch to preserve the current one.",
        );
      store.data = data;
    });
    console.log(
      "Imported profiles and history. Interrupted matches were abandoned. Generate fresh player access links; old sessions were not imported.",
    );
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : "Admin command failed.");
  process.exitCode = 1;
} finally {
  try {
    await (await getDatabase()).end();
  } catch {}
}
