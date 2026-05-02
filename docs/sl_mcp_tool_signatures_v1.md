# Signal Ledger — MCP Tool Signatures v1

**Status:** LOCKED — 2026-05-01 | Amended — 2026-05-01 (Gee constraint review pass)
**Gee verdict:** Proceed with 11. No `sl_execute_sql`. No exposed `sl_record_capture_event`. No exposed `sl_update_provider_record`.
**Depends On:** Charter v0.1, Use Case Spec v0.1, Data Dictionary v0.1, Pre-Functional-Spec Amendment v0.1
**Precedes:** Functional Spec v0.1, MCP Edge Function implementation

**Amendment log:**
- 2026-05-01: Five required corrections applied per Gee constraint review (fixes 1–5).
  Two minor clarifications applied (framing asymmetry, content_payload polymorphism).

---

## Governance Notes

- `sl_capture_events` is written automatically by ingestion, retry, and audit-detection workflows. It is not an exposed MCP tool.
- `sl_provider_records` receives controlled side-effect updates (`article_count`, `last_ingestion_date`, `gap_windows`) via ingestion and gap tools. No exposed update tool in v1.
- All tool signatures use JSON. Required fields have no default. Optional fields marked `?`.
- `content_payload` is polymorphic by `ingestion_source`. Strict per-source schema validation is required at the edge function layer — v1 does not support hybrid ingestion (see Fix 1 note under `sl_ingest_article`).

---

## Family 1 — Ingestion (2 tools)

---

### `sl_ingest_article`

**Maps to:** UC-01 (web), UC-02 (email-backfill)
**Side effects:** writes `sl_articles`, `sl_capture_events`, `sl_signpost_embeddings`; increments `sl_provider_records.article_count`; updates `sl_provider_records.last_ingestion_date`; resolves gap window if `gap_window_id` supplied

```json
{
  "tool": "sl_ingest_article",
  "input": {
    "provider_id":        "uuid — required",
    "ingestion_source":   "enum — required — web | email-backfill",
    "url":                "string — required when ingestion_source = web; optional for email-backfill",
    "content_payload": {
      "title":            "string — required when ingestion_source = email-backfill",
      "published_date":   "date YYYY-MM-DD — required when ingestion_source = email-backfill",
      "capture_completeness": "enum — required when content_payload is present — complete | preview-only | partial",
      "body_text":        "string — full article body; required unless content_payload.capture_completeness = preview-only"
    },
    "retry_of_event_id?": "uuid — event_id of the prior failed capture event being retried",
    "gap_window_id?":     "string — gap window identifier to resolve on successful ingestion"
  },
  "output": {
    "article_id":         "uuid",
    "event_id":           "uuid — capture event written internally",
    "capture_completeness": "enum",
    "status":             "enum — success | partial | preview-only | duplicate-detected | failed",
    "failure_category?":  "enum — populated on failed or partial status",
    "gap_resolved?":      "boolean"
  }
}
```

**Validation rules:**
- `url` required if `ingestion_source = web`
- `content_payload` must not be supplied when `ingestion_source = web` — v1 does not support hybrid ingestion; web content is fetched by the system from `url`
- `content_payload.title` and `content_payload.published_date` required if `ingestion_source = email-backfill`
- `content_payload.capture_completeness` required when `content_payload` is present
- `content_payload.body_text` required unless `content_payload.capture_completeness = preview-only`
- Duplicate detection: if `(provider_id, title, published_date)` already exists, return `duplicate-detected` without writing a new article row; still writes a capture event

---

### `sl_resolve_gap_window`

**Maps to:** UC-02 (gap resolution side effect), UC-05 (audit)
**Side effects:** updates `gap_windows` JSONB in `sl_provider_records`; writes `sl_capture_events`

```json
{
  "tool": "sl_resolve_gap_window",
  "input": {
    "provider_id":          "uuid — required",
    "gap_start":            "date YYYY-MM-DD — required",
    "gap_end":              "date YYYY-MM-DD — required",
    "resolution_status":    "enum — required — resolved | unresolvable",
    "resolution_path":      "enum — required — web | email-backfill | none",
    "notes?":               "string"
  },
  "output": {
    "provider_id":          "uuid",
    "gap_start":            "date",
    "gap_end":              "date",
    "resolution_status":    "enum",
    "resolution_path":      "enum"
  }
}
```

---

## Family 2 — Retrieval (6 tools)

Provenance rule: every retrieval response surfaces `article_id`, `title`, and `published_date` with each result. Non-negotiable — Charter P3.

---

### `sl_retrieve_targeted`

**Maps to:** UC-03
**Retrieval target:** specific article, claim, signpost, or passage by reference

