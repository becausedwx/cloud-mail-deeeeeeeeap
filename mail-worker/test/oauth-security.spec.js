import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import oauthService from '../src/service/oauth-service';
import settingService from '../src/service/setting-service';
import roleService from '../src/service/role-service';
import { dbInit } from '../src/init/init';

const OAUTH_CONFIG = {
	linuxdo_client_id: 'test-linuxdo-client',
	linuxdo_client_secret: 'test-linuxdo-secret',
	linuxdo_callback_url: 'https://mail.example.com/login',
	linuxdo_switch: true
};

function context() {
	return {
		req: {
			header: () => ''
		},
		env: {
			db: env.db,
			kv: env.kv,
			jwt_secret: 'your-jwt-secret',
			admin: 'admin@example.com',
			domain: ['example.com'],
			...OAUTH_CONFIG
		}
	};
}

async function initializeDatabase() {
	const response = await SELF.fetch('http://example.com/api/init', {
		method: 'POST',
		headers: { 'X-Cloud-Mail-Init-Secret': 'your-jwt-secret' }
	});
	expect(response.status).toBe(200);
}

function base64Url(bytes) {
	return btoa(String.fromCharCode(...bytes))
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');
}

async function sha256Base64Url(value) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return base64Url(new Uint8Array(digest));
}

async function clearTable(name) {
	try {
		await env.db.prepare(`DELETE FROM ${name}`).run();
	} catch (error) {
		if (!String(error?.message || error).includes('no such table')) throw error;
	}
}

