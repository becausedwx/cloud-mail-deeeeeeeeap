import { describe, expect, it } from 'vitest';
import { getBootstrapStatus } from '../src/init/status';

const REQUIRED_TABLES = [
	'email_search',
	'public_send_rate_limit',
	'auth_failure_limit',
	'oauth_auth_state',
	'oauth_bind_challenge',
	'oauth',
	'setting',
	'verify_record',
	'reg_key',
	'user',
	'account',
	'role',
	'perm',
	'role_perm',
	'email',
	'star',
	'attachments'
];

function readyDb({
	emailColumns,
	attachmentColumns,
	includeDeliveryAttempt = false,
	includeWebhookEvent = false,
	uniqueDeliveryIndexes = true,
	uniqueWebhookIndex = true,
	deliveryAttemptColumns = [
		'attempt_id', 'email_id', 'provider', 'attempt_key', 'status',
		'provider_message_id', 'error_summary', 'create_time', 'update_time'
	],
	webhookEventColumns = [
		'event_key', 'svix_id', 'body_sha256', 'event_type', 'provider_email_id',
		'status', 'outcome', 'received_at', 'processed_at'
	]
}) {
	return {
		prepare(sql) {
			return {
				bind() {
					return this;
				},
				async all() {
					if (sql.includes('PRAGMA index_list(delivery_attempt)')) {
						return {
							results: includeDeliveryAttempt ? [
								{ name: 'idx_delivery_attempt_key', unique: uniqueDeliveryIndexes ? 1 : 0 },
								{ name: 'idx_delivery_attempt_email', unique: uniqueDeliveryIndexes ? 1 : 0 },
								{ name: 'idx_delivery_attempt_provider_message', unique: uniqueDeliveryIndexes ? 1 : 0 }
							] : []
						};
					}
					if (sql.includes('PRAGMA index_list(resend_webhook_event)')) {
						return {
							results: includeWebhookEvent ? [
								{ name: 'idx_resend_webhook_event_key', unique: uniqueWebhookIndex ? 1 : 0 }
							] : []
						};
					}
					if (sql.includes("type = 'table'")) {
						const names = [...REQUIRED_TABLES];
						if (includeDeliveryAttempt) names.push('delivery_attempt');
						if (includeWebhookEvent) names.push('resend_webhook_event');
						return { results: names.map(name => ({ name })) };
					}
					if (sql.includes("type = 'index'")) {
						const names = [
								{ name: 'idx_oauth_platform_user_unique' },
								{ name: 'idx_oauth_auth_state_initiator_expires_at' },
								{ name: 'idx_email_receive_recovery' },
								{ name: 'idx_email_receive_recovery_due' },
								{ name: 'idx_attachments_email_status_key' }
							];
						if (includeDeliveryAttempt) {
							names.push(
								{ name: 'idx_delivery_attempt_key' },
								{ name: 'idx_delivery_attempt_status_time' },
								{ name: 'idx_delivery_attempt_email' },
								{ name: 'idx_delivery_attempt_provider_message' }
							);
						}
						if (includeWebhookEvent) {
							names.push(
								{ name: 'idx_resend_webhook_event_key' },
								{ name: 'idx_resend_webhook_event_status_time' },
								{ name: 'idx_resend_webhook_event_provider_email' }
							);
						}
						return { results: names };
					}
					if (sql.includes('PRAGMA table_info(email)')) {
						return { results: emailColumns.map(name => ({ name })) };
					}
					if (sql.includes('PRAGMA table_info(attachments)')) {
						return { results: attachmentColumns.map(name => ({ name })) };
					}
					if (sql.includes('PRAGMA table_info(delivery_attempt)')) {
						return {
							results: includeDeliveryAttempt
								? deliveryAttemptColumns.map(name => ({ name }))
								: []
						};
					}
					if (sql.includes('PRAGMA table_info(resend_webhook_event)')) {
						return {
							results: includeWebhookEvent
								? webhookEventColumns.map(name => ({ name }))
								: []
						};
					}
					return { results: [] };
				},
				async first() {
					return { initialized: 1, created: 1 };
				}
			};
		}
	};
}

