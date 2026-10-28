import "server-only";

import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import type { SettingsData } from "@/lib/settings";
import { appCommit, isCommit } from "@/lib/version";
import { UPDATES_REPOSITORY, type Release } from "@/lib/releases";

// The update check (E10-9, SET-12, PRD §11): "Check for updates" in
// Settings → About, and once on each day Dossier is used while "Check for
// updates daily" is on. All it sends is a request for the latest commit on the
// fork's main branch (releases.ts). The latest commit it has seen is kept in
// Settings, and the sidebar tells the user about it while it isn't the commit
// this install was built from (appCommit).

export type UpdateCheck =
  | { status: "latest"; version: string }
  | { status: "newer"; version: string; url: string }
  | { status: "unknown" }
  // This install doesn't know its own commit, so it can't tell.
  | { status: "untracked" };

/** 1.10.0 is newer than 1.9.2; anything after "-" (a pre-release) is ignored. */
export function isNewer(candidate: string, current: string): boolean {
  const parts = (version: string) => version.replace(/^v/i, "").split("-")[0].split(".").map((part) => Number(part) || 0);
  const [a, b] = [parts(candidate), parts(current)];
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

/**
 * What changed from one commit to the next, on GitHub. Kept with the latest
 * commit, it also says which build the check was made for.
 */
const changesPage = (from: string, to: string) => `https://github.com/${UPDATES_REPOSITORY}/compare/${from}...${to}`;

/**
 * Asks GitHub for the latest commit on main; null when it can't tell
 * (offline, slow, or an answer that isn't a commit).
 */
export async function latestCommit(fetchImpl: typeof fetch = fetch, base = env.DOSSIER_UPDATES_TEST_BASE_URL): Promise<string | null> {
  try {
    const response = await fetchImpl(`${base ?? "https://api.github.com"}/repos/${UPDATES_REPOSITORY}/commits/main`, {
      // Only the commit's SHA, not the commit.
      headers: { accept: "application/vnd.github.sha", "user-agent": "Dossier" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const commit = (await response.text()).trim();
    return isCommit(commit) ? commit : null;
  } catch {
    return null;
  }
}

/** What the latest commit means for this install. */
export function updateStatus(latest: string | null, current = appCommit): UpdateCheck {
  if (!current) return { status: "untracked" };
  if (!latest) return { status: "unknown" };
  return latest === current ? { status: "latest", version: current } : { status: "newer", version: latest, url: changesPage(current, latest) };
}

/** Asks for the latest commit and keeps it, so the sidebar can tell the user. An install that doesn't know its own commit asks nothing. */
export async function checkForUpdate(fetchImpl: typeof fetch = fetch, current = appCommit): Promise<UpdateCheck> {
  const latest = current ? await latestCommit(fetchImpl) : null;
  if (current && latest) await saveSettings({ latestVersion: latest, latestVersionUrl: changesPage(current, latest) });
  return updateStatus(latest, current);
}

/** The newer commit this install knows of, if any. Only a check made for this build counts: after an update, the next check tells. */
export function availableUpdate(
  settings: Pick<SettingsData, "latestVersion" | "latestVersionUrl">,
  current = appCommit,
): Release | null {
  const { latestVersion: version, latestVersionUrl: url } = settings;
  return current && version && version !== current && url === changesPage(current, version) ? { version, url } : null;
}

/** The commit the sidebar tells the user about: a newer one, unless "Not now" hid it (until main moves on again). */
export function updateNotice(
  settings: Pick<SettingsData, "latestVersion" | "latestVersionUrl" | "updateDismissed">,
  current = appCommit,
): Release | null {
  const update = availableUpdate(settings, current);
  return update && update.version !== settings.updateDismissed ? update : null;
}

/** Production servers check daily while the setting is on; development servers and tests never do. */
export function dailyCheckRuns(): boolean {
  return process.env.NODE_ENV === "production";
}

/** The calendar day in UTC: "2026-10-18". */
const utcDay = (date: Date) => date.toISOString().slice(0, 10);

const globalForCheck = globalThis as unknown as { updateCheckDay?: string };

type DailyOptions = { now?: Date; runs?: boolean; fetchImpl?: typeof fetch };

/**
 * Checks for an update unless it has already today. Past the first page load
 * of the day, it returns without touching the database. The day is saved
 * before asking, so a check that fails isn't tried again until the next day.
 */
export async function checkIfNewDay({ now = new Date(), runs = dailyCheckRuns(), fetchImpl = fetch }: DailyOptions = {}): Promise<
  "checked" | "skipped"
> {
  if (!runs) return "skipped";
  const day = utcDay(now);
  // Set before anything async, so pages loading together don't check twice.
  if (globalForCheck.updateCheckDay === day) return "skipped";
  globalForCheck.updateCheckDay = day;

  const settings = await loadSettings();
  if (!settings.updateCheck || settings.updateCheckDay === day) return "skipped";
  await saveSettings({ updateCheckDay: day });
  await checkForUpdate(fetchImpl);
  return "checked";
}

/** Run by the signed-in layout after each page load (see after()). Never throws. */
export async function checkForUpdatesDaily(): Promise<void> {
  await checkIfNewDay().catch((error: unknown) => logServerError("update check", error));
}
