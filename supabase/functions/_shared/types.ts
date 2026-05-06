// =============================================================================
// Signal Ledger — shared types (Data Dictionary v0.3 column alignment)
// Keep in sync with docs/sl_mcp_tool_signatures_v1.md (tool envelope) and
// supabase/migrations — sl_* DDL.
// =============================================================================

// ---------------------------------------------------------------------------
// Domain enumerations (mirror DB CHECK constraints)
// ---------------------------------------------------------------------------

export type IngestionSource       = 'web' | 'email-backfill';
export type CaptureCompleteness   = 'complete' | 'preview-only' | 'partial';
export type ContentType           = 'Nate-feature-article' | 'Nate-executive-briefing';
export type EmbeddingStatus       = 'pending' | 'processing' | 'complete' | 'failed';

/** Functional Spec §3 — pipeline-stage event types stored in sl_capture_events.event_type */
export type EventType =
  | 'ingestion_started'
  | 'ingestion_succeeded'
  | 'ingestion_failed'
  | 'embedding_queued'
  | 'embedding_succeeded'
  | 'embedding_failed'
  | 'retry_attempted';

/** Functional Spec §4 — surfaced in API error envelopes and sl_capture_events.error_code */
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
  title:                 string;
  published_date:        string; // YYYY-MM-DD
  capture_completeness: CaptureCompleteness;
  body_text?:            string;
  /** RFC 2822 Message-ID — preferred stable id for external_id derivation */
  message_id?:           string;
}

export interface IngestArticleInput {
  provider_id:         string;
  ingestion_source:    IngestionSource;
  url?:                string;
  content_payload?:    ContentPayload;
  retry_of_event_id?:  string;
  /** Natural key helper: "{gap_start}_{gap_end}" (YYYY-MM-DD each) */
  gap_window_id?:      string;
}

export type IngestArticleStatus =
  | 'success'
  | 'partial'
  | 'preview-only'
  | 'duplicate-detected'
  | 'failed';

export type FailureCategory =
  | 'paywall'
  | 'rendering-failure'
  | 'network-error'
  | 'parse-error'
  | 'missing-email'
  | 'schema-drift'
  | 'duplicate'
  | 'unknown';

export interface IngestArticleOutput {
  article_id:            string;
  event_id:              string;
  capture_completeness: CaptureCompleteness;
  status:               IngestArticleStatus;
  failure_category?:    FailureCategory;
  gap_resolved?:        boolean;
}

// ---------------------------------------------------------------------------
// sl_capture_events write (DD v0.3 § E7)
// ---------------------------------------------------------------------------

export interface WriteCaptureEventParams {
  provider_id:         string;
  article_id:          string | null;
  event_type:          EventType;
  /** Required when event_type is ingestion_failed or embedding_failed (DB + FS §4). */
  error_code?:         ErrorCode | null;
  retry_of_event_id?:  string | null;
  duration_ms?:        number | null;
  /**
   * Diagnostic / audit extension (FS v1.1 §4 — RATE_LIMITED sub-case).
   * MUST NOT contain secrets or service-role material (ADR-003).
   */
  metadata?:           Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Gap windows — JSON entries in sl_provider_records.gap_windows (DD v0.3 § E6)
// ---------------------------------------------------------------------------

/** Status inside each gap JSON object (lifecycle). */
export type GapWindowLifecycleStatus =
  | 'open'
  | 'acknowledged'
  | 'resolved'
  | 'unresolvable';

export type GapTerminalStatus = 'resolved' | 'unresolvable';

export type GapResolutionPath = 'web' | 'email-backfill' | 'none';

/** One element of sl_provider_records.gap_windows JSONB array */
export interface GapWindowEntry {
  start_date:                string;
  end_date:                  string;
  provider_id:               string;
  status:                   GapWindowLifecycleStatus;
  article_count_estimated?:  number | null;
  resolution_path?:         GapResolutionPath | null;
  resolution_notes?:        string | null;
  last_updated:             string;
}

// ---------------------------------------------------------------------------
// sl_resolve_gap_window
// ---------------------------------------------------------------------------

export interface ResolveGapWindowInput {
  provider_id:         string;
  gap_start:           string;
  gap_end:             string;
  resolution_status:   GapTerminalStatus;
  resolution_path:     GapResolutionPath;
  notes?:              string;
}

export interface ResolveGapWindowOutput {
  provider_id:         string;
  gap_start:           string;
  gap_end:             string;
  resolution_status:   GapTerminalStatus;
  resolution_path:     GapResolutionPath;
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
