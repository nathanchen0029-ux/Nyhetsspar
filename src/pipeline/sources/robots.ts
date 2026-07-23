import robotsParser from "robots-parser";
import type { Fetcher, UrlAccessGuard } from "../../contracts/transient";

const USER_AGENT = "Nyhetsspar";

export interface RobotsGuard extends UrlAccessGuard {}

export function createRobotsGuard(fetcher: Fetcher): RobotsGuard {
  const cache = new Map<string, ReturnType<typeof robotsParser>>();

  return {
    async isAllowed(url: string): Promise<boolean> {
      const parsed = new URL(url);
      const origin = parsed.origin;
      let rules = cache.get(origin);
      if (!rules) {
        const robotsUrl = new URL("/robots.txt", origin).toString();
        const response = await fetcher.fetchText(robotsUrl);
        rules = robotsParser(robotsUrl, response.status === 200 ? response.text : "");
        cache.set(origin, rules);
      }
      return rules.isAllowed(url, USER_AGENT) !== false;
    },
  };
}
