import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import { nashirApiRequest } from '../shared/api';

// n8n types getNodeParameter as `string`, but at runtime the value can be a
// number, boolean, or null — e.g. when an AI Agent invokes this as a tool, or
// when an expression like `{{ $json.body.business_id }}` resolves to a JSON
// number. Calling .trim() / .split() on a non-string then throws
// "this.getNodeParameter(...).trim is not a function".
function paramAsString(value: unknown): string {
	if (value === null || value === undefined) return '';
	return typeof value === 'string' ? value : String(value);
}

/** Comma-separated list → trimmed, de-duplicated, non-empty entries. */
function csvList(raw: string): string[] {
	return Array.from(
		new Set(
			raw
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean),
		),
	);
}

/**
 * Shared identity parse for the CRM ops: business_id must be a positive integer.
 *
 * Validated HERE rather than left to the server because the common wiring
 * mistake — an expression that resolves to '' or 'undefined' because the node
 * name in `$('Webhook')` is wrong — otherwise reaches nashir.ai as a 400
 * "business_id is required", which reads like a server problem. Failing at the
 * node names the actual cause. Mirrors the existing searchKnowledge check.
 */
function crmBusinessId(ctx: IExecuteFunctions, i: number): number {
	const raw = paramAsString(ctx.getNodeParameter('crmBusinessId', i)).trim();
	const businessId = parseInt(raw, 10);
	if (!Number.isFinite(businessId) || businessId <= 0) {
		throw new Error(
			`businessId must be a positive integer, got "${raw}" — wire it from the webhook, e.g. {{ $('Webhook').first().json.body.business_id }}`,
		);
	}
	return businessId;
}

