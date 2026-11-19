#!/usr/bin/env python3
"""Build src/data.json for the MCP connector from the built site: every guide page in ../site/public/guides/
(title, description, article text) + the error patterns of ../site/errors.json.

Run after each site build, before deploying the connector:  python3 -I build_data.py
"""
import html, json, pathlib, re, sys
from datetime import datetime, timezone
from html.parser import HTMLParser

HERE = pathlib.Path(__file__).resolve().parent
SITE = HERE.parent / "site"
GUIDES = SITE / "public" / "guides"


class Article(HTMLParser):
    """Text of <article class="guide">: headings as ## lines, list items as - lines, code kept as is."""
    BLOCK = {"p", "div", "section", "pre", "table", "tr", "ol", "ul", "blockquote", "figure", "figcaption"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0          # > 0 inside the article
        self.skip = 0           # inside script/style/nav/svg
        self.out = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if self.depth == 0:
            if tag == "article" and "guide" in (a.get("class") or "").split():
                self.depth = 1
            return
        if tag == "article":
            self.depth += 1
        if tag in ("script", "style", "nav", "svg", "button", "form"):
            self.skip += 1
        if self.skip:
            return
        if tag in ("h1", "h2", "h3", "h4"):
            self.out.append("\n\n" + "#" * max(2, int(tag[1])) + " ")
        elif tag == "li":
            self.out.append("\n- ")
        elif tag == "br":
            self.out.append("\n")
        elif tag in self.BLOCK:
            self.out.append("\n\n" if tag != "tr" else "\n")
        elif tag in ("td", "th"):
            self.out.append(" | ")

    def handle_endtag(self, tag):
        if self.depth == 0:
            return
        if tag in ("script", "style", "nav", "svg", "button", "form") and self.skip:
            self.skip -= 1
            return
        if tag == "article":
            self.depth -= 1
        if not self.skip and tag in ("h1", "h2", "h3", "h4", "p", "pre", "ul", "ol", "table"):
            self.out.append("\n")

    def handle_data(self, data):
        if self.depth and not self.skip:
            self.out.append(data)

    def text(self):
        t = "".join(self.out)
        t = re.sub(r"[ \t\r\f\v]+", " ", t)
        t = re.sub(r" *\n *", "\n", t)
        return re.sub(r"\n{3,}", "\n\n", t).strip()


def meta(page, name):
    m = re.search(rf'<meta name="{name}" content="([^"]*)"', page)
    return html.unescape(m.group(1)) if m else ""


def main():
    errors = json.loads((SITE / "errors.json").read_text())
    groups = errors["groups"]
    by_slug = {}
    for e in errors["entries"]:
        by_slug.setdefault(e["s"], {"g": e["g"], "p": []})["p"] += e["p"]
    guides = []
    for d in sorted(p for p in GUIDES.iterdir() if (p / "index.html").is_file()):
        page = (d / "index.html").read_text()
        # No ads in the directory (Anthropic Software Directory Policy): drop the « we fix it » box and the
        # « Other … problems? See Fix a … app » line that points at a service page. The guide itself stays whole.
        page = re.sub(r"(?s)<aside\b.*?</aside>", "", page)
        page = re.sub(r'<p>[^<]*<a href="/fix/[^"]*">[^<]*</a>\.?</p>', "", page)
        title = re.search(r"<title>(.*?)</title>", page, re.S)
        art = Article()
        art.feed(page)
        text = art.text()
        if not title or len(text) < 400:
            sys.exit(f"{d.name}: no title or article text too short ({len(text)} chars)")
        e = by_slug.get(d.name, {})
        guides.append({"s": d.name, "t": html.unescape(title.group(1).strip()), "d": meta(page, "description"),
                       "g": groups[e["g"]] if "g" in e else "Other", "p": e.get("p", []), "x": text})
    ads = [g["s"] for g in guides if re.search(r"we fix it|quick fixes are|free check-up|fixed price within", g["x"], re.I)]
    if ads:
        sys.exit(f"promotional text left in: {ads[:5]}")
    missing = sorted(set(by_slug) - {g["s"] for g in guides})
    if missing:
        sys.exit(f"errors.json names guides that are not built: {missing}")
    out = {"version": datetime.now(timezone.utc).strftime("%Y.%m.%d.%H%M"), "groups": groups + ["Other"], "guides": guides}
    (HERE / "src").mkdir(exist_ok=True)
    (HERE / "src" / "data.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    size = (HERE / "src" / "data.json").stat().st_size
    print(f"{len(guides)} guides, {sum(1 for g in guides if g['p'])} with error patterns, data.json {size // 1024} KB")


if __name__ == "__main__":
    main()