```json
{
  "tool": "sl_retrieve_targeted",
  "input": {
    "query":                "string — required — title, date, topic, keyword, or claim text",
    "provider_id?":         "uuid",
    "date_from?":           "date YYYY-MM-DD",
    "date_to?":             "date YYYY-MM-DD",
    "content_type?":        "enum — Nate-feature-article | Nate-executive-briefing",
    "target?":              "enum — article | claim | signpost | structured_block — default: article",
    "limit?":               "integer — default 5, max 20"
  },
  "output": {
    "results": [
      {
        "article_id":       "uuid",
        "title":            "string",
        "published_date":   "date",
        "content_type":     "enum",
        "result_type":      "enum — article | claim | signpost | structured_block — canonical type of this result",
        "matched_content":  "string — body excerpt, claim text, signpost text, or block content",
        "match_target":     "enum — article | claim | signpost | structured_block",
        "sub_entry_id?":    "uuid — claim_id | signpost_id | block_id when result_type is not article",
        "source_span?":     "string — optional positional reference within body_text (e.g. paragraph index or character offset)",
        "score":            "float — cosine similarity"
      }
    ],
    "total_returned":       "integer"
  }
}
```

**Contract note:** `result_type` is the canonical field for client branching logic. `match_target` is retained for backward compatibility but `result_type` takes precedence. All result objects include both fields; values will be identical.

---

### `sl_retrieve_inferential`

**Maps to:** UC-04 (inferential sub-mode)
**Retrieval target:** Nate's positions and conclusions across time; temporal deltas preserved

```json
{
  "tool": "sl_retrieve_inferential",
  "input": {
    "query":                "string — required — question about Nate's position or argument",
    "provider_id?":         "uuid",
    "date_from?":           "date YYYY-MM-DD",
    "date_to?":             "date YYYY-MM-DD",
    "limit?":               "integer — default 10, max 30"
  },
  "output": {
    "synthesis":            "string — A2-generated synthesis of Nate's position across results",
    "temporal_delta?":      "string — noted where perspective shifted across time",
    "sources": [
      {
        "article_id":       "uuid",
        "title":            "string",
        "published_date":   "date",
        "relevant_excerpt": "string",
        "claim_id?":        "uuid — if result is claim-level"
      }
    ]
  }
}
```

---

### `sl_retrieve_framing`

**Maps to:** UC-04 (framing sub-mode)
**Retrieval target:** how Nate constructs arguments — signposts, rhetorical patterns, structured frameworks

```json
{
  "tool": "sl_retrieve_framing",
  "input": {
    "query":                "string — required — rhetorical pattern, lens, or framing question",
    "provider_id?":         "uuid",
    "date_from?":           "date YYYY-MM-DD",
    "date_to?":             "date YYYY-MM-DD",
    "target?":              "enum — signpost | structured_block | both — default: both",
    "limit?":               "integer — default 10, max 30"
  },
  "output": {
    "framing_summary":      "string — A2-generated summary of rhetorical construction",
    "sources": [
      {
        "article_id":       "uuid",
        "title":            "string",
        "published_date":   "date",
        "signposts":        ["array of matched signpost_text strings — empty array when target = structured_block"],
        "structured_blocks": [
          {
            "block_id":     "uuid",
            "block_name":   "string",
            "block_type":   "enum",
            "block_content": "string"
          }
        ]
      }
    ]
  }
}
```

**Contract note:** `signposts` and `structured_blocks` are always present in each source object. When `target = signpost`, `structured_blocks` returns an empty array. When `target = structured_block`, `signposts` returns an empty array. When `target = both` (default), both arrays are populated with matched results only. Callers must not treat an empty array as an error condition.

---

### `sl_retrieve_audit`

**Maps to:** UC-05
**Retrieval target:** corpus coverage, completeness, gaps, duplicates, ingestion health

```json
{
  "tool": "sl_retrieve_audit",
  "input": {
    "provider_id?":           "uuid — defaults to all providers",
    "date_from?":             "date YYYY-MM-DD",
    "date_to?":               "date YYYY-MM-DD",
    "audit_scope":            "array — one or more of: coverage | completeness | gaps | duplicates | ingestion-health — required",
    "include_orphan_events?": "boolean — include sl_capture_events with null article_id in ingestion_health — default: true"
  },
  "output": {
    "provider_id":          "uuid",
    "date_range": {
      "from":               "date",
      "to":                 "date"
    },
    "coverage": {
      "total_articles":     "integer",
      "by_content_type":    "object — keyed by content_type",
      "by_capture_completeness": "object — keyed by completeness value"
    },
    "gaps": [
      {
        "gap_start":        "date",
        "gap_end":          "date",
        "resolution_status": "enum",
        "resolution_path?": "enum"
      }
    ],
    "ingestion_health": {
      "total_events":           "integer — includes orphan events (article_id = null) when include_orphan_events = true",
      "orphan_event_count":     "integer — events with null article_id; always returned regardless of include_orphan_events",
      "by_status":              "object — keyed by event_status",
      "failure_categories":     "object — keyed by failure_category",
      "source_vs_system":       "object — keyed by source_vs_system_classification — Charter P9/P11"
    },
    "audit_notes":          "string — A2-generated plain-language coverage summary"
  }
}
```

