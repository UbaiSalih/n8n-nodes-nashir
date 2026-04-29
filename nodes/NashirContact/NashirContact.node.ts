import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import { nashirApiRequest } from '../shared/api';

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
					{ name: 'Get Contact', value: 'getContact', action: 'Get contact details' },
					{ name: 'Update Contact Tags', value: 'updateTags', action: 'Add tags to a contact' },
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
			// runs vector similarity against the team's knowledge_chunks. The team
			// is derived from the API key — never trusted from the request body.
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
				displayName: 'Limit',
				name: 'kbLimit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 10 },
				default: 4,
				description: 'How many top chunks to return (1–10). Default 4 is a good balance for AI agent context.',
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
					const phone = encodeURIComponent(this.getNodeParameter('phone', i) as string);
					responseData = await nashirApiRequest(this, 'GET', `/contacts/${phone}`);

				} else if (operation === 'updateTags') {
					const phone = encodeURIComponent(this.getNodeParameter('phone', i) as string);
					const tagsRaw = this.getNodeParameter('tags', i) as string;
					const tags = tagsRaw
						.split(',')
						.map((t) => t.trim())
						.filter(Boolean);
					responseData = await nashirApiRequest(this, 'POST', `/contacts/${phone}/tags`, { tags });

				} else if (operation === 'getConversationHistory') {
					const senderId = encodeURIComponent(this.getNodeParameter('senderId', i) as string);
					const limit = this.getNodeParameter('limit', i, 20) as number;
					responseData = await nashirApiRequest(
						this,
						'GET',
						`/conversations/by-sender/${senderId}`,
						undefined,
						{ limit },
					);

				} else if (operation === 'searchKnowledge') {
					const query = (this.getNodeParameter('query', i) as string).trim();
					if (!query) {
						throw new Error('Search Knowledge Base: query is required');
					}
					const limit = this.getNodeParameter('kbLimit', i, 4) as number;
					responseData = await nashirApiRequest(
						this,
						'POST',
						`/knowledge/search`,
						{ query, limit },
					);

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