describe('LinuxDo OAuth state and PKCE security', () => {
	beforeAll(initializeDatabase);

	beforeEach(async () => {
		await env.db.prepare('DROP TRIGGER IF EXISTS fail_oauth_bind').run();
		await clearTable('oauth_auth_state');
		await clearTable('oauth_bind_challenge');
		await clearTable('oauth');
		await clearTable('account');
		await clearTable('user');
		// 这里的 c.req.header 恒返回空串，全部用例共用同一个限流身份，
		// 不清会让上一个用例攒下的失败计数把下一个用例的绑定打成 429
		await clearTable('auth_failure_limit');
		const kvKeys = await env.kv.list();
		await Promise.all(kvKeys.keys.map(key => env.kv.delete(key.name)));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('creates a one-time state and S256 PKCE authorization URL without storing raw state', async () => {
		const data = await oauthService.createLinuxDoAuthorization(context());
		const authorizationUrl = new URL(data.authorizationUrl);

		expect(authorizationUrl.origin + authorizationUrl.pathname)
			.toBe('https://connect.linux.do/oauth2/authorize');
		expect(authorizationUrl.searchParams.get('state')).toBe(data.state);
		expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
		expect(authorizationUrl.searchParams.get('client_id')).toBe(OAUTH_CONFIG.linuxdo_client_id);
		expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(OAUTH_CONFIG.linuxdo_callback_url);

		const stateHash = await sha256Base64Url(data.state);
		const row = await env.db.prepare(`
			SELECT state_hash AS stateHash,
			       code_verifier AS codeVerifier,
			       expires_at AS expiresAt
			FROM oauth_auth_state
			WHERE state_hash = ?
		`).bind(stateHash).first();
		expect(row.stateHash).toBe(stateHash);
		expect(row.stateHash).not.toBe(data.state);
		expect(authorizationUrl.searchParams.get('code_challenge'))
			.toBe(await sha256Base64Url(row.codeVerifier));
		expect(row.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
	});

	it('blocks every OAuth entry point when LinuxDo is disabled without consuming issued credentials', async () => {
		const c = context();
		const authorization = await oauthService.createLinuxDoAuthorization(c);
		const stateHash = await sha256Base64Url(authorization.state);
		await oauthService.saveUser(c, {
			oauthUserId: 'disabled-oauth-user',
			username: 'disabled-user',
			name: 'Disabled User',
			active: 0,
			trustLevel: 1,
			silenced: 0
		});
		const bindToken = await oauthService.issueBindToken(c, 'disabled-oauth-user');
		c.env.linuxdo_switch = false;
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);

		await expect(oauthService.createLinuxDoAuthorization(c))
			.rejects.toMatchObject({ code: 403 });
		await expect(oauthService.linuxDoLogin(c, {
			code: 'oauth-code',
			state: authorization.state
		})).rejects.toMatchObject({ code: 403 });
		await expect(oauthService.bindUser(c, {
			email: 'disabled-bind@example.com',
			bindToken
		})).rejects.toMatchObject({ code: 403 });

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(await env.db.prepare(`
			SELECT 1 FROM oauth_auth_state WHERE state_hash = ?
		`).bind(stateHash).first()).not.toBeNull();
		expect(await env.db.prepare(`
			SELECT 1 FROM oauth_bind_challenge WHERE oauth_user_id = 'disabled-oauth-user'
		`).first()).not.toBeNull();
	});

	it('atomically caps active authorization states per source without storing the raw IP', async () => {
		const sourceIp = '203.0.113.42';
		const c = context();
		c.req.header = name => name.toLowerCase() === 'cf-connecting-ip' ? sourceIp : '';

		const attempts = await Promise.allSettled(Array.from({ length: 24 }, () => (
			oauthService.createLinuxDoAuthorization(c)
		)));
		expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(20);
		expect(attempts.filter(attempt => attempt.status === 'rejected')).toHaveLength(4);
		expect(attempts.filter(attempt => attempt.status === 'rejected').every(attempt => (
			attempt.reason?.code === 429
		))).toBe(true);

		const issued = attempts
			.filter(attempt => attempt.status === 'fulfilled')
			.map(attempt => attempt.value);
		const fetchSpy = vi.fn(async () => new Response('', {
			status: 400,
			statusText: 'invalid authorization code'
		}));
		vi.stubGlobal('fetch', fetchSpy);
		await Promise.all(issued.map(authorization => (
			expect(oauthService.linuxDoLogin(c, {
				code: 'bogus-code',
				state: authorization.state
			})).rejects.toBeInstanceOf(Error)
		)));
		await expect(oauthService.createLinuxDoAuthorization(c))
			.rejects.toMatchObject({ code: 429 });

		const rows = await env.db.prepare(`
			SELECT state_hash AS stateHash,
			       initiator_hash AS initiatorHash,
			       consumed,
			       expires_at AS expiresAt
			FROM oauth_auth_state
		`).all();
		expect(rows.results).toHaveLength(20);
		expect(rows.results.every(row => row.consumed === 1)).toBe(true);
		expect(JSON.stringify(rows.results)).not.toContain(sourceIp);
	});

	it('atomically enforces the deployment-wide authorization state ceiling', async () => {
		const expiresAt = Math.floor(Date.now() / 1000) + 600;
		await env.db.prepare(`
			WITH RECURSIVE sequence(value) AS (
				VALUES (1)
				UNION ALL
				SELECT value + 1 FROM sequence WHERE value < 99
			)
			INSERT INTO oauth_auth_state (
				state_hash, code_verifier, initiator_hash, consumed, expires_at
			)
			SELECT
				'global-state-' || value,
				'global-verifier-' || value,
				'global-initiator-' || value,
				0,
				?
			FROM sequence
		`).bind(expiresAt).run();

		const first = context();
		first.req.header = name => name.toLowerCase() === 'cf-connecting-ip'
			? '203.0.113.50'
			: '';
		const second = context();
		second.req.header = name => name.toLowerCase() === 'cf-connecting-ip'
			? '203.0.113.51'
			: '';
		const attempts = await Promise.allSettled([
			oauthService.createLinuxDoAuthorization(first),
			oauthService.createLinuxDoAuthorization(second)
		]);

		expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1);
		expect(attempts.filter(attempt => attempt.status === 'rejected')).toHaveLength(1);
		expect(attempts.find(attempt => attempt.status === 'rejected').reason)
			.toMatchObject({ code: 429 });
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count FROM oauth_auth_state WHERE expires_at > ?
	`).bind(Math.floor(Date.now() / 1000)).first()).toMatchObject({ count: 100 });
	});

	it('rejects missing, wrong, and expired state before calling LinuxDo', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const c = context();

		await expect(oauthService.linuxDoLogin(c, { code: 'oauth-code' }))
			.rejects.toMatchObject({ code: 400 });
		await expect(oauthService.linuxDoLogin(c, { code: 'oauth-code', state: 'wrong-state' }))
			.rejects.toMatchObject({ code: 400 });

		const authorization = await oauthService.createLinuxDoAuthorization(c);
		await env.db.prepare('UPDATE oauth_auth_state SET expires_at = 0').run();
		await expect(oauthService.linuxDoLogin(c, {
			code: 'oauth-code',
			state: authorization.state
		})).rejects.toMatchObject({ code: 400 });

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('rejects a malformed token response before requesting LinuxDo user data', async () => {
		const c = context();
		const authorization = await oauthService.createLinuxDoAuthorization(c);
		const fetchSpy = vi.fn(async url => {
			if (url === 'https://connect.linux.do/oauth2/token') {
				return new Response(JSON.stringify({}), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});
		vi.stubGlobal('fetch', fetchSpy);

		await expect(oauthService.linuxDoLogin(c, {
			code: 'oauth-code',
			state: authorization.state
		})).rejects.toMatchObject({ code: 502 });
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM oauth').first())
			.toMatchObject({ count: 0 });
	});

	it('rejects LinuxDo user data without a valid positive identity before persistence', async () => {
		const c = context();
		const authorization = await oauthService.createLinuxDoAuthorization(c);
		const fetchSpy = vi.fn(async url => {
			if (url === 'https://connect.linux.do/oauth2/token') {
				return new Response(JSON.stringify({ access_token: 'linuxdo-access-token' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			if (url === 'https://connect.linux.do/api/user') {
				return new Response(JSON.stringify({
					username: 'missing-id-user',
					name: 'Missing ID User'
				}), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});
		vi.stubGlobal('fetch', fetchSpy);

		await expect(oauthService.linuxDoLogin(c, {
			code: 'oauth-code',
			state: authorization.state
		})).rejects.toMatchObject({ code: 502 });
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM oauth').first())
			.toMatchObject({ count: 0 });
	});

	it('consumes state once under concurrency and sends the matching PKCE verifier', async () => {
		const c = context();
		const authorization = await oauthService.createLinuxDoAuthorization(c);
		const stateHash = await sha256Base64Url(authorization.state);
		const stateRow = await env.db.prepare(`
			SELECT code_verifier AS codeVerifier
			FROM oauth_auth_state
			WHERE state_hash = ?
		`).bind(stateHash).first();
		const fetchSpy = vi.fn(async (url, options = {}) => {
			if (url === 'https://connect.linux.do/oauth2/token') {
				return new Response(JSON.stringify({ access_token: 'linuxdo-access-token' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			if (url === 'https://connect.linux.do/api/user') {
				return new Response(JSON.stringify({
					id: 42,
					username: 'linuxdo-user',
					name: 'LinuxDo User',
					active: true,
					silenced: false,
					trust_level: 2,
					avatar_url: 'https://linux.do/avatar.png'
				}), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});
		vi.stubGlobal('fetch', fetchSpy);

		const attempts = await Promise.allSettled([
			oauthService.linuxDoLogin(c, { code: 'oauth-code', state: authorization.state }),
			oauthService.linuxDoLogin(c, { code: 'oauth-code', state: authorization.state })
		]);
		expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1);
		expect(attempts.filter(attempt => attempt.status === 'rejected')).toHaveLength(1);
		const successfulLogin = attempts.find(attempt => attempt.status === 'fulfilled').value;
		expect(successfulLogin.bindToken).toEqual(expect.any(String));
		expect(successfulLogin.userInfo).toMatchObject({
			oauthUserId: '42',
			active: 0,
			silenced: 0
		});
		const issuedChallenge = await env.db.prepare(`
			SELECT token_hash AS tokenHash
			FROM oauth_bind_challenge
			WHERE oauth_user_id = '42'
		`).first();
		expect(issuedChallenge.tokenHash).not.toBe(successfulLogin.bindToken);
		expect(attempts.find(attempt => attempt.status === 'rejected').reason)
			.toMatchObject({ code: 400 });
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		const tokenRequest = fetchSpy.mock.calls.find(([url]) => (
			url === 'https://connect.linux.do/oauth2/token'
		));
		expect(new URLSearchParams(tokenRequest[1].body).get('code_verifier'))
			.toBe(stateRow.codeVerifier);
		expect(await env.db.prepare(`
			SELECT consumed FROM oauth_auth_state WHERE state_hash = ?
		`).bind(stateHash).first()).toMatchObject({ consumed: 1 });

		await expect(oauthService.linuxDoLogin(c, {
			code: 'oauth-code',
			state: authorization.state
		})).rejects.toMatchObject({ code: 400 });
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it('atomically upserts one OAuth identity without overwriting its bound user', async () => {
		const c = context();
		const userInfo = {
			oauthUserId: 'concurrent-oauth-user',
			username: 'oauth-user',
			name: 'OAuth User',
			avatar: 'https://linux.do/avatar.png',
			active: 0,
			trustLevel: 2,
			silenced: 0
		};

		const rows = await Promise.all(Array.from({ length: 8 }, () => (
			oauthService.saveUser(c, userInfo)
		)));
		expect(rows.every(row => row.oauthUserId === userInfo.oauthUserId)).toBe(true);
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count FROM oauth WHERE oauth_user_id = ?
		`).bind(userInfo.oauthUserId).first()).toMatchObject({ count: 1 });

		await env.db.prepare(`
			UPDATE oauth SET user_id = 777 WHERE oauth_user_id = ?
		`).bind(userInfo.oauthUserId).run();
		await oauthService.saveUser(c, {
			...userInfo,
			name: 'Updated OAuth User',
			userId: 0
		});
		expect(await env.db.prepare(`
			SELECT name, user_id AS userId
			FROM oauth
			WHERE oauth_user_id = ?
		`).bind(userInfo.oauthUserId).first()).toMatchObject({
			name: 'Updated OAuth User',
			userId: 777
		});
	});

	it('consumes an opaque bind token once before concurrent user creation', async () => {
		const c = context();
		await env.db.prepare(`
			UPDATE setting
			SET register = 0, reg_key = 1, register_verify = 1
		`).run();
		await settingService.refresh(c);
		roleService.clearCache();
		await oauthService.saveUser(c, {
			oauthUserId: 'bind-oauth-user',
			username: 'bind-user',
			name: 'Bind User',
			active: 0,
			trustLevel: 1,
			silenced: 0
		});
		const bindToken = await oauthService.issueBindToken(c, 'bind-oauth-user');
		const challenge = await env.db.prepare(`
			SELECT token_hash AS tokenHash, expires_at AS expiresAt
			FROM oauth_bind_challenge
			WHERE oauth_user_id = 'bind-oauth-user'
		`).first();
		expect(challenge.tokenHash).not.toBe(bindToken);
		expect(challenge.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

		const attempts = await Promise.allSettled([
			oauthService.bindUser(c, {
				email: 'first-bind@example.com',
				bindToken
			}),
			oauthService.bindUser(c, {
				email: 'second-bind@example.com',
				bindToken
			})
		]);
		expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1);
		expect(attempts.filter(attempt => attempt.status === 'rejected')).toHaveLength(1);
		expect(attempts.find(attempt => attempt.status === 'rejected').reason)
			.toMatchObject({ code: 400 });
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM user').first())
			.toMatchObject({ count: 1 });
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM account').first())
			.toMatchObject({ count: 1 });
		const boundOauth = await env.db.prepare(`
			SELECT user_id AS userId FROM oauth WHERE oauth_user_id = 'bind-oauth-user'
		`).first();
		expect(boundOauth.userId).toBeGreaterThan(0);
		expect(await env.db.prepare(`
			SELECT 1 FROM oauth_bind_challenge WHERE oauth_user_id = 'bind-oauth-user'
		`).first()).toBeNull();

		await expect(oauthService.bindUser(c, {
			email: 'replay-bind@example.com',
			bindToken
		})).rejects.toMatchObject({ code: 400 });
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM user').first())
			.toMatchObject({ count: 1 });
	});

	it('awaits the conditional OAuth bind update and removes a partial registration on failure', async () => {
		const c = context();
		await env.db.prepare(`
			UPDATE setting
			SET register = 0, reg_key = 1, register_verify = 1
		`).run();
		await settingService.refresh(c);
		roleService.clearCache();
		await oauthService.saveUser(c, {
			oauthUserId: 'failing-bind-user',
			username: 'failing-bind-user',
			name: 'Failing Bind User',
			active: 0,
			trustLevel: 1,
			silenced: 0
		});
		const bindToken = await oauthService.issueBindToken(c, 'failing-bind-user');
		await env.db.prepare(`
			CREATE TRIGGER fail_oauth_bind
			BEFORE UPDATE OF user_id ON oauth
			WHEN NEW.oauth_user_id = 'failing-bind-user'
			BEGIN
				SELECT RAISE(ABORT, 'forced oauth bind failure');
			END
		`).run();

		await expect(oauthService.bindUser(c, {
			email: 'failed-bind@example.com',
			bindToken
		})).rejects.toThrow('forced oauth bind failure');
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM user').first())
			.toMatchObject({ count: 0 });
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM account').first())
			.toMatchObject({ count: 0 });
		expect(await env.db.prepare(`
			SELECT user_id AS userId FROM oauth WHERE oauth_user_id = 'failing-bind-user'
		`).first()).toMatchObject({ userId: 0 });
	});

	it('rejects OAuth binding for a new email when registration is closed', async () => {
		const c = context();
		await env.db.prepare(`
			UPDATE setting
			SET register = 1, reg_key = 1, register_verify = 1
		`).run();
		await settingService.refresh(c);
		roleService.clearCache();
		await oauthService.saveUser(c, {
			oauthUserId: 'reg-closed-user',
			username: 'reg-closed-user',
			name: 'Reg Closed User',
			active: 0,
			trustLevel: 1,
			silenced: 0
		});
		const bindToken = await oauthService.issueBindToken(c, 'reg-closed-user');

		await expect(oauthService.bindUser(c, {
			email: 'closed-reg@example.com',
			bindToken
		})).rejects.toMatchObject({ name: 'BizError', code: 501 });
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM user').first())
			.toMatchObject({ count: 0 });
		expect(await env.db.prepare(`
			SELECT user_id AS userId FROM oauth WHERE oauth_user_id = 'reg-closed-user'
		`).first()).toMatchObject({ userId: 0 });

		await env.db.prepare('UPDATE setting SET register = 0').run();
		await settingService.refresh(c);
	});

	it('keeps the legacy OAuth auto-register behavior behind oauth_auto_register', async () => {
		const c = context();
		c.env.oauth_auto_register = 'true';
		await env.db.prepare(`
			UPDATE setting
			SET register = 1, reg_key = 1, register_verify = 1
		`).run();
		await settingService.refresh(c);
		roleService.clearCache();
		await oauthService.saveUser(c, {
			oauthUserId: 'auto-reg-user',
			username: 'auto-reg-user',
			name: 'Auto Reg User',
			active: 0,
			trustLevel: 1,
			silenced: 0
		});
		const bindToken = await oauthService.issueBindToken(c, 'auto-reg-user');

		await oauthService.bindUser(c, {
			email: 'auto-reg@example.com',
			bindToken
		});
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM user').first())
			.toMatchObject({ count: 1 });
		const bound = await env.db.prepare(`
			SELECT user_id AS userId FROM oauth WHERE oauth_user_id = 'auto-reg-user'
		`).first();
		expect(bound.userId).toBeGreaterThan(0);

		await env.db.prepare('UPDATE setting SET register = 0').run();
		await settingService.refresh(c);
	});

	it('rate limits OAuth bind registration by source so rotating emails cannot enumerate accounts', async () => {
		const c = context();
		await env.db.prepare(`
			UPDATE setting
			SET register = 0, reg_key = 1, register_verify = 1
		`).run();
		await settingService.refresh(c);
		roleService.clearCache();

		// 每次探测都换一个已存在的邮箱：限流若仍按 email 分桶，配额永远刷不满
		const probes = Array.from({ length: 6 }, (_, index) => `probe-${index}@example.com`);
		for (const [index, probeEmail] of probes.entries()) {
			await env.db.batch([
				env.db.prepare(`
					INSERT INTO user (user_id, email, type, password, salt, status, is_del)
					VALUES (?, ?, 1, 'hash', 'salt', 0, 0)
				`).bind(900 + index, probeEmail),
				env.db.prepare(`
					INSERT INTO account (account_id, email, name, user_id, is_del)
					VALUES (?, ?, 'Probe', ?, 0)
				`).bind(900 + index, probeEmail, 900 + index)
			]);
		}

		await oauthService.saveUser(c, {
			oauthUserId: 'enum-probe-user',
			username: 'enum-probe-user',
			name: 'Enum Probe User',
			active: 0,
			trustLevel: 1,
			silenced: 0
		});
		const bindToken = await oauthService.issueBindToken(c, 'enum-probe-user');

		const codes = [];
		for (const probeEmail of probes) {
			codes.push(await oauthService.bindUser(c, { email: probeEmail, bindToken })
				.then(() => 200, error => error.code));
		}

		// 前几次是「该邮箱已注册」，攒够失败后转为 429：轮换邮箱不再能无限试探
		expect(codes).not.toContain(200);
		expect(codes.filter(code => code === 429).length).toBeGreaterThan(0);
		expect(codes.at(-1)).toBe(429);
		expect(await env.db.prepare('SELECT COUNT(*) AS count FROM user').first())
			.toMatchObject({ count: probes.length });
	});

	it('keeps active bind flows while removing expired state and stale unbound identities', async () => {
		const c = context();
		await oauthService.saveUser(c, {
			oauthUserId: 'cleanup-oauth-user',
			username: 'cleanup-user',
			name: 'Cleanup User',
			active: 0,
			trustLevel: 1,
			silenced: 0
		});
		await oauthService.issueBindToken(c, 'cleanup-oauth-user');
		await env.db.prepare(`
			INSERT INTO oauth_auth_state (state_hash, code_verifier, expires_at)
			VALUES ('expired-state', 'expired-verifier', 0)
		`).run();

		await oauthService.clearNoBindOathUser(c);
		expect(await env.db.prepare(`
			SELECT 1 FROM oauth WHERE oauth_user_id = 'cleanup-oauth-user'
		`).first()).not.toBeNull();
		expect(await env.db.prepare(`
			SELECT 1 FROM oauth_bind_challenge WHERE oauth_user_id = 'cleanup-oauth-user'
		`).first()).not.toBeNull();
		expect(await env.db.prepare(`
			SELECT 1 FROM oauth_auth_state WHERE state_hash = 'expired-state'
		`).first()).toBeNull();

		await env.db.batch([
			env.db.prepare(`
				UPDATE oauth
				SET create_time = datetime('now', '-2 days')
				WHERE oauth_user_id = 'cleanup-oauth-user'
			`),
			env.db.prepare(`
				UPDATE oauth_bind_challenge
				SET expires_at = 0
				WHERE oauth_user_id = 'cleanup-oauth-user'
			`)
		]);
		await oauthService.clearNoBindOathUser(c);
		expect(await env.db.prepare(`
			SELECT 1 FROM oauth WHERE oauth_user_id = 'cleanup-oauth-user'
		`).first()).toBeNull();
		expect(await env.db.prepare(`
			SELECT 1 FROM oauth_bind_challenge WHERE oauth_user_id = 'cleanup-oauth-user'
		`).first()).toBeNull();
	});

	it('keeps bootstrap incomplete when the secure OAuth identity index is missing', async () => {
		await env.db.prepare('DROP INDEX IF EXISTS idx_oauth_platform_user_unique').run();
		try {
			const status = await (await SELF.fetch('http://example.com/api/init/status')).json();
			expect(status).toMatchObject({
				code: 200,
				data: {
					initialized: false,
					ready: false
				}
			});
		} finally {
			await env.db.prepare(`
				CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_platform_user_unique
				ON oauth (platform, oauth_user_id)
			`).run();
		}
	});

	it('returns an explicit conflict when historical OAuth identities prevent the unique index', async () => {
		const c = context();
		await env.db.prepare('DROP INDEX IF EXISTS idx_oauth_platform_user_unique').run();
		await env.db.batch([
			env.db.prepare(`
				INSERT INTO oauth (oauth_user_id, username, platform, user_id)
				VALUES ('', 'legacy-empty-one', 0, 0)
			`),
			env.db.prepare(`
				INSERT INTO oauth (oauth_user_id, username, platform, user_id)
				VALUES ('', 'legacy-empty-two', 0, 0)
			`)
		]);

		try {
			await expect(dbInit.v3_4DB(c)).rejects.toMatchObject({ code: 409 });
			expect(await env.db.prepare(`
				SELECT 1 FROM sqlite_master
				WHERE type = 'index' AND name = 'idx_oauth_platform_user_unique'
			`).first()).toBeNull();
		} finally {
			await env.db.prepare(`
				DELETE FROM oauth WHERE username IN ('legacy-empty-one', 'legacy-empty-two')
			`).run();
			await env.db.prepare(`
				CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_platform_user_unique
				ON oauth (platform, oauth_user_id)
			`).run();
		}
	});
});
