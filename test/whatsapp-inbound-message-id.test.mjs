// node --test (run `npm run build` first) — WhatsApp sendMessage nashir_message_id (0.17.0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NashirWhatsApp } = require('../dist/nodes/NashirWhatsApp/NashirWhatsApp.node.js');

const WEBHOOK_EXPR = "{{ $('Webhook').first().json.body.nashir_message_id }}";

// Minimal IExecuteFunctions: `params` are the node's saved parameters (missing
// ones fall back like n8n does), `webhook` is what evaluateExpression returns —
// a function so a test can throw the way n8n does when the node is absent.
function run(params, webhook = () => 23384338, extra = {}) {
	const requests = [];
	const expressions = [];
	const ctx = {
		getInputData: () => [{ json: {} }],
		getNodeParameter(name, i, fallback) {
			const v = Object.prototype.hasOwnProperty.call(params, name) ? params[name] : fallback;
			if (typeof v === 'function') return v();
			if (v === undefined) throw new Error(`Could not get parameter "${name}"`);
			return v;
		},
		evaluateExpression(expr, i) {
			expressions.push([expr, i]);
			return webhook();
		},
		getCredentials: async () => ({ apiKey: 'test-key', baseUrl: 'https://nashir.test' }),
		continueOnFail: () => false,
		helpers: {
			request: async (options) => {
				requests.push(options);
				return options.formData ? { url: 'https://cdn.test/file.jpg' } : { success: true };
			},
			assertBinaryData: () => ({ fileName: 'a.jpg', mimeType: 'image/jpeg' }),
			getBinaryDataBuffer: async () => Buffer.from('x'),
		},
		...extra,
	};
	return new NashirWhatsApp().execute.call(ctx).then(() => ({ requests, expressions }));
}

const sendText = { operation: 'sendMessage', account: '1859', to: '9647706930930', messageType: 'text', content: 'hi' };
const sendOf = ({ requests }) => requests.find((r) => r.uri.endsWith('/api/v1/messages'));

test('auto-read: empty field reads the Webhook body and sends it as a number', async () => {
	const out = await run(sendText);
	assert.equal(sendOf(out).body.nashir_message_id, 23384338);
	assert.deepEqual(out.expressions, [[WEBHOOK_EXPR, 0]]);
	assert.ok(!WEBHOOK_EXPR.startsWith('='), 'evaluateExpression adds the leading =');
});

test('a saved 0.16.1 node (no inboundMessageId key at all) still auto-reads', async () => {
	const out = await run(sendText); // field absent from params → getNodeParameter fallback ''
	assert.equal(sendOf(out).body.nashir_message_id, 23384338);
});

test('auto-read accepts a numeric string', async () => {
	const out = await run(sendText, () => '23392764');
	assert.equal(sendOf(out).body.nashir_message_id, 23392764);
});

test('explicit field wins and the Webhook is not read', async () => {
	const out = await run({ ...sendText, inboundMessageId: '555' });
	assert.equal(sendOf(out).body.nashir_message_id, 555);
	assert.equal(out.expressions.length, 0);
});

test('explicit invalid value omits the id and does NOT fall back to the Webhook', async () => {
	const out = await run({ ...sendText, inboundMessageId: 'abc' });
	assert.ok(!('nashir_message_id' in sendOf(out).body));
	assert.equal(out.expressions.length, 0);
});

test('an explicit field whose expression throws omits the id; the send still goes out', async () => {
	const out = await run({
		...sendText,
		inboundMessageId: () => {
			throw new Error('ExpressionError');
		},
	});
	assert.ok(!('nashir_message_id' in sendOf(out).body));
});

test('no Webhook node / it did not run: evaluation throws → omitted, send still goes out', async () => {
	const out = await run(sendText, () => {
		throw new Error(`Referenced node doesn't exist`);
	});
	const send = sendOf(out);
	assert.ok(send, 'the send is still made');
	assert.ok(!('nashir_message_id' in send.body));
});

for (const bad of [undefined, null, '', 0, '0', -3, '-3', '12abc', 1.5, 'null', 'undefined', '9007199254740993', {}]) {
	test(`webhook value ${JSON.stringify(bad) ?? 'undefined'} → omitted`, async () => {
		const out = await run(sendText, () => bad);
		assert.ok(!('nashir_message_id' in sendOf(out).body));
	});
}

test('without an id the body is byte-identical to 0.16.1', async () => {
	const out = await run(sendText, () => undefined);
	assert.deepEqual(sendOf(out).body, { account_id: '1859', to: '9647706930930', message_type: 'text', content: 'hi' });
});

test('image, template and media sends carry the id too', async () => {
	for (const p of [
		{ ...sendText, messageType: 'image', imageUrl: 'https://x.test/a.jpg', content: undefined },
		{ ...sendText, messageType: 'template' },
		{ ...sendText, messageType: 'media', binaryPropertyName: 'data', content: undefined },
	]) {
		const out = await run(p);
		assert.equal(sendOf(out).body.nashir_message_id, 23384338, p.messageType);
	}
});

test('other operations are unchanged: no Webhook read, no nashir_message_id', async () => {
	const cases = [
		{ operation: 'replyMessage', account: '1859', messageId: '77', replyText: 'ok' },
		{ operation: 'getConversationHistory', phone: '9647706930930', limit: 20, accountId: '' },
		{ operation: 'getAiStatus', phone: '9647706930930' },
		{ operation: 'setAiStatus', phone: '9647706930930', aiAction: 'pause', reason: '' },
		{ operation: 'saveMessage', ingestPhone: '1', role: 'user', messageContent: 'x', mediaType: '', mediaUrl: '', isFromAi: true },
		{ operation: 'getContact', phone: '9647706930930' },
		{ operation: 'getMessages' },
		{ operation: 'markRead', messageId: '77' },
	];
	for (const p of cases) {
		const out = await run(p);
		assert.equal(out.expressions.length, 0, p.operation);
		for (const r of out.requests) assert.ok(!(r.body && 'nashir_message_id' in r.body), p.operation);
	}
});

test('the field is shown on sendMessage only, empty by default', () => {
	const prop = new NashirWhatsApp().description.properties.find((p) => p.name === 'inboundMessageId');
	assert.equal(prop.type, 'string');
	assert.equal(prop.default, '');
	assert.equal(prop.required, undefined);
	assert.deepEqual(prop.displayOptions, { show: { operation: ['sendMessage'] } });
});

test('node identity unchanged (type name, version, credential)', () => {
	const d = new NashirWhatsApp().description;
	assert.equal(d.name, 'nashirWhatsApp');
	assert.equal(d.version, 1);
	assert.deepEqual(d.credentials, [{ name: 'nashirApi', required: true }]);
});
