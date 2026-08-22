import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import KvConst from '../src/const/kv-const';
import { dbInit } from '../src/init/init';
import { invalidateBootstrapStatusCache } from '../src/init/status';
import cryptoUtils from '../src/utils/crypto-utils';
import userService from '../src/service/user-service';
import oauthService from '../src/service/oauth-service';

async function initializeDatabase() {
	const response = await SELF.fetch('http://example.com/api/init', {
		method: 'POST',
		headers: { 'X-Cloud-Mail-Init-Secret': 'your-jwt-secret' }
	});
	expect(response.status).toBe(200);
	expect(await response.text()).toBe('success');
	await env.db.batch([
		env.db.prepare('DELETE FROM oauth'),
		env.db.prepare('DELETE FROM account'),
		env.db.prepare('DELETE FROM user')
	]);
	invalidateBootstrapStatusCache(env.db);
	const kvKeys = await env.kv.list();
	await Promise.all(kvKeys.keys.map(key => env.kv.delete(key.name)));
}

async function registerTestUser(email, password) {
	const body = await (await SELF.fetch('http://example.com/api/register', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password })
	})).json();
	expect(body.code).toBe(200);
}

async function loginTestUser(email, password) {
	const body = await (await SELF.fetch('http://example.com/api/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password })
	})).json();
	expect(body.code).toBe(200);
	return body.data.token;
}

function createRacingAdminDb() {
	let releaseChecks;
	const bothChecked = new Promise(resolve => {
		releaseChecks = resolve;
	});
	const state = {
		adminChecks: 0,
		userCount: 0,
		accountCount: 0
	};

	return {
		state,
		prepare(sql) {
			return {
				sql,
				bindings: [],
				bind(...args) {
					this.bindings = args;
					return this;
				},
				async first() {
					if (sql.includes('SELECT user_id') && sql.includes('FROM user')) {
						state.adminChecks++;
						if (state.adminChecks === 2) releaseChecks();
						await bothChecked;
						return null;
					}
					if (sql.includes('SELECT role_id AS roleId')) {
						return { roleId: 1 };
					}
					return null;
				}
			};
		},
		async batch(statements) {
			const conditionalInsert = statements[0].sql.includes('WHERE NOT EXISTS');
			const userChanges = conditionalInsert && state.userCount > 0 ? 0 : 1;
			state.userCount += userChanges;
			const accountChanges = conditionalInsert ? userChanges : 1;
			state.accountCount += accountChanges;
			return [
				{ success: true, meta: { changes: userChanges } },
				{ success: true, meta: { changes: accountChanges } }
			];
		}
	};
}

function createAdminContext(db) {
	return {
		req: {
			header: () => 'your-jwt-secret'
		},
		env: {
			admin: 'admin@example.com',
			jwt_secret: 'your-jwt-secret',
			db
		},
		text(body, status = 200) {
			return new Response(body, { status });
		}
	};
}

