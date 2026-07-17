import BizError from '../error/biz-error';
import { emailConst } from '../const/entity-const';
import emailSearchService from './email-search-service';

export const deliveryAttemptConst = Object.freeze({
	provider: Object.freeze({
		CLOUDFLARE_EMAIL: 'CLOUDFLARE_EMAIL',
		RESEND: 'RESEND'
	}),
	status: Object.freeze({
		PREPARED: 'PREPARED',
		IN_FLIGHT: 'IN_FLIGHT',
		PENDING_ACK: 'PENDING_ACK',
		ACCEPTED: 'ACCEPTED',
		FAILED: 'FAILED',
		UNKNOWN: 'UNKNOWN'
	})
});

const VALID_PROVIDERS = new Set(Object.values(deliveryAttemptConst.provider));
const UNRESOLVED_STATUSES = new Set([
	deliveryAttemptConst.status.PREPARED,
	deliveryAttemptConst.status.IN_FLIGHT,
	deliveryAttemptConst.status.PENDING_ACK,
	deliveryAttemptConst.status.UNKNOWN
]);

function createAttemptKey(emailId) {
	return `cloud-mail/${emailId}/${crypto.randomUUID()}`;
}

async function transition(c, {
	attemptId,
	fromStatus,
	toStatus,
	providerMessageId = null,
	errorSummary = null
}) {
	const row = await c.env.db.prepare(`
		UPDATE delivery_attempt
		SET status = ?,
			provider_message_id = ?,
			error_summary = ?,
			update_time = CURRENT_TIMESTAMP
		WHERE attempt_id = ? AND status = ?
		RETURNING
			attempt_id AS attemptId,
			email_id AS emailId,
			provider,
			attempt_key AS attemptKey,
			status,
			provider_message_id AS providerMessageId,
			error_summary AS errorSummary,
			create_time AS createTime,
			update_time AS updateTime
	`).bind(
		toStatus,
		providerMessageId,
		errorSummary,
		attemptId,
		fromStatus
	).first();
	if (!row) {
		throw new BizError('Delivery attempt state conflict', 409);
	}
	return row;
}

