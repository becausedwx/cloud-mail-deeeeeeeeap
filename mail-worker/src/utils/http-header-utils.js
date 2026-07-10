function isBrowserSafeHeaderValue(value) {
	return typeof value === 'string'
		&& value.length > 0
		&& /^[\t\x20-\x7E]*$/.test(value);
}

function setBrowserSafeHeader(headers, name, value) {
	if (!isBrowserSafeHeaderValue(value)) {
		return false;
	}

	headers.set(name, value);
	return true;
}

export { isBrowserSafeHeaderValue, setBrowserSafeHeader };
