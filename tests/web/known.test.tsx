import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KnownPage } from "../../src/web/pages/KnownPage";
import { createKnownStore } from "../../src/web/storage/known";

function record(
  canonical: string,
  overrides: Partial<Parameters<ReturnType<typeof createKnownStore>["mark"]>[0]> = {},
) {
  return {
    kind: "vocabulary",
    canonical,
    original: `${canonical}en`,
    meaningZh: "中文释义",
    meaningEn: "English meaning",
    markedAt: "2026-07-23T05:00:00.000Z",
    ...overrides,
  } as const;
}

function jsonFile(contents: string, name = "known.json"): File {
  const file = new File([contents], name, { type: "application/json" });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: async () => contents,
  });
  return file;
}

describe("KnownPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("searches and restores a known lemma", async () => {
    const store = createKnownStore(localStorage);
    store.mark(
      record("regering", {
        original: "regeringen",
        meaningZh: "政府",
        meaningEn: "government",
      }),
    );

    render(<KnownPage store={store} />);
    await userEvent.type(screen.getByRole("searchbox"), "reger");

    expect(screen.getByText("regering")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: /恢复/u }));
    expect(store.isKnown("vocabulary", "regering")).toBe(false);
    expect(screen.queryByText("regering")).not.toBeInTheDocument();
  });

  it("searches Swedish forms and bilingual meanings and filters clear categories", async () => {
    const user = userEvent.setup();
    const store = createKnownStore(localStorage);
    store.mark(
      record("regering", {
        original: "regeringen",
        meaningZh: "政府",
        meaningEn: "government",
      }),
    );
    store.mark(
      record("fatta beslut", {
        kind: "phrase",
        original: "fattade beslut",
        meaningZh: "作出决定",
        meaningEn: "make a decision",
      }),
    );
    store.mark(
      record("passiv form", {
        kind: "grammar",
        original: "beslutet fattades",
        meaningZh: "被动语态",
        meaningEn: "passive voice",
      }),
    );
    render(<KnownPage store={store} />);

    expect(screen.getByRole("heading", { name: "词汇" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "词组与固定搭配" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "语法" })).toBeVisible();

    await user.type(screen.getByRole("searchbox"), "GOVERNMENT");
    expect(screen.getByText("regering")).toBeVisible();
    expect(screen.queryByText("fatta beslut")).not.toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox"));
    await user.selectOptions(screen.getByRole("combobox", { name: "类别" }), "grammar");
    expect(screen.getByText("passiv form")).toBeVisible();
    expect(screen.queryByText("regering")).not.toBeInTheDocument();
  });

  it("merge-imports a valid backup and can reuse the same file input", async () => {
    const user = userEvent.setup();
    const store = createKnownStore(localStorage);
    store.mark(record("regering"));
    render(<KnownPage store={store} />);
    const input = screen.getByLabelText("选择 JSON 备份文件");
    const backup = jsonFile(
      JSON.stringify({ version: 1, records: [record("kommun")] }),
    );

    await user.upload(input, backup);

    expect(await screen.findByRole("status")).toHaveTextContent("导入完成");
    expect(store.list().map((item) => item.canonical).sort()).toEqual([
      "kommun",
      "regering",
    ]);
    await user.click(
      within(screen.getByText("kommun").closest("li")!).getByRole("button", {
        name: "恢复提示",
      }),
    );
    expect(store.list()).toHaveLength(1);

    await user.upload(input, backup);

    await waitFor(() => expect(store.list()).toHaveLength(2));
  });

  it("counts imported additions by normalized identity after deduplication", () => {
    localStorage.setItem(
      "nyhetsspar.known.v1",
      JSON.stringify({
        version: 1,
        records: [
          record(" REGERING "),
          record("regering", { original: "regeringen" }),
        ],
      }),
    );
    const store = createKnownStore(localStorage);

    expect(
      store.importJson(JSON.stringify({ version: 1, records: [] })),
    ).toEqual({ added: 0, total: 1 });
    expect(
      store.importJson(
        JSON.stringify({
          version: 1,
          records: [
            record(" kommun "),
            record("KOMMUN", { original: "kommunen" }),
          ],
        }),
      ),
    ).toEqual({ added: 1, total: 2 });
    expect(store.list()).toHaveLength(2);
  });

  it("rejects an invalid import without changing current records", async () => {
    const user = userEvent.setup();
    const store = createKnownStore(localStorage);
    store.mark(record("regering"));
    const before = localStorage.getItem("nyhetsspar.known.v1");
    render(<KnownPage store={store} />);

    await user.upload(
      screen.getByLabelText("选择 JSON 备份文件"),
      jsonFile('{"version":2,"records":[]}'),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("导入失败");
    expect(localStorage.getItem("nyhetsspar.known.v1")).toBe(before);
    expect(store.list().map((item) => item.canonical)).toEqual(["regering"]);
  });

  it.each([
    ["malformed", "{not-json"],
    [
      "forward-version",
      JSON.stringify({
        version: 9,
        records: [record("future")],
      }),
    ],
  ])(
    "does not clobber or report success over %s existing storage",
    async (_caseName, incompatible) => {
      const user = userEvent.setup();
      localStorage.setItem("nyhetsspar.known.v1", incompatible);
      const store = createKnownStore(localStorage);
      render(<KnownPage store={store} />);

      await user.upload(
        screen.getByLabelText("选择 JSON 备份文件"),
        jsonFile(
          JSON.stringify({ version: 1, records: [record("imported")] }),
        ),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "现有本地数据无法安全合并",
      );
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(localStorage.getItem("nyhetsspar.known.v1")).toBe(incompatible);
      expect(store.list()).toEqual([]);
    },
  );

  it("exports a named JSON backup and always releases its Blob URL", async () => {
    const store = createKnownStore(localStorage);
    store.mark(record("regering"));
    const createObjectURL = vi.fn((_blob: Blob) => "blob:known-backup");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    let clickedAnchor: HTMLAnchorElement | null = null;
    vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clickedAnchor = this;
      });
    render(<KnownPage store={store} />);

    await userEvent.click(screen.getByRole("button", { name: "导出 JSON" }));

    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]![0];
    const contents = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    const exported = JSON.parse(contents) as {
      version: number;
      records: Array<{ canonical: string }>;
    };
    expect(exported).toMatchObject({
      version: 1,
      records: [{ canonical: "regering" }],
    });
    expect(clickedAnchor).not.toBeNull();
    expect(clickedAnchor!.download).toBe("nyhetsspar-known-v1.json");
    expect(clickedAnchor!.href).toBe("blob:known-backup");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:known-backup");
  });

  it("keeps all records when clearing is cancelled", async () => {
    const store = createKnownStore(localStorage);
    store.mark(record("regering"));
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<KnownPage store={store} />);

    await userEvent.click(screen.getByRole("button", { name: "清空全部" }));

    expect(store.list()).toHaveLength(1);
    expect(screen.getByText("regering")).toBeVisible();
  });

  it("clears all records only after explicit confirmation", async () => {
    const store = createKnownStore(localStorage);
    store.mark(record("regering"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<KnownPage store={store} />);

    await userEvent.click(screen.getByRole("button", { name: "清空全部" }));

    expect(store.list()).toEqual([]);
    expect(screen.queryByText("regering")).not.toBeInTheDocument();
    expect(screen.getByText("当前没有已掌握项目。")).toBeVisible();
  });

  it("reports a failed confirmed clear and keeps persisted and visible records", async () => {
    let raw: string | null = null;
    let rejectWrites = false;
    const storage = {
      getItem: () => raw,
      setItem: (_key: string, value: string) => {
        if (rejectWrites) {
          throw new DOMException("quota", "QuotaExceededError");
        }
        raw = value;
      },
      removeItem: () => {
        raw = null;
      },
    };
    const store = createKnownStore(storage);
    store.mark(record("regering"));
    const before = raw;
    rejectWrites = true;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<KnownPage store={store} />);

    await userEvent.click(screen.getByRole("button", { name: "清空全部" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "清空失败：浏览器目前无法安全访问本地存储",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("regering")).toBeVisible();
    expect(store.list().map((item) => item.canonical)).toEqual(["regering"]);
    expect(raw).toBe(before);
  });
});
