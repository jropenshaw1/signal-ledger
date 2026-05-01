# Signal Ledger — Data Dictionary v0.1

**Status:** LOCKED — 2026-04-30
**LENS Chain Position:** Layer 3 of 6
**Depends On:** Charter v0.1 (OB: cfdd4870), Use Case Spec v0.1 (OB: 91c4c36e)
**Precedes:** Functional Spec v0.1
**Tag:** [signal-ledger:data-dictionary-v0.1]

---

## Storage Architecture (locked this session)

| Decision | Resolution |
|---|---|
| Storage engine | pgvector on existing OB Supabase instance (`blreixaevpbmhbhyqgbq.supabase.co`) |
| Table namespace | `sl_*` prefix — co-located with OB, isolated by naming convention |
| Dedicated Supabase project | Rejected — free tier inactivity pause (1 week) is a production liability at Signal Ledger's periodic ingestion cadence |
| OB role | Canonical state bus only — charter, specs, session handoffs, governance commits. No article bodies. |
| Write path | Dedicated Signal Ledger MCP (Supabase Edge Function, same pattern as OB MCP). Supabase first-party MCP rejected — context bloat, overly broad tool surface. |
| AegisRelay | Deferred to its own productionalization sprint. Signal Ledger v2 migration path when proven. |
| Embedding model | TBD — resolve in Functional Spec. Likely `text-embedding-3-small` (1536d). |
| Vector index | HNSW (pgvector) — better query performance than IVFFlat at v1 corpus scale |

---

## Entity Inventory

| ID | Entity | Table | Type | Notes |
|---|---|---|---|---|
| E1 | Article | `sl_articles` | Primary artifact | One record per ingested piece of content |
| E1a | CitedClaim | Embedded in `sl_articles.cited_claims` | JSONB array | Structured citations extracted from body |
| E1b | StructuredBlock | Embedded in `sl_articles.structured_technical_content` | JSONB array | Frameworks, models, methodologies |
| E2 | Prompt Kit | `sl_prompt_kits` | Extracted artifact | FK → E1 |
| E3 | Prompt Kit Evaluation Stamp | `sl_kit_evaluation_stamps` | Accumulating sub-record | FK → E2. Never overwritten. |
| E4 | Provider Record | `sl_provider_records` | First-class entity | One row v1 (Nate B. Jones) |
| E5 | Evaluative Session | `sl_evaluative_sessions` | Accumulating record | FK → E4. Never overwritten. |
| E6 | Gap Window | Embedded in `sl_provider_records.gap_windows` | JSONB array | Sub-record of E4 |

---

## E1 — ARTICLE (`sl_articles`)

| Field | Type | Required | Valid Values / Format | Description | Source |
|---|---|---|---|---|---|
| `article_id` | UUID | ✅ | System-generated | Stable identifier | A2 at ingestion |
| `provider_id` | UUID (FK → E4) | ✅ | Must match active Provider Record | Links article to provider | A2 at ingestion |
| `content_type` | Enum | ✅ | `Nate-feature-article` \| `Nate-executive-briefing` | Content classification. Historical previews carry `capture_completeness: preview-only`; retired `Nate-executive-briefing-preview` type not used for new records | A2 at ingestion |
| `title` | String | ✅ | Free text | Article title as published | Source (A3) |
| `published_date` | Date | ✅ | `YYYY-MM-DD` | Date of original publication — immutable provenance (P3) | Source (A3) |
| `ingestion_date` | Timestamptz | ✅ | ISO 8601 UTC | When A2 wrote the record | A2 at ingestion |
| `ingestion_source` | Enum | ✅ | `web` \| `email-backfill` | Acquisition path (P12) | A2 at ingestion |
| `capture_completeness` | Enum | ✅ | `complete` \| `preview-only` \| `partial` | Degree of content captured. `complete` = full body present. `preview-only` = paywall-gated, excerpt only. `partial` = degraded capture (truncation, rendering failure). | A2 at ingestion |
| `url` | String | ❌ | Valid URL or null | Canonical Substack URL. Null permitted for email-backfill records where URL is unresolvable. | Source (A3) |
| `body_text` | Text | Conditional | Non-empty when `capture_completeness` ≠ `preview-only` | Full article body as extracted. Verbatim. | Source (A3) |
| `embedding` | vector(1536) | ✅ | pgvector format | Semantic embedding of body_text (or title + excerpt for preview-only). Dimension TBD in Functional Spec. | A2 at ingestion |
| `author_signposts` | JSONB (Array\<String\>) | ❌ | Free text strings; empty array if none | A2-extracted phrases marking Nate's explicit rhetorical signals ("The key insight here…", "What I'm watching…"). P7 privileged targets. | A2 |
| `cited_claims` | JSONB (Array\<E1a\>) | ❌ | See E1a schema; empty array if none | Structured citations extracted from body. P8 first-class artifact. | A2 |
| `structured_technical_content` | JSONB (Array\<E1b\>) | ❌ | See E1b schema; empty array if none | Frameworks, models, named methodologies extracted from body. P8 first-class artifact. | A2 |