const deliveryAttemptService = {
	async prepare(c, { emailId, provider, attemptKey }) {
		const normalizedEmailId = Number(emailId);
		if (!Number.isInteger(normalizedEmailId) || normalizedEmailId <= 0) {
			throw new BizError('Invalid delivery email id', 400);
		}
		if (!VALID_PROVIDERS.has(provider)) {
			throw new BizError('Invalid delivery provider', 400);
		}

		const stableKey = attemptKey || createAttemptKey(normalizedEmailId);
		if (typeof stableKey !== 'string' || stableKey.length === 0 || stableKey.length > 256) {
			throw new BizError('Invalid delivery attempt key', 400);
		}

		return await c.env.db.prepare(`
			INSERT INTO delivery_attempt (
				email_id,
				provider,
				attempt_key,
				status
			) VALUES (?, ?, ?, ?)
			RETURNING
				attempt_id AS attemptId,
				email_id AS emailId,
				provider,
				attempt_key AS attemptKey,
				status,
				provider_message_id AS providerMessageId,
				error_summary AS errorSummary,
				create_time AS createTime,
				update_time AS updateTime
		`).bind(
			normalizedEmailId,
			provider,
			stableKey,
			deliveryAttemptConst.status.PREPARED
		).first();
	},

	async markInFlight(c, attemptId) {
		return await transition(c, {
			attemptId,
			fromStatus: deliveryAttemptConst.status.PREPARED,
			toStatus: deliveryAttemptConst.status.IN_FLIGHT
		});
	},

	async markAccepted(c, attemptId, providerMessageId = null) {
		return await transition(c, {
			attemptId,
			fromStatus: deliveryAttemptConst.status.IN_FLIGHT,
			toStatus: deliveryAttemptConst.status.ACCEPTED,
			providerMessageId
		});
	},

	async markPendingAck(c, attemptId, providerMessageId = null) {
		return await transition(c, {
			attemptId,
			fromStatus: deliveryAttemptConst.status.IN_FLIGHT,
			toStatus: deliveryAttemptConst.status.PENDING_ACK,
			providerMessageId,
			errorSummary: 'ACCEPTED_STATE_WRITE_FAILED'
		});
	},

	async markUnknown(c, attemptId, errorSummary = 'PROVIDER_CALL_UNCERTAIN') {
		return await transition(c, {
			attemptId,
			fromStatus: deliveryAttemptConst.status.IN_FLIGHT,
			toStatus: deliveryAttemptConst.status.UNKNOWN,
			errorSummary
		});
	},

	async markFailed(c, attemptId, errorSummary = 'PROVIDER_REJECTED') {
		return await transition(c, {
			attemptId,
			fromStatus: deliveryAttemptConst.status.IN_FLIGHT,
			toStatus: deliveryAttemptConst.status.FAILED,
			errorSummary
		});
	},

	async health(c) {
		const { results = [] } = await c.env.db.prepare(`
			SELECT status, COUNT(*) AS total
			FROM delivery_attempt
			GROUP BY status
		`).all();
		const counts = Object.fromEntries(
			Object.values(deliveryAttemptConst.status).map(status => [status, 0])
		);
		let total = 0;
		let unresolved = 0;
		for (const row of results) {
			const count = Number(row.total || 0);
			counts[row.status] = count;
			total += count;
			if (UNRESOLVED_STATUSES.has(row.status)) {
				unresolved += count;
			}
		}
		return { total, unresolved, counts };
	},

	async reconcile(c, { limit = 50, staleMinutes = 10 } = {}) {
		const batchLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
		const staleAge = Math.max(1, Math.min(Number(staleMinutes) || 10, 24 * 60));
		const { results: staleAttempts = [] } = await c.env.db.prepare(`
			SELECT attempt_id AS attemptId, email_id AS emailId, status
			FROM delivery_attempt
			WHERE status IN (?, ?)
			  AND update_time <= datetime('now', ?)
			ORDER BY attempt_id
			LIMIT ${batchLimit}
		`).bind(
			deliveryAttemptConst.status.PREPARED,
			deliveryAttemptConst.status.IN_FLIGHT,
			`-${staleAge} minutes`
		).all();

		let unknown = 0;
		let failed = 0;
		for (const attempt of staleAttempts) {
			if (attempt.status === deliveryAttemptConst.status.PREPARED) {
				const result = await c.env.db.prepare(`
					UPDATE delivery_attempt
					SET status = ?, error_summary = ?, update_time = CURRENT_TIMESTAMP
					WHERE attempt_id = ? AND status = ?
				`).bind(
					deliveryAttemptConst.status.FAILED,
					'ATTEMPT_NOT_STARTED',
					attempt.attemptId,
					deliveryAttemptConst.status.PREPARED
				).run();
				if (Number(result?.meta?.changes || 0) !== 1) {
					continue;
				}
				failed += 1;
				await c.env.db.prepare(`
					UPDATE email
					SET status = ?, message = ?
					WHERE email_id = ? AND type = ? AND status = ?
				`).bind(
					emailConst.status.FAILED,
					'DELIVERY_ATTEMPT_NOT_STARTED',
					attempt.emailId,
					emailConst.type.SEND,
					emailConst.status.SAVING
				).run();
				continue;
			}
			if (attempt.status !== deliveryAttemptConst.status.IN_FLIGHT) {
				continue;
			}
			const result = await c.env.db.prepare(`
				UPDATE delivery_attempt
				SET status = ?, error_summary = ?, update_time = CURRENT_TIMESTAMP
				WHERE attempt_id = ? AND status = ?
			`).bind(
				deliveryAttemptConst.status.UNKNOWN,
				'PROVIDER_OUTCOME_UNKNOWN',
				attempt.attemptId,
				deliveryAttemptConst.status.IN_FLIGHT
			).run();
			if (Number(result?.meta?.changes || 0) !== 1) {
				continue;
			}
			unknown += 1;
			await c.env.db.prepare(`
				UPDATE email
				SET message = ?
				WHERE email_id = ? AND type = ? AND status = ?
			`).bind(
				'DELIVERY_OUTCOME_UNKNOWN',
				attempt.emailId,
				emailConst.type.SEND,
				emailConst.status.SAVING
			).run();
		}

		const { results: attempts = [] } = await c.env.db.prepare(`
			SELECT
				da.attempt_id AS attemptId,
				da.email_id AS emailId,
				da.provider,
				da.status,
				da.provider_message_id AS providerMessageId,
				e.status AS emailStatus
			FROM delivery_attempt da
			JOIN email e ON e.email_id = da.email_id
			WHERE e.type = ?
			  AND (
				da.status = ?
				OR (da.status IN (?, ?) AND e.status = ?)
			  )
			ORDER BY da.attempt_id
			LIMIT ${batchLimit}
		`).bind(
			emailConst.type.SEND,
			deliveryAttemptConst.status.PENDING_ACK,
			deliveryAttemptConst.status.ACCEPTED,
			deliveryAttemptConst.status.FAILED,
			emailConst.status.SAVING
		).all();

		let repaired = 0;
		for (const attempt of attempts) {
			if (attempt.status === deliveryAttemptConst.status.FAILED) {
				const emailResult = await c.env.db.prepare(`
					UPDATE email
					SET status = ?, message = ?
					WHERE email_id = ? AND type = ? AND status = ?
				`).bind(
					emailConst.status.FAILED,
					'DELIVERY_PROVIDER_REJECTED',
					attempt.emailId,
					emailConst.type.SEND,
					emailConst.status.SAVING
				).run();
				if (Number(emailResult?.meta?.changes || 0) === 1) {
					repaired += 1;
				}
				continue;
			}
			let changed = false;
			if (attempt.status === deliveryAttemptConst.status.PENDING_ACK) {
				const transitionResult = await c.env.db.prepare(`
					UPDATE delivery_attempt
					SET status = ?, error_summary = NULL, update_time = CURRENT_TIMESTAMP
					WHERE attempt_id = ? AND status = ?
				`).bind(
					deliveryAttemptConst.status.ACCEPTED,
					attempt.attemptId,
					deliveryAttemptConst.status.PENDING_ACK
				).run();
				if (Number(transitionResult?.meta?.changes || 0) !== 1) {
					continue;
				}
				changed = true;
			}

			const targetStatus = attempt.provider === deliveryAttemptConst.provider.CLOUDFLARE_EMAIL
				? emailConst.status.DELIVERED
				: emailConst.status.SENT;
			const emailResult = await c.env.db.prepare(`
				UPDATE email
				SET status = ?, resend_email_id = ?, message = NULL
				WHERE email_id = ? AND type = ? AND status = ?
			`).bind(
				targetStatus,
				attempt.providerMessageId,
				attempt.emailId,
				emailConst.type.SEND,
				emailConst.status.SAVING
			).run();
			if (Number(emailResult?.meta?.changes || 0) === 1) {
				changed = true;
				try {
					await emailSearchService.syncEmailIds(c, [attempt.emailId]);
				} catch {
					// The authoritative email row is repaired; search can be rebuilt separately.
				}
			}
			if (changed) {
				repaired += 1;
			}
		}

		return {
			scanned: staleAttempts.length + attempts.length,
			repaired,
			unknown,
			failed
		};
	}
};

export default deliveryAttemptService;
