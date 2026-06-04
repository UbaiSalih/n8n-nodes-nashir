import {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	INodePropertyOptions,
} from 'n8n-workflow';

type AnyContext = IExecuteFunctions | ILoadOptionsFunctions;

/** Shape of error objects thrown by ctx.helpers.request */
interface RequestError extends Error {
	statusCode?: number;
	response?: { statusCode?: number; body?: IDataObject | string };
}

function throwFriendlyError(error: RequestError, endpoint: string): never {
	const status =
		error.statusCode ??
		(error.response as { statusCode?: number } | undefined)?.statusCode;

	if (status === 401 || status === 403) {
		throw new Error(
			'Authentication failed: your Nashir API key is invalid or does not have permission for this action. ' +
				'Check your credentials at nashir.ai → Settings → API.',
		);
	}

	if (status === 404) {
		// Give a context-aware message based on the endpoint path
		if (endpoint.includes('/contacts/')) {
			throw new Error(`Contact not found. Verify the phone number is registered in nashir.ai.`);
		}
		if (endpoint.includes('/conversations/')) {
			throw new Error(`Conversation not found for this phone number.`);
		}
		throw new Error(`Resource not found (404): ${endpoint}`);
	}

	throw error;
}

/**
 * Make an authenticated request to the Nashir API.
 */
export async function nashirApiRequest(
	ctx: IExecuteFunctions,
	method: string,
	endpoint: string,
	body?: IDataObject,
	qs?: IDataObject,
): Promise<IDataObject | IDataObject[]> {
	const credentials = await ctx.getCredentials('nashirApi');
	const baseUrl = ((credentials.baseUrl as string) || 'https://nashir.ai').replace(/\/$/, '');
	const apiKey = credentials.apiKey as string;

	const options = {
		method: method as IHttpRequestMethods,
		uri: `${baseUrl}/api/v1${endpoint}`,
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		json: true,
		body,
		qs,
	};

	try {
		return await ctx.helpers.request(options);
	} catch (error) {
		throwFriendlyError(error as RequestError, endpoint);
	}
}

/**
 * Upload a binary item to /api/v1/upload and return the public URL.
 */
export async function nashirUploadBinary(
	ctx: IExecuteFunctions,
	itemIndex: number,
	binaryPropertyName: string,
): Promise<string> {
	const credentials = await ctx.getCredentials('nashirApi');
	const baseUrl = ((credentials.baseUrl as string) || 'https://nashir.ai').replace(/\/$/, '');
	const apiKey = credentials.apiKey as string;

	const binaryData = ctx.helpers.assertBinaryData(itemIndex, binaryPropertyName);
	const dataBuffer = await ctx.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);

	const options = {
		method: 'POST' as IHttpRequestMethods,
		uri: `${baseUrl}/api/v1/upload`,
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
		formData: {
			file: {
				value: dataBuffer,
				options: {
					filename: binaryData.fileName || 'upload',
					contentType: binaryData.mimeType,
				},
			},
		},
		json: true,
	};

	try {
		const response = (await ctx.helpers.request(options)) as IDataObject;
		return response.url as string;
	} catch (error) {
		throwFriendlyError(error as RequestError, '/upload');
	}
}

function carouselKeyIndex(key: string): number {
	const m = key.match(/_(\d+)$/);
	return m ? parseInt(m[1], 10) : 0; // bare 'media' sorts as index 0 (cover)
}

/**
 * Resolve the ordered list of public image URLs for a carousel post.
 *
 * Two input modes:
 *   1. `urlsRaw` non-empty → comma-separated public URLs (backward compat —
 *      the pre-0.14.0 behaviour).
 *   2. `urlsRaw` empty → auto-collect every `media*` binary on the input item
 *      (media / media_0 / media_1 / …, ordered by index so media_0 is the
 *      cover) and upload each via /api/v1/upload → public URL.
 *
 * Enforces the per-platform min/max and rejects non-image binaries (a carousel
 * is images-only; a single video uses the video post type). Safe to call once
 * per item; nashirUploadBinary holds no shared state.
 */
