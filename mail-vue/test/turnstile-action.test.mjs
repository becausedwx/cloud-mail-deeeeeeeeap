import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [loginView, accountView, loginService, accountService, turnstileService] = await Promise.all([
	readFile(new URL('../src/views/login/index.vue', import.meta.url), 'utf8'),
	readFile(new URL('../src/layout/account/index.vue', import.meta.url), 'utf8'),
	readFile(new URL('../../mail-worker/src/service/login-service.js', import.meta.url), 'utf8'),
	readFile(new URL('../../mail-worker/src/service/account-service.js', import.meta.url), 'utf8'),
	readFile(new URL('../../mail-worker/src/service/turnstile-service.js', import.meta.url), 'utf8')
]);

test('register and add-account use distinct stable Turnstile actions end to end', () => {
	assert.match(turnstileService, /REGISTER:\s*['"]register['"]/);
	assert.match(turnstileService, /ADD_ACCOUNT:\s*['"]add-account['"]/);
	assert.match(loginView, /class="register-turnstile"[\s\S]*?data-action="register"/);
	assert.match(accountView, /class="add-email-turnstile"[\s\S]*?data-action="add-account"/);

	const registerChecks = loginService.match(
		/turnstileService\.verify\(c,\s*token,\s*TURNSTILE_ACTIONS\.REGISTER\)/g
	) || [];
	const addAccountChecks = accountService.match(
		/turnstileService\.verify\(c,\s*token,\s*TURNSTILE_ACTIONS\.ADD_ACCOUNT\)/g
	) || [];
	assert.equal(registerChecks.length, 2);
	assert.equal(addAccountChecks.length, 2);
});
