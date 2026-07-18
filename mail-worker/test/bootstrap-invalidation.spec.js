import { afterEach, describe, expect, it, vi } from 'vitest';
import { dbInit } from '../src/init/init';
import cryptoUtils from '../src/utils/crypto-utils';

function initContext() {
	return {
		req: { header: () => 'configured' },
		env: { jwt_secret: 'configured', db: {} },
		text(body, status = 200) { return new Response(body, { status }); }
	};
}

function adminContext({ userChanges = 1, accountChanges = 1 } = {}) {
	const db = {
		prepare(sql) {
			return {
				bind() { return this; },
				async first() {
					if (sql.includes('SELECT role_id AS roleId')) return { roleId: 1 };
					return null;
				}
			};
		},
		async batch() {
			return [
				{ meta: { changes: userChanges } },
				{ meta: { changes: accountChanges } }
			];
		}
	};
	return {
		req: { header: () => 'configured' },
		env: {
			admin: 'admin@example.com',
			jwt_secret: 'configured',
			db
		},
		text(body, status = 200) { return new Response(body, { status }); }
	};
}

describe('bootstrap cache invalidation points', () => {
	afterEach(() => vi.restoreAllMocks());

	it('invalidates before and after a successful initialization migration', async () => {
		vi.spyOn(dbInit, 'runMigrationSteps').mockResolvedValue();
		vi.spyOn(dbInit, 'assertBootstrapReady').mockResolvedValue({ schemaReady: true });
		const invalidate = vi.spyOn(dbInit, 'invalidateBootstrapStatus');

		const response = await dbInit.init(initContext());

		expect(response.status).toBe(200);
		expect(invalidate).toHaveBeenCalledTimes(2);
	});

	it('does not run the post-migration invalidation when initialization fails', async () => {
		vi.spyOn(dbInit, 'runMigrationSteps').mockRejectedValue(new Error('migration failed'));
		const readyCheck = vi.spyOn(dbInit, 'assertBootstrapReady');
		const invalidate = vi.spyOn(dbInit, 'invalidateBootstrapStatus');

		await expect(dbInit.init(initContext())).rejects.toThrow('migration failed');

		expect(invalidate).toHaveBeenCalledTimes(1);
		expect(readyCheck).not.toHaveBeenCalled();
	});

	it('invalidates only after an administrator is created successfully', async () => {
		vi.spyOn(cryptoUtils, 'hashPassword').mockResolvedValue({ salt: 'salt', hash: 'hash' });
		const invalidate = vi.spyOn(dbInit, 'invalidateBootstrapStatus');

		await dbInit.createAdmin(adminContext(), { password: 'secure-password' });
		expect(invalidate).toHaveBeenCalledTimes(1);

		invalidate.mockClear();
		await expect(dbInit.createAdmin(
			adminContext({ userChanges: 0, accountChanges: 0 }),
			{ password: 'secure-password' }
		)).rejects.toMatchObject({ code: 409 });
		expect(invalidate).not.toHaveBeenCalled();
	});
});
