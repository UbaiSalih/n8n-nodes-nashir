# Changelog

## 0.16.0 — 2026-07-20

### Added
- **Four CRM contact operations on `Nashir Contact`** — the node half of the
  nashir Phase-2 bot contract. They let an AI Agent read and update the CRM
  record for the person it is talking to, on **any** channel:
  - **Get Contact (CRM)** → `GET /api/v1/crm/contacts/by-channel` — lifecycle,
    the merchant's custom fields, tags (resolved to name/emoji/colour), CTWA ad
    source, and the open deal.
  - **Set Contact Field** → `POST /api/v1/crm/contacts/fields` — store one value
    the customer gave you. The field must already be defined by the merchant;
    unknown and reserved keys are rejected, and the value is validated against
    the field's declared type. An empty **Field Value** clears the field.
  - **Tag Contact** → `POST /api/v1/crm/contacts/tags` — **apply-only**
    add/remove by tag KEY. This cannot create tags: a model left free to invent
    them coins near-duplicates ("vip" / "v_i_p" / "vip_customer") and the
    merchant's segments quietly rot. Unknown keys are rejected.
  - **Set Lifecycle** → `POST /api/v1/crm/contacts/lifecycle` — move between
    lead / qualified / customer / inactive, validated server-side.

  All four identify the contact by **(Business ID, Channel, Channel ID)** rather
  than by phone, so they work on **WhatsApp, Facebook, Instagram and website
  chat** — unlike the two legacy phone-only ops. **Channel** takes the inbound
  webhook value as-is (`whatsapp_dm`, `facebook`, …); the server maps it, and an
  unrecognised value is rejected rather than guessed, because a guess would
  address a different contact. Every write is recorded on the contact's timeline
  as bot-attributed, so a merchant can always tell the bot's edits from staff.

  ⚠ **Wire Business ID / Channel / Channel ID from the webhook, never from the
  model.** n8n builds a tool's LLM-facing input schema *only* from `$fromAI()`
  calls in the node's parameters — with plain expressions (the documented
  wiring) that schema is empty, so the agent decides *whether* to call an op and
  never *who* it acts on. Adding `$fromAI()` to any of the three identity fields
  would let the model name a `business_id` / `channel_id` and write to an
  arbitrary contact. The placeholders show the correct expressions.

  Requires nashir.ai with the Phase-2 CRM endpoints deployed (2026-07-20), and
  the team must be inside the contact-fields rollout — otherwise these ops
  return **403 `feature_disabled`**.

### Changed
- The two legacy ops are **renamed for clarity only** — no behaviour change,
  values unchanged (`getContact`, `updateTags`), existing workflows keep working:
  - "Get Contact" → **"Get Contact (Legacy, WhatsApp Only)"**. It reads
    `whatsapp_contacts` and has always returned an **empty `custom_fields`**;
    the description now says so and points at Get Contact (CRM).
  - "Update Contact Tags" → **"Update Contact Tags (Legacy, WhatsApp Only)"**.
    Note its server-side CRM mirror became **apply-only on 2026-07-20**: the
    `whatsapp_contacts.tags` write is unchanged, but a tag name not already
    defined for the business is no longer created in CRM — it comes back in the
    response as `crm_skipped`. Use **Tag Contact** for the CRM path.

### Unchanged
- `N8N_STATUS_POLL_ENABLED` behaviour is untouched (still default-OFF on the
  host); this release carries no host-env change.
- No change to any other node, to the `nashirApi` credential, or to the existing
  `getConversationHistory` / `searchKnowledge` operations.

## 0.15.0 — 2026-07-13

### Added
- **Publish confirmation — every posting node now reflects REAL delivery, not
  just acceptance** (ticket #270, "Fix 2"). `POST /api/v1/posts` returns `201`
  at *schedule* time (`status='scheduled'`), long before the nashir cron
  actually publishes to the platform — so a bare `201` made the node go green
  even when the post later failed (the "green node" false positive; a 25 MB
  video to Instagram + Telegram silently failed while the node reported
  success). New shared helpers `nashirPublishPost` + `pollPostUntilTerminal`
  (`nodes/shared/api.ts`) poll `GET /api/v1/posts/{id}` after creation until the
  post reaches a terminal state: **published → node stays green** (returns the
  terminal row), **failed → node throws with the server's `last_error`** (node
  goes red), **wait-budget exhausted → node throws "not confirmed / still
  processing"** (never a false green). Wired into the Publish (and Schedule)
  operations of all 8 `POST /posts` call sites across Facebook, Instagram,
  LinkedIn, Telegram, Threads, TikTok, and YouTube.
- **Gated behind `N8N_STATUS_POLL_ENABLED`** — set that env var to `true` on the
  n8n host (ops-x9b) to turn it on. **Default OFF**: when the var is unset the
  nodes behave byte-identically to before (return the `201` body immediately),
  so deploying this code is a no-op until the flag is set. Genuinely
  future-scheduled posts (`scheduled_at` beyond ~now) are never polled — they
  return green immediately, since they won't publish during the execution.
  Poll defaults: 5 s interval, 6-minute total budget (sized for Instagram video
  transcode + publish across the cron's per-minute ticks).

## 0.14.4 — 2026-06-08

### Added
- **NashirContact → Search Knowledge Base** gains two optional fields,
  **Channel** (`platform`) and **Raw Customer Message** (`rawMessage`). When set,
  they are forwarded in the `/api/v1/knowledge/search` request body and logged on
  the server's `retrieval_logs` event (columns `platform` / `raw_message`,
  migration 0180). This powers the merchant-facing "Teach Your Bot" knowledge-gap
  list — so a missed question can show which channel it came in on and the
  customer's verbatim text (the `query` may have been rewritten upstream by a
  brand-first KB extraction). **Fully backward-compatible**: both fields default
  to empty and are omitted from the request when blank, so existing workflows
  behave byte-identically until wired.

