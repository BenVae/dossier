import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for JSearch on RapidAPI, with RapidAPI's limits switchable: a
// per-second limit and a monthly quota (both 429, told apart by
// x-ratelimit-requests-remaining as RapidAPI sends it), a provider that
// works on a few requests at a time, and answers whose body stops coming.

export type MockSettings = {
  latencyMs: number;
  /** Requests allowed in any second; more get a 429. */
  perSecond: number;
  /** Requests left this month; a 429 once there are none. */
  monthlyLeft: number;
  /** How many requests the provider works on at once; the rest wait. */
  concurrency: number;
  /** Sends the headers at once, then holds the body this long. */
  bodyDelayMs: number;
};

export async function startMockRapidApi(initial: Partial<MockSettings> = {}) {
  const settings: MockSettings = { latencyMs: 50, perSecond: Infinity, monthlyLeft: Infinity, concurrency: Infinity, bodyDelayMs: 0, ...initial };
  const stats = { requests: 0, rateLimited: 0, maxInFlight: 0 };
  const lastSecond: number[] = [];
  const waiting: (() => void)[] = [];
  let inFlight = 0;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://mock");
    stats.requests += 1;
    const now = Date.now();
    while (lastSecond.length && lastSecond[0] <= now - 1000) lastSecond.shift();
    const headers = { "content-type": "application/json", "x-ratelimit-requests-remaining": String(Number.isFinite(settings.monthlyLeft) ? settings.monthlyLeft : 9999) };
    if (settings.monthlyLeft <= 0 || lastSecond.length >= settings.perSecond) {
      if (settings.monthlyLeft > 0) stats.rateLimited += 1;
      return void response.writeHead(429, headers).end(JSON.stringify({ message: "Too many requests" }));
    }
    lastSecond.push(now);
    settings.monthlyLeft -= 1;

    if (inFlight >= settings.concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, settings.latencyMs));
    inFlight -= 1;
    waiting.shift()?.();
    if (response.destroyed) return;

    const title = (url.searchParams.get("query") ?? "").split(" in ")[0];
    const jobs = [1, 2, 3].map((i) => ({ job_id: `${title}-${i}`, job_title: `${title} ${i}`, employer_name: "Mock GmbH", job_description: `A ${title} role.` }));
    const body = JSON.stringify({ status: "OK", data: { jobs, cursor: `C-${title}` } });
    response.writeHead(200, headers);
    if (!settings.bodyDelayMs) return void response.end(body);
    response.write(body.slice(0, 10));
    setTimeout(() => response.destroyed || response.end(body.slice(10)), settings.bodyDelayMs);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/jsearch`,
    stats,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
