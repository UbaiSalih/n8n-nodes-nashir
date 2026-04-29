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
| Send Message | Send text, template, or media message to a phone number |
| Reply to Message | Reply to a specific message by ID |
| Get Messages | Retrieve recent WhatsApp messages |
| Mark as Read | Mark a message as read |
| **Get Conversation History** | Fetch the last N messages for a phone number |
| **Get AI Status** | Check if AI auto-reply is active or paused for a conversation |
| **Set AI Status** | Pause or resume AI auto-reply for a conversation |
| **Save Message to Inbox** | Store an external message in nashir.ai (ingest) |
| **Get Contact** | Fetch contact details by phone number |

### Nashir Contact

| Operation | Description |
|-----------|-------------|
| Get Contact | Fetch contact details by phone number |
| **Update Contact Tags** | Add tags to a contact (idempotent, comma-separated) |
| **Get Conversation History** | Fetch recent messages by sender id for AI agent context (cross-platform: FB / IG / WhatsApp) |

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