## 0.14.3 — 2026-06-06

### Changed
- **NashirTikTok → "Publish Photos / Carousel"** now accepts a **single image**
  (minimum lowered from 2 to 1). TikTok's API publishes a 1-image photo post —
  empirically verified 2026-06-06 (init returned `ok` + `PUBLISH_COMPLETE` for
  `photo_images` of length 1); the old 2-image minimum was our own design choice,
  not a platform limit. One URL/binary = a single photo post; 2+ = a carousel.
  Auto-music (Add Music, default ON) applies to single photos too. For a single
  image the node now **omits** `post_type:'carousel'` so the server's carousel
  (≥2) validation doesn't reject it; 2+ images still send `post_type:'carousel'`
  unchanged. Pairs with the nashir.ai backend change allowing a 1-image `images`
  array for TikTok-only posts. **No change to other platforms' carousels** (FB/IG/
  LinkedIn still require ≥2). Universal Publisher template updated to route a
  single uploaded image to TikTok instead of skipping it.

## 0.14.2 — 2026-06-05

### Added
- **NashirTikTok → "Cover Frame (ms)"** (`video_cover_timestamp_ms`) on the
  **Publish Media** / **Schedule Media** (video) operations. A millisecond
  offset selecting which video frame becomes the post cover/thumbnail.
  **Default 2000 (2 seconds in.)** TikTok cannot accept a custom cover *image*
  via the API — only a frame timestamp — so this is the only cover control
  TikTok exposes. Sent as `tiktok_options.video_cover_timestamp_ms` for VIDEO
  media only (ignored for photo carousels). The backend publisher forwards it
  to TikTok's video init `post_info.video_cover_timestamp_ms`, **omitting it
  when absent** so non-node paths fall back to TikTok's first-frame default
  (no regression). Closes the standing P1 (TikTok cover-frame was never wired).

## 0.14.1 — 2026-06-05

### Added
- **NashirTikTok → "Add Music" toggle** (`photoAutoAddMusic`) on the **Publish
  Photos / Carousel** operation. When on (the **default**), TikTok automatically
  adds background music to the photo slideshow — sent as
  `tiktok_options.auto_add_music` (the backend already forwarded this for the
  PHOTO path). TikTok selects the track; a specific song can't be chosen via the
  API. Shown only for `publishPhotos` — video posts carry their own audio and
  TikTok's slideshow-music flag doesn't apply.

## 0.14.0 — 2026-06-04

### Added
- **Binary carousel support** for Facebook, Instagram, LinkedIn, and TikTok
  carousel / photo posts. The carousel operations now accept **uploaded image
  binaries** in addition to pasted URLs: when the "Carousel Image URLs" /
  "Image URLs" field is left empty, the node **auto-collects all `media*`
  binaries** on the input item (`media`, `media_0`, `media_1`, … — first =
  cover), uploads each via `/api/v1/upload`, and publishes them as a carousel.
  This lets the Universal Publisher workflow build carousels from uploaded files
  (previously only pre-pasted public URLs worked). Pasting comma-separated URLs
  still works unchanged — **backward compatible**.
  - Per-platform image-count limits enforced with clear errors:
    **Facebook 2-20, Instagram 2-10, LinkedIn 2-20, TikTok 2-35** (min 2 all).
  - Binary auto-collect is **images-only** — a non-image `media*` binary raises
    a clear error (a single video uses the video post type).
  - **LinkedIn personal pages**: native MultiImage carousels are
    organization-only. When a carousel targets a personal LinkedIn account, the
    node now detects it (via `/api/v1/accounts`) and **gracefully falls back to
    posting the first image as a single image** — with a `warning` in the node
    output — instead of failing.

### Known follow-up (Phase 2 — workflow rebuild)
- **TikTok photo format:** `/api/v1/upload` accepts WebP/GIF, but TikTok photo
  posts reject those formats (JPEG/PNG only). The nodes do not convert or
  pre-validate image format; the Phase 2 workflow validation should warn the
  user when a WebP/GIF is uploaded for a TikTok carousel.

## 0.13.9 — 2026-06-04

### Fixed
- **Regression (introduced across 0.13.2–0.13.8): media-URL fields showed a spurious
  "Parameter is required" error on existing nodes.** The carousel/photo PRs added
  comma-separated URL fields that were `required: true` with an empty default:
  - NashirLinkedIn → **Carousel Image URLs** (`carousel_images`)
  - NashirFacebook → **Carousel Image URLs** (`carousel_images`)
  - NashirInstagram → **Carousel Image / Video URLs** (`carousel_images`)
  - NashirTikTok → **Image URLs** (`photoImageUrls`)

  These are only shown for `postType: carousel` (or TikTok's **Publish Photos**
  operation). But when the controlling parameter is set via an **expression**
  (e.g. the Universal Publisher template's `postType` expression), n8n cannot
  evaluate the display condition at editor time, so it shows the field and flags
  the empty required value — surfacing a red **"Parameter … is required"** error on
  the LinkedIn/Facebook/Instagram/TikTok nodes regardless of the actual post type.

  **Fix:** removed `required: true` from those 4 fields (and from NashirLinkedIn's
  **Document Binary Property** for consistency — same conditional pattern, masked
  only by its non-empty `'data'` default). The fields remain scoped via
  `displayOptions`, and **execute-time validation is unchanged** — running a
  carousel/photo post without enough URLs still fails fast with a clear message
  (e.g. _"LinkedIn carousel needs at least 2 comma-separated image URLs"_). No
  behavior change for valid posts; the spurious editor error is gone.

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
