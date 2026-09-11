# WordWorld

A private multiplayer word game for two people, ready to deploy as a **Next.js app on Vercel with hosted PostgreSQL**. See **[VERCEL.md](VERCEL.md)** for the publishing checklist.

Both players open the same website. Profiles, private sessions, the live match, scores and history are stored in PostgreSQL. The frontend keeps the purple/yellow/black design, with green/amber/gray puzzle feedback independent of player colors.

The room also includes **two-player Minesweeper**: three difficulties, a shared board, alternating turns and three lives per player. It uses the same private access, saved matches and rematch flow. See [MINESWEEPER.md](MINESWEEPER.md) for rules and implementation details. Same Word Race and Word Swap remain available.

**Rock Paper Scissors** adds private locked choices, ten-second rounds, single/first-to-three/first-to-five matches, automatic series progression and separate statistics. See [ROCK-PAPER-SCISSORS.md](ROCK-PAPER-SCISSORS.md) for rules, code changes and deployment notes.

## What changed for Vercel

The original single-process Socket.IO/SQLite backend has been replaced by Next.js API routes and PostgreSQL transactions. Browsers send guesses immediately and request fresh private snapshots about once a second. This is real shared multiplayer; there is no simulated opponent or browser-owned score storage. The opponent normally sees updates within one polling interval plus network/database latency.

Vercel Functions do not need to stay running between requests. Each request locks the single permanent room record with `SELECT ... FOR UPDATE`, loads the authoritative game, checks rules using database server time, and commits before returning. The first correct guess accepted in that serialized transaction order wins. A unique guess request ID prevents retries from spending extra attempts. A revision number prevents delayed responses from replacing newer browser state.

One small JSONB record contains the two profiles, token/session hashes, room settings, matches/rounds/guesses, and live presence. This deliberately simple schema suits two people and modest history. It is private server data and is never returned wholesale to the browser. The browser receives only filtered snapshots and completed history. Separate database tables or an archive can be added if the history eventually grows large.

## Install and develop

Requires Node.js 22 and npm. Use a separate development database or Neon branch when changing the app.

```sh
npm ci
```

Copy `.env.example` to `.env`:

```powershell
Copy-Item .env.example .env
```

On macOS/Linux use `cp .env.example .env`. Set:

```dotenv
APP_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
```

Use the pooled TLS connection string from your hosted PostgreSQL provider. `.env` is ignored by Git. Do not use `NEXT_PUBLIC_` for database credentials.

```sh
npm run admin -- setup
npm run dev
```

The setup command applies the idempotent schema migration and prints a 24-hour, single-use setup link. Open it, enter the two names and room name, then send your partner the invitation displayed afterward. No ordinary visitor can claim the app or choose a player identity. Until PostgreSQL is configured and the setup command has run, the local app cannot create a room.

## Commands

```sh
npm run dev                     # Next.js development server
npm run build                   # production build; no database access required
npm start                       # production Next.js server
npm run typecheck
npm test
npm run test:e2e
npm run db:migrate              # idempotent PostgreSQL migration only
npm run admin -- setup          # migrate + issue setup link for an unclaimed app
npm run admin -- access 1       # replacement access link; existing sessions remain
npm run admin -- access 2
npm run admin -- revoke 1       # revoke sessions + issue replacement link
npm run admin -- revoke 2
npm run admin -- backup wordworld.backup.json
npm run admin -- restore wordworld.backup.json
npm run admin -- import-sqlite ./data/wordworld.sqlite
```

All admin commands use the database in your local `.env`/`DATABASE_URL`, which may be the hosted production database. `APP_ORIGIN` determines the URL printed in access links. For production links, set it to the exact `https://your-project.vercel.app` address (or custom domain), not localhost. Admin commands run on your computer and connect to PostgreSQL; they do not need an interactive Vercel server terminal.

`access` invalidates outstanding invitations for that player. `revoke` also invalidates that player’s sessions and live tabs; open browsers discover the revocation on their next update. Sessions last 90 days. Access/setup links last 24 hours and can be explicitly accepted only once.

## Game behavior

- **Same Word Race:** one random, server-selected five-letter word for both players.
- **Word Swap:** each player privately locks a validated five-letter word for their partner.
- Both ready, a three-second countdown, then three minutes and six valid guesses each. Invalid words do not spend attempts. Exact matches are scored first and repeated-letter matches use remaining counts.
- First accepted correct guess wins. If neither solves before both exhaust attempts or the deadline, the round is a draw.
- Single rounds or first-to-three series. Drawn series rounds add no points. Both ready before each new round; both must accept a rematch.
- Concessions and disconnect forfeits award the match and preserve the actual round-score tally.
- Opponent words/feedback and answers stay private until the round ends. Both boards and solve times are available afterward.

## Presence, reconnection and deadlines

