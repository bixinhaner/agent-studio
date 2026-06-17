#!/usr/bin/env python3
from __future__ import annotations

import importlib
import json
import sys


CHECKS = {
    "pandas": "pandas",
    "openpyxl": "openpyxl",
    "docx": "python-docx",
    "pptx": "python-pptx",
    "pypdf": "pypdf",
    "fitz": "pymupdf",
    "PIL": "pillow",
    "argostranslate": "argostranslate",
    "ctranslate2": "ctranslate2",
    "sentencepiece": "sentencepiece",
}


def main() -> int:
    ok: list[str] = []
    missing: list[str] = []
    for import_name, display_name in CHECKS.items():
        try:
            importlib.import_module(import_name)
        except Exception:
            missing.append(display_name)
        else:
            ok.append(display_name)

    print(json.dumps({"ok": ok, "missing": missing}, ensure_ascii=False, sort_keys=True))
    return 0 if not missing else 1


if __name__ == "__main__":
    sys.exit(main())
