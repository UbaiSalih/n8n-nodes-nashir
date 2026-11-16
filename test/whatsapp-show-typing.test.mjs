// node --test (run `npm run build` first) — Nashir WhatsApp → Show Typing (0.19.0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NashirWhatsApp } = require('../dist/nodes/NashirWhatsApp/NashirWhatsApp.node.js');
const { messageIdFromItem, resolveTypingMessageId, buildTypingBody } = require('../dist/nodes/NashirWhatsApp/typing.js');

const WAMID = 'wamid.HBgMOTY0NzcwMDAwMDAwFQIAEhgURVhBTVBMRV9UWVBJTkdfMDAwMQA=';
// What n8n's Webhook node puts on the item for a message.received delivery.
const WEBHOOK_ITEM = { headers: {}, params: {}, query: {}, body: { event: 'message.received', team_id: 9, data: { channel: 'whatsapp', message_id: WAMID, social_account_id: 1859 } } };

function run(params, { item = WEBHOOK_ITEM, webhook = () => { throw new Error('no node named Webhook'); }, reply } = {}) {
	const requests = [];
	const expressions = [];
	const ctx = {
		getInputData: () => [{ json: item }],
		getNodeParameter(name, i, fallback) {
			const v = Object.prototype.hasOwnProperty.call(params, name) ? params[name] : fallback;
			if (v === undefined) throw new Error(`Could not get parameter "${name}"`);
			return v;
		},
		evaluateExpression(expr, i) {
			expressions.push([expr, i]);
			return webhook();
		},
		getNode: () => ({ name: 'Nashir WhatsApp', type: 'n8n-nodes-nashir.nashirWhatsApp' }),
		getCredentials: async () => ({ apiKey: 'test-key', baseUrl: 'https://nashir.test' }),
		continueOnFail: () => false,
		helpers: {
			request: async (options) => {
				requests.push(options);
				return reply ? reply(options) : { ok: true, expires_in_seconds: 25, message_id: WAMID, nashir_message_id: 900000601 };
			},
		},
	};
	return new NashirWhatsApp().execute.call(ctx).then((out) => ({ out, requests, expressions }));
}

const typing = { operation: 'showTyping', account: '1859' };

test('the operation is listed, with the four rules shown in the node', () => {
	const d = new NashirWhatsApp().description;
	const op = d.properties.find((p) => p.name === 'operation');
	const opt = op.options.find((o) => o.value === 'showTyping');
	assert.equal(opt.name, 'Show Typing');
	const notice = d.properties.find((p) => p.name === 'typingNotice');
	assert.equal(notice.type, 'notice');
	for (const rule of ['marks the message read', 'up to 25 seconds or until you reply', 'only if you will reply', 'call it again']) {
		assert.ok(notice.displayName.includes(rule), `notice says: ${rule}`);
	}
	const account = d.properties.find((p) => p.name === 'account');
	assert.ok(account.displayOptions.show.operation.includes('showTyping'));
	const field = d.properties.find((p) => p.name === 'typingMessageId');
	assert.equal(field.default, '');
	assert.ok(!field.required, 'empty = use the incoming message');
	// options stay alphabetical (eslint n8n-nodes-base)
	const names = op.options.map((o) => o.name);
	assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

test('default: the incoming Webhook item’s data.message_id → POST /messages/typing', async () => {
	const { out, requests, expressions } = await run(typing);
	assert.equal(requests.length, 1);
	assert.equal(requests[0].method, 'POST');
	assert.equal(requests[0].uri, 'https://nashir.test/api/v1/messages/typing');
	assert.deepEqual(requests[0].body, { account_id: 1859, message_id: WAMID });
	assert.equal(expressions.length, 0, 'the item had it — no Webhook lookup');
	assert.equal(out[0][0].json.expires_in_seconds, 25);
});

test('an item that is the webhook body, or the data itself, works too', async () => {
	for (const item of [WEBHOOK_ITEM.body, WEBHOOK_ITEM.body.data]) {
		const { requests } = await run(typing, { item });
		assert.equal(requests[0].body.message_id, WAMID);
	}
});

test('after other nodes (the item no longer has it): reads the node named "Webhook"', async () => {
	const { requests, expressions } = await run(typing, { item: { text: 'AI reply draft' }, webhook: () => WAMID });
	assert.equal(requests[0].body.message_id, WAMID);
	assert.deepEqual(expressions, [["{{ $('Webhook').first().json.body.data.message_id }}", 0]]);
});

test('an explicit field wins; digits are a nashir inbox id', async () => {
	let r = await run({ ...typing, typingMessageId: 'wamid.OTHER' });
	assert.deepEqual(r.requests[0].body, { account_id: 1859, message_id: 'wamid.OTHER' });
	r = await run({ ...typing, typingMessageId: ' 900000601 ' });
	assert.deepEqual(r.requests[0].body, { account_id: 1859, nashir_message_id: 900000601 });
	assert.equal(r.expressions.length, 0);
});

test('nothing to go on → a clear node error, nothing sent', async () => {
	await assert.rejects(run(typing, { item: { text: 'x' } }), /Message ID is required/);
});

test('no account → a clear node error, nothing sent', async () => {
	await assert.rejects(run({ operation: 'showTyping', account: '' }), /Account is required/);
});

test('an API refusal surfaces (chat_controlled) — never a silent success', async () => {
	const reply = () => {
		const e = new Error('409');
		e.statusCode = 409;
		e.response = { statusCode: 409, body: { code: 'chat_controlled', message: 'A person on the team is handling this chat, so the bot cannot show typing.' } };
		throw e;
	};
	await assert.rejects(run(typing, { reply }));
});

test('helpers', () => {
	assert.equal(messageIdFromItem(null), '');
	assert.equal(messageIdFromItem({ message_id: 123 }), '123');
	assert.equal(resolveTypingMessageId('', {}, () => { throw new Error('x'); }), '');
	assert.throws(() => buildTypingBody('abc', WAMID), /Account is required/);
	assert.deepEqual(buildTypingBody(1859, WAMID), { account_id: 1859, message_id: WAMID });
});
