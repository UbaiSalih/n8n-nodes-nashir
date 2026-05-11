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

// S67 — Threads is publish-only at v0.10.0. Inbox / replies / insights /
// mentions / threading / carousels are deferred (require additional Meta App
// Review for threads_manage_replies / threads_read_replies / threads_manage_insights
// scopes). When those land, this node grows operations the same way the
// other platform nodes did — replyComment, replyMessage, getPosts, etc.

const THREADS_TEXT_LIMIT = 500;
const THREADS_LINK_LIMIT = 5;

// URL count regex — captures http(s):// followed by at least one non-space
// char. Mirrors the heuristic Meta's docs imply rather than a strict RFC parser.
const URL_REGEX = /https?:\/\/\S+/gi;

export class NashirThreads implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Nashir Threads',
		name: 'nashirThreads',
		icon: 'file:nashir.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Publish text, image, and video posts to Threads via nashir.ai',
		defaults: { name: 'Nashir Threads', color: '#000000' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'nashirApi', required: true }],
		// Auto-register a Tool-suffix clone for ai_tool wiring under n8n 2.17+.
		usableAsTool: true,
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Publish Post', value: 'publishPost', action: 'Publish a post now' },
					{ name: 'Schedule Post', value: 'schedulePost', action: 'Schedule a post' },
				],
				default: 'publishPost',
			},

			{
				displayName: 'Account',
				name: 'account',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'loadThreadsAccounts' },
				default: '',
				required: true,
				description: 'Select which Threads account to use',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'] } },
			},

			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				description:
					'Post text. Up to 500 characters. Up to 5 links per post (Meta enforces a hard limit since 2025-12-22 with error THREADS_API__LINK_LIMIT_EXCEEDED).',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'] } },
			},

			// Media is OPTIONAL for Threads — text-only posts are first-class.
			{
				displayName: 'Attach Media?',
				name: 'hasMedia',
				type: 'boolean',
				default: false,
				description:
					'Whether to attach an image or video. Threads also supports text-only posts (media_type=TEXT). Leave unchecked for text-only.',
				displayOptions: { show: { operation: ['publishPost', 'schedulePost'] } },
			},
			{
				displayName: 'Media Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Name of the binary property containing the image or video file',
				displayOptions: {
					show: { operation: ['publishPost', 'schedulePost'], hasMedia: [true] },
				},
			},

			{
				displayName: 'Scheduled At',
				name: 'scheduledAt',
				type: 'dateTime',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['schedulePost'] } },
			},
		],
	};

	methods = {
		loadOptions: {
			async loadThreadsAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadAccounts(this, 'threads');
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;

				if (operation !== 'publishPost' && operation !== 'schedulePost') {
					throw new Error(`Unsupported operation: ${operation}`);
				}

				const accountId = this.getNodeParameter('account', i) as string;
				const content = this.getNodeParameter('content', i) as string;
				const hasMedia = this.getNodeParameter('hasMedia', i, false) as boolean;

				// Client-side text-length check. nashir.ai's /api/v1/posts re-validates,
				// but failing here surfaces the limit in the n8n editor's error panel
				// instead of bubbling up as a generic API error.
				if (content.length > THREADS_TEXT_LIMIT) {
					throw new Error(
						`Threads posts are limited to ${THREADS_TEXT_LIMIT} characters; got ${content.length}.`,
					);
				}

				// Link-count gate (Meta enforced since 2025-12-22).
				const linkMatches = content.match(URL_REGEX) ?? [];
				if (linkMatches.length > THREADS_LINK_LIMIT) {
					throw new Error(
						`Threads posts are limited to ${THREADS_LINK_LIMIT} links; got ${linkMatches.length}. ` +
							`Meta returns THREADS_API__LINK_LIMIT_EXCEEDED for posts that exceed this limit.`,
					);
				}

				const body: IDataObject = {
					content,
					platforms: ['threads'],
					account_ids: [accountId],
					publish_now: operation === 'publishPost',
				};

				if (hasMedia) {
					const binaryProp = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
					const uploadedUrl = await nashirUploadBinary(this, i, binaryProp);
					body.image_url = uploadedUrl;
				}

				if (operation === 'schedulePost') {
					body.scheduled_at = this.getNodeParameter('scheduledAt', i) as string;
				} else {
					body.scheduled_at = new Date().toISOString();
				}

				const responseData = await nashirApiRequest(this, 'POST', '/posts', body);
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
