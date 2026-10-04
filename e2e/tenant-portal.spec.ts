import { expect, test, type Browser, type Page } from "@playwright/test";
import { addDaysISO, todayISO } from "../src/lib/format";
import { ADMIN, FRONT_DESK, MAINTENANCE, TENANT } from "./accounts";

// One story, start to finish: admin sets up a tenant, the tenant uses the
// portal, staff handle the request, and access rules hold for every role.
// Steps share state, so they run in order in a single test.

const future = addDaysISO(todayISO(), 14);

async function signIn(browser: Browser, account: { username: string; password: string }, viewport?: { width: number; height: number }) {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel(/^Username/).fill(account.username);
  await page.getByLabel(/^Password/).fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return page;
}

async function expectPath(page: Page, path: string, pathname: string) {
  await page.goto(path);
  await expect(page).toHaveURL((url) => url.pathname === pathname);
}

test("tenant portal", async ({ browser }) => {
  const admin = await signIn(browser, ADMIN);
  let occupantUrl = "";

  await test.step("admin creates the tenant's login", async () => {
    await admin.goto("/occupants");
    await admin.getByRole("link", { name: TENANT.name }).click();
    await admin.waitForURL(/\/occupants\/[0-9a-f-]{36}$/);
    occupantUrl = new URL(admin.url()).pathname;
    await admin.getByLabel(/^Username/).fill(TENANT.username);
    await admin.getByLabel(/^Password/).fill(TENANT.password);
    await admin.getByRole("button", { name: "Create login" }).click();
    await expect(admin.getByText(`can now sign in as ${TENANT.username}`)).toBeVisible();
  });

  await test.step("admin adds a house rule", async () => {
    await admin.goto("/house-rules");
    await admin.getByLabel(/^Title/).fill("Quiet hours");
    await admin.getByLabel(/^Details/).fill("No loud noise from 10 PM to 6 AM.");
    await admin.getByRole("button", { name: "Add rule" }).click();
    await expect(admin.getByText("Rule added.")).toBeVisible();
  });

  await test.step("admin sets kitchen and laundry times", async () => {
    const addSlot = async (kind: string, days: string[], from: string, to: string, target: string, note: string) => {
      await admin.goto("/schedules");
      await admin.getByLabel(/^Kitchen or laundry/).selectOption(kind);
      for (const d of days) await admin.getByLabel(d, { exact: true }).check();
      await admin.getByLabel(/^From/).fill(from);
      await admin.getByLabel(/^To/).fill(to);
      await admin.getByLabel(/^Who it's for/).selectOption(target);
      await admin.getByLabel(/^Name or note/).fill(note);
      await admin.getByRole("button", { name: "Add", exact: true }).click();
      await expect(admin.getByText(/Added \d time slot/)).toBeVisible();
    };
    await addSlot("kitchen", ["Mon", "Wed"], "18:00", "20:00", "floor:2", "Floor 2 dinner");
    await addSlot("kitchen", ["Fri"], "07:00", "08:00", "floor:3", "Floor 3 only");
    await addSlot("laundry", ["Tue"], "08:00", "10:00", "all", "Bags at lobby");
    await expect(admin.getByText("Floor 3 only")).toBeVisible();
  });

  await test.step("admin schedules maintenance visits", async () => {
    await admin.goto("/maintenance");
    const form = admin.locator("form", { has: admin.getByRole("button", { name: "Schedule" }) });
    const rooms = form.getByLabel(/^Rooms/);
    await form.getByLabel(/^What for/).fill("Aircon cleaning");
    await rooms.selectOption((await rooms.locator("option", { hasText: `Room ${TENANT.room}` }).getAttribute("value"))!);
    await form.getByLabel(/^Date/).fill(future);
    await form.getByLabel(/^From/).fill("09:00");
    await form.getByLabel(/^To/).fill("11:00");
    await form.getByRole("button", { name: "Schedule" }).click();
    await expect(admin.getByText("Scheduled 1 visit.")).toBeVisible();

    await form.getByLabel(/^What for/).fill("Pest control");
    await rooms.selectOption("floor:1");
    await form.getByLabel(/^Date/).fill(future);
    await form.getByRole("button", { name: "Schedule" }).click();
    await expect(admin.getByText("Scheduled 15 visits.")).toBeVisible();
  });

  await test.step("admin changes how many people each room allows", async () => {
    await admin.goto("/rooms");
    const form = admin.locator("form", { has: admin.getByRole("button", { name: "Change" }) });
    await form.getByLabel(/^Which rooms/).selectOption("all");
    await form.getByLabel(/^People allowed/).fill("2");
    await form.getByRole("button", { name: "Change" }).click();
    await expect(admin.getByText("75 rooms now allow 2 people.")).toBeVisible();
    await admin.goto("/");
    await expect(admin.getByText(/150 physical beds/)).toBeVisible();
  });

  const tenant = await signIn(browser, TENANT, { width: 390, height: 844 });

  await test.step("tenant sees their room, visits and timetable", async () => {
    await expect(tenant).toHaveURL(/\/me$/);
    const body = tenant.locator("main");
    await expect(body.getByLabel(`Room ${TENANT.room}`)).toBeVisible();
    await expect(body.getByText("Aircon cleaning")).toBeVisible();
    await expect(body.getByText(/Floor 2 dinner/).first()).toBeVisible();
    await expect(body.getByText(/Bags at lobby/)).toBeVisible();
    // Only what applies to their room and floor
    await expect(body.getByText("Pest control")).toHaveCount(0);
    await expect(body.getByText(/Floor 3 only/)).toHaveCount(0);
  });

  await test.step("tenant can't open staff pages", async () => {
    for (const path of ["/", "/staff", "/occupants", occupantUrl, "/requests", "/rooms", "/maintenance"]) {
      await expectPath(tenant, path, "/me");
    }
  });

  await test.step("tenant reads the house rules", async () => {
    await tenant.goto("/me/rules");
    await expect(tenant.getByText("Quiet hours")).toBeVisible();
  });

  await test.step("tenant sends requests", async () => {
    await tenant.goto("/me/requests");
    await tenant.getByLabel(/^What do you need/).selectOption("maintenance");
    await tenant.getByLabel(/^Tell us more/).fill("Toilet flush is weak, please check.");
    await tenant.getByRole("button", { name: "Send" }).click();
    await expect(tenant.getByText("Pick the date you'd like.")).toBeVisible();

    await tenant.getByLabel(/^Preferred date/).fill(future);
    await tenant.getByLabel(/^Preferred time/).fill("After 6 PM");
    await tenant.getByRole("button", { name: "Send" }).click();
    await expect(tenant.getByText("We'll let you know if it's approved.")).toBeVisible();

    await tenant.getByLabel(/^What do you need/).selectOption("issue");
    await tenant.getByLabel(/^Tell us more/).fill("Light bulb is broken");
    await tenant.getByRole("button", { name: "Send" }).click();
    await expect(tenant.getByText("The front desk will look into it.")).toBeVisible();
    await expect(tenant.getByText("Waiting for approval")).toBeVisible();
    await expect(tenant.getByText("Light bulb is broken")).toBeVisible();
  });

  await test.step("tenant cancels a request", async () => {
    tenant.once("dialog", (d) => d.accept());
    // Newest first, so the first card is the problem report
    await tenant.getByRole("button", { name: "Cancel request" }).first().click();
    await expect(tenant.getByText("Light bulb is broken")).toBeVisible();
    await expect(tenant.getByText("Withdrawn", { exact: true })).toBeVisible();
    await expect(tenant.getByText("Toilet flush is weak, please check.")).toBeVisible();
  });

  await test.step("tenant changes their password", async () => {
    await tenant.goto("/me/account");
    await tenant.getByLabel(/^Current password/).fill(TENANT.password);
    await tenant.getByLabel(/^New password/).fill("e2e-tenant-pass-2");
    await tenant.getByLabel(/^Repeat new password/).fill("e2e-tenant-pass-2");
    await tenant.getByRole("button", { name: "Change password" }).click();
    await expect(tenant.getByText("Password changed.")).toBeVisible();
  });

  await test.step("staff see the waiting request and approve it", async () => {
    await admin.goto("/");
    await expect(admin.getByText("1 tenant request")).toBeVisible();
    await admin.goto("/requests");
    await expect(admin.getByText("Toilet flush is weak, please check.")).toBeVisible();
    await admin.getByText("Approve or decline").click();
    const form = admin.locator("details", { hasText: "Approve or decline" }).first();
    await form.getByLabel(/^From/).fill("18:00");
    await form.getByLabel(/^To/).fill("19:00");
    await form.getByLabel(/^Reply to the tenant/).fill("Plumber will come.");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(admin.getByText("Saved.")).toBeVisible();
  });

  await test.step("approving books a maintenance visit", async () => {
    await admin.goto("/maintenance");
    await expect(admin.getByText("Requested by tenant")).toBeVisible();
    await expect(admin.getByText("Asked by tenant", { exact: true })).toBeVisible();
  });

  await test.step("tenant sees the approval", async () => {
    await tenant.goto("/me/requests");
    await expect(tenant.getByText("Approved", { exact: true })).toBeVisible();
    await expect(tenant.getByText("Front desk: Plumber will come.")).toBeVisible();
    await expect(tenant.getByText(/6:00 PM – 7:00 PM/)).toBeVisible();
    await tenant.goto("/me");
    await expect(tenant.getByText("Visit you asked for")).toBeVisible();
  });

  await test.step("finishing the visit closes the request", async () => {
    await admin.goto("/maintenance");
    await admin.locator("summary", { hasText: "Requested by tenant" }).click();
    const visit = admin.locator("details", { hasText: "Requested by tenant" });
    await visit.getByLabel(/^Status/).selectOption("done");
    await visit.getByRole("button", { name: "Save" }).click();
    // Done visits leave the Scheduled list
    await expect(admin.locator("summary", { hasText: "Requested by tenant" })).toHaveCount(0);
    await tenant.goto("/me/requests");
    await expect(tenant.getByText("Done", { exact: true })).toBeVisible();
  });

  await test.step("turning off the login signs the tenant out", async () => {
    await admin.goto(occupantUrl);
    await expect(admin.getByRole("heading", { name: "App login for this tenant" })).toBeVisible();
    await admin.locator('input[name="active"]').uncheck();
    await admin.getByRole("button", { name: "Save" }).last().click();
    await expect(admin.getByText("Saved.").first()).toBeVisible();
    await expectPath(tenant, "/me", "/login");
  });

  await test.step("staff pages keep tenant logins separate", async () => {
    await admin.goto("/staff");
    await expect(admin.getByText(`Username: ${TENANT.username}`)).toHaveCount(0);
    await admin.goto("/me");
    await expect(admin.getByText("Page not found")).toBeVisible();
  });

  await test.step("maintenance can view the timetable but not edit it", async () => {
    const maintenance = await signIn(browser, MAINTENANCE);
    await maintenance.goto("/schedules");
    await expect(maintenance.getByText("Floor 2 dinner").first()).toBeVisible();
    await expect(maintenance.getByText("Add time slots")).toHaveCount(0);
    await maintenance.goto("/requests?view=closed");
    await expect(maintenance.getByText("Toilet flush is weak, please check.")).toBeVisible();
  });

  await test.step("front desk can't manage staff accounts", async () => {
    const desk = await signIn(browser, FRONT_DESK);
    await desk.goto("/staff");
    await expect(desk.getByText("Page not found")).toBeVisible();
  });
});
