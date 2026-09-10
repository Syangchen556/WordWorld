import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createEmbeddedDatabase } from "../server/test-database";
import { transact } from "../server/database";
import { Store } from "../server/store";
test("admin commands back up, restore and import the original SQLite room", async () => {
  mkdirSync("data", { recursive: true });
  const folder = mkdtempSync(resolve("data/admin-test-"));
  const run = (path: string, ...args: string[]) =>
    execFileSync(
      process.execPath,
      ["--import", "tsx", "server/admin.ts", ...args],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "test",
          VERCEL: "",
          WORDWORLD_TEST_PGLITE_PATH: path,
          APP_ORIGIN: "http://localhost:3000",
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  const source = join(folder, "source");
  const output = run(source, "setup");
  const token = output.match(/#access=([\w-]+)/)![1];
  let db = await createEmbeddedDatabase(source);
  await transact((store) => store.accept(token, ["A", "B"], "Saved room"), db);
  await db.end();
  const backup = join(folder, "room.backup.json");
  run(source, "backup", backup);
  assert.equal(
    JSON.parse(readFileSync(backup, "utf8")).data.room.name,
    "Saved room",
  );
  const target = join(folder, "restored");
  run(target, "restore", backup);
  db = await createEmbeddedDatabase(target);
  await transact((store) => {
    assert.equal(store.room()!.name, "Saved room");
    assert.equal(store.profiles().length, 2);
    assert.deepEqual(store.data.sessions, {});
  }, db);
  await db.end();
  assert.throws(() => run(target, "restore", backup));
  const legacy = join(folder, "original.sqlite"),
    sqlite = new Store(legacy);
  sqlite.accept(
    sqlite.token("setup", null),
    ["Old A", "Old B"],
    "Original room",
  );
  sqlite.db.close();
  const imported = join(folder, "imported");
  run(imported, "import-sqlite", legacy);
  db = await createEmbeddedDatabase(imported);
  assert.equal(
    await transact((store) => store.room()!.name, db),
    "Original room",
  );
  await db.end();
  const original = new Store(legacy);
  assert.equal(original.room()!.name, "Original room");
  original.db.close();
});
