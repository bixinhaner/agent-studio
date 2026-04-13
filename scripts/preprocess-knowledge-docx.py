#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import fnmatch
import hashlib
import html
import json
import posixpath
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable
import xml.etree.ElementTree as ET


FORMAT_VERSION = 3
CONVERTER_VERSION = "1.2.0"
DEFAULT_INCLUDE_GLOBS = ["**/*.docx", "*.docx"]
DEFAULT_EXCLUDE_GLOBS = ["**/~$*.docx", "~$*.docx", "**/.~*.docx", ".~*.docx"]
DEFAULT_UNSUPPORTED_ANNOTATION_IMAGE_SUFFIXES = {".emf", ".wmf"}
IMAGE_ANNOTATION_PROMPT_VERSION = "visual-v2"
IMAGE_ANNOTATION_SCHEMA_VERSION = 1
TABLE_IMAGE_ANNOTATION_PLACEHOLDER_PATTERN = re.compile(r"<!-- image-annotation:(\d+) -->")
IMAGE_ANNOTATION_SCHEMA = {
    "type": "object",
    "properties": {
        "image_type": {"type": "string"},
        "summary": {"type": "string"},
        "key_text": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 4,
        },
        "is_decorative": {"type": "boolean"},
    },
    "required": ["image_type", "summary", "key_text", "is_decorative"],
    "additionalProperties": False,
}

GENERIC_TITLES = {
    "introduction",
    "aboutthisdocument",
    "revisionrecord",
    "copyrightnotice",
    "disclaimer",
    "概述",
    "关于本文档",
    "修订记录",
    "版权声明",
    "免责声明",
}

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "v": "urn:schemas-microsoft-com:vml",
    "cp": "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    "dc": "http://purl.org/dc/elements/1.1/",
}
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def qn(prefix: str, local: str) -> str:
    return f"{{{NS[prefix]}}}{local}"


def iso_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_text(value: str) -> str:
    value = value.replace("\u00A0", " ").replace("\u200B", "")
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    return value


def clean_text(value: str) -> str:
    return re.sub(r"[ \t]+", " ", normalize_text(value)).strip()


def normalize_title_key(value: str) -> str:
    lowered = clean_text(value).lower()
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", lowered)


def is_generic_title(value: str) -> bool:
    return normalize_title_key(value) in GENERIC_TITLES


def filename_title(path: Path) -> str:
    return clean_text(path.stem.replace("_", " "))


def detect_docx_container(path: Path) -> tuple[str, str]:
    try:
        with path.open("rb") as handle:
            header = handle.read(16)
    except OSError as exc:
        return "unreadable", str(exc)

    if header.startswith(b"PK\x03\x04") and zipfile.is_zipfile(path):
        return "ooxml", "zip"
    if header.startswith(bytes.fromhex("d0cf11e0a1b11ae1")):
        return "ole", "legacy_ole"
    return "unknown", header.hex()


def looks_like_image_caption(text: str) -> bool:
    candidate = clean_text(text)
    if not candidate or len(candidate) > 160:
        return False
    return bool(
        re.match(
            r"^(图|Figure|FIGURE|Fig\.?|图片|Image)\s*[-\dA-Za-z一二三四五六七八九十（(]",
            candidate,
        )
    )