Authenticated tabs send heartbeat requests with a unique tab ID. A player stays online while any tab’s heartbeat is fresh. A missed heartbeat expires after five seconds; then the 30-second reconnection grace starts. A successfully delivered page-close notice expires that tab immediately. Browsers reconnect automatically and reload the current board from PostgreSQL.

All deadlines are absolute database timestamps. On each request the server evaluates elapsed countdown, round-deadline and disconnect-grace boundaries in chronological order, **before** marking a returning player online. A tied deadline is resolved before a disconnect forfeit. This prevents an old disconnect from changing a completed result or a late guess from beating the deadline. Both players absent when grace is evaluated means abandonment without a winner.

When nobody is online there is no background timer consuming a Vercel Function. Expired outcomes are settled on the next authenticated request using the recorded boundaries. While anyone is connected, regular requests settle them live. This requires no cron service.

Cold starts and routine Vercel instance changes do not discard the live game: its state is durable. If an outage prevents both players from sending heartbeats through the grace window, the match is abandoned when service returns. Do not restore old backups into a live match.

## Records and preferences

Two fixed identities, one room at `/`, editable names/avatars/room settings, and mutually accepted color swaps. Statistics remain attached to player IDs. Completed matches count once, including draws and forfeits; abandoned matches do not count. Completed rounds remain in round statistics even if a later round of their series is abandoned. Solve averages use only correct solves. Personal bests require strict improvement; ties do not create new records.

History is paginated and includes detailed round boards, answers, solve times, score, format, mode and completion reason. Physical/on-screen keyboards, visible focus, screen-reader announcements, symbol labels, high contrast, reduced motion and optional sound are supported. Only device preferences are stored in localStorage.

## Security

- 256-bit random setup/access/session tokens; only SHA-256 hashes stored.
- Token-bearing links use URL fragments. The browser clears the fragment and inspects via POST; only explicit acceptance consumes the token.
- HttpOnly, SameSite=Strict cookies; Secure cookies in production.
- Exact `APP_ORIGIN` checks on mutations, authenticated actions/history, transactional invitation consumption, persistent rate limits, server-side dictionary/guess validation.
- No analytics, external fonts, or third-party resources on access pages. No secret answers in client bundles.
- Vercel and the database should be configured without request-body logging. Never commit `.env`, local databases, backups or access links. The provided `.gitignore`/`.vercelignore` exclude these artifacts.
- Do not point untrusted preview deployments at the production database. Use a separate database/branch and matching origin for previews.

## Backups and migration from the original app

`backup` reads a consistent committed document inside a PostgreSQL transaction and writes a new private JSON file. It refuses to overwrite an existing file. The backup contains private history and hashed authentication records; protect it accordingly. Hosted-provider backups/PITR or `pg_dump` are additional options.

`restore` requires an empty target database, preserving any existing room by refusing to overwrite it. It clears tokens/sessions/live presence and marks interrupted matches abandoned. Issue new `access 1` / `access 2` links afterward. Test a restore against a separate database/branch before relying on backups.

`import-sqlite` reads the original SQLite database **without modifying it**, importing names, room settings and match history into an empty PostgreSQL database. It excludes old sessions/access links and abandons interrupted matches. Run it instead of starting a new room if you have local records to keep, then generate fresh access links for both players. `better-sqlite3` remains a development dependency for this migration utility and the original regression tests; the Vercel request path does not use SQLite.

## Tests

`npm test` covers the existing rule suite plus durable state, chronological timeout handling, PostgreSQL schema/rollback/transaction ordering and one-winner concurrency. PostgreSQL tests use PGlite, an embedded PostgreSQL runtime, so no cloud credentials are needed. Hosted requests use `pg`; test mode is disabled in production and on Vercel.

`npm run test:e2e` launches an isolated PostgreSQL-backed Next.js test server on port 3100 and uses two Edge browser contexts (desktop and phone). It exercises actual HTTP sessions, both modes, private word selection, invalid guesses, a winning solve, refresh, rematch, concession, renaming, history and statistics. It writes screenshots to ignored `test-results/` and isolated test databases under ignored `data/`. If Edge is unavailable, install Chromium with `npx playwright install chromium` and replace `channel: 'msedge'` with `browserName: 'chromium'` in `playwright.config.ts`. Restricted Windows environments may need permission for Playwright to close its own child processes.

## Dictionary and deployment notes

The hand-curated answer list and larger five-letter guess dictionary are used only on the server. `word-list` (MIT, Sindre Sorhus, based on atebits/Words) attribution is in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

The application is prepared for Vercel, but no cloud project or database has been provisioned from this workspace. **Publishing a repository does not deploy the website automatically until you import/connect it in Vercel.** Localhost is not accessible on your partner’s device over the internet. Follow [VERCEL.md](VERCEL.md) to obtain the online address. Hosting/database usage depends on the plans you choose; live polling consumes requests while the room is open.
