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

function readyDb({ emailColumns, attachmentColumns, includeDeliveryAttempt = false }) {
	return {
		prepare(sql) {
			return {
				bind() {
					return this;
				},
				async all() {
					if (sql.includes("type = 'table'")) {
						const names = includeDeliveryAttempt
							? [...REQUIRED_TABLES, 'delivery_attempt']
							: REQUIRED_TABLES;
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
								{ name: 'idx_delivery_attempt_email' }
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
					includeDeliveryAttempt: true
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
});
