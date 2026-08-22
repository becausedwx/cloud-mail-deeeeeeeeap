import BizError from '../error/biz-error';
import settingService from './setting-service';
import { markAuthAbuse } from './auth-rate-limit-service';
import { t } from '../i18n/i18n'

export const TURNSTILE_TOKEN_MAX_LENGTH = 2048;
export const TURNSTILE_TIMEOUT_MS = 4000;
export const TURNSTILE_ACTIONS = Object.freeze({
	REGISTER: 'register',
	ADD_ACCOUNT: 'add-account'
});
const TURNSTILE_UNAVAILABLE_MESSAGE = 'Turnstile verification service unavailable';

function normalizeHostname(value) {
	if (typeof value !== 'string' || value.trim() === '') return '';
	try {
		const candidate = value.includes('://') ? value : `https://${value}`;
		return new URL(candidate).hostname.replace(/\.$/, '').toLowerCase();
	} catch {
		return '';
	}
}

function normalizeErrorCodes(value) {
	if (!Array.isArray(value)) return [];
	return value
		.filter(code => typeof code === 'string' && /^[a-z0-9-]{1,64}$/i.test(code))
		.slice(0, 10);
}

const turnstileService = {

	async verify(c, token, expectedAction) {

		if (typeof token !== 'string' || token.trim() === '' || token.length > TURNSTILE_TOKEN_MAX_LENGTH) {
			throw new BizError(t('emptyBotToken'),400);
		}

		const settingRow = await settingService.query(c)
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);

		let res;
		try {
			res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded'
				},
				signal: controller.signal,
				body: new URLSearchParams({
					secret: settingRow.secretKey,
					response: token,
					remoteip: c.req.header('cf-connecting-ip')
				})
			});
		} catch (error) {
			console.warn('Turnstile verification unavailable', {
				category: error?.name === 'AbortError' ? 'timeout' : 'network'
			});
			throw new BizError(TURNSTILE_UNAVAILABLE_MESSAGE, 503);
		} finally {
			clearTimeout(timeout);
		}

		if (!res.ok) {
			console.warn('Turnstile verification unavailable', {
				category: 'http',
				status: res.status
			});
			throw new BizError(TURNSTILE_UNAVAILABLE_MESSAGE, 503);
		}

		let result;
		try {
			result = await res.json();
		} catch {
			console.warn('Turnstile verification unavailable', { category: 'invalid-json' });
			throw new BizError(TURNSTILE_UNAVAILABLE_MESSAGE, 503);
		}

		if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.success !== 'boolean') {
			console.warn('Turnstile verification unavailable', { category: 'invalid-response' });
			throw new BizError(TURNSTILE_UNAVAILABLE_MESSAGE, 503);
		}

		// 被 Cloudflare 判定失败、动作不符或来源域不符，都是自动化提交的信号，需计入失败次数；
		// 上面的 503 与空 token 属于服务不可用和参数校验，不计数
		if (!result.success) {
			console.warn('Turnstile verification rejected', {
				category: 'rejected',
				errorCodes: normalizeErrorCodes(result['error-codes'])
			});
			throw markAuthAbuse(new BizError(t('botVerifyFail'),400))
		}

		if (result.action !== expectedAction) {
			throw markAuthAbuse(new BizError(t('botVerifyFail'),400))
		}

		const allowedHostnames = new Set([
			normalizeHostname(c.req.url),
			normalizeHostname(settingRow.customDomain)
		].filter(Boolean));
		if (!allowedHostnames.has(normalizeHostname(result.hostname))) {
			throw markAuthAbuse(new BizError(t('botVerifyFail'),400))
		}
	}
};

export default turnstileService;
