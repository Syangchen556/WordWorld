import "dotenv/config";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StateStore, emptyData, type Data } from "./state-store";
export interface Connection {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[] }>;
  release(): void;
}
export interface Database {
  connect(): Promise<Connection>;
  end(): Promise<void>;
}
let database: Database | undefined;
let embeddedPromise: Promise<Database> | undefined;
export async function getDatabase(): Promise<Database> {
  if (database) return database;
  if (
    process.env.WORDWORLD_TEST_PGLITE_PATH &&
    !process.env.VERCEL &&
    process.env.NODE_ENV !== "production"
  ) {
    // Embedded PostgreSQL only for development/tests. Never used on Vercel.
    const { createEmbeddedDatabase } = await import("./test-database");
    embeddedPromise ||= createEmbeddedDatabase(
      process.env.WORDWORLD_TEST_PGLITE_PATH,
    );
    database = await embeddedPromise;
    return database;
  }
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is not configured.");
  database = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
    allowExitOnIdle: true,
  }) as Database;
  return database;
}
export async function migrate(db?: Database) {
  const database = db || (await getDatabase()),
    c = await database.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      readFileSync(join(process.cwd(), "migrations/001-postgres.sql"), "utf8"),
    );
    await c.query(
      "INSERT INTO wordworld_state(id,data) VALUES(1,$1::jsonb) ON CONFLICT(id) DO NOTHING",
      [JSON.stringify(emptyData())],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function transact<T>(
  work: (store: StateStore, revision: number) => T | Promise<T>,
  db?: Database,
): Promise<T> {
  const database = db || (await getDatabase()),
    c = await database.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout = '8s'");
    await c.query("SET LOCAL statement_timeout = '10s'");
    const { rows } = await c.query(
      "SELECT data,revision FROM wordworld_state WHERE id=1 FOR UPDATE",
    );
    if (!rows[0]) throw Error("Database migration is required.");
    const time = await c.query(
      "SELECT extract(epoch FROM clock_timestamp())*1000 AS now",
    );
    const store = new StateStore(
      rows[0].data as Data,
      Number(time.rows[0].now),
    );
    store.prune();
    const result = await work(store, Number(rows[0].revision) + 1);
    await c.query(
      "UPDATE wordworld_state SET data=$1::jsonb,revision=revision+1,updated_at=clock_timestamp() WHERE id=1",
      [JSON.stringify(store.data)],
    );
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
