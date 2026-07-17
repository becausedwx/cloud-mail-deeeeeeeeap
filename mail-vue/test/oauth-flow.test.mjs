import assert from 'node:assert/strict';
import test from 'node:test';
import {
	LINUXDO_OAUTH_STATE_KEY,
	consumeLinuxDoCallback,
	exchangeLinuxDoCallback,
	prepareLinuxDoAuthorization,
	resolveLinuxDoCallback
} from '../src/views/login/oauth-flow.js';

test('accepts only a matching LinuxDo authorization response with S256 PKCE', () => {
	const state = 'expected-state';
	const authorizationUrl = [
		'https://connect.linux.do/oauth2/authorize',
		'?client_id=client-id',
		'&state=expected-state',
		'&code_challenge=challenge',
		'&code_challenge_method=S256'
	].join('');

	assert.deepEqual(prepareLinuxDoAuthorization({ state, authorizationUrl }), {
		state,
		authorizationUrl
	});
	assert.equal(LINUXDO_OAUTH_STATE_KEY, 'cloud-mail:linuxdo-oauth-state');
	assert.throws(() => prepareLinuxDoAuthorization({
		state,
		authorizationUrl: authorizationUrl.replace('expected-state', 'wrong-state')
	}), /invalid/i);
	assert.throws(() => prepareLinuxDoAuthorization({
		state,
		authorizationUrl: authorizationUrl.replace('S256', 'plain')
	}), /invalid/i);
});

test('accepts a matching callback and removes OAuth parameters from the URL', async () => {
	const callback = resolveLinuxDoCallback(
		'https://mail.example.com/login?theme=dark&code=oauth-code&state=expected-state#login',
		'expected-state'
	);
	assert.deepEqual(callback, {
		status: 'ready',
		code: 'oauth-code',
		state: 'expected-state',
		cleanUrl: 'https://mail.example.com/login?theme=dark#login'
	});

	const calls = [];
	const result = await exchangeLinuxDoCallback(callback, async (code, state) => {
		calls.push({ code, state });
		return { token: 'session-token' };
	});
	assert.deepEqual(calls, [{ code: 'oauth-code', state: 'expected-state' }]);
	assert.deepEqual(result, { token: 'session-token' });
});

test('rejects missing or mismatched callback state without exchanging the code', async () => {
	const invalidCallbacks = [
		resolveLinuxDoCallback('https://mail.example.com/login?code=oauth-code', 'expected-state'),
		resolveLinuxDoCallback(
			'https://mail.example.com/login?code=oauth-code&state=wrong-state',
			'expected-state'
		),
		resolveLinuxDoCallback(
			'https://mail.example.com/login?error=access_denied&state=expected-state',
			'expected-state'
		)
	];
	let exchanges = 0;
	for (const callback of invalidCallbacks) {
		assert.equal(callback.status, 'invalid');
		assert.equal(callback.cleanUrl, 'https://mail.example.com/login');
		assert.equal(await exchangeLinuxDoCallback(callback, async () => {
			exchanges++;
		}), null);
	}
	assert.equal(exchanges, 0);
});

test('ignores ordinary visits that do not contain OAuth callback parameters', () => {
	assert.deepEqual(
		resolveLinuxDoCallback('https://mail.example.com/login?theme=dark', 'stale-state'),
		{
			status: 'none',
			cleanUrl: 'https://mail.example.com/login?theme=dark'
		}
	);
});

test('consumes browser state before either a successful or failed code exchange', async () => {
	function storageWithState() {
		const values = new Map([[LINUXDO_OAUTH_STATE_KEY, 'expected-state']]);
		return {
			getItem: key => values.get(key) ?? null,
			removeItem: key => values.delete(key)
		};
	}

	for (const exchange of [
		async () => ({ token: 'session-token' }),
		async () => { throw new Error('provider failed'); }
	]) {
		const storage = storageWithState();
		const callback = consumeLinuxDoCallback(
			'https://mail.example.com/login?code=oauth-code&state=expected-state',
			storage
		);
		assert.equal(storage.getItem(LINUXDO_OAUTH_STATE_KEY), null);
		try {
			await exchangeLinuxDoCallback(callback, exchange);
		} catch (error) {
			assert.match(error.message, /provider failed/);
		}
		assert.equal(storage.getItem(LINUXDO_OAUTH_STATE_KEY), null);
	}
});

test('fails closed and still sanitizes the callback URL when sessionStorage is unavailable', () => {
	const unavailableStorage = {
		getItem() {
			throw new Error('storage blocked');
		},
		removeItem() {
			throw new Error('storage blocked');
		}
	};

	assert.deepEqual(consumeLinuxDoCallback(
		'https://mail.example.com/login?code=oauth-code&state=returned-state',
		unavailableStorage
	), {
		status: 'invalid',
		cleanUrl: 'https://mail.example.com/login'
	});
});
