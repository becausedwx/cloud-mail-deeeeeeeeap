import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attConst, emailConst, isDel } from '../src/const/entity-const';
import attService from '../src/service/att-service';
import starService from '../src/service/star-service';

describe('lite attachment list projections', () => {
	beforeAll(async () => {
		const response = await SELF.fetch('http://example.com/api/init', {
			method: 'POST',
			headers: { 'X-Cloud-Mail-Init-Secret': 'your-jwt-secret' }
		});
		expect(response.status).toBe(200);
	});

	beforeEach(async () => {
		await env.db.batch([
			env.db.prepare('DELETE FROM attachments'),
			env.db.prepare('DELETE FROM star'),
			env.db.prepare('DELETE FROM email')
		]);
	});

	it('does not load full attachment rows for the lite starred list', async () => {
		const emailRow = await env.db.prepare(`
			INSERT INTO email (
				send_email, account_id, user_id, subject, type, status, is_del
			) VALUES (?, ?, ?, ?, ?, ?, ?)
			RETURNING email_id AS emailId
		`).bind(
			'sender@example.com',
			1,
			17,
			'Lite attachment summary',
			emailConst.type.RECEIVE,
			emailConst.status.RECEIVE,
			isDel.NORMAL
		).first();
		await env.db.batch([
			env.db.prepare('INSERT INTO star (user_id, email_id) VALUES (?, ?)')
				.bind(17, emailRow.emailId),
			env.db.prepare(`
				INSERT INTO attachments (
					user_id, email_id, account_id, key, filename, status, type
				) VALUES (?, ?, ?, ?, ?, ?, ?)
			`).bind(
				17,
				emailRow.emailId,
				1,
				'attachments/lite.pdf',
				'lite.pdf',
				attConst.status.READY,
				attConst.type.ATT
			)
		]);

		const originalSelect = attService.selectByEmailIds;
		const originalCount = attService.countByEmailIds;
		let fullRowReads = 0;
		let countReads = 0;
		attService.selectByEmailIds = async function (...args) {
			fullRowReads++;
			return originalSelect.apply(this, args);
		};
		attService.countByEmailIds = async function (...args) {
			countReads++;
			return originalCount.apply(this, args);
		};

		try {
			const result = await starService.list(
				{ env },
				{ emailId: 0, size: 10, lite: '1' },
				17
			);

			expect(fullRowReads).toBe(0);
			expect(countReads).toBe(1);
			expect(result.list[0]).toMatchObject({
				emailId: emailRow.emailId,
				attCount: 1,
				attList: []
			});
		} finally {
			attService.selectByEmailIds = originalSelect;
			attService.countByEmailIds = originalCount;
		}
	});
});
