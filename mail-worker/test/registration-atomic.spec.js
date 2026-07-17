import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import settingService from '../src/service/setting-service';
import roleService from '../src/service/role-service';
import regKeyService from '../src/service/reg-key-service';

const REGISTRATION_CODE = 'single-use-registration-code';

async function initializeDatabase() {
	const response = await SELF.fetch('http://example.com/api/init', {
		method: 'POST',
		headers: { 'X-Cloud-Mail-Init-Secret': 'your-jwt-secret' }
	});
	expect(response.status).toBe(200);
}

async function register(email) {
	const response = await SELF.fetch('http://example.com/api/register', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			email,
			password: 'registration-test-password',
			code: REGISTRATION_CODE
		})
	});
	return response.json();
}

describe('atomic registration-key consumption', () => {
	beforeAll(initializeDatabase);

	beforeEach(async () => {
		await env.db.prepare('DROP TRIGGER IF EXISTS fail_registration_account').run();
		await env.db.batch([
			env.db.prepare('DELETE FROM attachments'),
			env.db.prepare('DELETE FROM star'),
			env.db.prepare('DELETE FROM email_search'),
			env.db.prepare('DELETE FROM email'),
			env.db.prepare('DELETE FROM oauth'),
			env.db.prepare('DELETE FROM account'),
			env.db.prepare('DELETE FROM user'),
			env.db.prepare('DELETE FROM reg_key'),
			env.db.prepare(`
				UPDATE setting
				SET register = 0, reg_key = 0, register_verify = 1
			`),
			env.db.prepare(`
				INSERT INTO reg_key (code, count, role_id, user_id, expire_time)
				VALUES (?, 1, 1, 0, '2099-12-31 00:00:00')
			`).bind(REGISTRATION_CODE)
		]);
		await settingService.refresh({ env });
		roleService.clearCache();
	});

	it('allows only one of two concurrent registrations to consume a single-use key', async () => {
		const bodies = await Promise.all([
			register('first@example.com'),
			register('second@example.com')
		]);

		expect(bodies.filter(body => body.code === 200)).toHaveLength(1);
		expect(bodies.filter(body => body.code !== 200)).toHaveLength(1);
		expect(await env.db.prepare(`
			SELECT count
			FROM reg_key
			WHERE code = ?
		`).bind(REGISTRATION_CODE).first()).toMatchObject({ count: 0 });
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM user').first())
			.toMatchObject({ count: 1 });
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM account').first())
			.toMatchObject({ count: 1 });
	});

	it('restores the key and rolls back the user when account creation fails', async () => {
		await env.db.prepare(`
			CREATE TRIGGER fail_registration_account
			BEFORE INSERT ON account
			WHEN NEW.email = 'failure@example.com'
			BEGIN
				SELECT RAISE(ABORT, 'forced account failure');
			END
		`).run();

		const body = await register('failure@example.com');

		expect(body.code).not.toBe(200);
		expect(await env.db.prepare(`
			SELECT count
			FROM reg_key
			WHERE code = ?
		`).bind(REGISTRATION_CODE).first()).toMatchObject({ count: 1 });
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM user').first())
			.toMatchObject({ count: 0 });
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM account').first())
			.toMatchObject({ count: 0 });
	});

	it('atomically reserves a single-use key without allowing a negative count', async () => {
		const keyRow = await env.db.prepare(`
			SELECT rege_key_id AS regKeyId, role_id AS roleId
			FROM reg_key
			WHERE code = ?
		`).bind(REGISTRATION_CODE).first();

		const results = await Promise.all(Array.from({ length: 8 }, () => (
			regKeyService.reserveCount({ env }, {
				regKeyId: keyRow.regKeyId,
				roleId: keyRow.roleId,
				quantity: 1
			})
		)));

		expect(results.filter(Boolean)).toHaveLength(1);
		expect(results.filter(result => !result)).toHaveLength(7);
		expect(await env.db.prepare(`
			SELECT count
			FROM reg_key
			WHERE rege_key_id = ?
		`).bind(keyRow.regKeyId).first()).toMatchObject({ count: 0 });
	});
});
