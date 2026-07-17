export const SETUP_STEP = Object.freeze({
	DATABASE: 'database',
	ADMINISTRATOR: 'administrator'
});

function hasBootstrapPrerequisites(status) {
	return status?.bindings?.d1 === true
		&& status?.bindings?.kv === true
		&& status?.configuration?.domain === true
		&& status?.configuration?.admin === true
		&& status?.configuration?.initSecret === true;
}

export function getSetupStep(status) {
	if (!hasBootstrapPrerequisites(status)) return null;
	if (status.initialized !== true) return SETUP_STEP.DATABASE;
	if (status.adminCreated !== true) return SETUP_STEP.ADMINISTRATOR;
	return null;
}

export function buildSetupCommand(step, origin) {
	const baseUrl = String(origin || '').replace(/\/+$/, '');
	const secretPrompt = "$cloudMailInitSecret = [Net.NetworkCredential]::new('', (Read-Host 'Cloud Mail init secret' -AsSecureString)).Password";

	if (step === SETUP_STEP.DATABASE) {
		return [
			secretPrompt,
			'try {',
			`  Invoke-RestMethod -Method Post -Uri '${baseUrl}/api/init' -Headers @{ 'X-Cloud-Mail-Init-Secret' = $cloudMailInitSecret }`,
			'} finally {',
			'  Clear-Variable cloudMailInitSecret -ErrorAction SilentlyContinue',
			'}'
		].join('\n');
	}

	if (step === SETUP_STEP.ADMINISTRATOR) {
		return [
			secretPrompt,
			"$cloudMailAdminPassword = [Net.NetworkCredential]::new('', (Read-Host 'Cloud Mail administrator password' -AsSecureString)).Password",
			'try {',
			'  $cloudMailAdminBody = @{ password = $cloudMailAdminPassword } | ConvertTo-Json -Compress',
			`  Invoke-RestMethod -Method Post -Uri '${baseUrl}/api/init/admin' -Headers @{ 'X-Cloud-Mail-Init-Secret' = $cloudMailInitSecret } -ContentType 'application/json' -Body $cloudMailAdminBody`,
			'} finally {',
			'  Clear-Variable cloudMailInitSecret, cloudMailAdminPassword, cloudMailAdminBody -ErrorAction SilentlyContinue',
			'}'
		].join('\n');
	}

	return '';
}
