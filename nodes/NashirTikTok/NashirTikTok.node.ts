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
		description: 'Publish and manage TikTok videos via nashir.ai',
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
					{ name: 'Delete Post', value: 'deletePost', action: 'Delete a post' },
					{ name: 'Get Posts', value: 'getPosts', action: 'Get posts' },
					{ name: 'Publish Video', value: 'publishVideo', action: 'Publish a video now' },
					{ name: 'Schedule Video', value: 'scheduleVideo', action: 'Schedule a video' },
				],
				default: 'publishVideo',
			},

			{
				displayName: 'Account',
				name: 'account',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'loadTikTokAccounts' },
				default: '',
				required: true,
				displayOptions: { show: { operation: ['publishVideo', 'scheduleVideo'] } },
			},

			{
				displayName: 'Video Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				description: 'Name of the binary property containing the video file',
				displayOptions: { show: { operation: ['publishVideo', 'scheduleVideo'] } },
			},

			{
				displayName: 'Caption',
				name: 'caption',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: 'Video caption / description',
				displayOptions: { show: { operation: ['publishVideo', 'scheduleVideo'] } },
			},

			{
				displayName: 'Privacy',
				name: 'privacy',
				type: 'options',
				options: [
					{ name: 'Public', value: 'public' },
					{ name: 'Friends', value: 'friends' },
					{ name: 'Private', value: 'private' },
				],
				default: 'public',
				displayOptions: { show: { operation: ['publishVideo', 'scheduleVideo'] } },
			},

			{
				displayName: 'Allow Duet',
				name: 'allowDuet',
				type: 'boolean',
				default: true,
				displayOptions: { show: { operation: ['publishVideo', 'scheduleVideo'] } },
			},

			{
				displayName: 'Allow Stitch',
				name: 'allowStitch',
				type: 'boolean',
				default: true,
				displayOptions: { show: { operation: ['publishVideo', 'scheduleVideo'] } },
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
					const accountId = this.getNodeParameter('account', i) as string;
					const binaryProp = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
					const caption = this.getNodeParameter('caption', i, '') as string;
					const privacy = this.getNodeParameter('privacy', i, 'public') as string;
					const allowDuet = this.getNodeParameter('allowDuet', i, true) as boolean;
					const allowStitch = this.getNodeParameter('allowStitch', i, true) as boolean;

					const videoUrl = await nashirUploadBinary(this, i, binaryProp);

					const body: IDataObject = {
						content: caption,
						platforms: ['tiktok'],
						account_ids: [accountId],
						image_url: videoUrl,
						privacy,
						allow_duet: allowDuet,
						allow_stitch: allowStitch,
						publish_now: operation === 'publishVideo',
					};

					if (operation === 'scheduleVideo') {
						body.scheduled_at = this.getNodeParameter('scheduledAt', i) as string;
					} else {
						body.scheduled_at = new Date().toISOString();
					}

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
