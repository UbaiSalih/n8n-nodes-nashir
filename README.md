# n8n-nodes-nashir

n8n community nodes for [nashir.ai](https://nashir.ai) — publish to Facebook, Instagram, TikTok, LinkedIn, YouTube, WhatsApp and Telegram, and manage AI-driven conversations.

> Requires nashir.ai API v0.3.0+ for conversation management operations.

## Installation

In your n8n instance, go to **Settings → Community Nodes → Install** and enter:

```
n8n-nodes-nashir
```

## Nodes

### Nashir WhatsApp

| Operation | Description |
|-----------|-------------|
| Send Message | Send a text, an approved template, an image, a document or a video to a phone number |
| Reply to Message | Reply to a specific message by ID |
| Get Messages | Retrieve recent WhatsApp messages |
| Mark as Read | Mark a message as read |
| **Show Typing** | Show WhatsApp’s “typing…” to the customer while your workflow prepares the reply |
| **Get Conversation History** | Fetch the last N messages for a phone number |
| **Get AI Status** | Check if AI auto-reply is active or paused for a conversation |
| **Set AI Status** | Pause or resume AI auto-reply for a conversation |
| **Save Message to Inbox** | Store an external message in nashir.ai (ingest) |
| **Get Contact** | Fetch contact details by phone number |

#### Send Message — message types

| Message Type | What it sends | When it is allowed |
|--------------|---------------|--------------------|
| Text | Plain text (**Content**) | Inside the 24-hour customer-service window |
| Template | An approved WhatsApp template | Any time, to any number (subject to opt-out and number health) |
| Image (by URL) | A JPEG / PNG by public https link | Inside the 24-hour window |
| Document (by URL) | A file by public https link (**Document URL**, optional **File Name** and **Caption**) | Inside the 24-hour window |
| Video (by URL) | A video by public https link (**Video URL**, optional **Caption**) | Inside the 24-hour window |
| Media (Binary Upload) | Uploads a binary file, then sends it as an image, video or document according to its MIME type | Inside the 24-hour window |

For Image / Document / Video, WhatsApp fetches the link itself, so it must be a
public `https://` address. Document and Video also need the inbox-media feature
to be on for your nashir.ai team; the API answers `inbox_media_not_enabled`
otherwise.

**Template**

1. Choose the **Account**, then pick the template in **Template Name or ID**.
   The list shows the approved templates of that number as
   `name (language) · category`. A template the API cannot send is marked
   `— not sendable: <reason>`.
2. To set the template from an expression, give its numeric id — the `id`
   field of `GET /api/v1/whatsapp/templates?account_id=<account id>` (the same
   list the dropdown reads). When Account is an expression the dropdown is
   empty; use the id.
3. Fill in the values the template needs (leave a field empty when the template
   has nothing there):

| Field | JSON | Example |
|-------|------|---------|
| Body Variables | array in order, or object keyed `"1"`, `"2"`, … | `["Ali","2026-12-15"]` or `{"1":"Ali","2":"2026-12-15"}` |
| Header Variables | same shape, for a text header | `["Ali"]` |
| Button Variables | object keyed by button index; `card_<card>_<button>` for carousel cards | `{"0":"INV-1"}` / `{"card_0_1":"SKU-9"}` |
| Header Media URL | plain https link (not JSON) for an image / video / document header | `https://example.com/invoice.pdf` |

The number of values must match the template; the API answers
`variable_count_mismatch` with the expected counts otherwise. Invalid JSON is
refused by the node before any request is made.

> ⚠ **Dry Run (Preview Only)** is OFF by default. When you turn it ON the API
> checks the template, the values and the recipient and returns
> `{ "dry_run": true, "preview": { … } }` — **nothing is sent to the customer**.
> Turn it OFF again to really send.

**Idempotency Key** (optional): a unique text for this send, for example
`order-1042-confirmation`. Repeating the request with the same key does not send
the message twice.

#### Show Typing

Shows WhatsApp’s “typing…” to the customer, for example right after the Webhook
node and before a slow AI step. It calls `POST /api/v1/messages/typing`.

- **Account**: the WhatsApp number the customer wrote to.
- **Message ID**: leave it empty to use the incoming message — the item’s
  `body.data.message_id` (the `message.received` webhook), or a node named
  **Webhook**. You can also give a WhatsApp message id (`wamid.…`) or a
  nashir.ai inbox id.

Four rules:

1. It marks the message read (blue ticks). WhatsApp has no typing without that.
2. It lasts up to 25 seconds or until you reply, whichever comes first.
3. Use it only if you will reply.
4. If your workflow runs longer than 25 seconds, call it again. A repeat for the
   same message within 5 seconds sends nothing new and answers with the seconds
   left (`"repeated": true`).

The API refuses with a coded error instead of pretending to succeed, for example
`chat_controlled` (409) when a person on your team holds the chat,
`not_inbound` for your own reply, or `message_not_found`. Needs nashir.ai with
the typing endpoint (live from November 2026).

### Nashir Contact

| Operation | Description |
|-----------|-------------|
| Get Contact | Fetch contact details by phone number |
| **Update Contact Tags** | Add tags to a contact (idempotent, comma-separated) |
| **Get Conversation History** | Fetch recent messages by sender id for AI agent context (cross-platform: FB / IG / WhatsApp) |
| **Search Knowledge Base** | Find relevant knowledge chunks from the business's knowledge base for AI agent context (server-side embedding) |

### Nashir Facebook

| Operation | Description |
|-----------|-------------|
| Publish Post | Publish a post / reel to a Facebook Page |
| Schedule Post | Schedule a post for later |
| Get Posts | List posts published via nashir.ai |
| Delete Post | Remove a post from the page |
| Get Comments | List comments received on Page posts |
| Reply to Comment | Reply to a Page comment |
| **Delete Comment** | Delete a Page comment via the team's page token (used by AI moderation) |
| Get Messages | List inbound Messenger messages |
| Reply to Message | Reply to a Messenger thread |

### Nashir Instagram

| Operation | Description |
|-----------|-------------|
| Publish Post | Publish a feed post / reel / story / carousel |
| Schedule Post | Schedule a post for later |
| Get Posts | List posts published via nashir.ai |
| Delete Post | Remove a post |
| Get Comments | List comments received on IG media |
| Reply to Comment | Reply to an IG comment |
| **Delete Comment** | Delete an IG comment via the team's page token (used by AI moderation) |
| Get Messages | List inbound DMs |
| Reply to Message | Reply to a DM thread |

### Nashir TikTok
Publish video and photo posts (Direct Post API).

### Nashir LinkedIn
Publish posts and articles.

### Nashir YouTube
Upload and schedule videos.

### Nashir Telegram
Send messages and media to Telegram channels/groups.

## Credentials

Create a **Nashir API** credential with your API key from [nashir.ai/settings](https://nashir.ai/settings).

The credential supports an optional **Base URL** field (default: `https://nashir.ai`) — override this for self-hosted or staging environments.

## Example: Conversation History Lookup

This workflow fetches the last 10 messages for an inbound WhatsApp number and passes them to an AI node:

1. **Webhook** — receives a WhatsApp message (phone in `body.phone`)
2. **Nashir WhatsApp** → *Get Conversation History*
   - Phone: `={{ $json.body.phone }}`
   - Limit: `10`
3. **AI Agent** — receives the message array as context
4. **Nashir WhatsApp** → *Set AI Status* (pause while agent replies)
   - Phone: `={{ $json.body.phone }}`
   - Action: `pause`
   - Reason: `Human-in-the-loop`

---

## Changelog

### 0.6.1 — Apr 2026

**Fix: `Nashir Contact` is now wireable as an AI Agent tool**

- Added `usableAsTool: true` to `Nashir Contact`'s node description. n8n requires this flag on community nodes for `ai_tool` connections to survive workflow import. Without it, dropping `Nashir Contact → Search Knowledge Base` into an Agent's tools input was silently rejected on re-import (the connection lived in the JSON but the n8n UI rendered the agent disconnected).
- Symptom this fixes: importing the **AI Auto Reply v2** template with 0.6.0 left the four KB nodes floating, agents showed no Tool / Chat Model / Memory wiring. Update to 0.6.1, re-import the template, wiring renders correctly.
- No API change — workflows and credentials migrate cleanly. Operation surface is unchanged from 0.6.0.

### 0.6.0 — Apr 2026

**New operation: Search Knowledge Base on `Nashir Contact`**

- **Search Knowledge Base** on `Nashir Contact` — retrieve the top N most relevant chunks from the team's knowledge base. The customer passes plain text; nashir.ai handles embedding (OpenAI `text-embedding-3-small`) and vector similarity server-side. No `OPENAI_API_KEY` or Supabase credentials needed in n8n.
- Inputs: `query` (required — the customer's question or topic) and `kbLimit` (default 4, max 10).
- Returns `{ chunks: [{ id, content, metadata, similarity }, ...], count }`.
- Backed by `POST /api/v1/knowledge/search` on nashir.ai.
- Used by the v2 AI Auto Reply template to replace the four `Supabase Vector Store` + `OpenAI Embeddings` node pairs — knowledge retrieval is now a single nashir-native call.

### 0.5.0 — Apr 2026

**New operation: Get Conversation History on `Nashir Contact`**

- **Get Conversation History** on `Nashir Contact` — fetch the last N messages exchanged with a sender across any platform (FB Messenger, IG Direct, FB/IG comments, WhatsApp). Returns chronological `{ role, content, created_at }` rows ready to inject into an AI agent prompt.
- Inputs: `senderId` (required — the platform-specific sender id from the inbound webhook payload) and `limit` (default 20, max 50).
- Backed by `GET /api/v1/conversations/by-sender/:sender_id?limit=N` on nashir.ai.
- Used by the v2 AI Auto Reply template to replace the n8n `memoryBufferWindow` step — history is now persisted server-side in `inbox_messages` and shared across workflow executions.

### 0.4.0 — Apr 2026

**New operation: Delete Comment (Facebook + Instagram)**

- **Delete Comment** on `Nashir Facebook` and `Nashir Instagram` — removes a comment via Meta Graph using the team's page token, looked up server-side. No `META_PAGE_ACCESS_TOKEN` env var required in n8n.
- Auto-resolves the account/page from the stored comment row — only the `commentId` (nashir.ai message id) is needed. No account dropdown.
- Idempotent: re-deleting an already-removed comment returns `{ success: true, already_deleted: true }`.
- Recoverable Meta errors (`not_found`, `permission_denied`) return `{ success: false, error, detail }` with HTTP 200 so the workflow can continue. Token / network errors return HTTP 502 so n8n surfaces them.
- Backed by `POST /api/v1/comments/:id/delete` on nashir.ai.
- Bumped Meta Graph API version to `v25.0` for both reply and delete endpoints.

### 0.3.0 — Apr 2026

**New WhatsApp operations**

- **Get Conversation History** — fetch last N messages for a phone (`GET /api/v1/conversations/:phone/messages?limit=N`)
- **Get AI Status** — check if AI is paused/active for a conversation (`GET /api/v1/conversations/:phone/ai-status`)
- **Set AI Status** — pause or resume AI auto-reply with optional reason (`POST /api/v1/conversations/:phone/ai-toggle`)
- **Save Message to Inbox** — store external messages in nashir.ai with role, media type, and `is_from_ai` flag (`POST /api/v1/messages/ingest`)
- **Get Contact** — fetch contact details by phone number (`GET /api/v1/contacts/:phone`)

**New Contact node**

- **Update Contact Tags** — add tags to a contact, idempotent, comma-separated input (`POST /api/v1/contacts/:phone/tags`)

**Improvements**

- Configurable Base URL in credentials (default `https://nashir.ai`, override for dev/staging)
- Friendly error messages: 401/403 → clear auth error, 404 → context-aware not-found message
- Full TypeScript types for all response shapes

### 0.2.2 — Apr 2026

**TikTok node — full Direct Post API compliance update**

- `privacy_level` now required field with 3 options: Public to Everyone, Friends Only, Only Me
- Interactions renamed to "Allow Comments / Allow Duet / Allow Stitch" (all default `false` per TikTok guidelines)
- `brand_content_toggle` renamed to **Content Disclosure** in UI
- Removed `FOLLOWER_OF_CREATOR` privacy option (not supported by Direct Post API)

### 0.2.1 — Mar 2026

- TikTok node: add `brand_content_toggle`, `brand_organic_toggle`, `brand_branded_content_toggle`
- TikTok node: carousel support via comma-separated image URLs
- YouTube node: `madeForKids`, `tags`, `category`, `license`, `notifySubscribers`, `comments` fields

### 0.2.0 — Feb 2026

- Initial release: Facebook, Instagram, TikTok, LinkedIn, YouTube, WhatsApp, Telegram nodes
