import { open, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const CHUNK_BYTES = 64 * 1024;
const OVERLAP_CHARACTERS = 2 * 1024;
const secretPatterns = [
  /sk-[A-Za-z0-9_-]{12,}/u,
  /OPENAI_API_KEY\s*[:=]\s*(?:"[^"\r\n]{8,}"|'[^'\r\n]{8,}'|[^\s"'`]{8,})/u,
];

function relativeDisplayPath(root: string, path: string): string {
  const display = relative(root, path).split(sep).join("/");
  return secretPatterns.some((pattern) => pattern.test(display))
    ? "[redacted-path]"
    : display;
}

function assertNoSecret(text: string, displayPath: string): void {
  if (secretPatterns.some((pattern) => pattern.test(text))) {
    throw new Error(`secret-pattern:${displayPath}`);
  }
}

async function scanFile(root: string, path: string): Promise<void> {
  const displayPath = relativeDisplayPath(root, path);
  const handle = await open(path, "r");
  const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
  let carry = "";
  try {
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      const text = `${carry}${buffer.subarray(0, bytesRead).toString("latin1")}`;
      assertNoSecret(text, displayPath);
      carry = text.slice(-OVERLAP_CHARACTERS);
    }
  } finally {
    await handle.close();
  }
}

async function scanDirectory(root: string, directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const displayPath = relativeDisplayPath(root, path);
    if (entry.isSymbolicLink()) {
      throw new Error(`secret-scan-symlink:${displayPath}`);
    }
    if (entry.isDirectory()) {
      await scanDirectory(root, path);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`secret-scan-unsupported-entry:${displayPath}`);
    }
    await scanFile(root, path);
  }
}

export async function scanDirectoryForSecrets(root: string): Promise<void> {
  await scanDirectory(root, root);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const roots = process.argv.slice(2).filter((argument) => argument !== "--");
  for (const root of roots.length === 0 ? ["dist"] : roots) {
    await scanDirectoryForSecrets(root);
  }
  process.stdout.write("secret-scan:clean\n");
}
