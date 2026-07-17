import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { attConst, emailConst, isDel } from '../src/const/entity-const';

vi.mock('../src/service/r2-service', async () => {
	const actual = await vi.importActual('../src/service/r2-service');
	return {
		default: {
			...actual.default,
			storageType: vi.fn(),
			exists: vi.fn()
		}
	};
});

const { default: r2Service } = await import('../src/service/r2-service');
const { default: attService } = await import('../src/service/att-service');
const { default: emailService } = await import('../src/service/email-service');
const { dbInit } = await import('../src/init/init');

async function resetSchema() {
	for (const table of ['attachments', 'email', 'account', 'user', 'email_search']) {
		await env.db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
	}

	for (const sql of [
		`CREATE TABLE email (
			email_id INTEGER PRIMARY KEY AUTOINCREMENT,
			send_email TEXT,
			name TEXT,
			account_id INTEGER NOT NULL,
			user_id INTEGER NOT NULL,
			subject TEXT,
			code TEXT NOT NULL DEFAULT '',
			text TEXT,
			content TEXT,
			cc TEXT DEFAULT '[]',
			bcc TEXT DEFAULT '[]',
			recipient TEXT,
			to_email TEXT NOT NULL DEFAULT '',
			to_name TEXT NOT NULL DEFAULT '',
			in_reply_to TEXT DEFAULT '',
			relation TEXT DEFAULT '',
			message_id TEXT DEFAULT '',
			type INTEGER NOT NULL DEFAULT 0,
			status INTEGER NOT NULL DEFAULT 0,
			resend_email_id TEXT,
			message TEXT,
			attachment_count INTEGER,
			recovery_after DATETIME,
			unread INTEGER NOT NULL DEFAULT 0,
			create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			is_del INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE attachments (
			att_id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			email_id INTEGER NOT NULL,
			account_id INTEGER NOT NULL,
			key TEXT NOT NULL,
			filename TEXT,
			mime_type TEXT,
			size INTEGER,
			status INTEGER NOT NULL DEFAULT 0,
			type INTEGER NOT NULL DEFAULT 0,
			content_id TEXT,
			message TEXT,
			create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE account (
			account_id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			email TEXT NOT NULL,
			is_del INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE user (
			user_id INTEGER PRIMARY KEY,
			email TEXT NOT NULL
		)`
	]) {
		await env.db.prepare(sql).run();
	}
}

async function insertStaleIncoming({ attachmentCount = 1, accountId = 10 } = {}) {
	const row = await env.db.prepare(`
		INSERT INTO email (
			account_id, user_id, to_email, type, status, attachment_count, is_del, create_time
		) VALUES (?, 7, 'inbox@example.com', ?, ?, ?, ?, datetime('now', '-20 minutes'))
		RETURNING email_id AS emailId
	`).bind(
		accountId,
		emailConst.type.RECEIVE,
		emailConst.status.SAVING,
		attachmentCount,
		isDel.DELETE
	).first();
	return row.emailId;
}

