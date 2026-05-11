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
		icon: 'file:nashir.svg',
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
					{ name: 'Send Notification', value: 'sendNotification', action: 'Send a notification message to a connected Telegram chat' },
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
				displayOptions: { show: { operation: ['publishPost', 'schedulePost', 'sendNotification'] } },
			},

			// ── sendNotification fields ──────────────────────────────────────────
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				description: 'Message body. Supports Markdown by default.',
				displayOptions: { show: { operation: ['sendNotification'] } },
			},
			{
				displayName: 'Parse Mode',
				name: 'parseMode',
				type: 'options',
				options: [
					{ name: 'Markdown', value: 'Markdown' },
					{ name: 'MarkdownV2', value: 'MarkdownV2' },
					{ name: 'HTML', value: 'HTML' },
					{ name: 'Plain', value: '' },
				],
				default: 'Markdown',
				displayOptions: { show: { operation: ['sendNotification'] } },
			},
			{
				displayName: 'Send Silently',
				name: 'disableNotification',
				type: 'boolean',
				default: false,
				description: 'Whether to send the message without notification sound on the recipient device',
				displayOptions: { show: { operation: ['sendNotification'] } },
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

			// ── Thumbnail (optional, video posts only) ───────────────────────────
			{
				displayName: 'Thumbnail Binary Property',
				name: 'thumbnailBinaryPropertyName',
				type: 'string',
				default: '',
				description:
					'Name of the binary property containing the cover image for video posts (optional). Telegram constraints: JPG only, max 200KB, max 320×320. Telegram does not auto-resize — oversized thumbnails are rejected by the Bot API. Silently ignored on photo / text posts.',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'] } },
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

				if (operation === 'sendNotification') {
					const accountId = this.getNodeParameter('account', i) as string;
					const text = this.getNodeParameter('text', i) as string;
					const parseMode = this.getNodeParameter('parseMode', i, 'Markdown') as string;
					const disableNotification = this.getNodeParameter('disableNotification', i, false) as boolean;

					const body: IDataObject = {
						account_id: accountId,
						text,
						disable_notification: disableNotification,
					};
					if (parseMode) body.parse_mode = parseMode;

					responseData = await nashirApiRequest(this, 'POST', '/telegram/send', body);
				} else if (operation === 'publishPost' || operation === 'schedulePost') {
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

					// Optional video thumbnail. Uploaded to nashir.ai storage; the server-side
					// cron passes the resulting URL as `thumbnail` to Telegram's sendVideo.
					const thumbnailProp = this.getNodeParameter('thumbnailBinaryPropertyName', i, '') as string;
					if (thumbnailProp) {
						body.thumbnail_url = await nashirUploadBinary(this, i, thumbnailProp);
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
