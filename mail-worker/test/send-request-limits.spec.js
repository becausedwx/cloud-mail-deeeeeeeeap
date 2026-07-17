import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const ADMIN_PASSWORD = 'resource-limit-test-password';

function base64ForDecodedSize(size) {
	const padding = (3 - size % 3) % 3;
	return 'A'.repeat(Math.ceil(size / 3) * 4 - padding) + '='.repeat(padding);
}

async function initializeAdmin() {
	const initResponse = await SELF.fetch('http://example.com/api/init', {
		method: 'POST',
		headers: { 'X-Cloud-Mail-Init-Secret': 'your-jwt-secret' }
	});
	expect(initResponse.status).toBe(200);

	const adminResponse = await SELF.fetch('http://example.com/api/init/admin', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Cloud-Mail-Init-Secret': 'your-jwt-secret'
		},
		body: JSON.stringify({ password: ADMIN_PASSWORD })
	});
	expect(adminResponse.status).toBe(200);
	expect(await adminResponse.text()).toBe('success');
}

async function loginAdmin() {
	const response = await SELF.fetch('http://example.com/api/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: 'admin@example.com', password: ADMIN_PASSWORD })
	});
	const body = await response.json();
	expect(body.code).toBe(200);
	return body.data.token;
}

describe('authenticated send request resource limits', () => {
	let adminToken;

	beforeAll(async () => {
		await initializeAdmin();
		adminToken = await loginAdmin();
	});

	beforeEach(async () => {
		await env.db.batch([
			env.db.prepare('DELETE FROM attachments'),
			env.db.prepare('DELETE FROM star'),
			env.db.prepare('DELETE FROM email_search'),
			env.db.prepare('DELETE FROM email')
		]);
	});

	it('rejects JSON bodies over 24 MiB before writing mail data', async () => {
		const payload = {
			accountId: 1,
			receiveEmail: ['recipient@example.com'],
			subject: 'Oversized request',
			text: 'body',
			padding: 'x'.repeat(24 * 1024 * 1024)
		};

		const response = await SELF.fetch('http://example.com/api/email/send', {
			method: 'POST',
			headers: {
				Authorization: adminToken,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(payload)
		});
		const body = await response.json();

		expect(body).toMatchObject({
			code: 413,
			message: 'send JSON body exceeds 24 MiB'
		});
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM email').first())
			.toMatchObject({ count: 0 });
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM attachments').first())
			.toMatchObject({ count: 0 });
	});

	it('rejects an attachment over 10 MiB before writing mail or object data', async () => {
		const beforeObjects = await env.kv.list({ prefix: 'attachments/' });
		const response = await SELF.fetch('http://example.com/api/email/send', {
			method: 'POST',
			headers: {
				Authorization: adminToken,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				accountId: 1,
				receiveEmail: ['recipient@example.com'],
				subject: 'Oversized attachment',
				text: 'body',
				attachments: [{
					filename: 'too-large.bin',
					content: base64ForDecodedSize(10 * 1024 * 1024 + 1)
				}]
			})
		});
		const body = await response.json();

		expect(body).toMatchObject({
			code: 413,
			message: 'attachment exceeds 10 MiB'
		});
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM email').first())
			.toMatchObject({ count: 0 });
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM attachments').first())
			.toMatchObject({ count: 0 });
		expect((await env.kv.list({ prefix: 'attachments/' })).keys).toEqual(beforeObjects.keys);
	}, 20000);

	it('rejects HTML and text whose combined UTF-8 size exceeds 1 MiB', async () => {
		const response = await SELF.fetch('http://example.com/api/email/send', {
			method: 'POST',
			headers: {
				Authorization: adminToken,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				accountId: 1,
				receiveEmail: ['recipient@example.com'],
				subject: 'Oversized content',
				content: 'h'.repeat(512 * 1024 + 1),
				text: 't'.repeat(512 * 1024)
			})
		});
		const body = await response.json();

		expect(body).toMatchObject({
			code: 400,
			message: 'content exceeds 1MB'
		});
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM email').first())
			.toMatchObject({ count: 0 });
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM attachments').first())
			.toMatchObject({ count: 0 });
	});
});
