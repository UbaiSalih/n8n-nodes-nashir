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

export class NashirInstagram implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Nashir Instagram',
		name: 'nashirInstagram',
		icon: 'file:nashir.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Publish and manage Instagram content via nashir.ai',
		defaults: { name: 'Nashir Instagram', color: '#E1306C' },
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
					{ name: 'Delete Comment', value: 'deleteComment', action: 'Delete a comment' },
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

			{
				displayName: 'Account',
				name: 'account',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'loadInstagramAccounts' },
				default: '',
				required: true,
				description: 'Select which Instagram account to use',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost', 'replyMessage', 'replyComment'] } },
			},

			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				description: 'Caption / post text',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'] } },
			},

			{
				displayName: 'Post Type',
				name: 'postType',
				type: 'options',
				// Story / Carousel removed: the backend has no media_type=STORIES path and
				// no carousel/children branch — selecting them published a single feed/reel
				// post. Re-add only when a real Story/Carousel publish path exists server-side.
				options: [
					{ name: 'Feed Post', value: 'feed' },
					{ name: 'Reel', value: 'reel' },
				],
				default: 'feed',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'] } },
			},

			{
				displayName: 'Media Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				description: 'Name of the binary property containing the media file (required for all Instagram posts)',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'] } },
			},

			// ── Thumbnail (optional, Reels / feed video posts only) ──────────────
			{
				displayName: 'Thumbnail Binary Property',
				name: 'thumbnailBinaryPropertyName',
				type: 'string',
				default: '',
				description:
					'Name of the binary property containing the cover image for Instagram Reels (optional). Meta constraints: JPG or PNG, recommended 9:16 (1080×1920). Template enforces a 2MB universal cap. Ignored on image (feed) posts — Meta\'s API does not accept cover_url for those.',
				displayOptions: {
					show: {
						operation: ['publishPost', 'schedulePost'],
						postType: ['feed', 'reel'],
					},
				},
			},

			{
				displayName: 'Alt Text',
				name: 'altText',
				type: 'string',
				default: '',
				description: 'Accessibility alt text for the media',
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

			{
				displayName: 'Comment ID',
				name: 'commentId',
				type: 'string',
				default: '',
				required: true,
				description: 'The nashir.ai comment ID (integer). Auto-resolves the team\u2019s page token server-side.',
				displayOptions: { show: { operation: ['replyComment', 'deleteComment'] } },
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

			{
				displayName: 'Message ID',
				name: 'messageId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['replyMessage'] } },
			},

			// ── Image URL (reply-with-image) ────────────────────────────────────────
			{
				displayName: 'Image URL',
				name: 'imageUrl',
				type: 'string',
				default: '',
				description:
					'Optional. If set, sends this image as a follow-up attachment after the text reply (reply-with-image). Must be a public HTTPS URL Meta can fetch. Leave empty for text-only.',
				displayOptions: { show: { operation: ['replyMessage'] } },
			},
		],
	};

	methods = {
		loadOptions: {
			async loadInstagramAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadAccounts(this, 'instagram');
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
					const binaryProp = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
					const altText = this.getNodeParameter('altText', i, '') as string;

					const uploadedUrl = await nashirUploadBinary(this, i, binaryProp);

					const body: IDataObject = {
						content,
						platforms: ['instagram'],
						account_ids: [accountId],
						post_type: postType,
						image_url: uploadedUrl,
						publish_now: operation === 'publishPost',
					};

					// Optional Reels cover. Uploaded to nashir.ai storage; the server-side
					// cron passes the resulting URL as `cover_url` on the IG REELS container.
					const thumbnailProp = this.getNodeParameter('thumbnailBinaryPropertyName', i, '') as string;
					if (thumbnailProp) {
						body.thumbnail_url = await nashirUploadBinary(this, i, thumbnailProp);
					}

					if (altText) body.alt_text = altText;

					if (operation === 'schedulePost') {
						body.scheduled_at = this.getNodeParameter('scheduledAt', i) as string;
					} else {
						body.scheduled_at = new Date().toISOString();
					}

					responseData = await nashirApiRequest(this, 'POST', '/posts', body);
				} else if (operation === 'getPosts') {
					responseData = await nashirApiRequest(this, 'GET', '/posts', undefined, { platform: 'instagram' });
				} else if (operation === 'deletePost') {
					const postId = this.getNodeParameter('postId', i) as string;
					responseData = await nashirApiRequest(this, 'DELETE', `/posts/${postId}`);
				} else if (operation === 'getComments') {
					responseData = await nashirApiRequest(this, 'GET', '/comments', undefined, { platform: 'instagram' });
				} else if (operation === 'replyComment') {
					const accountId = this.getNodeParameter('account', i) as string;
					const commentId = this.getNodeParameter('commentId', i) as string;
					const replyText = this.getNodeParameter('replyText', i) as string;
					responseData = await nashirApiRequest(this, 'POST', `/comments/${commentId}/reply`, { message: replyText, account_id: accountId });
				} else if (operation === 'deleteComment') {
					const commentId = this.getNodeParameter('commentId', i) as string;
					responseData = await nashirApiRequest(this, 'POST', `/comments/${commentId}/delete`);
				} else if (operation === 'getMessages') {
					responseData = await nashirApiRequest(this, 'GET', '/messages', undefined, { platform: 'instagram' });
				} else {
					const accountId = this.getNodeParameter('account', i) as string;
					const messageId = this.getNodeParameter('messageId', i) as string;
					const replyText = this.getNodeParameter('replyText', i) as string;
					const imageUrl = this.getNodeParameter('imageUrl', i, '') as string;
					const replyBody: IDataObject = { message: replyText, account_id: accountId };
					if (imageUrl) replyBody.image_url = imageUrl;
					responseData = await nashirApiRequest(this, 'POST', `/messages/${messageId}/reply`, replyBody);
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
