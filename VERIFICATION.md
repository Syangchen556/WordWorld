# Verification report — Vercel conversion

Verified locally on Windows, Node.js 22.14.0. The current target is Next.js on Vercel with hosted PostgreSQL, not the original persistent Node/Socket.IO/SQLite service.

## Checks performed

- `npm test`: **28/28 passed**. The original 20 rule/storage regressions remain. Seven new tests exercise hashed durable access, fresh-instance board recovery, reconnect-after-expiry abandonment, chronological deadline/forfeit handling without a background timer, multiple-tab presence, PostgreSQL migration/rollback/serialized transactions, and exactly one winning concurrent transaction.
- A command-line regression also passed setup, application backup, empty-target restore, refusal to overwrite an existing room, and read-only import of the original SQLite room.
- PostgreSQL tests use **PGlite (embedded PostgreSQL)** with the actual migration and transaction SQL. The hosted adapter uses `pg`, pooled connections, and `SELECT ... FOR UPDATE`. These tests do not establish cloud-provider network/TLS compatibility or exercise competing TCP connections against a hosted database.
- `npm run test:e2e`: **passed** against the new Next.js API routes and PostgreSQL-backed shared state. Two separate Edge browser contexts accept private invitations, play Word Swap through a winning solve, reject an invalid guess, keep the partner's word private, refresh the board, agree to a rematch, concede, start Same Word Race, rename the room, and inspect persistent history/statistics. Browser updates are actual authenticated HTTP requests, not mocked multiplayer.
- Desktop 1366×1000 and phone 390×844 browser contexts; screenshots in ignored `test-results/`. No uncaught page errors in the passing scenario.
- `npm run typecheck`: passed.
- `npm run build`: passed, including dynamic `/api/[...path]` routes and the static frontend.
- Lockfile installation audit reported zero vulnerabilities after dependency changes.
- Production function tracing includes the PostgreSQL driver and server dictionary; it excludes SQLite and PGlite test runtimes.

## Deployment changes

- Added PostgreSQL schema, transaction adapter, durable game/presence snapshots and private HTTP endpoints.
- Replaced the Socket.IO client with a reconnecting request client. Snapshots refresh roughly once a second plus latency; guesses are sent immediately and responses are revision-checked.
- Removed the custom Node server and production Socket.IO/SQLite dependencies. SQLite is retained only for legacy import/regression tests.
- Added Vercel configuration, Node version pin, server-only environment example and exclusions for local secrets/databases/backups.
- Reworked admin commands for hosted PostgreSQL: migration, one-time setup, replacement access, session revocation, consistent JSON backup, empty-target restore and read-only SQLite import.
- Added VERCEL.md with the repository → Vercel → Neon → private setup steps.

## Remaining external verification

No Vercel deployment, Neon database or cloud credentials have been created or connected in this workspace. After publishing the repo, the owner must import it in Vercel, connect PostgreSQL, set `DATABASE_URL` and `APP_ORIGIN`, and run the setup command against that database. Live cloud TLS, provider pooling, region latency, physical two-device internet play and mobile Safari remain unverified.

The app keeps one private state document under a PostgreSQL row lock, deliberately optimized for two people and modest history rather than public scale. Polling consumes hosted requests while the page is open. Missed heartbeats expire after five seconds, followed by 30 seconds of grace; when nobody is connected, outcomes are settled on the next authenticated request from recorded timestamps. Cold starts themselves do not erase the match.
