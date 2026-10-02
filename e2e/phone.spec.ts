import { expect, test, type Browser } from "@playwright/test";
import { ADMIN, MAINTENANCE, RESIDENT } from "./accounts";

// The app is used mostly on phones: every page fits the screen width (no sideways
// scrolling), and the tab bar at the bottom reaches every page a role can open.

const PHONE = { viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true };

async function signIn(browser: Browser, account: { username: string; password: string }) {
  const page = await (await browser.newContext(PHONE)).newPage();
  await page.goto("/login");
  await page.getByLabel(/^Username/).fill(account.username);
  await page.getByLabel(/^Password/).fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return page;
}

const tabBar = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "Main" });

/** Every page linked from the tab bar and its More sheet, opened one by one. */
async function allNavPages(page: import("@playwright/test").Page) {
  const hrefs = await tabBar(page).locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  const more = tabBar(page).getByRole("button", { name: "More" });
  if (await more.count()) {
    await more.click();
    const sheet = page.getByRole("dialog", { name: "More pages" });
    hrefs.push(...(await sheet.locator("nav a").evaluateAll((as) => as.map((a) => a.getAttribute("href")!))));
    await sheet.getByRole("button", { name: "Close" }).click();
  }
  return hrefs;
}

async function expectFitsScreen(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect.soft(overflow, `${path} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
  await expect.soft(tabBar(page), `${path} shows the tab bar`).toBeVisible();
}

test("phone: staff pages fit the screen and the tab bar reaches them", async ({ browser }) => {
  const page = await signIn(browser, ADMIN);
  const pages = await allNavPages(page);
  expect(pages).toEqual(expect.arrayContaining(["/", "/requests", "/occupants", "/contracts", "/staff"]));
  for (const path of [...pages, "/account", "/occupants/new", "/contracts/new"]) await expectFitsScreen(page, path);

  // A detail page of each kind
  for (const [list, link] of [
    ["/rooms", "main a[href^='/rooms/']"],
    ["/occupants", "main table a[href^='/occupants/']"],
  ]) {
    await page.goto(list);
    await expectFitsScreen(page, (await page.locator(link).first().getAttribute("href"))!);
  }

  // The More sheet has the account and sign-out, and closes when a page is picked
  await tabBar(page).getByRole("button", { name: "More" }).click();
  const sheet = page.getByRole("dialog", { name: "More pages" });
  await expect(sheet.getByRole("link", { name: "My account" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Sign out" })).toBeVisible();
  await sheet.getByRole("link", { name: "Contracts" }).click();
  await page.waitForURL("**/contracts");
  await expect(sheet).toBeHidden();
});

test("phone: maintenance gets only its own pages", async ({ browser }) => {
  const page = await signIn(browser, MAINTENANCE);
  const pages = await allNavPages(page);
  expect(pages).not.toContain("/occupants");
  expect(pages).not.toContain("/contracts");
  expect(pages).toContain("/maintenance");
});

test("phone: tenant pages fit the screen", async ({ browser }) => {
  const page = await signIn(browser, RESIDENT);
  const pages = await allNavPages(page);
  expect(pages).toEqual(["/me", "/me/requests", "/me/rules", "/me/account"]);
  for (const path of pages) await expectFitsScreen(page, path);
});
