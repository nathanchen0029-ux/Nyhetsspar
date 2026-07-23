import type { Source } from "../../contracts/content";
import type { Fetcher, FetchResponse, FetchTextOptions } from "../../contracts/transient";
import type { RobotsGuard } from "./robots";
import { sourceDomainMatches } from "./source-url";

const USER_AGENT = "Nyhetsspar/1.0 (+public educational reader; one daily fetch)";
const MAX_REDIRECTS = 5;

interface FetcherOptions {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  minimumOriginIntervalMs?: number;
  now?: () => number;
}

class RedirectRejectedError extends Error {}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

export function createHttpFetcher(options: FetcherOptions = {}): Fetcher {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const minimumOriginIntervalMs = options.minimumOriginIntervalMs ?? 1_000;
  const nextAllowedAt = new Map<string, number>();
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  async function schedule(url: string): Promise<void> {
    const origin = new URL(url).origin;
    const scheduledAt = Math.max(now(), nextAllowedAt.get(origin) ?? 0);
    const wait = scheduledAt - now();
    nextAllowedAt.set(origin, scheduledAt + minimumOriginIntervalMs);
    if (wait > 0) await sleep(wait);
  }

  async function fetchAttempt(url: string, options: FetchTextOptions): Promise<FetchResponse> {
    let currentUrl = url;
    for (let redirects = 0; ; redirects += 1) {
      await schedule(currentUrl);
      const response = await fetchImpl(currentUrl, {
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.1",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      const text = await response.text();
      if (response.status >= 500 || response.status === 429) {
        throw new Error("transient-http-" + response.status);
      }
      if (!isRedirect(response.status)) {
        return { url: response.url || currentUrl, status: response.status, headers: response.headers, text };
      }
      if (redirects >= MAX_REDIRECTS) throw new RedirectRejectedError("redirect-limit-exceeded");
      const location = response.headers.get("location");
      if (!location) throw new RedirectRejectedError("redirect-location-invalid");
      let nextUrl: string;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        throw new RedirectRejectedError("redirect-location-invalid");
      }
      if (!options.redirectGuard) throw new RedirectRejectedError("redirect-not-allowed");
      try {
        if (!(await options.redirectGuard(nextUrl))) {
          throw new RedirectRejectedError("redirect-guard-rejected");
        }
      } catch (error) {
        if (error instanceof RedirectRejectedError) throw error;
        throw new RedirectRejectedError(error instanceof Error ? error.message : String(error));
      }
      currentUrl = nextUrl;
    }
  }

  return {
    async fetchText(url: string, fetchOptions: FetchTextOptions = {}): Promise<FetchResponse> {
      let lastError: Error | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await fetchAttempt(url, fetchOptions);
        } catch (error) {
          if (error instanceof RedirectRejectedError) throw error;
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt < 2) await sleep(2_000 * 4 ** attempt);
        }
      }
      throw lastError ?? new Error("fetch-failed");
    },
  };
}

export async function fetchPublicSourceText(
  source: Source,
  url: string,
  fetcher: Fetcher,
  robots: RobotsGuard,
): Promise<FetchResponse> {
  if (!sourceDomainMatches(url, source)) {
    throw new Error("initial-source-domain-mismatch:" + source + ":" + url);
  }
  if (!(await robots.isAllowed(url))) throw new Error("initial-robots-disallowed:" + url);

  return fetcher.fetchText(url, {
    redirectGuard: async (nextUrl) => {
      if (!sourceDomainMatches(nextUrl, source)) {
        throw new Error("redirect-source-domain-mismatch:" + source + ":" + nextUrl);
      }
      if (!(await robots.isAllowed(nextUrl))) {
        throw new Error("redirect-robots-disallowed:" + nextUrl);
      }
      return true;
    },
  });
}
