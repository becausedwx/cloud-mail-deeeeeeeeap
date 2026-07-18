import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	setBackground: vi.fn(async () => 'background/test')
}));

vi.mock('../src/service/setting-service', () => ({
	default: {
		set: vi.fn(async () => {}),
		get: vi.fn(async () => ({})),
		websiteConfig: vi.fn(async () => ({})),
		setBackground: mocks.setBackground,
		deleteBackground: vi.fn(async () => {}),
		setBlacklist: vi.fn(async () => ({}))
	}
}));

const { default: app } = await import('../src/hono/hono');
await import('../src/api/setting-api');

describe('endpoint JSON body limits', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('keeps the background endpoint large enough for normal image data URLs', async () => {
		const response = await app.fetch(new Request('http://example.com/setting/setBackground', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				background: `data:image/jpeg;base64,${'A'.repeat(2 * 1024 * 1024)}`
			})
		}), {});

		expect(response.status).toBe(200);
		expect(mocks.setBackground).toHaveBeenCalledOnce();
	});

	it('rejects background JSON above 16 MiB before storage work', async () => {
		const response = await app.fetch(new Request('http://example.com/setting/setBackground', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				background: `data:image/jpeg;base64,${'A'.repeat(16 * 1024 * 1024)}`
			})
		}), {});

		expect(response.status).toBe(413);
		expect(await response.json()).toMatchObject({ code: 413 });
		expect(mocks.setBackground).not.toHaveBeenCalled();
	});
});
