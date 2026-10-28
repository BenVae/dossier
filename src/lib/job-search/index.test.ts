import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";
import { jsearchV2LastPage, jsearchV2Page } from "@/test/job-search-fixtures";

import { clearJobSearchCache } from "./cache";
import { nextWithoutTitle, postingDetails, searchPostings, testSource } from "./index";
import { EMPTY_QUERY } from "./search";
import { sourceCovers } from "./sources";

const query = { ...EMPTY_QUERY, keywords: "designer", country: "de" };
const ninja = { key: "ak_test", host: "openwebninja" as const };

beforeEach(() => {
  clearJobSearchCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("searchPostings", () => {
  it("asks the source once per half hour for the same search and page", async () => {
    const requests = stubFetch(() => json(jsearchV2Page));
    const first = await searchPostings("JSEARCH", ninja, query);
    const again = await searchPostings("JSEARCH", ninja, query);
    expect(again).toEqual(first);
    expect(requests).toHaveLength(1);

    await searchPostings("JSEARCH", ninja, query, first.next);
    await searchPostings("JSEARCH", ninja, { ...query, remoteOnly: true });
    expect(requests).toHaveLength(3);
  });

  it("searches titles separated by commas one by one, takes turns between them, and pages each on its own", async () => {
    const offer = (ref: string) => ({ stellenangebotsTitel: ref, referenznummer: ref, firma: "Acme", stellenlokationen: [] });
    const answers: Record<string, unknown> = {
      "designer 1": { ergebnisliste: [offer("A"), offer("B")], maxErgebnisse: 60 },
      "developer 1": { ergebnisliste: [offer("C"), offer("B")], maxErgebnisse: 2 },
      "designer 2": { ergebnisliste: [offer("D")], maxErgebnisse: 60 },
      "designer, developer 2": { ergebnisliste: [offer("E")], maxErgebnisse: 60 },
    };
    const requests = stubFetch(({ url }) => json(answers[`${url.searchParams.get("was")} ${url.searchParams.get("page")}`]));
    const both = { ...query, keywords: " designer, developer ," };

    const first = await searchPostings("ARBEITSAGENTUR", {}, both);
    expect(first.postings.map((posting) => posting.title)).toEqual(["A", "C", "B"]);
    const second = await searchPostings("ARBEITSAGENTUR", {}, both, first.next);
    expect(second).toMatchObject({ postings: [{ title: "D" }], next: expect.stringMatching(/^each:/) });
    expect(requests).toHaveLength(3);

    // A search kept from before titles were split goes on as it began.
    expect((await searchPostings("ARBEITSAGENTUR", {}, { ...query, keywords: "designer, developer" }, "page:2")).postings).toMatchObject([{ title: "E" }]);
  });

  it("takes a title's place out of the next pages; the one title left goes on with its own", () => {
    expect(nextWithoutTitle('each:["page:2",null,"page:3"]', 1)).toBe('each:["page:2","page:3"]');
    expect(nextWithoutTitle('each:["page:2","page:3"]', 0)).toBe("page:3");
    expect(nextWithoutTitle('each:["page:2",null,null]', 0)).toBeNull();
    expect(nextWithoutTitle("page:2", 0)).toBe("page:2");
  });

  it("doesn't keep failures", async () => {
    let status = 503;
    const requests = stubFetch(() => json(jsearchV2LastPage, { status }));
    await expect(searchPostings("JSEARCH", ninja, query)).rejects.toMatchObject({ problem: "unavailable" });
    status = 200;
    await expect(searchPostings("JSEARCH", ninja, query)).resolves.toMatchObject({ next: null });
    expect(requests).toHaveLength(2);
  });

  it("logs problems with the source without the search, but not a wrong key", async () => {
    const log = vi.mocked(console.error);
    stubFetch(() => json({}, { status: 404 }));
    await expect(searchPostings("JSEARCH", ninja, query)).rejects.toMatchObject({ problem: "changed" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("[job search] Error: JSEARCH: /jsearch/search-v2: HTTP 404");
    expect(String(log.mock.calls[0][0])).not.toContain("designer");

    stubFetch(() => json({}, { status: 401 }));
    await expect(searchPostings("JSEARCH", ninja, { ...query, keywords: "other" })).rejects.toMatchObject({ problem: "key" });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("stops asking the other titles once the source refuses the key", async () => {
    const requests = stubFetch(() => json({}, { status: 401 }));
    await expect(searchPostings("JSEARCH", ninja, { ...query, keywords: "a, b, c, d, e" })).rejects.toMatchObject({ problem: "key" });
    expect(requests).toHaveLength(3);
  });

  it("waits between requests only, not before titles it doesn't ask", async () => {
    const requests = stubFetch(() => json(jsearchV2LastPage));
    const started = Date.now();
    await searchPostings("JSEARCH", ninja, { ...query, keywords: "a, b, c, d, e" }, 'each:["cursor:A","cursor:B","cursor:C",null,null]');
    expect(requests).toHaveLength(3);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("goes on asking the other titles when a source without a plan limits one", async () => {
    const requests = stubFetch(({ url }) => {
      const was = url.searchParams.get("was")!;
      return was === "a" ? json({}, { status: 429 }) : json({ ergebnisliste: [{ stellenangebotsTitel: was, referenznummer: was, firma: "Acme", stellenlokationen: [] }], maxErgebnisse: 1 });
    });
    const page = await searchPostings("ARBEITSAGENTUR", {}, { ...query, keywords: "a, b, c, d" });
    expect(requests).toHaveLength(4);
    expect(page.titles?.map((title) => title.problem)).toEqual(["quota", null, null, null]);
  });

  it("says when a source doesn't cover the country, before asking it", async () => {
    const requests = stubFetch(() => json(jsearchV2Page));
    await expect(searchPostings("ARBEITSAGENTUR", {}, { ...query, country: "fr" })).rejects.toMatchObject({
      problem: "country",
      message: "Bundesagentur für Arbeit doesn't list jobs in France. Choose another country, or another source in Settings → Job search.",
    });
    expect(requests).toHaveLength(0);
    expect(sourceCovers("ADZUNA", "de")).toBe(true);
    expect(sourceCovers("ADZUNA", "jp")).toBe(false);
    expect(sourceCovers("JSEARCH", "jp")).toBe(true);
  });
});

describe("postingDetails", () => {
  it("returns a complete description as it is", async () => {
    const requests = stubFetch(() => json(jsearchV2Page));
    const [posting] = (await searchPostings("JSEARCH", ninja, query)).postings;
    expect(await postingDetails("JSEARCH", ninja, posting)).toBe(posting.description);
    expect(requests).toHaveLength(1);
  });

  it("asks the source for the rest of an incomplete one, and keeps it", async () => {
    stubFetch(() => json(jsearchV2Page));
    const [posting] = (await searchPostings("JSEARCH", ninja, query)).postings;
    const partial = { ...posting, complete: false };
    expect(await postingDetails("JSEARCH", ninja, partial)).toBe(posting.description);
    expect(await postingDetails("JSEARCH", ninja, { ...partial, description: "" })).toBe(posting.description);
    expect(await postingDetails("JSEARCH", ninja, { ...partial, externalId: "other", description: "" })).toBeNull();
  });
});

describe("testSource", () => {
  it("passes when the source answers", async () => {
    stubFetch(() => json(jsearchV2LastPage));
    await expect(testSource("JSEARCH", ninja)).resolves.toBeUndefined();
  });

  it("throws the problem when it doesn't", async () => {
    stubFetch(() => json({}, { status: 401 }));
    await expect(testSource("JSEARCH", ninja)).rejects.toMatchObject({ problem: "key" });
  });
});
