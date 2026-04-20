import { render, screen } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vitest";

import { MARKDOWN_REMARK_PLUGINS, MarkdownTable } from "../markdown-rendering";

function TestMarkdown(props: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={MARKDOWN_REMARK_PLUGINS}
      components={{
        table: MarkdownTable as any
      }}
    >
      {props.text}
    </ReactMarkdown>
  );
}

describe("markdown rendering", () => {
  it("renders GFM tables with the scroll wrapper", () => {
    const { container } = render(
      <TestMarkdown
        text={[
          "| Metric | Value | Notes |",
          "| --- | ---: | --- |",
          "| Latency | 120ms | Long table content should stay inside the message viewport |"
        ].join("\n")}
      />
    );

    const wrapper = container.querySelector(".markdown-table-scroll");
    const table = wrapper?.querySelector("table");

    expect(wrapper).toBeTruthy();
    expect(table).toBeTruthy();
    expect(table?.classList.contains("aui-md-table")).toBe(true);
    expect(container.querySelector("thead")).toBeTruthy();
    expect(screen.getByText("Latency")).toBeTruthy();
  });

  it("renders common GFM inline and list syntax", () => {
    const { container } = render(
      <TestMarkdown
        text={[
          "- [x] Confirmed",
          "- [ ] Pending",
          "",
          "~~Removed~~",
          "",
          "https://example.com/docs"
        ].join("\n")}
      />
    );

    const checkedTask = container.querySelector<HTMLInputElement>('input[type="checkbox"][checked]');
    const taskItems = container.querySelectorAll(".task-list-item");
    const deletedText = container.querySelector("del");
    const link = screen.getByRole("link", { name: "https://example.com/docs" });

    expect(checkedTask).toBeTruthy();
    expect(checkedTask?.disabled).toBe(true);
    expect(taskItems.length).toBe(2);
    expect(deletedText?.textContent).toBe("Removed");
    expect(link.getAttribute("href")).toBe("https://example.com/docs");
  });
});
