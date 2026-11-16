// node --test (run `npm run build` first) — WhatsApp sendMessage request bodies (0.18.0):
// template (id + variables + dry run), document, video, legacy binary media.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
	buildSendMessageBody,
	mediaKindForMime,
	parseButtonVariables,
	parseVariables,
	SendBodyError,
	templateOptions,
} = require('../dist/nodes/NashirWhatsApp/sendBody.js');
const { NashirWhatsApp } = require('../dist/nodes/NashirWhatsApp/NashirWhatsApp.node.js');

const base = { accountId: '1859', to: '9647706930930' };
const tpl = { ...base, messageType: 'template', templateId: 42 };

// ── text / image: unchanged ──────────────────────────────────────────────────

test('text body is unchanged from 0.17.0', () => {
	assert.deepEqual(buildSendMessageBody({ ...base, messageType: 'text', content: 'hi' }), {
		account_id: '1859', to: '9647706930930', message_type: 'text', content: 'hi',
	});
});

test('image body is unchanged from 0.17.0 (the URL is passed through as given)', () => {
	assert.deepEqual(buildSendMessageBody({ ...base, messageType: 'image', imageUrl: 'https://x.test/a.jpg' }), {
		account_id: '1859', to: '9647706930930', message_type: 'image', image_url: 'https://x.test/a.jpg',
	});
});

// ── template ─────────────────────────────────────────────────────────────────

test('template without variables: only the template reference, no content, no dry_run', () => {
	const body = buildSendMessageBody({
		...tpl, variables: '', headerVariables: '', buttonVariables: '', headerMediaUrl: '', dryRun: false, idempotencyKey: '',
	});
	assert.deepEqual(body, { account_id: '1859', to: '9647706930930', message_type: 'template', template: { id: 42 } });
	assert.ok(!('dry_run' in body));
	assert.ok(!('content' in body));
});

test('template id from the dropdown (number) or an expression (numeric string) is sent as a number', () => {
	assert.deepEqual(buildSendMessageBody({ ...tpl, templateId: '42' }).template, { id: 42 });
	assert.deepEqual(buildSendMessageBody({ ...tpl, templateId: ' 7 ' }).template, { id: 7 });
});

for (const bad of ['', '  ', undefined, null, 'welcome', '0', '-3', '1.5', '12abc']) {
	test(`template id ${JSON.stringify(bad) ?? 'undefined'} is refused`, () => {
		assert.throws(() => buildSendMessageBody({ ...tpl, templateId: bad }), SendBodyError);
	});
}

test('template with every input', () => {
	const body = buildSendMessageBody({
		...tpl,
		variables: '["Ali","2026-12-15"]',
		headerVariables: '{"1":"Ali"}',
		buttonVariables: '{"0":"INV-1","card_0_1":"abc"}',
		headerMediaUrl: ' https://x.test/invoice.pdf ',
		dryRun: false,
		idempotencyKey: ' order-1042 ',
	});
	assert.deepEqual(body, {
		account_id: '1859',
		to: '9647706930930',
		message_type: 'template',
		template: { id: 42 },
		variables: ['Ali', '2026-12-15'],
		header_variables: { 1: 'Ali' },
		button_variables: { 0: 'INV-1', card_0_1: 'abc' },
		header_media_url: 'https://x.test/invoice.pdf',
		idempotency_key: 'order-1042',
	});
});

test('variables as an object, and already-parsed values from an expression', () => {
	assert.deepEqual(buildSendMessageBody({ ...tpl, variables: '{"1":"Ali","2":20}' }).variables, { 1: 'Ali', 2: 20 });
	assert.deepEqual(buildSendMessageBody({ ...tpl, variables: ['Ali'] }).variables, ['Ali']);
	assert.deepEqual(buildSendMessageBody({ ...tpl, buttonVariables: { 0: 'X' } }).button_variables, { 0: 'X' });
});

test('empty variables ("", [], {}, whitespace) are omitted', () => {
	for (const empty of ['', '   ', '[]', '{}', [], {}, null, undefined]) {
		const body = buildSendMessageBody({ ...tpl, variables: empty, headerVariables: empty, buttonVariables: empty });
		assert.deepEqual(Object.keys(body), ['account_id', 'to', 'message_type', 'template'], JSON.stringify(empty));
	}
});

test('dry_run: false omits the key, true sends dry_run:true', () => {
	assert.ok(!('dry_run' in buildSendMessageBody({ ...tpl, dryRun: false })));
	assert.ok(!('dry_run' in buildSendMessageBody({ ...tpl })));
	assert.ok(!('dry_run' in buildSendMessageBody({ ...tpl, dryRun: 'true' })), 'only the boolean true previews');
	assert.equal(buildSendMessageBody({ ...tpl, dryRun: true }).dry_run, true);
});

