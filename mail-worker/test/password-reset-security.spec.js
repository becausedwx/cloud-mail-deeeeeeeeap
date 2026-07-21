import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import KvConst from '../src/const/kv-const';
import userService from '../src/service/user-service';

const EMAIL = 'password-reset-user@example.com';
const CURRENT_PASSWORD = 'current-password';
const NEW_PASSWORD = 'new-password';

async function initializeDatabase() {
	const response = await SELF.fetch('http://example.com/api/init', {
		method: 'POST',
		headers: { 'X-Cloud-Mail-Init-Secret': 'your-jwt-secret' }
	});
	expect(response.status).toBe(200);
}

async function register(email = EMAIL, password = CURRENT_PASSWORD) {
	const body = await (await SELF.fetch('http://example.com/api/register', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password })
	})).json();
	expect(body.code).toBe(200);
}

async function login(password, email = EMAIL) {
	return (await SELF.fetch('http://example.com/api/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password })
	})).json();
}

async function currentUser(token) {
	return (await SELF.fetch('http://example.com/api/my/loginUserInfo', {
		headers: { Authorization: token }
	})).json();
}

describe('self-service password reset security', () => {
	beforeAll(initializeDatabase);

	beforeEach(async () => {
		await env.db.batch([
			env.db.prepare('DELETE FROM auth_failure_limit'),
			env.db.prepare('DELETE FROM account'),
			env.db.prepare('DELETE FROM user')
		]);
		const kvKeys = await env.kv.list();
		await Promise.all(kvKeys.keys.map(key => env.kv.delete(key.name)));
		await register();
	});

	it('requires the current password and revokes every existing session after a successful change', async () => {
		const firstLogin = await login(CURRENT_PASSWORD);
		const secondLogin = await login(CURRENT_PASSWORD);
		expect(firstLogin.code).toBe(200);
		expect(secondLogin.code).toBe(200);

		const userRow = await env.db.prepare(`
			SELECT user_id AS userId FROM user WHERE email = ?
		`).bind(EMAIL).first();
		const authInfo = await env.kv.get(KvConst.AUTH_INFO + userRow.userId, { type: 'json' });
		expect(authInfo.tokens).toHaveLength(2);

		const resetBody = await (await SELF.fetch('http://example.com/api/my/resetPassword', {
			method: 'PUT',
			headers: {
				Authorization: firstLogin.data.token,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				currentPassword: CURRENT_PASSWORD,
				newPassword: NEW_PASSWORD
			})
		})).json();
		expect(resetBody.code).toBe(200);
		expect(await env.kv.get(KvConst.AUTH_INFO + userRow.userId)).toBeNull();

		for (const token of [firstLogin.data.token, secondLogin.data.token]) {
			expect((await currentUser(token)).code).toBe(401);
		}

		expect((await login(CURRENT_PASSWORD)).code).not.toBe(200);
		expect((await login(NEW_PASSWORD)).code).toBe(200);
	});

	it('keeps the password and sessions unchanged when the current password is wrong', async () => {
		const activeLogin = await login(CURRENT_PASSWORD);
		expect(activeLogin.code).toBe(200);
		const before = await env.db.prepare(`
			SELECT user_id AS userId, password, salt FROM user WHERE email = ?
		`).bind(EMAIL).first();

		const resetBody = await (await SELF.fetch('http://example.com/api/my/resetPassword', {
			method: 'PUT',
			headers: {
				Authorization: activeLogin.data.token,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				currentPassword: 'wrong-password',
				newPassword: NEW_PASSWORD
			})
		})).json();
		expect(resetBody.code).toBe(400);

		const after = await env.db.prepare(`
			SELECT password, salt FROM user WHERE user_id = ?
		`).bind(before.userId).first();
		expect(after).toEqual({ password: before.password, salt: before.salt });
		expect(await env.kv.get(KvConst.AUTH_INFO + before.userId)).not.toBeNull();
		expect((await currentUser(activeLogin.data.token)).code).toBe(200);
		expect((await login(CURRENT_PASSWORD)).code).toBe(200);
		expect((await login(NEW_PASSWORD)).code).not.toBe(200);
	});

	it.each([
		{},
		{ currentPassword: CURRENT_PASSWORD },
		{ newPassword: NEW_PASSWORD },
		{ currentPassword: 123, newPassword: NEW_PASSWORD },
		{ currentPassword: CURRENT_PASSWORD, newPassword: 123 },
		{ currentPassword: CURRENT_PASSWORD, newPassword: 'short' },
		{ currentPassword: CURRENT_PASSWORD, newPassword: 'x'.repeat(31) },
		{ password: NEW_PASSWORD }
	])('rejects invalid password change fields without changing authentication: %j', async payload => {
		const activeLogin = await login(CURRENT_PASSWORD);
		expect(activeLogin.code).toBe(200);
		const before = await env.db.prepare(`
			SELECT user_id AS userId, password, salt FROM user WHERE email = ?
		`).bind(EMAIL).first();

		const resetBody = await (await SELF.fetch('http://example.com/api/my/resetPassword', {
			method: 'PUT',
			headers: {
				Authorization: activeLogin.data.token,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(payload)
		})).json();
		expect(resetBody.code).not.toBe(200);

		const after = await env.db.prepare(`
			SELECT password, salt FROM user WHERE user_id = ?
		`).bind(before.userId).first();
		expect(after).toEqual({ password: before.password, salt: before.salt });
		expect((await currentUser(activeLogin.data.token)).code).toBe(200);
	});

	it('fails closed and restores the old password when session revocation fails', async () => {
		const activeLogin = await login(CURRENT_PASSWORD);
		expect(activeLogin.code).toBe(200);
		const before = await env.db.prepare(`
			SELECT user_id AS userId, password, salt FROM user WHERE email = ?
		`).bind(EMAIL).first();
		const deleteSession = vi.fn().mockRejectedValue(new Error('KV unavailable'));

		await expect(userService.resetPassword({
			env: {
				db: env.db,
				kv: { delete: deleteSession }
			}
		}, {
			currentPassword: CURRENT_PASSWORD,
			newPassword: NEW_PASSWORD
		}, before.userId)).rejects.toMatchObject({ code: 503 });
		expect(deleteSession).toHaveBeenCalledWith(KvConst.AUTH_INFO + before.userId);

		const after = await env.db.prepare(`
			SELECT password, salt FROM user WHERE user_id = ?
		`).bind(before.userId).first();
		expect(after).toEqual({ password: before.password, salt: before.salt });
		expect(await env.kv.get(KvConst.AUTH_INFO + before.userId)).not.toBeNull();
		expect((await currentUser(activeLogin.data.token)).code).toBe(200);
		expect((await login(CURRENT_PASSWORD)).code).toBe(200);
		expect((await login(NEW_PASSWORD)).code).not.toBe(200);
	});
});
