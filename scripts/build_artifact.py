#!/usr/bin/env python3
"""Inline site/ into one self-contained HTML body for publishing as a single page.

Output: dist/climate-briefing.html (no doctype/head wrapper; the host adds one).
"""
import pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
site = root / "site"
html = (site / "index.html").read_text()
head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)
title = re.search(r"<title>.*?</title>", head, re.S).group(0)
keep = "\n".join(l for l in head.splitlines() if "fonts.g" in l or "claude:viewport" in l or 'name="description"' in l)
css = (site / "style.css").read_text()
def inline_script(m):
    src = m.group(1)
    code = (site / src).read_text().replace("</script", "<\\/script")
    return f"<script>\n{code}\n</script>"
body = re.sub(r'<script src="([^"]+)"></script>', inline_script, body)
out = f"{title}\n{keep}\n<style>\n{css}\n</style>\n{body}"
dist = root / "dist"; dist.mkdir(exist_ok=True)
(dist / "climate-briefing.html").write_text(out)
print("wrote", dist / "climate-briefing.html", len(out) // 1024, "KB")
