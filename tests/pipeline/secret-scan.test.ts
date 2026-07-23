import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanDirectoryForSecrets } from "../../scripts/check-build-secrets";

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nyhetsspar-secret-"));
}

describe("build secret scanner", () => {
  it("rejects an OpenAI-style key without including its value in the error", async () => {
    const root = await temporaryDirectory();
    const secret = "sk-test-secret-value";
    await writeFile(join(root, "asset.js"), `const key = "${secret}";`, "utf8");

    const error = await scanDirectoryForSecrets(root).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^secret-pattern:asset\.js$/u);
    expect((error as Error).message).not.toContain(secret);
  });

  it("rejects a secret split across streaming read boundaries", async () => {
    const root = await temporaryDirectory();
    const padding = "a".repeat(64 * 1024 - 4);
    await writeFile(join(root, "large.js"), `${padding}sk-proj-abcdefghijklmnop`, "utf8");

    await expect(scanDirectoryForSecrets(root)).rejects.toThrow(
      "secret-pattern:large.js",
    );
  });

  it("scans nested text and accepts the intentionally blank example variable", async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, "assets"));
    await writeFile(
      join(root, "assets", "app.js"),
      'const label = "OPENAI_API_KEY";',
      "utf8",
    );
    await writeFile(join(root, ".env.example"), "OPENAI_API_KEY=\n", "utf8");

    await expect(scanDirectoryForSecrets(root)).resolves.toBeUndefined();
  });

  it("rejects symlinks instead of following them outside the scan root", async () => {
    const root = await temporaryDirectory();
    const outside = join(await temporaryDirectory(), "outside.txt");
    await writeFile(outside, "ordinary public text", "utf8");
    await symlink(outside, join(root, "linked.txt"));

    await expect(scanDirectoryForSecrets(root)).rejects.toThrow(
      "secret-scan-symlink:linked.txt",
    );
  });

  it("streams large binary files with bounded chunks without hiding embedded secrets", async () => {
    const root = await temporaryDirectory();
    const binary = Buffer.concat([
      Buffer.alloc(2 * 1024 * 1024, 0),
      Buffer.from("OPENAI_API_KEY='not-for-the-build-output'"),
    ]);
    await writeFile(join(root, "large.bin"), binary);

    await expect(scanDirectoryForSecrets(root)).rejects.toThrow(
      "secret-pattern:large.bin",
    );
  });
});
