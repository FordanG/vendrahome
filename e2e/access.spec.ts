import { expect, test, type Browser } from "@playwright/test";
import { ADMIN, FRONT_DESK, MAINTENANCE, RESIDENT } from "./accounts";

// Who can open what, and which personal data each role sees.
// "open" means the page loads. "hidden" means it answers "Page not found", exactly like an
// address that doesn't exist. Any other value is where the person is sent instead.

type Role = "admin" | "desk" | "fix" | "tenant";
const ACCOUNTS: Record<Role, { username: string; password: string }> = {
  admin: ADMIN,
  desk: FRONT_DESK,
  fix: MAINTENANCE,
  tenant: RESIDENT,
};

const HIDDEN = "hidden";
const PAGES: [string, Record<Role, string>][] = [
  ["/", { admin: "open", desk: "open", fix: "open", tenant: "/me" }],
  ["/rooms", { admin: "open", desk: "open", fix: "open", tenant: "/me" }],
  ["/requests", { admin: "open", desk: "open", fix: "open", tenant: "/me" }],
  ["/maintenance", { admin: "open", desk: "open", fix: "open", tenant: "/me" }],
  ["/schedules", { admin: "open", desk: "open", fix: "open", tenant: "/me" }],
  ["/house-rules", { admin: "open", desk: "open", fix: "open", tenant: "/me" }],
  ["/account", { admin: "open", desk: "open", fix: "open", tenant: "/me" }],
  ["/occupants", { admin: "open", desk: "open", fix: HIDDEN, tenant: "/me" }],
  ["/occupants/new", { admin: "open", desk: "open", fix: HIDDEN, tenant: "/me" }],
  ["/assignments", { admin: "open", desk: "open", fix: HIDDEN, tenant: "/me" }],
  ["/assignments/import", { admin: "open", desk: "open", fix: HIDDEN, tenant: "/me" }],
  ["/contracts", { admin: "open", desk: "open", fix: HIDDEN, tenant: "/me" }],
  ["/contracts/new", { admin: "open", desk: HIDDEN, fix: HIDDEN, tenant: "/me" }],
  ["/clients", { admin: "open", desk: "open", fix: HIDDEN, tenant: "/me" }],
  ["/clients/new", { admin: "open", desk: HIDDEN, fix: HIDDEN, tenant: "/me" }],
  ["/audit", { admin: "open", desk: HIDDEN, fix: HIDDEN, tenant: "/me" }],
  ["/billing", { admin: "open", desk: "open", fix: HIDDEN, tenant: "/me" }],
  ["/billing/utilities", { admin: "open", desk: HIDDEN, fix: HIDDEN, tenant: "/me" }],
  ["/billing/settings", { admin: "open", desk: HIDDEN, fix: HIDDEN, tenant: "/me" }],
  ["/inventory", { admin: "open", desk: "open", fix: "open", tenant: "/me" }],
  ["/inventory/rooms/storeroom", { admin: "open", desk: "open", fix: "open", tenant: "/me" }],
  ["/inventory/templates", { admin: "open", desk: HIDDEN, fix: HIDDEN, tenant: "/me" }],
  ["/staff", { admin: "open", desk: HIDDEN, fix: HIDDEN, tenant: "/me" }],
  ["/me", { admin: HIDDEN, desk: HIDDEN, fix: HIDDEN, tenant: "open" }],
  ["/me/requests", { admin: HIDDEN, desk: HIDDEN, fix: HIDDEN, tenant: "open" }],
  ["/me/rules", { admin: HIDDEN, desk: HIDDEN, fix: HIDDEN, tenant: "open" }],
  ["/me/account", { admin: HIDDEN, desk: HIDDEN, fix: HIDDEN, tenant: "open" }],
];

