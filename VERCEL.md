# Publish WordWorld on Vercel

You need your GitHub repository, a Vercel project, and one hosted PostgreSQL database. Neon is a straightforward option available through [Vercel Marketplace](https://vercel.com/marketplace/neon/neon). Both players will use the same Vercel website URL.

## 1. Publish the code

Publish this folder as your GitHub repository. The supplied `.gitignore` excludes `.env`, databases, backups, dependency caches and test results. Do not upload these files manually. No real database credentials are included in `.env.example`.

## 2. Import into Vercel

Import the GitHub repository as a new Vercel project. Keep:

- Framework: **Next.js**
- Root directory: repository root
- Node.js: **22.x**
- Install command: `npm ci`
- Build command: `npm run build`
- Output directory: Next.js default (no custom override)

`vercel.json` contains the build settings. The app now uses ordinary Next.js functions, so no custom long-running server, persistent Vercel disk, or WebSocket beta setup is needed.

The initial code build can succeed before the database is configured. The game itself needs the remaining steps below.

## 3. Connect PostgreSQL

Create a Neon PostgreSQL database through the project's Storage/Marketplace area, or create one in Neon and copy its **pooled TLS connection string**. Choose a database region near your Vercel Functions region to keep turns responsive. Vercel supports external PostgreSQL integrations through its [storage marketplace](https://vercel.com/docs/marketplace-storage).

In the Vercel project's **Production** environment variables, set:

| Variable       | Value                                                                         |
| -------------- | ----------------------------------------------------------------------------- |
| `DATABASE_URL` | The provider's pooled PostgreSQL connection string, including its TLS options |
| `APP_ORIGIN`   | Your exact public URL, e.g. `https://wordworld-example.vercel.app`            |

Use your project's real production alias, not a temporary per-deployment URL. `APP_ORIGIN` must have no path, query string or fragment. Do not add the `NEXT_PUBLIC_` prefix. If the integration already supplies `DATABASE_URL`, use that value rather than creating a conflicting one.

Redeploy after saving variables. Do not share the production database with preview deployments. A preview needs its own database branch and matching origin if you want to test it.

## 4. Create your private setup link

On your computer, in the published repository folder:

```sh
npm ci
```

Copy `.env.example` to `.env` and privately fill in the **same hosted** `DATABASE_URL` and public `APP_ORIGIN` used by Vercel. Then run:

```sh
npm run admin -- setup
```

This creates the database schema if needed and prints an unguessable one-time setup link that expires in 24 hours. This command runs locally but modifies the hosted database; you do not need a shell on Vercel.

Open that HTTPS link. Enter your name, your partner's name, and your room name. You become Player 1. Copy and send your partner the invitation shown after setup. They become Player 2 when they explicitly accept it. Keep your setup/invitation links private.

For an already-configured database, issue replacement links instead:

```sh
npm run admin -- access 1
npm run admin -- access 2
```

If you already have scores in the original SQLite version, **before setup**, use:

```sh
npm run admin -- import-sqlite ./data/wordworld.sqlite
npm run admin -- access 1
npm run admin -- access 2
```

## 5. Play from two devices

Open the player-specific invitation on each person's preferred device/browser. After acceptance, bookmark the normal production URL. You do not need a new invitation for each match. Both players ready up in the same room.

The server receives guesses immediately; the partner's progress updates approximately once a second, plus network/database latency. Keep the page active during play. Backgrounded or sleeping mobile browsers can stop heartbeats and eventually forfeit.

## Updates, access and backups

Connected GitHub deployments can publish future commits through Vercel. Room/history data stays in PostgreSQL. For a lost device use `npm run admin -- revoke 1` or `revoke 2`; this also prints a fresh access link.

```sh
npm run admin -- backup wordworld.backup.json
```

Store backups privately outside the repository. Restore/import refuses to overwrite an existing room; use an empty database or a new database branch, then issue fresh access links. Full details are in README.md.

## If something is not working

- **The owner needs to configure APP_ORIGIN:** set the exact HTTPS production URL, then redeploy.
- **Could not reach its database:** check `DATABASE_URL`, TLS options, database availability, and that `npm run admin -- setup` or `npm run db:migrate` has run against that database.
- **Request origin is not allowed:** you opened a different domain than `APP_ORIGIN`. Use the configured production URL or update the variable and redeploy.
- **Link expired/already used:** run `npm run admin -- access 1` or `access 2` against the hosted database.
- **Unrecognized/empty room:** ensure the website and your admin command use the same database/branch.

No cloud deployment or account creation has been performed yet. Your next step is to publish the repository and import it into Vercel, then connect the database above.
