import { useEffect, useMemo, useRef, useState } from "react";
import { File, FileImage, FileSpreadsheet, FileText, Presentation } from "lucide-react";

import { apiBase, authHeaders } from "../../../lib/api";
import { usePortalI18n, type PortalMessageKey } from "../i18n";
import type { PortalWorkspaceNode } from "../workspace";

export type OutputType = "document" | "spreadsheet" | "presentation" | "image" | "other";
export type OutputFilter = "all" | OutputType;

const TYPE_ORDER: OutputType[] = ["document", "spreadsheet", "presentation", "image", "other"];
const TYPE_LABEL: Record<OutputFilter, PortalMessageKey> = {
  all: "outputs.typeAll",
  document: "outputs.typeDocument",
  spreadsheet: "outputs.typeSpreadsheet",
  presentation: "outputs.typePresentation",
  image: "outputs.typeImage",
  other: "outputs.typeOther"
};

export function outputTypeOf(node: Pick<PortalWorkspaceNode, "name" | "mime_type">): OutputType {
  const name = node.name.toLowerCase();
  const mime = (node.mime_type || "").toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(name)) return "image";
  if (/\.(xlsx?|xlsm|csv|tsv|ods)$/.test(name)) return "spreadsheet";
  if (/\.(pptx?|odp|key)$/.test(name)) return "presentation";
  if (/\.(pdf|docx?|odt|rtf|md|markdown|txt|html?)$/.test(name) || mime === "application/pdf") return "document";
  return "other";
}

function contentUrl(node: PortalWorkspaceNode, query?: Record<string, string | number>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) params.set(key, String(value));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return `${apiBase()}/api/portal/workspace/files/${encodeURIComponent(node.id)}/content${suffix}`;
}

/** Only start loading a thumbnail once its card scrolls into view. */
function useInView<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || inView) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [inView]);
  return { ref, inView };
}

function SheetThumb({ node }: { node: PortalWorkspaceNode }) {
  const { t } = usePortalI18n();
  const [rows, setRows] = useState<string[][] | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void fetch(contentUrl(node, { preview: "table", row_offset: 0, row_limit: 5, column_offset: 0, column_limit: 5 }), {
      credentials: "include",
      headers: authHeaders()
    })
      .then(async (response) => {
        if (!response.ok || !(response.headers.get("content-type") || "").includes("application/json")) return null;
        const payload = (await response.json()) as { kind?: string; rows?: string[][] };
        return payload.kind === "table" && Array.isArray(payload.rows) ? payload.rows : null;
      })
      .catch(() => null)
      .then((value) => !cancelled && setRows(value));
    return () => {
      cancelled = true;
    };
  }, [node]);
  if (rows === undefined) return <span className="outputs-thumb-placeholder">{t("outputs.previewLoading")}</span>;
  if (!rows?.length) return <FileSpreadsheet size={34} strokeWidth={1.4} aria-hidden="true" />;
  return (
    <table className="outputs-thumb-sheet" aria-hidden="true">
      <tbody>
        {rows.slice(0, 5).map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.slice(0, 5).map((cell, cellIndex) =>
              rowIndex === 0 ? <th key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PdfThumb({ node, convert }: { node: PortalWorkspaceNode; convert: boolean }) {
  const src = `${contentUrl(node, convert ? { preview: "pdf" } : undefined)}#page=1&toolbar=0&navpanes=0&scrollbar=0&view=FitH`;
  return <iframe className="outputs-thumb-pdf" src={src} title={node.name} tabIndex={-1} aria-hidden="true" loading="lazy" />;
}

function Thumb({ node, type }: { node: PortalWorkspaceNode; type: OutputType }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const lower = node.name.toLowerCase();
  let body: JSX.Element;
  if (!inView) body = <span className="outputs-thumb-placeholder" />;
  else if (type === "image") body = <img className="outputs-thumb-image" src={contentUrl(node)} alt="" loading="lazy" />;
  else if (type === "spreadsheet") body = <SheetThumb node={node} />;
  else if (type === "presentation") body = <PdfThumb node={node} convert />;
  else if (lower.endsWith(".pdf")) body = <PdfThumb node={node} convert={false} />;
  else if (/\.(docx?|odt|rtf)$/.test(lower)) body = <PdfThumb node={node} convert />;
  else body = type === "document" ? <FileText size={34} strokeWidth={1.4} aria-hidden="true" /> : <File size={34} strokeWidth={1.4} aria-hidden="true" />;
  return (
    <div ref={ref} className={`outputs-thumb is-${type}`}>
      {body}
    </div>
  );
}

const TYPE_ICON: Record<OutputType, JSX.Element> = {
  document: <FileText size={14} />,
  spreadsheet: <FileSpreadsheet size={14} />,
  presentation: <Presentation size={14} />,
  image: <FileImage size={14} />,
  other: <File size={14} />
};

export function OutputTypeTabs(props: { nodes: PortalWorkspaceNode[]; value: OutputFilter; onChange(next: OutputFilter): void }) {
  const { t } = usePortalI18n();
  const counts = useMemo(() => {
    const result: Record<OutputFilter, number> = { all: 0, document: 0, spreadsheet: 0, presentation: 0, image: 0, other: 0 };
    for (const node of props.nodes) {
      if (node.kind !== "file") continue;
      result.all += 1;
      result[outputTypeOf(node)] += 1;
    }
    return result;
  }, [props.nodes]);
  const filters: OutputFilter[] = ["all", ...TYPE_ORDER.filter((type) => counts[type] > 0)];
  return (
    <div className="outputs-type-tabs" role="tablist" aria-label={t("outputs.typeAll")}>
      {filters.map((filter) => (
        <button
          key={filter}
          type="button"
          role="tab"
          aria-selected={props.value === filter}
          className={props.value === filter ? "is-active" : undefined}
          onClick={() => props.onChange(filter)}
        >
          {filter !== "all" ? TYPE_ICON[filter] : null}
          <span>{t(TYPE_LABEL[filter])}</span>
          <small>{counts[filter]}</small>
        </button>
      ))}
    </div>
  );
}

export function OutputsGallery(props: {
  nodes: PortalWorkspaceNode[];
  filter: OutputFilter;
  formatDate(value: string): string;
  onOpenFile(node: PortalWorkspaceNode): void;
}) {
  const files = useMemo(
    () =>
      props.nodes
        .filter((node) => node.kind === "file")
        .filter((node) => props.filter === "all" || outputTypeOf(node) === props.filter)
        .slice(0, 120),
    [props.filter, props.nodes]
  );
  return (
    <div className="outputs-gallery">
      {files.map((node) => {
        const type = outputTypeOf(node);
        return (
          <button key={node.id} type="button" className="outputs-card" onClick={() => props.onOpenFile(node)} title={node.name}>
            <Thumb node={node} type={type} />
            <span className="outputs-card-copy">
              <strong>{node.name}</strong>
              <small>
                {TYPE_ICON[type]}
                {props.formatDate(node.updated_at)}
              </small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
