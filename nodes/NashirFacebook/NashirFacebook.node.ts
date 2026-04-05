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

export class NashirFacebook implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Nashir Facebook',
		name: 'nashirFacebook',
		icon: 'file:nashir.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Publish and manage Facebook content via nashir.ai',
		defaults: { name: 'Nashir Facebook', color: '#1877F2' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'nashirApi', required: true }],
		properties: [
			// ── Operation ───────────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Delete Post', value: 'deletePost', action: 'Delete a post' },
					{ name: 'Get Comments', value: 'getComments', action: 'Get comments' },
					{ name: 'Get Messages', value: 'getMessages', action: 'Get messages' },
					{ name: 'Get Posts', value: 'getPosts', action: 'Get posts' },
					{ name: 'Publish Post', value: 'publishPost', action: 'Publish a post now' },
					{ name: 'Reply to Comment', value: 'replyComment', action: 'Reply to a comment' },
					{ name: 'Reply to Message', value: 'replyMessage', action: 'Reply to a message' },
					{ name: 'Schedule Post', value: 'schedulePost', action: 'Schedule a post' },
				],
				default: 'publishPost',
			},

			// ── Account (publish / schedule) ────────────────────────────────────────
			{
				displayName: 'Account',
				name: 'account',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'loadFacebookAccounts' },
				default: '',
				required: true,
				description: 'Facebook page or account to post from',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'] } },
			},

			// ── Content ─────────────────────────────────────────────────────────────
			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				description: 'Post text content',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'] } },
			},

			// ── Post Type ───────────────────────────────────────────────────────────
			{
				displayName: 'Post Type',
				name: 'postType',
				type: 'options',
				options: [
					{ name: 'Feed Post', value: 'feed' },
					{ name: 'Story', value: 'story' },
					{ name: 'Reel', value: 'reel' },
				],
				default: 'feed',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'] } },
			},

			// ── Media ───────────────────────────────────────────────────────────────
			{
				displayName: 'Media Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Name of the binary property containing the media file to upload',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'], hasMedia: [true] } },
			},
			{
				displayName: 'Attach Media?',
				name: 'hasMedia',
				type: 'boolean',
				default: false,
				description: 'Whether to attach a media file to this post',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'] } },
			},

			// ── Link URL ────────────────────────────────────────────────────────────
			{
				displayName: 'Link URL',
				name: 'linkUrl',
				type: 'string',
				default: '',
				description: 'Optional link preview URL to include in the post',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'] } },
			},

			// ── Scheduled At ────────────────────────────────────────────────────────
			{
				displayName: 'Scheduled At',
				name: 'scheduledAt',
				type: 'dateTime',
				default: '',
				required: true,
				description: 'Date and time to publish the post',
				displayOptions: { show: { operation: ['schedulePost'] } },
			},

			// ── Post ID (delete) ────────────────────────────────────────────────────
			{
				displayName: 'Post ID',
				name: 'postId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['deletePost'] } },
			},

			// ── Comment ID (reply) ──────────────────────────────────────────────────
			{
				displayName: 'Comment ID',
				name: 'commentId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['replyComment'] } },
			},
			{
				displayName: 'Reply Text',
				name: 'replyText',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				required: true,
				displayOptions: { show: { operation: ['replyComment', 'replyMessage'] } },
			},

			// ── Message ID (reply) ──────────────────────────────────────────────────
			{
				displayName: 'Message ID',
				name: 'messageId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['replyMessage'] } },
			},
		],
	};

	methods = {
		loadOptions: {
			async loadFacebookAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadAccounts(this, 'facebook');
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
					const postType = this.getNodeParameter('postType', i) as string;
					const hasMedia = this.getNodeParameter('hasMedia', i, false) as boolean;
					const linkUrl = this.getNodeParameter('linkUrl', i, '') as string;

					const body: IDataObject = {
						content,
						platforms: ['facebook'],
						account_ids: [accountId],
						post_type: postType,
						publish_now: operation === 'publishPost',
					};

					if (hasMedia) {
						const binaryProp = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
						const uploadedUrl = await nashirUploadBinary(this, i, binaryProp);
						body.image_url = uploadedUrl;
					}

					if (linkUrl) body.link_url = linkUrl;

					if (operation === 'schedulePost') {
						body.scheduled_at = this.getNodeParameter('scheduledAt', i) as string;
					} else {
						body.scheduled_at = new Date().toISOString();
					}

					responseData = await nashirApiRequest(this, 'POST', '/posts', body);
				} else if (operation === 'getPosts') {
					responseData = await nashirApiRequest(this, 'GET', '/posts', undefined, { platform: 'facebook' });
				} else if (operation === 'deletePost') {
					const postId = this.getNodeParameter('postId', i) as string;
					responseData = await nashirApiRequest(this, 'DELETE', `/posts/${postId}`);
				} else if (operation === 'getComments') {
					responseData = await nashirApiRequest(this, 'GET', '/comments', undefined, { platform: 'facebook' });
				} else if (operation === 'replyComment') {
					const commentId = this.getNodeParameter('commentId', i) as string;
					const replyText = this.getNodeParameter('replyText', i) as string;
					responseData = await nashirApiRequest(this, 'POST', `/comments/${commentId}/reply`, { message: replyText });
				} else if (operation === 'getMessages') {
					responseData = await nashirApiRequest(this, 'GET', '/messages', undefined, { platform: 'facebook' });
				} else {
					// replyMessage
					const messageId = this.getNodeParameter('messageId', i) as string;
					const replyText = this.getNodeParameter('replyText', i) as string;
					responseData = await nashirApiRequest(this, 'POST', `/messages/${messageId}/reply`, { message: replyText });
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
