#!/usr/bin/env python3
"""Launch the shared Playwright Chromium headless and render a page; exit 1 on failure."""
import sys

try:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page()
        page.set_content("<html><body><h1>ok</h1></body></html>")
        page.screenshot()
        text = page.inner_text("h1")
        browser.close()
    if text != "ok":
        raise RuntimeError(f"unexpected page text: {text!r}")
except Exception as error:  # noqa: BLE001 - report any launch failure
    print(f"browser smoke failed: {error}", file=sys.stderr)
    sys.exit(1)
print("browser smoke ok")
