import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { daysBetween, formatDay, formatTime } from "@/lib/dates";
import { nextWithoutTitle } from "@/lib/job-search";
import { askSource } from "@/lib/job-search/find";
import {
  EMPTY_QUERY,
  foundPostingSchema,
  postingKey,
  searchQuerySchema,
  titleOutcomesSchema,
  type FoundPosting,
  type PastSearchDay,
  type SearchProblem,
  type SearchQuery,
  type ShownPosting,
  type StoredSearch,
  type TitleOutcome,
} from "@/lib/job-search/search";
import { postingStates } from "@/lib/postings";
import { prisma } from "@/lib/prisma";

// Searches kept with what they found (E14-10), until the user removes them,
// so going back to one costs no searches from the source's plan.

/** The postings column, read back; a posting that no longer fits the shape is left out. */
function postingsOf(value: Prisma.JsonValue): FoundPosting[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const posting = foundPostingSchema.safeParse(item);
    return posting.success ? [posting.data] : [];
  });
}

const queryOf = (value: Prisma.JsonValue): SearchQuery => searchQuerySchema.catch(EMPTY_QUERY).parse(value);

/** Postings with where each stands for the user now. */
async function withStates(postings: FoundPosting[]): Promise<ShownPosting[]> {
  const states = await postingStates(postings);
  return postings.map((posting) => ({ ...posting, state: states.get(postingKey(posting))! }));
}

/** "today at 14:32", "yesterday at 09:05" or "on Thu 1 Oct at 18:20". */
function ranAtLabel(date: Date, timeZone?: string, now = new Date()): string {
  const days = daysBetween(date, now, timeZone);
  const day = days === 0 ? "today" : days === 1 ? "yesterday" : `on ${formatDay(date, timeZone, now)}`;
  return `${day} at ${formatTime(date, timeZone)}`;
}

/** Runs a search on the chosen source and keeps it with its first page. */
export async function runSearch(query: SearchQuery): Promise<{ ok: true; id: string } | SearchProblem> {
  const answer = await askSource(query);
  if (!answer.ok) return answer;
  const search = await prisma.postingSearch.create({
    data: { source: answer.source, query, postings: answer.postings, found: answer.postings.length, next: answer.next, titles: answer.titles ?? [] },
    select: { id: true },
  });
  return { ok: true, id: search.id };
}

/** A kept search, the latest one without an id; null when there's none. */
export async function loadSearch(id?: string, { timeZone, now = new Date() }: { timeZone?: string; now?: Date } = {}): Promise<StoredSearch | null> {
  const search = id
    ? await prisma.postingSearch.findUnique({ where: { id } })
    : await prisma.postingSearch.findFirst({ orderBy: { createdAt: "desc" } });
  if (!search) return null;
  return {
    id: search.id,
    source: search.source,
    query: queryOf(search.query),
    ranAt: ranAtLabel(search.createdAt, timeZone, now),
    postings: await withStates(postingsOf(search.postings)),
    next: search.next,
    titles: titleOutcomesSchema.parse(search.titles),
  };
}

/** "Show more": the next page from the search's own source, added to the kept search, with how each title went. */
export async function showMoreFor(id: string): Promise<{ ok: true; postings: ShownPosting[]; next: string | null; titles: TitleOutcome[] } | SearchProblem> {
  const search = await prisma.postingSearch.findUnique({ where: { id } });
  if (!search) return { ok: false, problem: "changed", message: "That search is no longer kept. Search again." };
  const kept = titleOutcomesSchema.parse(search.titles);
  if (!search.next) return { ok: true, postings: [], next: null, titles: kept };
  const answer = await askSource(queryOf(search.query), { source: search.source, next: search.next });
  if (!answer.ok) return answer;
  const before = postingsOf(search.postings);
  const seen = new Set(before.map(postingKey));
  const added = answer.postings.filter((posting) => !seen.has(postingKey(posting)));
  const postings = [...before, ...added];
  const titles = kept.map((title) => {
    const page = answer.titles?.find((entry) => entry.title === title.title);
    if (!page || !title.more) return title;
    return { ...page, keys: [...new Set([...title.keys, ...page.keys])], total: page.total ?? title.total };
  });
  await prisma.postingSearch.update({ where: { id }, data: { postings, found: postings.length, next: answer.next, titles } });
  return { ok: true, postings: await withStates(added), next: answer.next, titles };
}

/**
 * Takes a title out of a kept search of several, with the postings only it
 * found, so Show more and the next search leave it out. Asks no source.
 */
export async function dropSearchTitle(id: string, title: string): Promise<void> {
  const search = await prisma.postingSearch.findUnique({ where: { id } });
  if (!search) return;
  const titles = titleOutcomesSchema.parse(search.titles);
  const index = titles.findIndex((entry) => entry.title === title);
  if (index < 0 || titles.length < 2) return;
  const left = titles.toSpliced(index, 1);
  const stillFound = new Set(left.flatMap((entry) => entry.keys));
  const dropped = new Set(titles[index].keys.filter((key) => !stillFound.has(key)));
  const postings = postingsOf(search.postings).filter((posting) => !dropped.has(postingKey(posting)));
  const query = { ...queryOf(search.query), keywords: left.map((entry) => entry.title).join(", ") };
  await prisma.postingSearch.update({
    where: { id },
    data: { query, postings, found: postings.length, next: nextWithoutTitle(search.next, index), titles: left.length > 1 ? left : [] },
  });
}

/** Every kept search, newest first, grouped by the day it ran in the user's time zone. */
export async function listSearches({ timeZone, now = new Date() }: { timeZone?: string; now?: Date } = {}): Promise<PastSearchDay[]> {
  const searches = await prisma.postingSearch.findMany({
    select: { id: true, source: true, query: true, found: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const days: PastSearchDay[] = [];
  for (const search of searches) {
    const ago = daysBetween(search.createdAt, now, timeZone);
    const day = ago === 0 ? "Today" : ago === 1 ? "Yesterday" : formatDay(search.createdAt, timeZone, now);
    if (days.at(-1)?.day !== day) days.push({ day, searches: [] });
    days.at(-1)!.searches.push({ id: search.id, source: search.source, query: queryOf(search.query), found: search.found, time: formatTime(search.createdAt, timeZone) });
  }
  return days;
}

export const countSearches = () => prisma.postingSearch.count();

export async function removeSearch(id: string): Promise<void> {
  await prisma.postingSearch.deleteMany({ where: { id } });
}