export class NashirContact implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Nashir Contact',
		name: 'nashirContact',
		icon: 'file:nashir.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Manage contacts and retrieve knowledge from nashir.ai',
		defaults: { name: 'Nashir Contact', color: '#6366f1' },
		// Required for n8n's AI Agent to accept this node as a tool source.
		// Without it, ai_tool connections from this node are rejected on
		// import (e.g. Search Knowledge Base wired into an agent's tools input).
		usableAsTool: true,
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'nashirApi', required: true }],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Get Contact (Legacy, WhatsApp Only)',
						value: 'getContact',
						action: 'Get contact details (legacy)',
						description:
							'Legacy WhatsApp-only lookup by phone. Reads whatsapp_contacts and always returns an EMPTY custom_fields object — use "Get Contact (CRM)" for lifecycle, custom fields, tags, ad source and deal.',
					},
					{
						name: 'Update Contact Tags (Legacy, WhatsApp Only)',
						value: 'updateTags',
						action: 'Add tags to a contact (legacy)',
						description:
							'Legacy WhatsApp-only tag write by phone. Writes whatsapp_contacts.tags; its CRM mirror is apply-only since 2026-07-20, so a tag name that is not already defined for the business is reported back and not created. Use "Tag Contact" for the CRM path.',
					},
					{
						name: 'Get Conversation History',
						value: 'getConversationHistory',
						action: 'Fetch recent messages with a contact for AI agent context',
					},
					{
						name: 'Search Knowledge Base',
						value: 'searchKnowledge',
						action: "Find relevant knowledge from the business's knowledge base for AI agent context",
						description:
							"Find relevant knowledge from the business's knowledge base for AI agent context",
					},
					{
						name: 'Get Contact (CRM)',
						value: 'getContactCrm',
						action: 'Read the CRM contact for this conversation',
						description:
							'Read lifecycle, custom fields, tags, ad source and the open deal for the contact on this channel. Cross-platform (WhatsApp / Facebook / Instagram / website chat).',
					},
					{
						name: 'Set Contact Field',
						value: 'setContactField',
						action: 'Write one custom field on the CRM contact',
						description:
							'Store a value the customer gave you. The field must already be defined by the merchant in nashir.ai → CRM settings; unknown keys are rejected.',
					},
					{
						name: 'Tag Contact',
						value: 'tagContact',
						action: 'Add or remove CRM tags on the contact',
						description:
							"Apply tags the merchant has already defined. Apply-only — this cannot create new tags, and unknown tag keys are rejected.",
					},
					{
						name: 'Set Lifecycle',
						value: 'setLifecycle',
						action: 'Move the CRM contact to a lifecycle stage',
						description:
							'Move the contact between lead / qualified / customer / inactive.',
					},
				],
				default: 'getContact',
			},

			// ── Shared: phone ────────────────────────────────────────────────────────
			{
				displayName: 'Phone Number',
				name: 'phone',
				type: 'string',
				default: '',
				required: true,
				placeholder: '+1234567890',
				description: 'Phone number of the contact in international format',
				displayOptions: { show: { operation: ['getContact', 'updateTags'] } },
			},

			// ── Update Tags fields ───────────────────────────────────────────────────
			{
				displayName: 'Tags',
				name: 'tags',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'vip, arabic, lead',
				description: 'Comma-separated list of tags to apply to the contact (idempotent)',
				displayOptions: { show: { operation: ['updateTags'] } },
			},

			// ── Shared: CRM contact identity ─────────────────────────────────────────
			// The four CRM ops address a contact by (business_id, channel, channel_id)
			// — the same unique key the inbound webhook upserts on, so the row is
			// guaranteed to exist by the time the agent runs.
			//
			// ⚠ WIRE THESE FROM THE WEBHOOK, NEVER FROM THE MODEL. n8n builds a tool's
			// LLM-facing input schema ONLY from $fromAI() calls in the parameters; with
			// plain expressions (as below) the schema is empty, so the agent decides
			// WHETHER to call the op and never WHO it acts on. Introducing $fromAI()
			// on any of these three would let the model name a business_id/channel_id
			// — i.e. write to an arbitrary contact, or another business's contact.
			{
				displayName: 'Business ID',
				name: 'crmBusinessId',
				type: 'string',
				default: '',
				required: true,
				placeholder: "={{ $('Webhook').first().json.body.business_id }}",
				description:
					'Business that owns the contact. Wire from the webhook payload; must belong to the team that owns the API key.',
				displayOptions: {
					show: { operation: ['getContactCrm', 'setContactField', 'tagContact', 'setLifecycle'] },
				},
			},
			{
				displayName: 'Channel',
				name: 'crmChannel',
				type: 'string',
				default: '',
				required: true,
				placeholder: "={{ $('Webhook').first().json.body.platform }}",
				description:
					'Channel the conversation is on. Pass the webhook value straight through — both the inbound vocabulary (whatsapp_dm / facebook / instagram / website_chat) and the CRM vocabulary (whatsapp / …) are accepted; the server maps it. An unrecognized value is rejected rather than guessed, because a guess would address a different contact.',
				displayOptions: {
					show: { operation: ['getContactCrm', 'setContactField', 'tagContact', 'setLifecycle'] },
				},
			},
			{
				displayName: 'Channel ID',
				name: 'crmChannelId',
				type: 'string',
				default: '',
				required: true,
				placeholder: "={{ $('Webhook').first().json.body.sender_id }}",
				description:
					'Platform-specific sender id from the inbound webhook — WhatsApp phone, Facebook PSID, Instagram IGSID, or website-chat visitor id.',
				displayOptions: {
					show: { operation: ['getContactCrm', 'setContactField', 'tagContact', 'setLifecycle'] },
				},
			},

			// ── Set Contact Field ────────────────────────────────────────────────────
			{
				displayName: 'Field Key',
				name: 'fieldKey',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'shoe_size',
				description:
					'Key of a custom field the merchant has defined (nashir.ai → CRM settings). Unknown or reserved keys are rejected — this op fills the merchant\'s schema, it does not extend it.',
				displayOptions: { show: { operation: ['setContactField'] } },
			},
			{
				displayName: 'Field Value',
				name: 'fieldValue',
				type: 'string',
				default: '',
				placeholder: '42',
				description:
					'Value to store. Sent as text; the server coerces and validates against the field\'s declared type (number / date / list option / …) and rejects a mismatch. Leave empty to CLEAR the field.',
				displayOptions: { show: { operation: ['setContactField'] } },
			},

			// ── Tag Contact ──────────────────────────────────────────────────────────
			{
				displayName: 'Add Tags',
				name: 'addTags',
				type: 'string',
				default: '',
				placeholder: 'vip, wants_delivery',
				description:
					'Comma-separated tag KEYS to add (not display names). Apply-only: every key must already exist for the business or the whole call is rejected.',
				displayOptions: { show: { operation: ['tagContact'] } },
			},
			{
				displayName: 'Remove Tags',
				name: 'removeTags',
				type: 'string',
				default: '',
				placeholder: 'awaiting_reply',
				description: 'Comma-separated tag keys to remove from the contact',
				displayOptions: { show: { operation: ['tagContact'] } },
			},

			// ── Set Lifecycle ────────────────────────────────────────────────────────
			{
				displayName: 'Stage',
				name: 'stage',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'qualified',
				description:
					'Lifecycle stage: lead, qualified, customer or inactive. Validated server-side against the allowed set; an unknown stage is rejected.',
				displayOptions: { show: { operation: ['setLifecycle'] } },
			},

			// ── Get Conversation History fields ──────────────────────────────────────
			// Cross-platform: senderId is whatever Meta / WhatsApp sent in the inbound
			// webhook payload (FB/IG numeric user id, WA phone, etc.). The backend
			// scopes the query to this team's rows automatically.
			{
				displayName: 'Sender ID',
				name: 'senderId',
				type: 'string',
				default: '',
				required: true,
				placeholder: '={{ $json.body.sender_id }}',
				description:
					'Platform-specific sender id from the inbound webhook (FB/IG user id or WhatsApp phone). Used as the lookup key in inbox_messages.',
				displayOptions: { show: { operation: ['getConversationHistory'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 50 },
				default: 20,
				description: 'How many recent messages to return (oldest → newest). Capped at 50 server-side.',
				displayOptions: { show: { operation: ['getConversationHistory'] } },
			},

			// ── Search Knowledge Base fields ─────────────────────────────────────────
			// Server-side: nashir.ai embeds the query (text-embedding-3-small) and
			// runs vector similarity against the team's knowledge_chunks, scoped
			// to the business. team_id is derived from the API key; business_id
			// is supplied per-call so a team with multiple businesses doesn't
			// leak knowledge across them.
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				default: '',
				required: true,
				placeholder: '={{ $json.effective_message }}',
				description:
					"The customer's question or topic to search for in the knowledge base. Plain text — no embedding step required on your side.",
				displayOptions: { show: { operation: ['searchKnowledge'] } },
			},
			{
				displayName: 'Business ID',
				name: 'businessId',
				type: 'string',
				default: '',
				required: true,
				placeholder: "={{ $('Webhook').first().json.body.business_id }}",
				description:
					'Business to scope the search to. The webhook payload includes business_id — wire it through with an expression. Leaving this empty is supported only against legacy backends; the current /api/v1/knowledge/search rejects requests without it.',
				displayOptions: { show: { operation: ['searchKnowledge'] } },
			},
			{
				displayName: 'Limit',
				name: 'kbLimit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 10 },
				default: 4,
				description: 'How many top chunks to return (1–10). Default 4 is a good balance for AI agent context.',
				displayOptions: { show: { operation: ['searchKnowledge'] } },
			},
			{
				displayName: 'Channel',
				name: 'platform',
				type: 'string',
				default: '',
				placeholder: "={{ $('Webhook').first().json.body.platform }}",
				description:
					"Optional. The channel this question arrived on (whatsapp / facebook / instagram). Logged with the retrieval event so the merchant's \"Teach Your Bot\" gap list can show which channel a missed question came from. Safe to leave empty.",
				displayOptions: { show: { operation: ['searchKnowledge'] } },
			},
			{
				displayName: 'Raw Customer Message',
				name: 'rawMessage',
				type: 'string',
				default: '',
				placeholder: "={{ $('Webhook').first().json.body.message }}",
				description:
					"Optional. The customer's verbatim message, for when Query has been rewritten upstream (e.g. brand-first KB extraction). Logged so the gap list shows what the customer actually typed. Server falls back to Query if empty.",
				displayOptions: { show: { operation: ['searchKnowledge'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				let responseData: IDataObject | IDataObject[];

				if (operation === 'getContact') {
					const phone = encodeURIComponent(paramAsString(this.getNodeParameter('phone', i)));
					responseData = await nashirApiRequest(this, 'GET', `/contacts/${phone}`);

				} else if (operation === 'updateTags') {
					const phone = encodeURIComponent(paramAsString(this.getNodeParameter('phone', i)));
					const tagsRaw = paramAsString(this.getNodeParameter('tags', i));
					const tags = tagsRaw
						.split(',')
						.map((t) => t.trim())
						.filter(Boolean);
					responseData = await nashirApiRequest(this, 'POST', `/contacts/${phone}/tags`, { tags });

				} else if (operation === 'getConversationHistory') {
					const senderId = encodeURIComponent(paramAsString(this.getNodeParameter('senderId', i)));
					const limit = this.getNodeParameter('limit', i, 20) as number;
					responseData = await nashirApiRequest(
						this,
						'GET',
						`/conversations/by-sender/${senderId}`,
						undefined,
						{ limit },
					);

				} else if (operation === 'searchKnowledge') {
					const query = paramAsString(this.getNodeParameter('query', i)).trim();
					if (!query) {
						throw new Error('Search Knowledge Base: query is required');
					}
					const limit = this.getNodeParameter('kbLimit', i, 4) as number;
					const businessIdRaw = paramAsString(this.getNodeParameter('businessId', i, '')).trim();
					const body: IDataObject = { query, limit };
					if (businessIdRaw) {
						const businessId = parseInt(businessIdRaw, 10);
						if (!Number.isFinite(businessId) || businessId <= 0) {
							throw new Error(
								`Search Knowledge Base: businessId must be a positive integer, got "${businessIdRaw}"`,
							);
						}
						body.business_id = businessId;
					}
					// "Teach Your Bot" gap-logging enrichment — optional. Forwarded to
					// /api/v1/knowledge/search → retrieval_logs.{platform, raw_message}.
					const platform = paramAsString(this.getNodeParameter('platform', i, '')).trim();
					const rawMessage = paramAsString(this.getNodeParameter('rawMessage', i, '')).trim();
					if (platform) body.platform = platform;
					if (rawMessage) body.raw_message = rawMessage;
					// If businessId is empty, omit it — old backends still accept the
					// request. Once /api/v1/knowledge/search starts requiring business_id
					// (S49 task 1), the absence here surfaces as a 400 from nashir.ai.
					responseData = await nashirApiRequest(
						this,
						'POST',
						`/knowledge/search`,
						body,
					);

				// ── CRM ops (business_id + channel + channel_id) ─────────────────
				// Every one of these resolves its identity from node parameters wired
				// to the webhook — never from model-supplied arguments. See the
				// warning on the shared identity properties above.
				} else if (
					operation === 'getContactCrm' ||
					operation === 'setContactField' ||
					operation === 'tagContact' ||
					operation === 'setLifecycle'
				) {
					const businessId = crmBusinessId(this, i);
					const channel = paramAsString(this.getNodeParameter('crmChannel', i)).trim();
					const channelId = paramAsString(this.getNodeParameter('crmChannelId', i)).trim();
					if (!channel) throw new Error(`${operation}: channel is required`);
					if (!channelId) throw new Error(`${operation}: channelId is required`);

					if (operation === 'getContactCrm') {
						responseData = await nashirApiRequest(
							this,
							'GET',
							'/crm/contacts/by-channel',
							undefined,
							{ business_id: businessId, channel, channel_id: channelId },
						);

					} else if (operation === 'setContactField') {
						const fieldKey = paramAsString(this.getNodeParameter('fieldKey', i)).trim();
						if (!fieldKey) throw new Error('Set Contact Field: fieldKey is required');
						const rawValue = paramAsString(this.getNodeParameter('fieldValue', i, ''));
						// Empty string CLEARS the field (the server treats null/'' as a
						// clear). Sent as-is otherwise — the server coerces to the
						// field's declared type and rejects a mismatch, so a bad value
						// surfaces as a 400 here rather than being silently stored.
						const fieldValue: string | null = rawValue === '' ? null : rawValue;
						responseData = await nashirApiRequest(this, 'POST', '/crm/contacts/fields', {
							business_id: businessId,
							channel,
							channel_id: channelId,
							fields: { [fieldKey]: fieldValue },
						});

					} else if (operation === 'tagContact') {
						const add = csvList(paramAsString(this.getNodeParameter('addTags', i, '')));
						const remove = csvList(paramAsString(this.getNodeParameter('removeTags', i, '')));
						if (add.length === 0 && remove.length === 0) {
							throw new Error('Tag Contact: provide at least one key in addTags or removeTags');
						}
						responseData = await nashirApiRequest(this, 'POST', '/crm/contacts/tags', {
							business_id: businessId,
							channel,
							channel_id: channelId,
							add,
							remove,
						});

					} else {
						const stage = paramAsString(this.getNodeParameter('stage', i)).trim();
						if (!stage) throw new Error('Set Lifecycle: stage is required');
						responseData = await nashirApiRequest(this, 'POST', '/crm/contacts/lifecycle', {
							business_id: businessId,
							channel,
							channel_id: channelId,
							stage,
						});
					}

				} else {
					throw new Error(`Unknown operation: ${operation}`);
				}

				const rows = Array.isArray(responseData) ? responseData : [responseData];
				returnData.push(...rows.map((d) => ({ json: d, pairedItem: i })));

			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: i });
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
