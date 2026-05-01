"""
Nate's Newsletter Archiver (v7)
-------------------------------
Pulls Nate's Substack articles from Gmail, extracts the body text,
and writes one Markdown file per article.

Usage:
    python nate_archiver.py [--since YYYY-MM-DD] [--out DIR] [--dry-run]

First run triggers a browser OAuth flow. Subsequent runs reuse the saved token.
Already-archived articles are skipped based on thread ID (tracked in manifest).

Changelog
---------
v7 (2026-04-18):
  * Replaced _decode_tnef_html TNEF-extraction logic. Previous versions
    attempted tnefparse.htmlbody plus a raw <html> byte scan; both return
    empty for Outlook-round-tripped TNEFs where the original HTML is
    wrapped as MS-OXRTFEX encapsulation inside an LZFu-compressed RTF
    stream. tnefparse 1.4+ auto-decompresses the LZFu; RTFDE unwraps the
    \\fromhtml1 encapsulation back to the original HTML.
  * Removed _extract_html_from_tnef_raw (dead code after RTFDE lands —
    the raw byte scan never triggers for real Outlook TNEF payloads).
  * Added RTFDE dependency. Install: pip install RTFDE compressed-rtf
    (compressed-rtf pulled in transitively; kept explicit in case tnefparse
    is downgraded below 1.4 in the future).
"""

from __future__ import annotations

import argparse
import base64
import email
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone
from email.message import Message
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# ------------------------------------------------------------------ config

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
SENDER = "natesnewsletter@substack.com"
DEFAULT_OUT = Path(r"C:\Users\jonat\OneDrive\Documents_PC\03_AIProjects\nate-archiver\output")
SCRIPT_DIR = Path(__file__).resolve().parent
CREDS_FILE = SCRIPT_DIR / "credentials.json"
TOKEN_FILE = SCRIPT_DIR / "token.json"
MANIFEST_FILE = SCRIPT_DIR / "manifest.json"

# Subjects matching these patterns are skipped (verification codes, admin, etc.)
SKIP_SUBJECT_PATTERNS = [
    re.compile(r"verification code", re.IGNORECASE),
    re.compile(r"confirm your email", re.IGNORECASE),
    re.compile(r"welcome to", re.IGNORECASE),
    re.compile(r"payment receipt", re.IGNORECASE),
    re.compile(r"give a friend", re.IGNORECASE),
    re.compile(r"free gifts? inside", re.IGNORECASE),
    re.compile(r"forget to send your gifts?", re.IGNORECASE),
    re.compile(r"you'?re on the list", re.IGNORECASE),
]

# Markers that identify the footer boundary where real article content ends
FOOTER_MARKERS = [
    "I make this Substack thanks to readers like you",
    "Invite your friends and earn rewards",
    "Get more from Nate",
    "Share this post",
]

log = logging.getLogger("nate_archiver")


# ------------------------------------------------------------------ auth

def get_service():
    """Authenticate and return a Gmail API service object."""
    creds: Credentials | None = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            log.info("Refreshing expired token...")
            creds.refresh(Request())
        else:
            if not CREDS_FILE.exists():
                log.error(
                    "Missing %s — download OAuth client credentials from "
                    "Google Cloud Console and save as credentials.json next "
                    "to this script. See README.md for setup steps.",
                    CREDS_FILE,
                )
                sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)
        TOKEN_FILE.write_text(creds.to_json())
        log.info("Saved auth token to %s", TOKEN_FILE)

    return build("gmail", "v1", credentials=creds)


# ------------------------------------------------------------------ manifest

def load_manifest() -> dict:
    if MANIFEST_FILE.exists():
        return json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
    return {"archived": {}, "prompts_queue": []}


def save_manifest(m: dict) -> None:
    MANIFEST_FILE.write_text(json.dumps(m, indent=2), encoding="utf-8")


# ------------------------------------------------------------------ gmail helpers