test('invalid JSON is refused with the field name', () => {
	assert.throws(() => buildSendMessageBody({ ...tpl, variables: '["Ali",' }), (e) => e instanceof SendBodyError && /Body Variables is not valid JSON/.test(e.message));
	assert.throws(() => buildSendMessageBody({ ...tpl, headerVariables: 'Ali' }), /Header Variables is not valid JSON/);
	assert.throws(() => buildSendMessageBody({ ...tpl, buttonVariables: '{0:"x"}' }), /Button Variables is not valid JSON/);
});

test('valid JSON of the wrong shape is refused', () => {
	assert.throws(() => parseVariables('"Ali"', 'Body Variables'), /must be a JSON array/);
	assert.throws(() => parseVariables('5', 'Body Variables'), SendBodyError);
	assert.throws(() => parseButtonVariables('["INV-1"]'), /must be a JSON object/);
	assert.throws(() => parseButtonVariables('{"first":"x"}'), /not a button index/);
	assert.throws(() => parseButtonVariables('{"card_0":"x"}'), /not a button index/);
});

test('header media URL must be https', () => {
	assert.throws(() => buildSendMessageBody({ ...tpl, headerMediaUrl: 'http://x.test/a.jpg' }), /Header Media URL must be a public https/);
});

test('idempotency key over 255 characters is refused', () => {
	assert.throws(() => buildSendMessageBody({ ...tpl, idempotencyKey: 'k'.repeat(256) }), SendBodyError);
	assert.equal(buildSendMessageBody({ ...tpl, idempotencyKey: 'k'.repeat(255) }).idempotency_key.length, 255);
});

// ── document / video ─────────────────────────────────────────────────────────

test('document: url, optional filename, optional caption (sent as content)', () => {
	assert.deepEqual(buildSendMessageBody({ ...base, messageType: 'document', documentUrl: 'https://x.test/i.pdf', filename: '', caption: '' }), {
		account_id: '1859', to: '9647706930930', message_type: 'document', document_url: 'https://x.test/i.pdf',
	});
	assert.deepEqual(
		buildSendMessageBody({ ...base, messageType: 'document', documentUrl: ' https://x.test/i.pdf ', filename: 'invoice.pdf', caption: 'Your invoice' }),
		{ account_id: '1859', to: '9647706930930', message_type: 'document', document_url: 'https://x.test/i.pdf', filename: 'invoice.pdf', content: 'Your invoice' },
	);
});

test('video: url and optional caption; never a filename', () => {
	assert.deepEqual(buildSendMessageBody({ ...base, messageType: 'video', videoUrl: 'https://x.test/c.mp4', filename: 'c.mp4' }), {
		account_id: '1859', to: '9647706930930', message_type: 'video', video_url: 'https://x.test/c.mp4',
	});
	assert.equal(buildSendMessageBody({ ...base, messageType: 'video', videoUrl: 'https://x.test/c.mp4', caption: 'Watch' }).content, 'Watch');
});

for (const [type, field, label] of [['document', 'documentUrl', 'Document URL'], ['video', 'videoUrl', 'Video URL']]) {
	test(`${type}: a missing or non-https link is refused`, () => {
		assert.throws(() => buildSendMessageBody({ ...base, messageType: type, [field]: '' }), new RegExp(`${label} is required`));
		assert.throws(() => buildSendMessageBody({ ...base, messageType: type, [field]: 'http://x.test/a' }), new RegExp(`${label} must be a public https`));
		assert.throws(() => buildSendMessageBody({ ...base, messageType: type, [field]: 'x.test/a' }), SendBodyError);
	});
}

// ── legacy binary "Media" ────────────────────────────────────────────────────

test('legacy media is sent as the kind its MIME type says, never as message_type "media"', () => {
	const up = { ...base, messageType: 'media', uploadedUrl: 'https://cdn.test/f', uploadedFileName: 'report.pdf' };
	assert.deepEqual(buildSendMessageBody({ ...up, uploadedMimeType: 'image/jpeg' }), {
		account_id: '1859', to: '9647706930930', message_type: 'image', image_url: 'https://cdn.test/f',
	});
	assert.deepEqual(buildSendMessageBody({ ...up, uploadedMimeType: 'video/mp4' }), {
		account_id: '1859', to: '9647706930930', message_type: 'video', video_url: 'https://cdn.test/f',
	});
	assert.deepEqual(buildSendMessageBody({ ...up, uploadedMimeType: 'application/pdf' }), {
		account_id: '1859', to: '9647706930930', message_type: 'document', document_url: 'https://cdn.test/f', filename: 'report.pdf',
	});
	assert.equal(mediaKindForMime(undefined), 'document');
	assert.equal(mediaKindForMime('audio/ogg'), 'document');
});