### E1a — CitedClaim (JSONB object schema)

| Field | Type | Required | Description |
|---|---|---|---|
| `claim_text` | String | ✅ | The claim as stated in the article |
| `attributed_to` | String | ❌ | Person, organization, or source cited by Nate. Null if uncited. |
| `claim_type` | Enum | ✅ | `statistic` \| `assertion` \| `prediction` \| `attribution` — extend post-backfill if additional types surface |

### E1b — StructuredBlock (JSONB object schema)

| Field | Type | Required | Description |
|---|---|---|---|
| `block_name` | String | ✅ | Name or label of the framework, model, or methodology |
| `block_type` | Enum | ✅ | `framework` \| `model` \| `methodology` \| `taxonomy` \| `heuristic` |
| `block_content` | Text | ✅ | Extracted content, verbatim or A2-paraphrased |
| `kit_candidate` | Boolean | ✅ | True if A2 flagged as prompt kit extraction candidate |

---

## E2 — PROMPT KIT (`sl_prompt_kits`)

| Field | Type | Required | Valid Values / Format | Description | Source |
|---|---|---|---|---|---|
| `kit_id` | UUID | ✅ | System-generated | Stable identifier | A2 at creation |
| `article_id` | UUID (FK → E1) | ✅ | Must match existing Article record | Source article | A2 at creation |
| `kit_name` | String | ✅ | Free text | Human-readable kit name | A2 at creation |
| `kit_content` | Text | ✅ | Prompt text | The extractable prompt or template | A2 at creation |
| `created_date` | Timestamptz | ✅ | ISO 8601 UTC | When kit was first written | A2 at creation |

*Evaluation stamps live in `sl_kit_evaluation_stamps` (E3), not embedded in this table. Query by `kit_id` to retrieve stamp history. Empty stamp set = unevaluated (default state).*

---

## E3 — PROMPT KIT EVALUATION STAMP (`sl_kit_evaluation_stamps`)

*Accumulating. One row per evaluation event. Never updated or deleted. Each A1 review appends a new row.*

| Field | Type | Required | Valid Values / Format | Description | Source |
|---|---|---|---|---|---|
| `stamp_id` | UUID | ✅ | System-generated | Stable identifier | A2 at write |
| `kit_id` | UUID (FK → E2) | ✅ | Must match existing Prompt Kit | Kit being evaluated | A2 at write |
| `stamp_date` | Date | ✅ | `YYYY-MM-DD` | Date A1 performed the evaluation | A1 declares → A2 writes |
| `execution_context` | String | ✅ | Free text | Session or situation in which the kit was executed (e.g., "LucidLink interview prep 2026-04-15"). Kit must have been executed — stamps are not written for unexecuted kits. | A1 |
| `repeat_disposition` | Enum | ✅ | `repeat-scheduled` \| `conditionally-deferred` \| `one-time` | A1's declared forward disposition. **Unevaluated is not a valid value — it is the structural absence of any stamp record.** | A1 |
| `notes` | String | ❌ | Free text | Optional A1 commentary on execution outcome | A1 |

---

## E4 — PROVIDER RECORD (`sl_provider_records`)

