# Changelog

## 0.12.0 — 2026-05-30

### Added
- **Nashir Facebook / Nashir Instagram → Reply to Message**: optional **Image URL**
  parameter. When set, the node sends it as `image_url` to
  `POST /api/v1/messages/{id}/reply`; the backend posts it as a follow-up image
  attachment after the text bubble (reply-with-image). Must be a public HTTPS
  URL Meta can fetch. Backward-compatible — leaving it empty is text-only, so
  existing workflows are unaffected.

## 0.11.0 — 2026-05-15

### Changed
- **Nashir Contact → Search Knowledge Base operation**: the `limit` body
  parameter is no longer sent to `/api/v1/knowledge/search`. The nashir.ai
  backend now selects top-k internally based on rerank confidence:
  - `confidence: "high"` (top-1 rerank ≥ 0.85 and margin to #2 ≥ 0.30) →
    returns the top-1 chunk only
  - `confidence: "ambiguous"` (top-1 rerank ≥ 0.5 but not high) → returns
    the top-3 reranked chunks
  - `confidence: "no_match"` (top-1 rerank < 0.5) → returns an empty array
  - `confidence: "fallback"` (Cohere outage / timeout) → returns bi-encoder
    top-4 (current pre-0.11.0 behaviour)

  The response now includes a `confidence` field and each chunk includes
  an optional `rerank_score` so the AI agent can act on the confidence flag.

- The `Limit` field on the Search Knowledge Base operation is marked
  DEPRECATED in the node description but is kept on the UI so imported
  workflows continue to load without warnings. Its value is sent to the
  backend but ignored.

- For callers that need the legacy unranked behaviour (admin tools,
  debugging, A/B experiments), the backend accepts a `mode: "raw"` field
  with caller-specified `limit`. This is not surfaced on the n8n UI in
  v0.11.0 — pass it via an Expression on the body if you need it.
