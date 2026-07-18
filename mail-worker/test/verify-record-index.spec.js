import { describe, expect, it } from 'vitest';
import { dbInit } from '../src/init/init';

describe('verify record index migration', () => {
	it('creates the IP and type index idempotently', async () => {
		const statements = [];
		const db = {
			prepare(sql) {
				return {
					async run() {
						statements.push(sql.replace(/\s+/g, ' ').trim());
					}
				};
			}
		};

		await dbInit.v3_8DB({ env: { db } });
		await dbInit.v3_8DB({ env: { db } });

		expect(statements).toHaveLength(2);
		expect(statements[0]).toContain('CREATE INDEX IF NOT EXISTS idx_verify_record_ip_type');
		expect(statements[0]).toContain('ON verify_record(ip, type)');
	});
});