**Contract note:** `ingestion_health` MUST include all `sl_capture_events` within the date range, including events where `article_id = null` (pre-article failures: URL failures, parse failures, missing emails). Excluding orphan events produces a false-clean audit — the pipeline can be broken while coverage looks intact. `orphan_event_count` is always returned in `ingestion_health` regardless of `include_orphan_events` to surface this distinction. `source_vs_system` breakdown satisfies Charter P9/P11 (source honesty) and is always included when `ingestion-health` is in scope.

---

### `sl_retrieve_evaluative`

**Maps to:** UC-06
**Retrieval target:** corpus evidence for provider tier assessment; longitudinal session history

```json
{
  "tool": "sl_retrieve_evaluative",
  "input": {
    "provider_id":          "uuid — required",
    "date_from?":           "date YYYY-MM-DD",
    "date_to?":             "date YYYY-MM-DD",
    "limit?":               "integer — article results, default 10, max 30"
  },
  "output": {
    "provider_summary": {
      "provider_id":        "uuid",
      "provider_name":      "string",
      "subscription_tier":  "enum",
      "article_count":      "integer",
      "corpus_start_date":  "date",
      "last_ingestion_date": "date"
    },
    "session_history": [
      {
        "session_id":       "uuid",
        "session_date":     "date",
        "tier_disposition": "enum",
        "evidence_summary": "string",
        "evidence_refs?":   "array"
      }
    ],
    "corpus_evidence": [
      {
        "article_id":       "uuid",
        "title":            "string",
        "published_date":   "date",
        "content_type":     "enum",
        "relevant_excerpt": "string"
      }
    ]
  }
}
```

---

### `sl_retrieve_kit_status`

**Maps to:** UC-07
**Retrieval target:** prompt kit inventory by lifecycle/evaluation state

```json
{
  "tool": "sl_retrieve_kit_status",
  "input": {
    "provider_id?":           "uuid",
    "filter_disposition?":    "enum — repeat-scheduled | conditionally-deferred | one-time | unevaluated",
    "due_before?":            "date YYYY-MM-DD — return repeat-scheduled kits with next_run_date on or before this date",
    "include_trigger_based?": "boolean — include repeat-scheduled kits where next_run_date is null and trigger_condition is set — default: true",
    "limit?":                 "integer — default 20, max 50"
  },
  "output": {
    "kits": [
      {
        "kit_id":           "uuid",
        "kit_name":         "string",
        "article_id":       "uuid",
        "article_title":    "string",
        "published_date":   "date",
        "lifecycle_state":  "enum — unevaluated | repeat-scheduled | conditionally-deferred | one-time",
        "latest_stamp": {
          "stamp_id":       "uuid",
          "stamp_date":     "date",
          "execution_context": "string",
          "repeat_disposition": "enum",
          "next_run_date?": "date",
          "trigger_condition?": "string",
          "review_after_date?": "date",
          "notes?":         "string"
        }
      }
    ],
    "total_returned":       "integer",
    "unevaluated_count":    "integer",
    "trigger_based_count":  "integer — count of repeat-scheduled kits with no next_run_date; always returned"
  }
}
```

**Contract note:** Trigger-based kits are `repeat-scheduled` kits where `next_run_date` is null and `trigger_condition` is set. When `due_before` is supplied, date-based kits are filtered by `next_run_date`; trigger-based kits are included separately (governed by `include_trigger_based`, default true) and are never silently excluded. `trigger_based_count` is always returned in the output to surface operational visibility regardless of filter state. Suppressing trigger-based kits via `include_trigger_based = false` is an explicit caller choice, not a default.

---

## Family 3 — Lifecycle (3 tools)

---

### `sl_record_kit_evaluation_stamp`

**Maps to:** UC-08
**Side effects:** appends row to `sl_kit_evaluation_stamps`; never overwrites

```json
{
  "tool": "sl_record_kit_evaluation_stamp",
  "input": {
    "kit_id":               "uuid — required",
    "stamp_date":           "date YYYY-MM-DD — required",
    "execution_context":    "string — required — session or situation in which kit was executed",
    "repeat_disposition":   "enum — required — repeat-scheduled | conditionally-deferred | one-time",
    "next_run_date?":       "date — required when repeat_disposition = repeat-scheduled and no trigger_condition supplied; must be absent when repeat_disposition = one-time",
    "trigger_condition?":   "string — required when repeat_disposition = conditionally-deferred; must be absent when repeat_disposition = one-time",
    "review_after_date?":   "date",
    "notes?":               "string"
  },
  "output": {
    "stamp_id":             "uuid",
    "kit_id":               "uuid",
    "stamp_date":           "date",
    "repeat_disposition":   "enum"
  }
}
```

