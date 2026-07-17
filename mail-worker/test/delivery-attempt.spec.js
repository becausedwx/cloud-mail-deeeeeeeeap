import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import deliveryAttemptService, {
	deliveryAttemptConst
} from '../src/service/delivery-attempt-service';
import { emailConst } from '../src/const/entity-const';
import { dbInit } from '../src/init/init';

async function resetDeliverySchema() {
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
			attempt_key TEXT NOT NULL,
			status TEXT NOT NULL,
			provider_message_id TEXT,
			error_summary TEXT,
			create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`).run();
	await env.db.prepare(`
		CREATE UNIQUE INDEX idx_delivery_attempt_key
		ON delivery_attempt(attempt_key)
	`).run();
}

describe('delivery attempt service', () => {
	beforeEach(async () => {
		await resetDeliverySchema();
	});

	it('persists a PREPARED attempt with a stable idempotency key', async () => {
		const row = await deliveryAttemptService.prepare({ env }, {
			emailId: 42,
			provider: deliveryAttemptConst.provider.RESEND,
			attemptKey: 'cloud-mail/42/stable-attempt'
		});

		const stored = await env.db.prepare(`
			SELECT
				attempt_id AS attemptId,
				email_id AS emailId,
				provider,
				attempt_key AS attemptKey,
				status,
				provider_message_id AS providerMessageId,
				error_summary AS errorSummary
			FROM delivery_attempt
			WHERE attempt_id = ?
		`).bind(row.attemptId).first();

		expect(stored).toEqual({
			attemptId: row.attemptId,
			emailId: 42,
			provider: deliveryAttemptConst.provider.RESEND,
			attemptKey: 'cloud-mail/42/stable-attempt',
			status: deliveryAttemptConst.status.PREPARED,
			providerMessageId: null,
			errorSummary: null
		});
	});

	it('reconciles PENDING_ACK to ACCEPTED and repairs the local Resend status', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status)
			VALUES (42, ?, ?)
		`).bind(emailConst.type.SEND, emailConst.status.SAVING).run();
		const attempt = await deliveryAttemptService.prepare({ env }, {
			emailId: 42,
			provider: deliveryAttemptConst.provider.RESEND,
			attemptKey: 'cloud-mail/42/pending-ack'
		});
		await deliveryAttemptService.markInFlight({ env }, attempt.attemptId);
		await deliveryAttemptService.markPendingAck(
			{ env },
			attempt.attemptId,
			'resend-message-42'
		);

		await deliveryAttemptService.reconcile({ env });

		const storedAttempt = await env.db.prepare(`
			SELECT status, provider_message_id AS providerMessageId
			FROM delivery_attempt WHERE attempt_id = ?
		`).bind(attempt.attemptId).first();
		const storedEmail = await env.db.prepare(`
			SELECT status, resend_email_id AS resendEmailId, message
			FROM email WHERE email_id = 42
		`).first();
		expect(storedAttempt).toEqual({
			status: deliveryAttemptConst.status.ACCEPTED,
			providerMessageId: 'resend-message-42'
		});
		expect(storedEmail).toEqual({
			status: emailConst.status.SENT,
			resendEmailId: 'resend-message-42',
			message: null
		});
	});

	it('finalizes PENDING_ACK even when the email row already reached SENT', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status, resend_email_id)
			VALUES (49, ?, ?, 'resend-message-49')
		`).bind(emailConst.type.SEND, emailConst.status.SENT).run();
		const attempt = await deliveryAttemptService.prepare({ env }, {
			emailId: 49,
			provider: deliveryAttemptConst.provider.RESEND,
			attemptKey: 'cloud-mail/49/pending-ack-email-final'
		});
		await deliveryAttemptService.markInFlight({ env }, attempt.attemptId);
		await deliveryAttemptService.markPendingAck(
			{ env },
			attempt.attemptId,
			'resend-message-49'
		);

		const result = await deliveryAttemptService.reconcile({ env });

		const storedAttempt = await env.db.prepare(`
			SELECT status, error_summary AS errorSummary
			FROM delivery_attempt WHERE attempt_id = ?
		`).bind(attempt.attemptId).first();
		expect(result.repaired).toBe(1);
		expect(storedAttempt).toEqual({
			status: deliveryAttemptConst.status.ACCEPTED,
			errorSummary: null
		});
	});

	it('repairs a SAVING email from an ACCEPTED attempt idempotently', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status)
			VALUES (48, ?, ?)
		`).bind(emailConst.type.SEND, emailConst.status.SAVING).run();
		const attempt = await deliveryAttemptService.prepare({ env }, {
			emailId: 48,
			provider: deliveryAttemptConst.provider.RESEND,
			attemptKey: 'cloud-mail/48/accepted'
		});
		await deliveryAttemptService.markInFlight({ env }, attempt.attemptId);
		await deliveryAttemptService.markAccepted(
			{ env },
			attempt.attemptId,
			'resend-message-48'
		);

		const first = await deliveryAttemptService.reconcile({ env });
		const second = await deliveryAttemptService.reconcile({ env });

		const storedEmail = await env.db.prepare(`
			SELECT status, resend_email_id AS resendEmailId, message
			FROM email WHERE email_id = 48
		`).first();
		expect(first.repaired).toBe(1);
		expect(second.repaired).toBe(0);
		expect(storedEmail).toEqual({
			status: emailConst.status.SENT,
			resendEmailId: 'resend-message-48',
			message: null
		});
	});

	it('converts a stale IN_FLIGHT attempt to UNKNOWN without failing the email', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status)
			VALUES (43, ?, ?)
		`).bind(emailConst.type.SEND, emailConst.status.SAVING).run();
		const attempt = await deliveryAttemptService.prepare({ env }, {
			emailId: 43,
			provider: deliveryAttemptConst.provider.CLOUDFLARE_EMAIL,
			attemptKey: 'cloud-mail/43/in-flight'
		});
		await deliveryAttemptService.markInFlight({ env }, attempt.attemptId);
		await env.db.prepare(`
			UPDATE delivery_attempt
			SET update_time = datetime('now', '-20 minutes')
			WHERE attempt_id = ?
		`).bind(attempt.attemptId).run();

		const first = await deliveryAttemptService.reconcile({ env });
		const second = await deliveryAttemptService.reconcile({ env });

		const storedAttempt = await env.db.prepare(`
			SELECT status, error_summary AS errorSummary
			FROM delivery_attempt WHERE attempt_id = ?
		`).bind(attempt.attemptId).first();
		const storedEmail = await env.db.prepare(`
			SELECT status, message FROM email WHERE email_id = 43
		`).first();
		expect(storedAttempt).toEqual({
			status: deliveryAttemptConst.status.UNKNOWN,
			errorSummary: 'PROVIDER_OUTCOME_UNKNOWN'
		});
		expect(storedEmail).toEqual({
			status: emailConst.status.SAVING,
			message: 'DELIVERY_OUTCOME_UNKNOWN'
		});
		expect(first.unknown).toBe(1);
		expect(second.unknown).toBe(0);
	});

	it('fails a stale PREPARED attempt because the provider was never called', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status)
			VALUES (44, ?, ?)
		`).bind(emailConst.type.SEND, emailConst.status.SAVING).run();
		const attempt = await deliveryAttemptService.prepare({ env }, {
			emailId: 44,
			provider: deliveryAttemptConst.provider.RESEND,
			attemptKey: 'cloud-mail/44/prepared'
		});
		await env.db.prepare(`
			UPDATE delivery_attempt
			SET update_time = datetime('now', '-20 minutes')
			WHERE attempt_id = ?
		`).bind(attempt.attemptId).run();

		await deliveryAttemptService.reconcile({ env });

		const storedAttempt = await env.db.prepare(`
			SELECT status, error_summary AS errorSummary
			FROM delivery_attempt WHERE attempt_id = ?
		`).bind(attempt.attemptId).first();
		const storedEmail = await env.db.prepare(`
			SELECT status, message FROM email WHERE email_id = 44
		`).first();
		expect(storedAttempt).toEqual({
			status: deliveryAttemptConst.status.FAILED,
			errorSummary: 'ATTEMPT_NOT_STARTED'
		});
		expect(storedEmail).toEqual({
			status: emailConst.status.FAILED,
			message: 'DELIVERY_ATTEMPT_NOT_STARTED'
		});
	});

	it('repairs a SAVING email from an explicitly FAILED attempt', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status)
			VALUES (45, ?, ?)
		`).bind(emailConst.type.SEND, emailConst.status.SAVING).run();
		const attempt = await deliveryAttemptService.prepare({ env }, {
			emailId: 45,
			provider: deliveryAttemptConst.provider.RESEND,
			attemptKey: 'cloud-mail/45/provider-rejected'
		});
		await deliveryAttemptService.markInFlight({ env }, attempt.attemptId);
		await deliveryAttemptService.markFailed(
			{ env },
			attempt.attemptId,
			'PROVIDER_REJECTED'
		);

		await deliveryAttemptService.reconcile({ env });

		const storedEmail = await env.db.prepare(`
			SELECT status, message FROM email WHERE email_id = 45
		`).first();
		expect(storedEmail).toEqual({
			status: emailConst.status.FAILED,
			message: 'DELIVERY_PROVIDER_REJECTED'
		});
	});

	it('reports unresolved delivery states for maintenance health', async () => {
		const unknownAttempt = await deliveryAttemptService.prepare({ env }, {
			emailId: 46,
			provider: deliveryAttemptConst.provider.CLOUDFLARE_EMAIL,
			attemptKey: 'cloud-mail/46/unknown'
		});
		await deliveryAttemptService.markInFlight({ env }, unknownAttempt.attemptId);
		await deliveryAttemptService.markUnknown({ env }, unknownAttempt.attemptId);
		const pendingAttempt = await deliveryAttemptService.prepare({ env }, {
			emailId: 47,
			provider: deliveryAttemptConst.provider.RESEND,
			attemptKey: 'cloud-mail/47/pending-ack'
		});
		await deliveryAttemptService.markInFlight({ env }, pendingAttempt.attemptId);
		await deliveryAttemptService.markPendingAck(
			{ env },
			pendingAttempt.attemptId,
			'resend-message-47'
		);

		const health = await deliveryAttemptService.health({ env });

		expect(health).toMatchObject({
			total: 2,
			unresolved: 2,
			counts: {
				UNKNOWN: 1,
				PENDING_ACK: 1
			}
		});
	});

	it('creates the delivery attempt schema idempotently', async () => {
		await env.db.prepare('DROP TABLE delivery_attempt').run();

		await dbInit.v3_6DB({ env });
		await dbInit.v3_6DB({ env });

		const table = await env.db.prepare(`
			SELECT name FROM sqlite_master
			WHERE type = 'table' AND name = 'delivery_attempt'
		`).first();
		const indexes = await env.db.prepare(`
			SELECT name FROM sqlite_master
			WHERE type = 'index' AND tbl_name = 'delivery_attempt'
		`).all();
		expect(table?.name).toBe('delivery_attempt');
		expect(indexes.results.map(row => row.name)).toEqual(expect.arrayContaining([
			'idx_delivery_attempt_key',
			'idx_delivery_attempt_status_time',
			'idx_delivery_attempt_email'
		]));
	});
});
