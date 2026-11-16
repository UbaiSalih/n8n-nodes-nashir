// Nashir WhatsApp → Show Typing (0.19.0): POST /api/v1/messages/typing.
// Pure helpers (no n8n imports) so they unit-test directly.

export class TypingInputError extends Error {}

type Json = Record<string, unknown>;

const asObj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);

function idFrom(v: unknown): string {
	if (typeof v === 'number' && Number.isFinite(v)) return String(v);
	return typeof v === 'string' ? v.trim() : '';
}

/**
 * The incoming message's id carried by an item: a Webhook node item
 * ({ body: { event, data: { message_id } } }), the webhook body itself
 * ({ data: { message_id } }), or an item that already is the data ({ message_id }).
 */
export function messageIdFromItem(json: unknown): string {
	const j = asObj(json);
	if (!j) return '';
	const body = asObj(j.body);
	return (
		idFrom(asObj(body?.data)?.message_id) ||
		idFrom(asObj(j.data)?.message_id) ||
		idFrom(j.message_id)
	);
}

/**
 * Which message to show typing for. The field wins; empty → the incoming item;
 * still empty → the node named "Webhook" (via `fromWebhookNode`, which may throw
 * when no such node exists — that is treated as "not found").
 */
export function resolveTypingMessageId(field: unknown, itemJson: unknown, fromWebhookNode: () => unknown): string {
	const explicit = idFrom(field);
	if (explicit) return explicit;
	const fromItem = messageIdFromItem(itemJson);
	if (fromItem) return fromItem;
	try {
		return idFrom(fromWebhookNode());
	} catch {
		return '';
	}
}

/** The request body. An all-digits id is a nashir inbox id; anything else is WhatsApp's message id. */
export function buildTypingBody(accountRaw: unknown, messageId: string): Record<string, unknown> {
	const account = idFrom(accountRaw);
	if (!/^[1-9]\d*$/.test(account)) {
		throw new TypingInputError('Account is required: choose the WhatsApp number the customer wrote to.');
	}
	if (!messageId) {
		throw new TypingInputError(
			'Message ID is required. Leave the field empty only when the incoming item is the message.received webhook ' +
				'(it carries data.message_id), or a node named "Webhook" received it.',
		);
	}
	return /^[1-9]\d*$/.test(messageId)
		? { account_id: Number(account), nashir_message_id: Number(messageId) }
		: { account_id: Number(account), message_id: messageId };
}
