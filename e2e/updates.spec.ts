import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { COMMIT, resetData, sql } from "./support";

// The update notice (E10-9): while a check has found a newer commit on the
// fork's main than the one this install was built from, the sidebar says so
// on every page until "Not now", which holds until main moves on again.
// Settings → About says so too.

const release = (version: string) => ({ version, url: `https://github.com/BenVae/dossier/compare/${COMMIT}...${version}` });
const NEWER = "b".repeat(40);
const NEWEST = "c".repeat(40);
const TITLE = "A newer version of Ben's Dossier is out";
const COMMAND = "irm https://raw.githubusercontent.com/BenVae/dossier/main/scripts/install-windows.ps1 | iex";

/** Stores a commit as the latest the update check found. */
async function found({ version, url }: { version: string; url: string }) {
  for (const [key, value] of [
    ["latestVersion", version],
    ["latestVersionUrl", url],
  ]) {
    await sql(
      `INSERT INTO "Setting" (key, value, "updatedAt") VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = $2, "updatedAt" = now()`,
      [key, value],
    );
  }
}

const expectAccessibleSidebar = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).include("aside").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id)).toEqual([]);
};

test.beforeAll(resetData);
// Other specs see no notice.
test.afterAll(() => sql(`DELETE FROM "Setting" WHERE key IN ('latestVersion', 'latestVersionUrl', 'updateDismissed')`));

test("says a newer version is out until Not now, and again when main moves on", async ({ page, context, baseURL }) => {
  await found(release(NEWER));
  await page.goto("/");
  const notice = page.getByRole("region", { name: TITLE });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("link", { name: /What's new/ })).toHaveAttribute("href", release(NEWER).url);
  await expect(notice.getByText(COMMAND)).toBeVisible();
  await expectAccessibleSidebar(page);

  await page.goto("/settings?section=about");
  await expect(page.getByText("A newer version of Ben's Dossier is available.")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Check for updates daily" })).toHaveAttribute("aria-checked", "true");

  await notice.getByRole("button", { name: "Not now" }).click();
  await expect(notice).toBeHidden();
  await expect(page.getByRole("button", { name: /^(Dark|Light) mode$/ })).toBeFocused();
  await page.goto("/applications");
  await expect(page.getByRole("region", { name: /is out$/ })).toBeHidden();

  await found(release(NEWEST));
  await page.goto("/");
  await expect(page.getByRole("region", { name: TITLE })).toBeVisible();

  // With the sidebar collapsed, it's an icon that opens the sidebar on the notice.
  await context.addCookies([{ name: "dossier_sidebar", value: "collapsed", url: baseURL! }]);
  await page.goto("/");
  await expect(page.getByRole("region", { name: /is out$/ })).toBeHidden();
  await expectAccessibleSidebar(page);
  await page.getByRole("button", { name: TITLE }).click();
  await expect(page.getByRole("region", { name: TITLE })).toBeVisible();
  await expect(page.getByRole("link", { name: /What's new/ })).toBeFocused();
});
