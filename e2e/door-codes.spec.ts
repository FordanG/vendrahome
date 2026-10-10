import { expect, test, type Browser } from "@playwright/test";
import { ADMIN, FRONT_DESK, MAINTENANCE, RESIDENT } from "./accounts";

async function signIn(browser: Browser, account: { username: string; password: string }, start = "/login") {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(start);
  await page.getByLabel(/^Username/).fill(account.username);
  await page.getByLabel(/^Password/).fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return page;
}

test("door codes", async ({ browser }) => {
  const admin = await signIn(browser, ADMIN);
  let scanPath = "";
  let roomPath = "";

  await test.step("admin sees and prints the room's door code", async () => {
    await admin.goto("/rooms");
    await admin.getByRole("link", { name: "Print door codes" }).click();
    await expect(admin.getByRole("heading", { name: "Door codes" })).toBeVisible();
    await admin.screenshot({ path: "test-results/door-codes-sheet.png", fullPage: true });
    await admin.goto("/rooms");
    await admin.locator('a[href^="/rooms/"]:visible', { hasText: "305" }).first().click();
    await expect(admin.getByRole("heading", { name: "Door code" })).toBeVisible();
    roomPath = new URL(admin.url()).pathname;
    scanPath = new URL((await admin.locator('a[href*="/r/"]').getAttribute("href"))!).pathname;
    expect(scanPath).toMatch(/^\/r\/[\w-]+$/);
  });

  await test.step("staff scan while signed out, sign in, and land back on the room", async () => {
    const fix = await signIn(browser, MAINTENANCE, scanPath);
    await expect(fix).toHaveURL((url) => url.pathname === scanPath);
    await expect(fix.getByRole("heading", { name: "Room 305" })).toBeVisible();
    await fix.getByRole("button", { name: "I'm at Room 305" }).click();
    await expect(fix.getByText(/Checked in at Room 305/)).toBeVisible();
    await fix.reload();
    await expect(fix.getByText(/You checked in at/)).toBeVisible();
    await fix.screenshot({ path: "test-results/door-code-staff.png", fullPage: true });
  });

  await test.step("tenants who scan go to their requests", async () => {
    const tenant = await signIn(browser, RESIDENT);
    await tenant.goto(scanPath);
    await expect(tenant).toHaveURL((url) => url.pathname === "/me/requests");
  });

  await test.step("front desk cleans the room from the door code", async () => {
    await admin.goto("/housekeeping");
    await admin.getByLabel("Which rooms").selectOption("all");
    await admin.getByLabel(/^Clean every this many days/).fill("7");
    await admin.getByRole("button", { name: "Set schedule" }).click();
    await expect(admin.getByText(/rooms now cleaned every 7 days/)).toBeVisible();

    const desk = await signIn(browser, FRONT_DESK, scanPath);
    await desk.getByRole("button", { name: "Clean this room" }).click();
    await desk.waitForURL(/\/housekeeping\/cleanings\//);
    await expect(desk.getByText("Checked in at the door", { exact: false })).toBeVisible();
    await desk.getByLabel("Empty the bins").check();
    await desk.screenshot({ path: "test-results/cleaning-checklist.png", fullPage: true });
    await desk.getByRole("button", { name: "Finished cleaning" }).click();
    await desk.waitForURL((url) => url.pathname === "/housekeeping");
    await expect(desk.getByText("Room 305").first()).toBeVisible();
    await expect(desk.getByText(/steps not done/).first()).toBeVisible();
    await desk.screenshot({ path: "test-results/housekeeping.png", fullPage: true });
  });

  await test.step("maintenance starts a spot check from the door", async () => {
    const fix = await signIn(browser, MAINTENANCE, scanPath);
    await expect(fix.getByRole("button", { name: "Clean this room" })).toHaveCount(0);
    await fix.getByRole("button", { name: "Spot check" }).click();
    await fix.waitForURL(/\/inventory\/rooms\/.*kind=spot/);
    await expect(fix.getByRole("heading", { name: "Check the room" })).toBeVisible();
  });

  await test.step("tenants report a problem from a shared-space code", async () => {
    await admin.goto("/rooms/door-codes");
    await admin.getByLabel(/^Name/).last().fill("Kitchen, 2nd floor");
    await admin.getByRole("button", { name: "Add place" }).click();
    await expect(admin.getByText(/Kitchen, 2nd floor added/)).toBeVisible();
    await admin.getByText("Kitchen, 2nd floor", { exact: true }).click();
    const areaPath = new URL((await admin.locator('details[open] a[href*="/r/"]').getAttribute("href"))!).pathname;
    const tenant = await signIn(browser, RESIDENT);
    await tenant.goto(areaPath);
    await expect(tenant).toHaveURL(/\/me\/requests\?area=/);
    await tenant.getByLabel(/^What's wrong/).fill("Stove burner won't light");
    await tenant.getByRole("button", { name: "Send" }).click();
    await expect(tenant.getByText(/Sent/)).toBeVisible();
    await expect(tenant.getByText("in Kitchen, 2nd floor")).toBeVisible();
    await admin.goto("/requests");
    await expect(admin.getByText("Stove burner won't light")).toBeVisible();
    // Leave no waiting request behind for the tenant portal test.
    tenant.once("dialog", (d) => d.accept());
    await tenant.getByRole("button", { name: "Cancel request" }).first().click();
    await expect(tenant.getByText("Withdrawn by tenant.").first()).toBeVisible();
  });

  await test.step("a replaced code stops working", async () => {
    await admin.goto(roomPath);
    admin.once("dialog", (d) => d.accept());
    await admin.getByRole("button", { name: "Make a new code" }).click();
    await expect(admin.getByText(/New code made/)).toBeVisible();
    const res = await admin.goto(scanPath);
    expect(res?.status()).toBe(404);
  });
});
