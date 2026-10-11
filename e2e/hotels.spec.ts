import { expect, test, type Browser } from "@playwright/test";
import { ADMIN, TENANT } from "./accounts";

// Several hotels: the owner adds one, switches between them, and gives it its own
// staff, who only ever see that hotel.

const HOTEL = "Seaside hotel";
const DESK = { name: "Sol Seaside", username: "seaside.desk", password: "e2e-seaside-pass" };

async function signIn(browser: Browser, account: { username: string; password: string }) {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByLabel(/^Username/).fill(account.username);
  await page.getByLabel(/^Password/).fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return page;
}

test("hotels: add one, switch, and keep its staff to it", async ({ browser }) => {
  const admin = await signIn(browser, ADMIN);
  const mainRoom = (await admin.locator(`a[aria-label^="Room ${TENANT.room}."]`).getAttribute("href"))!;

  await test.step("the owner adds a hotel with its rooms", async () => {
    await admin.goto("/hotels");
    const form = admin.locator("form", { has: admin.getByRole("button", { name: "Add hotel" }) });
    await form.getByLabel("Name", { exact: true }).fill(HOTEL);
    await form.getByLabel("Floors").fill("2");
    await form.getByLabel("Rooms per floor").fill("3");
    await form.getByRole("button", { name: "Add hotel" }).click();
    await expect(admin.getByText(`${HOTEL} added with 6 rooms. You're now looking at it.`)).toBeVisible();
  });

  await test.step("the room board shows only the hotel being looked at", async () => {
    await admin.goto("/");
    await expect(admin.getByText(new RegExp(`^${HOTEL}, `))).toBeVisible();
    await expect(admin.locator('a[aria-label^="Room "]')).toHaveCount(6);
    await admin.getByLabel("Hotel", { exact: true }).selectOption({ label: "Main hotel" });
    await expect(admin.getByText(/^Main hotel, /)).toBeVisible();
    await expect(admin.locator('a[aria-label^="Room "]')).toHaveCount(75);
  });

  await test.step("the owner adds front desk staff for the new hotel", async () => {
    await admin.goto("/staff");
    const form = admin.locator("form", { has: admin.getByRole("button", { name: "Add staff" }) });
    await form.getByLabel("Name", { exact: true }).fill(DESK.name);
    await form.getByLabel("Username").fill(DESK.username);
    await form.getByLabel("Role").selectOption("front_desk");
    await form.getByLabel("Works at").selectOption({ label: HOTEL });
    await form.getByLabel(/^Password/).fill(DESK.password);
    await form.getByRole("button", { name: "Add staff" }).click();
    await expect(admin.getByText(`${DESK.name} can now sign in as ${DESK.username}.`)).toBeVisible();
  });

  await test.step("that staff member sees only their hotel", async () => {
    const desk = await signIn(browser, DESK);
    await expect(desk.getByText(new RegExp(`^${HOTEL}, `))).toBeVisible();
    await expect(desk.locator('a[aria-label^="Room "]')).toHaveCount(6);
    await expect(desk.getByLabel("Hotel", { exact: true })).toHaveCount(0);
    expect((await desk.goto(mainRoom))?.status()).toBe(404);
    expect((await desk.goto("/hotels"))?.status()).toBe(404);
    await desk.goto(`/occupants?q=${encodeURIComponent(TENANT.name)}`);
    await expect(desk.getByText(TENANT.name)).toHaveCount(0);
  });
});
