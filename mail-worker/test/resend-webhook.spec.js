import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { emailConst } from '../src/const/entity-const';
import { dbInit } from '../src/init/init';

vi.mock('../src/service/email-service', () => ({
	default: {
		transitionExternalEmailStatus: vi.fn(async () => ({ emailId: 1 }))
	}
}));

const { default: emailService } = await import('../src/service/email-service');
const { default: resendService } = await import('../src/service/resend-service');
const encoder = new TextEncoder();

async function resetWebhookSchema() {
	await env.db.prepare('DROP TABLE IF EXISTS resend_webhook_event').run();
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

async function signedContext(rawBody, id = 'evt_resend_1') {
	const secretBytes = new Uint8Array(32).fill(7);
	const secret = `whsec_${btoa(String.fromCharCode(...secretBytes))}`;
	const timestamp = String(Math.floor(Date.now() / 1000));
	const key = await crypto.subtle.importKey(
		'raw',
		secretBytes,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signatureBytes = new Uint8Array(await crypto.subtle.sign(
		'HMAC',
		key,
		encoder.encode(`${id}.${timestamp}.${rawBody}`)
	));
	const headers = {
		'svix-id': id,
		'svix-timestamp': timestamp,
		'svix-signature': `v1,${btoa(String.fromCharCode(...signatureBytes))}`
	};
	return {
		env: {
			db: env.db,
			resend_webhook_secret: secret
		},
		req: {
			header(name) {
				return headers[name];
			}
		}
	};
}

describe('Resend webhook processing', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		await resetWebhookSchema();
	});

	it('deduplicates a delivered event and records it as processed', async () => {
		const rawBody = JSON.stringify({
			type: 'email.delivered',
			data: { email_id: 'resend-message-1' }
		});
		const c = unsignedContext();

		await resendService.webhooks(c, rawBody);
		await resendService.webhooks(c, rawBody);

		expect(emailService.transitionExternalEmailStatus).toHaveBeenCalledOnce();
		expect(emailService.transitionExternalEmailStatus.mock.calls[0][0]).toBe(c);
		expect(emailService.transitionExternalEmailStatus.mock.calls[0][1]).toEqual({
			resendEmailId: 'resend-message-1',
			status: emailConst.status.DELIVERED,
			allowedStatuses: [
				emailConst.status.SAVING,
				emailConst.status.SENT,
				emailConst.status.DELAYED
			],
			message: null
		});
		const events = await env.db.prepare(`
			SELECT event_type AS eventType, status, outcome
			FROM resend_webhook_event
		`).all();
		expect(events.results).toEqual([{
			eventType: 'email.delivered',
			status: 'PROCESSED',
			outcome: 'UPDATED'
		}]);
	});

	it('deduplicates signed events by svix-id', async () => {
		const rawBody = JSON.stringify({
			type: 'email.delivered',
			data: { email_id: 'resend-message-signed' }
		});
		const c = await signedContext(rawBody);

		await resendService.webhooks(c, rawBody);
		await resendService.webhooks(c, rawBody);

		expect(emailService.transitionExternalEmailStatus).toHaveBeenCalledOnce();
		const event = await env.db.prepare(`
			SELECT svix_id AS svixId, status FROM resend_webhook_event
		`).first();
		expect(event).toEqual({
			svixId: 'evt_resend_1',
			status: 'PROCESSED'
		});
	});

	it('acknowledges open, click, and unknown events without changing email state', async () => {
		const c = unsignedContext();
		for (const type of ['email.opened', 'email.clicked', 'email.future_event']) {
			await resendService.webhooks(c, JSON.stringify({
				type,
				data: { email_id: 'resend-message-noop' }
			}));
		}

		expect(emailService.transitionExternalEmailStatus).not.toHaveBeenCalled();
		const events = await env.db.prepare(`
			SELECT status, outcome FROM resend_webhook_event ORDER BY event_type
		`).all();
		expect(events.results).toHaveLength(3);
		expect(events.results).toEqual(expect.arrayContaining([
			{ status: 'PROCESSED', outcome: 'NOOP_EVENT' },
			{ status: 'PROCESSED', outcome: 'NOOP_EVENT' },
			{ status: 'PROCESSED', outcome: 'NOOP_EVENT' }
		]));
	});

	it('rejects malformed actionable payloads before recording an event', async () => {
		const c = unsignedContext();

		await expect(resendService.webhooks(c, '{')).rejects.toMatchObject({ code: 400 });
		await expect(resendService.webhooks(c, JSON.stringify({
			type: 'email.delivered',
			data: {}
		}))).rejects.toMatchObject({ code: 400 });

		const count = await env.db.prepare(`
			SELECT COUNT(*) AS total FROM resend_webhook_event
		`).first();
		expect(count.total).toBe(0);
	});

	it('resumes a PROCESSING event after a transient local update failure', async () => {
		const rawBody = JSON.stringify({
			type: 'email.delivered',
			data: { email_id: 'resend-message-retry' }
		});
		const c = unsignedContext();
		emailService.transitionExternalEmailStatus
			.mockRejectedValueOnce(new Error('temporary D1 failure'))
			.mockResolvedValueOnce({ emailId: 9 });

		await expect(resendService.webhooks(c, rawBody)).rejects.toThrow('temporary D1 failure');
		expect((await env.db.prepare(`
			SELECT status FROM resend_webhook_event
		`).first()).status).toBe('RETRY');

		await resendService.webhooks(c, rawBody);

		expect(emailService.transitionExternalEmailStatus).toHaveBeenCalledTimes(2);
		expect((await env.db.prepare(`
			SELECT status, outcome FROM resend_webhook_event
		`).first())).toEqual({
			status: 'PROCESSED',
			outcome: 'UPDATED'
		});
	});

	it('creates the webhook event schema idempotently', async () => {
		await env.db.prepare('DROP TABLE resend_webhook_event').run();

		await dbInit.v3_7DB({ env });
		await dbInit.v3_7DB({ env });

		const table = await env.db.prepare(`
			SELECT name FROM sqlite_master
			WHERE type = 'table' AND name = 'resend_webhook_event'
		`).first();
		const indexes = await env.db.prepare(`
			SELECT name FROM sqlite_master
			WHERE type = 'index' AND tbl_name = 'resend_webhook_event'
		`).all();
		expect(table?.name).toBe('resend_webhook_event');
		expect(indexes.results.map(row => row.name)).toEqual(expect.arrayContaining([
			'idx_resend_webhook_event_status_time',
			'idx_resend_webhook_event_provider_email'
		]));
	});

	it('repairs missing webhook event columns before creating indexes', async () => {
		await env.db.prepare('DROP TABLE resend_webhook_event').run();
		await env.db.prepare(`
			CREATE TABLE resend_webhook_event (
				event_key TEXT PRIMARY KEY
			)
		`).run();

		await dbInit.v3_7DB({ env });

		const columns = await env.db.prepare(`
			PRAGMA table_info(resend_webhook_event)
		`).all();
		expect(columns.results.map(row => row.name)).toEqual(expect.arrayContaining([
			'svix_id',
			'body_sha256',
			'event_type',
			'provider_email_id',
			'status',
			'outcome',
			'received_at',
			'processed_at'
		]));
	});

	it('preserves the strongest concurrent audit outcome', async () => {
		await env.db.prepare(`
			INSERT INTO resend_webhook_event (
				event_key, body_sha256, event_type, status, outcome, processed_at
			) VALUES ('body:audit', 'audit', 'email.delivered', 'PROCESSED', 'NO_CHANGE', CURRENT_TIMESTAMP)
		`).run();

		await resendService.finishEvent({ env }, 'body:audit', 'audit', 'UPDATED');

		expect((await env.db.prepare(`
			SELECT status, outcome FROM resend_webhook_event WHERE event_key = 'body:audit'
		`).first())).toEqual({
			status: 'PROCESSED',
			outcome: 'UPDATED'
		});
	});
});