**Validation rules:**
- `next_run_date` required when `repeat_disposition = repeat-scheduled` and no `trigger_condition` supplied
- `trigger_condition` required when `repeat_disposition = conditionally-deferred`
- `next_run_date` must be absent (null or omitted) when `repeat_disposition = one-time`
- `trigger_condition` must be absent (null or omitted) when `repeat_disposition = one-time`
- Stamp is only written on explicit A1 declaration after kit execution — not on kit capture

---

### `sl_record_evaluative_session`

**Maps to:** UC-06
**Side effects:** appends row to `sl_evaluative_sessions`; never overwrites

```json
{
  "tool": "sl_record_evaluative_session",
  "input": {
    "provider_id":          "uuid — required",
    "session_date":         "date YYYY-MM-DD — required",
    "tier_disposition":     "enum — required — maintain-current-tier | upgrade-candidate | degradation-signal | abandon-signal",
    "evidence_summary":     "string — required — A1's stated basis for disposition",
    "evidence_refs?": [
      {
        "ref_type":         "enum — article | claim | structured_block | prompt_kit | capture_event",
        "ref_id":           "uuid",
        "article_id?":      "uuid",
        "published_date?":  "date",
        "reason":           "string — why this evidence mattered"
      }
    ],
    "notes?":               "string"
  },
  "output": {
    "session_id":           "uuid",
    "provider_id":          "uuid",
    "session_date":         "date",
    "tier_disposition":     "enum"
  }
}
```

---

### `sl_get_provider_record`

**Maps to:** UC-09
**Side effects:** none — read-only

```json
{
  "tool": "sl_get_provider_record",
  "input": {
    "provider_id?":         "uuid — optional in v1 (single provider); defaults to Nate B. Jones record"
  },
  "output": {
    "provider_id":          "uuid",
    "provider_name":        "string",
    "platform":             "enum",
    "publication_name?":    "string",
    "publication_url?":     "string",
    "subscription_tier":    "enum",
    "corpus_start_date":    "date",
    "article_count":        "integer",
    "last_ingestion_date?": "date",
    "gap_windows": [
      {
        "gap_start":        "date",
        "gap_end":          "date",
        "article_count_estimated?": "integer",
        "resolution_status": "enum",
        "resolution_path?": "enum"
      }
    ]
  }
}
```

---

## Internal-Only (not exposed as MCP tools)

| Function | Caller | Notes |
|---|---|---|
| Write `sl_capture_events` | `sl_ingest_article`, `sl_resolve_gap_window` | Automatic on every ingestion attempt and gap resolution |
| Update `sl_provider_records.article_count` | `sl_ingest_article` | Incremented on `status = success` |
| Update `sl_provider_records.last_ingestion_date` | `sl_ingest_article` | Updated on `status = success` |
| Update `sl_provider_records.gap_windows` | `sl_resolve_gap_window` | JSONB array mutation |

---

## Tool Count Verification

| Family | Tools |
|---|---|
| Ingestion | 2 |
| Retrieval | 6 |
| Lifecycle | 3 |
| **Total** | **11** |

---

## Amendment Log

| Date | Author | Change |
|---|---|---|
| 2026-05-01 | Gee (review) + Claude (applied) | Fix 1: `sl_ingest_article` — scoped `capture_completeness` and `body_text` validation to `content_payload`; added rule rejecting `content_payload` when `ingestion_source = web` |
| 2026-05-01 | Gee (review) + Claude (applied) | Fix 2: `sl_retrieve_audit` — added `include_orphan_events` input; `orphan_event_count` and `source_vs_system` always returned in `ingestion_health`; added orphan-events contract note |
| 2026-05-01 | Gee (review) + Claude (applied) | Fix 3: `sl_retrieve_targeted` — added `result_type` as canonical output field; added optional `source_span`; added contract note on `result_type` vs `match_target` precedence |
| 2026-05-01 | Gee (review) + Claude (applied) | Fix 4: `sl_retrieve_kit_status` — added `include_trigger_based` input (default true); added `trigger_based_count` to output; added contract note on trigger-based kit visibility |
| 2026-05-01 | Gee (review) + Claude (applied) | Fix 5: `sl_record_kit_evaluation_stamp` — added validation rules rejecting `next_run_date` and `trigger_condition` when `repeat_disposition = one-time` |
| 2026-05-01 | Gee (review) + Claude (applied) | Minor: `sl_retrieve_framing` — documented empty array semantics for unused `signposts` / `structured_blocks` fields |
| 2026-05-01 | Gee (review) + Claude (applied) | Minor: governance note added on `content_payload` polymorphism and per-source strict validation requirement |
