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

export class NashirTikTok implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Nashir TikTok',
		name: 'nashirTikTok',
		icon: 'file:nashir.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Publish and manage TikTok posts (video & photo) via nashir.ai. ' +
			'Privacy Level is required. Interactions are off by default per TikTok guidelines. ' +
			'Content Disclosure must have at least one option selected if enabled.',
		defaults: { name: 'Nashir TikTok', color: '#000000' },
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
					{ name: 'Delete Post',    value: 'deletePost',    action: 'Delete a post' },
					{ name: 'Get Posts',      value: 'getPosts',      action: 'Get posts' },
					{ name: 'Publish Media',  value: 'publishVideo',  action: 'Publish a video or photo now' },
					{ name: 'Publish Photos / Carousel', value: 'publishPhotos', action: 'Publish a photo carousel now' },
					{ name: 'Schedule Media', value: 'scheduleVideo', action: 'Schedule a video or photo' },
				],
				default: 'publishVideo',
			},

			// ── Publish Photos / Carousel (publishPhotos) — self-contained fields ──
			// Uniquely-named so publishVideo / scheduleVideo stay completely
			// untouched. Sends post_type:'carousel' + a generic images[] array to
			// /api/v1/posts (shared multi-image plumbing). No binary upload — the
			// carousel is supplied as comma-separated public URLs.
			{
				displayName: 'Account',
				name: 'photoAccount',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'loadTikTokAccounts' },
				default: '',
				required: true,
				displayOptions: { show: { operation: ['publishPhotos'] } },
			},
			{
				displayName: 'Image URLs',
				name: 'photoImageUrls',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				required: true,
				description:
					'Comma-separated public image URLs for the photo carousel (2-35). The first URL is the cover. ' +
					'URLs must be publicly reachable — TikTok pulls them directly.',
				displayOptions: { show: { operation: ['publishPhotos'] } },
			},
			{
				displayName: 'Caption',
				name: 'photoCaption',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: 'Post caption. The first line becomes the title (max 90 chars for photo posts).',
				displayOptions: { show: { operation: ['publishPhotos'] } },
			},
			{
				displayName: 'Privacy Level',
				name: 'photoPrivacyLevel',
				type: 'options',
				options: [
					{ name: 'Public to Everyone', value: 'PUBLIC_TO_EVERYONE' },
					{ name: 'Friends Only',        value: 'MUTUAL_FOLLOW_FRIENDS' },
					{ name: 'Only Me',             value: 'SELF_ONLY' },
				],
				default: 'PUBLIC_TO_EVERYONE',
				required: true,
				displayOptions: { show: { operation: ['publishPhotos'] } },
			},
			{
				displayName: 'Allow Comments',
				name: 'photoAllowComment',
				type: 'boolean',
				default: false,
				description: 'Whether to allow viewers to comment on this carousel',
				displayOptions: { show: { operation: ['publishPhotos'] } },
			},

			// ── Account ──────────────────────────────────────────────────────────
			{
				displayName: 'Account',
				name: 'account',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'loadTikTokAccounts' },
				default: '',
				required: true,
				displayOptions: { show: { operation: ['publishVideo', 'scheduleVideo'] } },
			},

			// ── Media file ───────────────────────────────────────────────────────
			{
				displayName: 'Media Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				description: 'Name of the binary property containing the video or photo file',
				displayOptions: { show: { operation: ['publishVideo', 'scheduleVideo'] } },
			},

			// ── Caption ──────────────────────────────────────────────────────────
			{
				displayName: 'Caption',
				name: 'caption',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description:
					'Post caption. For TikTok the first line becomes the title (max 100 chars for video, 90 for photo).',
				displayOptions: { show: { operation: ['publishVideo', 'scheduleVideo'] } },
			},

			// ── Privacy ──────────────────────────────────────────────────────────
			{
				displayName: 'Privacy Level',
				name: 'privacy_level',
				type: 'options',
				options: [
					{ name: 'Public to Everyone', value: 'PUBLIC_TO_EVERYONE' },
					{ name: 'Friends Only',        value: 'MUTUAL_FOLLOW_FRIENDS' },
					{ name: 'Only Me',             value: 'SELF_ONLY' },
				],
				default: 'PUBLIC_TO_EVERYONE',
				required: true,
				displayOptions: { show: { operation: ['publishVideo', 'scheduleVideo'] } },
			},

			// ── Interactions ─────────────────────────────────────────────────────
			{
				displayName: 'Allow Comments',
				name: 'allow_comment',
				type: 'boolean',
				default: false,
				description: 'Whether to allow viewers to comment on this post',
				displayOptions: { show: { operation: ['publishVideo', 'scheduleVideo'] } },
			},

			{
				displayName: 'Allow Duet',
				name: 'allow_duet',
				type: 'boolean',
				default: false,
				description: 'Whether to allow Duet — video posts only, ignored for photo posts',
				displayOptions: { show: { operation: ['publishVideo', 'scheduleVideo'] } },
			},

			{
				displayName: 'Allow Stitch',
				name: 'allow_stitch',
				type: 'boolean',
				default: false,
				description: 'Whether to allow Stitch — video posts only, ignored for photo posts',
				displayOptions: { show: { operation: ['publishVideo', 'scheduleVideo'] } },
			},

			// ── Brand / commercial content ────────────────────────────────────────
			{
				displayName: 'Content Disclosure',
				name: 'brand_content_toggle',
				type: 'boolean',
				default: false,
				description: 'This content promotes a brand, product or service',
				displayOptions: { show: { operation: ['publishVideo', 'scheduleVideo'] } },
			},

			{
				displayName: 'Your Brand (Organic)',
				name: 'brand_organic_toggle',
				type: 'boolean',
				default: false,
				description: 'You are promoting yourself or your own business',
				displayOptions: {
					show: {
						operation: ['publishVideo', 'scheduleVideo'],
						brand_content_toggle: [true],
					},
				},
			},

			{
				displayName: 'Branded Content (Paid Partnership)',
				name: 'brand_branded_content_toggle',
				type: 'boolean',
				default: false,
				description: "You are promoting another brand's product or service (paid partnership)",
				displayOptions: {
					show: {
						operation: ['publishVideo', 'scheduleVideo'],
						brand_content_toggle: [true],
					},
				},
			},

			// ── Carousel (photo posts only) ───────────────────────────────────────
			{
				displayName: 'Additional Carousel Image URLs',
				name: 'carousel_images',
				type: 'string',
				default: '',
				description:
					'Comma-separated public URLs of additional images for a carousel post (photo posts only). ' +
					'The main media file is always the first/cover image. Up to 34 additional images.',
				displayOptions: { show: { operation: ['publishVideo', 'scheduleVideo'] } },
			},

			// ── Schedule time ─────────────────────────────────────────────────────
			{
				displayName: 'Scheduled At',
				name: 'scheduledAt',
				type: 'dateTime',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['scheduleVideo'] } },
			},

			// ── Delete ────────────────────────────────────────────────────────────
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
			async loadTikTokAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadAccounts(this, 'tiktok');
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

				if (operation === 'publishVideo' || operation === 'scheduleVideo') {
					const accountId                   = this.getNodeParameter('account', i) as string;
					const binaryProp                  = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
					const caption                     = this.getNodeParameter('caption', i, '') as string;
					const privacy_level               = this.getNodeParameter('privacy_level', i) as string;
					const allow_comment               = this.getNodeParameter('allow_comment', i, false) as boolean;
					const allow_duet                  = this.getNodeParameter('allow_duet', i, false) as boolean;
					const allow_stitch                = this.getNodeParameter('allow_stitch', i, false) as boolean;
					const brand_content_toggle        = this.getNodeParameter('brand_content_toggle', i, false) as boolean;
					const brand_organic_toggle        = brand_content_toggle
						? (this.getNodeParameter('brand_organic_toggle', i, false) as boolean)
						: false;
					const brand_branded_content_toggle = brand_content_toggle
						? (this.getNodeParameter('brand_branded_content_toggle', i, false) as boolean)
						: false;
					const carousel_images_raw         = this.getNodeParameter('carousel_images', i, '') as string;

					// Upload binary and auto-detect media type from mimeType
					const binaryData  = this.helpers.assertBinaryData(i, binaryProp);
					const mimeType    = binaryData.mimeType ?? '';
					const media_type: 'VIDEO' | 'PHOTO' = mimeType.startsWith('image/') ? 'PHOTO' : 'VIDEO';

					const mediaUrl = await nashirUploadBinary(this, i, binaryProp);

					// Parse optional carousel URLs
					const carousel_images = carousel_images_raw
						? carousel_images_raw.split(',').map((u) => u.trim()).filter(Boolean)
						: undefined;

					const body: IDataObject = {
						content: caption,
						platforms: ['tiktok'],
						account_ids: [accountId],
						image_url: mediaUrl,
						publish_now: operation === 'publishVideo',
						tiktok_options: {
							privacy_level,
							disable_comment: !allow_comment,
							disable_duet:    media_type === 'VIDEO' ? !allow_duet   : false,
							disable_stitch:  media_type === 'VIDEO' ? !allow_stitch : false,
							brand_content_toggle,
							brand_organic_toggle,
							brand_branded_content_toggle,
							media_type,
							...(carousel_images?.length ? { carousel_images } : {}),
						},
					};

					if (operation === 'scheduleVideo') {
						body.scheduled_at = this.getNodeParameter('scheduledAt', i) as string;
					} else {
						body.scheduled_at = new Date().toISOString();
					}

					responseData = await nashirApiRequest(this, 'POST', '/posts', body);
				} else if (operation === 'publishPhotos') {
					const accountId     = this.getNodeParameter('photoAccount', i) as string;
					const caption       = this.getNodeParameter('photoCaption', i, '') as string;
					const urlsRaw       = this.getNodeParameter('photoImageUrls', i, '') as string;
					const privacy_level = this.getNodeParameter('photoPrivacyLevel', i) as string;
					const allow_comment = this.getNodeParameter('photoAllowComment', i, false) as boolean;

					const images = urlsRaw.split(',').map((u) => u.trim()).filter(Boolean);
					if (images.length < 2) {
						throw new Error(
							'Publish Photos / Carousel needs at least 2 comma-separated image URLs (the first is the cover).',
						);
					}

					// Carousel rides the shared top-level `images` field — NOT image_url:
					// the server re-uploads a non-storage image_url as .mp4 for TikTok,
					// which would corrupt a photo URL. post_type:'carousel' gates the
					// server-side validation (requires >= 2 image URLs).
					const body: IDataObject = {
						content: caption,
						platforms: ['tiktok'],
						account_ids: [accountId],
						post_type: 'carousel',
						images,
						publish_now: true,
						scheduled_at: new Date().toISOString(),
						tiktok_options: {
							privacy_level,
							disable_comment: !allow_comment,
							media_type: 'PHOTO',
						},
					};

					responseData = await nashirApiRequest(this, 'POST', '/posts', body);
				} else if (operation === 'getPosts') {
					responseData = await nashirApiRequest(this, 'GET', '/posts', undefined, { platform: 'tiktok' });
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
