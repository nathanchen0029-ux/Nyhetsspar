import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/web/App";

const lessonPath = "data/lessons/2026-07-23-fedcba9876543210.json";
const indexPayload = {
  schemaVersion: 1,
  dates: [
    {
      date: "2026-07-23",
      status: "delayed",
      lessonPath,
      articles: [],
    },
  ],
};
const lessonPayload = {
  schemaVersion: 1,
  date: "2026-07-23",
  timezone: "Europe/Stockholm",
  generatedAt: "2026-07-23T05:05:00.000Z",
  status: "delayed",
  sourceHealth: { svt: "partial", aftonbladet: "partial", dn: "partial" },
  selectionSummary: "Waiting for balanced coverage.",
  articles: [],
};

function mockDataRequests() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify(indexPayload)))
    .mockResolvedValueOnce(new Response(JSON.stringify(lessonPayload)));
}

describe("App", () => {
  afterEach(() => {
    window.location.hash = "";
    vi.restoreAllMocks();
  });

  it("loads and renders the latest indexed lesson", async () => {
    mockDataRequests();
    render(<App />);

    expect(screen.getByText("正在加载课程…")).toBeVisible();
    expect(
      await screen.findByRole("heading", { name: /Dagens lektion/i }),
    ).toBeVisible();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(`/${lessonPath}`);
  });

  it("provides shell navigation to the history route", async () => {
    const user = userEvent.setup();
    mockDataRequests();
    render(<App />);
    await screen.findByRole("heading", { name: /Dagens lektion/i });

    await user.click(screen.getByRole("link", { name: "历史" }));

    expect(screen.getByRole("heading", { name: "历史课程" })).toBeVisible();
    expect(window.location.hash).toBe("#/history");
  });

  it("keeps the loading state until the indexed lesson is ready", async () => {
    let resolveLesson!: (response: Response) => void;
    const lessonResponse = new Promise<Response>((resolve) => {
      resolveLesson = resolve;
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(indexPayload)))
      .mockReturnValueOnce(lessonResponse);

    render(<App />);
    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(`/${lessonPath}`),
    );

    expect(screen.getByText("正在加载课程…")).toBeVisible();
    expect(screen.queryByText("还没有课程。")).not.toBeInTheDocument();

    resolveLesson(new Response(JSON.stringify(lessonPayload)));
    expect(
      await screen.findByRole("heading", { name: /Dagens lektion/i }),
    ).toBeVisible();
  });
});
