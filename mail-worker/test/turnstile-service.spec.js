import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	querySetting: vi.fn(),
	fetch: vi.fn()
}));

vi.mock('../src/service/setting-service', () => ({
	default: {
		query: mocks.querySetting
	}
}));

function createContext(url = 'https://mail.example.com/api/register') {
	return {
		req: {
			url,
			header: vi.fn(() => '203.0.113.10')
		}
	};
}

describe('Turnstile verification', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.querySetting.mockResolvedValue({
			secretKey: 'turnstile-secret',
			customDomain: 'mail.example.com'
		});
		vi.stubGlobal('fetch', mocks.fetch);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it.each([
		['missing', undefined],
		['non-string', { token: 'opaque' }],
		['overlong', 't'.repeat(2049)]
	])('rejects a %s response token before contacting Turnstile', async (_label, token) => {
		const { default: turnstileService } = await import('../src/service/turnstile-service');

		await expect(turnstileService.verify(createContext(), token, 'register'))
			.rejects.toMatchObject({ code: 400 });
		expect(mocks.querySetting).not.toHaveBeenCalled();
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it.each([
		['register', 'add-account'],
		['add-account', 'register']
	])('rejects a successful %s token when %s is expected', async (issuedAction, expectedAction) => {
		mocks.fetch.mockResolvedValue({
			ok: true,
			json: vi.fn(async () => ({
				success: true,
				action: issuedAction,
				hostname: 'mail.example.com'
			}))
		});
		const { default: turnstileService } = await import('../src/service/turnstile-service');

		await expect(turnstileService.verify(createContext(), 'opaque-token', expectedAction))
			.rejects.toMatchObject({ code: 400 });
		expect(mocks.fetch).toHaveBeenCalledTimes(1);
	});

	it('rejects a successful token issued for an unrelated hostname', async () => {
		mocks.fetch.mockResolvedValue({
			ok: true,
			json: vi.fn(async () => ({
				success: true,
				action: 'register',
				hostname: 'attacker.example'
			}))
		});
		const { default: turnstileService } = await import('../src/service/turnstile-service');

		await expect(turnstileService.verify(createContext(), 'opaque-token', 'register'))
			.rejects.toMatchObject({ code: 400 });
	});

	it.each([
		['register', 'MAIL.EXAMPLE.COM:443'],
		['add-account', 'CUSTOM.EXAMPLE.COM:8443']
	])('accepts the %s action on a derived allowed hostname', async (action, hostname) => {
		mocks.querySetting.mockResolvedValue({
			secretKey: 'turnstile-secret',
			customDomain: 'https://custom.example.com/mail'
		});
		mocks.fetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: vi.fn(async () => ({ success: true, action, hostname }))
		});
		const { default: turnstileService } = await import('../src/service/turnstile-service');
		const token = action === 'register' ? 't'.repeat(2048) : 'opaque-token';

		await expect(turnstileService.verify(createContext(), token, action))
			.resolves.toBeUndefined();
	});

	it('rejects success=false once and logs only sanitized error codes', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mocks.fetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: vi.fn(async () => ({
				success: false,
				'error-codes': ['timeout-or-duplicate']
			}))
		});
		const { default: turnstileService } = await import('../src/service/turnstile-service');

		await expect(turnstileService.verify(createContext(), 'opaque-sensitive-token', 'register'))
			.rejects.toMatchObject({ code: 400 });
		expect(mocks.fetch).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith('Turnstile verification rejected', {
			category: 'rejected',
			errorCodes: ['timeout-or-duplicate']
		});
		expect(JSON.stringify(warn.mock.calls)).not.toContain('opaque-sensitive-token');
		expect(JSON.stringify(warn.mock.calls)).not.toContain('turnstile-secret');
	});

	it('maps a non-success Siteverify HTTP response to a retryable failure', async () => {
		mocks.fetch.mockResolvedValue({
			ok: false,
			status: 503,
			json: vi.fn(async () => ({
				success: true,
				action: 'register',
				hostname: 'mail.example.com'
			}))
		});
		const { default: turnstileService } = await import('../src/service/turnstile-service');

		await expect(turnstileService.verify(createContext(), 'opaque-token', 'register'))
			.rejects.toMatchObject({ code: 503 });
	});

	it('maps an invalid Siteverify JSON response to a retryable failure', async () => {
		mocks.fetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: vi.fn(async () => {
				throw new SyntaxError('unexpected token');
			})
		});
		const { default: turnstileService } = await import('../src/service/turnstile-service');

		await expect(turnstileService.verify(createContext(), 'opaque-token', 'register'))
			.rejects.toMatchObject({ code: 503 });
	});

	it('maps a network failure to 503 without logging the token or secret', async () => {
		const token = 'opaque-sensitive-token';
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mocks.fetch.mockRejectedValue(new Error(`network failed: ${token} turnstile-secret`));
		const { default: turnstileService } = await import('../src/service/turnstile-service');

		await expect(turnstileService.verify(createContext(), token, 'register'))
			.rejects.toMatchObject({ code: 503 });
		const serializedLogs = JSON.stringify(warn.mock.calls);
		expect(serializedLogs).not.toContain(token);
		expect(serializedLogs).not.toContain('turnstile-secret');
	});

	it('aborts Siteverify after the bounded four-second timeout', async () => {
		vi.useFakeTimers();
		let signal;
		mocks.fetch.mockImplementation((_url, options) => {
			signal = options.signal;
			if (!signal) return Promise.reject(new Error('missing abort signal'));
			return new Promise((_resolve, reject) => {
				signal.addEventListener('abort', () => {
					reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
				}, { once: true });
			});
		});
		const { default: turnstileService } = await import('../src/service/turnstile-service');

		const verification = turnstileService.verify(createContext(), 'opaque-token', 'register');
		const rejection = expect(verification).rejects.toMatchObject({ code: 503 });
		await vi.advanceTimersByTimeAsync(3999);
		expect(signal).toBeDefined();
		expect(signal.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await rejection;
		expect(signal.aborted).toBe(true);
		vi.useRealTimers();
	});
});
