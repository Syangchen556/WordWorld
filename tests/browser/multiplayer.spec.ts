import { test, expect } from "@playwright/test";

test("two private browser sessions play, refresh, rematch and retain history", async ({
  browser,
  request,
}) => {
  const setup = process.env.WORDWORLD_TEST_SETUP_TOKEN!;
  const unauth = await request.get("/api/history");
  expect(unauth.status()).toBe(401);
  const blocked = await request.post("/api/inspect", {
    headers: { Origin: "https://wrong.example" },
    data: { token: setup },
  });
  expect(blocked.status()).toBe(403);
  const c1 = await browser.newContext({
      viewport: { width: 1366, height: 1000 },
    }),
    c2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a = await c1.newPage(),
    b = await c2.newPage();
  const errors: string[] = [];
  a.on("pageerror", (e) => errors.push(e.message));
  b.on("pageerror", (e) => errors.push(e.message));
  await a.goto(`/#access=${setup}`);
  await expect(
    a.getByRole("button", { name: "Create our world" }),
  ).toBeVisible();
  expect(
    (
      await request.post("/api/inspect", {
        headers: { Origin: "http://localhost:3100" },
        data: { token: setup },
      })
    ).status(),
  ).toBe(200);
  expect(a.url()).not.toContain(setup);
  await a.getByLabel("Your name", { exact: true }).fill("Violet");
  await a.getByLabel("Your partner’s name").fill("Sunny");
  await a.getByLabel("Our room name").fill("Our little word world");
  await a.getByRole("button", { name: "Create our world" }).click();
  const invitation = await a.getByLabel("Partner invitation link").inputValue();
  expect(invitation).toContain("#access=");
  await b.goto(invitation);
  await b.getByRole("button", { name: "Accept invitation" }).click();
  await expect(b.getByRole("button", { name: "Ready to play" })).toBeVisible();
  await a.getByRole("button", { name: "Dismiss invitation" }).click();
  await a.screenshot({
    path: "test-results/lobby-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await b.screenshot({
    path: "test-results/lobby-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await a.getByRole("button", { name: /Word Swap Pick a secret/ }).click();
  await a.getByRole("button", { name: "Ready to play" }).click();
  await b.getByRole("button", { name: "Ready to play" }).click();
  await a.getByLabel("Secret word for your partner").fill("HEART");
  await a.getByRole("button", { name: "Lock my word" }).click();
  await expect(
    b.getByText("Violet has locked a word for you.", { exact: false }),
  ).toBeVisible();
  expect(await b.locator("body").innerText()).not.toContain("HEART");
  await b.getByLabel("Secret word for your partner").fill("CLOUD");
  await b.getByRole("button", { name: "Lock my word" }).click();
  await expect(a.getByRole("button", { name: "Enter guess" })).toBeEnabled({
    timeout: 10000,
  });
  await a.locator(".play-status").click();
  await a.keyboard.type("zzzzz");
  await a.keyboard.press("Enter");
  await expect(
    a.getByRole("alert").filter({ hasText: "not in our dictionary" }),
  ).toContainText("not in our dictionary");
  await expect(a.getByRole("button", { name: "Enter guess" })).toBeEnabled();
  for (let i = 0; i < 5; i++) await a.keyboard.press("Backspace");
  await a.keyboard.type("crane");
  await a.keyboard.press("Enter");
  await expect(a.getByLabel("Row 1, letter 1: C, correct")).toBeVisible();
  expect(await b.locator("body").innerText()).not.toContain("CRANE");
  await a.reload();
  await expect(a.getByLabel("Row 1, letter 1: C, correct")).toBeVisible();
  await b.screenshot({
    path: "test-results/game-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await a.locator(".play-status").click();
  await a.keyboard.type("cloud");
  await a.keyboard.press("Enter");
  await expect(a.getByText("This one’s yours!")).toBeVisible();
  await expect(b.getByText("Violet takes this one!")).toBeVisible();
  await a.screenshot({
    path: "test-results/results-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  const saved = await (await c1.request.get("/api/history")).json();
  expect(saved.total).toBe(1);
  expect(saved.matches[0].winner).toBe(1);
  await a.getByRole("button", { name: "One more? Rematch" }).click();
  await expect(
    a.getByRole("button", { name: "Waiting for Sunny" }),
  ).toBeVisible();
  await b.getByRole("button", { name: "One more? Rematch" }).click();
  await expect(a.getByLabel("Secret word for your partner")).toBeVisible();
  a.once("dialog", (dialog) => dialog.accept());
  await a.getByRole("button", { name: "Concede match" }).click();
  await expect(b.getByText("This one’s yours!")).toBeVisible();
  await a.getByRole("button", { name: "Back to our room" }).click();
  await a.getByRole("button", { name: /Same Word Race One word/ }).click();
  await a.getByRole("button", { name: "Ready to play" }).click();
  await b.getByRole("button", { name: "Ready to play" }).click();
  await expect(a.getByRole("button", { name: "Enter guess" })).toBeEnabled({
    timeout: 10000,
  });
  a.once("dialog", (dialog) => dialog.accept());
  await a.getByRole("button", { name: "Concede match" }).click();
  await expect(b.getByText("This one’s yours!")).toBeVisible();
  await a.getByRole("button", { name: "Back to our room" }).click();
  await a.getByRole("button", { name: "Room settings", exact: true }).click();
  await a.getByLabel("Room name", { exact: true }).fill("Our cozy corner");
  await a.getByRole("button", { name: "Save room" }).click();
  await b.reload();
  await expect(
    b.getByRole("heading", { name: "Our cozy corner" }),
  ).toBeVisible();
  await a.getByRole("button", { name: "Match history", exact: true }).click();
  await expect(a.getByText("3 saved matches")).toBeVisible();
  await a.getByRole("button", { name: "Our stats", exact: true }).click();
  await expect(a.getByRole("heading", { name: "Head to head" })).toBeVisible();
  await a.screenshot({
    path: "test-results/stats-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  // The same authenticated room switches to Minesweeper after both word modes.
  await a.getByRole("button", { name: "Our room", exact: true }).click();
  await a.getByRole("button", { name: /Minesweeper One shared board/ }).click();
  await expect(
    a.getByRole("heading", { name: "Choose your difficulty" }),
  ).toBeVisible();
  await a.getByRole("button", { name: /medium 12 × 12 25 mines/i }).click();
  await expect(
    b.getByRole("button", { name: /medium 12 × 12 25 mines/i }),
  ).toHaveAttribute("aria-pressed", "true");
  await a.getByRole("button", { name: /hard 16 × 16 50 mines/i }).click();
  await a.getByRole("button", { name: "Ready to play" }).click();
  await b.getByRole("button", { name: "Ready to play" }).click();
  await expect(a.locator(".mines-turn")).toHaveText("Your turn");
  await expect(b.locator(".mines-turn")).toHaveText("Opponent’s turn");
  await expect(a.locator(".mine-cell")).toHaveCount(256);
  await expect(b.locator(".mine-cell:enabled")).toHaveCount(0);
  const firstMove = a.waitForResponse((r) => r.url().endsWith("/api/action"));
  await a
    .getByRole("button", { name: "Row 1, column 1: hidden", exact: true })
    .click();
  const mineState = (await (await firstMove).json()).state;
  expect(mineState.match.round.mines.cells[0]).toBe(0);
  expect(mineState.match.round.mines.layout).toBeUndefined();
  expect(mineState.match.round.mines.moves).toBeUndefined();
  await expect(b.locator(".mines-turn")).toHaveText("Your turn");
  await expect(a.getByLabel("Violet: 3 lives")).toBeVisible();
  await b.locator(".mine-cell.hidden-cell").first().click();
  await expect(a.locator(".mines-turn")).toHaveText("Your turn");
  const stale = await c1.request.post("/api/action", {
    headers: { Origin: "http://localhost:3100" },
    data: {
      tabId: "browser-check",
      event: "reveal",
      payload: {
        matchId: mineState.match.id,
        roundId: mineState.match.round.id,
        turn: 0,
        cell: 255,
        requestId: "stale-browser-request",
      },
    },
  });
  expect(stale.status()).toBe(400);
  expect((await stale.json()).error).toContain("turn has changed");
  await b.reload();
  await expect(b.locator(".mines-help")).toContainText("2 moves");
  await expect(a.locator(".mine-cell").first()).toHaveAttribute(
    "aria-label",
    "Row 1, column 1: empty",
  );
  await expect(b.locator(".mine-cell").first()).toHaveAttribute(
    "aria-label",
    "Row 1, column 1: empty",
  );
  expect(
    await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await a.screenshot({
    path: "test-results/mines-desktop.png",
    fullPage: true,
  });
  await b.screenshot({ path: "test-results/mines-mobile.png", fullPage: true });
  a.once("dialog", (dialog) => dialog.accept());
  await a.getByRole("button", { name: "Concede match" }).click();
  await expect(b.getByText("This one’s yours!")).toBeVisible();
  await a.getByRole("button", { name: "One more? Rematch" }).click();
  await b.getByRole("button", { name: "One more? Rematch" }).click();
  await expect(a.locator(".mine-cell.hidden-cell")).toHaveCount(256);
  await expect(a.locator(".mines-help")).toContainText("0 moves");
  await expect(a.getByLabel("Sunny: 3 lives")).toBeVisible();
  await expect(a.locator(".mines-turn")).toHaveText("Your turn");
  a.once("dialog", (dialog) => dialog.accept());
  await a.getByRole("button", { name: "Concede match" }).click();
  await a.getByRole("button", { name: "Match history", exact: true }).click();
  await expect(a.getByText("5 saved matches")).toBeVisible();
  await a
    .locator(".history-row")
    .filter({ hasText: "Minesweeper" })
    .last()
    .click();
  await expect(a.locator(".mine-cell")).toHaveCount(256);
  await expect(a.getByRole("heading", { name: "Final board" })).toBeVisible();
  await a.getByRole("button", { name: "Our room", exact: true }).click();
  await a.getByRole("button", { name: "Back to our room" }).click();
  await a
    .getByRole("button", { name: /Rock Paper Scissors Choose, lock/ })
    .click();
  await a.getByRole("button", { name: "Single round", exact: true }).click();
  await a.getByRole("button", { name: "Ready to play" }).click();
  await b.getByRole("button", { name: "Ready to play" }).click();
  await expect(
    a.getByRole("button", { name: "rock", exact: true }),
  ).toBeEnabled({ timeout: 10000 });
  await a.getByRole("button", { name: "rock", exact: true }).click();
  await a.getByRole("button", { name: "paper", exact: true }).click();
  await a.getByRole("button", { name: "Lock Choice", exact: true }).click();
  await expect(b.locator(".rps-opponent")).toHaveText("Violet: locked");
  const privateView = await (
    await c2.request.post("/api/state", {
      headers: { Origin: "http://localhost:3100" },
      data: { tabId: "rps-private-check" },
    })
  ).json();
  expect(privateView.state.match.round.rps.choices).toEqual({});
  expect(privateView.state.rpsStats[0].choices.paper).toBe(0);
  await a.reload();
  await expect(
    a.getByRole("button", { name: "Locked: paper", exact: true }),
  ).toBeDisabled();
  await expect(
    a.getByRole("button", { name: "rock", exact: true }),
  ).toBeDisabled();
  await b.getByRole("button", { name: "rock", exact: true }).click();
  await b.getByRole("button", { name: "Lock Choice", exact: true }).click();
  await expect(
    a.getByRole("heading", { name: "You win", exact: true }),
  ).toBeVisible();
  await expect(
    b.getByRole("heading", { name: "You lose", exact: true }),
  ).toBeVisible();
  await expect(
    a.getByText("Paper covers rock.", { exact: true }),
  ).toBeVisible();
  expect(
    await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await a.screenshot({
    path: "test-results/rps-result-desktop.png",
    fullPage: true,
  });
  await b.screenshot({
    path: "test-results/rps-result-mobile.png",
    fullPage: true,
  });
  await a.getByRole("button", { name: "One more? Rematch" }).click();
  await b.getByRole("button", { name: "One more? Rematch" }).click();
  await expect(
    a.getByRole("button", { name: "scissors", exact: true }),
  ).toBeEnabled({ timeout: 10000 });
  await a.getByRole("button", { name: "scissors", exact: true }).click();
  await a.getByRole("button", { name: "Lock Choice", exact: true }).click();
  await expect(
    a.getByText(
      "Violet wins by timeout: the other player did not lock a choice.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 15000 });
  await a.getByRole("button", { name: "Back to our room" }).click();
  await a.getByRole("button", { name: "First to 5", exact: true }).click();
  await a.getByRole("button", { name: "Ready to play" }).click();
  await b.getByRole("button", { name: "Ready to play" }).click();
  await expect(
    a.getByRole("button", { name: "rock", exact: true }),
  ).toBeEnabled({ timeout: 10000 });
  await a.screenshot({
    path: "test-results/rps-play-desktop.png",
    fullPage: true,
  });
  await b.screenshot({
    path: "test-results/rps-play-mobile.png",
    fullPage: true,
  });
  await a.getByRole("button", { name: "rock", exact: true }).click();
  await b.getByRole("button", { name: "rock", exact: true }).click();
  await a.getByRole("button", { name: "Lock Choice", exact: true }).click();
  await b.getByRole("button", { name: "Lock Choice", exact: true }).click();
  await expect(
    a.getByRole("heading", { name: "Draw", exact: true }),
  ).toBeVisible();
  await expect(a.locator(".panel-heading")).toContainText("ROUND 2", {
    timeout: 10000,
  });
  await expect(
    a.getByRole("button", { name: "rock", exact: true }),
  ).toBeEnabled({ timeout: 10000 });
  a.once("dialog", (dialog) => dialog.accept());
  await a.getByRole("button", { name: "Concede match" }).click();
  await a.getByRole("button", { name: "Our stats", exact: true }).click();
  await a
    .getByRole("button", { name: "Rock Paper Scissors", exact: true })
    .click();
  await expect(
    a.getByText("Round wins / losses / draws").first(),
  ).toBeVisible();
  await expect(a.getByText("Rock choices").first()).toBeVisible();
  await a.getByRole("button", { name: "Match history", exact: true }).click();
  await a
    .locator(".history-row")
    .filter({ hasText: "Rock Paper Scissors" })
    .last()
    .click();
  await expect(
    a.getByText("Paper covers rock.", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await c1.close();
  await c2.close();
});
