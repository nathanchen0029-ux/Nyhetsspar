import type { Fetcher, FetchResponse } from "../../contracts/transient";

const USER_AGENT = "Nyhetsspar/1.0 (+public educational reader; one daily fetch)";

interface FetcherOptions {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  minimumOriginIntervalMs?: number;
  now?: () => number;
}

export function createHttpFetcher(options: FetcherOptions = {}): Fetcher {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const minimumOriginIntervalMs = options.minimumOriginIntervalMs ?? 1_000;
  const nextAllowedAt = new Map<string, number>();
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  return {
    async fetchText(url: string): Promise<FetchResponse> {
      let lastError: Error | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const origin = new URL(url).origin;
          const scheduledAt = Math.max(now(), nextAllowedAt.get(origin) ?? 0);
          const wait = scheduledAt - now();
          nextAllowedAt.set(origin, scheduledAt + minimumOriginIntervalMs);
          if (wait > 0) await sleep(wait);

          const response = await fetchImpl(url, {
            headers: {
              "user-agent": USER_AGENT,
              accept: "text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.1",
            },
            redirect: "follow",
            signal: AbortSignal.timeout(15_000),
          });
          const text = await response.text();
          if (response.status >= 500 || response.status === 429) {
            throw new Error(`transient-http-${response.status}`);
          }

          return { url: response.url || url, status: response.status, headers: response.headers, text };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt < 2) await sleep(2_000 * 4 ** attempt);
        }
      }
      throw lastError ?? new Error("fetch-failed");
    },
  };
}
