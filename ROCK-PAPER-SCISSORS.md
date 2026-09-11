# Rock Paper Scissors integration

Rock Paper Scissors shares WordWorld's two private player identities, permanent room, authenticated request client, database transactions and match history. Same Word Race, Word Swap and Minesweeper remain available.

## Playing

Select **Rock Paper Scissors**, choose **Single round**, **First to 3**, or **First to 5**, and have both players press Ready. A server-timed three-second countdown opens a ten-second selection window. Select an option, change it if desired, and press **Lock Choice**. An unconfirmed selection stays in that browser and does not count.

Both locked choices reveal in the same resolved server snapshot. Rock beats scissors, scissors beat paper, and paper beats rock. Equal choices draw. Each round win awards one point; draws award none. Series show results for three seconds and start the next countdown automatically when both players are online. Rematches require both players to accept.

Only one choice locked by the deadline awards a timeout round win to that player. Neither locked abandons the whole match without a match win. The existing concession and disconnect grace rules apply. Deadlines continue during disconnections; recorded boundaries are evaluated chronologically, with a deadline taking precedence over a disconnect at the same timestamp.

## Fairness and persistence

- The server validates authenticated identity, match ID, round ID, phase, choice and request ID. A locked choice cannot be changed, including from another tab or after refresh.
- Each lock has an idempotency key. Retrying the same acknowledged choice does not award extra points. The shared PostgreSQL row lock serializes competing actions and resolves the round once.
- Live snapshots include the requesting player's own locked choice and the opponent's locked status, but no opponent choice before resolution. Request identifiers are omitted from the public RPS state.
- The round stores both locked choices when available, request IDs, timestamps, end reason, next-round time and running score. Missing timeout choices remain missing rather than being invented.
- RPS match statistics have a separate game filter. Round statistics and choice counts include only normally resolved or timeout-resolved rounds. An unfinished choice in a conceded or abandoned round is excluded. Completed match forfeits count as wins/losses; abandoned matches do not. Draws and losses break match-winning streaks.
- Automatic rounds use durable timestamps, not persistent JavaScript timeout handlers. State restoration discovers new countdown/deadline boundaries while processing elapsed time, preventing a late poll from extending a selection window.

## Database and deployment compatibility

The attached brief refers to the project's earlier SQLite deployment. The current production app uses Neon PostgreSQL on Vercel, and this feature keeps that existing service. Optional `round.rps` data and the additional mode/format values fit the existing JSONB document; **no SQL schema migration, new service, setup command, or data reset is required**. Existing room documents and word/Minesweeper records remain valid. The SQLite legacy importer and tests remain available.

Publish the changed code using the existing repository and Vercel flow, retain the current environment variables and database, and refresh both browsers after deployment. This implementation does not deploy the site or modify the production database.

Vercel cold starts are normal and do not identify a permanent server restart. As with the existing production games, a fresh function instance resumes durable state and settles elapsed deadlines. It does not abandon a healthy match merely because another instance handles its request. Explicit backup restoration/import retains the existing behavior of abandoning interrupted matches. This is the adaptation from the brief's persistent-server restart rule.

## Files

| File                                | Change                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `server/rps.ts`                     | Choice types, validation, outcome calculation and private snapshot filtering.                                   |
| `server/types.ts`                   | Adds RPS mode, first-to-five format and optional RPS round fields.                                              |
| `server/game.ts`                    | Integrates countdowns, locking, resolution, timeout rules, series progression and snapshots.                    |
| `server/live.ts`                    | Settles dynamically created round boundaries and resumes series only with both players online.                  |
| `server/records.ts`                 | Adds resolved RPS round/choice statistics and keeps word-solving metrics separate.                              |
| `client/rps.tsx`                    | Choice buttons and SVG icons, locked state, timer, simultaneous result display and history details.             |
| `app/page.tsx`                      | Game/format selection, shared match screen, opponent status, results, history and stats integration.            |
| `app/globals.css`                   | Purple/yellow choice states, mobile layout, reveal animation and reduced-motion support.                        |
| `tests/rps.test.ts`                 | Rules, privacy, locking, timeouts, series, recovery, statistics and transaction concurrency tests.              |
| `tests/browser/multiplayer.spec.ts` | Extends the existing two-browser test with RPS selection, privacy, refresh, timeout, series, history and stats. |
| `playwright.config.ts`              | Allows enough time for the combined four-game browser journey.                                                  |
| `README.md`                         | Adds feature discovery and this guide.                                                                          |
| `ROCK-PAPER-SCISSORS.md`            | Integration, operating details and validation notes.                                                            |

## Validation and limits

The local rule/storage suite passes **65 tests**, including the previous 43 tests. Type checking and the production build pass. The combined two-browser journey passes across all four games, including RPS privacy, restored locks after refresh, a timeout win, automatic series progression, history and statistics. Desktop results and mobile gameplay screenshots were visually checked; mobile RPS has no horizontal page overflow. The repository has no standalone lint configuration; formatting checks accompany TypeScript checks and the production build.

Browser tests use separate desktop/mobile browser contexts and isolated local PostgreSQL-compatible storage, not the private production room. Cloud network latency can delay visible results by the polling interval plus response time. A selection must reach the server before its deadline; browser time is not authoritative. Hosted Vercel/Neon gameplay requires the normal deployment smoke test.
