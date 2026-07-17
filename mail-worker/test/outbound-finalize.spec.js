import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { emailConst } from '../src/const/entity-const';

vi.mock('../src/service/email-search-service', () => ({
	default: {
		syncEmailIds: vi.fn(),
		removeEmailIds: vi.fn()
	}
}));

const { default: deliveryAttemptService } = await import('../src/service/delivery-attempt-service');
const { default: emailService } = await import('../src/service/email-service');

async function resetSchema() {
	await env.db.prepare('DROP TABLE IF EXISTS delivery_attempt').run();
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
			attempt_key TEXT NOT NULL UNIQUE,
			status TEXT NOT NULL,
			provider_message_id TEXT,
			error_summary TEXT,
			create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`).run();
}

describe('outbound provider finalization', () => {
	beforeEach(async () => {
		vi.restoreAllMocks();
		await resetSchema();
	});

	it('does not regress a webhook terminal state when provider finalization arrives later', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status)
			VALUES (70, ?, ?)
		`).bind(emailConst.type.SEND, emailConst.status.SAVING).run();
		vi.spyOn(emailService, 'sendByResend').mockResolvedValue({
			data: { id: 'resend-message-70' },
			error: null
		});
		const originalMarkAccepted = deliveryAttemptService.markAccepted.bind(deliveryAttemptService);
		vi.spyOn(deliveryAttemptService, 'markAccepted').mockImplementation(async (...args) => {
			const row = await originalMarkAccepted(...args);
			await env.db.prepare(`
				UPDATE email
				SET status = ?, resend_email_id = 'resend-message-70'
				WHERE email_id = 70
			`).bind(emailConst.status.COMPLAINED).run();
			return row;
		});

		await emailService.sendExternalProvider({ env: { db: env.db } }, {
			useCloudflareEmail: false,
			resendToken: 'test-token',
			name: 'Sender',
			accountEmail: 'sender@example.com',
			receiveEmail: ['recipient@example.net'],
			subject: 'Subject',
			text: 'Body',
			html: '<p>Body</p>',
			attachments: [],
			sendType: 'new',
			messageId: null,
			emailId: 70
		});

		expect(await env.db.prepare(`
			SELECT status, resend_email_id AS resendEmailId
			FROM email WHERE email_id = 70
		`).first()).toEqual({
			status: emailConst.status.COMPLAINED,
			resendEmailId: 'resend-message-70'
		});
	});
});
