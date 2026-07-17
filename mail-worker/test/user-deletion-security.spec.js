import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import KvConst from '../src/const/kv-const';

async function initializeDatabase() {
	const response = await SELF.fetch('http://example.com/api/init', {
		method: 'POST',
		headers: { 'X-Cloud-Mail-Init-Secret': 'your-jwt-secret' }
	});
	expect(response.status).toBe(200);

	await env.db.batch([
		env.db.prepare('DELETE FROM attachments'),
		env.db.prepare('DELETE FROM star'),
		env.db.prepare('DELETE FROM email'),
		env.db.prepare('DELETE FROM oauth'),
		env.db.prepare('DELETE FROM account'),
		env.db.prepare('DELETE FROM user')
	]);
	const kvKeys = await env.kv.list();
	await Promise.all(kvKeys.keys.map(key => env.kv.delete(key.name)));
}

async function register(email, password) {
	const body = await (await SELF.fetch('http://example.com/api/register', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password })
	})).json();
	expect(body.code).toBe(200);
}

async function login(email, password) {
	const body = await (await SELF.fetch('http://example.com/api/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password })
	})).json();
	expect(body.code).toBe(200);
	return body.data.token;
}

describe('physical user deletion security', () => {
	it('revokes every deleted user session while preserving the administrator session', async () => {
		await initializeDatabase();
		await SELF.fetch('http://example.com/api/init/admin', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Cloud-Mail-Init-Secret': 'your-jwt-secret'
			},
			body: JSON.stringify({ password: 'administrator-password' })
		});

		await register('victim-a@example.com', 'victim-a-password');
		await register('victim-b@example.com', 'victim-b-password');

		const [adminToken, victimAToken, victimBToken] = await Promise.all([
			login('admin@example.com', 'administrator-password'),
			login('victim-a@example.com', 'victim-a-password'),
			login('victim-b@example.com', 'victim-b-password')
		]);
		const victims = await env.db.prepare(`
			SELECT user_id AS userId, email
			FROM user
			WHERE email IN (?, ?)
			ORDER BY email
		`).bind('victim-a@example.com', 'victim-b@example.com').all();
		expect(victims.results).toHaveLength(2);
		for (const victim of victims.results) {
			expect(await env.kv.get(KvConst.AUTH_INFO + victim.userId)).not.toBeNull();
		}

		const deleteBody = await (await SELF.fetch(
			`http://example.com/api/user/delete?userIds=${victims.results.map(victim => victim.userId).join(',')}`,
			{
				method: 'DELETE',
				headers: { Authorization: adminToken }
			}
		)).json();
		expect(deleteBody.code).toBe(200);

		for (const victim of victims.results) {
			expect(await env.kv.get(KvConst.AUTH_INFO + victim.userId)).toBeNull();
		}

		for (const token of [victimAToken, victimBToken]) {
			const oldTokenBody = await (await SELF.fetch(
				'http://example.com/api/email/list?type=0&accountId=0&size=10&timeSort=0&allReceive=1&lite=1&withTotal=0',
				{ headers: { Authorization: token } }
			)).json();
			expect(oldTokenBody.code).toBe(401);
		}

		const adminBody = await (await SELF.fetch('http://example.com/api/my/loginUserInfo', {
			headers: { Authorization: adminToken }
		})).json();
		expect(adminBody.code).toBe(200);
	});
});
