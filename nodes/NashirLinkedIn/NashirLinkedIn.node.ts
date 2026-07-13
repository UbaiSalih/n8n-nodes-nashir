import {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import { loadAccounts, nashirApiRequest, nashirPublishPost, nashirUploadBinary, resolveCarouselImages, getAccountPlatform } from '../shared/api';

export class NashirLinkedIn implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Nashir LinkedIn',
		name: 'nashirLinkedIn',
		icon: 'file:nashir.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Publish and manage LinkedIn content via nashir.ai',
		defaults: { name: 'Nashir LinkedIn', color: '#0A66C2' },
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
				typeOptions: { loadOptionsMethod: 'loadLinkedInAccounts' },
				default: '',
				required: true,
				description: 'Personal profile or business page to post from',
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
				displayName: 'Post Type',
				name: 'postType',
				type: 'options',
				options: [
					{ name: 'Text Post', value: 'text' },
					{ name: 'Image Post', value: 'image' },
					{ name: 'Document', value: 'document' },
					{ name: 'Article', value: 'article' },
					{ name: 'Carousel (MultiImage — organization pages)', value: 'carousel' },
				],
				default: 'text',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'] } },
			},

			{
				displayName: 'Attach Media?',
				name: 'hasMedia',
				type: 'boolean',
				default: false,
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'] }, hide: { postType: ['carousel'] } },
			},
			{
				displayName: 'Carousel Image URLs',
				name: 'carousel_images',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description:
					'Comma-separated public image URLs for the LinkedIn MultiImage grid (2-20; organization pages only). ' +
					'Photos render as a grid in a single post. URLs must be publicly reachable.',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'], postType: ['carousel'] } },
			},

			{
				displayName: 'Link URL',
				name: 'linkUrl',
				type: 'string',
				default: '',
				description: 'Optional image URL to include in the post (used when Attach Media is off)',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'] }, hide: { postType: ['carousel'] } },
			},

			{
				displayName: 'Media Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Name of the binary property containing the media file',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'], hasMedia: [true] }, hide: { postType: ['carousel'] } },
			},
			{
				displayName: 'Document Binary Property',
				name: 'documentBinaryPropertyName',
				type: 'string',
				default: 'data',
				description:
					'Name of the binary property containing the document file (PDF, PPTX, or DOCX) for a LinkedIn document post — ' +
					'it renders as swipeable slides (the "LinkedIn carousel"). Organization pages only.',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'], postType: ['document'] } },
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
			async loadLinkedInAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadAccounts(this, ['linkedin', 'linkedin_business']);
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

					let carouselWarning: string | null = null;

					const body: IDataObject = {
						content,
						platforms: ['linkedin'],
						account_ids: [accountId],
						post_type: postType,
						publish_now: operation === 'publishPost',
					};

					if (postType === 'carousel') {
						// MultiImage carousel (organization pages only, 2-20). Accepts pasted
						// comma-separated URLs OR auto-collected media* image binaries.
						const urlsRaw = this.getNodeParameter('carousel_images', i, '') as string;
						const images = await resolveCarouselImages(this, i, urlsRaw, { min: 2, max: 20, platform: 'LinkedIn' });
						// Personal LinkedIn cannot post a native MultiImage carousel (org pages
						// only) and the backend hard-errors it. The async publish means the node
						// can't catch that at execute time, so detect a personal account here and
						// gracefully fall back to a single image (the first / cover).
						const accountPlatform = await getAccountPlatform(this, accountId);
						if (accountPlatform === 'linkedin') {
							body.image_url = images[0];
							body.post_type = 'feed';
							carouselWarning =
								'LinkedIn carousel requires an organization page; posted the first image as a single image instead.';
						} else {
							body.images = images;
						}
					} else if (postType === 'document') {
						// Document post (PDF "carousel") — upload the file binary → image_url
						// (the misleading-but-functional field the backend reads as the doc URL).
						const docProp = this.getNodeParameter('documentBinaryPropertyName', i, 'data') as string;
						body.image_url = await nashirUploadBinary(this, i, docProp);
					} else if (hasMedia) {
						const binaryProp = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
						body.image_url = await nashirUploadBinary(this, i, binaryProp);
					} else if (linkUrl) {
						body.image_url = linkUrl;
					}

					if (operation === 'schedulePost') {
						body.scheduled_at = this.getNodeParameter('scheduledAt', i) as string;
					} else {
						body.scheduled_at = new Date().toISOString();
					}

					responseData = await nashirPublishPost(this, body);
					if (carouselWarning && responseData && !Array.isArray(responseData)) {
						responseData = { ...responseData, warning: carouselWarning };
					}
				} else if (operation === 'getPosts') {
					responseData = await nashirApiRequest(this, 'GET', '/posts', undefined, { platform: 'linkedin' });
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
