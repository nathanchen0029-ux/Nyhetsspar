import { z } from "zod";
import {
  resolveBrowserStorage,
  type BrowserStorage,
} from "./known";

const KEY = "nyhetsspar.progress.v1";

const ProgressStateSchema = z
  .object({
    version: z.literal(1),
    openedIds: z.array(z.string().min(1)),
    completedIds: z.array(z.string().min(1)),
    positions: z.record(z.string().min(1), z.number().nonnegative()),
    lastOpenedId: z.string().min(1).nullable(),
  })
  .strict();

const LegacyProgressStateSchema = z
  .object({
    version: z.literal(1),
    completedIds: z.array(z.string().min(1)),
  })
  .strict();

type ProgressState = z.infer<typeof ProgressStateSchema>;

function emptyProgress(): ProgressState {
  return {
    version: 1,
    openedIds: [],
    completedIds: [],
    positions: {},
    lastOpenedId: null,
  };
}

export function createProgressStore(storage?: BrowserStorage) {
  const resolvedStorage = resolveBrowserStorage(storage);
  const unreadable = Symbol("unreadable-storage");
  type ObservedRaw = string | null | typeof unreadable;
  let volatileState = emptyProgress();
  let lastObservedRaw: ObservedRaw = unreadable;
  let incompatibleRaw: string | undefined;
  let writeFailedAgainst: ObservedRaw | undefined;
  let readUnavailable = false;

  const read = (): ProgressState => {
    let raw: string | null;
    try {
      raw = resolvedStorage.getItem(KEY);
    } catch {
      lastObservedRaw = unreadable;
      readUnavailable = true;
      return volatileState;
    }

    readUnavailable = false;
    lastObservedRaw = raw;
    if (
      writeFailedAgainst !== undefined &&
      Object.is(raw, writeFailedAgainst)
    ) {
      return volatileState;
    }
    writeFailedAgainst = undefined;

    if (raw === null) {
      incompatibleRaw = undefined;
      volatileState = emptyProgress();
      return volatileState;
    }
    if (raw === incompatibleRaw) {
      return volatileState;
    }

    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      incompatibleRaw = raw;
      volatileState = emptyProgress();
      return volatileState;
    }
    const current = ProgressStateSchema.safeParse(value);
    if (current.success) {
      incompatibleRaw = undefined;
      volatileState = current.data;
      return current.data;
    }
    const legacy = LegacyProgressStateSchema.safeParse(value);
    if (legacy.success) {
      incompatibleRaw = undefined;
      volatileState = {
        ...emptyProgress(),
        completedIds: [...new Set(legacy.data.completedIds)],
      };
      return volatileState;
    }
    incompatibleRaw = raw;
    volatileState = emptyProgress();
    return volatileState;
  };

  const write = (state: ProgressState): void => {
    const parsed = ProgressStateSchema.parse(state);
    volatileState = parsed;
    if (readUnavailable || incompatibleRaw !== undefined) {
      return;
    }
    const serialized = JSON.stringify(parsed);
    try {
      resolvedStorage.setItem(KEY, serialized);
      lastObservedRaw = serialized;
      writeFailedAgainst = undefined;
      readUnavailable = false;
    } catch {
      // Keep the validated in-memory state when localStorage is blocked.
      writeFailedAgainst = lastObservedRaw;
    }
  };

  return {
    opened(): Set<string> {
      return new Set(read().openedIds);
    },
    completed(): Set<string> {
      return new Set(read().completedIds);
    },
    markOpened(id: string): void {
      const parsedId = z.string().min(1).parse(id);
      const current = read();
      write({
        ...current,
        openedIds: [...new Set([...current.openedIds, parsedId])],
        lastOpenedId: parsedId,
      });
    },
    setCompleted(id: string, completed: boolean): void {
      const parsedId = z.string().min(1).parse(id);
      const current = read();
      const completedIds = new Set(current.completedIds);
      if (completed) {
        completedIds.add(parsedId);
      } else {
        completedIds.delete(parsedId);
      }
      write({ ...current, completedIds: [...completedIds] });
    },
    savePosition(id: string, y: number): void {
      const parsedId = z.string().min(1).parse(id);
      const current = read();
      const position = Number.isFinite(y) ? Math.max(0, y) : 0;
      write({
        ...current,
        positions: { ...current.positions, [parsedId]: position },
      });
    },
    position(id: string): number {
      return read().positions[id] ?? 0;
    },
    lastOpenedId(): string | null {
      return read().lastOpenedId;
    },
  };
}
