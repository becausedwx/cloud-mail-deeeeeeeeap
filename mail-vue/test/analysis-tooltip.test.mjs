import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSenderTooltip } from '../src/views/analysis/tooltip.js';

test('renders malicious tooltip parameters as escaped text', () => {
	const payload = '<img src=x onerror="globalThis.pwned=true">';
	const tooltip = formatSenderTooltip({
		marker: '<img src=x onerror="globalThis.markerPwned=true">',
		name: payload,
		value: '<svg onload="globalThis.valuePwned=true">',
		percent: '<script>globalThis.percentPwned=true</script>'
	});

	assert.match(tooltip, /&lt;img src=x onerror=&quot;globalThis\.pwned=true&quot;&gt;/);
	assert.match(tooltip, /&lt;svg onload=&quot;globalThis\.valuePwned=true&quot;&gt;/);
	assert.match(tooltip, /&lt;script&gt;globalThis\.percentPwned=true&lt;\/script&gt;/);
	assert.doesNotMatch(tooltip, /<img\b/i);
	assert.doesNotMatch(tooltip, /<svg\b|<script\b/i);
	assert.doesNotMatch(tooltip, /markerPwned/);
});

test('escapes every HTML-significant character in sender names', () => {
	const tooltip = formatSenderTooltip({
		name: `A&B <C> "D" 'E'`,
		value: 1,
		percent: 10
	});

	assert.match(tooltip, /A&amp;B &lt;C&gt; &quot;D&quot; &#39;E&#39;/);
});
