import {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import { loadAccounts, nashirApiRequest, nashirUploadBinary, resolveCarouselImages } from '../shared/api';

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

			// ── Account (publish / schedule / reply) ────────────────────────────────
			{
				displayName: 'Account',
				name: 'account',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'loadFacebookAccounts' },
				default: '',
				required: true,
				description: 'Select which Facebook page or account to use',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost', 'replyMessage', 'replyComment'] } },
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
				// Carousel + Story are both backed server-side now: carousel → a multi-photo
				// GRID via attached_media; story → a real 24h FB Story via photo_stories /
				// video_stories (saas-starter publishToFacebook). Reel stays removed — no
				// /video_reels publish path exists server-side yet.
				options: [
					{ name: 'Feed Post', value: 'feed' },
					{ name: 'Carousel (multi-photo)', value: 'carousel' },
					{ name: 'Story', value: 'story' },
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
				description: 'Name of the binary property containing the media file to upload (the image or video for a story)',
				// Shown for feed + story (when Attach Media is on); hidden for carousel,
				// which is supplied as comma-separated URLs instead.
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'], hasMedia: [true], postType: ['feed', 'story'] } },
			},
			{
				displayName: 'Attach Media?',
				name: 'hasMedia',
				type: 'boolean',
				default: false,
				description: 'Whether to attach a media file. Required for a Story (Stories must have an image or video).',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'], postType: ['feed', 'story'] } },
			},
			{
				displayName: 'Carousel Image URLs',
				name: 'carousel_images',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description:
					'Comma-separated public image URLs for the multi-photo grid (2-20; photos only). ' +
					'They render as a grid in a single Facebook feed post. URLs must be publicly reachable.',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'], postType: ['carousel'] } },
			},

			// ── Thumbnail (optional, video posts only) ───────────────────────────
			{
				displayName: 'Thumbnail Binary Property',
				name: 'thumbnailBinaryPropertyName',
				type: 'string',
				default: '',
				description:
					'Name of the binary property containing the cover image for video posts (optional). JPG/PNG, max 10MB, 1280×720 recommended. Silently ignored on image / text / non-video posts.',
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

			// ── Comment ID (reply / delete) ─────────────────────────────────────────
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

			// ── Message ID (reply) ──────────────────────────────────────────────────
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

					if (postType === 'carousel') {
						// Multi-photo grid via FB attached_media (photos only, 2-20). Accepts
						// pasted comma-separated URLs OR auto-collected media* image binaries.
						const urlsRaw = this.getNodeParameter('carousel_images', i, '') as string;
						body.images = await resolveCarouselImages(this, i, urlsRaw, { min: 2, max: 20, platform: 'Facebook' });
					} else if (postType === 'story') {
						// Story requires media. Reuse the binary upload → image_url; the backend
						// routes post_type='story' + image_url to photo_stories / video_stories.
						// (The Visual Publisher FB-Story lane sets binaryPropertyName='media'.)
						if (!hasMedia) {
							throw new Error('Facebook Stories require media — enable "Attach Media?" and provide an image or video.');
						}
						const binaryProp = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
						body.image_url = await nashirUploadBinary(this, i, binaryProp);
					} else {
						if (hasMedia) {
							const binaryProp = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
							const uploadedUrl = await nashirUploadBinary(this, i, binaryProp);
							body.image_url = uploadedUrl;
						} else if (linkUrl) {
							body.image_url = linkUrl;
						}

						// Optional video thumbnail. Uploaded to nashir.ai storage; the server-side
						// cron uses it as the `thumb` multipart param on /{page-id}/videos.
						const thumbnailProp = this.getNodeParameter('thumbnailBinaryPropertyName', i, '') as string;
						if (thumbnailProp) {
							body.thumbnail_url = await nashirUploadBinary(this, i, thumbnailProp);
						}
					}

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
					const accountId = this.getNodeParameter('account', i) as string;
					const commentId = this.getNodeParameter('commentId', i) as string;
					const replyText = this.getNodeParameter('replyText', i) as string;
					responseData = await nashirApiRequest(this, 'POST', `/comments/${commentId}/reply`, { message: replyText, account_id: accountId });
				} else if (operation === 'deleteComment') {
					const commentId = this.getNodeParameter('commentId', i) as string;
					responseData = await nashirApiRequest(this, 'POST', `/comments/${commentId}/delete`);
				} else if (operation === 'getMessages') {
					responseData = await nashirApiRequest(this, 'GET', '/messages', undefined, { platform: 'facebook' });
				} else {
					// replyMessage
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
