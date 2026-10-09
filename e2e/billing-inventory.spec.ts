import { expect, test, type Browser } from "@playwright/test";
import { ADMIN, FRONT_DESK, MAINTENANCE, RESIDENT } from "./accounts";

// Money and room items, through the real forms: the admin issues a statement and
// enters a utility bill, the front desk takes a payment and charges a tenant, the
// tenant sees their charge, and maintenance checks a room and books a repair.

async function signIn(browser: Browser, account: { username: string; password: string }) {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByLabel(/^Username/).fill(account.username);
  await page.getByLabel(/^Password/).fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return page;
}

test("billing and room inventory", async ({ browser }) => {
  const admin = await signIn(browser, ADMIN);
  let accountUrl = "";

  await test.step("admin issues the first monthly statement", async () => {
    await admin.goto("/billing");
    await admin.getByRole("link", { name: "E2E Company" }).click();
    await admin.waitForURL(/\/billing\/contracts\/[0-9a-f-]{36}$/);
    accountUrl = new URL(admin.url()).pathname;
    await admin.getByRole("button", { name: "Issue statement for month 1" }).click();
    await admin.waitForURL(/\/billing\/statements\/[0-9a-f-]{36}$/);
    await expect(admin.getByText("Statement of account", { exact: true })).toBeVisible();
    await expect(admin.getByText("This is a statement of account, not an official receipt.")).toBeVisible();
    await expect(admin.getByRole("cell", { name: "₱10,000.00" }).first()).toBeVisible();
  });

  await test.step("admin enters an electricity bill; it waits for the next statement", async () => {
    await admin.goto("/billing/utilities");
    const card = admin.locator("form", { has: admin.getByRole("button", { name: "Save electricity bill" }) });
    await card.getByLabel(/^Amount on the bill/).fill("3,456.78");
    await card.getByRole("button", { name: "Save electricity bill" }).click();
    await expect(admin.getByText("Electricity bill saved.")).toBeVisible();
    await admin.goto(accountUrl);
    await expect(admin.getByText("Not on a statement yet", { exact: true }).locator("..")).toContainText("₱3,456.78");
  });

  await test.step("front desk records a payment with its reference", async () => {
    const desk = await signIn(browser, FRONT_DESK);
    await desk.goto(accountUrl);
    const form = desk.locator("form", { has: desk.getByRole("button", { name: "Record payment" }) });
    await form.getByLabel(/^Amount received/).fill("4000");
    await form.getByLabel(/^Paid by/).selectOption("gcash");
    await form.getByRole("button", { name: "Record payment" }).click();
    await expect(form.getByRole("alert")).toContainText("reference");
    await form.getByLabel(/^Reference or check number/).fill("GC-778899");
    await form.getByRole("button", { name: "Record payment" }).click();
    await expect(desk.getByText("Payment recorded.")).toBeVisible();
    await desk.reload();
    await expect(desk.getByText("Ref. GC-778899").first()).toBeVisible();
    // Front desk can't issue statements or open utilities
    await expect(desk.getByRole("button", { name: /Issue statement/ })).toHaveCount(0);
    expect((await desk.goto("/billing/utilities"))?.status()).toBe(404);
  });

  await test.step("front desk charges a tenant for laundry, and the tenant sees it", async () => {
    const desk = await signIn(browser, FRONT_DESK);
    await desk.goto(`/occupants?q=${encodeURIComponent(RESIDENT.name)}`);
    await desk.locator("main table a[href^='/occupants/']").first().click();
    await desk.getByRole("link", { name: "Charges and payments" }).click();
    await desk.waitForURL(/\/billing\/tenants\//);
    const form = desk.locator("form", { has: desk.getByRole("button", { name: "Add charge" }) });
    await form.getByLabel(/^For/).selectOption({ label: "Laundry" });
    await form.getByLabel(/^Amount/).fill("240");
    await form.getByLabel(/^Description/).fill("Laundry, 4 kg");
    await form.getByRole("button", { name: "Add charge" }).click();
    await expect(desk.getByText("Charge added to the tenant's account.")).toBeVisible();

    const tenant = await signIn(browser, RESIDENT);
    await expect(tenant.getByText("Your charges")).toBeVisible();
    await expect(tenant.getByText("Laundry, 4 kg")).toBeVisible();
    await expect(tenant.getByText("You owe")).toContainText("₱240.00");
    expect((await tenant.goto("/billing"))?.url()).toMatch(/\/me$/);
  });

  await test.step("an item is added, checked by maintenance, and a repair is booked", async () => {
    await admin.goto("/inventory");
    await expect(admin.getByText("No contract-start check")).toBeVisible();
    await admin.goto("/rooms");
    await admin.locator(`main a[href^='/rooms/']`).filter({ hasText: RESIDENT.room, visible: true }).first().click();
    await admin.getByRole("link", { name: "Items in this room" }).click();
    await admin.getByText("Add an item").click();
    const add = admin.locator("form", { has: admin.getByRole("button", { name: "Add item" }) });
    await add.getByLabel(/^Name/).fill("Study chair");
    await add.getByLabel(/^How many/).fill("2");
    await add.getByLabel(/^Replacement cost/).fill("1,500");
    await add.getByRole("button", { name: "Add item" }).click();
    await expect(admin.getByText("Study chair added.")).toBeVisible();
    const roomUrl = new URL(admin.url()).pathname;

    const fix = await signIn(browser, MAINTENANCE);
    await fix.goto(roomUrl);
    const check = fix.locator("#check");
    await check.getByLabel(/^Kind of check/).selectOption("spot");
    await check.getByLabel(/^Found/).fill("1");
    await check.getByRole("button", { name: "Save check" }).click();
    await fix.waitForURL(/\/inventory\/checks\//);
    await expect(fix.getByRole("heading", { name: /^Spot check, room/ })).toBeVisible();
    await expect(fix.getByText("1 of 2")).toBeVisible();
    // Maintenance sees what changed but can't charge for it
    await expect(fix.getByRole("button", { name: "Charge it" })).toHaveCount(0);

    await fix.goto(roomUrl);
    const item = fix.locator("[id^='item-']", { hasText: "Study chair" });
    await item.getByText("Update condition").click();
    await item.getByLabel(/^Condition/).selectOption("damaged");
    await item.getByLabel(/^Note/).fill("Wobbly leg");
    await item.getByLabel("Book a repair visit for this").check();
    await item.getByRole("button", { name: "Save" }).click();
    await expect(fix.getByText("Saved, and a repair visit was booked.")).toBeVisible();
    await fix.goto("/maintenance");
    await expect(fix.getByText("Repair: Study chair")).toBeVisible();
  });
});
