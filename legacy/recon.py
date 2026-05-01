"""
Nate Archiver — Prompts Queue Recon (v1)
----------------------------------------
Reads manifest.json, extracts every prompts_queue source URL, follows the
redirect chain, classifies the final destination, and emits:
  - recon/recon_report.json  (structured data)
  - recon/recon_summary.md   (human-readable overview)

The goal is reconnaissance for the downstream kit extractor: before we build
fetchers, we need to know what the 55 Substack /redirect/<uuid>?j=... CTAs
actually resolve to — Google Docs? Notion? Direct downloads? Auth walls?
Duplicates?

Usage:
    python recon.py [--manifest PATH] [--out-dir PATH] [--timeout SECONDS]

This script is read-only with respect to manifest.json. It never writes the
manifest back.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

# ------------------------------------------------------------------ config

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_MANIFEST = SCRIPT_DIR / "manifest.json"
DEFAULT_OUT_DIR = SCRIPT_DIR / "recon"
USER_AGENT = "nate-archiver-recon/1.0"
TIMEOUT_SECONDS = 10.0

# Rate-limiting: spacing between requests in the fetch loop, and the
# cooldown applied when a 429 comes back before the single retry.
REQUEST_SPACING_SECONDS = 0.5
RATE_LIMIT_COOLDOWN_SECONDS = 5.0

# Statuses that flag an entry as eligible for --retry-failed.
RETRY_FAILED_STATUSES: tuple[int, ...] = (429, 500, 502, 503, 504)

# Known login-page hosts (path-agnostic) that signal an auth wall when the
# redirect chain terminates there. Substack's account-sign-in surface lives
# under substack.com/sign-in; Notion login lives under notion.so/login, etc.
# We match on (host, path-prefix) pairs so we don't false-flag, e.g.,
# natesnewsletter.substack.com post pages.
AUTH_WALL_MARKERS: tuple[tuple[str, str], ...] = (
    ("substack.com", "/sign-in"),
    ("substack.com", "/login"),
    ("www.notion.so", "/login"),
    ("notion.so", "/login"),
    ("accounts.google.com", "/"),
    ("accounts.google.com", "/signin"),
    ("accounts.google.com", "/servicelogin"),
    ("docs.google.com", "/accounts"),  # doc behind a Google account wall
    ("github.com", "/login"),
)

log = logging.getLogger("recon")


# ------------------------------------------------------------------ manifest

def load_manifest(path: Path) -> dict[str, Any]:
    """Read manifest.json. Never writes back — this script is read-only."""
    return json.loads(path.read_text(encoding="utf-8"))


def extract_source_urls(manifest: dict[str, Any]) -> list[str]:
    """Pull prompts_link values out of manifest['prompts_queue'] in order."""
    queue = manifest.get("prompts_queue", []) or []
    urls: list[str] = []
    for entry in queue:
        u = entry.get("prompts_link") if isinstance(entry, dict) else None
        if u:
            urls.append(u)
    return urls


# ------------------------------------------------------------------ http

def fetch_redirect_chain(
    client: httpx.Client, url: str
) -> tuple[int | None, str, list[str], str, str | None]:
    """Follow url's redirect chain and return
        (http_status, final_url, redirect_chain, content_type, error)

    redirect_chain is the ordered list of URLs visited, inclusive of the
    original source URL at index 0 and the final landing page as the last
    element. content_type is the final response's Content-Type header
    (empty string if missing). error is None on success, else a short message.
    """
    try:
        resp = client.get(url, follow_redirects=True)
    except httpx.TimeoutException as e:
        return None, url, [url], "", f"timeout: {e}"
    except httpx.RequestError as e:
        return None, url, [url], "", f"request error: {type(e).__name__}: {e}"
    except Exception as e:  # pragma: no cover — defensive
        return None, url, [url], "", f"unexpected: {type(e).__name__}: {e}"

    # response.history has one entry per intermediate redirect, in order.
    chain: list[str] = [str(h.request.url) for h in resp.history]
    chain.append(str(resp.request.url))
    # Guarantee the original source URL is present at position 0 even if
    # httpx normalized it.
    if chain and chain[0] != url:
        chain = [url] + chain

    content_type = resp.headers.get("content-type", "")
    return resp.status_code, str(resp.request.url), chain, content_type, None


def fetch_with_retry(
    client: httpx.Client, url: str
) -> tuple[int | None, str, list[str], str, str | None]:
    """Fetch `url`; on HTTP 429, sleep RATE_LIMIT_COOLDOWN_SECONDS and retry ONCE.

    If the retry also returns 429 or raises any error, the returned tuple
    carries a populated `error` and the caller treats the URL as failed.
    """
    status, final_url, chain, content_type, error = fetch_redirect_chain(client, url)
    if status != 429:
        return status, final_url, chain, content_type, error

    log.warning(
        "429 for %s — sleeping %.1fs and retrying once",
        url,
        RATE_LIMIT_COOLDOWN_SECONDS,
    )
    time.sleep(RATE_LIMIT_COOLDOWN_SECONDS)
    status, final_url, chain, content_type, error = fetch_redirect_chain(client, url)
    if status == 429 and error is None:
        # Surface the persistent rate-limit as an error so downstream logic
        # counts it consistently with other failures.
        error = "rate limited (429 after retry)"
    return status, final_url, chain, content_type, error


def process_urls(
    client: httpx.Client, source_urls: list[str]
) -> list[dict[str, Any]]:
    """Fetch every URL in order, pacing REQUEST_SPACING_SECONDS between calls.

    Returns the list of entry dicts in the same shape the pipeline has always
    produced. Shared between the full run and --retry-failed mode.
    """
    entries: list[dict[str, Any]] = []
    total = len(source_urls)
    for i, src in enumerate(source_urls, 1):
        if i > 1:
            time.sleep(REQUEST_SPACING_SECONDS)
        status, final_url, chain, content_type, error = fetch_with_retry(client, src)
        if error:
            classification, auth_gated = "other", False
        else:
            classification, auth_gated = classify_destination(final_url, content_type)
        parsed = urlparse(final_url)
        final_domain = (parsed.hostname or "").lower()

        entries.append(
            {
                "source_url": src,
                "final_url": final_url,
                "redirect_chain": chain,
                "http_status": status,
                "content_type": content_type,
                "final_domain": final_domain,
                "classification": classification,
                "auth_gated": auth_gated,
                "error": error,
            }
        )
        log.info(
            "[%d/%d] %s -> %s (%s%s%s)",
            i,
            total,
            src[:60] + ("..." if len(src) > 60 else ""),
            final_url[:80] + ("..." if len(final_url) > 80 else ""),
            classification,
            ", auth-gated" if auth_gated else "",
            f", error: {error}" if error else "",
        )
    return entries


# ------------------------------------------------------------------ classification

def classify_destination(final_url: str, content_type: str) -> tuple[str, bool]:
    """Return (classification_label, auth_gated_bool) for a final URL.

    Classification heuristics (first match wins):
      docs.google.com/document      -> google_doc
      docs.google.com/spreadsheets  -> google_sheet
      docs.google.com/presentation  -> google_slides
      *.notion.so or notion.site    -> notion_page
      gist.github.com               -> github_gist
      github.com (other)            -> github_repo
      content-type pdf/zip/octet    -> direct_download
      *.beehiiv.com                 -> beehiiv_page
      known login page              -> auth_wall
      else                          -> other

    auth_gated is True if the final URL matches a known login-surface host
    + path-prefix combination.
    """
    if not final_url:
        return "other", False

    parsed = urlparse(final_url)
    host = (parsed.hostname or "").lower()
    path = parsed.path or "/"

    auth_gated = _is_auth_wall(host, path)

    # Google Workspace — path determines the variant
    if host == "docs.google.com":
        if path.startswith("/document"):
            return ("auth_wall" if auth_gated else "google_doc", auth_gated)
        if path.startswith("/spreadsheets"):
            return ("auth_wall" if auth_gated else "google_sheet", auth_gated)
        if path.startswith("/presentation"):
            return ("auth_wall" if auth_gated else "google_slides", auth_gated)

    # Notion
    if host.endswith("notion.so") or host.endswith("notion.site"):
        return ("auth_wall" if auth_gated else "notion_page", auth_gated)

    # GitHub (gist before repo — gist is the narrower host)
    if host == "gist.github.com":
        return ("auth_wall" if auth_gated else "github_gist", auth_gated)
    if host.endswith("github.com"):
        return ("auth_wall" if auth_gated else "github_repo", auth_gated)

    # Direct download by content-type
    ct_lower = (content_type or "").lower()
    if (
        "application/pdf" in ct_lower
        or "application/zip" in ct_lower
        or "application/octet-stream" in ct_lower
    ):
        return "direct_download", False

    # Beehiiv
    if host.endswith("beehiiv.com"):
        return ("auth_wall" if auth_gated else "beehiiv_page", auth_gated)

    # Promptkit (Nate Jones' own kit host) — the primary prompts_queue target.
    if host == "promptkit.natebjones.com":
        return ("auth_wall" if auth_gated else "promptkit_natebjones", auth_gated)

    # Sponsor: Hey Presto (both the www and apex host variants seen in-queue).
    if host == "www.heypresto.ai" or host == "heypresto.ai":
        return ("auth_wall" if auth_gated else "sponsor_heypresto", auth_gated)

    # Auth wall fallthrough (e.g. generic login host we didn't map to a type)
    if auth_gated:
        return "auth_wall", True

    return "other", False


def _is_auth_wall(host: str, path: str) -> bool:
    """True if (host, path) matches any AUTH_WALL_MARKERS entry."""
    for marker_host, marker_prefix in AUTH_WALL_MARKERS:
        if host == marker_host and path.startswith(marker_prefix):
            return True
    return False


# ------------------------------------------------------------------ reporting

def build_report(
    source_urls: list[str],
    entries: list[dict[str, Any]],
) -> dict[str, Any]:
    """Assemble the recon_report.json payload with dedupe + classification stats."""
    # Dedupe on exact final_url. Entries with errors get grouped under their
    # source_url so a failed lookup doesn't accidentally merge with a
    # successful one whose final_url happens to equal the raw source.
    groups: dict[str, list[str]] = {}
    for e in entries:
        key = e["final_url"] if not e["error"] else f"__error__:{e['source_url']}"
        groups.setdefault(key, []).append(e["source_url"])

    dupe_groups = [
        {"final_url": k, "source_urls": v, "count": len(v)}
        for k, v in groups.items()
        if len(v) >= 2 and not k.startswith("__error__:")
    ]
    dupe_groups.sort(key=lambda g: (-g["count"], g["final_url"]))

    # unique_count = distinct successful final_urls + one slot per errored URL
    unique_successful = {k for k in groups if not k.startswith("__error__:")}
    errored_count = sum(1 for k in groups if k.startswith("__error__:"))
    unique_count = len(unique_successful) + errored_count

    classification_counts: dict[str, int] = {}
    for e in entries:
        classification_counts[e["classification"]] = (
            classification_counts.get(e["classification"], 0) + 1
        )

    return {
        "recon_run_at": datetime.now(timezone.utc).isoformat(),
        "total_source_urls": len(source_urls),
        "entries": entries,
        "dedupe": {
            "unique_count": unique_count,
            "dupe_groups": dupe_groups,
        },
        "classification_counts": classification_counts,
    }


def format_summary_md(report: dict[str, Any]) -> str:
    """Render a human-readable Markdown summary of the recon run."""
    total = report["total_source_urls"]
    unique = report["dedupe"]["unique_count"]
    dupe_groups = report["dedupe"]["dupe_groups"]
    dupe_url_count = sum(g["count"] for g in dupe_groups)
    auth_entries = [e for e in report["entries"] if e["auth_gated"]]
    error_entries = [e for e in report["entries"] if e["error"]]
    counts = report["classification_counts"]

    lines: list[str] = []
    lines.append("# Prompts Queue Recon — Summary")
    lines.append("")
    lines.append(f"Run at: `{report['recon_run_at']}`")
    lines.append("")
    lines.append("## Totals")
    lines.append("")
    lines.append(f"- Source URLs processed: **{total}**")
    lines.append(f"- Unique final destinations: **{unique}**")
    lines.append(
        f"- URLs inside dupe groups (count >= 2): **{dupe_url_count}** "
        f"across **{len(dupe_groups)}** groups"
    )
    lines.append(f"- Auth-gated destinations: **{len(auth_entries)}**")
    lines.append(f"- Errors: **{len(error_entries)}**")
    lines.append("")

    lines.append("## Classification distribution")
    lines.append("")
    lines.append("| Classification | Count |")
    lines.append("| --- | ---: |")
    for label in sorted(counts, key=lambda k: (-counts[k], k)):
        lines.append(f"| {label} | {counts[label]} |")
    lines.append("")

    lines.append("## Auth-gated URLs")
    lines.append("")
    if auth_entries:
        for e in auth_entries:
            lines.append(f"- `{e['final_url']}`  (from `{e['source_url']}`)")
    else:
        lines.append("_None._")
    lines.append("")

    lines.append("## Errors")
    lines.append("")
    if error_entries:
        for e in error_entries:
            lines.append(f"- `{e['source_url']}` — {e['error']}")
    else:
        lines.append("_None._")
    lines.append("")

    lines.append("## Top dupe groups (count >= 2)")
    lines.append("")
    if dupe_groups:
        for g in dupe_groups:
            lines.append(f"### {g['count']}x — `{g['final_url']}`")
            lines.append("")
            for s in g["source_urls"]:
                lines.append(f"- `{s}`")
            lines.append("")
    else:
        lines.append("_No duplicates detected._")
        lines.append("")

    return "\n".join(lines)


# ------------------------------------------------------------------ main pipeline

def atomic_write_text(path: Path, content: str) -> None:
    """Write `content` to `path` atomically.

    Writes to a sibling `.tmp` file first, flushes + fsyncs to disk, then
    uses os.replace() to atomically swap it into place. This prevents
    partial-write corruption if the process dies or a syncing client
    (e.g. OneDrive) intercepts the file mid-write. On Windows and POSIX,
    os.replace is atomic at the filesystem level — the destination either
    contains the old content or the new content, never a torn half-write.
    """
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def run_recon(
    manifest_path: Path,
    out_dir: Path,
    timeout: float,
) -> int:
    """Read manifest, fetch every prompts_queue URL, write report files."""
    manifest = load_manifest(manifest_path)
    source_urls = extract_source_urls(manifest)
    log.info("Loaded %d prompts_queue URLs from %s", len(source_urls), manifest_path)

    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "recon_report.json"
    summary_path = out_dir / "recon_summary.md"

    headers = {"User-Agent": USER_AGENT}
    # 55 items — no async, no concurrency. Single sync client, reused for
    # connection pooling. Loop paces itself via REQUEST_SPACING_SECONDS.
    with httpx.Client(
        headers=headers,
        timeout=timeout,
        follow_redirects=True,
    ) as client:
        entries = process_urls(client, source_urls)

    report = build_report(source_urls, entries)
    atomic_write_text(report_path, json.dumps(report, indent=2))
    atomic_write_text(summary_path, format_summary_md(report))
    log.info("Wrote %s (%d bytes)", report_path, report_path.stat().st_size)
    log.info("Wrote %s (%d bytes)", summary_path, summary_path.stat().st_size)

    errors = sum(1 for e in entries if e["error"])
    return 0 if errors == 0 else 1


def run_retry_failed(
    out_dir: Path,
    timeout: float,
) -> int:
    """Rerun only the failed entries from an existing recon_report.json.

    An entry is 'failed' when its http_status is in RETRY_FAILED_STATUSES
    (429/500/502/503/504) or its `error` field is non-null. Survivors of the
    retry are merged back in place by source_url match; unchanged entries
    stay as-is. manifest.json is NEVER touched — the source of truth for
    this run is the prior report's own entry list.
    """
    report_path = out_dir / "recon_report.json"
    summary_path = out_dir / "recon_summary.md"

    existing = json.loads(report_path.read_text(encoding="utf-8"))
    existing_entries: list[dict[str, Any]] = list(existing.get("entries", []))
    existing_source_urls = [e["source_url"] for e in existing_entries]

    failed_urls = [
        e["source_url"]
        for e in existing_entries
        if (e.get("http_status") in RETRY_FAILED_STATUSES) or e.get("error")
    ]
    log.info(
        "Retry-failed: %d failed entries out of %d total",
        len(failed_urls),
        len(existing_entries),
    )

    if failed_urls:
        headers = {"User-Agent": USER_AGENT}
        with httpx.Client(
            headers=headers,
            timeout=timeout,
            follow_redirects=True,
        ) as client:
            retried_entries = process_urls(client, failed_urls)
        retried_by_src = {e["source_url"]: e for e in retried_entries}

        merged: list[dict[str, Any]] = []
        for e in existing_entries:
            merged.append(retried_by_src.get(e["source_url"], e))
    else:
        log.info("Nothing to retry — regenerating report/summary from existing entries.")
        merged = existing_entries

    # Rebuild dedupe + classification_counts from the merged set so any
    # promptkit_natebjones / sponsor_heypresto re-classification from the
    # newly-added buckets also lands in the counts. build_report derives
    # both from `entries` alone, so re-running it is sufficient.
    report = build_report(existing_source_urls, merged)
    atomic_write_text(report_path, json.dumps(report, indent=2))
    atomic_write_text(summary_path, format_summary_md(report))
    log.info("Wrote %s (%d bytes)", report_path, report_path.stat().st_size)
    log.info("Wrote %s (%d bytes)", summary_path, summary_path.stat().st_size)

    errors = sum(1 for e in merged if e["error"])
    return 0 if errors == 0 else 1


# ------------------------------------------------------------------ entry point

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Recon for prompts_queue URLs in manifest.json"
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST,
        help=f"Path to manifest.json. Default: {DEFAULT_MANIFEST}",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help=f"Directory for recon_report.json and recon_summary.md. "
        f"Default: {DEFAULT_OUT_DIR}",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=TIMEOUT_SECONDS,
        help=f"Per-request timeout in seconds. Default: {TIMEOUT_SECONDS}",
    )
    parser.add_argument(
        "--retry-failed",
        action="store_true",
        help="Rerun only entries in recon_report.json whose http_status is in "
        "(429, 500, 502, 503, 504) or whose error is non-null; merge the "
        "retried results back into the existing entries list.",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    if args.retry_failed:
        return run_retry_failed(args.out_dir, args.timeout)
    return run_recon(args.manifest, args.out_dir, args.timeout)


if __name__ == "__main__":
    sys.exit(main())
