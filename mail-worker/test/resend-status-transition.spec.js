import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { emailConst } from '../src/const/entity-const';

vi.mock('../src/service/email-search-service', () => ({
	default: {
		syncEmailIds: vi.fn(),
		removeEmailIds: vi.fn()
	}
}));

const { default: emailSearchService } = await import('../src/service/email-search-service');
const { default: emailService } = await import('../src/service/email-service');
const { default: resendService } = await import('../src/service/resend-service');

async function resetStatusSchema() {
	await env.db.prepare('DROP TABLE IF EXISTS delivery_attempt').run();
	await env.db.prepare('DROP TABLE IF EXISTS resend_webhook_event').run();
	await env.db.prepare('DROP TABLE IF EXISTS email').run();
	await env.db.prepare(`
		CREATE TABLE email (
			email_id INTEGER PRIMARY KEY,
			type INTEGER NOT NULL,
			status INTEGER NOT NULL,
			resend_email_id TEXT,
			message TEXT
		)
	`).run();
	await env.db.prepare(`
		CREATE TABLE delivery_attempt (
			attempt_id INTEGER PRIMARY KEY AUTOINCREMENT,
			email_id INTEGER NOT NULL,
			provider TEXT NOT NULL,
			provider_message_id TEXT
		)
	`).run();
	await env.db.prepare(`
		CREATE TABLE resend_webhook_event (
			event_key TEXT PRIMARY KEY,
			svix_id TEXT,
			body_sha256 TEXT NOT NULL,
			event_type TEXT NOT NULL,
			provider_email_id TEXT,
			status TEXT NOT NULL,
			outcome TEXT,
			received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			processed_at DATETIME
		)
	`).run();
}

function unsignedContext() {
	return {
		env: {
			db: env.db,
			resend_webhook_allow_unsigned: 'true'
		},
		req: {
			header() {
				return null;
			}
		}
	};
}

