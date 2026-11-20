"""Turns docs/hackster.md into a page to copy into the hackster.io Story editor.

The hackster editor has no tables, so each table becomes a PNG (deliverables/hackster/table-N.png) and the page
shows a yellow box where to insert it. Image placeholders become the same yellow boxes.
Output: deliverables/hackster/story.html  -> open in a browser, Ctrl+A, Ctrl+C, paste into the Story tab.
Usage: python tools/hackster_paste.py     (needs the `markdown` package and node for the table images)
"""
import re
import subprocess
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "deliverables" / "hackster"
TABLE_CSS = """body{margin:0;padding:24px;background:#fff;font:17px 'Segoe UI',Arial,sans-serif;color:#12343b;display:inline-block}
table{border-collapse:collapse}th,td{border:1px solid #b8c6d6;padding:9px 14px;text-align:left;vertical-align:top}
th{background:#12343b;color:#fff;font-weight:600}tr:nth-child(even) td{background:#f3f7f8}
code{font-family:Consolas,monospace;font-size:15px;background:#edf3f3;padding:1px 4px;border-radius:3px}"""
BOX = ('<p style="background:#fff3b0;border:2px dashed #c27a10;padding:8px 12px;font-weight:600">'
       '▶ INSERT IMAGE: {}</p>')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    text = (ROOT / "docs" / "hackster.md").read_text(encoding="utf-8")
    story = text[text.index("## 1."):]
    html = markdown.markdown(story, extensions=["tables", "fenced_code"])

    tables = []

    def take(match):
        tables.append(match.group(0))
        return BOX.format(f"deliverables/hackster/table-{len(tables)}.png")

    html = re.sub(r"<table>.*?</table>", take, html, flags=re.S)
    html = re.sub(r"<p>\[images?: (.*?)\]</p>",
                  lambda m: BOX.format(m.group(1).replace("deliverables/", "deliverables/")), html)
    video = BOX.format("Video button → https://youtu.be/OC-kjD47Grs").replace("INSERT IMAGE", "INSERT VIDEO")
    page = (f"<!doctype html><meta charset='utf-8'><title>CCGN hackster story</title>"
            f"<body style='max-width:900px;margin:30px auto;font:16px Segoe UI,Arial'>{video}{html}</body>")
    (OUT / "story.html").write_text(page, encoding="utf-8")

    for n, table in enumerate(tables, 1):
        src = OUT / f"table-{n}.html"
        src.write_text(f"<!doctype html><meta charset='utf-8'><style>{TABLE_CSS}</style><body>{table}</body>",
                       encoding="utf-8")
        subprocess.run(["node", str(ROOT / "tools" / "shot.mjs"), str(OUT / f"table-{n}.png"), "1500", "800",
                        src.as_uri()], check=True)
        src.unlink()
    print(f"Saved {OUT / 'story.html'} and {len(tables)} table images")


if __name__ == "__main__":
    main()
