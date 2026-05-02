// =============================================================================
// Signal Ledger — shared types
// Source of truth for all function input/output and DB-adjacent shapes.
// Keep this in sync with sl_mcp_tool_signatures_v1.md and db/schema/.
// =============================================================================

// ---------------------------------------------------------------------------
// Domain enumerations (mirror DB CHECK constraints)
// ---------------------------------------------------------------------------

export type IngestionSource     = 'web' | 'email-backfill';
export type CaptureCompleteness = 'complete' | 'preview-only' | 'partial';
export type ContentType         = 'Nate-feature-article' | 'Nate-executive-briefing';
export type EmbeddingStatus     = 'pending' | 'processing' | 'complete' | 'failed';

/** Seven pipeline-stage event types — Functional Spec §3, migration 001. */
export type EventType =
  | 'ingestion_started'
  | 'ingestion_succeeded'
  | 'ingestion_failed'
  | 'embedding_queued'
  | 'embedding_succeeded'
  | 'embedding_failed'
  | 'retry_attempted';

export type EventStatus =
  | 'success'
  | 'failed'
  | 'partial'
  | 'preview-only'
  | 'duplicate-detected'
  | 'resolved'
  | 'unresolvable';

export type SourceVsSystemClassification =
  | 'source-not-provided'
  | 'system-failed'
  | 'unknown'
  | 'not-applicable';

export type FailureCategory =
  | 'paywall'
  | 'rendering-failure'
  | 'network-error'
  | 'parse-error'
  | 'missing-email'
  | 'schema-drift'
  | 'duplicate'
  | 'unknown';

// ---------------------------------------------------------------------------
// Error codes (Functional Spec §4)
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'DUPLICATE_ARTICLE'
  | 'VALIDATION_ERROR'
  | 'SCHEMA_VIOLATION'
  | 'EMBEDDING_FAILURE'
  | 'RATE_LIMITED'
  | 'TRANSIENT_DB_ERROR'
  | 'SYSTEM_ERROR';

// ---------------------------------------------------------------------------
// MCP tool: sl_ingest_article
// ---------------------------------------------------------------------------

export interface ContentPayload {
  title:                string;
  published_date:       string;            // YYYY-MM-DD
  capture_completeness: CaptureCompleteness;
  body_text?:           string;            // null/absent iff capture_completeness = preview-only
}

export interface IngestArticleInput {
  provider_id:        string;              // uuid
  ingestion_source:   IngestionSource;
  url?:               string;             // required when ingestion_source = web
  content_payload?:   ContentPayload;     // required when ingestion_source = email-backfill
  retry_of_event_id?: string;             // uuid — links retry chain; Step 6
  gap_window_id?:     string;             // resolves gap on success; Step 7
}

export interface IngestArticleOutput {
  article_id:           string;           // uuid
  event_id:             string;           // uuid — ingestion_succeeded | ingestion_failed event
  capture_completeness: CaptureCompleteness;
  status:               'success' | 'partial' | 'preview-only' | 'duplicate-detected' | 'failed';
  failure_category?:    FailureCategory;
  gap_resolved?:        boolean;          // Step 7 — always false in Step 2
}

// ---------------------------------------------------------------------------
// Capture event write params
// ---------------------------------------------------------------------------

export interface WriteCaptureEventParams {
  provider_id:                     string;
  article_id:                      string | null;
  event_type:                      EventType;
  event_status:                    EventStatus;
  ingestion_source:                IngestionSource;
  attempted_url?:                  string | null;
  attempted_title?:                string | null;
  attempted_published_date?:       string | null;
  source_vs_system_classification: SourceVsSystemClassification;
  failure_category?:               FailureCategory | null;
  retry_count?:                    number;
  raw_error?:                      string | null;
  event_notes?:                    string | null;
}

// ---------------------------------------------------------------------------
// Standard response envelope (Functional Spec §4)
// ---------------------------------------------------------------------------

export interface ErrorShape {
  error_code: ErrorCode;
  message:    string;
  retryable:  boolean;
  event_id:   string | null;
}

export interface SuccessEnvelope<T> {
  success: true;
  data:    T;
  error:   null;
}

export interface ErrorEnvelope {
  success: false;
  data:    null;
  error:   ErrorShape;
}

export type ApiResponse<T> = SuccessEnvelope<T> | ErrorEnvelope;
