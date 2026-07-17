import emailService from './email-service';
import { emailConst } from '../const/entity-const';
import BizError from '../error/biz-error';
import secretUtils from '../utils/secret-utils';

const encoder = new TextEncoder();

const WEBHOOK_EVENT_STATUS = Object.freeze({
	PROCESSING: 'PROCESSING',
	RETRY: 'RETRY',
	PROCESSED: 'PROCESSED'
});

const STATUS_EVENT_TRANSITIONS = Object.freeze({
	'email.sent': Object.freeze({
		status: emailConst.status.SENT,
		allowedStatuses: Object.freeze([emailConst.status.SAVING]),
		message: null
	}),
	'email.delivery_delayed': Object.freeze({
		status: emailConst.status.DELAYED,
		allowedStatuses: Object.freeze([
			emailConst.status.SAVING,
			emailConst.status.SENT
		]),
		message: null
	}),
	'email.delivered': Object.freeze({
		status: emailConst.status.DELIVERED,
		allowedStatuses: Object.freeze([
			emailConst.status.SAVING,
			emailConst.status.SENT,
			emailConst.status.DELAYED
		]),
		message: null
	}),
	'email.bounced': Object.freeze({
		status: emailConst.status.BOUNCED,
		allowedStatuses: Object.freeze([
			emailConst.status.SAVING,
			emailConst.status.SENT,
			emailConst.status.DELAYED
		]),
		message: 'RESEND_BOUNCED'
	}),
	'email.complained': Object.freeze({
		status: emailConst.status.COMPLAINED,
		allowedStatuses: Object.freeze([
			emailConst.status.SAVING,
			emailConst.status.SENT,
			emailConst.status.DELAYED,
			emailConst.status.DELIVERED
		]),
		message: null
	}),
	'email.failed': Object.freeze({
		status: emailConst.status.FAILED,
		allowedStatuses: Object.freeze([
			emailConst.status.SAVING,
			emailConst.status.SENT,
			emailConst.status.DELAYED
		]),
		message: 'RESEND_DELIVERY_FAILED'
	})
});

function isTrueFlag(value) {
	if (value === true) {
		return true;
	}
	return ['true', '1', 'yes'].includes(String(value || '').toLowerCase());
}

