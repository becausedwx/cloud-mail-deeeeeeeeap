import {beforeEach, describe, expect, it, vi} from 'vitest';

const state = vi.hoisted(() => ({selectCalls: 0, batchCalls: 0, batchResults: []}));

vi.mock('../src/entity/orm', () => ({
	default: vi.fn(() => ({
		select() {
			state.selectCalls++;
			const builder = {
				from() { return builder; },
				leftJoin() { return builder; },
				where() { return builder; },
				orderBy() { return builder; },
				limit() { return builder; },
				async all() { return []; },
				async get() { return null; }
			};
			return builder;
		},
		async batch(stmts) {
			state.batchCalls++;
			return stmts.map(() => state.batchResults.length ? state.batchResults.shift() : []);
		}
	}))
}));

vi.mock('../src/service/att-service', () => ({
	default: {
		countByEmailIds: vi.fn(async () => []),
		selectByEmailIds: vi.fn(async () => [])
	}
}));

vi.mock('../src/service/email-search-service', () => ({
	default: {
		hasSearchParams: vi.fn(() => false),
		allList: vi.fn(),
		syncEmailIds: vi.fn(),
		removeEmailIds: vi.fn()
	}
}));

const {default: emailService} = await import('../src/service/email-service');

describe('continuation list query budget', () => {
	beforeEach(() => {
		state.selectCalls = 0;
		state.batchCalls = 0;
		state.batchResults = [];
	});

	it('skips total and latest queries for a normal continuation page', async () => {
		const result = await emailService.list({env: {}}, {
			emailId: 100,
			type: 0,
			accountId: 1,
			size: 50,
			timeSort: 0,
			allReceive: 1,
			lite: 1,
			withTotal: 0,
			withLatest: 0
		}, 7);

		expect(state.selectCalls).toBe(1);
		expect(result).toEqual({list: [], total: 0, hasMore: false});
	});

	it('skips total and latest queries for an administrator continuation page', async () => {
		const result = await emailService.allList({env: {}}, {
			emailId: 100,
			size: 50,
			timeSort: 0,
			lite: 1,
			withTotal: 0,
			withLatest: 0
		});

		expect(state.batchCalls).toBe(1);
		expect(state.selectCalls).toBe(1);
		expect(result).toEqual({list: [], total: 0, hasMore: false});
	});

	it('keeps the existing latestEmail contract when withLatest is omitted', async () => {
		state.batchResults = [[], null];
		const result = await emailService.list({env: {}}, {
			emailId: 100,
			type: 0,
			accountId: 1,
			size: 50,
			timeSort: 0,
			allReceive: 1,
			lite: 1,
			withTotal: 0
		}, 7);

		// 首屏语义：list+latest 合并进同一次 batch，仍是 1 次往返
		expect(state.batchCalls).toBe(1);
		expect(result.latestEmail).toEqual({emailId: 0, accountId: 1, userId: 7});
	});
});
