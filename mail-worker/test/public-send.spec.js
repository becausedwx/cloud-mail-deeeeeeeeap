import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import KvConst from '../src/const/kv-const';
import settingService from '../src/service/setting-service';

const PUBLIC_TOKEN = 'public-send-test-token';

function rateLimitKey() {
	return `public_send_limit:${dayjs().format('YYYYMMDDHH')}`;
}

function validPayload(overrides = {}) {
	return {
		sendEmail: 'sender@example.com',
		receiveEmail: ['recipient@example.com'],
		subject: 'Test subject',
		text: 'Test body',
		...overrides
	};
}

async function initializeDatabase() {
	const response = await SELF.fetch('http://example.com/api/init', {
		method: 'POST',
		headers: { 'X-Cloud-Mail-Init-Secret': 'your-jwt-secret' }
	});

	expect(response.status).toBe(200);
	expect(await response.text()).toBe('success');
}

async function seedInternalAccounts() {
	await env.db.batch([
		env.db.prepare('DELETE FROM attachments'),
		env.db.prepare('DELETE FROM star'),
		env.db.prepare('DELETE FROM email_search'),
		env.db.prepare('DELETE FROM email'),
		env.db.prepare('DELETE FROM account'),
		env.db.prepare('DELETE FROM user'),
		env.db.prepare("UPDATE role SET send_type = 'count', send_count = 0, avail_domain = '', ban_email = '' WHERE role_id = 1"),
		env.db.prepare(`
			INSERT INTO user (user_id, email, type, password, salt, status, send_count, is_del)
			VALUES (101, 'sender@example.com', 1, 'hash', 'salt', 0, 0, 0)
		`),
		env.db.prepare(`
			INSERT INTO user (user_id, email, type, password, salt, status, send_count, is_del)
			VALUES (102, 'recipient@example.com', 1, 'hash', 'salt', 0, 0, 0)
		`),
		env.db.prepare(`
			INSERT INTO account (account_id, email, name, status, user_id, all_receive, sort, is_del)
			VALUES (201, 'sender@example.com', 'Sender', 0, 101, 0, 0, 0)
		`),
		env.db.prepare(`
			INSERT INTO account (account_id, email, name, status, user_id, all_receive, sort, is_del)
			VALUES (202, 'recipient@example.com', 'Recipient', 0, 102, 0, 0, 0)
		`)
	]);
}

async function setSendStatus(value) {
	await env.db.prepare('UPDATE setting SET send = ?').bind(value).run();
	await settingService.refresh({ env });
}

async function sendEmail(payload, token = PUBLIC_TOKEN) {
	const headers = {
		'Content-Type': 'application/json'
	};
	if (token !== null) {
		headers.Authorization = token;
	}

	return SELF.fetch('http://example.com/api/public/sendEmail', {
		method: 'POST',
		headers,
		body: JSON.stringify(payload)
	});
}

