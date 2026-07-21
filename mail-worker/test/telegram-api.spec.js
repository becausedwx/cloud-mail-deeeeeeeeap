import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src';

describe('telegram email view API', () => {
	it('does not allow public immutable caching for tokenized email views', async () => {
		const request = new Request('http://example.com/api/telegram/getEmail/not-a-token');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toBe('private, max-age=0, no-store');
		expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');

		const csp = response.headers.get('Content-Security-Policy');
		const directives = Object.fromEntries(csp.split(';').map(part => {
			const [name, ...values] = part.trim().split(/\s+/);
			return [name, values];
		}));
		expect(directives['script-src']).not.toContain("'unsafe-inline'");
		expect(directives['script-src']).not.toContain("'unsafe-eval'");
		expect(directives['script-src-attr']).toEqual(["'none'"]);
		expect(directives['object-src']).toEqual(["'none'"]);
		expect(directives['frame-ancestors']).toEqual(["'none'"]);

		const body = await response.text();
		expect(body).toContain('Access denied');
		expect(body).not.toMatch(/<script\b/i);
	});
});
