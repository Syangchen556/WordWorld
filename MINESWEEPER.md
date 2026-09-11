# Two-player Minesweeper

Select **Minesweeper** in the existing room, choose Easy (8 × 8, 10 mines), Medium (12 × 12, 25 mines), or Hard (16 × 16, 50 mines), then both press Ready. Player 1 starts. Each player reveals one tile per turn; automatic empty-area expansion is part of that move. Both players see the same revealed board.

Each player has three lives. A mine costs the selecting player one life; the third mine loses the match. If all safe tiles are revealed first, the player with more lives wins; equal lives draws. The first selected tile and its neighbors are safe. There is no countdown or round deadline for Minesweeper. Existing disconnect grace, concession, rematch and return behavior still apply.

Large boards stay inside a horizontally scrollable area on narrow screens, preserving tile sizes and the surrounding page. Hidden tiles are disabled while waiting for the partner. Revealed numbers, mines, current turn, lives and move feedback update through the existing polling client.

## Integration

- `server/minesweeper.ts`: board generation, adjacent counts, flood reveal, turn validation, idempotency, lives, outcomes and filtered public board views.
- `server/types.ts`: adds the mode and optional difficulty/round state. Old saved room and word-match documents remain valid.
- `server/game.ts`: creates Minesweeper through the existing match lifecycle, routes `reveal` actions, omits the word timer, filters hidden layouts, and preserves difficulty on rematch.
- `server/records.ts`: includes Minesweeper in match wins/losses/draws; excludes it from word-solve statistics and personal bests.
- `client/minesweeper.tsx`: shared board, lives, turn feedback, short mine animation, retry identifiers and completed-history board rendering.
- `app/page.tsx`: adds the mode/difficulty picker, board, history and statistics integration while retaining the existing word interface.
- `app/globals.css`: scoped board, difficulty, lives and responsive styles using the existing palette.
- `tests/minesweeper.test.ts`: rules, privacy, persistence, atomic competing moves, old-word-room compatibility and rematches.
- `tests/browser/multiplayer.spec.ts`: extends the existing two-browser word-game journey with Minesweeper selection, synchronized difficulty/turns, stale-move rejection, refresh, mobile layout, rematch and history.
- `playwright.config.ts`: extends the test timeout to accommodate all three games in the same journey.
- `README.md` and this document: feature and operating notes.

No new authentication, room table, endpoint, connection mechanism, or external service is introduced. The existing PostgreSQL row transaction makes moves atomic. Payloads supply a cell index, match ID, round ID, turn number and unique request ID; clients never submit mine results. Hidden mine locations are absent from live snapshots and become visible after the match ends. Authenticated history contains the finished board.

## Existing data and deployment

The optional fields fit the existing JSONB document, so no new schema migration or setup command is required. Existing sessions, room settings, word history and ongoing word matches are retained. Missing difficulty defaults to Easy. Minesweeper always starts a single match; the room's word-game format remains available when switching back to a word mode.

Publish the updated code through the existing repository/Vercel deployment flow. Keep the current Neon database and environment variables. Refresh both browsers after deployment so both load the new game interface. This change does not itself deploy or modify the hosted database.

## Verification

- `npm test`: 43 tests passed, including all existing word-game regressions and 15 new Minesweeper test cases covering the requested rules and edge cases.
- `npm run typecheck`: passed.
- `npm run test:e2e`: passed the combined two-browser journey through Same Word Race, Word Swap and Minesweeper, including mobile layout and shared history.
- `npm run build`: passed; production frontend and API compiled successfully.
- Desktop and mobile Minesweeper screenshots were visually checked. Hard boards scroll within their container on mobile without page overflow.

The repository has no lint script or ESLint configuration; TypeScript checking and Prettier checks are used alongside the automated tests and production build. Browser tests use isolated local PostgreSQL-compatible test storage, not the production room. These checks do not constitute a live Vercel deployment test.
