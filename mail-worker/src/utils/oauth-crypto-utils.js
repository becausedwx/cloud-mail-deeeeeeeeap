const encoder = new TextEncoder();

function bytesToBase64Url(bytes) {
	return btoa(String.fromCharCode(...bytes))
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');
}

export function randomBase64Url(byteLength = 32) {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return bytesToBase64Url(bytes);
}

export async function sha256Base64Url(value) {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
	return bytesToBase64Url(new Uint8Array(digest));
}

export async function hmacSha256Base64Url(secret, value) {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
	return bytesToBase64Url(new Uint8Array(signature));
}
