import "dotenv/config";
import next from "next";
import { createServer } from "node:http";
import { createEmbeddedDatabase } from "../server/test-database";
import { migrate, transact } from "../server/database";
import { hash } from "../server/state-store";
if (process.env.VERCEL || process.env.NODE_ENV === "production")
  throw Error("Test server cannot run in production.");
const path = process.env.WORDWORLD_TEST_PGLITE_PATH,
  token = process.env.WORDWORLD_TEST_SETUP_TOKEN;
if (!path || !token)
  throw Error("Playwright must provide an isolated database and setup token.");
const db = await createEmbeddedDatabase(path);
await migrate(db);
await transact((store) => {
  store.data.tokens[hash(token)] = {
    kind: "setup",
    player_id: null,
    expires: Date.now() + 3600000,
  };
}, db);
await db.end();
const port = 3100;
const app = next({ dev: true, hostname: "0.0.0.0", port });
await app.prepare();
createServer(app.getRequestHandler()).listen(port, "0.0.0.0");
