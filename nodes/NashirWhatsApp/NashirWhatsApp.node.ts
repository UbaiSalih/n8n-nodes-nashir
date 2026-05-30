import {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import { loadAccounts, nashirApiRequest, nashirUploadBinary } from '../shared/api';

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
				displayOptions: { show: { operation: ['sendMessage', 'replyMessage'] } },
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
				options: [
					{ name: 'Text', value: 'text' },
					{ name: 'Template', value: 'template' },
					{ name: 'Media', value: 'media' },
					{ name: 'Image (by URL)', value: 'image' },
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
				displayOptions: { show: { operation: ['sendMessage'], messageType: ['text', 'template'] } },
			},

			{
				displayName: 'Media Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				description: 'Name of the binary property containing the media file',
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

					const body: IDataObject = {
						account_id: accountId,
						to,
						message_type: messageType,
					};

					if (messageType === 'text' || messageType === 'template') {
						body.content = this.getNodeParameter('content', i) as string;
					} else if (messageType === 'image') {
						// Send an image by URL — WhatsApp fetches the link directly
						// (server forwards as Cloud API image:{link}). No binary upload.
						body.image_url = this.getNodeParameter('imageUrl', i) as string;
					} else {
						const binaryProp = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
						body.media_url = await nashirUploadBinary(this, i, binaryProp);
					}

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

				} else if (operation === 'markRead') {
					const messageId = this.getNodeParameter('messageId', i) as string;
					responseData = await nashirApiRequest(this, 'PATCH', `/messages/${messageId}/read`);

				} else if (operation === 'getConversationHistory') {
					const phone = encodeURIComponent(this.getNodeParameter('phone', i) as string);
					const limit = this.getNodeParameter('limit', i, 20) as number;
					responseData = await nashirApiRequest(
						this,
						'GET',
						`/conversations/${phone}/messages`,
						undefined,
						{ limit },
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
