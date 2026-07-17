export const LINUXDO_OAUTH_STATE_KEY = 'cloud-mail:linuxdo-oauth-state';

const LINUXDO_AUTHORIZE_ORIGIN = 'https://connect.linux.do';
const LINUXDO_AUTHORIZE_PATH = '/oauth2/authorize';
const OAUTH_CALLBACK_PARAMS = [
	'code',
	'state',
	'error',
	'error_description',
	'error_uri'
];

function invalidAuthorization() {
	throw new Error('Invalid LinuxDo OAuth authorization response');
}

export function prepareLinuxDoAuthorization(authorization) {
	const state = authorization?.state;
	const authorizationUrl = authorization?.authorizationUrl;
	if (typeof state !== 'string' || !state || typeof authorizationUrl !== 'string') {
		return invalidAuthorization();
	}

	let url;
	try {
		url = new URL(authorizationUrl);
	} catch {
		return invalidAuthorization();
	}

	if (
		url.origin !== LINUXDO_AUTHORIZE_ORIGIN
		|| url.pathname !== LINUXDO_AUTHORIZE_PATH
		|| url.searchParams.getAll('state').length !== 1
		|| url.searchParams.get('state') !== state
		|| !url.searchParams.get('code_challenge')
		|| url.searchParams.get('code_challenge_method') !== 'S256'
	) {
		return invalidAuthorization();
	}

	return { state, authorizationUrl: url.toString() };
}

export function resolveLinuxDoCallback(currentUrl, expectedState) {
	const url = new URL(currentUrl);
	const hasCallbackParams = OAUTH_CALLBACK_PARAMS.some(name => url.searchParams.has(name));
	if (!hasCallbackParams) {
		return { status: 'none', cleanUrl: url.toString() };
	}

	const codeValues = url.searchParams.getAll('code');
	const stateValues = url.searchParams.getAll('state');
	const providerError = url.searchParams.has('error');
	for (const name of OAUTH_CALLBACK_PARAMS) {
		url.searchParams.delete(name);
	}
	const cleanUrl = url.toString();

	if (
		providerError
		|| codeValues.length !== 1
		|| stateValues.length !== 1
		|| typeof expectedState !== 'string'
		|| !expectedState
		|| stateValues[0] !== expectedState
		|| !codeValues[0]
	) {
		return { status: 'invalid', cleanUrl };
	}

	return {
		status: 'ready',
		code: codeValues[0],
		state: stateValues[0],
		cleanUrl
	};
}

export function consumeLinuxDoCallback(currentUrl, storage) {
	let expectedState = null;
	try {
		expectedState = storage.getItem(LINUXDO_OAUTH_STATE_KEY);
	} catch {
		// A blocked storage backend must fail the OAuth flow closed.
	}
	const callback = resolveLinuxDoCallback(currentUrl, expectedState);
	if (callback.status !== 'none') {
		try {
			storage.removeItem(LINUXDO_OAUTH_STATE_KEY);
		} catch {
			// URL sanitization and state rejection remain authoritative.
		}
	}
	return callback;
}

export async function exchangeLinuxDoCallback(callback, exchange) {
	if (callback?.status !== 'ready') {
		return null;
	}
	return await exchange(callback.code, callback.state);
}
