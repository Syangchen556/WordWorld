import { PGlite } from "@electric-sql/pglite";
import type { Database } from "./database";
// PGlite embeds actual PostgreSQL for repeatable offline tests. Its single
// connection is queued, while hosted pg connections use SELECT FOR UPDATE.
export async function createEmbeddedDatabase(path?: string): Promise<Database> {
  const db = new PGlite(path);
  await db.waitReady;
  let tail = Promise.resolve();
  return {
    async connect() {
      let release!: () => void;
      const previous = tail;
      tail = new Promise<void>((r) => (release = r));
      await previous;
      return {
        async query(sql: string, values?: unknown[]) {
          if (!values && sql.includes("CREATE TABLE")) {
            await db.exec(sql);
            return { rows: [] };
          }
          return db.query(sql, values);
        },
        release,
      };
    },
    async end() {
      await tail;
      await db.close();
    },
  };
}
