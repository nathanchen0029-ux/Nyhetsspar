import { resolve } from "node:path";
import { createOpenAiGateway } from "../src/pipeline/ai/openai-gateway";
import { runDailyPipeline } from "../src/pipeline/run";

const args = new Map(process.argv.slice(2).map((item) => item.split("=", 2)).map(([key, value]) => [key, value ?? "true"]));
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is required");

const dateOverride = args.get("--date");
const result = await runDailyPipeline({
  root: resolve("."),
  now: new Date(),
  gateway: createOpenAiGateway({ apiKey, model: process.env.OPENAI_MODEL ?? "gpt-5.4-mini" }),
  force: args.get("--force") === "true",
  ...(dateOverride === undefined ? {} : { dateOverride }),
});
process.stdout.write(result ? `lesson:${result.date}:${result.status}:${result.articles.length}\n` : "lesson:skipped\n");
