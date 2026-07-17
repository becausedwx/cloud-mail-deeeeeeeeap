import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import cryptoUtils from '../src/utils/crypto-utils';
import userService from '../src/service/user-service';

const LEGACY_EMAIL = 'admin@example.com';
const LEGACY_PASSWORD = 'legacy-password-value';
const LEGACY_SALT = 'legacy-password-salt';

async function initializeDatabase() {
	const response = await SELF.fetch('http://example.com/api/init', {
		method: 'POST',
		headers: { 'X-Cloud-Mail-Init-Secret': 'your-jwt-secret' }
	});
	expect(response.status).toBe(200);
}

async function login(password) {
	const response = await SELF.fetch('http://example.com/api/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: LEGACY_EMAIL, password })
	});
	return response.json();
}

async function generatePublicToken(password) {
	const response = await SELF.fetch('http://example.com/api/public/genToken', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: LEGACY_EMAIL, password })
	});
	return response.json();
}

describe('password hash migration', () => {
	let legacyHash;

	beforeAll(async () => {
		await initializeDatabase();
		legacyHash = await cryptoUtils.genHashPassword(LEGACY_PASSWORD, LEGACY_SALT);
	});

	beforeEach(async () => {
		await env.db.batch([
			env.db.prepare('DELETE FROM auth_failure_limit'),
			env.db.prepare('DELETE FROM account'),
			env.db.prepare('DELETE FROM user'),
			env.db.prepare(`
				INSERT INTO user (user_id, email, type, password, salt, status, is_del)
				VALUES (501, ?, 1, ?, ?, 0, 0)
			`).bind(LEGACY_EMAIL, legacyHash, LEGACY_SALT),
			env.db.prepare(`
				INSERT INTO account (account_id, email, name, user_id, is_del)
				VALUES (601, ?, 'Legacy User', 501, 0)
			`).bind(LEGACY_EMAIL)
		]);
	});

	it('upgrades a legacy SHA-256 password after a successful login', async () => {
		const body = await login(LEGACY_PASSWORD);
		expect(body.code).toBe(200);

		const userRow = await env.db.prepare(`
			SELECT password, salt
			FROM user
			WHERE user_id = 501
		`).first();
		expect(userRow.password).toMatch(/^pbkdf2-sha256\$v1\$/);
		expect(userRow.password).not.toBe(legacyHash);
		expect(await cryptoUtils.verifyPassword(LEGACY_PASSWORD, userRow.salt, userRow.password)).toBe(true);
	});

	it('does not upgrade a legacy hash when the password is wrong', async () => {
		const body = await login('wrong-password');
		expect(body.code).not.toBe(200);

		const userRow = await env.db.prepare(`
			SELECT password, salt
			FROM user
			WHERE user_id = 501
		`).first();
		expect(userRow).toMatchObject({ password: legacyHash, salt: LEGACY_SALT });
	});

	it('upgrades a legacy administrator password after public token generation', async () => {
		const body = await generatePublicToken(LEGACY_PASSWORD);
		expect(body.code).toBe(200);

		const userRow = await env.db.prepare(`
			SELECT password, salt
			FROM user
			WHERE user_id = 501
		`).first();
		expect(userRow.password).toMatch(/^pbkdf2-sha256\$v1\$/);
		expect(await cryptoUtils.verifyPassword(LEGACY_PASSWORD, userRow.salt, userRow.password)).toBe(true);
	});

	it('does not overwrite a password reset that wins the migration race', async () => {
		const staleUserRow = await env.db.prepare(`
			SELECT user_id AS userId, email, password, salt
			FROM user
			WHERE user_id = 501
		`).first();
		const resetPassword = await cryptoUtils.hashPassword('new-reset-password');
		await env.db.prepare(`
			UPDATE user SET password = ?, salt = ? WHERE user_id = 501
		`).bind(resetPassword.hash, resetPassword.salt).run();

		expect(await userService.upgradePasswordHash(
			{ env },
			staleUserRow,
			LEGACY_PASSWORD
		)).toBeNull();
		const userRow = await env.db.prepare(`
			SELECT password, salt FROM user WHERE user_id = 501
		`).first();
		expect(userRow).toEqual({ password: resetPassword.hash, salt: resetPassword.salt });
	});
});