describe('bootstrap schema readiness', () => {
	it('does not report ready when incoming recovery columns are missing', async () => {
		const status = await getBootstrapStatus({
			env: {
				db: readyDb({
					emailColumns: ['email_id'],
					attachmentColumns: ['att_id', 'status']
				}),
				kv: {},
				assets: {},
				domain: ['example.com'],
				admin: 'admin@example.com',
				jwt_secret: 'configured'
			}
		});

		expect(status.initialized).toBe(false);
		expect(status.ready).toBe(false);
	});

	it('does not report ready when delivery attempt schema is missing', async () => {
		const status = await getBootstrapStatus({
			env: {
				db: readyDb({
					emailColumns: ['email_id', 'attachment_count', 'recovery_after'],
					attachmentColumns: ['att_id', 'status', 'message']
				}),
				kv: {},
				assets: {},
				domain: ['example.com'],
				admin: 'admin@example.com',
				jwt_secret: 'configured'
			}
		});

		expect(status.schemaReady).toBe(false);
		expect(status.ready).toBe(false);
	});

	it('reports ready when the delivery attempt schema is present', async () => {
		const status = await getBootstrapStatus({
			env: {
				db: readyDb({
					emailColumns: ['email_id', 'attachment_count', 'recovery_after'],
					attachmentColumns: ['att_id', 'status', 'message'],
					includeDeliveryAttempt: true,
					includeWebhookEvent: true
				}),
				kv: {},
				assets: {},
				domain: ['example.com'],
				admin: 'admin@example.com',
				jwt_secret: 'configured'
			}
		});

		expect(status.schemaReady).toBe(true);
		expect(status.ready).toBe(true);
	});

	it('does not report ready when durable identity indexes are not unique', async () => {
		const status = await getBootstrapStatus({
			env: {
				db: readyDb({
					emailColumns: ['email_id', 'attachment_count', 'recovery_after'],
					attachmentColumns: ['att_id', 'status', 'message'],
					includeDeliveryAttempt: true,
					includeWebhookEvent: true,
					uniqueDeliveryIndexes: false,
					uniqueWebhookIndex: false
				}),
				kv: {},
				assets: {},
				domain: ['example.com'],
				admin: 'admin@example.com',
				jwt_secret: 'configured'
			}
		});

		expect(status.schemaReady).toBe(false);
		expect(status.ready).toBe(false);
	});

	it('does not report ready when the Resend webhook event schema is missing', async () => {
		const status = await getBootstrapStatus({
			env: {
				db: readyDb({
					emailColumns: ['email_id', 'attachment_count', 'recovery_after'],
					attachmentColumns: ['att_id', 'status', 'message'],
					includeDeliveryAttempt: true
				}),
				kv: {},
				assets: {},
				domain: ['example.com'],
				admin: 'admin@example.com',
				jwt_secret: 'configured'
			}
		});

		expect(status.schemaReady).toBe(false);
		expect(status.ready).toBe(false);
	});

	it('does not report ready when a webhook event column is missing', async () => {
		const status = await getBootstrapStatus({
			env: {
				db: readyDb({
					emailColumns: ['email_id', 'attachment_count', 'recovery_after'],
					attachmentColumns: ['att_id', 'status', 'message'],
					includeDeliveryAttempt: true,
					includeWebhookEvent: true,
					webhookEventColumns: ['event_key', 'body_sha256']
				}),
				kv: {},
				assets: {},
				domain: ['example.com'],
				admin: 'admin@example.com',
				jwt_secret: 'configured'
			}
		});

		expect(status.schemaReady).toBe(false);
		expect(status.ready).toBe(false);
	});
});
