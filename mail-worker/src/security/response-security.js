const CONTENT_SECURITY_POLICY = [
	"default-src 'self'",
	"base-uri 'self'",
	"object-src 'none'",
	"frame-ancestors 'none'",
	"form-action 'self' https:",
	"script-src 'self' https://challenges.cloudflare.com",
	"script-src-attr 'none'",
	"style-src 'self' 'unsafe-inline' https:",
	"img-src 'self' data: blob: https:",
	"font-src 'self' data: https:",
	"media-src 'self' data: blob: https:",
	"connect-src 'self' https:",
	"frame-src 'self' blob: https://challenges.cloudflare.com",
	"worker-src 'self' blob:",
	"manifest-src 'self'"
].join('; ');

export function applySecurityHeaders(headers) {
	headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('X-Frame-Options', 'DENY');
	headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	return headers;
}

export function withSecurityHeaders(response) {
	const secured = new Response(response.body, response);
	applySecurityHeaders(secured.headers);
	return secured;
}
