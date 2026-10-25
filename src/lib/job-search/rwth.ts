import "server-only";

import { parse } from "node-html-parser";

import { daysBetween } from "@/lib/dates";
import { fetchPosting } from "@/lib/posting-fetch";

import type { JobSourceAdapter, RequestContext } from "./adapter";
import { jobSearchError } from "./errors";
import { requestText } from "./http";
import { EMPTY_QUERY, POSTED_WITHIN, type FoundPosting, type SearchPage, type SearchQuery } from "./search";

// RWTH Aachen University's job portal: one employer, in Aachen, free and
// without a key. There's no API, so this reads the English listings page,
// 50 postings a page, newest first, and lets the portal's own search find
// the keywords. Its "RSS" Job Abo is a sign-up form behind a captcha, not a
// feed. Checked against the live site on 25 October 2026.

const BASE = "https://www.rwth-aachen.de";
const LISTINGS = "/cms/root/wir/Karriere/~buym/RWTH-Jobportal/lidx/1/";

/** The keywords as the portal reads them: Latin-1, every byte percent-encoded. */
const latin1 = (text: string) => Array.from(Buffer.from(text, "latin1"), (byte) => `%${byte.toString(16).padStart(2, "0")}`).join("");

async function searchPage(query: SearchQuery, next: string | null, context: RequestContext = {}): Promise<SearchPage> {
  const page = Number(next?.replace("page:", "")) || 1;
  const url = new URL(`${context.baseUrl ?? BASE}${LISTINGS}?search=${latin1(query.keywords)}&page=${page}`);
  const root = parse(await requestText("RWTH", url, { signal: context.signal }));
  if (!root.querySelector("#search-results")) throw jobSearchError("changed", "RWTH", { detail: `${url.pathname}: no results list` });

  const postings: FoundPosting[] = [];
  for (const link of root.querySelectorAll('table.results a[href^="/go/id/kbag/file/"]')) {
    // "Research Assistant (f/m/d) [V000011619]", then "[published 19/10/2026]" in the same cell.
    const [, title, reference] = /^(.*?)\s*\[([^\]]+)\]$/.exec(link.text.trim()) ?? [];
    if (!reference) continue;
    const [, day, month, year] = /published (\d{2})\/(\d{2})\/(\d{4})/.exec(link.parentNode!.text) ?? [];
    postings.push({
      source: "RWTH",
      externalId: reference,
      title,
      company: "RWTH Aachen University",
      place: "Aachen",
      remote: null,
      salary: "",
      postedAt: year ? `${year}-${month}-${day}T00:00:00.000Z` : null,
      url: `${BASE}${link.getAttribute("href")}`,
      via: "",
      description: "",
      complete: false,
    });
  }
  const days = POSTED_WITHIN.find((option) => option.value === query.postedWithin)?.days;
  const recent = days ? postings.filter((posting) => posting.postedAt && daysBetween(new Date(posting.postedAt), new Date(), "UTC") <= days) : postings;
  // Newest first: once one is too old, so are the pages after.
  return { postings: recent, next: root.querySelector("a.pager.next") && recent.length === postings.length ? `page:${page + 1}` : null };
}

export const rwth: JobSourceAdapter<"RWTH"> = {
  source: "RWTH",
  search: (query, _credentials, next, context) => searchPage(query, next, context),
  details: async (posting) => {
    const page = await fetchPosting(posting.url);
    return page.ok ? page.text : null;
  },
  test: async (_credentials, context) => {
    await searchPage(EMPTY_QUERY, null, context);
  },
};