test('unknown message type is refused', () => {
	assert.throws(() => buildSendMessageBody({ ...base, messageType: 'sticker' }), SendBodyError);
});

// ── template dropdown ────────────────────────────────────────────────────────

test('template options: "name (language) · category", value = numeric id, non-sendable marked not hidden', () => {
	const options = templateOptions([
		{ id: 42, name: 'order_update', language: 'ar', category: 'UTILITY', status: 'approved', sendable: true },
		{ id: '43', name: 'login_code', language: 'en_US', category: 'AUTHENTICATION', sendable: false, not_sendable_reason: 'authentication_template' },
		{ id: 44, name: 'plain', language: 'en', category: null, sendable: true },
		{ id: 'x', name: 'broken' },
		null,
	]);
	assert.deepEqual(options.map((o) => [o.name, o.value]), [
		['order_update (ar) · UTILITY', 42],
		['login_code (en_US) · AUTHENTICATION — not sendable: authentication_template', 43],
		['plain (en)', 44],
	]);
	assert.deepEqual(templateOptions(undefined), []);
	assert.deepEqual(templateOptions({}), []);
});

function loadCtx(account, response) {
	const requests = [];
	return {
		requests,
		getCurrentNodeParameter: () => (typeof account === 'function' ? account() : account),
		getCredentials: async () => ({ apiKey: 'test-key', baseUrl: 'https://nashir.test/' }),
		helpers: {
			request: async (options) => {
				requests.push(options);
				if (response instanceof Error) throw response;
				return response;
			},
		},
	};
}
const loadTemplates = (ctx) => new NashirWhatsApp().methods.loadOptions.loadWhatsAppTemplates.call(ctx);

test('loadWhatsAppTemplates: asks for the chosen account and lists its templates', async () => {
	const ctx = loadCtx('1859', { account_id: 1859, data: [{ id: 42, name: 'order_update', language: 'ar', category: 'UTILITY', sendable: true }] });
	const options = await loadTemplates(ctx);
	assert.equal(ctx.requests.length, 1);
	assert.equal(ctx.requests[0].method, 'GET');
	assert.equal(ctx.requests[0].uri, 'https://nashir.test/api/v1/whatsapp/templates');
	assert.deepEqual(ctx.requests[0].qs, { account_id: '1859' });
	assert.equal(ctx.requests[0].headers.Authorization, 'Bearer test-key');
	assert.deepEqual(options.map((o) => [o.name, o.value]), [['order_update (ar) · UTILITY', 42]]);
});

test('loadWhatsAppTemplates: no account, an expression, or a thrown read → empty list and no request', async () => {
	for (const account of ['', undefined, null, '={{ $json.account_id }}', '{{ $json.x }}', () => { throw new Error('no parameter'); }]) {
		const ctx = loadCtx(account, { data: [{ id: 1, name: 'a', language: 'en' }] });
		assert.deepEqual(await loadTemplates(ctx), []);
		assert.equal(ctx.requests.length, 0);
	}
});

test('loadWhatsAppTemplates: an API error or an odd response → empty list, no crash', async () => {
	assert.deepEqual(await loadTemplates(loadCtx('1859', new Error('403'))), []);
	assert.deepEqual(await loadTemplates(loadCtx('1859', 'oops')), []);
	assert.deepEqual(await loadTemplates(loadCtx('1859', { error: 'x' })), []);
});

// ── through the node ─────────────────────────────────────────────────────────

function run(params, { binary = { fileName: 'a.jpg', mimeType: 'image/jpeg' }, continueOnFail = false } = {}) {
	const requests = [];
	const ctx = {
		getInputData: () => [{ json: {} }],
		getNodeParameter(name, i, fallback) {
			const v = Object.prototype.hasOwnProperty.call(params, name) ? params[name] : fallback;
			if (v === undefined) throw new Error(`Could not get parameter "${name}"`);
			return v;
		},
		evaluateExpression: () => undefined,
		getNode: () => ({ name: 'Nashir WhatsApp', type: 'nashirWhatsApp', typeVersion: 1, position: [0, 0], parameters: {}, id: 'n1' }),
		getCredentials: async () => ({ apiKey: 'test-key', baseUrl: 'https://nashir.test' }),
		continueOnFail: () => continueOnFail,
		helpers: {
			request: async (options) => {
				requests.push(options);
				return options.formData ? { url: 'https://cdn.test/file' } : { dry_run: true, preview: {} };
			},
			assertBinaryData: () => binary,
			getBinaryDataBuffer: async () => Buffer.from('x'),
		},
	};
	return new NashirWhatsApp().execute.call(ctx).then((out) => ({ out, requests, send: requests.find((r) => r.uri.endsWith('/api/v1/messages')) }));
}
const sendTpl = { operation: 'sendMessage', account: '1859', to: '9647706930930', messageType: 'template', templateId: 42 };

