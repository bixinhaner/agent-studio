import type { TableHTMLAttributes } from "react";
import remarkGfm from "remark-gfm";

export const MARKDOWN_REMARK_PLUGINS = [remarkGfm];

type MarkdownTableProps = TableHTMLAttributes<HTMLTableElement> & {
  node?: unknown;
};

export function MarkdownTable({ className, node: _node, ...props }: MarkdownTableProps) {
  return (
    <div className="markdown-table-scroll">
      <table className={className ? `aui-md-table ${className}` : "aui-md-table"} {...props} />
    </div>
  );
}
