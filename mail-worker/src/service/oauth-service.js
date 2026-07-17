import BizError from "../error/biz-error";
import orm from "../entity/orm";
import {oauth} from "../entity/oauth";
import { and, eq, inArray } from 'drizzle-orm';
import userService from "./user-service";
import loginService from "./login-service";
import cryptoUtils from "../utils/crypto-utils";
import { chunkArray } from '../utils/sql-utils';
import {
	hmacSha256Base64Url,
	randomBase64Url,
	sha256Base64Url
} from '../utils/oauth-crypto-utils';
import regKeyService from './reg-key-service';
import reqUtils from '../utils/req-utils';
import { t } from '../i18n/i18n';

const BIND_TOKEN_EXPIRES_SECONDS = 600;
const OAUTH_FLOW_EXPIRES_SECONDS = 600;
const OAUTH_FLOW_LIMIT_PER_INITIATOR = 20;
const OAUTH_FLOW_GLOBAL_LIMIT = 100;
const LINUXDO_AUTHORIZE_URL = 'https://connect.linux.do/oauth2/authorize';

function oauthFlowError() {
	return new BizError('OAuth flow is invalid or expired', 400);
}

function bindTokenError() {
	return new BizError('Invalid or expired bind token', 400);
}

function providerResponseError() {
	return new BizError('LinuxDo OAuth provider returned invalid data', 502);
}

function normalizeLinuxDoUserId(value) {
	if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
		return String(value);
	}
	if (typeof value === 'string' && value.length <= 64 && /^[1-9]\d*$/.test(value)) {
		return value;
	}
	throw providerResponseError();
}

function requireLinuxDoEnabled(c) {
	if (c.env.linuxdo_switch !== true && c.env.linuxdo_switch !== 'true') {
		throw new BizError('LinuxDo OAuth is disabled', 403);
	}
}

function requireLinuxDoConfig(c) {
	requireLinuxDoEnabled(c);
	const config = {
		clientId: c.env.linuxdo_client_id,
		clientSecret: c.env.linuxdo_client_secret,
		callbackUrl: c.env.linuxdo_callback_url
	};
	if (Object.values(config).some(value => typeof value !== 'string' || !value.trim())) {
		throw new BizError('LinuxDo OAuth is not configured', 503);
	}
	return config;
}

function normalizeInitiatorIp(c) {
	return String(reqUtils.getIp(c) || 'Unknown')
		.split(',')[0]
		.trim()
		.slice(0, 128) || 'Unknown';
}

async function getInitiatorHash(c) {
	if (typeof c.env.jwt_secret !== 'string' || !c.env.jwt_secret) {
		throw new BizError('OAuth security secret is not configured', 503);
	}
	return await hmacSha256Base64Url(
		c.env.jwt_secret,
		`linuxdo-authorize\u0000${normalizeInitiatorIp(c)}`
	);
}

