import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadSettings, saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import {
  availableUpdate,
  checkForUpdate,
  checkIfNewDay,
  dailyCheckRuns,
  isNewer,
  latestCommit,
  updateNotice,
  updateStatus,
} from "./update-check";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/env", () => ({ env: {} }));
// This install was built from commit aaa…, as the setup script's image records.
vi.mock("@/lib/version", async (original) => ({ ...(await original<typeof import("@/lib/version")>()), appCommit: "a".repeat(40) }));

const prisma = () => db.client!;
const built = "a".repeat(40);
const newer = "b".repeat(40);
const newest = "c".repeat(40);
const changes = (from: string, to: string) => `https://github.com/BenVae/dossier/compare/${from}...${to}`;
/** A fetch that answers like GitHub asked for a commit's SHA. */
const answer = (status: number, body: string) => vi.fn<typeof fetch>(async () => new Response(body, { status }));
const commitOf = (sha: string) => answer(200, sha);
const morning = new Date("2026-10-18T08:00:00Z");
const evening = new Date("2026-10-18T21:00:00Z");
const nextDay = new Date("2026-10-19T00:30:00Z");
/** A new server process: it no longer remembers the day in memory. */
const restart = () => delete (globalThis as { updateCheckDay?: string }).updateCheckDay;

beforeEach(async () => {
  restart();
  await resetDatabase(prisma());
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma().$disconnect());

describe("isNewer", () => {
  it("compares versions number by number", () => {
    expect(isNewer("1.10.0", "1.9.2")).toBe(true);
    expect(isNewer("v0.2.0", "0.1.0")).toBe(true);
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.1.0-beta", "0.1.0")).toBe(false);
    expect(isNewer("0.0.9", "0.1.0")).toBe(false);
  });
});

describe("latestCommit (E10-9)", () => {
  it("asks GitHub for the latest commit on the fork's main branch and nothing else", async () => {
    const fetch = commitOf(newer);
    expect(await latestCommit(fetch)).toBe(newer);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/BenVae/dossier/commits/main",
      expect.objectContaining({ cache: "no-store", headers: expect.objectContaining({ accept: "application/vnd.github.sha" }) }),
    );
    const [, init] = fetch.mock.calls[0];
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.body).toBeUndefined();
  });

  it("asks the fake for the end-to-end tests instead, when set", async () => {
    const fetch = commitOf(newer);
    await latestCommit(fetch, "http://localhost:3998/github");
    expect(fetch.mock.calls[0][0]).toBe("http://localhost:3998/github/repos/BenVae/dossier/commits/main");
  });

  it("can't tell offline, without the branch, or from an answer that isn't a commit", async () => {
    expect(await latestCommit(answer(404, '{"message":"Not Found"}'))).toBeNull();
    expect(await latestCommit(vi.fn(async () => Promise.reject(new TypeError("fetch failed"))))).toBeNull();
    expect(await latestCommit(answer(200, '{"sha":"' + newer + '"}'))).toBeNull();
    expect(await latestCommit(answer(200, "bbbbbbb"))).toBeNull();
  });
});

describe("updateStatus", () => {
  it("says whether main has moved on from the commit this install was built from", () => {
    expect(updateStatus(newer, built)).toEqual({ status: "newer", version: newer, url: changes(built, newer) });
    expect(updateStatus(built, built)).toEqual({ status: "latest", version: built });
    expect(updateStatus(null, built)).toEqual({ status: "unknown" });
  });

  it("can't tell without knowing this install's commit", () => {
    expect(updateStatus(newer, null)).toEqual({ status: "untracked" });
  });
});

describe("the sidebar's notice", () => {
  const seen = { latestVersion: newer, latestVersionUrl: changes(built, newer) };

  it("shows a newer commit than this install's", () => {
    expect(availableUpdate(seen, built)).toEqual({ version: newer, url: changes(built, newer) });
    expect(updateNotice({ ...seen, updateDismissed: null }, built)).toEqual({ version: newer, url: changes(built, newer) });
    expect(updateNotice({ ...seen, updateDismissed: null }, newer)).toBeNull();
    expect(updateNotice({ latestVersion: null, latestVersionUrl: null, updateDismissed: null }, built)).toBeNull();
  });

  it("waits for the next check after an update, and never shows without this install's commit", () => {
    expect(availableUpdate(seen, newest)).toBeNull();
    expect(availableUpdate(seen, null)).toBeNull();
  });

  it("stays hidden after Not now, until main moves on again", () => {
    expect(updateNotice({ ...seen, updateDismissed: newer }, built)).toBeNull();
    expect(updateNotice({ latestVersion: newest, latestVersionUrl: changes(built, newest), updateDismissed: newer }, built)).toEqual({
      version: newest,
      url: changes(built, newest),
    });
  });

  it("never links a page off GitHub, whatever is stored", () => {
    expect(availableUpdate({ latestVersion: newer, latestVersionUrl: "https://example.com/" }, built)).toBeNull();
  });
});

describe("checkForUpdate", () => {
  it("keeps the latest commit it finds, and what it had when it can't tell", async () => {
    expect(await checkForUpdate(commitOf(newer), built)).toEqual({ status: "newer", version: newer, url: changes(built, newer) });
    expect(await loadSettings()).toMatchObject({ latestVersion: newer, latestVersionUrl: changes(built, newer) });
    expect(await checkForUpdate(answer(503, ""), built)).toEqual({ status: "unknown" });
    expect(await loadSettings()).toMatchObject({ latestVersion: newer });
  });

  it("asks nothing when this install doesn't know its own commit", async () => {
    const fetch = commitOf(newer);
    expect(await checkForUpdate(fetch, null)).toEqual({ status: "untracked" });
    expect(fetch).not.toHaveBeenCalled();
    expect(await loadSettings()).toMatchObject({ latestVersion: null });
  });
});

describe("the daily check", () => {
  it("runs in production only", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(dailyCheckRuns()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(dailyCheckRuns()).toBe(false);
  });

  it("asks once a day, even across restarts", async () => {
    const fetch = commitOf(newer);
    expect(await checkIfNewDay({ now: morning, runs: true, fetchImpl: fetch })).toBe("checked");
    expect(await checkIfNewDay({ now: evening, runs: true, fetchImpl: fetch })).toBe("skipped");
    restart();
    expect(await checkIfNewDay({ now: evening, runs: true, fetchImpl: fetch })).toBe("skipped");
    expect(await checkIfNewDay({ now: nextDay, runs: true, fetchImpl: fetch })).toBe("checked");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await loadSettings()).toMatchObject({ updateCheckDay: "2026-10-19", latestVersion: newer });
  });

  it("doesn't ask while it's switched off, or outside production", async () => {
    const fetch = commitOf(newer);
    await saveSettings({ updateCheck: false });
    expect(await checkIfNewDay({ now: morning, runs: true, fetchImpl: fetch })).toBe("skipped");
    restart();
    await saveSettings({ updateCheck: true });
    expect(await checkIfNewDay({ now: morning, runs: false, fetchImpl: fetch })).toBe("skipped");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("doesn't try again the same day when GitHub doesn't answer", async () => {
    const offline = vi.fn<typeof fetch>(async () => Promise.reject(new TypeError("fetch failed")));
    expect(await checkIfNewDay({ now: morning, runs: true, fetchImpl: offline })).toBe("checked");
    restart();
    expect(await checkIfNewDay({ now: evening, runs: true, fetchImpl: offline })).toBe("skipped");
    expect(offline).toHaveBeenCalledTimes(1);
  });
});
