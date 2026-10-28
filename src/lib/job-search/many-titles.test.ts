import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startMockRapidApi, type MockSettings } from "@/test/mock-rapidapi";

import { clearJobSearchCache } from "./cache";
import { searchPostings } from "./index";
import { EMPTY_QUERY, MAX_KEYWORDS, searchQuerySchema, type SearchPage } from "./search";

// Several titles on JSearch through RapidAPI, against a stand-in with its
// limits (src/test/mock-rapidapi.ts).

const TITLES = ["frontend developer", "react developer", "web developer", "software engineer", "fullstack developer", "javascript developer", "typescript developer", "ui developer", "node developer", "backend developer"];
const rapid = { key: "mock-key", host: "rapidapi" as const };
let mock: Awaited<ReturnType<typeof startMockRapidApi>>;

async function search(count: number, settings: Partial<MockSettings>, signal?: AbortSignal) {
  mock = await startMockRapidApi(settings);
  return searchPostings("JSEARCH", rapid, { ...EMPTY_QUERY, keywords: TITLES.slice(0, count).join(", "), country: "de" }, null, { baseUrl: mock.baseUrl, signal });
}

const problems = (page: SearchPage) => page.titles?.map((title) => title.problem);

beforeEach(() => {
  clearJobSearchCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await mock?.close();
});

describe("several titles on JSearch", { timeout: 30_000 }, () => {
  it("asks a few titles at a time, under a plan's requests a second", async () => {
    const page = await search(10, { latencyMs: 200, perSecond: 3 });
    expect(mock.stats).toMatchObject({ requests: 10, rateLimited: 0 });
    expect(mock.stats.maxInFlight).toBeLessThanOrEqual(3);
    expect(page.postings).toHaveLength(30);
    expect(page.titles?.map((title) => title.keys.length)).toEqual(Array(10).fill(3));
  });

  it("keeps what the titles found when others are refused, and says per title what happened", async () => {
    const page = await search(10, { monthlyLeft: 6 });
    expect(mock.stats.requests).toBeLessThan(10);
    expect(page.postings).toHaveLength(18);
    expect(problems(page)).toEqual([null, null, null, null, null, null, "quota", "quota", "quota", "quota"]);
    expect(page.titles?.[6]).toMatchObject({ title: "typescript developer", keys: [], more: false });
  });

  it("tells a per-second 429 from a spent month by RapidAPI's remaining-requests header", async () => {
    await expect(search(1, { perSecond: 0 })).rejects.toMatchObject({ problem: "limited", message: "JSearch is limiting searches right now. Wait a minute and try again." });
    await mock.close();
    clearJobSearchCache();
    await expect(search(1, { monthlyLeft: 0 })).rejects.toMatchObject({ problem: "quota", message: expect.stringContaining("this month") });
  });

  it("fails the search only when every title failed, and stops asking once the plan is used up", async () => {
    await expect(search(5, { monthlyLeft: 0 })).rejects.toMatchObject({ problem: "quota" });
    expect(mock.stats.requests).toBe(3);
  });

  it("stops at the search's deadline, keeping the titles that answered", async () => {
    const started = Date.now();
    const page = await search(10, { latencyMs: 1000, concurrency: 1 }, AbortSignal.timeout(2500));
    expect(Date.now() - started).toBeLessThan(4000);
    expect(problems(page)?.slice(0, 2)).toEqual([null, null]);
    expect(problems(page)?.slice(2)).toEqual(Array(8).fill("unavailable"));
    expect(page.postings).toHaveLength(6);
  });

  it("turns an answer whose body stops coming into 'isn't answering', not a server error", async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(300));
    await expect(search(1, { latencyMs: 0, bodyDelayMs: 2000 })).rejects.toMatchObject({ name: "JobSearchError", problem: "unavailable" });
  });
});

describe("how many titles a search takes", () => {
  it("takes a long list of titles; only a guard far above use refuses", () => {
    const hundred = Array.from({ length: 100 }, (_, i) => `senior frontend engineer ${i}`).join(", ");
    expect(searchQuerySchema.safeParse({ ...EMPTY_QUERY, keywords: hundred }).success).toBe(true);
    expect(searchQuerySchema.safeParse({ ...EMPTY_QUERY, keywords: "a".repeat(MAX_KEYWORDS + 1) }).success).toBe(false);
  });
});
