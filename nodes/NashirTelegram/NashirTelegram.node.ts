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

export class NashirTelegram implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Nashir Telegram',
		name: 'nashirTelegram',
		icon: 'file:../shared/nashir.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Publish and manage Telegram posts via nashir.ai',
		defaults: { name: 'Nashir Telegram', color: '#2AABEE' },
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
					{ name: 'Delete Post', value: 'deletePost', action: 'Delete a post' },
					{ name: 'Get Posts', value: 'getPosts', action: 'Get posts' },
					{ name: 'Publish Post', value: 'publishPost', action: 'Publish a post now' },
					{ name: 'Schedule Post', value: 'schedulePost', action: 'Schedule a post' },
				],
				default: 'publishPost',
			},

			{
				displayName: 'Account',
				name: 'account',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'loadTelegramAccounts' },
				default: '',
				required: true,
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'] } },
			},

			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'] } },
			},

			{
				displayName: 'Attach Media?',
				name: 'hasMedia',
				type: 'boolean',
				default: false,
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'] } },
			},

			{
				displayName: 'Media Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Name of the binary property containing the media file',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'], hasMedia: [true] } },
			},

			{
				displayName: 'Send Silently',
				name: 'silent',
				type: 'boolean',
				default: false,
				description: 'Whether to send the message without notification sound',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'] } },
			},

			{
				displayName: 'Scheduled At',
				name: 'scheduledAt',
				type: 'dateTime',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['schedulePost'] } },
			},

			{
				displayName: 'Post ID',
				name: 'postId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['deletePost'] } },
			},
		],
	};

	methods = {
		loadOptions: {
			async loadTelegramAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadAccounts(this, 'telegram');
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

				if (operation === 'publishPost' || operation === 'schedulePost') {
					const accountId = this.getNodeParameter('account', i) as string;
					const content = this.getNodeParameter('content', i) as string;
					const hasMedia = this.getNodeParameter('hasMedia', i, false) as boolean;
					const silent = this.getNodeParameter('silent', i, false) as boolean;

					const body: IDataObject = {
						content,
						platforms: ['telegram'],
						account_ids: [accountId],
						silent,
						publish_now: operation === 'publishPost',
					};

					if (hasMedia) {
						const binaryProp = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
						body.image_url = await nashirUploadBinary(this, i, binaryProp);
					}

					if (operation === 'schedulePost') {
						body.scheduled_at = this.getNodeParameter('scheduledAt', i) as string;
					} else {
						body.scheduled_at = new Date().toISOString();
					}

					responseData = await nashirApiRequest(this, 'POST', '/posts', body);
				} else if (operation === 'getPosts') {
					responseData = await nashirApiRequest(this, 'GET', '/posts', undefined, { platform: 'telegram' });
				} else {
					const postId = this.getNodeParameter('postId', i) as string;
					responseData = await nashirApiRequest(this, 'DELETE', `/posts/${postId}`);
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
