import {beforeEach, describe, expect, it, vi} from 'vitest';

const state = {batchCalls: 0, statements: [], batchResults: []};

function context() {
	return {env: {db: {
		prepare(sql) {
			return {
				sql,
				bind(...bindings) {
					this.bindings = bindings;
					return this;
				}
			};
		},
		async batch(statements) {
			state.batchCalls++;
			state.statements = statements;
			return statements.map(() => ({results: state.batchResults.shift() ?? []}));
		}
	}}};
}

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

describe.each([
	{
		name: 'normal mailbox',
		method: 'list',
		params: {type: 0, accountId: 1, allReceive: 1},
		emptyLatest: {emailId: 0, accountId: 1, userId: 7}
	},
	{
		name: 'administrator mailbox',
		method: 'allList',
		params: {},
		emptyLatest: {emailId: 0, accountId: 0, userId: 0}
	}
])('$name batch list contract', ({method, params, emptyLatest}) => {
	function list(options = {}) {
		return emailService[method](context(), {
			emailId: 0,
			size: 50,
			timeSort: 0,
			lite: 1,
			...params,
			...options
		}, 7);
	}

	beforeEach(() => {
		state.batchCalls = 0;
		state.statements = [];
		state.batchResults = [];
	});

	it('returns the total and latest cursor as single values from one D1 batch', async () => {
		state.batchResults = [[], [{total: 7}], [{email_id: 42, account_id: 1, user_id: 7}]];

		const result = await list();

		expect(state.batchCalls).toBe(1);
		expect(state.statements).toHaveLength(3);
		expect(result).toEqual({
			list: [],
			total: 7,
			hasMore: false,
			latestEmail: {emailId: 42, accountId: 1, userId: 7}
		});
	});

	it('skips total and latest queries for a continuation page', async () => {
		const result = await list({
			emailId: 100,
			withTotal: 0,
			withLatest: 0
		});

		expect(state.batchCalls).toBe(1);
		expect(state.statements).toHaveLength(1);
		expect(result).toEqual({list: [], total: 0, hasMore: false});
	});

	it('keeps the existing latestEmail contract when withLatest is omitted', async () => {
		state.batchResults = [[], []];
		const result = await list({withTotal: 0});

		expect(state.batchCalls).toBe(1);
		expect(state.statements).toHaveLength(2);
		expect(result).toEqual({list: [], total: 0, hasMore: false, latestEmail: emptyLatest});
	});

	it('can include the total while omitting the latest query', async () => {
		state.batchResults = [[], [{total: 7}]];
		const result = await list({withLatest: 0});

		expect(state.batchCalls).toBe(1);
		expect(state.statements).toHaveLength(2);
		expect(result).toEqual({list: [], total: 7, hasMore: false});
	});
});