test('node: a template send never reads Content and posts the template reference', async () => {
	const { send } = await run({ ...sendTpl, templateVariables: '["Ali"]' });
	assert.deepEqual(send.body, { account_id: '1859', to: '9647706930930', message_type: 'template', template: { id: 42 }, variables: ['Ali'] });
});

test('node: Dry Run on sends dry_run:true; off omits it', async () => {
	assert.equal((await run({ ...sendTpl, templateDryRun: true })).send.body.dry_run, true);
	assert.ok(!('dry_run' in (await run({ ...sendTpl, templateDryRun: false })).send.body));
});

test('node: invalid JSON stops before any request', async () => {
	await assert.rejects(run({ ...sendTpl, templateVariables: '[oops' }), /Body Variables is not valid JSON/);
	const { out, requests } = await run({ ...sendTpl, templateVariables: '[oops' }, { continueOnFail: true });
	assert.equal(requests.length, 0);
	assert.match(out[0][0].json.error, /Body Variables is not valid JSON/);
});

test('node: document and video sends', async () => {
	const doc = await run({ operation: 'sendMessage', account: '1859', to: '1', messageType: 'document', documentUrl: 'https://x.test/i.pdf', documentFilename: 'i.pdf', mediaCaption: 'Invoice' });
	assert.deepEqual(doc.send.body, { account_id: '1859', to: '1', message_type: 'document', document_url: 'https://x.test/i.pdf', filename: 'i.pdf', content: 'Invoice' });
	const vid = await run({ operation: 'sendMessage', account: '1859', to: '1', messageType: 'video', videoUrl: 'https://x.test/c.mp4' });
	assert.deepEqual(vid.send.body, { account_id: '1859', to: '1', message_type: 'video', video_url: 'https://x.test/c.mp4' });
	await assert.rejects(run({ operation: 'sendMessage', account: '1859', to: '1', messageType: 'video', videoUrl: 'http://x.test/c.mp4' }), /Video URL must be a public https/);
});

test('node: legacy media uploads first, then sends by MIME type', async () => {
	const img = await run({ operation: 'sendMessage', account: '1859', to: '1', messageType: 'media', binaryPropertyName: 'data' });
	assert.ok(img.requests[0].uri.endsWith('/api/v1/upload'));
	assert.deepEqual(img.send.body, { account_id: '1859', to: '1', message_type: 'image', image_url: 'https://cdn.test/file' });
	const pdf = await run(
		{ operation: 'sendMessage', account: '1859', to: '1', messageType: 'media', binaryPropertyName: 'data' },
		{ binary: { fileName: 'report.pdf', mimeType: 'application/pdf' } },
	);
	assert.deepEqual(pdf.send.body, { account_id: '1859', to: '1', message_type: 'document', document_url: 'https://cdn.test/file', filename: 'report.pdf' });
});

test('description: template fields show for template only; Content is text only', () => {
	const props = new NashirWhatsApp().description.properties;
	const by = (name) => props.find((p) => p.name === name);
	assert.deepEqual(by('content').displayOptions.show.messageType, ['text']);
	assert.deepEqual(by('messageType').options.map((o) => o.value), ['text', 'template', 'image', 'document', 'video', 'media']);
	assert.equal(by('messageType').default, 'text');
	for (const name of ['templateId', 'templateVariables', 'templateHeaderVariables', 'templateButtonVariables', 'templateHeaderMediaUrl', 'templateDryRun', 'templateIdempotencyKey']) {
		assert.deepEqual(by(name).displayOptions, { show: { operation: ['sendMessage'], messageType: ['template'] } }, name);
	}
	assert.equal(by('templateId').type, 'options');
	assert.deepEqual(by('templateId').typeOptions, { loadOptionsMethod: 'loadWhatsAppTemplates', loadOptionsDependsOn: ['account'] });
	assert.equal(by('templateDryRun').default, false);
	assert.match(by('templateDryRun').description, /SENDS NOTHING/);
	assert.deepEqual(by('documentUrl').displayOptions.show.messageType, ['document']);
	assert.deepEqual(by('videoUrl').displayOptions.show.messageType, ['video']);
});
