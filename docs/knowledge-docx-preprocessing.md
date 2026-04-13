# DOCX Knowledge Preprocessing

This script converts DOCX knowledge documents into a filesystem layout that keeps:

- `doc.md`
- `media/`
- `meta.json`

It does not keep the original `.docx` files in the output tree.

Current behavior:

- the canonical document title is the source filename without extension
- the extracted cover or heading title is kept in `meta.json.title_resolution`
- heading numbering such as `2.1` and `3.2.1` is preserved when it comes from Word numbering definitions
- ordered lists keep their numeric prefixes instead of being flattened to `-`
- internal bookmarks are emitted as HTML anchors and internal Word links are preserved as Markdown `#anchor` links when possible
- split cross-references that target the same bookmark, such as `[3](#...) [Initial Setup Wizard](#...)`, are collapsed into a single Markdown link
- Word field instructions and cross-reference metadata are indexed into `meta.json`
- `DOCPROPERTY` fields can fall back to resolved values from `docProps/core.xml`, `docProps/custom.xml`, and `docProps/app.xml`
- unsupported `.docx` containers are reported in `report.json` instead of crashing the run
- optional image annotation can call Codex vision and write short inline notes back into `doc.md`
- repeated images can reuse a shared annotation cache instead of calling the model again
- images inside table cells can be annotated and rendered back into the table HTML

## Script

`scripts/preprocess-knowledge-docx.py`

## Output Layout

```text
<output-root>/
  manifest.json
  report.json
  troubleshooting&faq/
    4G基站指导手册-20251205(1)/
      doc.md
      meta.json
      media/
```

## Example

```bash
python3 scripts/preprocess-knowledge-docx.py \
  --source-root /path/to/docs \
  --output-root /path/to/preprocessed-docs \
  --workers 4 \
  --clean-deleted
```

To process only a subdirectory:

```bash
python3 scripts/preprocess-knowledge-docx.py \
  --source-root /path/to/docs \
  --scan-root '/path/to/docs/troubleshooting&faq' \
  --output-root /path/to/preprocessed-docs \
  --workers 2
```

To annotate images inline with Codex `gpt-5.4-mini`:

```bash
python3 scripts/preprocess-knowledge-docx.py \
  --source-root /path/to/docs \
  --scan-root '/path/to/docs/troubleshooting&faq' \
  --output-root /path/to/preprocessed-docs \
  --workers 2 \
  --annotate-images \
  --image-annotation-model gpt-5.4-mini \
  --image-annotation-limit-per-doc 8 \
  --image-annotation-fail-on-error
```

## Incremental Behavior

- unchanged DOCX files are skipped
- changed DOCX files are rebuilt
- deleted source files can be cleaned from the output tree with `--clean-deleted`

## Validation

Each run writes:

- `manifest.json`: full document inventory and run result
- `report.json`: condensed summary with failures and validation issues
- `progress.jsonl`: one status record per completed/skipped/failed document as the run progresses

The validator checks:

- `doc.md` exists and is non-empty
- `meta.json` exists
- `document_properties` in `meta.json` capture resolved DOCX core/custom/app property values when available
- Markdown image references are not broken
- generic title regressions
- image-heavy documents with unusually low extracted text
- textbox extraction regressions when non-empty textbox content is present
- generated internal links have matching anchor targets

## Image Annotation Output

When `--annotate-images` is enabled:

- standalone images stay in their original Markdown position
- a short inline note is inserted immediately after each annotated image
- images inside table cells are annotated in-place as HTML blocks so table layout remains valid
- detailed annotation fields are written to the corresponding image entry in `meta.json`
- decorative images may be marked in metadata without adding extra inline text
- `.emf` and `.wmf` images are kept as Markdown image references but skipped for LLM annotation by default
- repeated image annotations are reused from `<output-root>/.image-annotation-cache.jsonl` when the image content hash, model and prompt/schema versions match
- budget/rate/token-limit failures stop the current document so the next run can skip already completed documents and resume from the first incomplete one

Inline Markdown shape:

```md
![图示](./media/0001-image1.png)

> 图像注解：……
> 图中文字：……
```

Table-cell image annotations are injected as HTML so the `<table>` structure stays intact:

```html
<td>
  ![图示](./media/0007-image8.png)
  <div class="image-annotation"><strong>图像注解：</strong>……</div>
  <div class="image-annotation-text"><strong>图中文字：</strong>……</div>
</td>
```