def list_message_ids(service, query: str) -> list[str]:
    """Return all message IDs matching the query (paginates through all pages)."""
    ids: list[str] = []
    page_token = None
    while True:
        resp = (
            service.users()
            .messages()
            .list(userId="me", q=query, pageToken=page_token, maxResults=500)
            .execute()
        )
        ids.extend(m["id"] for m in resp.get("messages", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return ids


def get_message_raw(service, msg_id: str) -> Message:
    """Fetch a message in RAW format and parse it with Python's email module."""
    resp = (
        service.users()
        .messages()
        .get(userId="me", id=msg_id, format="raw")
        .execute()
    )
    raw = base64.urlsafe_b64decode(resp["raw"].encode("ASCII"))
    return email.message_from_bytes(raw)


# ------------------------------------------------------------------ mime walking

def extract_bodies(msg: Message) -> tuple[str, str]:
    """Return (plaintext, html) body strings from a MIME message.

    Handles standard MIME parts (text/plain, text/html) AND Microsoft TNEF
    encapsulation (application/ms-tnef / winmail.dat), which is how Outlook
    serializes rich message content when syncing back to Gmail via IMAP.
    When an email arrives with only text/plain + application/ms-tnef parts,
    the real HTML body lives inside the TNEF blob and must be decoded.
    """
    text_body = ""
    html_body = ""

    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = str(part.get("Content-Disposition") or "")
            # TNEF parts carry Content-Disposition: attachment by convention —
            # don't skip them even though they ARE technically attachments.
            if "attachment" in disp.lower() and ctype != "application/ms-tnef":
                continue
            if ctype == "text/plain" and not text_body:
                text_body = _decode_part(part)
            elif ctype == "text/html" and not html_body:
                html_body = _decode_part(part)
            elif ctype == "application/ms-tnef" and not html_body:
                tnef_html = _decode_tnef_html(part)
                if tnef_html:
                    html_body = tnef_html
    else:
        ctype = msg.get_content_type()
        body = _decode_part(msg)
        if ctype == "text/plain":
            text_body = body
        elif ctype == "text/html":
            html_body = body

    return text_body, html_body


def _decode_tnef_html(part: Message) -> str:
    """Extract the HTML body from a TNEF-encapsulated (winmail.dat) MIME part.

    Outlook's IMAP round-trip wraps the original Gmail HTML body through
    three layers: TNEF container → LZFu-compressed RTF stream →
    MS-OXRTFEX \\fromhtml1 encapsulation. tnefparse 1.4+ auto-decompresses
    the LZFu layer, so tnef.rtfbody contains plain RTF. RTFDE's
    DeEncapsulator unwraps the \\fromhtml1 encapsulation back to the
    original HTML bytes.

    Resolution order:
      1. tnef.htmlbody     (uncommon — only when TNEF originated as HTML-
                            format Outlook mail, not round-tripped)
      2. tnef.rtfbody      (the typical Outlook-round-tripped case)
         → DeEncapsulator → HTML
      3. tnef.body         (plaintext fallback — loses CTA hrefs but
                            preserves prose for archival)

    Returns empty string if all three paths fail.
    """
    payload = part.get_payload(decode=True)
    if not payload:
        return ""

    try:
        from tnefparse import TNEF
    except ImportError:
        log.warning(
            "tnefparse not installed — cannot decode application/ms-tnef part. "
            "Run: pip install tnefparse"
        )
        return ""

    try:
        from RTFDE.deencapsulate import DeEncapsulator
    except ImportError:
        log.warning(
            "RTFDE not installed — cannot de-encapsulate RTF-wrapped HTML from TNEF. "
            "Run: pip install RTFDE"
        )
        DeEncapsulator = None  # type: ignore[assignment]

    # Silence tnefparse's internal error logging. decode_mapi can choke on
    # cp1252 vs UTF-8 mismatch when reading MAPI string properties — those
    # errors are harmless since we're not relying on htmlbody for the
    # Outlook-round-tripped case.
    tnef_logger = logging.getLogger("tnefparse")
    prev_level = tnef_logger.level
    tnef_logger.setLevel(logging.CRITICAL)

    html = ""
    try:
        try:
            tnef = TNEF(payload)
        except Exception as e:
            log.debug("TNEF parse failed: %s", e)
            return ""

        # Path 1: direct htmlbody (uncommon in Outlook-round-trip case)
        raw_html = getattr(tnef, "htmlbody", None)
        if raw_html:
            html = raw_html if isinstance(raw_html, str) else _decode_bytes(raw_html)
            log.debug("TNEF: extracted HTML via tnef.htmlbody (%d chars)", len(html))

        # Path 2: RTF-encapsulated HTML in rtfbody (the typical case)
        if not html and DeEncapsulator is not None:
            rtfbody = getattr(tnef, "rtfbody", None)
            if rtfbody:
                try:
                    rtf_obj = DeEncapsulator(rtfbody)
                    rtf_obj.deencapsulate()
                    if rtf_obj.content_type == "html" and rtf_obj.html:
                        raw = rtf_obj.html
                        html = raw if isinstance(raw, str) else _decode_bytes(raw)
                        log.debug(
                            "TNEF: extracted HTML via RTFDE de-encapsulation (%d chars)",
                            len(html),
                        )
                except Exception as e:
                    log.debug("RTFDE de-encapsulation failed: %s", e)

        # Path 3: plaintext body fallback
        if not html:
            plain = getattr(tnef, "body", None)
            if plain:
                html = plain if isinstance(plain, str) else _decode_bytes(plain)
                log.debug(
                    "TNEF: fell back to tnef.body plaintext (%d chars, no CTA hrefs)",
                    len(html),
                )
    finally:
        tnef_logger.setLevel(prev_level)

    return html


def _decode_bytes(data: bytes) -> str:
    """Decode bytes trying utf-8 first, then cp1252, then latin-1, then lossy utf-8."""
    for enc in ("utf-8", "cp1252", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _decode_part(part: Message) -> str:
    payload = part.get_payload(decode=True)
    if payload is None:
        return ""
    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except LookupError:
        return payload.decode("utf-8", errors="replace")


# ------------------------------------------------------------------ cleaning

INVISIBLE_PAD_CHARS = ("\u034f", "\u00ad")  # ͏ and soft hyphen
URL_RE = re.compile(r"https?://\S+")
BRACKETED_URL_RE = re.compile(r"\s*<https?://[^>]+>")


def clean_article_body(body: str, title: str) -> str:
    """Strip email chrome, tracking URLs, and padding to leave prose only."""
    lines = body.split("\n")
    cleaned: list[str] = []
    for line in lines:
        stripped = line.strip()
        # Drop URL-only lines
        if re.match(r"^\s*<?https?://", stripped) and len(stripped) > 50:
            continue
        # Drop invisible-padding lines
        if any(c in line for c in INVISIBLE_PAD_CHARS):
            continue
        # Strip inline bracketed URLs like "text <https://...>"
        line_c = BRACKETED_URL_RE.sub("", line)
        # Strip bare URLs from prose
        line_c = URL_RE.sub("", line_c)
        line_c = line_c.strip()
        if line_c or (cleaned and cleaned[-1]):
            cleaned.append(line_c)

    out = "\n".join(cleaned)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()

    # Trim top chrome by locating the title line
    if title:
        idx = out.find(title)
        if idx > 0:
            out = out[idx:]

    # Trim footer
    for marker in FOOTER_MARKERS:
        cut = out.find(marker)
        if cut > 0:
            out = out[:cut].rstrip()
            break

    return out


# ------------------------------------------------------------------ html parsing

# Nate's CTA links vary: "Grab the prompts", "Grab the prompt kit",
# "Grab the AI leverage audit", "Grab the 90-minute guide", "Download the prompts",
# "Get the prompts", etc. The common denominators are:
#  1. Anchor text starts with Grab/Get/Download/Access
#  2. The href is a Substack redirect with a UUID (the "prompts" redirect shape)
# We match on anchor text with loose content, then validate the href looks like
# a Substack UUID redirect (not a generic newsletter link).
_CTA_VERBS = r"(?:Grab|Get|Download|Access|Claim|Find)"
_SUBSTACK_UUID_REDIRECT_RE = re.compile(
    r"substack\.com/redirect/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    re.IGNORECASE,
)
# Nate's newer emails use the wrapped base64 form: /redirect/2/<base64-json>.
# Still a Substack-owned redirect; accepted as a valid prompts link.
_SUBSTACK_REDIRECT_2_RE = re.compile(
    r"substack\.com/redirect/2/[A-Za-z0-9_\-]+",
    re.IGNORECASE,
)
GRAB_PROMPTS_RE = re.compile(
    r'<a[^>]*href="([^"]+)"[^>]*>\s*(' + _CTA_VERBS + r'\s+[^<]{0,120})</a>',
    re.IGNORECASE,
)
# Loose-text variant: allows nested <span>/<strong> by matching anchor start-tag
# only and scanning forward; used as a fallback when the strict regex misses.
GRAB_PROMPTS_LOOSE_RE = re.compile(
    r'<a\b([^>]*)>(?:\s*<[^>]+>)*\s*(' + _CTA_VERBS + r'\s+[^<]{0,120})',
    re.IGNORECASE,
)
# Outlook / Microsoft Defender adds `originalsrc="..."` on every rewritten
# anchor, preserving the untouched pre-SafeLinks URL. Prefer it when present.
ORIGINALSRC_RE = re.compile(r'originalsrc="([^"]+)"', re.IGNORECASE)
HREF_RE = re.compile(r'\bhref="([^"]+)"', re.IGNORECASE)
SAFELINKS_HOST = "safelinks.protection.outlook.com"


def _unwrap_safelinks(href: str) -> str:
    """If href is a Microsoft SafeLinks wrapper, return the decoded inner url=."""
    if not href or SAFELINKS_HOST not in href:
        return href
    try:
        parsed = urlparse(href)
        qs = parse_qs(parsed.query)
        if "url" in qs:
            return unquote(qs["url"][0])
    except Exception:
        pass
    return href


def _resolve_substack_redirect(url: str) -> str | None:
    """Return url if it's a recognizable Substack prompts redirect, else None.

    Accepts two formats Nate's template has used:
      - substack.com/redirect/<uuid>         (direct UUID form, older template)
      - substack.com/redirect/2/<base64>     (wrapped form, newer template)
    """
    if not url:
        return None
    if _SUBSTACK_UUID_REDIRECT_RE.search(url):
        return url
    if _SUBSTACK_REDIRECT_2_RE.search(url):
        return url
    return None


def extract_prompts_redirect(html: str, debug_sink: list | None = None) -> str | None:
    """Find Nate's 'Grab/Get the [thing]' CTA and return the Substack redirect URL.

    Returns the FIRST anchor whose text starts with a CTA verb AND whose href
    (or originalsrc) resolves to a Substack redirect — UUID form OR the newer
    /redirect/2/<base64> wrapped form. This filters out generic nav links (e.g.
    'Get more from Nate', 'Get the app') that hit the Substack home or account
    pages instead of the content asset redirect.

    Resolution order for each candidate anchor:
      1. `originalsrc` attribute (set by Outlook SafeLinks, preserves pre-rewrite URL)
      2. `href` with SafeLinks unwrap applied if needed

    If `debug_sink` is provided and extraction fails while the HTML still
    contains a CTA-like phrase, the HTML is appended to the sink for analysis.
    """
    if not html:
        return None

    # Strategy 1: strict regex (anchor text without nested tags)
    for m in GRAB_PROMPTS_RE.finditer(html):
        resolved = _resolve_anchor(m.group(0), m.group(1))
        if resolved:
            return resolved

    # Strategy 2: loose regex (allows nested <span>/<strong> inside anchor)
    for m in GRAB_PROMPTS_LOOSE_RE.finditer(html):
        attrs = m.group(1)
        href_m = HREF_RE.search(attrs)
        href = href_m.group(1) if href_m else ""
        # Reconstruct the full anchor tag for originalsrc lookup
        anchor_stub = f"<a{attrs}>"
        resolved = _resolve_anchor(anchor_stub, href)
        if resolved:
            return resolved

    # Diagnostic: if the HTML clearly has a CTA phrase but we found nothing,
    # capture it so we can inspect why extraction failed.
    if debug_sink is not None and re.search(
        r"(?:Grab|Get|Download|Access|Claim|Find)\s+(?:the|my|your)\s+",
        html,
        re.IGNORECASE,
    ):
        debug_sink.append(html)

    return None


def _resolve_anchor(anchor_markup: str, href: str) -> str | None:
    """Given an anchor's markup and its href, return a prompts redirect URL or None.

    Tries originalsrc first (bypasses SafeLinks entirely), then href with
    SafeLinks unwrapped. Accepts both UUID and /redirect/2/ redirect shapes.
    """
    # Prefer originalsrc if Outlook preserved it
    orig_m = ORIGINALSRC_RE.search(anchor_markup or "")
    if orig_m:
        candidate = orig_m.group(1).replace("&amp;", "&")
        resolved = _resolve_substack_redirect(candidate)
        if resolved:
            return resolved

    # Fall back to href, unwrapping SafeLinks if needed
    href_clean = (href or "").replace("&amp;", "&")
    href_clean = _unwrap_safelinks(href_clean)
    return _resolve_substack_redirect(href_clean)


# ------------------------------------------------------------------ file writing

SLUG_RE = re.compile(r"[^a-z0-9]+")


def make_slug(subject: str, max_len: int = 80) -> str:
    s = subject.lower()
    s = SLUG_RE.sub("-", s)
    s = s.strip("-")
    return s[:max_len].rstrip("-")


def format_markdown(
    *,
    title: str,
    date_str: str,
    article_body: str,
    prompts_link: str | None,
    source_url: str | None,
    thread_id: str,
) -> str:
    prompts_line = (
        prompts_link if prompts_link else "(no prompts link found in this email)"
    )
    src_line = source_url if source_url else "(not detected)"
    header = (
        f"# {title}\n\n"
        f"**Author:** Nate\n"
        f"**Publication:** Nate's Substack\n"
        f"**Date:** {date_str}\n"
        f"**Gmail thread ID:** `{thread_id}`\n"
        f"**Source:** {src_line}\n"
        f"**Prompts link:** {prompts_line}\n\n"
        "---\n\n"
    )
    footer = (
        "\n\n---\n\n"
        "## Companion prompts\n\n"
        "If a prompts link is listed above, it points to a Substack redirect "
        "that lands on a Notion page with collapsible toggle blocks. Use "
        "Claude in Chrome (logged in) to follow the redirect, expand the "
        "toggles, and extract the prompt text.\n"
    )
    return header + article_body + footer


_SUBSTACK_POST_RE = re.compile(
    r"https?://(?:natesnewsletter\.substack\.com|open\.substack\.com/pub/natesnewsletter)/p/[a-z0-9\-]+",
    re.IGNORECASE,
)


def find_source_url(html: str, text: str) -> str | None:
    """Locate the canonical Substack post URL. Handles SafeLinks + base64 redirects."""
    for blob in (html or "", text or ""):
        # Direct match
        m = _SUBSTACK_POST_RE.search(blob)
        if m:
            return _normalize_substack_url(m.group(0))
        # URL-decoded match (SafeLinks wraps the real URL in a %-encoded query param)
        try:
            decoded = unquote(blob)
            m = _SUBSTACK_POST_RE.search(decoded)
            if m:
                return _normalize_substack_url(m.group(0))
        except Exception:
            pass
        # Substack's /redirect/2/<base64-json> pattern — decode and re-search
        for token in re.findall(r"/redirect/2/([A-Za-z0-9_\-]+)", blob):
            try:
                pad = "=" * (-len(token) % 4)
                decoded_json = base64.urlsafe_b64decode(token + pad).decode("utf-8", "replace")
                m = _SUBSTACK_POST_RE.search(decoded_json)
                if m:
                    return _normalize_substack_url(m.group(0))
            except Exception:
                continue
    return None


def _normalize_substack_url(url: str) -> str:
    """Normalize to the natesnewsletter.substack.com form and strip query strings."""
    url = url.split("?")[0].split("#")[0]
    url = re.sub(
        r"https?://open\.substack\.com/pub/natesnewsletter/p/",
        "https://natesnewsletter.substack.com/p/",
        url,
    )
    return url


# ------------------------------------------------------------------ main pipeline

def should_skip_subject(subject: str) -> bool:
    return any(p.search(subject) for p in SKIP_SUBJECT_PATTERNS)


def _decode_header(raw_value: str) -> str:
    """Decode RFC 2047 encoded-word headers like =?UTF-8?Q?...?= back to Unicode."""
    if not raw_value:
        return ""
    try:
        from email.header import decode_header, make_header
        return str(make_header(decode_header(raw_value)))
    except Exception:
        return raw_value


def process_message(
    service,
    msg_id: str,
    out_dir: Path,
    manifest: dict,
    dry_run: bool,
    debug_dump_dir: Path | None = None,
) -> str:
    """Process one Gmail message. Returns status string for logging."""
    raw_msg = get_message_raw(service, msg_id)
    subject = _decode_header(raw_msg.get("Subject") or "").strip()
    date_hdr = raw_msg.get("Date") or ""

    if should_skip_subject(subject):
        return f"skip (non-article): {subject[:60]}"

    # Parse date
    try:
        date_obj = email.utils.parsedate_to_datetime(date_hdr)
        if date_obj.tzinfo is None:
            date_obj = date_obj.replace(tzinfo=timezone.utc)
    except Exception:
        date_obj = datetime.now(timezone.utc)
    date_str = date_obj.strftime("%Y-%m-%d")

    text_body, html_body = extract_bodies(raw_msg)
    if not text_body and not html_body:
        return f"skip (empty body): {subject[:60]}"

    # Use plaintext for prose extraction; fall back to stripped html if missing
    article = clean_article_body(text_body or _strip_html(html_body), subject)
    if len(article) < 500:
        return f"skip (body too short, likely not an article): {subject[:60]}"

    debug_sink: list[str] = [] if debug_dump_dir is not None else None
    prompts_link = extract_prompts_redirect(html_body, debug_sink=debug_sink)
    source_url = find_source_url(html_body, text_body)

    # If extraction failed but the HTML looks like it should have had a CTA, dump
    # it so we can inspect the structure after the run completes.
    if debug_dump_dir is not None and debug_sink:
        try:
            debug_dump_dir.mkdir(parents=True, exist_ok=True)
            (debug_dump_dir / f"{date_str}_{msg_id}.html").write_text(
                debug_sink[0], encoding="utf-8"
            )
        except Exception as e:
            log.warning("debug dump failed for %s: %s", msg_id, e)

    slug = make_slug(subject)
    filename = f"{date_str}_{slug}.md"
    outpath = out_dir / filename

    md = format_markdown(
        title=subject,
        date_str=date_str,
        article_body=article,
        prompts_link=prompts_link,
        source_url=source_url,
        thread_id=msg_id,
    )

    if dry_run:
        return f"DRY-RUN would write: {filename} ({len(md)} chars)"

    out_dir.mkdir(parents=True, exist_ok=True)
    outpath.write_text(md, encoding="utf-8")

    manifest["archived"][msg_id] = {
        "subject": subject,
        "date": date_str,
        "file": str(outpath),
        "source_url": source_url,
        "prompts_link": prompts_link,
    }
    if prompts_link:
        manifest["prompts_queue"].append(
            {
                "thread_id": msg_id,
                "date": date_str,
                "subject": subject,
                "prompts_link": prompts_link,
                "resolved": False,
            }
        )

    return f"wrote: {filename}"


_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(html: str) -> str:
    text = _HTML_TAG_RE.sub("", html or "")
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"&lt;", "<", text)
    text = re.sub(r"&gt;", ">", text)
    text = re.sub(r"&#39;", "'", text)
    text = re.sub(r"&quot;", '"', text)
    return text


# ------------------------------------------------------------------ entry point

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Archive Nate's Substack articles from Gmail")
    parser.add_argument(
        "--since",
        default="2026-01-05",
        help="YYYY-MM-DD lower bound (Gmail 'after:' filter). Default: 2026-01-05",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help=f"Output directory for .md files. Default: {DEFAULT_OUT}",
    )
    parser.add_argument("--dry-run", action="store_true", help="Show what would happen without writing files")
    parser.add_argument(
        "--debug-dump",
        type=Path,
        default=None,
        help="Directory to dump HTML bodies of messages where prompts-link "
        "extraction failed but CTA-like text was found. Useful for diagnosing "
        "why a specific email wasn't captured.",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    # Gmail expects YYYY/MM/DD for after:
    since_slashes = args.since.replace("-", "/")
    query = f"from:{SENDER} after:{since_slashes}"
    log.info("Gmail query: %s", query)

    service = get_service()
    manifest = load_manifest()

    msg_ids = list_message_ids(service, query)
    log.info("Found %d matching messages", len(msg_ids))

    already = set(manifest["archived"].keys())
    new_ids = [m for m in msg_ids if m not in already]
    log.info("%d new (not in manifest), %d already archived", len(new_ids), len(msg_ids) - len(new_ids))

    wrote = 0
    skipped = 0
    errors = 0

    for i, mid in enumerate(new_ids, 1):
        try:
            status = process_message(
                service, mid, args.out, manifest, args.dry_run,
                debug_dump_dir=args.debug_dump,
            )
            log.info("[%d/%d] %s", i, len(new_ids), status)
            if status.startswith("wrote"):
                wrote += 1
            else:
                skipped += 1
            # Rate-limit gently against Gmail API quotas
            if i % 25 == 0:
                time.sleep(1.0)
        except HttpError as e:
            errors += 1
            log.error("[%d/%d] Gmail API error on %s: %s", i, len(new_ids), mid, e)
        except Exception as e:
            errors += 1
            log.exception("[%d/%d] Unexpected error on %s: %s", i, len(new_ids), mid, e)

    if not args.dry_run:
        save_manifest(manifest)

    log.info(
        "Done. wrote=%d skipped=%d errors=%d total_archived=%d prompts_queue=%d",
        wrote,
        skipped,
        errors,
        len(manifest["archived"]),
        len(manifest["prompts_queue"]),
    )
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
