export function escapeTooltipText(value) {
	return String(value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

export function formatSenderTooltip(params = {}) {
	const name = escapeTooltipText(params.name);
	const value = escapeTooltipText(params.value);
	const percent = escapeTooltipText(params.percent);

	return `${name}： ${value} (${percent}%)`;
}