describe('public send email API', () => {
	beforeAll(async () => {
		await initializeDatabase();
	});

	beforeEach(async () => {
		await env.kv.put(KvConst.PUBLIC_KEY, PUBLIC_TOKEN);
		await env.kv.delete(rateLimitKey());
	});

	it.each([
		[{}, 'sendEmail is required'],
		[{ sendEmail: 'sender@example.com' }, 'receiveEmail is required'],
		[{
			sendEmail: 'sender@example.com',
			receiveEmail: ['recipient@example.com']
		}, 'subject is required']
	])('rejects missing required fields', async (payload, message) => {
		const response = await sendEmail(payload);
		const body = await response.json();

		expect(body).toMatchObject({
			code: 400,
			message
		});
	});

	it.each([null, 'wrong-token'])('requires the configured public token', async (token) => {
		const response = await sendEmail({}, token);
		const body = await response.json();

		expect(body.code).toBe(401);
	});

	it.each([
		['recipient@example.com', 'receiveEmail must be an array'],
		[[], 'receiveEmail must contain between 1 and 10 recipients'],
		[Array.from({ length: 11 }, (_, index) => `recipient-${index}@example.com`), 'receiveEmail must contain between 1 and 10 recipients'],
		[['not-an-email'], 'invalid recipient email']
	])('validates recipient constraints', async (receiveEmail, message) => {
		const response = await sendEmail(validPayload({ receiveEmail }));
		const body = await response.json();

		expect(body).toMatchObject({ code: 400, message });
	});

	it.each([
		[{ content: '', text: '' }, 'content or text is required'],
		[{ subject: 's'.repeat(999) }, 'subject exceeds 998 characters'],
		[{ content: 'x'.repeat(1024 * 1024 + 1), text: '' }, 'content exceeds 1MB']
	])('validates message content limits', async (overrides, message) => {
		const response = await sendEmail(validPayload(overrides));
		const body = await response.json();

		expect(body).toMatchObject({ code: 400, message });
	});

	it('returns not found when the sender account does not exist', async () => {
		const response = await sendEmail(validPayload({ sendEmail: 'missing@example.com' }));
		const body = await response.json();

		expect(body).toMatchObject({
			code: 404,
			message: 'sender account not found'
		});
	});

	it('rejects a deleted sender account', async () => {
		await env.db.prepare('DELETE FROM account').run();
		await env.db.prepare(`
			INSERT INTO account (account_id, email, name, status, user_id, all_receive, sort, is_del)
			VALUES (301, 'deleted@example.com', 'Deleted', 0, 999, 0, 0, 1)
		`).run();

		const response = await sendEmail(validPayload({ sendEmail: 'deleted@example.com' }));
		const body = await response.json();

		expect(body).toMatchObject({
			code: 404,
			message: 'sender account not found'
		});
	});

	it('rejects a sender after the hourly public limit is reached', async () => {
		await seedInternalAccounts();
		await env.kv.put(rateLimitKey(), '100');

		const response = await sendEmail(validPayload());
		const body = await response.json();

		expect(body).toMatchObject({
			code: 429,
			message: 'send rate limit exceeded'
		});
	});

	it('sends to an internal recipient through the existing mail pipeline', async () => {
		await seedInternalAccounts();
		await setSendStatus(0);

		const response = await sendEmail(validPayload({
			receiveEmail: ['recipient@example.com', 'recipient@example.com'],
			content: '<p>Internal message</p>',
			attachments: [{ filename: 'ignored.txt', content: 'aGVsbG8=' }],
			sendType: 'reply',
			emailId: 99999
		}));
		const body = await response.json();

		expect(body.code).toBe(200);
		expect(body.data).toHaveLength(1);
		expect(await env.kv.get(rateLimitKey())).toBe('1');

		const { results: rows } = await env.db.prepare(`
			SELECT email_id AS emailId,
			       type,
			       user_id AS userId,
			       account_id AS accountId,
			       send_email AS sendEmail,
			       to_email AS toEmail,
			       in_reply_to AS inReplyTo
			FROM email
			ORDER BY email_id
		`).all();

		expect(rows).toHaveLength(2);
		expect(rows.find(row => row.type === 1)).toMatchObject({
			userId: 101,
			accountId: 201,
			sendEmail: 'sender@example.com'
		});
		expect(rows.find(row => row.type === 0)).toMatchObject({
			userId: 102,
			accountId: 202,
			toEmail: 'recipient@example.com'
		});
		expect(rows.find(row => row.type === 1).inReplyTo || '').toBe('');

		const attachmentCount = await env.db.prepare('SELECT COUNT(*) AS count FROM attachments').first();
		expect(attachmentCount.count).toBe(0);
	});

	it('honors the existing global send switch', async () => {
		await seedInternalAccounts();
		await setSendStatus(1);

		try {
			const response = await sendEmail(validPayload());
			const body = await response.json();

			expect(body.code).toBe(403);
			const emailCount = await env.db.prepare('SELECT COUNT(*) AS count FROM email').first();
			expect(emailCount.count).toBe(0);
		} finally {
			await setSendStatus(0);
		}
	});
});
