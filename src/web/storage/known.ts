import { z } from "zod";
import type { Annotation } from "../../contracts/content";

const KEY = "nyhetsspar.known.v1";

const KnownRecordSchema = z
  .object({
    kind: z.enum(["vocabulary", "phrase", "grammar"]),
    canonical: z.string().min(1),
    original: z.string().min(1),
    meaningZh: z.string(),
    meaningEn: z.string(),
    markedAt: z.string().datetime(),
    articleId: z.string().min(1).optional(),
  })
  .strict();

const KnownExportSchema = z
  .object({
    version: z.literal(1),
    records: z.array(KnownRecordSchema),
  })
  .strict();

export type KnownRecord = z.infer<typeof KnownRecordSchema>;
export type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const unavailableStorage: BrowserStorage = {
  getItem() {
    throw new DOMException("localStorage unavailable", "SecurityError");
  },
  setItem() {
    throw new DOMException("localStorage unavailable", "SecurityError");
  },
  removeItem() {
    throw new DOMException("localStorage unavailable", "SecurityError");
  },
};

export function resolveBrowserStorage(
  storage?: BrowserStorage,
): BrowserStorage {
  if (storage) {
    return storage;
  }
  try {
    return window.localStorage;
  } catch {
    return unavailableStorage;
  }
}

export function knownItemIdentity(
  kind: Annotation["kind"],
  canonical: string,
): string {
  const normalized = canonical
    .normalize("NFKC")
    .toLocaleLowerCase("sv")
    .trim()
    .replace(/\s+/gu, " ");
  return `${kind}:${normalized}`;
}

export function createKnownStore(storage?: BrowserStorage) {
  const resolvedStorage = resolveBrowserStorage(storage);
  const unreadable = Symbol("unreadable-storage");
  type ObservedRaw = string | null | typeof unreadable;
  let volatileRecords: KnownRecord[] = [];
  let lastObservedRaw: ObservedRaw = unreadable;
  let incompatibleRaw: string | undefined;
  let writeFailedAgainst: ObservedRaw | undefined;
  let readUnavailable = false;

  const read = (): KnownRecord[] => {
    let raw: string | null;
    try {
      raw = resolvedStorage.getItem(KEY);
    } catch {
      lastObservedRaw = unreadable;
      readUnavailable = true;
      return volatileRecords;
    }

    readUnavailable = false;
    lastObservedRaw = raw;
    if (
      writeFailedAgainst !== undefined &&
      Object.is(raw, writeFailedAgainst)
    ) {
      return volatileRecords;
    }
    writeFailedAgainst = undefined;

    if (raw === null) {
      incompatibleRaw = undefined;
      volatileRecords = [];
      return volatileRecords;
    }
    if (raw === incompatibleRaw) {
      return volatileRecords;
    }

    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      incompatibleRaw = raw;
      volatileRecords = [];
      return volatileRecords;
    }
    const parsed = KnownExportSchema.safeParse(value);
    if (!parsed.success) {
      incompatibleRaw = raw;
      volatileRecords = [];
      return volatileRecords;
    }
    incompatibleRaw = undefined;
    volatileRecords = parsed.data.records;
    return parsed.data.records;
  };

  const write = (records: KnownRecord[], forceReset = false): void => {
    const parsed = KnownExportSchema.parse({ version: 1, records });
    volatileRecords = parsed.records;
    if ((readUnavailable || incompatibleRaw !== undefined) && !forceReset) {
      return;
    }
    const serialized = JSON.stringify(parsed);
    try {
      resolvedStorage.setItem(KEY, serialized);
      lastObservedRaw = serialized;
      incompatibleRaw = undefined;
      writeFailedAgainst = undefined;
      readUnavailable = false;
    } catch {
      // Browser privacy settings may make localStorage unavailable. The
      // in-memory copy keeps this session usable without exposing an error.
      writeFailedAgainst = lastObservedRaw;
    }
  };

  return {
    list(): KnownRecord[] {
      return [...read()];
    },
    isKnown(kind: Annotation["kind"], canonical: string): boolean {
      const identity = knownItemIdentity(kind, canonical);
      return read().some(
        (record) =>
          knownItemIdentity(record.kind, record.canonical) === identity,
      );
    },
    mark(record: KnownRecord): void {
      const parsed = KnownRecordSchema.parse(record);
      const identity = knownItemIdentity(parsed.kind, parsed.canonical);
      write([
        parsed,
        ...read().filter(
          (current) =>
            knownItemIdentity(current.kind, current.canonical) !== identity,
        ),
      ]);
    },
    restore(kind: Annotation["kind"], canonical: string): void {
      const identity = knownItemIdentity(kind, canonical);
      write(
        read().filter(
          (record) =>
            knownItemIdentity(record.kind, record.canonical) !== identity,
        ),
      );
    },
    clearAll(): void {
      read();
      write([], true);
    },
    exportJson(): string {
      return `${JSON.stringify({ version: 1, records: read() }, null, 2)}\n`;
    },
    importJson(raw: string): void {
      const imported = KnownExportSchema.parse(JSON.parse(raw) as unknown);
      const merged = new Map<string, KnownRecord>();
      for (const record of [...read(), ...imported.records]) {
        merged.set(knownItemIdentity(record.kind, record.canonical), record);
      }
      write([...merged.values()]);
    },
  };
}
