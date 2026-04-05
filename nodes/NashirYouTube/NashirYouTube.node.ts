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
				description: 'Video description',
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
				displayName: 'Visibility',
				name: 'visibility',
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
					const tags = this.getNodeParameter('tags', i, '') as string;
					const visibility = this.getNodeParameter('visibility', i, 'public') as string;
					const thumbnailProp = this.getNodeParameter('thumbnailBinaryPropertyName', i, '') as string;

					const videoUrl = await nashirUploadBinary(this, i, binaryProp);

					const body: IDataObject = {
						content: title,
						description,
						platforms: ['youtube'],
						account_ids: [accountId],
						image_url: videoUrl,
						visibility,
						publish_now: operation === 'uploadVideo',
					};

					if (tags) {
						body.tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
					}

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
