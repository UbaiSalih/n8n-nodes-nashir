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
					{ name: 'Get Messages', value: 'getMessages', action: 'Get messages' },
					{ name: 'Mark as Read', value: 'markRead', action: 'Mark message as read' },
					{ name: 'Reply to Message', value: 'replyMessage', action: 'Reply to a message' },
					{ name: 'Send Message', value: 'sendMessage', action: 'Send a message' },
				],
				default: 'sendMessage',
			},

			// ── Send Message fields ─────────────────────────────────────────────────
			{
				displayName: 'Account',
				name: 'account',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'loadWhatsAppAccounts' },
				default: '',
				required: true,
				displayOptions: { show: { operation: ['sendMessage'] } },
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
					} else {
						const binaryProp = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
						body.media_url = await nashirUploadBinary(this, i, binaryProp);
					}

					responseData = await nashirApiRequest(this, 'POST', '/messages', body);
				} else if (operation === 'getMessages') {
					responseData = await nashirApiRequest(this, 'GET', '/messages', undefined, { platform: 'whatsapp' });
				} else if (operation === 'replyMessage') {
					const messageId = this.getNodeParameter('messageId', i) as string;
					const replyText = this.getNodeParameter('replyText', i) as string;
					responseData = await nashirApiRequest(this, 'POST', `/messages/${messageId}/reply`, { message: replyText });
				} else {
					// markRead
					const messageId = this.getNodeParameter('messageId', i) as string;
					responseData = await nashirApiRequest(this, 'PATCH', `/messages/${messageId}/read`);
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
