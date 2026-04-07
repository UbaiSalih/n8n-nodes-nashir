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

export class NashirYouTube implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Nashir YouTube',
		name: 'nashirYouTube',
		icon: 'file:nashir.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Upload and manage YouTube videos via nashir.ai',
		defaults: { name: 'Nashir YouTube', color: '#FF0000' },
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
					{ name: 'Delete Video', value: 'deleteVideo', action: 'Delete a video' },
					{ name: 'Get Videos', value: 'getVideos', action: 'Get videos' },
					{ name: 'Schedule Video', value: 'scheduleVideo', action: 'Schedule a video' },
					{ name: 'Upload Video', value: 'uploadVideo', action: 'Upload a video now' },
				],
				default: 'uploadVideo',
			},

			{
				displayName: 'Account',
				name: 'account',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'loadYouTubeAccounts' },
				default: '',
				required: true,
				displayOptions: { show: { operation: ['uploadVideo', 'scheduleVideo'] } },
			},

			{
				displayName: 'Video Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				description: 'Name of the binary property containing the video file',
				displayOptions: { show: { operation: ['uploadVideo', 'scheduleVideo'] } },
			},

			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				required: true,
				description: 'Video title (max 100 characters)',
				typeOptions: { maxLength: 100 },
				displayOptions: { show: { operation: ['uploadVideo', 'scheduleVideo'] } },
			},

			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: 'Video description (caption)',
				displayOptions: { show: { operation: ['uploadVideo', 'scheduleVideo'] } },
			},

			{
				displayName: 'Privacy',
				name: 'privacy',
				type: 'options',
				options: [
					{ name: 'Public', value: 'public' },
					{ name: 'Unlisted', value: 'unlisted' },
					{ name: 'Private', value: 'private' },
				],
				default: 'public',
				displayOptions: { show: { operation: ['uploadVideo', 'scheduleVideo'] } },
			},

			{
				displayName: 'Made for Kids (COPPA)',
				name: 'madeForKids',
				type: 'options',
				options: [
					{ name: 'No — not made for kids', value: 'false' },
					{ name: 'Yes — made for kids', value: 'true' },
				],
				default: 'false',
				required: true,
				description: 'Required by YouTube/COPPA. Select whether this video is made for children.',
				displayOptions: { show: { operation: ['uploadVideo', 'scheduleVideo'] } },
			},

			{
				displayName: 'Tags',
				name: 'tags',
				type: 'string',
				default: '',
				description: 'Comma-separated list of tags',
				displayOptions: { show: { operation: ['uploadVideo', 'scheduleVideo'] } },
			},

			{
				displayName: 'Category',
				name: 'category',
				type: 'options',
				options: [
					{ name: 'Autos & Vehicles', value: '2' },
					{ name: 'Comedy', value: '23' },
					{ name: 'Education', value: '27' },
					{ name: 'Entertainment', value: '24' },
					{ name: 'Film & Animation', value: '1' },
					{ name: 'Gaming', value: '20' },
					{ name: 'Howto & Style', value: '26' },
					{ name: 'Music', value: '10' },
					{ name: 'News & Politics', value: '25' },
					{ name: 'Nonprofits & Activism', value: '29' },
					{ name: 'People & Blogs', value: '22' },
					{ name: 'Pets & Animals', value: '15' },
					{ name: 'Science & Technology', value: '28' },
					{ name: 'Sports', value: '17' },
					{ name: 'Travel & Events', value: '19' },
				],
				default: '22',
				description: 'YouTube video category',
				displayOptions: { show: { operation: ['uploadVideo', 'scheduleVideo'] } },
			},

			{
				displayName: 'License',
				name: 'license',
				type: 'options',
				options: [
					{ name: 'Standard YouTube License', value: 'youtube' },
					{ name: 'Creative Commons — Attribution', value: 'creativeCommon' },
				],
				default: 'youtube',
				displayOptions: { show: { operation: ['uploadVideo', 'scheduleVideo'] } },
			},

			{
				displayName: 'Notify Subscribers',
				name: 'notifySubscribers',
				type: 'boolean',
				default: true,
				description: 'Whether to send a notification to subscribers when the video is published',
				displayOptions: { show: { operation: ['uploadVideo', 'scheduleVideo'] } },
			},

			{
				displayName: 'Default Language',
				name: 'defaultLanguage',
				type: 'string',
				default: '',
				placeholder: 'e.g. en, ar, fr',
				description: 'BCP-47 language code for the video title and description (optional)',
				displayOptions: { show: { operation: ['uploadVideo', 'scheduleVideo'] } },
			},

			{
				displayName: 'Thumbnail Binary Property',
				name: 'thumbnailBinaryPropertyName',
				type: 'string',
				default: '',
				description: 'Name of the binary property containing the thumbnail image (optional)',
				displayOptions: { show: { operation: ['uploadVideo', 'scheduleVideo'] } },
			},

			{
				displayName: 'Scheduled At',
				name: 'scheduledAt',
				type: 'dateTime',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['scheduleVideo'] } },
			},

			{
				displayName: 'Video ID',
				name: 'videoId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['deleteVideo'] } },
			},
		],
	};

	methods = {
		loadOptions: {
			async loadYouTubeAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadAccounts(this, 'youtube');
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

				if (operation === 'uploadVideo' || operation === 'scheduleVideo') {
					const accountId = this.getNodeParameter('account', i) as string;
					const binaryProp = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
					const title = this.getNodeParameter('title', i) as string;
					const description = this.getNodeParameter('description', i, '') as string;
					const privacy = this.getNodeParameter('privacy', i, 'public') as string;
					const madeForKids = this.getNodeParameter('madeForKids', i, 'false') as string;
					const tags = this.getNodeParameter('tags', i, '') as string;
					const category = this.getNodeParameter('category', i, '22') as string;
					const license = this.getNodeParameter('license', i, 'youtube') as string;
					const notifySubscribers = this.getNodeParameter('notifySubscribers', i, true) as boolean;
					const defaultLanguage = this.getNodeParameter('defaultLanguage', i, '') as string;
					const thumbnailProp = this.getNodeParameter('thumbnailBinaryPropertyName', i, '') as string;

					const videoUrl = await nashirUploadBinary(this, i, binaryProp);

					const youtubeOptions: IDataObject = {
						title,
						privacy_status: privacy,
						made_for_kids: madeForKids === 'true',
						license,
						notify_subscribers: notifySubscribers,
						category_id: category,
					};

					if (tags) {
						youtubeOptions.tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
					}
					if (defaultLanguage) {
						youtubeOptions.default_language = defaultLanguage;
					}

					const body: IDataObject = {
						content: description,
						platforms: ['youtube'],
						account_ids: [accountId],
						image_url: videoUrl,
						youtube_options: youtubeOptions,
					};

					if (thumbnailProp) {
						body.thumbnail_url = await nashirUploadBinary(this, i, thumbnailProp);
					}

					if (operation === 'scheduleVideo') {
						body.scheduled_at = this.getNodeParameter('scheduledAt', i) as string;
					} else {
						body.scheduled_at = new Date().toISOString();
					}

					responseData = await nashirApiRequest(this, 'POST', '/posts', body);
				} else if (operation === 'getVideos') {
					responseData = await nashirApiRequest(this, 'GET', '/posts', undefined, { platform: 'youtube' });
				} else {
					const videoId = this.getNodeParameter('videoId', i) as string;
					responseData = await nashirApiRequest(this, 'DELETE', `/posts/${videoId}`);
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
