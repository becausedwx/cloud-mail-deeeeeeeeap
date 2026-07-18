import { describe, expect, it } from 'vitest'
import userService from '../src/service/user-service'

const ACCOUNT = {
	accountId: 31,
	email: 'user@example.com',
	name: 'Inbox',
	status: 0,
	latestEmailTime: null,
	createTime: '2026-01-01 00:00:00',
	userId: 7,
	allReceive: 1,
	sort: 2,
	isDel: 0
}

const ROLE = {
	roleId: 4,
	name: 'member',
	key: 'member',
	description: null,
	banEmail: '',
	banEmailType: 0,
	availDomain: '',
	sort: 4,
	isDefault: 0,
	createTime: '2026-01-01 00:00:00',
	userId: 1,
	sendCount: 20,
	sendType: 'count',
	accountCount: 5
}

function createContext({
	email = 'user@example.com',
	userRows,
	accountRows = [ACCOUNT],
	roleRows = [ROLE],
	permRows = [{ permKey: 'email:send' }, { permKey: 'account:query' }],
	admin = 'admin@example.com'
} = {}) {
	const metrics = { prepareCalls: 0, batchCalls: 0, directCalls: 0 }
	const rows = userRows ?? [{ userId: 7, email, type: 4, sendCount: 3 }]
	const db = {
		prepare(sql) {
			metrics.prepareCalls++
			return {
				sql,
				bind(...bindings) {
					this.bindings = bindings
					return this
				},
				async first() {
					metrics.directCalls++
					throw new Error('login context must use db.batch')
				},
				async all() {
					metrics.directCalls++
					throw new Error('login context must use db.batch')
				}
			}
		},
		async batch(statements) {
			metrics.batchCalls++
			return statements.map(statement => {
				if (statement.sql.includes('FROM account a')) return { results: accountRows }
				if (statement.sql.includes('FROM role r')) return { results: roleRows }
				if (statement.sql.includes('FROM perm p')) return { results: permRows }
				return { results: rows }
			})
		}
	}
	return {
		metrics,
		context: {
			env: { db, admin },
			get() { return null }
		}
	}
}

describe('login user info query performance', () => {
	it('returns the existing normal-user contract in one D1 batch', async () => {
		const { context, metrics } = createContext()

		await expect(userService.loginUserInfo(context, 7)).resolves.toEqual({
			userId: 7,
			sendCount: 3,
			email: 'user@example.com',
			account: ACCOUNT,
			name: 'Inbox',
			permKeys: ['email:send', 'account:query'],
			role: ROLE,
			type: 4
		})
		expect(metrics).toEqual({ prepareCalls: 4, batchCalls: 1, directCalls: 0 })
	})

	it('preserves the administrator override without a second D1 wave', async () => {
		const adminAccount = { ...ACCOUNT, email: 'ADMIN@EXAMPLE.COM', name: 'Admin' }
		const { context, metrics } = createContext({
			email: 'ADMIN@EXAMPLE.COM',
			accountRows: [adminAccount],
			roleRows: [],
			permRows: [],
			admin: 'admin@example.com'
		})

		const result = await userService.loginUserInfo(context, 7)
		expect(result.type).toBe(0)
		expect(result.permKeys).toEqual(['*'])
		expect(result.role.name).toBe('admin')
		expect(result.account).toEqual(adminAccount)
		expect(metrics).toEqual({ prepareCalls: 4, batchCalls: 1, directCalls: 0 })
	})

	it('keeps a missing or soft-deleted user on the existing 401 contract', async () => {
		const { context, metrics } = createContext({ userRows: [] })

		await expect(userService.loginUserInfo(context, 7)).rejects.toMatchObject({ code: 401 })
		expect(metrics).toEqual({ prepareCalls: 4, batchCalls: 1, directCalls: 0 })
	})
})
