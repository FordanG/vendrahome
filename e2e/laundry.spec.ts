import { expect, test, type Browser } from "@playwright/test";
import { ADMIN, FRONT_DESK, RESIDENT } from "./accounts";

async function signIn(browser: Browser, account: { username: string; password: string }) {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.goto("/login");
  await page.getByLabel(/^Username/).fill(account.username);
  await page.getByLabel(/^Password/).fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return page;
}

test("laundry", async ({ browser }) => {
  await test.step("admin sets the price", async () => {
    const admin = await signIn(browser, ADMIN);
    await admin.goto("/laundry/settings");
    await admin.getByLabel(/^Name/).fill("Wash, dry and fold");
    await admin.getByLabel(/^Price per kilo/).fill("60");
    await admin.getByLabel(/^Shop's cost per kilo/).fill("40");
    await admin.getByRole("button", { name: "Add service" }).click();
    await expect(admin.getByText("Wash, dry and fold added.")).toBeVisible();
  });

  const desk = await signIn(browser, FRONT_DESK);
  await test.step("front desk logs the bag, sends it, weighs it", async () => {
    await desk.goto("/laundry");
    await desk.getByLabel("Tenant").selectOption({ label: `Room ${RESIDENT.room}, ${RESIDENT.name}` });
    await desk.getByRole("button", { name: "Log the bag" }).click();
    await expect(desk.getByText(/Write \d+ on the bag tag/)).toBeVisible();
    await desk.goto("/laundry/handoff");
    await expect(desk.getByRole("cell", { name: RESIDENT.room })).toBeVisible();
    await desk.goto("/laundry");
    await desk.getByRole("button", { name: "Send ticked bags to the shop" }).click();
    await expect(desk.getByText("No bags waiting to go to the shop.")).toBeVisible();
    await desk.getByLabel(/^Kilos on the shop's slip/).fill("4.5");
    await desk.getByRole("button", { name: "Back from the shop" }).click();
    await expect(desk.getByText("4.5 kg, ₱270.00")).toBeVisible();
    await desk.screenshot({ path: "test-results/laundry-desk.png", fullPage: true });
  });

  await test.step("tenant sees it ready and reports a missing shirt after pickup", async () => {
    const tenant = await signIn(browser, RESIDENT);
    await expect(tenant.getByText("Ready to pick up")).toBeVisible();
    await desk.reload();
    await desk.getByRole("button", { name: "Picked up" }).click();
    await expect(desk.getByText("Nothing waiting for tenants.")).toBeVisible();
    await tenant.goto("/me/laundry");
    await tenant.getByText("Something missing or damaged?").click();
    await tenant.getByLabel(/^Details/).fill("One white shirt");
    await tenant.getByRole("button", { name: "Send" }).click();
    await expect(tenant.getByText(/front desk will follow up/)).toBeVisible();
    await tenant.screenshot({ path: "test-results/laundry-tenant.png", fullPage: true });
    await desk.reload();
    await expect(desk.getByText("One white shirt")).toBeVisible();
    await desk.getByLabel(/^How it was settled/).fill("Found at the shop and returned");
    await desk.getByRole("button", { name: "Close claim" }).click();
    await expect(desk.getByText("Problems reported")).toHaveCount(0);
  });
});
