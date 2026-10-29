import "server-only";

import { logServerError } from "@/lib/log";

import type { JobSourceAdapter, RequestContext, SourceCredentials } from "./adapter";
import { cached, remember } from "./cache";
import { JobSearchError, jobSearchError } from "./errors";
import { adzuna } from "./adzuna";
import { arbeitsagentur } from "./arbeitsagentur";
import { jsearch } from "./jsearch";
import { rwth } from "./rwth";
import { postingKey, splitTitles, type FoundPosting, type JobSource, type SearchPage, type SearchQuery } from "./search";
import { SOURCE_INFO, sourceCovers } from "./sources";

// Searching the chosen job source from the server (E14-1). Results are
// cached for half an hour; failures come back as JobSearchError with a
// message for the screen, and the ones that point at a problem with the
// source are logged, without the search.

export type { JSearchHost, RequestContext, SourceCredentials } from "./adapter";
export { JobSearchError } from "./errors";

const ADAPTERS: { [S in JobSource]: JobSourceAdapter<S> } = {
  JSEARCH: jsearch,
  ADZUNA: adzuna,
  ARBEITSAGENTUR: arbeitsagentur,
  RWTH: rwth,
};

const adapterFor = <S extends JobSource>(source: S) => ADAPTERS[source] as JobSourceAdapter<S>;

/** Logs failures that say something about the source; a wrong key or a used-up quota is the user's to fix. */
async function logged<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof JobSearchError && (error.problem === "changed" || error.problem === "unavailable")) {
      logServerError("job search", new Error(error.detail ?? error.message));
    }
    throw error;
  }
}

// Several titles separated by commas are each searched, and their pages go
// on together: `next` then holds every title's own, null once it's done.
const EACH = "each:";
// A few titles at a time, each worker waiting a second after an answer
// before its next request, so no more than AT_ONCE arrive in any second:
// RapidAPI refuses requests over a plan's per-second limit (3 to 5 on the
// small plans) rather than queueing them.
const AT_ONCE = 3;
const SPACING_MS = 1000;
/** How long a search of several titles may take; titles still waiting then count as not answering. */
export const SEARCH_DEADLINE_MS = 20_000;

const cacheKey = (source: JobSource, query: SearchQuery, next: string | null) => `search:${source}:${JSON.stringify(query)}:${next ?? ""}`;

async function ask<S extends JobSource>(source: S, credentials: SourceCredentials[S], query: SearchQuery, next: string | null, context: RequestContext) {
  const page = await logged(() => adapterFor(source).search(query, credentials, next, context));
  remember(cacheKey(source, query, next), page);
  return page;
}

/**
 * One page of postings for `query` from `source`, from the cache when it was
 * asked for in the last half hour. Of several titles, the ones that answered
 * are kept when others fail; it fails only when every title asked did.
 */
export async function searchPostings<S extends JobSource>(
  source: S,
  credentials: SourceCredentials[S],
  query: SearchQuery,
  next: string | null = null,
  context: RequestContext = {},
): Promise<SearchPage> {
  if (!sourceCovers(source, query.country)) throw jobSearchError("country", source, { country: query.country });
  const titles = splitTitles(query.keywords);
  // A search kept from before titles were split goes on as it began.
  if (titles.length > 1 && (next === null || next.startsWith(EACH))) {
    const cursors: (string | null)[] | null = next ? JSON.parse(next.slice(EACH.length)) : null;
    const deadline = AbortSignal.timeout(SEARCH_DEADLINE_MS);
    const signal = context.signal ? AbortSignal.any([context.signal, deadline]) : deadline;
    // A title that fails keeps the cursor it was asked with, so Show more asks it again; one
    // that fails on the first page has none, and is asked again by searching again.
    const pages: SearchPage[] = titles.map((_, index) => ({ postings: [], next: cursors?.[index] ?? null }));
    const errors: (JobSearchError | null)[] = titles.map(() => null);
    let waiting = 0;
    let stopped: JobSearchError | null = null;
    const work = async () => {
      let answered = false;
      while (waiting < titles.length) {
        const index = waiting++;
        const cursor = cursors?.[index] ?? null;
        if (cursors && !cursor) continue;
        const asked = { ...query, keywords: titles[index] };
        const hit = cached<SearchPage>(cacheKey(source, asked, cursor));
        if (hit) {
          pages[index] = hit;
          continue;
        }
        if (answered && !stopped && !signal.aborted) await new Promise((resolve) => setTimeout(resolve, SPACING_MS));
        if (stopped || signal.aborted) {
          errors[index] = stopped ?? jobSearchError("unavailable", source);
          continue;
        }
        answered = true;
        try {
          pages[index] = await ask(source, credentials, asked, cursor, { ...context, signal });
        } catch (error) {
          if (!(error instanceof JobSearchError)) throw error;
          errors[index] = error;
          if (error.problem === "key" || (error.problem === "quota" && SOURCE_INFO[source].quotaPeriod)) stopped = error;
        }
      }
    };
    await Promise.all(Array.from({ length: AT_ONCE }, work));
    const failed = errors.filter((error) => error !== null);
    if (failed.length > 0 && failed.length === titles.filter((_, index) => !cursors || cursors[index]).length) throw failed[0];

    // Taking turns, so the first title doesn't fill the page; a posting two titles found is shown once.
    const seen = new Set<string>();
    const postings: FoundPosting[] = [];
    for (let rank = 0; rank < Math.max(...pages.map((page) => page.postings.length)); rank++) {
      for (const page of pages) {
        const posting = page.postings[rank];
        if (posting && !seen.has(postingKey(posting))) {
          seen.add(postingKey(posting));
          postings.push(posting);
        }
      }
    }
    const nexts = pages.map((page) => page.next);
    return {
      postings,
      next: nexts.some(Boolean) ? EACH + JSON.stringify(nexts) : null,
      titles: titles.map((title, index) => ({
        title,
        keys: pages[index].postings.map(postingKey),
        total: pages[index].total ?? null,
        more: pages[index].next !== null,
        problem: errors[index]?.problem ?? null,
      })),
    };
  }
  return cached<SearchPage>(cacheKey(source, query, next)) ?? (await ask(source, credentials, query, next, context));
}

/** A search of several titles' `next` without the title at `index`; the one title left goes on with its own. */
export function nextWithoutTitle(next: string | null, index: number): string | null {
  if (!next?.startsWith(EACH)) return next;
  const cursors: (string | null)[] = JSON.parse(next.slice(EACH.length));
  cursors.splice(index, 1);
  if (cursors.length === 1) return cursors[0];
  return cursors.some(Boolean) ? EACH + JSON.stringify(cursors) : null;
}

/** The whole text of a posting: its own description when that's complete, else fetched; null when it can't be had. */
export async function postingDetails<S extends JobSource>(
  source: S,
  credentials: SourceCredentials[S],
  posting: FoundPosting,
  context: RequestContext = {},
): Promise<string | null> {
  if (posting.complete) return posting.description;
  const key = `details:${postingKey(posting)}`;
  const hit = cached<string>(key);
  if (hit) return hit;
  const text = await logged(() => adapterFor(source).details(posting, credentials, context));
  if (text) remember(key, text);
  return text;
}

/** "Test connection" in Settings → Job search: throws a JobSearchError when the source or the key doesn't work. */
export async function testSource<S extends JobSource>(source: S, credentials: SourceCredentials[S], context: RequestContext = {}): Promise<void> {
  await logged(() => adapterFor(source).test(credentials, context));
}