const oauthService = {
	async createLinuxDoAuthorization(c) {
		const { clientId, callbackUrl } = requireLinuxDoConfig(c);
		const state = randomBase64Url();
		const codeVerifier = randomBase64Url();
		const [stateHash, codeChallenge, initiatorHash] = await Promise.all([
			sha256Base64Url(state),
			sha256Base64Url(codeVerifier),
			getInitiatorHash(c)
		]);
		const now = Math.floor(Date.now() / 1000);
		const expiresAt = now + OAUTH_FLOW_EXPIRES_SECONDS;
		const results = await c.env.db.batch([
			c.env.db.prepare(`
				DELETE FROM oauth_auth_state
				WHERE expires_at <= ?
			`).bind(now),
			c.env.db.prepare(`
				INSERT INTO oauth_auth_state (
					state_hash, code_verifier, initiator_hash, consumed, expires_at
				)
				SELECT ?, ?, ?, 0, ?
				WHERE (
					SELECT COUNT(*)
					FROM oauth_auth_state
					WHERE initiator_hash = ? AND expires_at > ?
				) < ?
				AND (
					SELECT COUNT(*)
					FROM oauth_auth_state
					WHERE expires_at > ?
				) < ?
			`).bind(
				stateHash,
				codeVerifier,
				initiatorHash,
				expiresAt,
				initiatorHash,
				now,
				OAUTH_FLOW_LIMIT_PER_INITIATOR,
				now,
				OAUTH_FLOW_GLOBAL_LIMIT
			)
		]);
		if (Number(results?.[1]?.meta?.changes || 0) !== 1) {
			throw new BizError(t('oauthTooManyAuthorizations'), 429);
		}

		const authorizationUrl = new URL(LINUXDO_AUTHORIZE_URL);
		authorizationUrl.searchParams.set('client_id', clientId);
		authorizationUrl.searchParams.set('redirect_uri', callbackUrl);
		authorizationUrl.searchParams.set('response_type', 'code');
		authorizationUrl.searchParams.set('scope', 'openid profile email');
		authorizationUrl.searchParams.set('state', state);
		authorizationUrl.searchParams.set('code_challenge', codeChallenge);
		authorizationUrl.searchParams.set('code_challenge_method', 'S256');

		return { state, authorizationUrl: authorizationUrl.toString() };
	},

	async consumeLinuxDoState(c, state) {
		if (typeof state !== 'string' || !state) {
			throw oauthFlowError();
		}
		const stateHash = await sha256Base64Url(state);
		const row = await c.env.db.prepare(`
			UPDATE oauth_auth_state
			SET consumed = 1
			WHERE state_hash = ?
			  AND consumed = 0
			  AND expires_at > ?
			RETURNING code_verifier AS codeVerifier
		`).bind(stateHash, Math.floor(Date.now() / 1000)).first();
		if (!row?.codeVerifier) {
			throw oauthFlowError();
		}
		return row.codeVerifier;
	},

	async issueBindToken(c, oauthUserId) {
		const oauthRow = await this.getById(c, oauthUserId);
		if (!oauthRow || Number(oauthRow.userId || 0) !== 0) {
			throw bindTokenError();
		}

		const bindToken = randomBase64Url();
		const tokenHash = await sha256Base64Url(bindToken);
		const expiresAt = Math.floor(Date.now() / 1000) + BIND_TOKEN_EXPIRES_SECONDS;
		await c.env.db.prepare(`
			INSERT INTO oauth_bind_challenge (oauth_user_id, token_hash, expires_at)
			VALUES (?, ?, ?)
			ON CONFLICT(oauth_user_id) DO UPDATE SET
				token_hash = excluded.token_hash,
				expires_at = excluded.expires_at
		`).bind(oauthUserId, tokenHash, expiresAt).run();
		return bindToken;
	},

	async consumeBindToken(c, bindToken) {
		if (typeof bindToken !== 'string' || !bindToken) {
			throw bindTokenError();
		}
		const tokenHash = await sha256Base64Url(bindToken);
		const row = await c.env.db.prepare(`
			DELETE FROM oauth_bind_challenge
			WHERE token_hash = ?
			  AND expires_at > ?
			RETURNING oauth_user_id AS oauthUserId,
			          token_hash AS tokenHash,
			          expires_at AS expiresAt
		`).bind(tokenHash, Math.floor(Date.now() / 1000)).first();
		if (!row?.oauthUserId) {
			throw bindTokenError();
		}
		return row;
	},

	async restoreBindChallenge(c, challenge) {
		await c.env.db.prepare(`
			INSERT OR IGNORE INTO oauth_bind_challenge (oauth_user_id, token_hash, expires_at)
			SELECT ?, ?, ?
			WHERE ? > ?
			  AND EXISTS (
				SELECT 1
				FROM oauth
				WHERE platform = 0
				  AND oauth_user_id = ?
				  AND user_id = 0
			  )
		`).bind(
			challenge.oauthUserId,
			challenge.tokenHash,
			challenge.expiresAt,
			challenge.expiresAt,
			Math.floor(Date.now() / 1000),
			challenge.oauthUserId
		).run();
	},

	async cleanupFailedBindRegistration(c, userRow) {
		await c.env.db.batch([
			c.env.db.prepare('DELETE FROM account WHERE user_id = ?').bind(userRow.userId),
			c.env.db.prepare('DELETE FROM user WHERE user_id = ?').bind(userRow.userId)
		]);
		if (Number(userRow.regKeyId || 0) > 0) {
			await regKeyService.restoreCount(c, userRow.regKeyId, 1);
		}
	},

	async bindUser(c, params) {

		requireLinuxDoEnabled(c);
		const { email, bindToken, code } = params || {};
		const challenge = await this.consumeBindToken(c, bindToken);
		const oauthUserId = challenge.oauthUserId;

		const oauthRow = await this.getById(c, oauthUserId);

		if (!oauthRow) {
			throw bindTokenError();
		}

		let userRow = await userService.selectByIdIncludeDel(c, oauthRow.userId);

		if (userRow) {
			throw new BizError('用户已绑定有邮箱')
		}

		try {
			await loginService.register(c, { email, password: cryptoUtils.genRandomPwd(), code }, true);
		} catch (error) {
			await this.restoreBindChallenge(c, challenge);
			throw error;
		}

		userRow = await userService.selectByEmail(c, email);

		let bindResult;
		try {
			bindResult = await c.env.db.prepare(`
				UPDATE oauth
				SET user_id = ?
				WHERE platform = 0
				  AND oauth_user_id = ?
				  AND user_id = 0
			`).bind(userRow.userId, oauthUserId).run();
		} catch (error) {
			await this.cleanupFailedBindRegistration(c, userRow);
			throw error;
		}
		if (Number(bindResult?.meta?.changes || 0) !== 1) {
			await this.cleanupFailedBindRegistration(c, userRow);
			throw new BizError('OAuth identity was already bound', 409);
		}
		const jwtToken = await loginService.login(c, { email, password: null }, true);

		return { userInfo: { ...oauthRow, userId: userRow.userId }, token: jwtToken}
	},

	async linuxDoLogin(c, params) {

		const { clientId, clientSecret, callbackUrl } = requireLinuxDoConfig(c);
		const { code, state } = params || {};
		if (typeof code !== 'string' || !code) {
			throw oauthFlowError();
		}
		const codeVerifier = await this.consumeLinuxDoState(c, state);

		let token = '';
		let userInfo = {}

		const reqParams = new URLSearchParams()
		reqParams.append('client_id', clientId)
		reqParams.append('client_secret', clientSecret)
		reqParams.append('code', code)
		reqParams.append('redirect_uri', callbackUrl)
		reqParams.append('grant_type', 'authorization_code')
		reqParams.append('code_verifier', codeVerifier)

		const tokenRes = await fetch("https://connect.linux.do/oauth2/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: reqParams.toString()
		})

		if (!tokenRes.ok) {
			throw new BizError(tokenRes.statusText)
		}

		token = await tokenRes.json()
		if (typeof token?.access_token !== 'string' || !token.access_token.trim()) {
			throw providerResponseError();
		}

		const userRes = await fetch('https://connect.linux.do/api/user', {
			headers: {
				Authorization: 'Bearer ' + token.access_token
			}
		});

		if (!userRes.ok) {
			throw new BizError(userRes.statusText)
		}

		userInfo = await userRes.json();
		if (!userInfo || typeof userInfo !== 'object' || Array.isArray(userInfo)) {
			throw providerResponseError();
		}

		userInfo.oauthUserId = normalizeLinuxDoUserId(userInfo?.id);
		userInfo.active = userInfo.active ? 0 : 1;
		userInfo.silenced = userInfo.silenced ? 1 : 0;
		userInfo.trustLevel = userInfo.trust_level;
		userInfo.avatar = userInfo.avatar_url;

		const  oauthRow = await this.saveUser(c, userInfo);
		const userRow = await userService.selectByIdIncludeDel(c, oauthRow.userId);

		if (!userRow) {
			const bindToken = await this.issueBindToken(c, oauthRow.oauthUserId);
			return { userInfo: oauthRow, token: null, bindToken }
		}

		const JwtToken = await loginService.login(c, { email: userRow.email, password: null }, true);
		return { userInfo: oauthRow, token: JwtToken }
	},

	async saveUser(c, userInfo) {
		const oauthUserId = typeof userInfo?.oauthUserId === 'string'
			? userInfo.oauthUserId
			: String(userInfo?.oauthUserId || '');
		if (!oauthUserId) {
			throw new BizError('LinuxDo user id is missing', 400);
		}

		return await c.env.db.prepare(`
			INSERT INTO oauth (
				oauth_user_id, username, name, avatar,
				active, trust_level, silenced, platform, user_id
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)
			ON CONFLICT(platform, oauth_user_id) DO UPDATE SET
				username = excluded.username,
				name = excluded.name,
				avatar = excluded.avatar,
				active = excluded.active,
				trust_level = excluded.trust_level,
				silenced = excluded.silenced
			RETURNING oauth_id AS oauthId,
			          oauth_user_id AS oauthUserId,
			          username,
			          name,
			          avatar,
			          active,
			          trust_level AS trustLevel,
			          silenced,
			          create_time AS createTime,
			          platform,
			          user_id AS userId
		`).bind(
			oauthUserId,
			userInfo.username || '',
			userInfo.name || '',
			userInfo.avatar || '',
			Number(userInfo.active || 0),
			Number(userInfo.trustLevel || 0),
			Number(userInfo.silenced || 0)
		).first();
	},

	async getById(c, oauthUserId) {
		return await orm(c).select().from(oauth).where(
			and(eq(oauth.platform, 0), eq(oauth.oauthUserId, oauthUserId))
		).get();
	},

	async deleteByUserId(c, userId) {
		await this.deleteByUserIds(c, [userId]);
	},

	async deleteByUserIds(c, userIds) {
		for (const chunk of chunkArray(userIds)) {
			await orm(c).delete(oauth).where(inArray(oauth.userId, chunk)).run();
		}
	},

	// 清除超过一天且没有活跃绑定流程的未绑定 OAuth 身份。
	async clearExpiredOAuthSecurity(c) {
		const now = Math.floor(Date.now() / 1000);
		await c.env.db.batch([
			c.env.db.prepare('DELETE FROM oauth_auth_state WHERE expires_at <= ?').bind(now),
			c.env.db.prepare('DELETE FROM oauth_bind_challenge WHERE expires_at <= ?').bind(now)
		]);
	},

	async clearNoBindOathUser(c) {
		await this.clearExpiredOAuthSecurity(c);
		await c.env.db.prepare(`
			DELETE FROM oauth
			WHERE platform = 0
			  AND user_id = 0
			  AND create_time < datetime('now', '-1 day')
			  AND NOT EXISTS (
				SELECT 1
				FROM oauth_bind_challenge
				WHERE oauth_bind_challenge.oauth_user_id = oauth.oauth_user_id
			  )
		`).run();
	},

}

export default  oauthService
