import { isDel, userConst } from '../const/entity-const';

const REQUIRED_TABLES = [
	'email_search',
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

function hasText(value) {
	return typeof value === 'string' && value.trim().length > 0;
}

function hasDomainConfig(value) {
	if (Array.isArray(value)) {
		return value.length > 0 && value.every(item => hasText(item));
	}

	if (!hasText(value)) {
		return false;
	}

	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) && parsed.length > 0 && parsed.every(item => hasText(item));
	} catch {
		return false;
	}
}

export async function getBootstrapStatus(c) {
	const bindings = {
		d1: !!c.env?.db,
		kv: !!c.env?.kv,
		assets: !!c.env?.assets
	};
	const configuration = {
		domain: hasDomainConfig(c.env?.domain),
		admin: hasText(c.env?.admin),
		initSecret: hasText(c.env?.jwt_secret)
	};

	let initialized = false;
	let adminCreated = false;
	if (bindings.d1) {
		try {
			const placeholders = REQUIRED_TABLES.map(() => '?').join(',');
			const tableRows = await c.env.db.prepare(`
				SELECT name
				FROM sqlite_master
				WHERE type = 'table' AND name IN (${placeholders})
			`).bind(...REQUIRED_TABLES).all();
			const tableNames = new Set((tableRows.results || []).map(row => row.name));
			const hasRequiredTables = REQUIRED_TABLES.every(name => tableNames.has(name));

			if (hasRequiredTables) {
				initialized = !!await c.env.db.prepare('SELECT 1 AS initialized FROM setting LIMIT 1').first();
				if (initialized && configuration.admin) {
					adminCreated = !!await c.env.db.prepare(`
						SELECT 1 AS created
						FROM user u
						JOIN account a
						  ON a.user_id = u.user_id
						 AND a.email COLLATE NOCASE = u.email
						WHERE u.email COLLATE NOCASE = ?
						  AND u.is_del = ?
						  AND u.status = ?
						  AND a.is_del = ?
						LIMIT 1
					`).bind(
						c.env.admin.trim(),
						isDel.NORMAL,
						userConst.status.NORMAL,
						isDel.NORMAL
					).first();
				}
			}
		} catch (error) {
			console.warn(`Unable to check database initialization status: ${error.message}`);
		}
	}

	return {
		initialized,
		adminCreated,
		ready: initialized
			&& adminCreated
			&& bindings.d1
			&& bindings.kv
			&& configuration.domain
			&& configuration.admin
			&& configuration.initSecret,
		bindings,
		configuration
	};
}

export function createBootstrapWebsiteConfig(status) {
	return {
		initialized: status.initialized,
		adminCreated: status.adminCreated,
		ready: status.ready,
		bootstrap: status,
		register: 1,
		title: 'Cloud Mail',
		manyEmail: 1,
		addEmail: 1,
		autoRefresh: 0,
		addEmailVerify: 1,
		registerVerify: 1,
		send: 1,
		r2Domain: null,
		siteKey: null,
		background: '',
		loginOpacity: 1,
		domainList: [],
		regKey: 1,
		regVerifyOpen: false,
		addVerifyOpen: false,
		noticeTitle: '',
		noticeContent: '',
		noticeType: 'info',
		noticeDuration: 0,
		noticePosition: 'top-right',
		noticeWidth: 0,
		noticeOffset: 0,
		notice: 1,
		loginDomain: 0,
		linuxdoClientId: '',
		linuxdoCallbackUrl: '',
		linuxdoSwitch: false,
		minEmailPrefix: 1,
		projectLink: true
	};
}
