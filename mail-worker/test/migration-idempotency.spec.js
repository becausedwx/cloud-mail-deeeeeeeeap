import { describe, expect, it } from 'vitest';
import { dbInit } from '../src/init/init';

function createV25MigrationDb({ unreadColumnExists }) {
	const state = {
		emailColumns: new Set(unreadColumnExists ? ['email_id', 'unread'] : ['email_id']),
		unreadValues: [0],
		executedSql: []
	};

	const db = {
		state,
		prepare(sql) {
			const normalizedSql = sql.replace(/\s+/g, ' ').trim();
			return {
				async all() {
					if (normalizedSql.includes('PRAGMA table_info(email)')) {
						return {
							results: [...state.emailColumns].map(name => ({ name }))
						};
					}
					return { results: [] };
				},
				async run() {
					state.executedSql.push(normalizedSql);
					if (normalizedSql.includes('ALTER TABLE email ADD COLUMN unread')) {
						if (state.emailColumns.has('unread')) {
							throw new Error('duplicate column name: unread');
						}
						state.emailColumns.add('unread');
						state.unreadValues = state.unreadValues.map(() => 0);
					}
					if (normalizedSql === 'UPDATE email SET unread = 1;') {
						state.unreadValues = state.unreadValues.map(() => 1);
					}
					return { success: true };
				}
			};
		},
		async batch(statements) {
			const snapshot = {
				emailColumns: new Set(state.emailColumns),
				unreadValues: [...state.unreadValues],
				executedSqlLength: state.executedSql.length
			};
			try {
				return await Promise.all(statements.map(statement => statement.run()));
			} catch (error) {
				state.emailColumns = snapshot.emailColumns;
				state.unreadValues = snapshot.unreadValues;
				state.executedSql.length = snapshot.executedSqlLength;
				throw error;
			}
		}
	};
	return db;
}

describe('database migration idempotency', () => {
	it('backfills unread exactly once when v2.5 adds the column', async () => {
		const db = createV25MigrationDb({ unreadColumnExists: false });

		await dbInit.v2_5DB({ env: { db } });

		expect(db.state.emailColumns.has('unread')).toBe(true);
		expect(db.state.unreadValues).toEqual([1]);
		expect(db.state.executedSql.filter(sql => sql === 'UPDATE email SET unread = 1;')).toHaveLength(1);
	});

	it('preserves existing read state when v2.5 is rerun', async () => {
		const db = createV25MigrationDb({ unreadColumnExists: true });

		await dbInit.v2_5DB({ env: { db } });

		expect(db.state.unreadValues).toEqual([0]);
		expect(db.state.executedSql).not.toContain('UPDATE email SET unread = 1;');
	});
});
