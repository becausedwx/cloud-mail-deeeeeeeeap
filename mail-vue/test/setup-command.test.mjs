import assert from 'node:assert/strict';
import test from 'node:test';
import {
	SETUP_STEP,
	buildSetupCommand,
	getSetupStep
} from '../src/views/setup/setup-command.js';

const configuredStatus = {
	bindings: { d1: true, kv: true },
	configuration: { domain: true, admin: true, initSecret: true }
};

test('selects database initialization before administrator creation', () => {
	assert.equal(getSetupStep({
		...configuredStatus,
		initialized: false,
		adminCreated: false,
		ready: false
	}), SETUP_STEP.DATABASE);
});

test('selects administrator creation after the database is initialized', () => {
	assert.equal(getSetupStep({
		...configuredStatus,
		initialized: true,
		adminCreated: false,
		ready: false
	}), SETUP_STEP.ADMINISTRATOR);
});

test('renders interactive PowerShell commands without embedding credentials', () => {
	const origin = 'https://mail.example.com';
	const databaseCommand = buildSetupCommand(SETUP_STEP.DATABASE, origin);
	const administratorCommand = buildSetupCommand(SETUP_STEP.ADMINISTRATOR, origin);

	for (const command of [databaseCommand, administratorCommand]) {
		assert.match(command, /Read-Host/);
		assert.match(command, /-AsSecureString/);
		assert.match(command, /Invoke-RestMethod/);
		assert.match(command, /Clear-Variable/);
		assert.doesNotMatch(command, /YOUR_JWT_SECRET|YOUR_ADMIN_PASSWORD/);
		assert.doesNotMatch(command, /your-jwt-secret|secure-admin-password/);
	}

	assert.match(databaseCommand, /https:\/\/mail\.example\.com\/api\/init'/);
	assert.doesNotMatch(databaseCommand, /cloudMailAdminPassword|ConvertTo-Json/);
	assert.match(administratorCommand, /cloudMailAdminPassword/);
	assert.match(administratorCommand, /ConvertTo-Json -Compress/);
	assert.match(administratorCommand, /https:\/\/mail\.example\.com\/api\/init\/admin'/);
});