async function signIn(browser: Browser, role: Role) {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByLabel(/^Username/).fill(ACCOUNTS[role].username);
  await page.getByLabel(/^Password/).fill(ACCOUNTS[role].password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return page;
}

for (const role of Object.keys(ACCOUNTS) as Role[]) {
  test(`page access: ${role}`, async ({ browser }) => {
    const page = await signIn(browser, role);
    for (const [path, expected] of PAGES) {
      const response = await page.goto(path);
      const url = new URL(page.url());
      const hidden = response?.status() === 404 || (await page.getByText("Page not found").count()) > 0;
      const landed = hidden ? HIDDEN : url.pathname === path ? "open" : url.pathname + url.search;
      expect.soft(landed, `${role} opening ${path}`).toBe(expected[role]);
    }
    const download = await page.request.get("/assignments/import/template", { maxRedirects: 0 });
    expect.soft(download.status() === 200, `${role} downloading the import template`).toBe(role === "admin" || role === "desk");
  });
}

test("personal data by role", async ({ browser }) => {
  const admin = await signIn(browser, "admin");
  await admin.goto(`/occupants?q=${encodeURIComponent(RESIDENT.name)}`);
  const tenantPage = (await admin.locator("main table a[href^='/occupants/']").first().getAttribute("href"))!;
  await admin.goto("/");
  const roomPage = (await admin.locator(`a[aria-label^="Room ${RESIDENT.room}."]`).getAttribute("href"))!;

  await test.step("admin and front desk see the tenant's phone and government ID", async () => {
    for (const role of ["admin", "desk"] as const) {
      const page = role === "admin" ? admin : await signIn(browser, role);
      await page.goto(tenantPage);
      await expect(page.getByText("0917 555 0199")).toBeVisible();
      await expect(page.getByText("9999-8888-7777")).toBeVisible();
    }
  });

  await test.step("maintenance sees rooms but no tenant names on the board", async () => {
    const fix = await signIn(browser, "fix");
    await fix.goto("/");
    expect(await fix.content()).not.toContain(RESIDENT.name);
    await fix.goto(roomPage);
    // On the room itself they see who lives there, but not the stay history or links to personal details
    await expect(fix.getByText(RESIDENT.name).first()).toBeVisible();
    await expect(fix.getByText("Everyone who has stayed here")).toHaveCount(0);
    await expect(fix.locator("a[href^='/occupants/']")).toHaveCount(0);
    expect(await fix.content()).not.toContain("9999-8888-7777");
  });

  await test.step("the tenant sees only their own room", async () => {
    const tenant = await signIn(browser, "tenant");
    await expect(tenant.getByLabel(`Room ${RESIDENT.room}`)).toBeVisible();
    const html = await tenant.content();
    expect(html).not.toContain("9999-8888-7777");
    expect(html).not.toContain("Juan Dela Cruz");
  });

  await test.step("a page someone can't use looks like it doesn't exist", async () => {
    const fix = await signIn(browser, "fix");
    const response = await fix.goto("/staff");
    expect(response?.status()).toBe(404);
    await expect(fix.getByText("Page not found")).toBeVisible();
    // The same screen as an address that really doesn't exist
    await fix.goto("/no-such-page");
    await expect(fix.getByText("Page not found")).toBeVisible();
  });
});

// Every link and button on every page a role can open must lead somewhere that role can open,
// so nobody is ever shown the way to a page they aren't allowed to use.
for (const role of Object.keys(ACCOUNTS) as Role[]) {
  test(`no links to hidden pages: ${role}`, async ({ browser }) => {
    const page = await signIn(browser, role);
    const pattern = (href: string) => href.split("?")[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id");
    const start = PAGES.filter(([, e]) => e[role] === "open").map(([p]) => p);
    const seen = new Map<string, string>(); // pattern -> an example href
    const queue = [...start];
    const visited = new Set<string>();
    while (queue.length) {
      const path = queue.shift()!;
      if (visited.has(pattern(path))) continue;
      visited.add(pattern(path));
      await page.goto(path);
      const hrefs = await page.locator("a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
      for (const href of hrefs) {
        const key = pattern(href);
        if (key.startsWith("/_next") || seen.has(key)) continue;
        seen.set(key, href);
        if (!key.endsWith("/template")) queue.push(href);
      }
    }
    for (const [key, href] of seen) {
      const response = await page.request.get(href, { maxRedirects: 0 });
      expect.soft(response.status(), `${role} sees a link to ${key} (${href})`).toBe(200);
    }
    expect(seen.size).toBeGreaterThan(3);
  });
}
