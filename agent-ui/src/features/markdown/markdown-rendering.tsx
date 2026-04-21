import type { CodeHeaderProps, SyntaxHighlighterProps } from "@assistant-ui/react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import {
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type TableHTMLAttributes
} from "react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkMath];
export const MARKDOWN_REHYPE_PLUGINS = [rehypeKatex];
export const PREVIEW_MARKDOWN_REHYPE_PLUGINS = [rehypeRaw, ...MARKDOWN_REHYPE_PLUGINS];

type MarkdownTableProps = TableHTMLAttributes<HTMLTableElement> & {
  node?: unknown;
};

type MermaidModule = {
  initialize(config: Record<string, unknown>): void;
  render(
    id: string,
    text: string
  ): Promise<{
    svg: string;
    bindFunctions?: ((element: Element) => void) | undefined;
  }>;
};

let mermaidModulePromise: Promise<MermaidModule> | null = null;
let mermaidInitialized = false;
let mermaidRenderSequence = 0;

function flattenNodeText(value: ReactNode): string {
  if (value === null || value === undefined || typeof value === "boolean") return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((item) => flattenNodeText(item)).join("");
  if (isValidElement(value)) {
    return flattenNodeText((value.props as { children?: ReactNode }).children);
  }
  return "";
}

async function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import("mermaid").then((module) => {
      const resolved = (module.default ?? module) as MermaidModule;
      if (!mermaidInitialized) {
        resolved.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
          suppressErrorRendering: true
        });
        mermaidInitialized = true;
      }
      return resolved;
    });
  }
  return mermaidModulePromise;
}

function nextMermaidRenderId(prefix: string): string {
  mermaidRenderSequence += 1;
  const normalizedPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, "");
  return `${normalizedPrefix}-${mermaidRenderSequence}`;
}

function EmptyCodeHeader(_props: CodeHeaderProps) {
  return null;
}

export function MarkdownTable({ className, node: _node, ...props }: MarkdownTableProps) {
  return (
    <div className="markdown-table-scroll">
      <table className={className ? `aui-md-table ${className}` : "aui-md-table"} {...props} />
    </div>
  );
}

export function extractMermaidCodeFromPreChildren(children: ReactNode): string | null {
  const codeNode = Array.isArray(children) ? children[0] : children;
  if (!isValidElement(codeNode)) return null;
  const props = codeNode.props as { className?: unknown; children?: ReactNode };

  const className = typeof props.className === "string" ? props.className : "";
  if (!/\blanguage-mermaid\b/.test(className)) return null;

  const code = flattenNodeText(props.children).replace(/\n$/, "");
  return code.trim() ? code : null;
}

export function MarkdownMermaidBlock(props: { code: string }) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const bindFunctionsRef = useRef<((element: Element) => void) | undefined>(undefined);
  const reactId = useId();
  const blockId = useMemo(() => `markdown-mermaid-${reactId}`, [reactId]);
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; svg: string; error: string }>({
    status: "loading",
    svg: "",
    error: ""
  });

  useEffect(() => {
    let active = true;
    bindFunctionsRef.current = undefined;
    setState({
      status: "loading",
      svg: "",
      error: ""
    });

    if (typeof window === "undefined") {
      return () => {
        active = false;
      };
    }

    void loadMermaid()
      .then(async (mermaid) => {
        const result = await mermaid.render(nextMermaidRenderId(blockId), props.code);
        if (!active) return;

        bindFunctionsRef.current = result.bindFunctions;
        setState({
          status: "ready",
          svg: result.svg,
          error: ""
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: "error",
          svg: "",
          error: error instanceof Error ? error.message : "Failed to render Mermaid diagram."
        });
      });

    return () => {
      active = false;
    };
  }, [blockId, props.code]);

  useEffect(() => {
    if (state.status !== "ready" || !canvasRef.current || !bindFunctionsRef.current) return;
    bindFunctionsRef.current(canvasRef.current);
  }, [state.status, state.svg]);

  if (state.status === "error") {
    return (
      <div className="markdown-mermaid-block markdown-mermaid-block-error" role="img" aria-label="Mermaid diagram failed">
        <p className="markdown-mermaid-status">Mermaid render failed</p>
        <pre className="markdown-mermaid-error-detail">{state.error}</pre>
      </div>
    );
  }

  return (
    <div className="markdown-mermaid-block" data-status={state.status}>
      {state.status === "ready" ? (
        <div
          ref={canvasRef}
          className="markdown-mermaid-canvas"
          role="img"
          aria-label="Mermaid diagram"
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      ) : (
        <div className="markdown-mermaid-status" aria-live="polite">
          Rendering Mermaid diagram...
        </div>
      )}
    </div>
  );
}

export function MarkdownMermaidSyntaxHighlighter(props: SyntaxHighlighterProps) {
  return <MarkdownMermaidBlock code={props.code} />;
}

export const MARKDOWN_COMPONENTS_BY_LANGUAGE = {
  mermaid: {
    CodeHeader: EmptyCodeHeader,
    SyntaxHighlighter: MarkdownMermaidSyntaxHighlighter
  }
};
