// Pure builders for the WhatsApp "Send Message" request (POST /api/v1/messages).
// No n8n runtime here, so the request shape is unit-tested directly
// (test/whatsapp-send-body.test.mjs). The node turns a SendBodyError into a
// NodeOperationError.

export class SendBodyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SendBodyError';
	}
}

export interface SendBodyInput {
	accountId: unknown;
	to: unknown;
	messageType: string;
	/** text */
	content?: unknown;
	/** image */
	imageUrl?: unknown;
	/** document */
	documentUrl?: unknown;
	filename?: unknown;
	/** video */
	videoUrl?: unknown;
	/** document / video: optional caption (sent as `content`) */
	caption?: unknown;
	/** template */
	templateId?: unknown;
	variables?: unknown;
	headerVariables?: unknown;
	buttonVariables?: unknown;
	headerMediaUrl?: unknown;
	dryRun?: unknown;
	idempotencyKey?: unknown;
	/** legacy "Media (Binary Upload)": what /api/v1/upload returned + the binary's metadata */
	uploadedUrl?: unknown;
	uploadedMimeType?: unknown;
	uploadedFileName?: unknown;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

function requireHttps(value: unknown, label: string): string {
	const url = str(value);
	if (!url) throw new SendBodyError(`${label} is required.`);
	if (!/^https:\/\/\S+$/i.test(url)) {
		throw new SendBodyError(`${label} must be a public https:// link (got "${url.slice(0, 80)}").`);
	}
	return url;
}

/**
 * A JSON field (n8n hands over a string, or an already-parsed value when an
 * expression resolved to an object/array). Empty → undefined (omitted).
 */
function parseJsonField(raw: unknown, label: string): unknown {
	if (raw === null || raw === undefined) return undefined;
	if (typeof raw !== 'string') return raw;
	const text = raw.trim();
	if (!text) return undefined;
	try {
		return JSON.parse(text);
	} catch (e) {
		throw new SendBodyError(`${label} is not valid JSON: ${(e as Error).message}`);
	}
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Body / header variables: ["Ali","20"] or {"1":"Ali","2":"20"}. Empty → undefined. */
export function parseVariables(raw: unknown, label: string): unknown[] | Record<string, unknown> | undefined {
	const v = parseJsonField(raw, label);
	if (v === undefined) return undefined;
	if (Array.isArray(v)) return v.length ? v : undefined;
	if (isPlainObject(v)) return Object.keys(v).length ? v : undefined;
	throw new SendBodyError(`${label} must be a JSON array like ["Ali","2026-12-15"] or an object like {"1":"Ali"}.`);
}

/** Button variables: {"0":"INV-1"} or, for carousel cards, {"card_0_1":"…"}. Empty → undefined. */
export function parseButtonVariables(raw: unknown, label = 'Button Variables'): Record<string, unknown> | undefined {
	const v = parseJsonField(raw, label);
	if (v === undefined || (Array.isArray(v) && v.length === 0)) return undefined;
	if (!isPlainObject(v)) {
		throw new SendBodyError(`${label} must be a JSON object keyed by button index, like {"0":"INV-1"}.`);
	}
	const keys = Object.keys(v);
	if (!keys.length) return undefined;
	const bad = keys.find((k) => !/^(\d+|card_\d+_\d+)$/.test(k));
	if (bad !== undefined) {
		throw new SendBodyError(
			`${label} key "${bad}" is not a button index. Use "0", "1", … or "card_<card>_<button>" for carousel cards.`,
		);
	}
	return v;
}

export function parseTemplateId(raw: unknown): number {
	const s = str(raw);
	if (!s) throw new SendBodyError('Template is required: pick a template or give its numeric id.');
	if (!/^[1-9]\d*$/.test(s) || !Number.isSafeInteger(Number(s))) {
		throw new SendBodyError(`Template must be a numeric template id (got "${s.slice(0, 40)}").`);
	}
	return Number(s);
}

/** Legacy binary "Media": the API kind for an uploaded file, from its MIME type. */
export function mediaKindForMime(mime: unknown): 'image' | 'video' | 'document' {
	const m = str(mime).toLowerCase();
	if (m.startsWith('image/')) return 'image';
	if (m.startsWith('video/')) return 'video';
	return 'document';
}

/**
 * The POST /api/v1/messages body for one send. `nashir_message_id` is added by
 * the node afterwards (unchanged since 0.17.0).
 */
export function buildSendMessageBody(input: SendBodyInput): Record<string, unknown> {
	const type = input.messageType;
	const body: Record<string, unknown> = { account_id: input.accountId, to: input.to, message_type: type };

	if (type === 'text') {
		body.content = input.content;
		return body;
	}

	if (type === 'image') {
		body.image_url = input.imageUrl;
		return body;
	}

	if (type === 'document' || type === 'video') {
		if (type === 'document') {
			body.document_url = requireHttps(input.documentUrl, 'Document URL');
			const filename = str(input.filename);
			if (filename) body.filename = filename;
		} else {
			body.video_url = requireHttps(input.videoUrl, 'Video URL');
		}
		const caption = str(input.caption);
		if (caption) body.content = caption;
		return body;
	}

	if (type === 'template') {
		body.template = { id: parseTemplateId(input.templateId) };
		const variables = parseVariables(input.variables, 'Body Variables');
		if (variables !== undefined) body.variables = variables;
		const headerVariables = parseVariables(input.headerVariables, 'Header Variables');
		if (headerVariables !== undefined) body.header_variables = headerVariables;
		const buttonVariables = parseButtonVariables(input.buttonVariables);
		if (buttonVariables !== undefined) body.button_variables = buttonVariables;
		if (str(input.headerMediaUrl)) body.header_media_url = requireHttps(input.headerMediaUrl, 'Header Media URL');
		if (input.dryRun === true) body.dry_run = true;
		const key = str(input.idempotencyKey);
		if (key) {
			if (key.length > 255) throw new SendBodyError('Idempotency Key must be at most 255 characters.');
			body.idempotency_key = key;
		}
		return body;
	}

	if (type === 'media') {
		// The server has no message_type "media" and no media_url field (what
		// ≤0.17.0 sent was always refused). The uploaded file goes out as the
		// kind its MIME type says, by its uploaded https link.
		const url = requireHttps(input.uploadedUrl, 'Uploaded media URL');
		const kind = mediaKindForMime(input.uploadedMimeType);
		body.message_type = kind;
		if (kind === 'image') body.image_url = url;
		else if (kind === 'video') body.video_url = url;
		else {
			body.document_url = url;
			const filename = str(input.uploadedFileName);
			if (filename) body.filename = filename;
		}
		return body;
	}

	throw new SendBodyError(`Unknown message type: ${type}`);
}

export interface TemplateListItem {
	id?: unknown;
	name?: unknown;
	language?: unknown;
	category?: unknown;
	sendable?: unknown;
	not_sendable_reason?: unknown;
}

/** Dropdown entries for GET /whatsapp/templates → "name (language) · category". */
export function templateOptions(items: unknown): Array<{ name: string; value: number; description?: string }> {
	if (!Array.isArray(items)) return [];
	const out: Array<{ name: string; value: number; description?: string }> = [];
	for (const raw of items as TemplateListItem[]) {
		if (!raw || typeof raw !== 'object') continue;
		const id = Number(raw.id);
		if (!Number.isSafeInteger(id) || id <= 0) continue;
		let name = `${str(raw.name) || `#${id}`} (${str(raw.language) || '?'})`;
		const category = str(raw.category);
		if (category) name += ` · ${category}`;
		if (raw.sendable === false) name += ` — not sendable: ${str(raw.not_sendable_reason) || 'unknown reason'}`;
		out.push({ name, value: id, description: `Template id ${id}` });
	}
	return out;
}