def markdown_text_metrics(markdown: str) -> tuple[int, int]:
    text = re.sub(r"!\[[^\]]*]\([^)]+\)", " ", markdown)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"^#+\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\[\^([^\]]+)\]:", " ", text)
    text = re.sub(r"\[\^([^\]]+)\]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return len(text), len(text.split()) if text else 0


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def ensure_within_root(root: Path, target: Path) -> None:
    resolved_root = root.resolve()
    resolved_target = target.resolve()
    if resolved_root == resolved_target:
        raise ValueError(f"refusing to operate on root directly: {resolved_root}")
    if not str(resolved_target).startswith(f"{resolved_root}{Path('/')}"):
        raise ValueError(f"path escapes root: {resolved_target}")


def remove_empty_parents(start: Path, stop: Path) -> None:
    current = start
    resolved_stop = stop.resolve()
    while True:
        if current.resolve() == resolved_stop:
            return
        try:
            current.rmdir()
        except OSError:
            return
        current = current.parent


def markdown_image_paths(markdown: str) -> list[str]:
    return re.findall(r"!\[[^\]]*]\(([^)]+)\)", markdown)


def trim_context(value: str, limit: int = 320) -> str:
    value = clean_text(value)
    if len(value) <= limit:
        return value
    return f"{value[: limit - 1].rstrip()}…"


def extract_json_object(text: str) -> dict[str, object]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in reversed(lines):
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("no JSON object found in codex output")


def is_annotation_budget_error(message: str) -> bool:
    lowered = message.lower()
    return any(
        marker in lowered
        for marker in (
            "insufficient_quota",
            "rate limit",
            "rate_limit",
            "quota",
            "context_length_exceeded",
            "maximum context length",
            "token limit",
            "tokens",
        )
    )


@dataclass
class InlineToken:
    kind: str
    value: str
    data: dict[str, object] | None = None


class ImageAnnotationCache:
    def __init__(self, cache_path: Path) -> None:
        self.cache_path = cache_path
        self._lock = threading.Lock()
        self._entries: dict[tuple[str, str, str, int], dict[str, object]] = {}
        self._load()

    def _load(self) -> None:
        if not self.cache_path.exists():
            return
        try:
            lines = self.cache_path.read_text(encoding="utf-8").splitlines()
        except Exception:
            return
        for line in lines:
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            key = self._entry_key(entry)
            if key:
                self._entries[key] = entry

    def _entry_key(self, entry: dict[str, object]) -> tuple[str, str, str, int] | None:
        image_sha256 = entry.get("image_sha256")
        model = entry.get("model")
        prompt_version = entry.get("prompt_version")
        schema_version = entry.get("schema_version")
        if not (
            isinstance(image_sha256, str)
            and isinstance(model, str)
            and isinstance(prompt_version, str)
            and isinstance(schema_version, int)
        ):
            return None
        return (image_sha256, model, prompt_version, schema_version)

    def get(self, image_sha256: str, model: str, prompt_version: str, schema_version: int) -> dict[str, object] | None:
        key = (image_sha256, model, prompt_version, schema_version)
        with self._lock:
            entry = self._entries.get(key)
            if not entry:
                return None
            return copy.deepcopy(entry.get("annotation")) if isinstance(entry.get("annotation"), dict) else None

    def put(
        self,
        *,
        image_sha256: str,
        model: str,
        prompt_version: str,
        schema_version: int,
        annotation: dict[str, object],
    ) -> None:
        key = (image_sha256, model, prompt_version, schema_version)
        payload = {
            "cached_at": iso_now(),
            "image_sha256": image_sha256,
            "model": model,
            "prompt_version": prompt_version,
            "schema_version": schema_version,
            "annotation": annotation,
        }
        line = json.dumps(payload, ensure_ascii=False)
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            if key in self._entries:
                return
            self._entries[key] = payload
            with self.cache_path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")


@dataclass(frozen=True)
class ImageAnnotationConfig:
    enabled: bool
    model: str = "gpt-5.4-mini"
    command: str = "codex"
    timeout_seconds: int = 180
    limit_per_doc: int | None = None
    fail_on_error: bool = False
    unsupported_suffixes: frozenset[str] = frozenset(DEFAULT_UNSUPPORTED_ANNOTATION_IMAGE_SUFFIXES)


@dataclass
class DocumentTask:
    source_root: Path
    source_path: Path
    output_root: Path
    force: bool
    image_annotation: ImageAnnotationConfig
    image_annotation_cache: ImageAnnotationCache | None = None


class CodexImageAnnotator:
    def __init__(self, config: ImageAnnotationConfig, workspace_root: Path) -> None:
        self.config = config
        self.workspace_root = workspace_root
        self.schema_path = self._write_schema()

    def _write_schema(self) -> Path:
        temp_dir = Path(tempfile.mkdtemp(prefix="docx-image-annotation-schema-"))
        schema_path = temp_dir / "schema.json"
        schema_path.write_text(json.dumps(IMAGE_ANNOTATION_SCHEMA, ensure_ascii=False, indent=2), encoding="utf-8")
        return schema_path

    def annotate(
        self,
        image_path: Path,
        *,
        image_sha256: str,
        document_title: str,
        document_path: str,
        heading_context: list[str],
        caption: str,
        previous_text: str,
        next_text: str,
        alt_text: str,
        annotation_cache: ImageAnnotationCache | None = None,
    ) -> dict[str, object]:
        if annotation_cache is not None:
            cached = annotation_cache.get(
                image_sha256=image_sha256,
                model=self.config.model,
                prompt_version=IMAGE_ANNOTATION_PROMPT_VERSION,
                schema_version=IMAGE_ANNOTATION_SCHEMA_VERSION,
            )
            if cached:
                cached["cache_hit"] = True
                return cached
        prompt = self._build_prompt(
            document_title=document_title,
            document_path=document_path,
            heading_context=heading_context,
            caption=caption,
            previous_text=previous_text,
            next_text=next_text,
            alt_text=alt_text,
        )
        command = [
            self.config.command,
            "exec",
            "--ephemeral",
            "-m",
            self.config.model,
            "-C",
            str(self.workspace_root),
            "--output-schema",
            str(self.schema_path),
            "-i",
            str(image_path),
            "-",
        ]
        completed = subprocess.run(
            command,
            input=prompt,
            text=True,
            capture_output=True,
            timeout=self.config.timeout_seconds,
            check=False,
        )
        if completed.returncode != 0:
            stderr = clean_text(completed.stderr or completed.stdout or "codex exec failed")
            raise RuntimeError(stderr)
        parsed = extract_json_object(completed.stdout)
        summary = clean_text(str(parsed.get("summary") or ""))
        image_type = clean_text(str(parsed.get("image_type") or "unknown"))
        key_text = [
            clean_text(str(item))
            for item in parsed.get("key_text") or []
            if clean_text(str(item))
        ]
        key_text = key_text[:4]
        is_decorative = bool(parsed.get("is_decorative"))
        return {
            "model": self.config.model,
            "image_type": image_type or "unknown",
            "summary": summary,
            "key_text": key_text,
            "is_decorative": is_decorative,
            "prompt_version": IMAGE_ANNOTATION_PROMPT_VERSION,
            "schema_version": IMAGE_ANNOTATION_SCHEMA_VERSION,
            "cache_hit": False,
            "generated_at": iso_now(),
        }

    def _build_prompt(
        self,
        *,
        document_title: str,
        document_path: str,
        heading_context: list[str],
        caption: str,
        previous_text: str,
        next_text: str,
        alt_text: str,
    ) -> str:
        heading_lines = "\n".join(f"- {heading}" for heading in heading_context if heading) or "- (none)"
        parts = [
            "你在为企业知识库里的文档图片生成检索友好的简短注解。",
            "只根据图片和提供的文档上下文输出 JSON，不要输出额外解释。",
            "",
            "要求：",
            "- summary: 1 句中文摘要，优先描述图片本身展示的页面、拓扑、设备、流程或表格内容；仅在需要消歧时少量利用文档上下文。",
            "- key_text: 最多 4 条图片中肉眼可见、对检索最有价值的文字或字段；没有就返回空数组。",
            "- image_type: 用简短英文 snake_case，例如 ui_screenshot、topology_diagram、device_photo、flowchart、alarm_screenshot、table_screenshot、decorative。",
            "- is_decorative: 仅当图片主要是 logo、装饰、封面背景、分隔图或重复性极高且不增加技术信息时设为 true。",
            "- 不要编造图片中看不清的文字。",
            "- 如果上下文已经给出图注或章节信息，可以利用它帮助判断图片对象，但不要把摘要写成强依赖某篇文档步骤的描述。",
            "",
            f"文档标题: {document_title}",
            f"文档路径: {document_path}",
            f"图片 alt_text: {alt_text or '(none)'}",
            f"图片图注: {caption or '(none)'}",
            "当前图片所在标题路径:",
            heading_lines,
            f"图片前文: {previous_text or '(none)'}",
            f"图片后文: {next_text or '(none)'}",
        ]
        return "\n".join(parts)


class DocxMarkdownConverter:
    def __init__(self, source_root: Path, docx_path: Path, output_dir: Path) -> None:
        self.source_root = source_root
        self.docx_path = docx_path
        self.output_dir = output_dir
        self.media_dir = output_dir / "media"
        self.relative_path = docx_path.relative_to(source_root)
        self.warnings: list[str] = []
        self.stats = {
            "paragraphs": 0,
            "tables": 0,
            "images": 0,
            "lists": 0,
            "quotes": 0,
            "headings": 0,
            "textboxes": 0,
            "captions": 0,
            "table_rowspans": 0,
            "table_colspans": 0,
        }
        self.style_names: dict[str, str] = {}
        self.relationships: dict[str, str] = {}
        self.external_links: dict[str, str] = {}
        self.image_targets: dict[str, str] = {}
        self.image_alt_text: dict[str, str] = {}
        self.image_hashes: dict[str, str] = {}
        self.image_occurrences: list[dict[str, object]] = []
        self.image_occurrence_by_sequence: dict[int, dict[str, object]] = {}
        self.image_counter = 0
        self.image_sequence_counter = 0
        self.core_properties: dict[str, str] = {}
        self.heading_index: list[dict[str, object]] = []
        self.external_link_index: list[dict[str, str]] = []
        self.header_texts: list[str] = []
        self.footer_texts: list[str] = []
        self.footnote_map: dict[str, str] = {}
        self.endnote_map: dict[str, str] = {}
        self.referenced_footnote_ids: list[str] = []
        self.referenced_endnote_ids: list[str] = []
        self._seen_footnote_ids: set[str] = set()
        self._seen_endnote_ids: set[str] = set()
        self.pending_image_sequences: list[int] = []
        self.image_block_sequences: list[int] = []
        self.detected_content_title = ""
        self.rendered_blocks: list[str] = []
        self.rendered_markdown = ""
        self.feature_flags = {
            "has_headers": False,
            "has_footers": False,
            "has_footnotes": False,
            "has_endnotes": False,
            "contains_textboxes": False,
            "contains_comments": False,
            "contains_complex_tables": False,
            "contains_image_annotations": False,
        }

    def convert(self) -> dict[str, object]:
        if self.output_dir.exists():
            shutil.rmtree(self.output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.media_dir.mkdir(parents=True, exist_ok=True)
        source_stat = self.docx_path.stat()
        source_sha256 = sha256_file(self.docx_path)
        markdown = self._convert_docx()
        doc_path = self.output_dir / "doc.md"
        meta_path = self.output_dir / "meta.json"
        doc_path.write_text(markdown, encoding="utf-8")

        title_info = self._build_title_metadata(markdown)
        text_chars, word_count = markdown_text_metrics(markdown)
        self.stats["text_chars"] = text_chars
        self.stats["word_count_approx"] = word_count
        metadata = {
            "format_version": FORMAT_VERSION,
            "converter_version": CONVERTER_VERSION,
            "generated_at": iso_now(),
            "source_name": self.docx_path.name,
            "source_relative_path": self.relative_path.as_posix(),
            "source_sha256": source_sha256,
            "source_size_bytes": source_stat.st_size,
            "source_mtime_ns": source_stat.st_mtime_ns,
            "output_dir": str(self.output_dir),
            "title": title_info["title"],
            "title_resolution": title_info,
            "core_properties": self.core_properties,
            "stats": self.stats,
            "headings": self.heading_index,
            "external_links": self.external_link_index,
            "headers": self.header_texts,
            "footers": self.footer_texts,
            "footnotes": [{"id": key, "text": value} for key, value in self.footnote_map.items()],
            "endnotes": [{"id": key, "text": value} for key, value in self.endnote_map.items()],
            "feature_flags": self.feature_flags,
            "images": self.image_occurrences,
            "warnings": self.warnings,
        }
        meta_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        return metadata

    def _convert_docx(self) -> str:
        with zipfile.ZipFile(self.docx_path) as archive:
            self._load_styles(archive)
            self._load_relationships(archive)
            self._load_core_properties(archive)
            self._load_supporting_parts(archive)
            document_xml = archive.read("word/document.xml")
            self.feature_flags["contains_comments"] = "word/comments.xml" in archive.namelist()
            body = ET.fromstring(document_xml).find("w:body", NS)
            if body is None:
                raise ValueError(f"document body not found: {self.docx_path}")

            blocks = self._render_block_children(body, archive)

            self.detected_content_title = self._resolve_title_from_blocks(blocks)
            title = filename_title(self.docx_path)
            self._ensure_title_heading(blocks, title)
            self._seed_heading_index(title)
            self._append_referenced_notes(blocks)

            markdown = "\n\n".join(block.rstrip() for block in blocks if block and block.strip())
            markdown = re.sub(r"\n{3,}", "\n\n", markdown).strip() + "\n"
            self.rendered_blocks = list(blocks)
            self.rendered_markdown = markdown
            return markdown

    def _render_block_children(self, node: ET.Element, archive: zipfile.ZipFile) -> list[str]:
        blocks: list[str] = []
        for child in list(node):
            if child.tag == qn("w", "p"):
                rendered = self._render_paragraph(child, archive)
                if rendered:
                    blocks.extend(rendered)
            elif child.tag == qn("w", "tbl"):
                blocks.append(self._render_table(child, archive))
            elif list(child):
                blocks.extend(self._render_block_children(child, archive))
        return blocks

    def _load_styles(self, archive: zipfile.ZipFile) -> None:
        if "word/styles.xml" not in archive.namelist():
            return
        root = ET.fromstring(archive.read("word/styles.xml"))
        for style in root.findall("w:style", NS):
            style_id = style.get(qn("w", "styleId")) or ""
            name = style.find("w:name", NS)
            if style_id:
                self.style_names[style_id] = name.get(qn("w", "val")) if name is not None else style_id

    def _load_relationships(self, archive: zipfile.ZipFile) -> None:
        rels_name = "word/_rels/document.xml.rels"
        if rels_name not in archive.namelist():
            return
        root = ET.fromstring(archive.read(rels_name))
        for rel in root:
            rel_id = rel.get("Id") or ""
            target = rel.get("Target") or ""
            rel_type = rel.get("Type") or ""
            if not rel_id or not target:
                continue
            if rel_type.endswith("/hyperlink"):
                self.external_links[rel_id] = target
            else:
                self.relationships[rel_id] = target

    def _load_core_properties(self, archive: zipfile.ZipFile) -> None:
        core_name = "docProps/core.xml"
        if core_name not in archive.namelist():
            return
        root = ET.fromstring(archive.read(core_name))
        for key in ("title", "subject", "creator", "description"):
            node = root.find(f"dc:{key}", NS) or root.find(f"cp:{key}", NS)
            if node is not None and node.text:
                self.core_properties[key] = clean_text(node.text)

    def _load_supporting_parts(self, archive: zipfile.ZipFile) -> None:
        names = archive.namelist()
        header_names = sorted(name for name in names if re.match(r"word/header\d+\.xml$", name))
        footer_names = sorted(name for name in names if re.match(r"word/footer\d+\.xml$", name))
        footnote_name = "word/footnotes.xml"
        endnote_name = "word/endnotes.xml"

        self.feature_flags["has_headers"] = bool(header_names)
        self.feature_flags["has_footers"] = bool(footer_names)
        self.feature_flags["has_footnotes"] = footnote_name in names
        self.feature_flags["has_endnotes"] = endnote_name in names

        for header_name in header_names:
            text = self._extract_plain_text_from_part(archive.read(header_name))
            if text:
                self.header_texts.append(text)

        for footer_name in footer_names:
            text = self._extract_plain_text_from_part(archive.read(footer_name))
            if text:
                self.footer_texts.append(text)

        if footnote_name in names:
            self.footnote_map = self._extract_notes(archive.read(footnote_name))
        if endnote_name in names:
            self.endnote_map = self._extract_notes(archive.read(endnote_name))

    def _extract_plain_text_from_part(self, xml_bytes: bytes) -> str:
        root = ET.fromstring(xml_bytes)
        lines: list[str] = []
        for paragraph in root.findall(".//w:p", NS):
            text = clean_text("".join(node.text or "" for node in paragraph.findall(".//w:t", NS)))
            if text:
                lines.append(text)
        return "\n".join(lines)

    def _extract_notes(self, xml_bytes: bytes) -> dict[str, str]:
        root = ET.fromstring(xml_bytes)
        notes: dict[str, str] = {}
        for note in root:
            note_id = note.get(qn("w", "id")) or ""
            note_type = note.get(qn("w", "type"), "")
            if note_type in {"separator", "continuationSeparator", "continuationNotice"}:
                continue
            text = self._extract_plain_text_from_part(ET.tostring(note, encoding="utf-8"))
            if note_id and text:
                notes[note_id] = text
        return notes

    def _resolve_title_from_blocks(self, blocks: list[str]) -> str:
        for block in blocks:
            stripped = block.strip()
            if not stripped:
                continue
            if stripped.startswith("# "):
                return stripped[2:].strip()
            if not stripped.startswith("!"):
                first_line = stripped.splitlines()[0].strip()
                if first_line:
                    return re.sub(r"^#+\s*", "", first_line).strip()
        return filename_title(self.docx_path)

    def _build_title_metadata(self, markdown: str) -> dict[str, str | bool]:
        content_title = self.detected_content_title
        core_title = clean_text(self.core_properties.get("title", ""))
        chosen_title = filename_title(self.docx_path)
        return {
            "title": chosen_title,
            "source": "filename",
            "filename_title": chosen_title,
            "content_title": content_title,
            "content_title_is_generic": bool(content_title and is_generic_title(content_title)),
            "core_title": core_title,
            "core_title_is_generic": bool(core_title and is_generic_title(core_title)),
        }

    def _ensure_title_heading(self, blocks: list[str], title: str) -> None:
        if not blocks:
            blocks.append(f"# {title}")
            return
        first_non_empty_index = None
        for index, block in enumerate(blocks):
            if block and block.strip():
                first_non_empty_index = index
                break
        if first_non_empty_index is None:
            blocks.insert(0, f"# {title}")
            return
        first_block = blocks[first_non_empty_index].strip()
        if first_block.startswith("# "):
            return
        if clean_text(first_block.splitlines()[0]) == clean_text(title):
            blocks.insert(first_non_empty_index, f"# {title}")
            if first_non_empty_index + 1 < len(blocks):
                next_block = blocks[first_non_empty_index + 1].strip()
                if clean_text(next_block.splitlines()[0] if next_block else "") == clean_text(title):
                    del blocks[first_non_empty_index + 1]
        else:
            blocks.insert(first_non_empty_index, f"# {title}")

    def _seed_heading_index(self, title: str) -> None:
        if self.heading_index and clean_text(self.heading_index[0]["text"]) == clean_text(title):
            return
        self.stats["headings"] += 1
        self.heading_index.insert(0, {"level": 1, "text": title})

    def _append_referenced_notes(self, blocks: list[str]) -> None:
        if self.referenced_footnote_ids:
            blocks.append("## Footnotes")
            for note_id in self.referenced_footnote_ids:
                text = self.footnote_map.get(note_id)
                if text:
                    blocks.append(self._format_note_definition(f"fn-{note_id}", text))
        if self.referenced_endnote_ids:
            blocks.append("## Endnotes")
            for note_id in self.referenced_endnote_ids:
                text = self.endnote_map.get(note_id)
                if text:
                    blocks.append(self._format_note_definition(f"en-{note_id}", text))

    def _format_note_definition(self, label: str, text: str) -> str:
        lines = [clean_text(line) for line in normalize_text(text).splitlines() if clean_text(line)]
        if not lines:
            return f"[^{label}]:"
        first, *rest = lines
        formatted = [f"[^{label}]: {first}"]
        formatted.extend(f"    {line}" for line in rest)
        return "\n".join(formatted)

    def _paragraph_style(self, paragraph: ET.Element) -> tuple[str | None, str | None]:
        ppr = paragraph.find("w:pPr", NS)
        if ppr is None:
            return None, None
        pstyle = ppr.find("w:pStyle", NS)
        if pstyle is None:
            return None, None
        style_id = pstyle.get(qn("w", "val"))
        if not style_id:
            return None, None
        return style_id, self.style_names.get(style_id, style_id)

    def _heading_level(self, style_id: str | None, style_name: str | None) -> int | None:
        for candidate in (style_name or "", style_id or ""):
            match = re.search(r"heading\s*([1-9])", candidate, re.IGNORECASE)
            if match:
                return int(match.group(1))
        return None

    def _is_quote_style(self, style_name: str | None) -> bool:
        if not style_name:
            return False
        lowered = style_name.lower()
        return "quote" in lowered or "引用" in style_name

    def _list_prefix(self, paragraph: ET.Element) -> str | None:
        ppr = paragraph.find("w:pPr", NS)
        if ppr is None:
            return None
        num_pr = ppr.find("w:numPr", NS)
        if num_pr is None:
            return None
        ilvl = num_pr.find("w:ilvl", NS)
        level = int(ilvl.get(qn("w", "val"), "0")) if ilvl is not None else 0
        self.stats["lists"] += 1
        return f"{'  ' * level}- "

    def _render_paragraph(self, paragraph: ET.Element, archive: zipfile.ZipFile) -> list[str]:
        self.stats["paragraphs"] += 1
        style_id, style_name = self._paragraph_style(paragraph)
        heading_level = self._heading_level(style_id, style_name)
        quote_style = self._is_quote_style(style_name)
        list_prefix = self._list_prefix(paragraph)
        tokens = self._extract_inline_tokens(paragraph, archive)
        if not tokens:
            return []
        segments = self._tokens_to_segments(tokens)
        if not segments:
            return []

        outputs: list[str] = []
        for index, segment in enumerate(segments):
            if segment.kind == "image":
                outputs.append(segment.value)
                sequence = int(segment.data.get("sequence", 0)) if segment.data else 0
                if sequence:
                    self._mark_occurrence_container(sequence, "paragraph_block")
                    self.pending_image_sequences.append(sequence)
                    self.image_block_sequences.append(sequence)
                continue

            text = segment.value.strip()
            if not text:
                continue
            is_caption = looks_like_image_caption(text)
            if is_caption and self.pending_image_sequences:
                self._assign_caption_to_pending_image(text)
                self.stats["captions"] += 1
            elif self.pending_image_sequences:
                self.pending_image_sequences.clear()
            if heading_level and index == 0 and len(segments) == 1:
                self.stats["headings"] += 1
                self.heading_index.append({"level": min(heading_level, 6), "text": text})
                outputs.append(f"{'#' * min(heading_level, 6)} {text}")
            elif quote_style:
                self.stats["quotes"] += 1
                outputs.append("\n".join(f"> {line}" if line else ">" for line in text.splitlines()))
            elif list_prefix and index == 0:
                lines = text.splitlines() or [text]
                first = f"{list_prefix}{lines[0]}"
                rest = [f"{' ' * len(list_prefix)}{line}" if line else "" for line in lines[1:]]
                outputs.append("\n".join([first, *rest]).rstrip())
            else:
                outputs.append(text)
        return outputs

    def _extract_inline_tokens(self, node: ET.Element, archive: zipfile.ZipFile) -> list[InlineToken]:
        tokens: list[InlineToken] = []
        self._append_node_tokens(node, tokens, archive)
        compact: list[InlineToken] = []
        for token in tokens:
            if token.kind == "text":
                if compact and compact[-1].kind == "text":
                    compact[-1].value += token.value
                else:
                    compact.append(token)
            else:
                compact.append(token)
        return compact

    def _append_node_tokens(self, node: ET.Element, tokens: list[InlineToken], archive: zipfile.ZipFile) -> None:
        for child in list(node):
            if child.tag == qn("w", "hyperlink"):
                rel_id = child.get(qn("r", "id"))
                inner_tokens: list[InlineToken] = []
                self._append_node_tokens(child, inner_tokens, archive)
                if rel_id and rel_id in self.external_links and inner_tokens and all(token.kind == "text" for token in inner_tokens):
                    link_text = clean_text("".join(token.value for token in inner_tokens))
                    link_url = self.external_links[rel_id]
                    if link_text:
                        self.external_link_index.append({"text": link_text, "url": link_url})
                        tokens.append(InlineToken("text", f"[{link_text}]({link_url})"))
                    else:
                        tokens.append(InlineToken("text", link_url))
                else:
                    tokens.extend(inner_tokens)
                continue

            if child.tag in {qn("w", "r"), qn("w", "smartTag"), qn("w", "sdt"), qn("w", "ins")}:
                self._append_node_tokens(child, tokens, archive)
                continue

            if child.tag == qn("w", "t"):
                if child.text:
                    tokens.append(InlineToken("text", normalize_text(child.text)))
                continue

            if child.tag == qn("w", "tab"):
                tokens.append(InlineToken("text", "\t"))
                continue

            if child.tag in {qn("w", "br"), qn("w", "cr")}:
                br_type = child.get(qn("w", "type"), "")
                tokens.append(InlineToken("text", "\n---\n" if br_type == "page" else "\n"))
                continue

            if child.tag == qn("w", "footnoteReference"):
                note_id = child.get(qn("w", "id"))
                if note_id and note_id in self.footnote_map:
                    if note_id not in self._seen_footnote_ids:
                        self._seen_footnote_ids.add(note_id)
                        self.referenced_footnote_ids.append(note_id)
                    tokens.append(InlineToken("text", f"[^{f'fn-{note_id}'}]"))
                continue

            if child.tag == qn("w", "endnoteReference"):
                note_id = child.get(qn("w", "id"))
                if note_id and note_id in self.endnote_map:
                    if note_id not in self._seen_endnote_ids:
                        self._seen_endnote_ids.add(note_id)
                        self.referenced_endnote_ids.append(note_id)
                    tokens.append(InlineToken("text", f"[^{f'en-{note_id}'}]"))
                continue

            if child.tag in {qn("w", "drawing"), qn("w", "pict")}:
                tokens.extend(self._extract_embedded_tokens_from_node(child, archive))
                continue

            self._append_node_tokens(child, tokens, archive)

    def _extract_embedded_tokens_from_node(self, node: ET.Element, archive: zipfile.ZipFile) -> list[InlineToken]:
        tokens: list[InlineToken] = []
        alt_text = ""

        for doc_pr in node.findall(".//wp:docPr", NS):
            alt_text = clean_text(doc_pr.get("descr") or doc_pr.get("title") or doc_pr.get("name") or "")
            if alt_text:
                break

        def visit(current: ET.Element) -> None:
            if current.tag == qn("w", "txbxContent"):
                blocks = self._render_textbox_content(current, archive)
                for block in blocks:
                    tokens.append(InlineToken("text", f"\n{block}\n"))
                return

            if current.tag == qn("a", "blip"):
                rel_id = current.get(qn("r", "embed")) or current.get(qn("r", "link"))
                if rel_id:
                    target = self.relationships.get(rel_id)
                    if not target:
                        self.warnings.append(f"missing relationship for image relId={rel_id} in {self.docx_path.name}")
                    else:
                        occurrence = self._extract_image_target(target, archive, alt_text)
                        if occurrence:
                            markdown_path = str(occurrence["output_path"])
                            tokens.append(
                                InlineToken(
                                    "image",
                                    f"![{alt_text or Path(markdown_path).stem}]({markdown_path})",
                                    {"sequence": occurrence["sequence"]},
                                )
                            )
                return

            if current.tag == qn("v", "imagedata"):
                rel_id = current.get(qn("r", "id"))
                if rel_id:
                    target = self.relationships.get(rel_id)
                    if not target:
                        self.warnings.append(f"missing relationship for image relId={rel_id} in {self.docx_path.name}")
                    else:
                        occurrence = self._extract_image_target(target, archive, alt_text)
                        if occurrence:
                            markdown_path = str(occurrence["output_path"])
                            tokens.append(
                                InlineToken(
                                    "image",
                                    f"![{alt_text or Path(markdown_path).stem}]({markdown_path})",
                                    {"sequence": occurrence["sequence"]},
                                )
                            )
                return

            for child in list(current):
                visit(child)

        visit(node)
        return tokens

    def _render_textbox_content(self, textbox: ET.Element, archive: zipfile.ZipFile) -> list[str]:
        blocks: list[str] = []
        for child in list(textbox):
            if child.tag == qn("w", "p"):
                rendered = self._render_paragraph(child, archive)
                if rendered:
                    blocks.extend(rendered)
            elif child.tag == qn("w", "tbl"):
                blocks.append(self._render_table(child, archive))
        if blocks:
            self.feature_flags["contains_textboxes"] = True
            self.stats["textboxes"] += 1
        return blocks

    def _extract_image_target(self, target: str, archive: zipfile.ZipFile, alt_text: str) -> dict[str, object] | None:
        normalized_target = posixpath.normpath(posixpath.join("word", target.replace("\\", "/")))
        if normalized_target.upper().endswith("NULL"):
            return None
        if normalized_target not in archive.namelist():
            self.warnings.append(f"image target not found: {normalized_target}")
            return None

        if normalized_target not in self.image_targets:
            self.image_counter += 1
            source_name = Path(normalized_target).name
            output_name = f"{self.image_counter:04d}-{source_name}"
            output_path = self.media_dir / output_name
            with archive.open(normalized_target) as src, output_path.open("wb") as dst:
                shutil.copyfileobj(src, dst)
            self.image_targets[normalized_target] = f"./media/{output_name}"
            self.image_alt_text[normalized_target] = alt_text
            self.image_hashes[normalized_target] = sha256_file(output_path)
            self.stats["images"] += 1
        elif alt_text and not self.image_alt_text.get(normalized_target):
            self.image_alt_text[normalized_target] = alt_text

        self.image_sequence_counter += 1
        occurrence = {
            "sequence": self.image_sequence_counter,
            "source_target": normalized_target,
            "output_path": self.image_targets[normalized_target],
            "alt_text": self.image_alt_text.get(normalized_target, alt_text),
            "content_sha256": self.image_hashes.get(normalized_target),
            "file_suffix": Path(str(self.image_targets[normalized_target])).suffix.lower(),
            "container": "unknown",
        }
        self.image_occurrences.append(occurrence)
        self.image_occurrence_by_sequence[self.image_sequence_counter] = occurrence
        return occurrence

    def _mark_occurrence_container(self, sequence: int, container: str) -> None:
        occurrence = self.image_occurrence_by_sequence.get(sequence)
        if occurrence is not None:
            occurrence["container"] = container

    def _assign_caption_to_pending_image(self, caption: str) -> None:
        if not self.pending_image_sequences:
            return
        sequence = self.pending_image_sequences[-1]
        for occurrence in self.image_occurrences:
            if occurrence["sequence"] == sequence:
                occurrence["caption"] = caption
                alt_text = clean_text(str(occurrence.get("alt_text") or ""))
                if not alt_text or re.fullmatch(r"(图片|image)\s*\d+", alt_text, flags=re.IGNORECASE):
                    occurrence["alt_text"] = caption
                break
        self.pending_image_sequences.clear()

    def _tokens_to_segments(self, tokens: list[InlineToken]) -> list[InlineToken]:
        segments: list[InlineToken] = []
        text_buffer: list[str] = []

        def flush_text() -> None:
            if not text_buffer:
                return
            text = "".join(text_buffer)
            text = re.sub(r"[ \t]+\n", "\n", text)
            text = re.sub(r"\n{3,}", "\n\n", text)
            text = text.strip()
            if text:
                segments.append(InlineToken("text", text))
            text_buffer.clear()

        for token in tokens:
            if token.kind == "text":
                text_buffer.append(token.value)
            else:
                flush_text()
                segments.append(token)
        flush_text()
        return segments

    def _render_table(self, table: ET.Element, archive: zipfile.ZipFile) -> str:
        self.stats["tables"] += 1
        rows: list[list[dict[str, object]]] = []
        for row in table.findall("w:tr", NS):
            parsed_row: list[dict[str, object]] = []
            column = 0
            for cell in row.findall("w:tc", NS):
                attrs, colspan, vmerge = self._table_cell_attrs(cell)
                parsed_row.append(
                    {
                        "attrs": attrs,
                        "colspan": colspan,
                        "vmerge": vmerge,
                        "start_col": column,
                        "rowspan": 1,
                        "skip": False,
                        "content": self._render_table_cell(cell, archive),
                    }
                )
                column += colspan
            rows.append(parsed_row)

        open_merges: dict[int, dict[str, object]] = {}
        for row in rows:
            for cell in row:
                start_col = int(cell["start_col"])
                colspan = int(cell["colspan"])
                vmerge = cell["vmerge"]
                if vmerge == "continue":
                    source = open_merges.get(start_col)
                    if source and int(source["colspan"]) == colspan:
                        source["rowspan"] = int(source["rowspan"]) + 1
                        cell["skip"] = True
                        self.stats["table_rowspans"] += 1
                        for offset in range(colspan):
                            open_merges[start_col + offset] = source
                    else:
                        for offset in range(colspan):
                            open_merges[start_col + offset] = cell
                    continue

                for offset in range(colspan):
                    open_merges.pop(start_col + offset, None)
                if vmerge == "restart":
                    for offset in range(colspan):
                        open_merges[start_col + offset] = cell

        html_rows: list[str] = ["<table>"]
        for row in rows:
            html_rows.append("  <tr>")
            for cell in row:
                if cell["skip"]:
                    continue
                attrs = dict(cell["attrs"])
                if int(cell["rowspan"]) > 1:
                    attrs["rowspan"] = str(cell["rowspan"])
                attr_string = "".join(f' {key}="{value}"' for key, value in attrs.items())
                html_rows.append(f"    <td{attr_string}>{cell['content']}</td>")
            html_rows.append("  </tr>")
        html_rows.append("</table>")
        return "\n".join(html_rows)

    def _table_cell_attrs(self, cell: ET.Element) -> tuple[dict[str, str], int, str | None]:
        attrs: dict[str, str] = {}
        tc_pr = cell.find("w:tcPr", NS)
        if tc_pr is None:
            return attrs, 1, None
        colspan = 1
        grid_span = tc_pr.find("w:gridSpan", NS)
        if grid_span is not None:
            value = grid_span.get(qn("w", "val"))
            if value and value != "1":
                attrs["colspan"] = value
                colspan = int(value)
                self.feature_flags["contains_complex_tables"] = True
                self.stats["table_colspans"] += 1
        v_merge = tc_pr.find("w:vMerge", NS)
        merge_value = None
        if v_merge is not None:
            self.feature_flags["contains_complex_tables"] = True
            merge_value = v_merge.get(qn("w", "val"), "continue")
        return attrs, colspan, merge_value

    def _render_table_cell(self, cell: ET.Element, archive: zipfile.ZipFile) -> str:
        fragments: list[str] = []
        for child in list(cell):
            if child.tag == qn("w", "p"):
                tokens = self._extract_inline_tokens(child, archive)
                parts: list[str] = []
                for segment in self._tokens_to_segments(tokens):
                    if segment.kind == "text":
                        parts.append(segment.value.replace("\n", "<br/>"))
                    else:
                        parts.append(segment.value)
                        sequence = int(segment.data.get("sequence", 0)) if segment.data else 0
                        if sequence:
                            self._mark_occurrence_container(sequence, "table_cell")
                            parts.append(f"<!-- image-annotation:{sequence} -->")
                text = "<br/>".join(part for part in parts if part)
                text = re.sub(r"^(?:<br/>)+", "", text)
                text = re.sub(r"(?:<br/>)+$", "", text)
                if text:
                    fragments.append(text)
            elif child.tag == qn("w", "tbl"):
                fragments.append(self._render_table(child, archive))
        return "<br/>".join(fragment for fragment in fragments if fragment) or "&nbsp;"


def is_image_block(block: str) -> bool:
    return bool(re.fullmatch(r"!\[[^\]]*]\([^)]+\)", block.strip()))


def heading_context_for_block(blocks: list[str], index: int, limit: int = 3) -> list[str]:
    headings: list[str] = []
    for cursor in range(index - 1, -1, -1):
        block = blocks[cursor].strip()
        match = re.match(r"^(#{1,6})\s+(.+)$", block)
        if not match:
            continue
        heading_text = clean_text(match.group(2))
        if heading_text and heading_text not in headings:
            headings.append(heading_text)
        if len(headings) >= limit:
            break
    headings.reverse()
    return headings


def nearest_text_block(blocks: list[str], index: int, step: int) -> str:
    cursor = index + step
    while 0 <= cursor < len(blocks):
        candidate = blocks[cursor].strip()
        if candidate and not is_image_block(candidate):
            return trim_context(candidate)
        cursor += step
    return ""


def annotation_markdown_block(annotation: dict[str, object]) -> str:
    summary = clean_text(str(annotation.get("summary") or ""))
    if not summary:
        return ""
    lines = [f"> 图像注解：{summary}"]
    key_text = [clean_text(str(item)) for item in annotation.get("key_text") or [] if clean_text(str(item))]
    if key_text:
        lines.append(f"> 图中文字：{'；'.join(key_text)}")
    return "\n".join(lines)


def annotation_html_block(annotation: dict[str, object]) -> str:
    summary = clean_text(str(annotation.get("summary") or ""))
    if not summary:
        return ""
    parts = [
        f'<div class="image-annotation"><strong>图像注解：</strong>{html.escape(summary)}</div>'
    ]
    key_text = [clean_text(str(item)) for item in annotation.get("key_text") or [] if clean_text(str(item))]
    if key_text:
        parts.append(
            f'<div class="image-annotation-text"><strong>图中文字：</strong>{html.escape("；".join(key_text))}</div>'
        )
    return "".join(parts)


def strip_markup_to_text(block: str) -> str:
    text = re.sub(r"!\[[^\]]*]\([^)]+\)", " ", block)
    text = TABLE_IMAGE_ANNOTATION_PLACEHOLDER_PATTERN.sub(" ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return trim_context(text)


def build_image_contexts(
    blocks: list[str],
    image_block_sequences: list[int],
    sequence_to_occurrence: dict[int, dict[str, object]],
) -> dict[int, dict[str, object]]:
    contexts: dict[int, dict[str, object]] = {}
    block_sequences = iter(image_block_sequences)
    next_block_sequence = next(block_sequences, None)

    for index, block in enumerate(blocks):
        stripped = block.strip()
        if is_image_block(stripped) and next_block_sequence is not None:
            contexts[next_block_sequence] = {
                "heading_context": heading_context_for_block(blocks, index),
                "previous_text": nearest_text_block(blocks, index, -1),
                "next_text": nearest_text_block(blocks, index, 1),
                "local_context_text": "",
                "container": "paragraph_block",
            }
            next_block_sequence = next(block_sequences, None)
            continue

        table_sequences = [int(match) for match in TABLE_IMAGE_ANNOTATION_PLACEHOLDER_PATTERN.findall(block)]
        if not table_sequences:
            continue
        table_text = strip_markup_to_text(block)
        for sequence in table_sequences:
            occurrence = sequence_to_occurrence.get(sequence) or {}
            contexts.setdefault(
                sequence,
                {
                    "heading_context": heading_context_for_block(blocks, index),
                    "previous_text": nearest_text_block(blocks, index, -1),
                    "next_text": nearest_text_block(blocks, index, 1),
                    "local_context_text": table_text,
                    "container": str(occurrence.get("container") or "table_cell"),
                },
            )
    return contexts


def replace_table_image_annotation_placeholders(
    markdown: str,
    sequence_to_occurrence: dict[int, dict[str, object]],
) -> str:
    def replace(match: re.Match[str]) -> str:
        sequence = int(match.group(1))
        occurrence = sequence_to_occurrence.get(sequence)
        if not occurrence:
            return ""
        annotation = occurrence.get("annotation")
        if not isinstance(annotation, dict) or annotation.get("is_decorative"):
            return ""
        if occurrence.get("container") != "table_cell":
            return ""
        return annotation_html_block(annotation)

    return TABLE_IMAGE_ANNOTATION_PLACEHOLDER_PATTERN.sub(replace, markdown)


def annotation_state_matches(meta: dict[str, object], config: ImageAnnotationConfig) -> bool:
    stored = meta.get("image_annotation")
    if not config.enabled:
        return not (isinstance(stored, dict) and stored.get("enabled"))
    if not isinstance(stored, dict):
        return False
    return (
        stored.get("enabled") is True
        and stored.get("model") == config.model
        and stored.get("limit_per_doc") == config.limit_per_doc
        and (
            stored.get("unsupported_suffixes") is None
            or stored.get("unsupported_suffixes") == sorted(config.unsupported_suffixes)
        )
    )


def annotate_document_images(
    *,
    doc_path: Path,
    meta_path: Path,
    metadata: dict[str, object],
    blocks: list[str],
    image_block_sequences: list[int],
    config: ImageAnnotationConfig,
    workspace_root: Path,
    annotation_cache: ImageAnnotationCache | None,
) -> dict[str, object]:
    if not config.enabled:
        return metadata

    images = metadata.get("images")
    if not isinstance(images, list):
        metadata["image_annotation"] = {
            "enabled": True,
            "model": config.model,
            "limit_per_doc": config.limit_per_doc,
            "unsupported_suffixes": sorted(config.unsupported_suffixes),
            "annotated_block_count": 0,
            "decorative_count": 0,
            "error_count": 0,
            "generated_at": iso_now(),
        }
        meta_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        return metadata

    sequence_to_occurrence = {
        int(occurrence.get("sequence")): occurrence
        for occurrence in images
        if isinstance(occurrence, dict) and occurrence.get("sequence") is not None
    }
    contexts = build_image_contexts(blocks, image_block_sequences, sequence_to_occurrence)
    annotator = CodexImageAnnotator(config, workspace_root)
    annotated_blocks = 0
    decorative_count = 0
    error_count = 0
    cache_hit_count = 0
    inserted_blocks: list[str] = []
    standalone_image_block_count = 0
    doc_warnings = metadata.setdefault("warnings", [])
    if not isinstance(doc_warnings, list):
        doc_warnings = []
        metadata["warnings"] = doc_warnings

    limit = config.limit_per_doc if config.limit_per_doc and config.limit_per_doc > 0 else None

    for block in blocks:
        stripped = block.strip()
        inserted_blocks.append(block)
        if not is_image_block(stripped):
            continue
        if not image_block_sequences:
            continue
        standalone_image_block_count += 1
        sequence = image_block_sequences[standalone_image_block_count - 1]
        occurrence = sequence_to_occurrence.get(int(sequence))
        if occurrence is None:
            doc_warnings.append("missing image occurrence metadata for standalone image block")
            continue

        if limit is not None and annotated_blocks >= limit and occurrence.get("annotation_status") not in {"annotated", "cached"}:
            occurrence["annotation_status"] = "skipped_limit"
            continue

        image_rel_path = str(occurrence.get("output_path") or "")
        image_path = (doc_path.parent / image_rel_path).resolve()
        if image_path.suffix.lower() in config.unsupported_suffixes:
            occurrence["annotation_status"] = "skipped_unsupported_image_format"
            occurrence["annotation_skip_reason"] = f"unsupported image format for LLM annotation: {image_path.suffix.lower()}"
            continue
        context = contexts.get(int(sequence), {})
        try:
            annotation = annotator.annotate(
                image_path=image_path,
                image_sha256=str(occurrence.get("content_sha256") or sha256_file(image_path)),
                document_title=str(metadata.get("title") or ""),
                document_path=str(metadata.get("source_relative_path") or ""),
                heading_context=list(context.get("heading_context") or []),
                caption=clean_text(str(occurrence.get("caption") or "")),
                previous_text=str(context.get("previous_text") or ""),
                next_text=str(context.get("next_text") or ""),
                alt_text=clean_text(str(occurrence.get("alt_text") or "")),
                annotation_cache=annotation_cache,
            )
            occurrence["annotation"] = annotation
            occurrence["annotation_status"] = "cached" if annotation.get("cache_hit") else "annotated"
            occurrence["annotation_heading_context"] = list(context.get("heading_context") or [])
            if context.get("local_context_text"):
                occurrence["annotation_local_context_text"] = str(context["local_context_text"])
            annotated_blocks += 1
            if annotation.get("cache_hit"):
                cache_hit_count += 1
            elif annotation_cache is not None:
                annotation_cache.put(
                    image_sha256=str(occurrence.get("content_sha256") or sha256_file(image_path)),
                    model=config.model,
                    prompt_version=IMAGE_ANNOTATION_PROMPT_VERSION,
                    schema_version=IMAGE_ANNOTATION_SCHEMA_VERSION,
                    annotation={key: value for key, value in annotation.items() if key != "cache_hit"},
                )
            if annotation.get("is_decorative"):
                decorative_count += 1
            else:
                note_block = annotation_markdown_block(annotation)
                if note_block:
                    inserted_blocks.append(note_block)
        except Exception as exc:
            error_count += 1
            error_message = clean_text(str(exc))
            occurrence["annotation_status"] = "error"
            occurrence["annotation_error"] = error_message
            doc_warnings.append(
                f"image annotation failed for {image_rel_path}: {error_message}"
            )
            if config.fail_on_error or is_annotation_budget_error(error_message):
                raise RuntimeError(f"image annotation failed for {image_rel_path}: {error_message}") from exc

    updated_markdown = "\n\n".join(block.rstrip() for block in inserted_blocks if block and block.strip()).strip() + "\n"
    remaining = [
        occurrence
        for sequence, occurrence in sorted(sequence_to_occurrence.items())
        if occurrence.get("container") == "table_cell"
    ]
    for occurrence in remaining:
        if limit is not None and annotated_blocks >= limit and occurrence.get("annotation_status") not in {"annotated", "cached"}:
            occurrence["annotation_status"] = "skipped_limit"
            continue
        image_rel_path = str(occurrence.get("output_path") or "")
        image_path = (doc_path.parent / image_rel_path).resolve()
        if image_path.suffix.lower() in config.unsupported_suffixes:
            occurrence["annotation_status"] = "skipped_unsupported_image_format"
            occurrence["annotation_skip_reason"] = f"unsupported image format for LLM annotation: {image_path.suffix.lower()}"
            continue
        sequence = int(occurrence.get("sequence"))
        context = contexts.get(sequence, {})
        try:
            annotation = annotator.annotate(
                image_path=image_path,
                image_sha256=str(occurrence.get("content_sha256") or sha256_file(image_path)),
                document_title=str(metadata.get("title") or ""),
                document_path=str(metadata.get("source_relative_path") or ""),
                heading_context=list(context.get("heading_context") or []),
                caption=clean_text(str(occurrence.get("caption") or "")),
                previous_text=str(context.get("previous_text") or ""),
                next_text=str(context.get("next_text") or ""),
                alt_text=clean_text(str(occurrence.get("alt_text") or "")),
                annotation_cache=annotation_cache,
            )
            occurrence["annotation"] = annotation
            occurrence["annotation_status"] = "cached" if annotation.get("cache_hit") else "annotated"
            occurrence["annotation_heading_context"] = list(context.get("heading_context") or [])
            if context.get("local_context_text"):
                occurrence["annotation_local_context_text"] = str(context["local_context_text"])
            annotated_blocks += 1
            if annotation.get("cache_hit"):
                cache_hit_count += 1
            elif annotation_cache is not None:
                annotation_cache.put(
                    image_sha256=str(occurrence.get("content_sha256") or sha256_file(image_path)),
                    model=config.model,
                    prompt_version=IMAGE_ANNOTATION_PROMPT_VERSION,
                    schema_version=IMAGE_ANNOTATION_SCHEMA_VERSION,
                    annotation={key: value for key, value in annotation.items() if key != "cache_hit"},
                )
            if annotation.get("is_decorative"):
                decorative_count += 1
        except Exception as exc:
            error_count += 1
            error_message = clean_text(str(exc))
            occurrence["annotation_status"] = "error"
            occurrence["annotation_error"] = error_message
            doc_warnings.append(
                f"image annotation failed for {image_rel_path}: {error_message}"
            )
            if config.fail_on_error or is_annotation_budget_error(error_message):
                raise RuntimeError(f"image annotation failed for {image_rel_path}: {error_message}") from exc

    updated_markdown = replace_table_image_annotation_placeholders(updated_markdown, sequence_to_occurrence)
    doc_path.write_text(updated_markdown, encoding="utf-8")
    text_chars, word_count = markdown_text_metrics(updated_markdown)
    stats = metadata.setdefault("stats", {})
    if isinstance(stats, dict):
        stats["text_chars"] = text_chars
        stats["word_count_approx"] = word_count
        stats["image_annotations"] = annotated_blocks
        stats["image_annotation_cache_hits"] = cache_hit_count
    feature_flags = metadata.setdefault("feature_flags", {})
    if isinstance(feature_flags, dict):
        feature_flags["contains_image_annotations"] = annotated_blocks > 0
    metadata["image_annotation"] = {
        "enabled": True,
        "model": config.model,
        "limit_per_doc": config.limit_per_doc,
        "unsupported_suffixes": sorted(config.unsupported_suffixes),
        "annotated_block_count": annotated_blocks,
        "cache_hit_count": cache_hit_count,
        "decorative_count": decorative_count,
        "error_count": error_count,
        "generated_at": iso_now(),
    }
    meta_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return metadata


def matches_globs(relative_path: str, patterns: Iterable[str]) -> bool:
    return any(fnmatch.fnmatch(relative_path, pattern) for pattern in patterns)


def discover_docx_files(source_root: Path, scan_root: Path, include_globs: list[str], exclude_globs: list[str]) -> list[Path]:
    candidates = sorted(path for path in scan_root.rglob("*.docx") if path.is_file())
    selected: list[Path] = []
    for path in candidates:
        relative = path.relative_to(source_root).as_posix()
        if not matches_globs(relative, include_globs):
            continue
        if exclude_globs and matches_globs(relative, exclude_globs):
            continue
        selected.append(path)
    return selected


def load_existing_meta(output_dir: Path) -> dict[str, object] | None:
    meta_path = output_dir / "meta.json"
    if not meta_path.exists():
        return None
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def should_skip_conversion(
    source_path: Path,
    output_dir: Path,
    force: bool,
    image_annotation: ImageAnnotationConfig,
) -> bool:
    if force:
        return False
    meta = load_existing_meta(output_dir)
    doc_path = output_dir / "doc.md"
    if not meta or not doc_path.exists():
        return False
    try:
        stat = source_path.stat()
    except OSError:
        return False
    return (
        meta.get("converter_version") == CONVERTER_VERSION
        and meta.get("format_version") == FORMAT_VERSION
        and meta.get("source_size_bytes") == stat.st_size
        and meta.get("source_mtime_ns") == stat.st_mtime_ns
        and annotation_state_matches(meta, image_annotation)
    )


def validate_output_dir(output_dir: Path) -> list[str]:
    errors: list[str] = []
    doc_path = output_dir / "doc.md"
    meta_path = output_dir / "meta.json"
    if not doc_path.exists():
        errors.append("missing doc.md")
        return errors
    if not meta_path.exists():
        errors.append("missing meta.json")
        return errors

    markdown = doc_path.read_text(encoding="utf-8")
    if not markdown.strip():
        errors.append("doc.md is empty")
    if TABLE_IMAGE_ANNOTATION_PLACEHOLDER_PATTERN.search(markdown):
        errors.append("table image annotation placeholders remain in doc.md")

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if not meta.get("title"):
        errors.append("meta.json missing title")
    if not meta.get("source_relative_path"):
        errors.append("meta.json missing source_relative_path")
    if is_generic_title(str(meta.get("title") or "")):
        errors.append("title resolved to generic heading")

    for rel_path in markdown_image_paths(markdown):
        target = (output_dir / rel_path).resolve()
        if not target.exists():
            errors.append(f"missing markdown image target: {rel_path}")

    stats = meta.get("stats") or {}
    feature_flags = meta.get("feature_flags") or {}
    if feature_flags.get("contains_textboxes") and not stats.get("textboxes"):
        errors.append("textboxes detected but no textbox content extracted")
    if int(stats.get("images", 0)) >= 50 and int(stats.get("text_chars", 0)) < 500:
        errors.append("image-heavy document has unusually low text yield")
    return errors


def build_output_dir(output_root: Path, source_root: Path, source_path: Path) -> Path:
    relative = source_path.relative_to(source_root)
    return output_root / relative.with_suffix("")


def process_document(task: DocumentTask) -> dict[str, object]:
    output_dir = build_output_dir(task.output_root, task.source_root, task.source_path)
    relative = task.source_path.relative_to(task.source_root).as_posix()
    container_kind, container_detail = detect_docx_container(task.source_path)

    if container_kind != "ooxml":
        if output_dir.exists():
            shutil.rmtree(output_dir)
        return {
            "source_relative_path": relative,
            "output_relative_path": output_dir.relative_to(task.output_root).as_posix(),
            "status": "unsupported",
            "title": filename_title(task.source_path),
            "warnings_count": 0,
            "images_count": 0,
            "validation_errors": [],
            "error": f"unsupported_container:{container_kind}:{container_detail}",
        }

    if should_skip_conversion(task.source_path, output_dir, task.force, task.image_annotation):
        meta = load_existing_meta(output_dir) or {}
        validation_errors = validate_output_dir(output_dir)
        return {
            "source_relative_path": relative,
            "output_relative_path": output_dir.relative_to(task.output_root).as_posix(),
            "status": "skipped",
            "title": meta.get("title") or task.source_path.stem,
            "warnings_count": len(meta.get("warnings") or []),
            "images_count": len(meta.get("images") or []),
            "validation_errors": validation_errors,
            "meta": meta,
        }

    converter = DocxMarkdownConverter(task.source_root, task.source_path, output_dir)
    metadata = converter.convert()
    if task.image_annotation.enabled:
        metadata = annotate_document_images(
            doc_path=output_dir / "doc.md",
            meta_path=output_dir / "meta.json",
            metadata=metadata,
            blocks=converter.rendered_blocks,
            image_block_sequences=converter.image_block_sequences,
            config=task.image_annotation,
            workspace_root=PROJECT_ROOT,
            annotation_cache=task.image_annotation_cache,
        )
    validation_errors = validate_output_dir(output_dir)
    return {
        "source_relative_path": relative,
        "output_relative_path": output_dir.relative_to(task.output_root).as_posix(),
        "status": "converted",
        "title": metadata.get("title") or task.source_path.stem,
        "warnings_count": len(metadata.get("warnings") or []),
        "images_count": len(metadata.get("images") or []),
        "validation_errors": validation_errors,
        "meta": metadata,
    }


def load_previous_manifest(manifest_path: Path) -> dict[str, object] | None:
    if not manifest_path.exists():
        return None
    try:
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def clean_deleted_outputs(
    output_root: Path,
    current_relative_paths: set[str],
    previous_manifest: dict[str, object] | None,
) -> list[str]:
    if not previous_manifest:
        return []
    deleted: list[str] = []
    for record in previous_manifest.get("documents", []):
        if not isinstance(record, dict):
            continue
        relative = record.get("source_relative_path")
        output_relative = record.get("output_relative_path")
        if not isinstance(relative, str) or relative in current_relative_paths or not isinstance(output_relative, str):
            continue
        output_dir = output_root / output_relative
        if output_dir.exists():
            ensure_within_root(output_root, output_dir)
            shutil.rmtree(output_dir)
            remove_empty_parents(output_dir.parent, output_root)
            deleted.append(relative)
    return deleted


def write_manifest(
    manifest_path: Path,
    source_root: Path,
    output_root: Path,
    summary: dict[str, object],
    documents: list[dict[str, object]],
) -> None:
    payload = {
        "format_version": FORMAT_VERSION,
        "converter_version": CONVERTER_VERSION,
        "generated_at": iso_now(),
        "source_root": str(source_root),
        "output_root": str(output_root),
        "summary": summary,
        "documents": documents,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_report(report_path: Path, summary: dict[str, object], documents: list[dict[str, object]]) -> None:
    payload = {
        "generated_at": iso_now(),
        "summary": summary,
        "failures": [doc for doc in documents if doc.get("status") == "failed"],
        "unsupported": [doc for doc in documents if doc.get("status") == "unsupported"],
        "validation_failures": [doc for doc in documents if doc.get("validation_errors")],
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def append_progress(progress_path: Path, record: dict[str, object]) -> None:
    progress_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "recorded_at": iso_now(),
        "source_relative_path": record.get("source_relative_path"),
        "output_relative_path": record.get("output_relative_path"),
        "status": record.get("status"),
        "title": record.get("title"),
        "images_count": record.get("images_count"),
        "warnings_count": record.get("warnings_count"),
        "validation_errors": record.get("validation_errors") or [],
    }
    meta = record.get("meta")
    if isinstance(meta, dict):
        payload["image_annotation"] = meta.get("image_annotation")
    if record.get("error"):
        payload["error"] = record.get("error")
    with progress_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Recursively convert DOCX knowledge documents into doc.md + media + meta.json."
    )
    parser.add_argument("--source-root", required=True, type=Path, help="Root directory of source DOCX files.")
    parser.add_argument(
        "--scan-root",
        type=Path,
        help="Optional subdirectory to scan recursively. Defaults to --source-root.",
    )
    parser.add_argument("--output-root", required=True, type=Path, help="Directory where converted outputs are written.")
    parser.add_argument(
        "--include-glob",
        action="append",
        default=[],
        help="Glob pattern relative to source root. May be repeated. Defaults to DOCX files recursively.",
    )
    parser.add_argument(
        "--exclude-glob",
        action="append",
        default=[],
        help="Glob pattern relative to source root to exclude. May be repeated.",
    )
    parser.add_argument("--workers", type=int, default=4, help="Number of worker threads. Default: 4.")
    parser.add_argument("--force", action="store_true", help="Rebuild all matched documents.")
    parser.add_argument(
        "--annotate-images",
        action="store_true",
        help="Call Codex vision to generate short inline image annotations in doc.md and meta.json.",
    )
    parser.add_argument(
        "--image-annotation-model",
        default="gpt-5.4-mini",
        help="Model used for image annotation when --annotate-images is enabled. Default: gpt-5.4-mini.",
    )
    parser.add_argument(
        "--image-annotation-command",
        default="codex",
        help="Codex CLI command used for image annotation. Default: codex.",
    )
    parser.add_argument(
        "--image-annotation-timeout",
        type=int,
        default=180,
        help="Timeout in seconds for each image annotation request. Default: 180.",
    )
    parser.add_argument(
        "--image-annotation-limit-per-doc",
        type=int,
        help="Optional cap on how many standalone images to annotate per document.",
    )
    parser.add_argument(
        "--image-annotation-fail-on-error",
        action="store_true",
        help="Fail the current document when any image annotation request fails. Budget/rate/token errors fail regardless.",
    )
    parser.add_argument(
        "--clean-deleted",
        action="store_true",
        help="Remove output directories whose source DOCX files no longer exist in the scanned set.",
    )
    parser.add_argument("--fail-fast", action="store_true", help="Stop after the first conversion failure.")
    parser.add_argument(
        "--report-json",
        type=Path,
        help="Optional path for a condensed run report JSON. Defaults to <output-root>/report.json when omitted.",
    )
    parser.add_argument(
        "--progress-jsonl",
        type=Path,
        help="Optional JSONL progress path. Defaults to <output-root>/progress.jsonl.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source_root = args.source_root.resolve()
    scan_root = args.scan_root.resolve() if args.scan_root else source_root
    output_root = args.output_root.resolve()
    manifest_path = output_root / "manifest.json"
    report_path = args.report_json.resolve() if args.report_json else output_root / "report.json"
    progress_path = args.progress_jsonl.resolve() if args.progress_jsonl else output_root / "progress.jsonl"

    if not source_root.exists():
        raise SystemExit(f"source root does not exist: {source_root}")
    if not scan_root.exists():
        raise SystemExit(f"scan root does not exist: {scan_root}")
    if source_root not in {scan_root, *scan_root.parents}:
        raise SystemExit("--scan-root must be the same as or a child of --source-root")

    include_globs = args.include_glob or DEFAULT_INCLUDE_GLOBS
    exclude_globs = list(DEFAULT_EXCLUDE_GLOBS)
    exclude_globs.extend(args.exclude_glob or [])

    previous_manifest = load_previous_manifest(manifest_path)
    progress_path.parent.mkdir(parents=True, exist_ok=True)
    progress_path.write_text("", encoding="utf-8")
    source_paths = discover_docx_files(source_root, scan_root, include_globs, exclude_globs)
    current_relative_paths = {path.relative_to(source_root).as_posix() for path in source_paths}
    image_annotation = ImageAnnotationConfig(
        enabled=bool(args.annotate_images),
        model=args.image_annotation_model,
        command=args.image_annotation_command,
        timeout_seconds=args.image_annotation_timeout,
        limit_per_doc=args.image_annotation_limit_per_doc,
        fail_on_error=bool(args.image_annotation_fail_on_error),
    )
    image_annotation_cache = ImageAnnotationCache(output_root / ".image-annotation-cache.jsonl") if image_annotation.enabled else None

    deleted_sources = clean_deleted_outputs(output_root, current_relative_paths, previous_manifest) if args.clean_deleted else []

    tasks = [
        DocumentTask(
            source_root=source_root,
            source_path=source_path,
            output_root=output_root,
            force=args.force,
            image_annotation=image_annotation,
            image_annotation_cache=image_annotation_cache,
        )
        for source_path in source_paths
    ]

    results: list[dict[str, object]] = []
    failures = 0

    if args.workers <= 1:
        iterator = tasks
        for task in iterator:
            try:
                result = process_document(task)
                results.append(result)
                append_progress(progress_path, result)
            except Exception as exc:  # pragma: no cover - CLI guard
                failures += 1
                result = {
                    "source_relative_path": task.source_path.relative_to(source_root).as_posix(),
                    "output_relative_path": build_output_dir(output_root, source_root, task.source_path).relative_to(output_root).as_posix(),
                    "status": "failed",
                    "error": f"{type(exc).__name__}: {exc}",
                    "validation_errors": [],
                }
                results.append(result)
                append_progress(progress_path, result)
                if args.fail_fast:
                    break
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {executor.submit(process_document, task): task for task in tasks}
            for future in as_completed(futures):
                task = futures[future]
                try:
                    result = future.result()
                    results.append(result)
                    append_progress(progress_path, result)
                except Exception as exc:  # pragma: no cover - CLI guard
                    failures += 1
                    result = {
                        "source_relative_path": task.source_path.relative_to(source_root).as_posix(),
                        "output_relative_path": build_output_dir(output_root, source_root, task.source_path).relative_to(output_root).as_posix(),
                        "status": "failed",
                        "error": f"{type(exc).__name__}: {exc}",
                        "validation_errors": [],
                    }
                    results.append(result)
                    append_progress(progress_path, result)
                    if args.fail_fast:
                        break

    results.sort(key=lambda item: str(item.get("source_relative_path", "")))

    converted_count = sum(1 for item in results if item.get("status") == "converted")
    skipped_count = sum(1 for item in results if item.get("status") == "skipped")
    failed_count = sum(1 for item in results if item.get("status") == "failed")
    unsupported_count = sum(1 for item in results if item.get("status") == "unsupported")
    validation_failure_count = sum(1 for item in results if item.get("validation_errors"))

    summary = {
        "discovered_count": len(source_paths),
        "converted_count": converted_count,
        "skipped_count": skipped_count,
        "failed_count": failed_count,
        "unsupported_count": unsupported_count,
        "validation_failure_count": validation_failure_count,
        "deleted_output_count": len(deleted_sources),
        "workers": args.workers,
        "force": bool(args.force),
        "clean_deleted": bool(args.clean_deleted),
        "image_annotation_enabled": image_annotation.enabled,
        "image_annotation_model": image_annotation.model if image_annotation.enabled else None,
        "image_annotation_limit_per_doc": image_annotation.limit_per_doc if image_annotation.enabled else None,
        "image_annotation_fail_on_error": image_annotation.fail_on_error if image_annotation.enabled else None,
        "image_annotation_cache_path": str((output_root / ".image-annotation-cache.jsonl")) if image_annotation.enabled else None,
    }

    write_manifest(manifest_path, source_root, output_root, summary, results)
    write_report(report_path, summary, results)

    payload = {
        "ok": failed_count == 0 and validation_failure_count == 0,
        "summary": summary,
        "manifest_path": str(manifest_path),
        "report_path": str(report_path),
        "progress_path": str(progress_path),
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 1 if failed_count or validation_failure_count else 0


if __name__ == "__main__":
    sys.exit(main())
