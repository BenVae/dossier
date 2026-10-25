import { afterEach, describe, expect, it, vi } from "vitest";

import { stubFetch } from "@/lib/ai/test-http";
import { rwthPage } from "@/test/job-search-fixtures";

import { rwth } from "./rwth";
import { EMPTY_QUERY } from "./search";

const query = { ...EMPTY_QUERY, keywords: "Engineer", country: "de" };
const latin1Page = (body: string) => new Response(Buffer.from(body, "latin1"), { headers: { "content-type": "text/html; Charset=iso-8859-1" } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("RWTH search", () => {
  it("asks the English listings with the keywords in Latin-1, as the portal reads them", async () => {
    const requests = stubFetch(() => latin1Page(rwthPage));
    await rwth.search({ ...query, keywords: "Prüfung" }, {}, "page:2");
    expect(requests[0].url.href).toBe("https://www.rwth-aachen.de/cms/root/wir/Karriere/~buym/RWTH-Jobportal/lidx/1/?search=%50%72%fc%66%75%6e%67&page=2");
  });

  it("maps the listings to the shared shape, with the Kennziffer as the id", async () => {
    stubFetch(() => latin1Page(rwthPage));
    const page = await rwth.search(query, {}, null);
    expect(page.next).toBe("page:2");
    const shared = { source: "RWTH", company: "RWTH Aachen University", place: "Aachen", remote: null, salary: "", via: "", description: "", complete: false };
    expect(page.postings).toEqual([
      {
        ...shared,
        externalId: "V000011619",
        title: "Research Assistant (f/m/d) - Experimental Hybrid Additive Manufacturing and Microstructure Characterization",
        postedAt: "2026-10-19T00:00:00.000Z",
        url: "https://www.rwth-aachen.de/go/id/kbag/file/V000011619/lidx/1/",
      },
      {
        ...shared,
        externalId: "V000011488",
        title: "Sachgebietsleiter*in für das Sachgebiet 10.34 Abwasser-, Wasser- und Gasanlagen (w/m/d) (in German only)",
        postedAt: "2026-10-19T00:00:00.000Z",
        url: "https://www.rwth-aachen.de/go/id/kbag/file/V000011488/",
      },
      {
        ...shared,
        externalId: "V000011524",
        title: "Softwareentwickler*in (w/m/d) für die landesweite KI-Plattform der NRW-Hochschulen – Projekt KI:Expertisezentrum.nrw (in German only)",
        postedAt: "2026-10-05T00:00:00.000Z",
        url: "https://www.rwth-aachen.de/go/id/kbag/file/V000011524/",
      },
    ]);
  });

  it("keeps to the days asked for, and stops paging at the first older posting", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-25T12:00:00Z"), toFake: ["Date"] });
    stubFetch(() => latin1Page(rwthPage));
    const page = await rwth.search({ ...query, postedWithin: "week" }, {}, null);
    expect(page.postings.map((posting) => posting.externalId)).toEqual(["V000011619", "V000011488"]);
    expect(page.next).toBeNull();
  });

  it("reads No Results as none, and a page without a results list as changed", async () => {
    stubFetch(() => latin1Page('<h2 class="h3 result-count skip-to-module" id="search-results">No Results</h2>'));
    expect(await rwth.search(query, {}, null)).toEqual({ postings: [], next: null });
    stubFetch(() => latin1Page("<html><body>Wartungsarbeiten</body></html>"));
    await expect(rwth.search(query, {}, null)).rejects.toMatchObject({
      problem: "changed",
      message: "The RWTH job portal has changed or isn't answering. Try another source in Settings → Job search.",
    });
  });
});
