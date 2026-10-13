import { expect, test, type Browser } from "@playwright/test";
import { ADMIN, COMPANY_ADMIN, FRONT_DESK, OTHER_COMPANY, TENANT } from "./accounts";

// A company's own account: the hotel admin gives it logins, the company manages its
// people and asks for moves, and the front desk does the moves.

const COORD = { name: "Carlo Coordinator", username: "coord", password: "e2e-coord-pass" };
const NEW_PERSON = "Ana Bagong-Dating";
const ROOM = "412";

async function signIn(browser: Browser, account: { username: string; password: string }) {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByLabel(/^Username/).fill(account.username);
  await page.getByLabel(/^Password/).fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return page;
}

test("company account: logins, people and moves", async ({ browser }) => {
  await test.step("the hotel admin sets the agreement and adds a company login", async () => {
    const admin = await signIn(browser, ADMIN);
    await admin.goto("/clients");
    await admin.getByRole("link", { name: "E2E Company" }).click();
    await expect(admin.getByRole("heading", { name: "Company account" })).toBeVisible();
    await expect(admin.getByText(`Signs in as ${COMPANY_ADMIN.username}`)).toBeVisible();
    await admin.locator("summary", { hasText: "Add a company login" }).click();
    const form = admin.locator("form", { has: admin.getByRole("button", { name: "Add login" }) });
    await form.getByLabel("Name", { exact: true }).fill(COORD.name);
    await form.getByLabel("Username").fill(COORD.username);
    await form.getByLabel(/^Password/).fill(COORD.password);
    await form.getByLabel("Role").selectOption("company_staff");
    await form.getByRole("button", { name: "Add login" }).click();
    await expect(admin.getByText(`${COORD.name} can now sign in as ${COORD.username}.`)).toBeVisible();
  });

  const hr = await signIn(browser, COMPANY_ADMIN);
  await test.step("the company admin lands on their own company and sees only its people", async () => {
    await expect(hr).toHaveURL(/\/company$/);
    await expect(hr.getByRole("heading", { name: "E2E Company" })).toBeVisible();
    await expect(hr.getByRole("link", { name: TENANT.name })).toBeVisible();
    await hr.goto("/company/people?show=all");
    await expect(hr.getByText(TENANT.name)).toBeVisible();
    expect(await hr.content()).not.toContain(OTHER_COMPANY.person);
    // Hotel pages send them back to their company.
    await hr.goto("/occupants");
    await expect(hr).toHaveURL(/\/company$/);
  });

  await test.step("the company adds a person and asks for a room", async () => {
    await hr.goto("/company/people/new");
    await hr.getByLabel("Full name").fill(NEW_PERSON);
    await hr.getByLabel("Position").fill("Night shift agent");
    await hr.getByRole("button", { name: "Add person" }).click();
    await hr.waitForURL(/\/company\/people\/[0-9a-f-]{36}$/);
    const added = hr.url();
    // Still waiting for a room, they stay on the default People list.
    await hr.goto("/company/people");
    await expect(hr.getByRole("link", { name: new RegExp(NEW_PERSON) })).toContainText("No room yet");
    await hr.goto(added);
    // Rooms with a free bed come first; full rooms follow and can't be picked.
    const options = await hr.locator("select[name=roomId] option:not([value=''])").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).disabled));
    expect(options.indexOf(true) === -1 || options.slice(options.indexOf(true)).every(Boolean)).toBe(true);
    const room = await hr.locator("select[name=roomId] option", { hasText: `Room ${ROOM},` }).getAttribute("value");
    await hr.locator("select[name=roomId]").selectOption(room!);
    await hr.locator("input[name=note]").fill("Arrives after 6 PM");
    await hr.getByRole("button", { name: "Send to the front desk" }).click();
    await expect(hr.getByText(/Move in asked/)).toBeVisible();
    await expect(hr.getByText(/Waiting for the front desk/)).toBeVisible();
  });
  const personPage = hr.url();

  await test.step("the front desk moves them in", async () => {
    const desk = await signIn(browser, FRONT_DESK);
    await desk.goto("/assignments");
    const ask = desk.locator("div", { hasText: NEW_PERSON }).filter({ has: desk.getByRole("button", { name: "Move them in" }) }).last();
    await expect(ask.getByText(`Into room ${ROOM} on`)).toBeVisible();
    await expect(ask.getByText("Arrives after 6 PM")).toBeVisible();
    await ask.getByLabel("Keys and cards issued").fill("1 key card");
    await ask.getByRole("button", { name: "Move them in" }).click();
    // The ask leaves the list once done; the room now shows them.
    await expect(desk.getByRole("heading", { name: "Asked by companies" })).toHaveCount(0);
    await expect(desk.getByRole("row", { name: new RegExp(`^${ROOM} .*${NEW_PERSON}`) })).toBeVisible();
  });

  await test.step("the company sees the room and asks for the move-out", async () => {
    await hr.goto(personPage);
    await expect(hr.getByText(`Room ${ROOM}`, { exact: true })).toBeVisible();
    await hr.locator("summary", { hasText: "Ask for a move-out" }).click();
    await hr.getByRole("button", { name: "Send to the front desk" }).click();
    await expect(hr.getByText(/Move out asked/)).toBeVisible();
  });

  await test.step("the front desk moves them out on the day", async () => {
    const desk = await signIn(browser, FRONT_DESK);
    await desk.goto("/assignments");
    await desk.getByRole("button", { name: "Move them out" }).click();
    await expect(desk.getByRole("heading", { name: "Asked by companies" })).toHaveCount(0);
    await expect(desk.getByRole("row", { name: new RegExp(`^${ROOM} `) })).not.toContainText(NEW_PERSON);
  });

  await test.step("company staff see people and requests, but no bills or team", async () => {
    const coord = await signIn(browser, COORD);
    await expect(coord.getByRole("link", { name: "People" }).first()).toBeVisible();
    await expect(coord.getByRole("link", { name: "Bills" })).toHaveCount(0);
    await expect(coord.getByRole("link", { name: "Team" })).toHaveCount(0);
    expect((await coord.goto("/company/billing"))?.status()).toBe(404);
    expect((await coord.goto("/company/team"))?.status()).toBe(404);
  });
});
