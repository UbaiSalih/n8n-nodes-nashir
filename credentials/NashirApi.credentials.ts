import {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class NashirApi implements ICredentialType {
	name = 'nashirApi';
	displayName = 'Nashir API';
	documentationUrl = 'https://nashir.ai/docs/api';
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Get your key from nashir.ai → Settings → API',
			placeholder: 'nsh_xxxxxxxxxxxxxxxx',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://nashir.ai',
			required: false,
			description: 'Base URL for the Nashir API (leave default unless self-hosted)',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/api/v1/accounts',
			method: 'GET',
		},
	};
}
