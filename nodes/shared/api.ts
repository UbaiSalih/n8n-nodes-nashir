import {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	INodePropertyOptions,
} from 'n8n-workflow';

type AnyContext = IExecuteFunctions | ILoadOptionsFunctions;

/**
 * Make an authenticated request to the Nashir API.
 */
export async function nashirApiRequest(
	ctx: IExecuteFunctions,
	method: string,
	endpoint: string,
	body?: IDataObject,
	qs?: IDataObject,
): Promise<IDataObject> {
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
		throw error;
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
		const response = await ctx.helpers.request(options) as IDataObject;
		return response.url as string;
	} catch (error) {
		throw error;
	}
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
		const response = await ctx.helpers.request(options) as IDataObject | IDataObject[];
		let accounts: IDataObject[] = Array.isArray(response)
			? response
			: ((response.data as IDataObject[]) ?? []);

		if (platform) {
			const allowed = Array.isArray(platform) ? platform : [platform];
			accounts = accounts.filter((a) => allowed.includes(a.platform as string));
		}

		return accounts.map((account) => ({
			value: String(account.id),
			name: (account.pageName || account.page_name || account.account_name || account.name || String(account.id)) as string,
		}));
	} catch {
		return [];
	}
}
