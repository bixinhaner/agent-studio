#!/usr/bin/env python3
from __future__ import annotations

import importlib
import json
import sys


REQUIRED_CHECKS = {
    "pandas": "pandas",
    "openpyxl": "openpyxl",
    "docx": "python-docx",
    "pptx": "python-pptx",
    "pypdf": "pypdf",
    "pdfplumber": "pdfplumber",
    "fitz": "pymupdf",
    "PIL": "pillow",
}

OPTIONAL_CHECKS = {
    "argostranslate": "argostranslate",
    "ctranslate2": "ctranslate2",
    "sentencepiece": "sentencepiece",
}


def collect(checks: dict[str, str]) -> tuple[list[str], list[str]]:
    ok: list[str] = []
    missing: list[str] = []
    for import_name, display_name in checks.items():
        try:
            importlib.import_module(import_name)
        except Exception:
            missing.append(display_name)
        else:
            ok.append(display_name)
    return ok, missing


def main() -> int:
    ok, missing = collect(REQUIRED_CHECKS)
    optional_ok, optional_missing = collect(OPTIONAL_CHECKS)

    print(json.dumps({
        "missing": missing,
        "ok": ok,
        "optional_missing": optional_missing,
        "optional_ok": optional_ok,
    }, ensure_ascii=False, sort_keys=True))
    return 0 if not missing else 1


if __name__ == "__main__":
    sys.exit(main())