| Field | Type | Required | Valid Values / Format | Description | Source |
|---|---|---|---|---|---|
| `provider_id` | UUID | ✅ | System-generated | Stable identifier | A2 at creation |
| `provider_name` | String | ✅ | Free text | Human name of content provider | A1 |
| `platform` | Enum | ✅ | `Substack` (v1 only) | Publishing platform | A1 |
| `publication_name` | String | ❌ | Free text or null | Newsletter name if distinct from provider name | Source (A3) |
| `publication_url` | String | ❌ | Valid URL or null | Root URL of publication | Source (A3) |
| `subscription_tier` | Enum | ✅ | `free` \| `paid` | A1's subscription level at time of last update | A1 |
| `corpus_start_date` | Date | ✅ | `YYYY-MM-DD` | Earliest article date in scope. v1 = 2026-02-12. | A1 (Charter) |
| `article_count` | Integer | ✅ | ≥ 0 | Running count of ingested articles. Updated at each ingestion. | A2 |
| `last_ingestion_date` | Date | ❌ | `YYYY-MM-DD` or null | Date of most recent successful ingestion | A2 |
| `gap_windows` | JSONB (Array\<E6\>) | ❌ | See E6 schema; empty array if no gaps | Known ingestion gaps | A2 |

---

## E5 — EVALUATIVE SESSION (`sl_evaluative_sessions`)

*Accumulating. One row per evaluation event. Never updated or deleted.*

| Field | Type | Required | Valid Values / Format | Description | Source |
|---|---|---|---|---|---|
| `session_id` | UUID | ✅ | System-generated | Stable identifier | A2 at creation |
| `provider_id` | UUID (FK → E4) | ✅ | Must match existing Provider Record | Provider being evaluated | A2 |
| `session_date` | Date | ✅ | `YYYY-MM-DD` | Date A1 conducted the session | A1 declares → A2 writes |
| `tier_disposition` | Enum | ✅ | `maintain-current-tier` \| `upgrade-candidate` \| `degradation-signal` \| `abandon-signal` | A1's tier conclusion for this session | A1 |
| `evidence_summary` | Text | ✅ | Free text | A1's stated basis for the disposition. Required — disposition without stated evidence is not a valid record. | A1 |
| `notes` | String | ❌ | Free text | Optional extended commentary | A1 |

---

## E6 — GAP WINDOW (JSONB object schema, embedded in E4)

| Field | Type | Required | Valid Values / Format | Description | Source |
|---|---|---|---|---|---|
| `gap_start` | Date | ✅ | `YYYY-MM-DD` | First date of gap window | A1 or A2 detection |
| `gap_end` | Date | ✅ | `YYYY-MM-DD` | Last date of gap window (inclusive) | A1 or A2 detection |
| `article_count_estimated` | Integer | ❌ | ≥ 0 or null | Estimated articles published in window, if knowable | A1 or A2 |
| `resolution_status` | Enum | ✅ | `pending` \| `resolved` \| `unresolvable` | Default: `pending` at detection | A2; updated by A1 |
| `resolution_path` | Enum | ❌ | `web` \| `email-backfill` \| `none` or null | Path used or planned. Null until resolution attempted. | A1 |

*v1 known gap: 2026-02-12 through 2026-02-21 (~10 articles). resolution_path: email-backfill. resolution_status: pending.*

---

## Index Plan

| Table | Field(s) | Index Type | Retrieval Mode Served |
|---|---|---|---|
| `sl_articles` | `embedding` | HNSW (pgvector) | All semantic retrieval modes |
| `sl_articles` | `published_date` | B-tree | Targeted, Audit |
| `sl_articles` | `provider_id, content_type` | Composite B-tree | Filtered retrieval |
| `sl_articles` | `capture_completeness` | B-tree | Audit |
| `sl_kit_evaluation_stamps` | `kit_id, stamp_date` | Composite B-tree | Kit Status |
| `sl_evaluative_sessions` | `provider_id, session_date` | Composite B-tree | Evaluative longitudinal |

---

## Open Questions

| OQ ID | Question | Status |
|---|---|---|
| OQ-DD-01 | Storage format | **Closed** — pgvector on OB Supabase instance, `sl_*` tables |
| OQ-DD-02 | `body_text` storage — large article bodies in Postgres text column | **Deferred to Functional Spec** — Postgres text column expected to be sufficient; confirm at schema creation |
| OQ-DD-03 | CitedClaim `claim_type` exhaustiveness | **Low priority** — extend post-backfill sample if additional types surface |
| OQ-DD-04 | `article_count` maintenance pattern | **Closed** — native Postgres UPDATE on each ingestion; no OB round-trip required |
| OQ-DD-05 | Write path selection | **Closed** — dedicated Signal Ledger MCP (Supabase Edge Function). Supabase first-party MCP rejected (context bloat). AegisRelay deferred to its own sprint. |
