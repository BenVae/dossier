import "server-only";

import { jobSearchError } from "./errors";
import type { JobSource } from "./search";

// Requests to job sources (E14-1). Each source has a fixed host, so unlike
// fetching a posting (src/lib/posting-fetch.ts) there's no address to guard;
// requests are still limited in time and size.

export const REQUEST_TIMEOUT_MS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024;

type RequestOptions = { headers?: Record<string, string>; signal?: AbortSignal };

/** GETs JSON from a source, turning every failure into a JobSearchError. */
export async function requestJson(source: JobSource, url: URL, { headers = {}, signal }: RequestOptions = {}): Promise<unknown> {
  const text = await requestText(source, url, { headers: { accept: "application/json", ...headers }, signal });
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw jobSearchError("changed", source, { detail: `${url.pathname}: not JSON` });
  }
}

/** GETs a page from a source as text, turning every failure into a JobSearchError. */
export async function requestText(source: JobSource, url: URL, { headers = {}, signal }: RequestOptions = {}): Promise<string> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store",
    });
  } catch (error) {
    const reason = timeout.aborted ? "timed out" : ((error as { cause?: { code?: string } }).cause?.code ?? "request failed");
    throw jobSearchError("unavailable", source, { detail: `${url.pathname}: ${reason}` });
  }

  const detail = `${url.pathname}: HTTP ${response.status}`;
  if (response.status === 401 || response.status === 403) throw jobSearchError("key", source, { detail });
  // RapidAPI says how many of the plan's requests are left: some, and the 429 is its per-second limit.
  if (response.status === 429) {
    const left = response.headers.get("x-ratelimit-requests-remaining");
    throw jobSearchError(left !== null && left !== "0" ? "limited" : "quota", source, { detail });
  }
  if (!response.ok) throw jobSearchError(response.status >= 500 ? "unavailable" : "changed", source, { detail });

  let text: string | null;
  try {
    text = await readLimited(response, MAX_BYTES);
  } catch {
    throw jobSearchError("unavailable", source, { detail: `${url.pathname}: ${timeout.aborted ? "timed out" : "answer cut off"}` });
  }
  if (text === null) throw jobSearchError("changed", source, { detail: `${url.pathname}: answer over ${MAX_BYTES} bytes` });
  return text;
}

/** The body as text, or null when it's bigger than `limit` bytes. */
async function readLimited(response: Response, limit: number): Promise<string | null> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  // The RWTH portal's listings come in ISO-8859-1.
  return Buffer.concat(chunks).toString(/charset=["']?(iso-8859-1|latin1)\b/i.test(response.headers.get("content-type") ?? "") ? "latin1" : "utf8");
}