describe('Resend email status transitions', () => {
	beforeEach(async () => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		await resetStatusSchema();
	});

	it('moves SENT to DELIVERED with a conditional transition', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status, resend_email_id)
			VALUES (1, ?, ?, 'resend-message-1')
		`).bind(emailConst.type.SEND, emailConst.status.SENT).run();

		const row = await emailService.transitionExternalEmailStatus({ env }, {
			resendEmailId: 'resend-message-1',
			status: emailConst.status.DELIVERED,
			allowedStatuses: [
				emailConst.status.SAVING,
				emailConst.status.SENT,
				emailConst.status.DELAYED
			],
			message: null
		});

		expect(row).toEqual({
			emailId: 1,
			status: emailConst.status.DELIVERED
		});
		expect(await env.db.prepare(`
			SELECT status, message FROM email WHERE email_id = 1
		`).first()).toEqual({
			status: emailConst.status.DELIVERED,
			message: null
		});
		expect(emailSearchService.syncEmailIds).toHaveBeenCalledOnce();
		expect(emailSearchService.syncEmailIds.mock.calls[0][1]).toEqual([1]);
	});

	it('does not regress DELIVERED to DELAYED but allows a later complaint', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status, resend_email_id)
			VALUES (2, ?, ?, 'resend-message-2')
		`).bind(emailConst.type.SEND, emailConst.status.DELIVERED).run();
		const c = unsignedContext();

		await resendService.webhooks(c, JSON.stringify({
			type: 'email.delivery_delayed',
			data: { email_id: 'resend-message-2' }
		}));
		expect((await env.db.prepare(`
			SELECT status FROM email WHERE email_id = 2
		`).first()).status).toBe(emailConst.status.DELIVERED);
		await resendService.webhooks(c, JSON.stringify({
			type: 'email.sent',
			data: { email_id: 'resend-message-2' }
		}));
		expect((await env.db.prepare(`
			SELECT status FROM email WHERE email_id = 2
		`).first()).status).toBe(emailConst.status.DELIVERED);

		await resendService.webhooks(c, JSON.stringify({
			type: 'email.complained',
			data: { email_id: 'resend-message-2' }
		}));
		expect((await env.db.prepare(`
			SELECT status FROM email WHERE email_id = 2
		`).first()).status).toBe(emailConst.status.COMPLAINED);
		expect(emailSearchService.syncEmailIds).toHaveBeenCalledOnce();
	});

	it('advances DELAYED to DELIVERED', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status, resend_email_id)
			VALUES (3, ?, ?, 'resend-message-3')
		`).bind(emailConst.type.SEND, emailConst.status.DELAYED).run();

		await resendService.webhooks(unsignedContext(), JSON.stringify({
			type: 'email.delivered',
			data: { email_id: 'resend-message-3' }
		}));

		expect((await env.db.prepare(`
			SELECT status FROM email WHERE email_id = 3
		`).first()).status).toBe(emailConst.status.DELIVERED);
	});

	it('moves SENT to DELAYED', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status, resend_email_id)
			VALUES (31, ?, ?, 'resend-message-31')
		`).bind(emailConst.type.SEND, emailConst.status.SENT).run();

		await resendService.webhooks(unsignedContext(), JSON.stringify({
			type: 'email.delivery_delayed',
			data: { email_id: 'resend-message-31' }
		}));

		expect((await env.db.prepare(`
			SELECT status FROM email WHERE email_id = 31
		`).first()).status).toBe(emailConst.status.DELAYED);
	});

	it.each([
		['email.bounced', emailConst.status.BOUNCED, 'RESEND_BOUNCED'],
		['email.complained', emailConst.status.COMPLAINED, null],
		['email.failed', emailConst.status.FAILED, 'RESEND_DELIVERY_FAILED']
	])('advances DELAYED through %s to its final status', async (type, expectedStatus, message) => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status, resend_email_id)
			VALUES (40, ?, ?, 'resend-message-40')
		`).bind(emailConst.type.SEND, emailConst.status.DELAYED).run();

		await resendService.webhooks(unsignedContext(), JSON.stringify({
			type,
			data: { email_id: 'resend-message-40' }
		}));

		expect(await env.db.prepare(`
			SELECT status, message FROM email WHERE email_id = 40
		`).first()).toEqual({ status: expectedStatus, message });
	});

	it('does not overwrite terminal delivery states with weaker events', async () => {
		const rows = [
			{ emailId: 10, status: emailConst.status.BOUNCED, type: 'email.delivered' },
			{ emailId: 11, status: emailConst.status.FAILED, type: 'email.delivered' },
			{ emailId: 12, status: emailConst.status.COMPLAINED, type: 'email.delivery_delayed' }
		];
		for (const row of rows) {
			await env.db.prepare(`
				INSERT INTO email (email_id, type, status, resend_email_id)
				VALUES (?, ?, ?, ?)
			`).bind(
				row.emailId,
				emailConst.type.SEND,
				row.status,
				`resend-message-${row.emailId}`
			).run();
			await resendService.webhooks(unsignedContext(), JSON.stringify({
				type: row.type,
				data: { email_id: `resend-message-${row.emailId}` }
			}));
		}

		const stored = await env.db.prepare(`
			SELECT email_id AS emailId, status FROM email ORDER BY email_id
		`).all();
		expect(stored.results).toEqual(rows.map(({ emailId, status }) => ({ emailId, status })));
		expect(emailSearchService.syncEmailIds).not.toHaveBeenCalled();
	});

	it('matches a provider id through the durable delivery attempt', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status, resend_email_id)
			VALUES (4, ?, ?, NULL)
		`).bind(emailConst.type.SEND, emailConst.status.SAVING).run();
		await env.db.prepare(`
			INSERT INTO delivery_attempt (email_id, provider, provider_message_id)
			VALUES (4, 'RESEND', 'resend-message-4')
		`).run();

		await resendService.webhooks(unsignedContext(), JSON.stringify({
			type: 'email.delivered',
			data: { email_id: 'resend-message-4' }
		}));

		expect((await env.db.prepare(`
			SELECT status FROM email WHERE email_id = 4
		`).first()).status).toBe(emailConst.status.DELIVERED);
	});

	it('acknowledges an unknown provider email id without modifying mail', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status, resend_email_id)
			VALUES (5, ?, ?, 'resend-message-known')
		`).bind(emailConst.type.SEND, emailConst.status.SENT).run();

		await resendService.webhooks(unsignedContext(), JSON.stringify({
			type: 'email.delivered',
			data: { email_id: 'resend-message-unknown' }
		}));

		expect((await env.db.prepare(`
			SELECT status FROM email WHERE email_id = 5
		`).first()).status).toBe(emailConst.status.SENT);
		expect((await env.db.prepare(`
			SELECT status, outcome FROM resend_webhook_event
		`).first())).toEqual({
			status: 'PROCESSED',
			outcome: 'NO_CHANGE'
		});
		expect(emailSearchService.syncEmailIds).not.toHaveBeenCalled();
	});

	it('handles concurrent duplicate events without duplicate state changes', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status, resend_email_id)
			VALUES (6, ?, ?, 'resend-message-6')
		`).bind(emailConst.type.SEND, emailConst.status.SENT).run();
		const rawBody = JSON.stringify({
			type: 'email.delivered',
			data: { email_id: 'resend-message-6' }
		});

		await Promise.all([
			resendService.webhooks(unsignedContext(), rawBody),
			resendService.webhooks(unsignedContext(), rawBody)
		]);

		expect((await env.db.prepare(`
			SELECT status FROM email WHERE email_id = 6
		`).first()).status).toBe(emailConst.status.DELIVERED);
		expect(emailSearchService.syncEmailIds).toHaveBeenCalledOnce();
		expect((await env.db.prepare(`
			SELECT COUNT(*) AS total FROM resend_webhook_event
		`).first()).total).toBe(1);
	});

	it('updates only one sender row if historical data contains a duplicate provider id', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status, resend_email_id)
			VALUES
				(20, ?, ?, 'resend-message-duplicate'),
				(21, ?, ?, 'resend-message-duplicate')
		`).bind(
			emailConst.type.SEND,
			emailConst.status.SENT,
			emailConst.type.SEND,
			emailConst.status.SENT
		).run();

		await emailService.transitionExternalEmailStatus({ env }, {
			resendEmailId: 'resend-message-duplicate',
			status: emailConst.status.DELIVERED,
			allowedStatuses: [emailConst.status.SENT],
			message: null
		});

		const rows = await env.db.prepare(`
			SELECT email_id AS emailId, status FROM email ORDER BY email_id
		`).all();
		expect(rows.results).toEqual([
			{ emailId: 20, status: emailConst.status.DELIVERED },
			{ emailId: 21, status: emailConst.status.SENT }
		]);
		expect(emailSearchService.syncEmailIds).toHaveBeenCalledOnce();
	});

	it('finishes a resumed event when its target status was already applied', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status, resend_email_id)
			VALUES (30, ?, ?, 'resend-message-resumed')
		`).bind(emailConst.type.SEND, emailConst.status.DELIVERED).run();
		const rawBody = JSON.stringify({
			type: 'email.delivered',
			data: { email_id: 'resend-message-resumed' }
		});
		const bodyHash = await resendService.sha256Hex(rawBody);
		await env.db.prepare(`
			INSERT INTO resend_webhook_event (
				event_key, body_sha256, event_type, provider_email_id, status, received_at
			) VALUES (?, ?, 'email.delivered', 'resend-message-resumed', 'PROCESSING', datetime('now', '-2 minutes'))
		`).bind(`body:${bodyHash}`, bodyHash).run();

		await resendService.webhooks(unsignedContext(), rawBody);

		expect((await env.db.prepare(`
			SELECT status, outcome FROM resend_webhook_event
		`).first())).toEqual({
			status: 'PROCESSED',
			outcome: 'UPDATED'
		});
		expect(emailSearchService.syncEmailIds).toHaveBeenCalledOnce();
	});
});
