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

### Nashir Facebook
Publish posts and reels.

### Nashir Instagram
Publish feed posts, reels, and stories.

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
