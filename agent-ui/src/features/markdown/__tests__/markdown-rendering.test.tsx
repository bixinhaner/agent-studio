import { render, screen } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import { describe, expect, it, vi } from "vitest";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string, code: string) => ({
      svg: `<svg data-mermaid-id="${id}" data-mermaid-code="${code.replace(/"/g, "&quot;")}"></svg>`
    }))
  }
}));

import {
  extractMermaidCodeFromPreChildren,
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
  PREVIEW_MARKDOWN_REHYPE_PLUGINS,
  MarkdownMermaidBlock,
  MarkdownTable
} from "../markdown-rendering";
import { normalizeLatexDelimiters } from "../latex-delimiters";

function TestMarkdown(props: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={MARKDOWN_REMARK_PLUGINS}
      rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
      components={{
        table: MarkdownTable as any,
        pre: ({ children, ...rest }) => {
          const mermaidCode = extractMermaidCodeFromPreChildren(children);
          if (mermaidCode) return <MarkdownMermaidBlock code={mermaidCode} />;
          return <pre {...rest}>{children}</pre>;
        }
      }}
    >
      {props.text}
    </ReactMarkdown>
  );
}

function TestPreviewMarkdown(props: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={MARKDOWN_REMARK_PLUGINS}
      rehypePlugins={PREVIEW_MARKDOWN_REHYPE_PLUGINS}
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

  it("renders math formulas with katex markup", () => {
    const { container } = render(
      <TestMarkdown
        text={[
          "Inline math $E=mc^2$ works.",
          "",
          "$$",
          "\\int_0^1 x^2 dx",
          "$$"
        ].join("\n")}
      />
    );

    expect(container.querySelector(".katex")).toBeTruthy();
    expect(container.querySelector(".katex-display")).toBeTruthy();
    expect(container.textContent?.includes("E=mc2")).toBe(true);
  });

  it("renders agent-style LaTeX delimiters with katex markup after normalization", () => {
    const { container } = render(
      <TestMarkdown
        text={normalizeLatexDelimiters(
          [
            "面向 \\(\\tau\\) 的轻量短时预测。",
            "",
            "\\[",
            "\\mathbf H_{\\mathrm{FR1}}^{\\mathrm{UL}}(t) \\neq \\mathbf H_{\\mathrm{FR2}}^{\\mathrm{DL}}(t)",
            "\\]"
          ].join("\n")
        )}
      />
    );

    expect(container.querySelectorAll(".katex").length).toBe(2);
    expect(container.querySelector(".katex-display")).toBeTruthy();
    expect(container.querySelectorAll(".katex-html").length).toBe(2);
    expect(container.querySelector(".katex-error")).toBeNull();
  });

  it("renders compact bracket delimiters as display math", () => {
    const { container } = render(
      <TestMarkdown text={normalizeLatexDelimiters("Before \\[x+y\\] after")} />
    );

    expect(container.querySelector(".katex-display")).toBeTruthy();
  });

  it("renders mermaid code blocks as diagrams", async () => {
    const { container } = render(
      <TestMarkdown
        text={[
          "```mermaid",
          "graph TD",
          "  A[Start] --> B[Done]",
          "```"
        ].join("\n")}
      />
    );

    const diagram = await screen.findByRole("img", { name: "Mermaid diagram" });
    expect(diagram).toBeTruthy();
    expect(container.querySelector(".markdown-mermaid-block")).toBeTruthy();
    expect(container.querySelector("svg[data-mermaid-id]")).toBeTruthy();
  });

  it("renders raw html tables in preview markdown pipeline", () => {
    const { container } = render(
      <TestPreviewMarkdown
        text={[
          "<table>",
          "  <tr><td>Product Platform</td><td>Product Name</td></tr>",
          "  <tr><td>43X</td><td>Nova436Q</td></tr>",
          "</table>"
        ].join("\n")}
      />
    );

    const table = container.querySelector("table");
    expect(table).toBeTruthy();
    expect(screen.getByText("Product Platform")).toBeTruthy();
    expect(screen.getByText("Nova436Q")).toBeTruthy();
  });
});
