import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { LessonIndexSchema } from "../../src/contracts/content";
import { HistoryPage } from "../../src/web/pages/HistoryPage";

const index = LessonIndexSchema.parse({
  schemaVersion: 1,
  dates: [
    {
      date: "2026-07-23",
      status: "ready",
      lessonPath: "data/lessons/2026-07-23-0123456789abcdef.json",
      articles: [
        {
          id: "domestic",
          title: "Vardag i Sverige",
          source: "svt",
          scope: "sweden",
          topic: "daily-life",
          difficulty: "B1",
          isFollowUp: false,
        },
        {
          id: "world",
          title: "Val i världen",
          source: "dn",
          scope: "international",
          topic: "politics",
          difficulty: "B2",
          isFollowUp: true,
        },
      ],
    },
  ],
});

describe("HistoryPage", () => {
  it("filters indexed lessons by source, scope, and topic", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <HistoryPage index={index} />
      </MemoryRouter>,
    );

    const filters = screen.getByRole("group", { name: "历史筛选" });
    expect(screen.getByRole("link", { name: /Vardag i Sverige/ })).toBeVisible();
    expect(screen.getByRole("link", { name: /Val i världen/ })).toBeVisible();

    await user.selectOptions(within(filters).getByLabelText("来源"), "dn");
    expect(screen.queryByRole("link", { name: /Vardag i Sverige/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Val i världen/ })).toBeVisible();

    await user.selectOptions(within(filters).getByLabelText("范围"), "sweden");
    expect(screen.getByText("没有符合筛选条件的课程。")).toBeVisible();

    await user.selectOptions(within(filters).getByLabelText("来源"), "all");
    await user.selectOptions(within(filters).getByLabelText("主题"), "daily-life");
    expect(screen.getByRole("link", { name: /Vardag i Sverige/ })).toBeVisible();
  });
});
