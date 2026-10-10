import { expect, test, type Browser } from "@playwright/test";
import { ADMIN, FRONT_DESK, MAINTENANCE, RESIDENT } from "./accounts";

// Runs after door-codes.spec.ts, which finishes a cleaning of the resident's room.

async function signIn(browser: Browser, account: { username: string; password: string }, start = "/login") {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(start);
  await page.getByLabel(/^Username/).fill(account.username);
  await page.getByLabel(/^Password/).fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return page;
}

test("service work", async ({ browser }) => {
  const admin = await signIn(browser, ADMIN);
  await admin.goto("/rooms");
  await admin.locator('a[href^="/rooms/"]:visible', { hasText: RESIDENT.room }).first().click();
  const scanPath = new URL((await admin.locator('a[href*="/r/"]').getAttribute("href"))!).pathname;

  await test.step("maintenance runs the monthly check from the door; a problem becomes a request", async () => {
    const fix = await signIn(browser, MAINTENANCE, scanPath);
    const card = fix.locator("li", { hasText: "Monthly room check" });
    await card.getByRole("button", { name: "Start" }).click();
    await fix.waitForURL(/\/maintenance\/checklists\/runs\//);
    const items = ["Aircon filter clean", "All lights work", "Outlets and switches work", "No leaks under the sink or toilet", "Doors, locks and windows close properly"];
    for (const item of items) {
      const group = fix.getByRole("radiogroup", { name: item });
      await group.getByText(item === "All lights work" ? "Problem" : "OK", { exact: true }).click();
    }
    await fix.getByLabel("All lights work note").fill("Bathroom bulb out");
    await fix.screenshot({ path: "test-results/checklist-run.png", fullPage: true });
    await fix.getByRole("button", { name: "Finished checklist" }).click();
    await fix.waitForURL(/done=1/);
    await expect(fix.getByText("1 problem was added to Requests.")).toBeVisible();
    await fix.goto("/requests");
    await expect(fix.getByText("Monthly room check: All lights work. Bathroom bulb out")).toBeVisible();

    await test.step("records the repair cost, paid by the hotel", async () => {
      const report = fix.locator("article", { hasText: "Bathroom bulb out" });
      await report.getByText("Record the repair cost").click();
      await report.getByLabel(/^Cost, parts and labour/).fill("120");
      await report.getByRole("button", { name: "Save cost" }).click();
      await expect(report.getByText("Repair cost ₱120.00, paid by the hotel")).toBeVisible();
      // Close it so later tests see no waiting requests.
      await report.getByText("Update", { exact: true }).click();
      await report.getByLabel("Status").selectOption("done");
      await report.getByRole("button", { name: "Save", exact: true }).click();
      await expect(fix.getByText("Bathroom bulb out")).toHaveCount(0);
    });
  });

  await test.step("tenant rates the cleaning; a low rating is followed up", async () => {
    const tenant = await signIn(browser, RESIDENT);
    await expect(tenant.getByText("How did we do?")).toBeVisible();
    const form = tenant.locator("form", { hasText: "Your room was cleaned" });
    await form.getByText("2★").click();
    await form.getByLabel("Comment").fill("Bathroom was skipped");
    await form.getByRole("button", { name: "Send" }).click();
    await expect(tenant.getByText("Your room was cleaned")).toHaveCount(0);

    const desk = await signIn(browser, FRONT_DESK);
    await desk.goto("/feedback");
    await expect(desk.getByText("Bathroom was skipped").first()).toBeVisible();
    await desk.getByLabel(/^What was done/).fill("Re-cleaned the bathroom");
    await desk.getByRole("button", { name: "Save follow-up" }).click();
    await expect(desk.getByText("Nothing to follow up.")).toBeVisible();
    await desk.screenshot({ path: "test-results/feedback.png", fullPage: true });
  });
});
