import { expect, test, type Browser } from "@playwright/test";
import { ADMIN, MAINTENANCE, RESIDENT } from "./accounts";

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

  await test.step("admin sees and prints the room's door code", async () => {
    await admin.goto("/rooms");
    await admin.getByRole("link", { name: "Print door codes" }).click();
    await expect(admin.getByRole("heading", { name: "Door codes" })).toBeVisible();
    await admin.screenshot({ path: "test-results/door-codes-sheet.png", fullPage: true });
    await admin.goto("/rooms");
    await admin.locator('a[href^="/rooms/"]:visible', { hasText: "305" }).first().click();
    await expect(admin.getByRole("heading", { name: "Door code" })).toBeVisible();
    scanPath = new URL((await admin.locator('a[href*="/r/"]').getAttribute("href"))!).pathname;
    expect(scanPath).toMatch(/^\/r\/[\w-]+$/);
  });

  await test.step("staff scan while signed out, sign in, and land back on the room", async () => {
    const fix = await signIn(browser, MAINTENANCE, scanPath);
    await expect(fix).toHaveURL((url) => url.pathname === scanPath);
    await expect(fix.getByRole("heading", { name: "Check in at Room 305" })).toBeVisible();
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

  await test.step("a replaced code stops working", async () => {
    admin.once("dialog", (d) => d.accept());
    await admin.getByRole("button", { name: "Make a new code" }).click();
    await expect(admin.getByText(/New code made/)).toBeVisible();
    const res = await admin.goto(scanPath);
    expect(res?.status()).toBe(404);
  });
});