describe('incoming attachment recovery', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		r2Service.storageType.mockResolvedValue('R2');
		await resetSchema();
		await env.db.prepare(`
			INSERT INTO account (account_id, user_id, email) VALUES (10, 7, 'inbox@example.com')
		`).run();
		await env.db.prepare(`
			INSERT INTO user (user_id, email) VALUES (7, 'owner@example.com')
		`).run();
	});

	it('does not publish a stale email when its pending attachment object is missing', async () => {
		const emailId = await insertStaleIncoming();
		await env.db.prepare(`
			INSERT INTO attachments (
				user_id, email_id, account_id, key, filename, status, type
			) VALUES (7, ?, 10, 'attachments/missing.pdf', 'missing.pdf', ?, ?)
		`).bind(emailId, attConst.status.PENDING, attConst.type.ATT).run();
		r2Service.exists.mockResolvedValue(false);

		await emailService.completeReceiveAll({ env });

		const emailRow = await env.db.prepare(`
			SELECT status, is_del AS isDel, message FROM email WHERE email_id = ?
		`).bind(emailId).first();
		const attachmentRow = await env.db.prepare(`
			SELECT status, message FROM attachments WHERE email_id = ?
		`).bind(emailId).first();

		expect(emailRow).toEqual(expect.objectContaining({
			status: emailConst.status.FAILED,
			isDel: isDel.DELETE
		}));
		expect(attachmentRow).toEqual({
			status: attConst.status.FAILED,
			message: 'OBJECT_MISSING'
		});
		expect(r2Service.exists).toHaveBeenCalledWith(
			{ env },
			'attachments/missing.pdf',
			{ storageType: 'R2', maxAttempts: 1 }
		);
	});

	it('requires two missing checks before failing a KV-backed attachment', async () => {
		const emailId = await insertStaleIncoming();
		await env.db.prepare(`
			INSERT INTO attachments (
				user_id, email_id, account_id, key, filename, status, type
			) VALUES (7, ?, 10, 'attachments/kv-delayed.pdf', 'kv-delayed.pdf', ?, ?)
		`).bind(emailId, attConst.status.PENDING, attConst.type.ATT).run();
		r2Service.storageType.mockResolvedValue('KV');
		r2Service.exists.mockResolvedValue(false);

		await emailService.completeReceiveAll({ env });

		const firstEmailRow = await env.db.prepare(`
			SELECT status, is_del AS isDel FROM email WHERE email_id = ?
		`).bind(emailId).first();
		const firstAttachmentRow = await env.db.prepare(`
			SELECT status, message FROM attachments WHERE email_id = ?
		`).bind(emailId).first();
		expect(firstEmailRow).toEqual({
			status: emailConst.status.SAVING,
			isDel: isDel.DELETE
		});
		expect(firstAttachmentRow).toEqual({
			status: attConst.status.PENDING,
			message: 'OBJECT_MISSING_RECHECK'
		});

		await emailService.completeReceiveAll({ env });

		const secondEmailRow = await env.db.prepare(`
			SELECT status, is_del AS isDel FROM email WHERE email_id = ?
		`).bind(emailId).first();
		const secondAttachmentRow = await env.db.prepare(`
			SELECT status, message FROM attachments WHERE email_id = ?
		`).bind(emailId).first();
		expect(secondEmailRow).toEqual({
			status: emailConst.status.FAILED,
			isDel: isDel.DELETE
		});
		expect(secondAttachmentRow).toEqual({
			status: attConst.status.FAILED,
			message: 'OBJECT_MISSING'
		});
	});

	it('does not complete a live incoming email until every expected attachment is ready', async () => {
		const emailId = await insertStaleIncoming();
		await env.db.prepare(`
			UPDATE email SET create_time = CURRENT_TIMESTAMP WHERE email_id = ?
		`).bind(emailId).run();
		await env.db.prepare(`
			INSERT INTO attachments (
				user_id, email_id, account_id, key, filename, status, type
			) VALUES (7, ?, 10, 'attachments/pending.pdf', 'pending.pdf', ?, ?)
		`).bind(emailId, attConst.status.PENDING, attConst.type.ATT).run();

		await expect(emailService.completeReceive(
			{ env },
			emailConst.status.RECEIVE,
			emailId
		)).rejects.toThrow('Incoming email attachments are not ready');

		const row = await env.db.prepare(`
			SELECT status, is_del AS isDel FROM email WHERE email_id = ?
		`).bind(emailId).first();
		expect(row).toEqual({
			status: emailConst.status.SAVING,
			isDel: isDel.DELETE
		});
	});

	it('recovers an uploaded pending attachment and completes the email idempotently', async () => {
		const emailId = await insertStaleIncoming();
		await env.db.prepare(`
			INSERT INTO attachments (
				user_id, email_id, account_id, key, filename, status, type
			) VALUES (7, ?, 10, 'attachments/uploaded.pdf', 'uploaded.pdf', ?, ?)
		`).bind(emailId, attConst.status.PENDING, attConst.type.ATT).run();
		r2Service.exists.mockResolvedValue(true);

		await emailService.completeReceiveAll({ env });
		await emailService.completeReceiveAll({ env });

		const emailRow = await env.db.prepare(`
			SELECT status, is_del AS isDel FROM email WHERE email_id = ?
		`).bind(emailId).first();
		const attachmentRow = await env.db.prepare(`
			SELECT status, message FROM attachments WHERE email_id = ?
		`).bind(emailId).first();
		expect(emailRow).toEqual({
			status: emailConst.status.RECEIVE,
			isDel: isDel.NORMAL
		});
		expect(attachmentRow).toEqual({
			status: attConst.status.READY,
			message: null
		});
		expect(r2Service.exists).toHaveBeenCalledTimes(1);
	});

	it('uses single-attempt object probes during S3 recovery', async () => {
		const emailId = await insertStaleIncoming();
		await env.db.prepare(`
			INSERT INTO attachments (
				user_id, email_id, account_id, key, filename, status, type
			) VALUES (7, ?, 10, 'attachments/s3-probe.pdf', 's3-probe.pdf', ?, ?)
		`).bind(emailId, attConst.status.PENDING, attConst.type.ATT).run();
		r2Service.storageType.mockResolvedValue('S3');
		r2Service.exists.mockResolvedValue(true);

		await emailService.completeReceiveAll({ env });

		expect(r2Service.exists).toHaveBeenCalledWith(
			{ env },
			'attachments/s3-probe.pdf',
			{ storageType: 'S3', maxAttempts: 1 }
		);
	});

	it('completes a stale no-attachment email without touching object storage', async () => {
		const emailId = await insertStaleIncoming({ attachmentCount: 0 });

		await emailService.completeReceiveAll({ env });

		const row = await env.db.prepare(`
			SELECT status, is_del AS isDel FROM email WHERE email_id = ?
		`).bind(emailId).first();
		expect(row).toEqual({
			status: emailConst.status.RECEIVE,
			isDel: isDel.NORMAL
		});
		expect(r2Service.exists).not.toHaveBeenCalled();
	});

	it('processes at most four stale emails per recovery invocation', async () => {
		const emailIds = [];
		for (let index = 0; index < 5; index += 1) {
			emailIds.push(await insertStaleIncoming({ attachmentCount: 0 }));
		}

		await emailService.completeReceiveAll({ env });

		const rows = await env.db.prepare(`
			SELECT email_id AS emailId, status, is_del AS isDel
			FROM email
			ORDER BY email_id
		`).all();
		expect(rows.results.slice(0, 4)).toEqual(emailIds.slice(0, 4).map(emailId => ({
			emailId,
			status: emailConst.status.RECEIVE,
			isDel: isDel.NORMAL
		})));
		expect(rows.results[4]).toEqual({
			emailId: emailIds[4],
			status: emailConst.status.SAVING,
			isDel: isDel.DELETE
		});
	});

	it('defers transiently failing candidates so later emails are not starved', async () => {
		const blockedEmailIds = [];
		for (let index = 0; index < 4; index += 1) {
			const emailId = await insertStaleIncoming();
			blockedEmailIds.push(emailId);
			await env.db.prepare(`
				INSERT INTO attachments (
					user_id, email_id, account_id, key, filename, status, type
				) VALUES (7, ?, 10, ?, ?, ?, ?)
			`).bind(
				emailId,
				`attachments/blocked-${index}.pdf`,
				`blocked-${index}.pdf`,
				attConst.status.PENDING,
				attConst.type.ATT
			).run();
		}
		const laterEmailId = await insertStaleIncoming({ attachmentCount: 0 });
		r2Service.exists.mockRejectedValue(new Error('temporary storage outage'));

		await emailService.completeReceiveAll({ env });
		await emailService.completeReceiveAll({ env });

		const blockedRows = await env.db.prepare(`
			SELECT email_id AS emailId, status, recovery_after AS recoveryAfter
			FROM email
			WHERE email_id IN (?, ?, ?, ?)
			ORDER BY email_id
		`).bind(...blockedEmailIds).all();
		const laterRow = await env.db.prepare(`
			SELECT status, is_del AS isDel FROM email WHERE email_id = ?
		`).bind(laterEmailId).first();
		expect(blockedRows.results.every(row => (
			row.status === emailConst.status.SAVING && row.recoveryAfter
		))).toBe(true);
		expect(laterRow).toEqual({
			status: emailConst.status.RECEIVE,
			isDel: isDel.NORMAL
		});
	});

	it('treats completion by another recovery runner as an idempotent success', async () => {
		const emailId = await insertStaleIncoming({ attachmentCount: 0 });

		await emailService.completeReceive(
			{ env },
			emailConst.status.RECEIVE,
			emailId
		);

		await expect(emailService.completeReceive(
			{ env },
			emailConst.status.RECEIVE,
			emailId
		)).resolves.toBeDefined();

		const row = await env.db.prepare(`
			SELECT status, is_del AS isDel FROM email WHERE email_id = ?
		`).bind(emailId).first();
		expect(row).toEqual({
			status: emailConst.status.RECEIVE,
			isDel: isDel.NORMAL
		});
	});

	it('does not let a stale recovery runner fail an email that already completed', async () => {
		const emailId = await insertStaleIncoming({ attachmentCount: 0 });
		await emailService.completeReceive(
			{ env },
			emailConst.status.RECEIVE,
			emailId
		);

		await emailService.failReceive(
			{ env },
			emailId,
			'ATTACHMENT_RECOVERY_FAILED'
		);

		const row = await env.db.prepare(`
			SELECT status, is_del AS isDel, message FROM email WHERE email_id = ?
		`).bind(emailId).first();
		expect(row).toEqual({
			status: emailConst.status.RECEIVE,
			isDel: isDel.NORMAL,
			message: null
		});
	});

	it('continues the recovery batch when another runner changes one candidate first', async () => {
		const racedEmailId = await insertStaleIncoming();
		const laterEmailId = await insertStaleIncoming({ attachmentCount: 0 });
		await env.db.prepare(`
			INSERT INTO attachments (
				user_id, email_id, account_id, key, filename, status, type
			) VALUES (7, ?, 10, 'attachments/raced.pdf', 'raced.pdf', ?, ?)
		`).bind(racedEmailId, attConst.status.PENDING, attConst.type.ATT).run();
		r2Service.exists.mockImplementation(async () => {
			await env.db.prepare(`
				UPDATE email SET status = ? WHERE email_id = ?
			`).bind(emailConst.status.FAILED, racedEmailId).run();
			return true;
		});

		await expect(emailService.completeReceiveAll({ env })).resolves.toBeUndefined();

		const rows = await env.db.prepare(`
			SELECT email_id AS emailId, status, is_del AS isDel
			FROM email
			WHERE email_id IN (?, ?)
			ORDER BY email_id
		`).bind(racedEmailId, laterEmailId).all();
		expect(rows.results).toEqual([
			{
				emailId: racedEmailId,
				status: emailConst.status.FAILED,
				isDel: isDel.DELETE
			},
			{
				emailId: laterEmailId,
				status: emailConst.status.RECEIVE,
				isDel: isDel.NORMAL
			}
		]);
	});

	it('keeps the email saving when object storage is temporarily unavailable', async () => {
		const emailId = await insertStaleIncoming();
		await env.db.prepare(`
			INSERT INTO attachments (
				user_id, email_id, account_id, key, status, type
			) VALUES (7, ?, 10, 'attachments/unknown.pdf', ?, ?)
		`).bind(emailId, attConst.status.PENDING, attConst.type.ATT).run();
		r2Service.exists.mockRejectedValue(new Error('temporary storage outage'));

		await emailService.completeReceiveAll({ env });

		const row = await env.db.prepare(`
			SELECT status, is_del AS isDel FROM email WHERE email_id = ?
		`).bind(emailId).first();
		expect(row).toEqual({
			status: emailConst.status.SAVING,
			isDel: isDel.DELETE
		});
	});

	it('fails legacy stale rows when attachment recovery metadata is absent', async () => {
		const emailId = await insertStaleIncoming({ attachmentCount: null });

		await emailService.completeReceiveAll({ env });

		const row = await env.db.prepare(`
			SELECT status, is_del AS isDel, message FROM email WHERE email_id = ?
		`).bind(emailId).first();
		expect(row).toEqual({
			status: emailConst.status.FAILED,
			isDel: isDel.DELETE,
			message: 'ATTACHMENT_METADATA_MISSING'
		});
	});

	it('checks historical ready rows and fails them when their object is missing', async () => {
		const emailId = await insertStaleIncoming();
		await env.db.prepare(`
			INSERT INTO attachments (
				user_id, email_id, account_id, key, status, type
			) VALUES (7, ?, 10, 'attachments/legacy-ready.pdf', ?, ?)
		`).bind(emailId, attConst.status.READY, attConst.type.ATT).run();
		r2Service.exists.mockResolvedValue(false);

		await emailService.completeReceiveAll({ env });

		const emailRow = await env.db.prepare(`
			SELECT status, is_del AS isDel FROM email WHERE email_id = ?
		`).bind(emailId).first();
		const attachmentRow = await env.db.prepare(`
			SELECT status, message FROM attachments WHERE email_id = ?
		`).bind(emailId).first();
		expect(emailRow).toEqual({
			status: emailConst.status.FAILED,
			isDel: isDel.DELETE
		});
		expect(attachmentRow).toEqual({
			status: attConst.status.FAILED,
			message: 'OBJECT_MISSING'
		});
	});

	it('fails a stale incoming email with an invalid attachment state instead of retrying forever', async () => {
		const emailId = await insertStaleIncoming();
		await env.db.prepare(`
			INSERT INTO attachments (
				user_id, email_id, account_id, key, status, type
			) VALUES (7, ?, 10, 'attachments/unused.pdf', ?, ?)
		`).bind(emailId, attConst.status.UNUSED, attConst.type.ATT).run();

		await emailService.completeReceiveAll({ env });

		const row = await env.db.prepare(`
			SELECT status, is_del AS isDel, message FROM email WHERE email_id = ?
		`).bind(emailId).first();
		expect(row).toEqual({
			status: emailConst.status.FAILED,
			isDel: isDel.DELETE,
			message: 'ATTACHMENT_STATE_INVALID'
		});
		expect(r2Service.exists).not.toHaveBeenCalled();
	});

	it('fails recovery before object checks when an email exceeds the attachment budget', async () => {
		const emailId = await insertStaleIncoming({ attachmentCount: 11 });
		await env.db.prepare(`
			WITH RECURSIVE seq(value) AS (
				SELECT 1
				UNION ALL
				SELECT value + 1 FROM seq WHERE value < 11
			)
			INSERT INTO attachments (
				user_id, email_id, account_id, key, filename, status, type
			)
			SELECT
				7,
				?,
				10,
				'attachments/overflow-' || value || '.pdf',
				'overflow-' || value || '.pdf',
				?,
				?
			FROM seq
		`).bind(emailId, attConst.status.PENDING, attConst.type.ATT).run();

		await emailService.completeReceiveAll({ env });

		const row = await env.db.prepare(`
			SELECT status, is_del AS isDel, message FROM email WHERE email_id = ?
		`).bind(emailId).first();
		expect(row).toEqual({
			status: emailConst.status.FAILED,
			isDel: isDel.DELETE,
			message: 'ATTACHMENT_RECOVERY_LIMIT_EXCEEDED'
		});
		expect(r2Service.exists).not.toHaveBeenCalled();
	});

	it('lists only ready normal attachments while preserving historical status zero rows', async () => {
		const emailId = await insertStaleIncoming({ attachmentCount: 2 });
		await env.db.batch([
			env.db.prepare(`
				INSERT INTO attachments (
					user_id, email_id, account_id, key, filename, status, type
				) VALUES (7, ?, 10, 'attachments/ready.pdf', 'ready.pdf', ?, ?)
			`).bind(emailId, 0, attConst.type.ATT),
			env.db.prepare(`
				INSERT INTO attachments (
					user_id, email_id, account_id, key, filename, status, type
				) VALUES (7, ?, 10, 'attachments/pending.pdf', 'pending.pdf', ?, ?)
			`).bind(emailId, attConst.status.PENDING, attConst.type.ATT)
		]);
		await env.db.prepare(`
			UPDATE email SET status = ?, is_del = ? WHERE email_id = ?
		`).bind(emailConst.status.RECEIVE, isDel.NORMAL, emailId).run();

		const rows = await attService.selectByEmailIds({ env }, [emailId]);

		expect(rows.map(row => row.filename)).toEqual(['ready.pdf']);
		expect(rows[0].status).toBe(attConst.status.READY);
	});

	it('does not list a ready attachment while its parent email is still saving', async () => {
		const emailId = await insertStaleIncoming();
		await env.db.prepare(`
			UPDATE email SET create_time = CURRENT_TIMESTAMP WHERE email_id = ?
		`).bind(emailId).run();
		await env.db.prepare(`
			INSERT INTO attachments (
				user_id, email_id, account_id, key, filename, status, type
			) VALUES (7, ?, 10, 'attachments/partial.pdf', 'partial.pdf', ?, ?)
		`).bind(emailId, attConst.status.READY, attConst.type.ATT).run();

		const rows = await attService.list({ env }, { emailId }, 7);
		const internalRows = await attService.selectByEmailIds(
			{ env },
			[emailId],
			{ allowParentSaving: true }
		);

		expect(rows).toEqual([]);
		expect(internalRows.map(row => row.filename)).toEqual(['partial.pdf']);
	});

	it('adds incoming recovery columns idempotently', async () => {
		await env.db.prepare('DROP TABLE attachments').run();
		await env.db.prepare('DROP TABLE email').run();
		await env.db.prepare(`
			CREATE TABLE email (
				email_id INTEGER PRIMARY KEY,
				type INTEGER NOT NULL DEFAULT 0,
				status INTEGER NOT NULL DEFAULT 0,
				create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`).run();
		await env.db.prepare(`
			CREATE TABLE attachments (
				att_id INTEGER PRIMARY KEY,
				email_id INTEGER NOT NULL,
				status INTEGER NOT NULL DEFAULT 0,
				key TEXT NOT NULL
			)
		`).run();

		await dbInit.v3_5DB({ env });
		await dbInit.v3_5DB({ env });

		const emailColumns = await env.db.prepare('PRAGMA table_info(email)').all();
		const attachmentColumns = await env.db.prepare('PRAGMA table_info(attachments)').all();
		const indexes = await env.db.prepare(`
			SELECT name FROM sqlite_master WHERE type = 'index'
		`).all();
		expect(emailColumns.results.map(row => row.name)).toContain('attachment_count');
		expect(emailColumns.results.map(row => row.name)).toContain('recovery_after');
		expect(attachmentColumns.results.map(row => row.name)).toContain('message');
		expect(indexes.results.map(row => row.name)).toContain('idx_email_receive_recovery_due');
	});
});
