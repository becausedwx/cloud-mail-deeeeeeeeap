import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import KvConst from '../src/const/kv-const';

const PUBLIC_TOKEN = 'public-add-user-test-token';

async function initializeDatabase() {
	const response = await SELF.fetch('http://example.com/api/init', {
		method: 'POST',
		headers: { 'X-Cloud-Mail-Init-Secret': 'your-jwt-secret' }
	});
	expect(response.status).toBe(200);
	expect(await response.text()).toBe('success');
}

async function importUsers(list) {
	const response = await SELF.fetch('http://example.com/api/public/addUser', {
		method: 'POST',
		headers: {
			Authorization: PUBLIC_TOKEN,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ list })
	});
	return response.json();
}

async function getAccountOwnership(email) {
	return env.db.prepare(`
		SELECT account.user_id AS accountUserId, user.user_id AS userId
		FROM account
		JOIN user ON user.email = account.email
		WHERE account.email = ?
	`).bind(email).first();
}

describe('public addUser batch ownership', () => {
	beforeAll(initializeDatabase);

	beforeEach(async () => {
		await env.db.batch([
			env.db.prepare('DELETE FROM account'),
			env.db.prepare('DELETE FROM user')
		]);
		await env.kv.put(KvConst.PUBLIC_KEY, PUBLIC_TOKEN);
	});

	it('does not bind historical orphan accounts outside the current import batch', async () => {
		await env.db.batch([
			env.db.prepare(`
				INSERT INTO user (email, password, salt, type)
				VALUES (?, ?, ?, ?)
			`).bind('legacy@example.com', 'legacy-hash', 'legacy-salt', 1),
			env.db.prepare(`
				INSERT INTO account (email, name, user_id)
				VALUES (?, ?, 0)
			`).bind('legacy@example.com', 'legacy')
		]);

		const body = await importUsers([
			{ email: 'fresh@example.com', password: 'secure-password' }
		]);

		expect(body.code).toBe(200);
		expect(await env.db.prepare(`
			SELECT user_id AS userId
			FROM account
			WHERE email = ?
		`).bind('legacy@example.com').first()).toEqual({ userId: 0 });
	});

	it('binds one imported account to its newly-created user', async () => {
		const body = await importUsers([
			{ email: 'single@example.com', password: 'secure-password' }
		]);

		expect(body.code).toBe(200);
		const row = await getAccountOwnership('single@example.com');
		expect(row).toEqual({
			accountUserId: expect.any(Number),
			userId: expect.any(Number)
		});
		expect(row.accountUserId).toBe(row.userId);
	});

	it('binds every account in a multi-user import to the matching new user', async () => {
		const body = await importUsers([
			{ email: 'alpha@example.com', password: 'secure-password-a' },
			{ email: 'beta@example.com', password: 'secure-password-b' }
		]);

		expect(body.code).toBe(200);
		for (const importedEmail of ['alpha@example.com', 'beta@example.com']) {
			const row = await getAccountOwnership(importedEmail);
			expect(row.accountUserId).toBe(row.userId);
		}
	});

	it('rolls back the whole batch when an imported address conflicts with existing data', async () => {
		await env.db.prepare(`
			INSERT INTO user (email, password, salt, type)
			VALUES (?, ?, ?, ?)
		`).bind('existing@example.com', 'existing-hash', 'existing-salt', 1).run();

		const body = await importUsers([
			{ email: 'would-be-partial@example.com', password: 'secure-password-a' },
			{ email: 'existing@example.com', password: 'secure-password-b' }
		]);

		expect(body.code).not.toBe(200);
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count FROM user WHERE email = ?
		`).bind('would-be-partial@example.com').first()).toEqual({ count: 0 });
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count FROM account WHERE email = ?
		`).bind('would-be-partial@example.com').first()).toEqual({ count: 0 });
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count FROM user WHERE email = ?
		`).bind('existing@example.com').first()).toEqual({ count: 1 });
	});

	it('rolls back the whole batch when the existing conflict is an orphan account', async () => {
		await env.db.prepare(`
			INSERT INTO account (email, name, user_id)
			VALUES (?, ?, 0)
		`).bind('reserved@example.com', 'reserved').run();

		const body = await importUsers([
			{ email: 'would-be-partial@example.com', password: 'secure-password-a' },
			{ email: 'reserved@example.com', password: 'secure-password-b' }
		]);

		expect(body.code).not.toBe(200);
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count FROM user
		`).first()).toEqual({ count: 0 });
		expect(await env.db.prepare(`
			SELECT email, user_id AS userId FROM account WHERE email = ?
		`).bind('reserved@example.com').first()).toEqual({
			email: 'reserved@example.com',
			userId: 0
		});
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count FROM account WHERE email = ?
		`).bind('would-be-partial@example.com').first()).toEqual({ count: 0 });
	});

	it('rolls back the whole batch when imported addresses conflict case-insensitively', async () => {
		const body = await importUsers([
			{ email: 'would-be-partial@example.com', password: 'secure-password-a' },
			{ email: 'DUPLICATE@example.com', password: 'secure-password-b' },
			{ email: 'duplicate@example.com', password: 'secure-password-c' }
		]);

		expect(body.code).not.toBe(200);
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM user').first()).toEqual({ count: 0 });
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM account').first()).toEqual({ count: 0 });
	});
});
