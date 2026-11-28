"""Read posted Korean used prices from public marketplace pages."""
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from html import unescape
from html.parser import HTMLParser
from urllib.parse import quote, urlsplit
from zoneinfo import ZoneInfo

import requests

from listing_pricing import MAX_VALUE_WON, amount

JOONGNA = "https://web.joongna.com"
PRODUCT_PATH = re.compile(r"/product/\d+/?")


class PricePage(HTMLParser):
    def __init__(self):
        super().__init__()
        self.products = []
        self.links = []
        self._script = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("type") == "application/ld+json":
            self._script = []
        if tag == "a" and (href := attrs.get("href")):
            path = urlsplit(href).path
            if href.startswith("/product/") and PRODUCT_PATH.fullmatch(path) and path not in self.links:
                self.links.append(path)

    def handle_data(self, data):
        if self._script is not None:
            self._script.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self._script is not None:
            try:
                self.products.extend(_schema_products(json.loads("".join(self._script))))
            except (ValueError, RecursionError):
                pass
            self._script = None


def _schema_products(node):
    if isinstance(node, list):
        for entry in node:
            yield from _schema_products(entry)
    elif isinstance(node, dict):
        if node.get("@type") == "Product":
            yield node
        yield from _schema_products(node.get("@graph"))


def _load_page(url):
    try:
        with requests.get(url, timeout=(3, 5), stream=True, allow_redirects=False) as response:
            if response.status_code != 200 or "text/html" not in response.headers.get("Content-Type", ""):
                return None
            body = bytearray()
            for chunk in response.iter_content(65536):
                body.extend(chunk)
                if len(body) > 2 * 1024 * 1024:
                    return None
        page = PricePage()
        page.feed(body.decode("utf-8", errors="replace"))
        return page
    except (requests.RequestException, ValueError):
        return None


def _used_reference(url):
    page = _load_page(url)
    if not page:
        return None
    choices = []
    for product in page.products:
        title = re.sub(r"<[^>]+>", "", unescape(str(product.get("name") or ""))).strip()
        offers = product.get("offers")
        if not title or not isinstance(offers, dict) or offers.get("priceCurrency") != "KRW":
            continue
        if offers.get("availability") != "https://schema.org/InStock":
            continue
        if offers.get("itemCondition") != "https://schema.org/UsedCondition":
            continue
        raw_price = offers.get("price")
        if isinstance(raw_price, str) and re.fullmatch(r"[0-9]{1,9}", raw_price):
            raw_price = int(raw_price)
        if amount(raw_price, minimum=1, maximum=MAX_VALUE_WON):
            choices.append({
                "title": title[:80], "amountWon": raw_price, "source": "중고나라 · 판매 게시가", "url": url,
                "observedOn": datetime.now(ZoneInfo("Asia/Seoul")).date().isoformat(),
            })
    return min(choices, key=lambda ref: ref["amountWon"], default=None)


def _market_queries(query):
    title, model = query["title"], query["modelName"]
    # Try the brand/model, then a bare model identifier when the title includes it.
    code = re.search(r"\b(?:[A-Za-z][A-Za-z0-9-]*\s+\d{2,4}|[A-Za-z]{1,8}[- ]?\d[A-Za-z0-9-]+)\b", model or title)
    return dict.fromkeys(value for value in (model or title, code.group() if code else "") if value)


def market_prices(query):
    paths = []
    for term in _market_queries(query):
        page = _load_page(f"{JOONGNA}/search/{quote(term, safe='')}")
        if page:
            for path in page.links:
                if path not in paths:
                    paths.append(path)
        if len(paths) >= 4:
            break

    def read(path):
        return _used_reference(JOONGNA + path)

    with ThreadPoolExecutor(max_workers=4) as workers:
        return [ref for ref in workers.map(read, paths[:4]) if ref]
