export function normalizeDomain(value) {
	if (typeof value !== 'string') return '';
	return value.trim().replace(/^@/, '').toLowerCase();
}

export function parseConfiguredDomains(value) {
	let domains = value;
	if (typeof domains === 'string') {
		try {
			domains = JSON.parse(domains);
		} catch {
			throw new TypeError('domain configuration must be a JSON array');
		}
	}

	if (!Array.isArray(domains)) {
		throw new TypeError('domain configuration must be an array');
	}

	return [...new Set(domains.map(normalizeDomain).filter(Boolean))];
}

export function isConfiguredDomain(value, domain) {
	const normalized = normalizeDomain(domain);
	return normalized !== '' && parseConfiguredDomains(value).includes(normalized);
}
