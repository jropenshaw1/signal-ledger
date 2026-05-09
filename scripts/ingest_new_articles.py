#!/usr/bin/env python3
"""
ingest_new_articles.py — Fetch new EC articles and ingest into Signal Ledger.

Run from anywhere with Python 3.8+:
  python ingest_new_articles.py

Requires: requests (pip install requests)
"""

import json
import hashlib
import time
import sys
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    print("pip install requests")
    sys.exit(1)

# --- Configuration ---
SB_URL = "https://blreixaevpbmhbhyqgbq.supabase.co"
SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJscmVpeGFldnBibWhiaHlxZ2JxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjQ5NzkxNywiZXhwIjoyMDg4MDczOTE3fQ.JtnCoMPnlnFhUJYi3CK1OmQju9DKplUc5QrJs8aQsl4"
EC_MCP_URL = "https://www.contentmasterpro.limited/api/mcp/subscriber/exc__eAIcubn2KJbnQXHyptXOHMGb3VTltryJ"
PROVIDER_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"

ARTICLES = [
    {
        "ec_id": "305d1e46-2239-4836-8de3-e6b813b4c1a6",
        "url": "https://natesnewsletter.substack.com/p/codex-plugins-bottleneck-moved",
        "published_date": "2026-05-09",
    },
    {
        "ec_id": "47b4e76e-9e95-4776-a133-b1b1bb7a1347",
        "url": "https://natesnewsletter.substack.com/p/ai-code-trust-verification-shift",
        "published_date": "2026-05-08",
    },
    {
        "ec_id": "e2cd17fb-3de4-4ee0-97fb-7aca418dd579",
        "url": "https://natesnewsletter.substack.com/p/openclaw-agent-runtime-model-swapping",
        "published_date": "2026-05-07",
    },
]

SB_HEADERS = {
    "apikey": SB_KEY,
    "Authorization": f"Bearer {SB_KEY}",
    "Content-Type": "application/json",
}


def ec_get_post(post_id: str) -> dict:
    """Fetch article from Executive Circle MCP via Streamable HTTP transport.

    EC MCP uses Streamable HTTP: POST JSON-RPC with
    Accept: application/json, text/event-stream
    Response streams back as SSE on the same connection.
    """
    payload = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "get_post",
            "arguments": {"id": post_id}
        },
        "id": 1,
    }

    resp = requests.post(
        EC_MCP_URL,
        json=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        },
        stream=True,
        timeout=60,
    )
    resp.raise_for_status()

    # Parse SSE stream for the result
    for line in resp.iter_lines(decode_unicode=True):
        if line and line.startswith("data: "):
            try:
                parsed = json.loads(line[6:])
                if "result" in parsed:
                    content = parsed["result"].get("content", [])
                    for item in content:
                        if item.get("type") == "text":
                            return json.loads(item["text"])
            except json.JSONDecodeError:
                continue

    raise RuntimeError(f"No result in SSE stream for post {post_id}")


def ingest_article(article_data: dict, meta: dict) -> str:
    """Insert article into sl_articles via REST."""
    slug = meta["url"].split("/p/")[-1] if "/p/" in meta["url"] else meta["url"]
    external_id = f"email_hash:sha256({slug})"

    row = {
        "provider_id": PROVIDER_ID,
        "external_id": external_id,
        "content_type": "Nate-feature-article",
        "title": article_data["title"],
        "published_date": meta["published_date"],
        "ingestion_date": datetime.now(timezone.utc).isoformat(),
        "ingestion_source": "web",
        "capture_completeness": "complete",
        "embedding_status": "pending",
        "url": meta["url"],
        "body_text": article_data["content"],
    }

    resp = requests.post(
        f"{SB_URL}/rest/v1/sl_articles",
        json=row,
        headers={**SB_HEADERS, "Prefer": "return=representation"},
    )
    resp.raise_for_status()
    result = resp.json()
    return result[0]["article_id"]


def embed_article(article_id: str) -> dict:
    """Call sl_embed_article edge function."""
    resp = requests.post(
        f"{SB_URL}/functions/v1/sl_embed_article",
        json={"article_id": article_id},
        headers={"Authorization": f"Bearer {SB_KEY}", "Content-Type": "application/json"},
        timeout=120,
    )
    return resp.json()


def main():
    print(f"Ingesting {len(ARTICLES)} articles into Signal Ledger\n")

    for i, meta in enumerate(ARTICLES):
        print(f"[{i+1}/{len(ARTICLES)}] Fetching from EC: {meta['ec_id'][:8]}...")

        try:
            article_data = ec_get_post(meta["ec_id"])
        except Exception as e:
            print(f"  ERROR fetching from EC: {e}")
            continue

        title = article_data.get("title", "?")
        body_len = len(article_data.get("content", ""))
        print(f"  Title: {title[:70]}...")
        print(f"  Body: {body_len:,} chars")

        # Check for duplicates
        check = requests.get(
            f"{SB_URL}/rest/v1/sl_articles?select=article_id&title=eq.{requests.utils.quote(title)}",
            headers=SB_HEADERS,
        )
        if check.json():
            print(f"  SKIP: Already exists")
            continue

        # Ingest
        try:
            article_id = ingest_article(article_data, meta)
            print(f"  Ingested: {article_id}")
        except Exception as e:
            print(f"  ERROR ingesting: {e}")
            continue

        # Embed
        time.sleep(2)
        print(f"  Embedding...")
        try:
            result = embed_article(article_id)
            if result.get("success"):
                chunks = result["data"].get("chunks", "?")
                tokens = result["data"].get("total_tokens", "?")
                print(f"  Embedded: {chunks} chunks, {tokens} tokens")
            else:
                print(f"  Embed failed: {result.get('error', {}).get('message', '?')}")
        except Exception as e:
            print(f"  ERROR embedding: {e}")

        if i < len(ARTICLES) - 1:
            time.sleep(3)

    # Final count
    count = requests.get(
        f"{SB_URL}/rest/v1/sl_articles?select=article_id&limit=500",
        headers=SB_HEADERS,
    )
    print(f"\nTotal articles in sl_articles: {len(count.json())}")

    statuses = requests.get(
        f"{SB_URL}/rest/v1/sl_articles?select=embedding_status&limit=500",
        headers=SB_HEADERS,
    )
    from collections import Counter
    counts = Counter(a["embedding_status"] for a in statuses.json())
    print(f"Embedding status: {dict(counts)}")


if __name__ == "__main__":
    main()
