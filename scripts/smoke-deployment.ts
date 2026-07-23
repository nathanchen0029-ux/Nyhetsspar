import { pathToFileURL } from "node:url";
import {
  DailyLessonSchema,
  LessonIndexSchema,
} from "../src/contracts/content";
import { reconcileLessonIndexEntry } from "../src/contracts/reconcile";

async function requireOk(
  url: URL,
  contentType: "html" | "javascript" | "css" | "json",
): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`smoke-http-${response.status}:${url}`);
  const actual = response.headers.get("content-type")?.toLowerCase() ?? "";
  const matches = {
    html: actual.includes("text/html"),
    javascript: actual.includes("javascript") || actual.includes("ecmascript"),
    css: actual.includes("text/css"),
    json: actual.includes("json"),
  }[contentType];
  if (!matches) throw new Error(`smoke-content-type:${contentType}`);
  return response;
}

function attributeValues(
  html: string,
  element: "script" | "link",
  attribute: "src" | "href",
): string[] {
  const expression = new RegExp(
    `<${element}\\b[^>]*\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`,
    "giu",
  );
  return [...html.matchAll(expression)].flatMap((match) =>
    match[2] === undefined ? [] : [match[2]],
  );
}

function buildAssetUrl(reference: string, base: URL): URL {
  let asset: URL;
  try {
    asset = new URL(reference, base);
  } catch {
    throw new Error("smoke-asset-url-invalid");
  }
  if (asset.origin !== base.origin) {
    throw new Error("smoke-asset-cross-origin");
  }
  const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  if (!asset.pathname.startsWith(`${basePath}assets/`)) {
    throw new Error("smoke-asset-outside-base");
  }
  return asset;
}

export async function smokeDeployment(rawBaseUrl: string): Promise<void> {
  const base = new URL(rawBaseUrl.endsWith("/") ? rawBaseUrl : `${rawBaseUrl}/`);
  base.search = "";
  base.hash = "";
  const homepage = await (await requireOk(base, "html")).text();
  const scripts = attributeValues(homepage, "script", "src");
  const stylesheets = attributeValues(homepage, "link", "href").filter(
    (reference) => reference.toLowerCase().includes(".css"),
  );
  if (scripts.length === 0 || stylesheets.length === 0) {
    throw new Error("smoke-missing-build-assets");
  }
  const scriptAssets = [...new Set(scripts)]
    .map((reference) => buildAssetUrl(reference, base));
  const stylesheetAssets = [...new Set(stylesheets)]
    .map((reference) => buildAssetUrl(reference, base));
  await Promise.all([
    ...scriptAssets.map((url) => requireOk(url, "javascript")),
    ...stylesheetAssets.map((url) => requireOk(url, "css")),
  ]);

  const index = LessonIndexSchema.parse(
    await (
      await requireOk(new URL("data/index.json", base), "json")
    ).json(),
  );
  const latest = index.dates[0];
  if (!latest) return;
  const lesson = DailyLessonSchema.parse(
    await (
      await requireOk(new URL(latest.lessonPath, base), "json")
    ).json(),
  );
  reconcileLessonIndexEntry(latest, lesson);
  for (const article of lesson.articles) {
    const source = new URL(article.sourceUrl);
    if (source.protocol !== "https:") {
      throw new Error("smoke-source-url-protocol");
    }
  }
}

const target = process.argv.slice(2).find((argument) => argument !== "--");
if (
  target &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await smokeDeployment(target);
  process.stdout.write("deployment-smoke:ok\n");
}