describe('administrator security boundaries', () => {
	it('rejects public registration of the configured administrator address', async () => {
		await initializeDatabase();

		const response = await SELF.fetch('http://example.com/api/register', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				email: 'admin@example.com',
				password: 'secure-password'
			})
		});
		const body = await response.json();

		expect(body.code).toBe(403);
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count
			FROM user
			WHERE email COLLATE NOCASE = ?
		`).bind('admin@example.com').first()).toMatchObject({ count: 0 });
	});

	it('rejects importing the configured administrator through the public API', async () => {
		await initializeDatabase();
		await env.kv.put(KvConst.PUBLIC_KEY, 'public-test-token');

		const response = await SELF.fetch('http://example.com/api/public/addUser', {
			method: 'POST',
			headers: {
				Authorization: 'public-test-token',
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				list: [{ email: 'ADMIN@example.com', password: 'secure-password' }]
			})
		});
		const body = await response.json();

		expect(body.code).toBe(403);
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count
			FROM user
			WHERE email COLLATE NOCASE = ?
		`).bind('admin@example.com').first()).toMatchObject({ count: 0 });
	});

	it('rejects the configured administrator in the authenticated user creation service', async () => {
		await expect(userService.add({
			env: { admin: 'admin@example.com' }
		}, {
			email: 'ADMIN@example.com',
			password: 'secure-password',
			type: 1
		})).rejects.toMatchObject({ code: 403 });
	});

	it('rejects oversized passwords before authenticated reset or user creation writes', async () => {
		const oversizedPassword = 'x'.repeat(31);
		await expect(userService.resetPassword(
			{ env: {} },
			{ currentPassword: 'current-password', newPassword: oversizedPassword },
			1
		)).rejects.toMatchObject({ code: 501 });
		await expect(userService.add({
			env: {
				admin: 'admin@example.com',
				domain: ['example.com']
			}
		}, {
			email: 'member@example.com',
			password: oversizedPassword,
			type: 1
		})).rejects.toMatchObject({ code: 501 });
	});

	it('does not allow a regular user to reserve the administrator address as a secondary mailbox', async () => {
		await initializeDatabase();
		await registerTestUser('member@example.com', 'member-password');
		const memberToken = await loginTestUser('member@example.com', 'member-password');

		const response = await SELF.fetch('http://example.com/api/account/add', {
			method: 'POST',
			headers: {
				Authorization: memberToken,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ email: 'Admin@Example.com' })
		});
		const body = await response.json();

		expect(body.code).toBe(403);
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count
			FROM account
			WHERE email COLLATE NOCASE = ?
		`).bind('admin@example.com').first()).toMatchObject({ count: 0 });
	});

	it('rejects binding an OAuth identity to the configured administrator address', async () => {
		await initializeDatabase();
		await env.db.prepare(`
			INSERT INTO oauth (oauth_user_id, username, user_id)
			VALUES (?, ?, 0)
		`).bind('oauth-admin-attempt', 'attacker').run();
		const bindToken = await oauthService.issueBindToken({ env }, 'oauth-admin-attempt');

		await expect(oauthService.bindUser({
			// OAuth 绑定注册现在也过限流，需要 jwt_secret 派生限流身份、req 取来源 IP
			req: { header: () => '' },
			env: {
				db: env.db,
				kv: env.kv,
				admin: 'admin@example.com',
				jwt_secret: 'your-jwt-secret',
				linuxdo_switch: true
			}
		}, {
			email: 'Admin@Example.com',
			bindToken
		})).rejects.toMatchObject({
			code: 403,
			message: 'Administrator account must be created through the initialization flow'
		});
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count
			FROM user
			WHERE email COLLATE NOCASE = ?
		`).bind('admin@example.com').first()).toMatchObject({ count: 0 });
		expect(await env.db.prepare(`
			SELECT 1 FROM oauth_bind_challenge WHERE oauth_user_id = 'oauth-admin-attempt'
		`).first()).not.toBeNull();
	});

	it('creates the administrator through the init-secret flow and preserves normal login', async () => {
		await initializeDatabase();

		const createResponse = await SELF.fetch('http://example.com/api/init/admin', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Cloud-Mail-Init-Secret': 'your-jwt-secret'
			},
			body: JSON.stringify({ password: 'secure-admin-password' })
		});

		expect(createResponse.status).toBe(200);
		expect(await createResponse.text()).toBe('success');
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count
			FROM user u
			JOIN account a ON a.user_id = u.user_id AND a.email = u.email
			WHERE u.email COLLATE NOCASE = ?
		`).bind('admin@example.com').first()).toMatchObject({ count: 1 });

		const loginResponse = await SELF.fetch('http://example.com/api/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				email: 'admin@example.com',
				password: 'secure-admin-password'
			})
		});
		const loginBody = await loginResponse.json();

		expect(loginBody.code).toBe(200);
		expect(loginBody.data.token).toEqual(expect.any(String));
	});

	it('rejects an invalid init secret without creating or exposing administrator credentials', async () => {
		await initializeDatabase();
		const submittedPassword = 'must-not-leak-password';
		const submittedSecret = 'must-not-leak-secret';

		const response = await SELF.fetch('http://example.com/api/init/admin', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Cloud-Mail-Init-Secret': submittedSecret
			},
			body: JSON.stringify({ password: submittedPassword })
		});
		const body = await response.text();

		expect(response.status).toBe(401);
		expect(body).not.toContain(submittedPassword);
		expect(body).not.toContain(submittedSecret);
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count
			FROM user
			WHERE email COLLATE NOCASE = ?
		`).bind('admin@example.com').first()).toMatchObject({ count: 0 });
	});

	it('checks the init secret before parsing the administrator request body', async () => {
		await initializeDatabase();

		const response = await SELF.fetch('http://example.com/api/init/admin', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Cloud-Mail-Init-Secret': 'wrong-secret'
			},
			body: '{not-valid-json'
		});

		expect(response.status).toBe(401);
		expect(await response.text()).toBe('Init secret mismatch');
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count
			FROM user
			WHERE email COLLATE NOCASE = ?
		`).bind('admin@example.com').first()).toMatchObject({ count: 0 });
	});

	it('fails closed when the initialization secret is not configured', async () => {
		let prepareCalls = 0;
		const context = {
			req: { header: () => undefined },
			env: {
				admin: 'admin@example.com',
				jwt_secret: undefined,
				db: {
					prepare() {
						prepareCalls++;
						throw new Error('D1 must not be touched without an init secret');
					}
				}
			},
			text(body, status = 200) {
				return new Response(body, { status });
			}
		};

		const initResponse = await dbInit.init(context);
		const adminResponse = await dbInit.createAdmin(context, { password: 'administrator-password' });

		expect(initResponse.status).toBe(401);
		expect(adminResponse.status).toBe(401);
		expect(prepareCalls).toBe(0);
	});

	it('does not recreate the administrator or expose credentials when initialization is repeated', async () => {
		await initializeDatabase();
		await SELF.fetch('http://example.com/api/init/admin', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Cloud-Mail-Init-Secret': 'your-jwt-secret'
			},
			body: JSON.stringify({ password: 'first-admin-password' })
		});

		const submittedPassword = 'second-admin-password';
		const response = await SELF.fetch('http://example.com/api/init/admin', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Cloud-Mail-Init-Secret': 'your-jwt-secret'
			},
			body: JSON.stringify({ password: submittedPassword })
		});
		const body = await response.json();

		expect(body.code).toBe(409);
		expect(JSON.stringify(body)).not.toContain(submittedPassword);
		expect(JSON.stringify(body)).not.toContain('your-jwt-secret');
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count
			FROM user
			WHERE email COLLATE NOCASE = ?
		`).bind('admin@example.com').first()).toMatchObject({ count: 1 });
	});

	it('creates only one administrator when initialization requests race', async () => {
		await initializeDatabase();

		const responses = await Promise.all([
			SELF.fetch('http://example.com/api/init/admin', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Cloud-Mail-Init-Secret': 'your-jwt-secret'
				},
				body: JSON.stringify({ password: 'concurrent-password-a' })
			}),
			SELF.fetch('http://example.com/api/init/admin', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Cloud-Mail-Init-Secret': 'your-jwt-secret'
				},
				body: JSON.stringify({ password: 'concurrent-password-b' })
			})
		]);
		const bodies = await Promise.all(responses.map(async response => {
			const contentType = response.headers.get('Content-Type') || '';
			return contentType.includes('application/json') ? response.json() : response.text();
		}));

		expect(bodies.filter(body => body === 'success')).toHaveLength(1);
		expect(bodies.filter(body => body?.code === 409)).toHaveLength(1);
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count
			FROM user
			WHERE email COLLATE NOCASE = ?
		`).bind('admin@example.com').first()).toMatchObject({ count: 1 });
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count
			FROM account
			WHERE email COLLATE NOCASE = ?
		`).bind('admin@example.com').first()).toMatchObject({ count: 1 });
	});

	it('does not create a partial administrator when the primary mailbox already conflicts', async () => {
		await initializeDatabase();
		await env.db.prepare(`
			INSERT INTO account (email, name, user_id)
			VALUES (?, ?, 0)
		`).bind('admin@example.com', 'admin').run();

		const response = await SELF.fetch('http://example.com/api/init/admin', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Cloud-Mail-Init-Secret': 'your-jwt-secret'
			},
			body: JSON.stringify({ password: 'secure-admin-password' })
		});
		const body = await response.json();

		expect(body.code).toBe(409);
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count
			FROM user
			WHERE email COLLATE NOCASE = ?
		`).bind('admin@example.com').first()).toMatchObject({ count: 0 });
	});

	it('keeps administrator creation atomic when both absence checks finish before either write', async () => {
		const db = createRacingAdminDb();
		const results = await Promise.allSettled([
			dbInit.createAdmin(createAdminContext(db), { password: 'racing-password-a' }),
			dbInit.createAdmin(createAdminContext(db), { password: 'racing-password-b' })
		]);

		expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter(result => result.status === 'rejected' && result.reason?.code === 409)).toHaveLength(1);
		expect(db.state.userCount).toBe(1);
		expect(db.state.accountCount).toBe(1);
	});

	it('preserves administrator identity when an existing account uses different email casing', async () => {
		await initializeDatabase();
		const defaultRole = await env.db.prepare(`
			SELECT role_id AS roleId
			FROM role
			WHERE is_default = 1
			LIMIT 1
		`).first();
		const { salt, hash } = await cryptoUtils.hashPassword('existing-admin-password');
		await env.db.batch([
			env.db.prepare(`
				INSERT INTO user (email, type, password, salt)
				VALUES (?, ?, ?, ?)
			`).bind('ADMIN@example.com', defaultRole.roleId, hash, salt),
			env.db.prepare(`
				INSERT INTO account (email, name, user_id)
				SELECT ?, ?, user_id FROM user WHERE email = ?
			`).bind('ADMIN@example.com', 'ADMIN', 'ADMIN@example.com')
		]);

		const loginBody = await (await SELF.fetch('http://example.com/api/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				email: 'admin@example.com',
				password: 'existing-admin-password'
			})
		})).json();
		expect(loginBody.code).toBe(200);

		const userInfo = await (await SELF.fetch('http://example.com/api/my/loginUserInfo', {
			headers: { Authorization: loginBody.data.token }
		})).json();
		expect(userInfo).toMatchObject({
			code: 200,
			data: {
				type: 0,
				permKeys: ['*']
			}
		});

		const userList = await (await SELF.fetch('http://example.com/api/user/list?num=1&size=10&status=-1&isDel=0', {
			headers: { Authorization: loginBody.data.token }
		})).json();
		expect(userList.code).toBe(200);

		const publicToken = await (await SELF.fetch('http://example.com/api/public/genToken', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				email: 'ADMIN@EXAMPLE.COM',
				password: 'existing-admin-password'
			})
		})).json();
		expect(publicToken.code).toBe(200);
	});

	it('keeps bootstrap incomplete until the administrator account exists', async () => {
		await initializeDatabase();

		const beforeCreate = await (await SELF.fetch('http://example.com/api/init/status')).json();
		expect(beforeCreate).toMatchObject({
			code: 200,
			data: {
				initialized: true,
				adminCreated: false,
				ready: false
			}
		});

		await SELF.fetch('http://example.com/api/init/admin', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Cloud-Mail-Init-Secret': 'your-jwt-secret'
			},
			body: JSON.stringify({ password: 'secure-admin-password' })
		});

		const afterCreate = await (await SELF.fetch('http://example.com/api/init/status')).json();
		expect(afterCreate).toMatchObject({
			code: 200,
			data: {
				initialized: true,
				adminCreated: true,
				ready: true
			}
		});
	});

	it('does not report bootstrap ready when the administrator primary account is missing', async () => {
		await initializeDatabase();
		const defaultRole = await env.db.prepare(`
			SELECT role_id AS roleId
			FROM role
			WHERE is_default = 1
			LIMIT 1
		`).first();
		const { salt, hash } = await cryptoUtils.hashPassword('incomplete-admin-password');
		await env.db.prepare(`
			INSERT INTO user (email, type, password, salt)
			VALUES (?, ?, ?, ?)
		`).bind('admin@example.com', defaultRole.roleId, hash, salt).run();

		const status = await (await SELF.fetch('http://example.com/api/init/status')).json();

		expect(status).toMatchObject({
			code: 200,
			data: {
				initialized: true,
				adminCreated: false,
				ready: false
			}
		});
	});

	it('does not allow the configured administrator to be disabled', async () => {
		await initializeDatabase();
		await SELF.fetch('http://example.com/api/init/admin', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Cloud-Mail-Init-Secret': 'your-jwt-secret'
			},
			body: JSON.stringify({ password: 'secure-admin-password' })
		});
		const adminRow = await env.db.prepare(`
			SELECT user_id AS userId
			FROM user
			WHERE email COLLATE NOCASE = ?
		`).bind('admin@example.com').first();
		const adminToken = await loginTestUser('admin@example.com', 'secure-admin-password');

		const response = await SELF.fetch('http://example.com/api/user/setStatus', {
			method: 'PUT',
			headers: {
				Authorization: adminToken,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ userId: adminRow.userId, status: 1 })
		});
		const body = await response.json();

		expect(body.code).toBe(403);
		expect(await env.db.prepare(`
			SELECT status
			FROM user
			WHERE user_id = ?
		`).bind(adminRow.userId).first()).toMatchObject({ status: 0 });
	});

	it('does not allow the current administrator to delete their own account', async () => {
		await initializeDatabase();
		await SELF.fetch('http://example.com/api/init/admin', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Cloud-Mail-Init-Secret': 'your-jwt-secret'
			},
			body: JSON.stringify({ password: 'secure-admin-password' })
		});
		const loginBody = await (await SELF.fetch('http://example.com/api/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				email: 'admin@example.com',
				password: 'secure-admin-password'
			})
		})).json();

		const deleteResponse = await SELF.fetch('http://example.com/api/my/delete', {
			method: 'DELETE',
			headers: { Authorization: loginBody.data.token }
		});
		const deleteBody = await deleteResponse.json();

		expect(deleteBody.code).toBe(403);
		expect(await env.db.prepare(`
			SELECT is_del AS isDel
			FROM user
			WHERE email COLLATE NOCASE = ?
		`).bind('admin@example.com').first()).toMatchObject({ isDel: 0 });
	});

	it('does not allow a case-variant administrator primary mailbox to be soft-deleted', async () => {
		await initializeDatabase();
		const defaultRole = await env.db.prepare(`
			SELECT role_id AS roleId
			FROM role
			WHERE is_default = 1
			LIMIT 1
		`).first();
		const { salt, hash } = await cryptoUtils.hashPassword('existing-admin-password');
		await env.db.prepare(`
			INSERT INTO user (email, type, password, salt)
			VALUES (?, ?, ?, ?)
		`).bind('ADMIN@example.com', defaultRole.roleId, hash, salt).run();
		const adminRow = await env.db.prepare(`
			SELECT user_id AS userId
			FROM user
			WHERE email = ?
		`).bind('ADMIN@example.com').first();
		await env.db.prepare(`
			INSERT INTO account (email, name, user_id)
			VALUES (?, ?, ?)
		`).bind('admin@example.com', 'admin', adminRow.userId).run();
		const adminAccount = await env.db.prepare(`
			SELECT account_id AS accountId
			FROM account
			WHERE email = ?
		`).bind('admin@example.com').first();
		const adminToken = await loginTestUser('admin@example.com', 'existing-admin-password');

		const response = await SELF.fetch(
			`http://example.com/api/account/delete?accountId=${adminAccount.accountId}`,
			{
				method: 'DELETE',
				headers: { Authorization: adminToken }
			}
		);
		const body = await response.json();

		expect(body.code).not.toBe(200);
		expect(await env.db.prepare(`
			SELECT is_del AS isDel
			FROM account
			WHERE account_id = ?
		`).bind(adminAccount.accountId).first()).toMatchObject({ isDel: 0 });
	});

	it('does not allow the current administrator to be physically deleted', async () => {
		await initializeDatabase();
		await SELF.fetch('http://example.com/api/init/admin', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Cloud-Mail-Init-Secret': 'your-jwt-secret'
			},
			body: JSON.stringify({ password: 'secure-admin-password' })
		});
		const adminRow = await env.db.prepare(`
			SELECT user_id AS userId
			FROM user
			WHERE email COLLATE NOCASE = ?
		`).bind('admin@example.com').first();
		const loginBody = await (await SELF.fetch('http://example.com/api/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				email: 'admin@example.com',
				password: 'secure-admin-password'
			})
		})).json();

		const deleteResponse = await SELF.fetch(
			`http://example.com/api/user/delete?userIds=${adminRow.userId}`,
			{
				method: 'DELETE',
				headers: { Authorization: loginBody.data.token }
			}
		);
		const deleteBody = await deleteResponse.json();

		expect(deleteBody.code).toBe(403);
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count
			FROM user
			WHERE user_id = ?
		`).bind(adminRow.userId).first()).toMatchObject({ count: 1 });
	});

	it('does not allow the current administrator primary mailbox to be physically deleted', async () => {
		await initializeDatabase();
		await SELF.fetch('http://example.com/api/init/admin', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Cloud-Mail-Init-Secret': 'your-jwt-secret'
			},
			body: JSON.stringify({ password: 'secure-admin-password' })
		});
		const adminAccount = await env.db.prepare(`
			SELECT account_id AS accountId
			FROM account
			WHERE email COLLATE NOCASE = ?
		`).bind('admin@example.com').first();
		const adminToken = await loginTestUser('admin@example.com', 'secure-admin-password');

		const response = await SELF.fetch(
			`http://example.com/api/user/deleteAccount?accountId=${adminAccount.accountId}`,
			{
				method: 'DELETE',
				headers: { Authorization: adminToken }
			}
		);
		const body = await response.json();

		expect(body.code).toBe(403);
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count
			FROM account
			WHERE account_id = ?
		`).bind(adminAccount.accountId).first()).toMatchObject({ count: 1 });
	});

	it('does not allow a legacy soft-deleted administrator mailbox to be physically deleted', async () => {
		await initializeDatabase();
		await SELF.fetch('http://example.com/api/init/admin', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Cloud-Mail-Init-Secret': 'your-jwt-secret'
			},
			body: JSON.stringify({ password: 'secure-admin-password' })
		});
		const adminAccount = await env.db.prepare(`
			SELECT account_id AS accountId
			FROM account
			WHERE email COLLATE NOCASE = ?
		`).bind('admin@example.com').first();
		await env.db.prepare(`
			UPDATE account
			SET is_del = 1
			WHERE account_id = ?
		`).bind(adminAccount.accountId).run();
		const adminToken = await loginTestUser('admin@example.com', 'secure-admin-password');

		const response = await SELF.fetch(
			`http://example.com/api/user/deleteAccount?accountId=${adminAccount.accountId}`,
			{
				method: 'DELETE',
				headers: { Authorization: adminToken }
			}
		);
		const body = await response.json();

		expect(body.code).toBe(403);
		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count
			FROM account
			WHERE account_id = ?
		`).bind(adminAccount.accountId).first()).toMatchObject({ count: 1 });
	});
});