const resendService = {
	async webhooks(c, rawBody) {
		await this.verifyWebhook(c, rawBody);
		const event = this.parseWebhookBody(rawBody);
		const identity = await this.createEventIdentity(c, rawBody);
		const claim = await this.claimEvent(c, {
			...identity,
			eventType: event.type,
			providerEmailId: event.providerEmailId
		});
		if (claim.duplicate) {
			return { duplicate: true, updated: false };
		}

		try {
			if (!event.transition) {
				await this.finishEvent(c, identity.eventKey, identity.bodySha256, 'NOOP_EVENT');
				return { duplicate: false, updated: false };
			}

			const emailRow = await emailService.transitionExternalEmailStatus(c, {
				resendEmailId: event.providerEmailId,
				status: event.transition.status,
				allowedStatuses: [...event.transition.allowedStatuses],
				message: event.transition.message
			});
			const updated = !!emailRow;
			await this.finishEvent(
				c,
				identity.eventKey,
				identity.bodySha256,
				updated ? 'UPDATED' : 'NO_CHANGE'
			);
			return { duplicate: false, updated };
		} catch (error) {
			try {
				await this.markEventRetry(c, identity.eventKey, identity.bodySha256);
			} catch {
				// A stale PROCESSING row can be acquired after the recovery threshold.
			}
			throw error;
		}
	},

	parseWebhookBody(rawBody) {
		let body;
		try {
			body = JSON.parse(rawBody);
		} catch {
			throw new BizError('Invalid webhook JSON', 400);
		}
		if (!body || typeof body !== 'object' || Array.isArray(body)) {
			throw new BizError('Invalid webhook payload', 400);
		}
		const type = typeof body.type === 'string' ? body.type.trim() : '';
		if (!type || type.length > 100) {
			throw new BizError('Invalid webhook event type', 400);
		}
		if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
			throw new BizError('Invalid webhook data', 400);
		}

		let providerEmailId = body.data.email_id;
		if (providerEmailId !== undefined && providerEmailId !== null) {
			providerEmailId = typeof providerEmailId === 'string'
				? providerEmailId.trim()
				: '';
			if (!providerEmailId || providerEmailId.length > 256) {
				throw new BizError('Invalid webhook email id', 400);
			}
		} else {
			providerEmailId = null;
		}

		const transition = STATUS_EVENT_TRANSITIONS[type] || null;
		if (transition && !providerEmailId) {
			throw new BizError('Missing webhook email id', 400);
		}
		return { type, providerEmailId, transition };
	},

	async createEventIdentity(c, rawBody) {
		const bodySha256 = await this.sha256Hex(rawBody);
		if (c.env.resend_webhook_secret) {
			const svixId = c.req.header('svix-id');
			if (typeof svixId !== 'string' || svixId.length === 0 || svixId.length > 200) {
				throw new BizError('Invalid webhook event id', 400);
			}
			return {
				eventKey: `svix:${svixId}`,
				svixId,
				bodySha256
			};
		}
		return {
			eventKey: `body:${bodySha256}`,
			svixId: null,
			bodySha256
		};
	},

	async claimEvent(c, event) {
		const inserted = await c.env.db.prepare(`
			INSERT INTO resend_webhook_event (
				event_key,
				svix_id,
				body_sha256,
				event_type,
				provider_email_id,
				status,
				received_at
			) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(event_key) DO NOTHING
			RETURNING event_key AS eventKey
		`).bind(
			event.eventKey,
			event.svixId,
			event.bodySha256,
			event.eventType,
			event.providerEmailId,
			WEBHOOK_EVENT_STATUS.PROCESSING
		).first();
		if (inserted) {
			return { duplicate: false };
		}

		const existing = await c.env.db.prepare(`
			SELECT body_sha256 AS bodySha256, status
			FROM resend_webhook_event
			WHERE event_key = ?
		`).bind(event.eventKey).first();
		if (!existing) {
			throw new BizError('Unable to claim webhook event', 503);
		}
		if (existing.bodySha256 !== event.bodySha256
			|| existing.status === WEBHOOK_EVENT_STATUS.PROCESSED) {
			return { duplicate: true };
		}
		if (existing.status === WEBHOOK_EVENT_STATUS.RETRY) {
			const acquired = await c.env.db.prepare(`
				UPDATE resend_webhook_event
				SET status = ?, received_at = CURRENT_TIMESTAMP
				WHERE event_key = ? AND body_sha256 = ? AND status = ?
				RETURNING event_key AS eventKey
			`).bind(
				WEBHOOK_EVENT_STATUS.PROCESSING,
				event.eventKey,
				event.bodySha256,
				WEBHOOK_EVENT_STATUS.RETRY
			).first();
			if (acquired) {
				return { duplicate: false };
			}
			throw new BizError('Webhook event is still processing', 503);
		}
		if (existing.status === WEBHOOK_EVENT_STATUS.PROCESSING) {
			const acquired = await c.env.db.prepare(`
				UPDATE resend_webhook_event
				SET received_at = CURRENT_TIMESTAMP
				WHERE event_key = ?
				  AND body_sha256 = ?
				  AND status = ?
				  AND received_at <= datetime('now', '-1 minute')
				RETURNING event_key AS eventKey
			`).bind(
				event.eventKey,
				event.bodySha256,
				WEBHOOK_EVENT_STATUS.PROCESSING
			).first();
			if (acquired) {
				return { duplicate: false };
			}
			throw new BizError('Webhook event is still processing', 503);
		}
		return { duplicate: true };
	},

	async markEventRetry(c, eventKey, bodySha256) {
		await c.env.db.prepare(`
			UPDATE resend_webhook_event
			SET status = ?, outcome = ?, received_at = CURRENT_TIMESTAMP
			WHERE event_key = ? AND body_sha256 = ? AND status = ?
		`).bind(
			WEBHOOK_EVENT_STATUS.RETRY,
			'RETRY_PENDING',
			eventKey,
			bodySha256,
			WEBHOOK_EVENT_STATUS.PROCESSING
		).run();
	},

	async finishEvent(c, eventKey, bodySha256, outcome) {
		const finished = await c.env.db.prepare(`
			UPDATE resend_webhook_event
			SET status = ?,
				outcome = CASE
					WHEN outcome = 'UPDATED' OR ? = 'UPDATED' THEN 'UPDATED'
					ELSE ?
				END,
				processed_at = COALESCE(processed_at, CURRENT_TIMESTAMP)
			WHERE event_key = ?
			  AND body_sha256 = ?
			  AND status IN (?, ?)
			RETURNING event_key AS eventKey
		`).bind(
			WEBHOOK_EVENT_STATUS.PROCESSED,
			outcome,
			outcome,
			eventKey,
			bodySha256,
			WEBHOOK_EVENT_STATUS.PROCESSING,
			WEBHOOK_EVENT_STATUS.PROCESSED
		).first();
		if (finished) {
			return;
		}
		const existing = await c.env.db.prepare(`
			SELECT body_sha256 AS bodySha256, status
			FROM resend_webhook_event
			WHERE event_key = ?
		`).bind(eventKey).first();
		if (existing?.bodySha256 === bodySha256
			&& existing.status === WEBHOOK_EVENT_STATUS.PROCESSED) {
			return;
		}
		throw new BizError('Unable to finalize webhook event', 503);
	},

	async sha256Hex(value) {
		const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
		return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
	},

	async verifyWebhook(c, rawBody) {
		const secret = c.env.resend_webhook_secret;
		if (!secret) {
			if (isTrueFlag(c.env.resend_webhook_allow_unsigned)) {
				console.warn('resend_webhook_secret is not configured; unsigned Resend webhooks are allowed by explicit compatibility flag.');
				return;
			}
			throw new BizError('Resend webhook secret is not configured', 401);
		}

		const id = c.req.header('svix-id');
		const timestamp = c.req.header('svix-timestamp');
		const signature = c.req.header('svix-signature');

		if (!id || !timestamp || !signature) {
			throw new BizError('Missing webhook signature headers', 401);
		}

		const now = Math.floor(Date.now() / 1000);
		const ts = Number(timestamp);
		if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) {
			throw new BizError('Webhook timestamp is outside the allowed tolerance', 401);
		}

		const payload = `${id}.${timestamp}.${rawBody}`;
		let secretBytes;
		try {
			secretBytes = this.decodeSvixSecret(secret);
		} catch {
			throw new BizError('Invalid webhook secret', 401);
		}

		const key = await crypto.subtle.importKey(
			'raw',
			secretBytes,
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);
		const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
		const expectedSignatures = this.parseSignatureHeader(signature);

		for (const item of expectedSignatures) {
			const [version, value] = item;
			if (version !== 'v1' || !value) {
				continue;
			}

			let actual;
			try {
				actual = this.decodeBase64(value);
			} catch {
				throw new BizError('Invalid webhook signature', 401);
			}

			if (secretUtils.timingSafeBytesEqual(digest, actual)) {
				return;
			}
		}

		throw new BizError('Invalid webhook signature', 401);
	},

	parseSignatureHeader(signature) {
		return signature.split(' ')
			.map(part => {
				const commaIndex = part.indexOf(',');
				if (commaIndex > -1) {
					return [part.slice(0, commaIndex), part.slice(commaIndex + 1)];
				}

				const equalIndex = part.indexOf('=');
				if (equalIndex > -1) {
					return [part.slice(0, equalIndex), part.slice(equalIndex + 1)];
				}

				return [];
			})
			.filter(([version, value]) => version && value);
	},

	decodeSvixSecret(secret) {
		const value = secret.startsWith('whsec_') ? secret.slice(6) : secret;
		return this.decodeBase64(value);
	},

	decodeBase64(value) {
		return Uint8Array.from(atob(value), c => c.charCodeAt(0));
	}
};

export default resendService;
