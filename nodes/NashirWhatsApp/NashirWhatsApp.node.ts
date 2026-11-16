import {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import { loadAccounts, nashirApiRequest, nashirLoadOptionsGet, nashirUploadBinary } from '../shared/api';
import { buildSendMessageBody, SendBodyError, SendBodyInput, templateOptions } from './sendBody';
import { buildTypingBody, resolveTypingMessageId, TypingInputError } from './typing';

// The hosted clones' Webhook body carries the inbox id of the inbound message
// the run answers. No leading '=': evaluateExpression() adds it.
const WEBHOOK_INBOUND_ID_EXPR = "{{ $('Webhook').first().json.body.nashir_message_id }}";

/** A positive safe integer, else null (never 0, negatives, '12abc', 'null'). */
function toInboundId(value: unknown): number | null {
	const s = value === null || value === undefined ? '' : String(value).trim();
	if (!/^[1-9]\d*$/.test(s)) return null;
	const n = Number(s);
	return Number.isSafeInteger(n) ? n : null;
}

/**
 * The turn this send answers (0.17.0). Without it the server guesses "the
 * sender's latest inbound", which books a debounce-split burst's reply against
 * the wrong turn. A non-empty Inbound Message ID field decides on its own;
 * an empty field reads the Webhook body. Anything that is not a positive
 * integer — or any evaluation error (no node named Webhook, it did not run,
 * a customer's own workflow) — returns null and nothing is sent, which is
 * byte-identical to 0.16.1.
 */
// Show Typing: the message id from a node named "Webhook" (the message.received body).
const WEBHOOK_TYPING_ID_EXPR = "{{ $('Webhook').first().json.body.data.message_id }}";

function resolveInboundMessageId(ctx: IExecuteFunctions, i: number): number | null {
	let raw: unknown;
	try {
		raw = ctx.getNodeParameter('inboundMessageId', i, '');
	} catch {
		return null;
	}
	if (String(raw ?? '').trim() !== '') return toInboundId(raw);
	try {
		return toInboundId(ctx.evaluateExpression(WEBHOOK_INBOUND_ID_EXPR, i));
	} catch {
		return null;
	}
}

export class NashirWhatsApp implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Nashir WhatsApp',
		name: 'nashirWhatsApp',
		icon: 'file:nashir.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Send and manage WhatsApp messages via nashir.ai',
		defaults: { name: 'Nashir WhatsApp', color: '#25D366' },
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
					{ name: 'Get AI Status', value: 'getAiStatus', action: 'Get AI status for a conversation' },
					{ name: 'Get Contact', value: 'getContact', action: 'Get contact details' },
					{ name: 'Get Conversation History', value: 'getConversationHistory', action: 'Get conversation history for a phone number' },
					{ name: 'Get Messages', value: 'getMessages', action: 'Get messages' },
					{ name: 'Mark as Read', value: 'markRead', action: 'Mark message as read' },
					{ name: 'Reply to Message', value: 'replyMessage', action: 'Reply to a message' },
					{ name: 'Save Message to Inbox', value: 'saveMessage', action: 'Save a message to the inbox' },
					{ name: 'Send Message', value: 'sendMessage', action: 'Send a message' },
					{ name: 'Set AI Status', value: 'setAiStatus', action: 'Pause or resume AI auto-reply' },
					{
						name: 'Show Typing',
						value: 'showTyping',
						description: 'Show "typing…" to the customer while your workflow prepares the reply. Marks the message read.',
						action: 'Show typing to the customer',
					},
				],
				default: 'sendMessage',
			},

			// ── Send Message / Reply fields ─────────────────────────────────────────
			{
				displayName: 'Account',
				name: 'account',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'loadWhatsAppAccounts' },
				default: '',
				required: true,
				description: 'Select which WhatsApp account to use',
				displayOptions: { show: { operation: ['sendMessage', 'replyMessage', 'showTyping'] } },
			},

			{
				displayName: 'To (Phone Number)',
				name: 'to',
				type: 'string',
				default: '',
				required: true,
				placeholder: '+1234567890',
				description: 'Recipient phone number in international format',
				displayOptions: { show: { operation: ['sendMessage'] } },
			},

			{
				displayName: 'Message Type',
				name: 'messageType',
				type: 'options',
				// Deliberately NOT alphabetical: Text (the default) first, then by how often each is used.
				// eslint-disable-next-line n8n-nodes-base/node-param-options-type-unsorted-items
				options: [
					{ name: 'Text', value: 'text' },
					{
						name: 'Template',
						value: 'template',
						description: 'An approved WhatsApp template. Works outside the 24-hour window.',
					},
					{ name: 'Image (by URL)', value: 'image' },
					{
						name: 'Document (by URL)',
						value: 'document',
						description: 'A file (PDF, …) by public https link. Only inside the 24-hour customer-service window.',
					},
					{
						name: 'Video (by URL)',
						value: 'video',
						description: 'A video by public https link. Only inside the 24-hour customer-service window.',
					},
					{
						name: 'Media (Binary Upload)',
						value: 'media',
						description:
							'Uploads the binary file, then sends it as an image, video or document according to its MIME type. Only inside the 24-hour customer-service window.',
					},
				],
				default: 'text',
				displayOptions: { show: { operation: ['sendMessage'] } },
			},

			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				required: true,
				description: 'Text message content',
				displayOptions: { show: { operation: ['sendMessage'], messageType: ['text'] } },
			},

			// ── Template ────────────────────────────────────────────────────────────
			{
				displayName: 'Template Name or ID',
				name: 'templateId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'loadWhatsAppTemplates', loadOptionsDependsOn: ['account'] },
				default: '',
				required: true,
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				hint:
					'Approved templates of the chosen Account, shown as "name (language) · category". ' +
					'The ID is the nashir template ID (the "id" from GET /api/v1/whatsapp/templates?account_id=…, also shown on each template card in nashir). ' +
					'Templates marked "not sendable" are refused by the API.',
				displayOptions: { show: { operation: ['sendMessage'], messageType: ['template'] } },
			},
			{
				displayName: 'Body Variables',
				name: 'templateVariables',
				type: 'json',
				default: '',
				placeholder: '["Ali","2026-12-15"]',
				description:
					'Values for the body placeholders {{1}}, {{2}}, … as JSON: an array in order (["Ali","2026-12-15"]) ' +
					'or an object ({"1":"Ali","2":"2026-12-15"}). The count must match the template. Leave empty when the body has no variables.',
				displayOptions: { show: { operation: ['sendMessage'], messageType: ['template'] } },
			},
			{
				displayName: 'Header Variables',
				name: 'templateHeaderVariables',
				type: 'json',
				default: '',
				placeholder: '["Ali"]',
				description:
					'Values for the placeholders of a TEXT header, same JSON shape as Body Variables (["Ali"] or {"1":"Ali"}). Leave empty when the header has no variables.',
				displayOptions: { show: { operation: ['sendMessage'], messageType: ['template'] } },
			},
			{
				displayName: 'Button Variables',
				name: 'templateButtonVariables',
				type: 'json',
				default: '',
				placeholder: '{"0":"INV-1"}',
				description:
					'Per-send values for link buttons with a dynamic URL, as a JSON object keyed by button index: {"0":"INV-1"}. ' +
					'For a carousel card use "card_<card>_<button>": {"card_0_1":"…"}. Leave empty when no button needs a value.',
				displayOptions: { show: { operation: ['sendMessage'], messageType: ['template'] } },
			},
			{
				displayName: 'Header Media URL',
				name: 'templateHeaderMediaUrl',
				type: 'string',
				default: '',
				placeholder: 'https://example.com/invoice.pdf',
				description:
					'Public https link for a template whose header is an image, video or document. WhatsApp fetches it directly. Leave empty to use the media saved with the template.',
				displayOptions: { show: { operation: ['sendMessage'], messageType: ['template'] } },
			},
			{
				displayName: 'Dry Run (Preview Only)',
				name: 'templateDryRun',
				type: 'boolean',
				default: false,
				description:
					'Whether to only preview the template. When ON, the API checks everything and returns a preview of the filled-in message — it SENDS NOTHING to the customer. Turn OFF to really send.',
				displayOptions: { show: { operation: ['sendMessage'], messageType: ['template'] } },
			},
			{
				displayName: 'Idempotency Key',
				name: 'templateIdempotencyKey',
				type: 'string',
				default: '',
				placeholder: 'order-1042-confirmation',
				description:
					'Optional. A unique text (up to 255 characters) for this send. Repeating a request with the same key does not send the message a second time. Leave empty to send without one.',
				displayOptions: { show: { operation: ['sendMessage'], messageType: ['template'] } },
			},

			// ── Document / Video by URL ─────────────────────────────────────────────
			{
				displayName: 'Document URL',
				name: 'documentUrl',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://example.com/invoice.pdf',
				description:
					'Public https link of the file to send. WhatsApp fetches it directly. Free-form documents are allowed only inside the 24-hour customer-service window.',
				displayOptions: { show: { operation: ['sendMessage'], messageType: ['document'] } },
			},
			{
				displayName: 'File Name',
				name: 'documentFilename',
				type: 'string',
				default: '',
				placeholder: 'invoice.pdf',
				description: 'Optional. The file name the customer sees.',
				displayOptions: { show: { operation: ['sendMessage'], messageType: ['document'] } },
			},
			{
				displayName: 'Video URL',
				name: 'videoUrl',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://example.com/clip.mp4',
				description:
					'Public https link of the video to send (MP4). WhatsApp fetches it directly. Free-form videos are allowed only inside the 24-hour customer-service window.',
				displayOptions: { show: { operation: ['sendMessage'], messageType: ['video'] } },
			},
			{
				displayName: 'Caption',
				name: 'mediaCaption',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
				description: 'Optional text shown with the document or video',
				displayOptions: { show: { operation: ['sendMessage'], messageType: ['document', 'video'] } },
			},

			{
				displayName: 'Media Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				description:
					'Name of the binary property containing the media file. The file is uploaded to nashir.ai and sent as an image (image/*), a video (video/*) or a document (anything else).',
				displayOptions: { show: { operation: ['sendMessage'], messageType: ['media'] } },
			},

			// ── Image URL (reply-with-image) ────────────────────────────────────────
			{
				displayName: 'Image URL',
				name: 'imageUrl',
				type: 'string',
				default: '',
				required: true,
				description:
					'Public HTTPS URL of the image to send. WhatsApp fetches it directly (must be JPEG or PNG — WebP is not accepted for image messages). Free-form image is allowed inside the 24h customer-service window.',
				displayOptions: { show: { operation: ['sendMessage'], messageType: ['image'] } },
			},

			// ── Inbound Message ID (AI-reply counting) ──────────────────────────────
			{
				displayName: 'Inbound Message ID',
				name: 'inboundMessageId',
				type: 'string',
				default: '',
				description:
					'nashir.ai id of the customer message this send answers, so the reply is counted against ' +
					'the right turn. LEAVE EMPTY to read it from the Webhook node ' +
					'({{ $(\'Webhook\').first().json.body.nashir_message_id }}). If neither gives a positive ' +
					'whole number, nothing is sent (the previous behaviour).',
				displayOptions: { show: { operation: ['sendMessage'] } },
			},

			// ── Show Typing fields ──────────────────────────────────────────────────
			{
				displayName:
					'Shows WhatsApp’s "typing…" to the customer. It marks the message read (blue ticks). It lasts up to 25 seconds or until you reply, whichever comes first. Use it only if you will reply. If your workflow runs longer than 25 seconds, call it again.',
				name: 'typingNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { operation: ['showTyping'] } },
			},
			{
				displayName: 'Message ID',
				name: 'typingMessageId',
				type: 'string',
				default: '',
				placeholder: 'Leave empty to use the incoming message',
				description:
					'The customer message to show typing for. LEAVE EMPTY to use the incoming item’s message id ' +
					'(the message.received webhook’s data.message_id), or a node named "Webhook". ' +
					'Accepts the WhatsApp message id (wamid.…) or the nashir.ai inbox id.',
				displayOptions: { show: { operation: ['showTyping'] } },
			},

			// ── Reply / Mark as Read fields ─────────────────────────────────────────
			{
				displayName: 'Message ID',
				name: 'messageId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['replyMessage', 'markRead'] } },
			},

			{
				displayName: 'Reply Text',
				name: 'replyText',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				required: true,
				displayOptions: { show: { operation: ['replyMessage'] } },
			},

			// ── Conversation History fields ──────────────────────────────────────────
			{
				displayName: 'Phone Number',
				name: 'phone',
				type: 'string',
				default: '',
				required: true,
				placeholder: '+1234567890',
				description: 'Phone number in international format',
				displayOptions: {
					show: {
						operation: [
							'getConversationHistory',
							'getAiStatus',
							'setAiStatus',
							'getContact',
						],
					},
				},
			},

			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 20,
				description: 'Number of messages to return (most recent first)',
				displayOptions: { show: { operation: ['getConversationHistory'] } },
			},

			{
				displayName: 'Account ID',
				name: 'accountId',
				type: 'string',
				default: '',
				description:
					'Receiving WhatsApp number (social_accounts.id) to scope the history to. ' +
					'A customer messaging two of a business\'s numbers otherwise gets ONE interleaved ' +
					'transcript, and the agent answers with the wrong number\'s facts. Set it to ' +
					'{{ $(\'Webhook\').first().json.body.account_id }} — the dispatcher already sends it. ' +
					'LEAVE EMPTY for the previous, unscoped behaviour; empty is never sent.',
				displayOptions: { show: { operation: ['getConversationHistory'] } },
			},

			// ── Set AI Status fields ────────────────────────────────────────────────
			{
				displayName: 'Action',
				name: 'aiAction',
				type: 'options',
				options: [
					{ name: 'Pause', value: 'pause' },
					{ name: 'Resume', value: 'resume' },
				],
				default: 'pause',
				required: true,
				description: 'Pause or resume AI auto-reply for this conversation',
				displayOptions: { show: { operation: ['setAiStatus'] } },
			},

			{
				displayName: 'Reason',
				name: 'reason',
				type: 'string',
				default: '',
				description: 'Optional reason for pausing (e.g. "Human takeover")',
				displayOptions: { show: { operation: ['setAiStatus'] } },
			},

			// ── Save Message to Inbox fields ────────────────────────────────────────
			{
				displayName: 'Phone Number',
				name: 'ingestPhone',
				type: 'string',
				default: '',
				required: true,
				placeholder: '+1234567890',
				description: 'Phone number of the contact',
				displayOptions: { show: { operation: ['saveMessage'] } },
			},

			{
				displayName: 'Role',
				name: 'role',
				type: 'options',
				options: [
					{ name: 'User (Inbound)', value: 'user' },
					{ name: 'Assistant (Outbound)', value: 'assistant' },
				],
				default: 'user',
				required: true,
				description: 'Whether this message is from the user or the AI assistant',
				displayOptions: { show: { operation: ['saveMessage'] } },
			},

			{
				displayName: 'Message Content',
				name: 'messageContent',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				required: true,
				description: 'Text content of the message',
				displayOptions: { show: { operation: ['saveMessage'] } },
			},

			{
				displayName: 'Media Type',
				name: 'mediaType',
				type: 'options',
				options: [
					{ name: 'None', value: '' },
					{ name: 'Image', value: 'image' },
					{ name: 'Video', value: 'video' },
					{ name: 'Audio', value: 'audio' },
					{ name: 'Document', value: 'document' },
				],
				default: '',
				description: 'Optional media type if the message contains media',
				displayOptions: { show: { operation: ['saveMessage'] } },
			},

			{
				displayName: 'Media URL',
				name: 'mediaUrl',
				type: 'string',
				default: '',
				description: 'URL of the media file (required if Media Type is set)',
				displayOptions: { show: { operation: ['saveMessage'] } },
			},

			{
				displayName: 'Is From AI',
				name: 'isFromAi',
				type: 'boolean',
				default: true,
				description: 'Whether this message was generated by the AI',
				displayOptions: { show: { operation: ['saveMessage'] } },
			},
		],
	};

	methods = {
		loadOptions: {
			async loadWhatsAppAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadAccounts(this, 'whatsapp');
			},

			// Approved templates of the chosen number. An unset account, or one
			// given as an expression (not resolvable at design time), lists nothing.
			async loadWhatsAppTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				let account: unknown;
				try {
					account = this.getCurrentNodeParameter('account');
				} catch {
					return [];
				}
				const accountId = account === null || account === undefined ? '' : String(account).trim();
				if (!/^[1-9]\d*$/.test(accountId)) return [];
				const response = await nashirLoadOptionsGet(this, '/whatsapp/templates', { account_id: accountId });
				return templateOptions(response?.data);
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				let responseData: IDataObject | IDataObject[];

				if (operation === 'sendMessage') {
					const accountId = this.getNodeParameter('account', i) as string;
					const to = this.getNodeParameter('to', i) as string;
					const messageType = this.getNodeParameter('messageType', i) as string;

					const input: SendBodyInput = { accountId, to, messageType };
					if (messageType === 'text') {
						input.content = this.getNodeParameter('content', i) as string;
					} else if (messageType === 'image') {
						// Send an image by URL — WhatsApp fetches the link directly
						// (server forwards as Cloud API image:{link}). No binary upload.
						input.imageUrl = this.getNodeParameter('imageUrl', i) as string;
					} else if (messageType === 'document') {
						input.documentUrl = this.getNodeParameter('documentUrl', i, '');
						input.filename = this.getNodeParameter('documentFilename', i, '');
						input.caption = this.getNodeParameter('mediaCaption', i, '');
					} else if (messageType === 'video') {
						input.videoUrl = this.getNodeParameter('videoUrl', i, '');
						input.caption = this.getNodeParameter('mediaCaption', i, '');
					} else if (messageType === 'template') {
						input.templateId = this.getNodeParameter('templateId', i, '');
						input.variables = this.getNodeParameter('templateVariables', i, '');
						input.headerVariables = this.getNodeParameter('templateHeaderVariables', i, '');
						input.buttonVariables = this.getNodeParameter('templateButtonVariables', i, '');
						input.headerMediaUrl = this.getNodeParameter('templateHeaderMediaUrl', i, '');
						input.dryRun = this.getNodeParameter('templateDryRun', i, false);
						input.idempotencyKey = this.getNodeParameter('templateIdempotencyKey', i, '');
					} else {
						// Legacy binary "Media": upload, then send as the kind the
						// file's MIME type says (the API has no message_type "media").
						const binaryProp = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
						const binary = this.helpers.assertBinaryData(i, binaryProp);
						input.uploadedUrl = await nashirUploadBinary(this, i, binaryProp);
						input.uploadedMimeType = binary.mimeType;
						input.uploadedFileName = binary.fileName;
					}

					let body: IDataObject;
					try {
						body = buildSendMessageBody(input) as IDataObject;
					} catch (e) {
						if (e instanceof SendBodyError) {
							throw new NodeOperationError(this.getNode(), e.message, { itemIndex: i });
						}
						throw e;
					}

					const inboundId = resolveInboundMessageId(this, i);
					if (inboundId !== null) body.nashir_message_id = inboundId;

					responseData = await nashirApiRequest(this, 'POST', '/messages', body);

				} else if (operation === 'getMessages') {
					responseData = await nashirApiRequest(this, 'GET', '/messages', undefined, { platform: 'whatsapp' });

				} else if (operation === 'replyMessage') {
					const accountId = this.getNodeParameter('account', i) as string;
					const messageId = this.getNodeParameter('messageId', i) as string;
					const replyText = this.getNodeParameter('replyText', i) as string;
					responseData = await nashirApiRequest(this, 'POST', `/messages/${messageId}/reply`, {
						message: replyText,
						account_id: accountId,
					});

				} else if (operation === 'showTyping') {
					const accountId = this.getNodeParameter('account', i, '') as string;
					const messageId = resolveTypingMessageId(
						this.getNodeParameter('typingMessageId', i, ''),
						items[i]?.json,
						() => this.evaluateExpression(WEBHOOK_TYPING_ID_EXPR, i),
					);
					let body: IDataObject;
					try {
						body = buildTypingBody(accountId, messageId) as IDataObject;
					} catch (e) {
						if (e instanceof TypingInputError) {
							throw new NodeOperationError(this.getNode(), e.message, { itemIndex: i });
						}
						throw e;
					}
					responseData = await nashirApiRequest(this, 'POST', '/messages/typing', body);

				} else if (operation === 'markRead') {
					const messageId = this.getNodeParameter('messageId', i) as string;
					responseData = await nashirApiRequest(this, 'PATCH', `/messages/${messageId}/read`);

				} else if (operation === 'getConversationHistory') {
					const phone = encodeURIComponent(this.getNodeParameter('phone', i) as string);
					const limit = this.getNodeParameter('limit', i, 20) as number;
					// Per-number scope (0.16.1). Sent ONLY when non-empty, so an
					// unset/blank field is byte-identical to pre-0.16.1: the server
					// treats an absent account_id as "no scoping". An expression that
					// resolves to null/undefined stringifies to '' here and is dropped
					// rather than sent as the literal 'null', which the server would
					// reject with 400 and leave the agent with no history at all.
					const accountIdRaw = this.getNodeParameter('accountId', i, '') as unknown;
					const accountId =
						accountIdRaw === null || accountIdRaw === undefined ? '' : String(accountIdRaw).trim();
					const qs: Record<string, string | number> = { limit };
					if (accountId !== '' && accountId !== 'null' && accountId !== 'undefined') {
						qs.account_id = accountId;
					}
					responseData = await nashirApiRequest(
						this,
						'GET',
						`/conversations/${phone}/messages`,
						undefined,
						qs,
					);

				} else if (operation === 'getAiStatus') {
					const phone = encodeURIComponent(this.getNodeParameter('phone', i) as string);
					responseData = await nashirApiRequest(this, 'GET', `/conversations/${phone}/ai-status`);

				} else if (operation === 'setAiStatus') {
					const phone = encodeURIComponent(this.getNodeParameter('phone', i) as string);
					const action = this.getNodeParameter('aiAction', i) as string;
					const reason = this.getNodeParameter('reason', i, '') as string;
					const body: IDataObject = { action };
					if (reason) body.reason = reason;
					responseData = await nashirApiRequest(this, 'POST', `/conversations/${phone}/ai-toggle`, body);

				} else if (operation === 'saveMessage') {
					const phone = this.getNodeParameter('ingestPhone', i) as string;
					const role = this.getNodeParameter('role', i) as string;
					const content = this.getNodeParameter('messageContent', i) as string;
					const mediaType = this.getNodeParameter('mediaType', i, '') as string;
					const mediaUrl = this.getNodeParameter('mediaUrl', i, '') as string;
					const isFromAi = this.getNodeParameter('isFromAi', i, true) as boolean;

					const body: IDataObject = { phone, role, content, is_from_ai: isFromAi };
					if (mediaType) body.media_type = mediaType;
					if (mediaUrl) body.media_url = mediaUrl;

					responseData = await nashirApiRequest(this, 'POST', '/messages/ingest', body);

				} else if (operation === 'getContact') {
					const phone = encodeURIComponent(this.getNodeParameter('phone', i) as string);
					responseData = await nashirApiRequest(this, 'GET', `/contacts/${phone}`);

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
