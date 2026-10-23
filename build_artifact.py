"""Builds a single-file page fragment (no <html>/<head>/<body>, layout.js inlined)
from preview.html, for hosts that wrap the page themselves.

    python3 build_artifact.py out.html
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def build():
    page = open(os.path.join(HERE, "preview.html"), encoding="utf-8").read()
    js = open(os.path.join(HERE, "layout.js"), encoding="utf-8").read()
    if "</script" in js:
        raise ValueError("layout.js contains a closing script tag and cannot be inlined")
    title = re.search(r"<title>.*?</title>", page, re.S).group(0)
    font = re.search(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>', page).group(0)
    style = re.search(r"<style>.*?</style>", page, re.S).group(0)
    body = re.search(r"<body>(.*)</body>", page, re.S).group(1)
    body = body.replace('<script src="layout.js"></script>', "<script>\n" + js + "\n</script>")
    return "\n".join([
        title,
        '<meta name="claude:viewport-fit-sides" content="cover">',
        font,
        style,
        body.strip(),
        "",
    ])


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "preview.artifact.html"
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print("wrote", out)