export async function resolveCarouselImages(
	ctx: IExecuteFunctions,
	itemIndex: number,
	urlsRaw: string,
	limits: { min: number; max: number; platform: string },
): Promise<string[]> {
	const { min, max, platform } = limits;
	const enforce = (n: number) => {
		if (n < min) throw new Error(`${platform} carousel needs at least ${min} images.`);
		if (n > max) throw new Error(`${platform} carousel allows at most ${max} images.`);
	};

	if (urlsRaw && urlsRaw.trim()) {
		const images = urlsRaw.split(',').map((u) => u.trim()).filter(Boolean);
		enforce(images.length);
		return images;
	}

	const item = ctx.getInputData()[itemIndex];
	const binary = (item && item.binary) || {};
	const keys = Object.keys(binary)
		.filter((k) => /^media(_\d+)?$/.test(k))
		.sort((a, b) => carouselKeyIndex(a) - carouselKeyIndex(b));

	if (keys.length === 0) {
		throw new Error(
			`${platform} carousel: paste comma-separated image URLs, or upload images as media_0, media_1, … binaries.`,
		);
	}
	// Count + images-only checks BEFORE uploading, so an out-of-range or mixed
	// carousel fails fast without wasting uploads.
	enforce(keys.length);
	for (const k of keys) {
		const mime = (binary[k].mimeType as string) || '';
		if (!mime.startsWith('image/')) {
			throw new Error(
				`${platform} carousel accepts images only — binary "${k}" is "${mime || 'unknown'}". Use the video post type for videos.`,
			);
		}
	}

	const images: string[] = [];
	for (const k of keys) {
		images.push(await nashirUploadBinary(ctx, itemIndex, k));
	}
	return images;
}

/**
 * Look up a connected account's platform by id (e.g. 'linkedin' vs
 * 'linkedin_business'). Used by the LinkedIn node to detect a personal page,
 * which cannot post a native MultiImage carousel. Returns null if not found.
 */
export async function getAccountPlatform(
	ctx: IExecuteFunctions,
	accountId: string,
): Promise<string | null> {
	const resp = await nashirApiRequest(ctx, 'GET', '/accounts');
	const accounts: IDataObject[] = Array.isArray(resp)
		? resp
		: ((resp.data as IDataObject[]) ?? []);
	const match = accounts.find((a) => String(a.id) === String(accountId));
	return match ? ((match.platform as string) ?? null) : null;
}

/**
 * Load connected accounts from /api/v1/accounts for use in dropdown fields.
 * Optionally filter by platform or array of platforms (client-side).
 */
export async function loadAccounts(
	ctx: AnyContext,
	platform?: string | string[],
): Promise<INodePropertyOptions[]> {
	const credentials = await ctx.getCredentials('nashirApi');
	const baseUrl = ((credentials.baseUrl as string) || 'https://nashir.ai').replace(/\/$/, '');
	const apiKey = credentials.apiKey as string;

	const options = {
		method: 'GET' as IHttpRequestMethods,
		uri: `${baseUrl}/api/v1/accounts`,
		headers: {
			Authorization: `Bearer ${apiKey}`,
			Accept: 'application/json',
		},
		json: true,
	};

	try {
		const response = (await ctx.helpers.request(options)) as IDataObject | IDataObject[];
		let accounts: IDataObject[] = Array.isArray(response)
			? response
			: ((response.data as IDataObject[]) ?? []);

		if (platform) {
			const allowed = Array.isArray(platform) ? platform : [platform];
			accounts = accounts.filter((a) => allowed.includes(a.platform as string));
		}

		return accounts.map((account) => ({
			value: String(account.id),
			name: (account.pageName ||
				account.page_name ||
				account.account_name ||
				account.name ||
				String(account.id)) as string,
		}));
	} catch {
		return [];
	}
}
