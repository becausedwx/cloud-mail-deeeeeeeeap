import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';

vi.mock('../src/service/email-search-service', () => ({
	default: {
		syncEmailIds: vi.fn(),
		removeEmailIds: vi.fn()
	}
}));

import deliveryAttemptService, {
	deliveryAttemptConst
} from '../src/service/delivery-attempt-service';
import { emailConst } from '../src/const/entity-const';
import { dbInit } from '../src/init/init';
import emailSearchService from '../src/service/email-search-service';

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
		vi.clearAllMocks();
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

	it('repairs a stale IN_FLIGHT attempt when the accepted provider id already reached the email row', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status, resend_email_id)
			VALUES (50, ?, ?, 'resend-message-50')
		`).bind(emailConst.type.SEND, emailConst.status.SENT).run();
		const attempt = await deliveryAttemptService.prepare({ env }, {
			emailId: 50,
			provider: deliveryAttemptConst.provider.RESEND,
			attemptKey: 'cloud-mail/50/in-flight-email-final'
		});
		await deliveryAttemptService.markInFlight({ env }, attempt.attemptId);
		await env.db.prepare(`
			UPDATE delivery_attempt
			SET update_time = datetime('now', '-20 minutes')
			WHERE attempt_id = ?
		`).bind(attempt.attemptId).run();

		const result = await deliveryAttemptService.reconcile({ env });

		const storedAttempt = await env.db.prepare(`
			SELECT status, provider_message_id AS providerMessageId, error_summary AS errorSummary
			FROM delivery_attempt WHERE attempt_id = ?
		`).bind(attempt.attemptId).first();
		expect(result).toMatchObject({ repaired: 1, unknown: 0 });
		expect(storedAttempt).toEqual({
			status: deliveryAttemptConst.status.ACCEPTED,
			providerMessageId: 'resend-message-50',
			errorSummary: null
		});
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

	it('uses one small shared reconciliation budget per invocation', async () => {
		for (let emailId = 100; emailId < 110; emailId += 1) {
			await env.db.prepare(`
				INSERT INTO email (email_id, type, status)
				VALUES (?, ?, ?)
			`).bind(emailId, emailConst.type.SEND, emailConst.status.SAVING).run();
			const attempt = await deliveryAttemptService.prepare({ env }, {
				emailId,
				provider: deliveryAttemptConst.provider.RESEND,
				attemptKey: `cloud-mail/${emailId}/budget`
			});
			await env.db.prepare(`
				UPDATE delivery_attempt
				SET update_time = datetime('now', '-20 minutes')
				WHERE attempt_id = ?
			`).bind(attempt.attemptId).run();
		}

		const result = await deliveryAttemptService.reconcile({ env });
		const counts = await env.db.prepare(`
			SELECT status, COUNT(*) AS total
			FROM delivery_attempt
			GROUP BY status
			ORDER BY status
		`).all();

		expect(result).toMatchObject({ scanned: 4, failed: 4 });
		expect(counts.results).toEqual(expect.arrayContaining([
			{ status: deliveryAttemptConst.status.FAILED, total: 4 },
			{ status: deliveryAttemptConst.status.PREPARED, total: 6 }
		]));
		expect(emailSearchService.syncEmailIds).toHaveBeenCalledOnce();
		expect(emailSearchService.syncEmailIds.mock.calls[0][1]).toHaveLength(4);
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

	it('allows only one durable delivery attempt per email under concurrency', async () => {
		await dbInit.v3_6DB({ env });

		const results = await Promise.allSettled([
			deliveryAttemptService.prepare({ env }, {
				emailId: 80,
				provider: deliveryAttemptConst.provider.RESEND
			}),
			deliveryAttemptService.prepare({ env }, {
				emailId: 80,
				provider: deliveryAttemptConst.provider.RESEND
			})
		]);

		expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
		expect((await env.db.prepare(`
			SELECT COUNT(*) AS total FROM delivery_attempt WHERE email_id = 80
		`).first()).total).toBe(1);
	});

	it('does not allow one provider message id to identify multiple delivery attempts', async () => {
		await dbInit.v3_6DB({ env });
		const first = await deliveryAttemptService.prepare({ env }, {
			emailId: 81,
			provider: deliveryAttemptConst.provider.RESEND
		});
		const second = await deliveryAttemptService.prepare({ env }, {
			emailId: 82,
			provider: deliveryAttemptConst.provider.RESEND
		});
		await deliveryAttemptService.markInFlight({ env }, first.attemptId);
		await deliveryAttemptService.markInFlight({ env }, second.attemptId);
		await deliveryAttemptService.markAccepted({ env }, first.attemptId, 'resend-shared-id');

		await expect(deliveryAttemptService.markAccepted(
			{ env },
			second.attemptId,
			'resend-shared-id'
		)).rejects.toThrow();
	});

	it('repairs a named but non-unique attempt key index', async () => {
		await env.db.prepare('DROP INDEX idx_delivery_attempt_key').run();
		await env.db.prepare(`
			CREATE INDEX idx_delivery_attempt_key ON delivery_attempt(attempt_key)
		`).run();

		await dbInit.v3_6DB({ env });

		const index = (await env.db.prepare(`
			PRAGMA index_list(delivery_attempt)
		`).all()).results.find(row => row.name === 'idx_delivery_attempt_key');
		expect(index).toEqual(expect.objectContaining({ unique: 1 }));
	});

	it.each([
		{
			name: 'attempt key',
			first: [91, 'RESEND', 'duplicate-key', null],
			second: [92, 'RESEND', 'duplicate-key', null]
		},
		{
			name: 'email id',
			first: [93, 'RESEND', 'email-93-a', null],
			second: [93, 'RESEND', 'email-93-b', null]
		},
		{
			name: 'provider message id',
			first: [94, 'RESEND', 'email-94', 'duplicate-provider-id'],
			second: [95, 'RESEND', 'email-95', 'duplicate-provider-id']
		}
	])('rejects duplicate $name data before replacing legacy indexes', async ({ first, second }) => {
		await env.db.prepare('DROP INDEX idx_delivery_attempt_key').run();
		for (const sql of [
			'CREATE INDEX idx_delivery_attempt_key ON delivery_attempt(attempt_key)',
			'CREATE INDEX idx_delivery_attempt_email ON delivery_attempt(email_id)',
			`CREATE INDEX idx_delivery_attempt_provider_message
			 ON delivery_attempt(provider, provider_message_id)
			 WHERE provider_message_id IS NOT NULL AND provider_message_id <> ''`
		]) {
			await env.db.prepare(sql).run();
		}
		for (const values of [first, second]) {
			await env.db.prepare(`
				INSERT INTO delivery_attempt (
					email_id, provider, attempt_key, status, provider_message_id
				) VALUES (?, ?, ?, 'ACCEPTED', ?)
			`).bind(...values).run();
		}

		await expect(dbInit.v3_6DB({ env })).rejects.toMatchObject({
			name: 'BizError',
			code: 409
		});

		const indexes = (await env.db.prepare(`
			PRAGMA index_list(delivery_attempt)
		`).all()).results;
		for (const indexName of [
			'idx_delivery_attempt_key',
			'idx_delivery_attempt_email',
			'idx_delivery_attempt_provider_message'
		]) {
			expect(indexes.find(row => row.name === indexName)).toEqual(
				expect.objectContaining({ unique: 0 })
			);
		}
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
			'idx_delivery_attempt_email',
			'idx_delivery_attempt_provider_message'
		]));
	});

	it('repairs missing delivery attempt columns before creating indexes', async () => {
		await env.db.prepare('DROP TABLE delivery_attempt').run();
		await env.db.prepare(`
			CREATE TABLE delivery_attempt (
				attempt_id INTEGER PRIMARY KEY AUTOINCREMENT
			)
		`).run();

		await dbInit.v3_6DB({ env });

		const columns = await env.db.prepare(`
			PRAGMA table_info(delivery_attempt)
		`).all();
		expect(columns.results.map(row => row.name)).toEqual(expect.arrayContaining([
			'email_id',
			'provider',
			'attempt_key',
			'status',
			'provider_message_id',
			'error_summary',
			'create_time',
			'update_time'
		]));
	});

	it('auto-resolves an UNKNOWN attempt to ACCEPTED when the email already shows webhook evidence', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status, resend_email_id)
			VALUES (61, ?, ?, 'resend-61')
		`).bind(emailConst.type.SEND, emailConst.status.SENT).run();
		const attempt = await deliveryAttemptService.prepare({ env }, {
			emailId: 61,
			provider: deliveryAttemptConst.provider.RESEND,
			attemptKey: 'cloud-mail/61/unknown-evidence'
		});
		await deliveryAttemptService.markInFlight({ env }, attempt.attemptId);
		await deliveryAttemptService.markUnknown({ env }, attempt.attemptId);

		const result = await deliveryAttemptService.reconcile({ env });

		const storedAttempt = await env.db.prepare(`
			SELECT status, provider_message_id AS providerMessageId, error_summary AS errorSummary
			FROM delivery_attempt WHERE attempt_id = ?
		`).bind(attempt.attemptId).first();
		expect(storedAttempt).toEqual({
			status: deliveryAttemptConst.status.ACCEPTED,
			providerMessageId: 'resend-61',
			errorSummary: null
		});
		expect(result).toMatchObject({ scanned: 1, repaired: 1, unknown: 0, failed: 0 });
	});

	it('keeps an UNKNOWN attempt untouched when there is no webhook evidence', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status)
			VALUES (62, ?, ?)
		`).bind(emailConst.type.SEND, emailConst.status.SAVING).run();
		const attempt = await deliveryAttemptService.prepare({ env }, {
			emailId: 62,
			provider: deliveryAttemptConst.provider.RESEND,
			attemptKey: 'cloud-mail/62/unknown-no-evidence'
		});
		await deliveryAttemptService.markInFlight({ env }, attempt.attemptId);
		await deliveryAttemptService.markUnknown({ env }, attempt.attemptId);

		const result = await deliveryAttemptService.reconcile({ env });

		const storedAttempt = await env.db.prepare(`
			SELECT status FROM delivery_attempt WHERE attempt_id = ?
		`).bind(attempt.attemptId).first();
		const storedEmail = await env.db.prepare(`
			SELECT status FROM email WHERE email_id = 62
		`).first();
		expect(storedAttempt).toEqual({ status: deliveryAttemptConst.status.UNKNOWN });
		expect(storedEmail).toEqual({ status: emailConst.status.SAVING });
		expect(result).toMatchObject({ scanned: 0, repaired: 0 });
	});

	it('manually resolves UNKNOWN attempts to ACCEPTED and promotes the stuck emails', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status) VALUES (63, ?, ?)
		`).bind(emailConst.type.SEND, emailConst.status.SAVING).run();
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status, resend_email_id) VALUES (64, ?, ?, 'resend-64-existing')
		`).bind(emailConst.type.SEND, emailConst.status.SAVING).run();
		const resendAttempt = await deliveryAttemptService.prepare({ env }, {
			emailId: 63,
			provider: deliveryAttemptConst.provider.RESEND,
			attemptKey: 'cloud-mail/63/manual-ack'
		});
		await deliveryAttemptService.markInFlight({ env }, resendAttempt.attemptId);
		await deliveryAttemptService.markUnknown({ env }, resendAttempt.attemptId);
		await env.db.prepare(`
			UPDATE delivery_attempt SET provider_message_id = 'resend-63' WHERE attempt_id = ?
		`).bind(resendAttempt.attemptId).run();
		const cfAttempt = await deliveryAttemptService.prepare({ env }, {
			emailId: 64,
			provider: deliveryAttemptConst.provider.CLOUDFLARE_EMAIL,
			attemptKey: 'cloud-mail/64/manual-ack'
		});
		await deliveryAttemptService.markInFlight({ env }, cfAttempt.attemptId);
		await deliveryAttemptService.markUnknown({ env }, cfAttempt.attemptId);

		const result = await deliveryAttemptService.resolveUnknown({ env }, { outcome: 'accepted' });

		expect(result).toEqual({ outcome: 'accepted', scanned: 2, resolved: 2 });
		const storedResendEmail = await env.db.prepare(`
			SELECT status, resend_email_id AS resendEmailId, message FROM email WHERE email_id = 63
		`).first();
		const storedCfEmail = await env.db.prepare(`
			SELECT status, resend_email_id AS resendEmailId, message FROM email WHERE email_id = 64
		`).first();
		expect(storedResendEmail).toEqual({
			status: emailConst.status.SENT,
			resendEmailId: 'resend-63',
			message: 'MANUALLY_MARKED_ACCEPTED'
		});
		// attempt 无 provider message id 时保留邮件上既有的 id，webhook 后续仍可匹配
		expect(storedCfEmail).toEqual({
			status: emailConst.status.DELIVERED,
			resendEmailId: 'resend-64-existing',
			message: 'MANUALLY_MARKED_ACCEPTED'
		});
		const attemptRows = await env.db.prepare(`
			SELECT status, error_summary AS errorSummary FROM delivery_attempt ORDER BY attempt_id
		`).all();
		expect(attemptRows.results).toEqual([
			{ status: deliveryAttemptConst.status.ACCEPTED, errorSummary: 'MANUALLY_MARKED_ACCEPTED' },
			{ status: deliveryAttemptConst.status.ACCEPTED, errorSummary: 'MANUALLY_MARKED_ACCEPTED' }
		]);

		const secondRun = await deliveryAttemptService.resolveUnknown({ env }, { outcome: 'accepted' });
		expect(secondRun).toEqual({ outcome: 'accepted', scanned: 0, resolved: 0 });
	});

	it('manually resolves UNKNOWN attempts to FAILED so the sender can retry', async () => {
		await env.db.prepare(`
			INSERT INTO email (email_id, type, status) VALUES (65, ?, ?)
		`).bind(emailConst.type.SEND, emailConst.status.SAVING).run();
		const attempt = await deliveryAttemptService.prepare({ env }, {
			emailId: 65,
			provider: deliveryAttemptConst.provider.RESEND,
			attemptKey: 'cloud-mail/65/manual-fail'
		});
		await deliveryAttemptService.markInFlight({ env }, attempt.attemptId);
		await deliveryAttemptService.markUnknown({ env }, attempt.attemptId);

		const result = await deliveryAttemptService.resolveUnknown({ env }, { outcome: 'failed' });

		expect(result).toEqual({ outcome: 'failed', scanned: 1, resolved: 1 });
		const storedAttempt = await env.db.prepare(`
			SELECT status, error_summary AS errorSummary FROM delivery_attempt WHERE attempt_id = ?
		`).bind(attempt.attemptId).first();
		const storedEmail = await env.db.prepare(`
			SELECT status, message FROM email WHERE email_id = 65
		`).first();
		expect(storedAttempt).toEqual({
			status: deliveryAttemptConst.status.FAILED,
			errorSummary: 'MANUALLY_MARKED_FAILED'
		});
		expect(storedEmail).toEqual({
			status: emailConst.status.FAILED,
			message: 'DELIVERY_MANUALLY_MARKED_FAILED'
		});
	});

	it('rejects an invalid manual outcome for unknown deliveries', async () => {
		await expect(deliveryAttemptService.resolveUnknown({ env }, { outcome: 'retry' }))
			.rejects.toMatchObject({ code: 400 });
	});
});
