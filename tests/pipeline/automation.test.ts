import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { resolvePagesBase } from "../../vite.config";

type Workflow = {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  concurrency?: { "cancel-in-progress"?: boolean };
  jobs: Record<string, {
    if?: string;
    needs?: string[];
    permissions?: Record<string, string>;
    environment?: { name?: string };
    steps: Array<{
      name?: string;
      uses?: string;
      run?: string;
      env?: Record<string, string>;
      with?: Record<string, unknown>;
    }>;
  }>;
};

async function workflow(name: string): Promise<Workflow> {
  const raw = await readFile(resolve(`.github/workflows/${name}.yml`), "utf8");
  return parse(raw) as Workflow;
}

function actionVersions(value: Workflow): string[] {
  return Object.values(value.jobs).flatMap((job) =>
    job.steps.flatMap((step) => step.uses === undefined ? [] : [step.uses]),
  );
}

describe("GitHub automation", () => {
  it("uses the pinned July 2026 action majors in pull-request CI", async () => {
    const ci = await workflow("ci");

    expect(ci.on).toHaveProperty("pull_request");
    expect(ci.on).toHaveProperty("push");
    expect(ci.permissions).toEqual({ contents: "read" });
    expect(actionVersions(ci)).toEqual(expect.arrayContaining([
      "actions/checkout@v6",
      "pnpm/action-setup@v6",
      "actions/setup-node@v6",
    ]));
    expect(JSON.stringify(ci)).not.toMatch(/@(v4|v5)"/u);
  });

  it("has one Stockholm-aware non-top-of-hour schedule and optional manual date", async () => {
    const pages = await workflow("pages");

    expect(pages.on.schedule).toEqual([{
      cron: "7 7 * * *",
      timezone: "Europe/Stockholm",
    }]);
    expect(pages.on.workflow_dispatch).toMatchObject({
      inputs: {
        lesson_date: {
          required: false,
          type: "string",
        },
      },
    });
    expect(pages.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  it("uses least privilege per job and current Pages actions", async () => {
    const pages = await workflow("pages");
    const generation = pages.jobs.generate;
    const build = pages.jobs.build;
    const deploy = pages.jobs.deploy;

    expect(pages.permissions).toEqual({ contents: "read" });
    expect(generation?.permissions).toEqual({ contents: "write" });
    expect(build?.permissions).toEqual({ contents: "read" });
    expect(deploy?.permissions).toEqual({
      contents: "read",
      pages: "write",
      "id-token": "write",
    });
    expect(deploy?.environment?.name).toBe("github-pages");
    expect(actionVersions(pages)).toEqual(expect.arrayContaining([
      "actions/checkout@v6",
      "pnpm/action-setup@v6",
      "actions/setup-node@v6",
      "actions/configure-pages@v5",
      "actions/upload-pages-artifact@v4",
      "actions/deploy-pages@v4",
    ]));
  });

  it("passes the API key only to generation and prevents duplicate bot-push deployments", async () => {
    const pages = await workflow("pages");
    const generation = pages.jobs.generate;
    const build = pages.jobs.build;
    const allRuns = Object.values(pages.jobs).flatMap((job) =>
      job.steps.flatMap((step) => step.run ?? []),
    );
    const generationStep = generation?.steps.find(
      (step) => step.name === "Generate daily lessons",
    );
    const commitStep = generation?.steps.find(
      (step) => step.name === "Commit validated derived lesson data",
    );

    expect(generationStep?.env?.OPENAI_API_KEY).toBe(
      "${{ secrets.OPENAI_API_KEY }}",
    );
    expect(generationStep?.run).toContain("--date=\"$LESSON_DATE\"");
    expect(allRuns.join("\n")).not.toContain("secrets.OPENAI_API_KEY");
    expect(JSON.stringify(build)).not.toContain("OPENAI_API_KEY");
    expect(commitStep?.run).toContain("[skip ci]");
    expect(commitStep?.run).toContain("public/data");
    expect(commitStep?.run).toContain("data/editorial-ledger.json");
    expect(commitStep?.run).toContain("data/cache/index.json");
    expect(commitStep?.run).toContain("data/pending-publication.json");
    expect(build?.if).toContain("github-actions[bot]");
  });

  it("builds and scans before uploading dist, then smoke-checks the deployed URL", async () => {
    const pages = await workflow("pages");
    const uploaders = Object.values(pages.jobs).flatMap((job) =>
      job.steps.filter((step) => step.uses === "actions/upload-pages-artifact@v4"),
    );
    const deploy = pages.jobs.deploy;

    expect(uploaders).toHaveLength(2);
    expect(uploaders.every((step) => step.with?.path === "dist")).toBe(true);
    expect(JSON.stringify(pages.jobs.generate)).toContain("pnpm check:secrets");
    expect(JSON.stringify(pages.jobs.build)).toContain("pnpm check:secrets");
    expect(JSON.stringify(deploy)).toContain("pnpm smoke");
    expect(deploy?.needs).toEqual(expect.arrayContaining(["generate", "build"]));
  });
});

describe("Vite Pages base", () => {
  it("derives project and user-site paths without hardcoding a repository", () => {
    expect(resolvePagesBase({ GITHUB_REPOSITORY: "owner/nyhetsspar" })).toBe(
      "/nyhetsspar/",
    );
    expect(resolvePagesBase({ GITHUB_REPOSITORY: "owner/owner.github.io" })).toBe(
      "/",
    );
    expect(resolvePagesBase({})).toBe("/");
  });
});
