import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emailConst, isDel, settingConst } from '../src/const/entity-const';

function base64ForDecodedSize(size) {
	const padding = (3 - size % 3) % 3;
	return 'A'.repeat(Math.ceil(size / 3) * 4 - padding) + '='.repeat(padding);
}

const mockState = vi.hoisted(() => ({
	selectResults: [],
	updates: [],
	insertValues: [],
	operationLog: [],
	settingResult: {},
	userRow: {},
	roleRow: {},
	accountRow: {},
	imageResult: { imageDataList: [], html: '<p>Hello</p>' }
}));

vi.mock('../src/entity/orm', () => ({
	default: vi.fn(() => ({
		select() {
			return {
				from() {
					return {
						where() {
							return {
								async all() {
									return mockState.selectResults.shift() || [];
								}
							};
						}
					};
				}
			};
		},
		update() {
			return {
				set(values) {
					mockState.updates.push(values);
					mockState.operationLog.push({ type: 'update', values });
					return {
						where() {
							return {
								async run() {
									return { success: true };
								}
							};
						}
					};
				}
			};
		},
		insert() {
			return {
				values(values) {
					mockState.insertValues.push(values);
					mockState.operationLog.push({ type: 'insert', values });
					return {
						returning() {
							return {
								async get() {
									return { emailId: 1001, accountId: 1, userId: 1 };
								}
							};
						},
						async run() {
							return { success: true };
						}
					};
				}
			};
		}
	}))
}));

vi.mock('../src/service/email-search-service', () => ({
	default: {
		syncEmailIds: vi.fn(),
		removeEmailIds: vi.fn()
	}
}));

vi.mock('../src/service/setting-service', () => ({
	default: {
		query: vi.fn(async () => mockState.settingResult)
	}
}));

vi.mock('../src/service/role-service', () => ({
	default: {
		selectById: vi.fn(async () => mockState.roleRow),
		selectByUserIds: vi.fn(async () => []),
		hasAvailDomainPerm: vi.fn(() => true),
		isBanEmail: vi.fn(() => false)
	}
}));

vi.mock('../src/service/user-service', () => ({
	default: {
		selectById: vi.fn(async () => mockState.userRow)
	}
}));

vi.mock('../src/service/account-service', () => ({
	default: {
		selectById: vi.fn(async () => mockState.accountRow)
	}
}));

vi.mock('../src/service/att-service', () => ({
	default: {
		toImageUrlHtml: vi.fn(async () => mockState.imageResult),
		saveArticleAtt: vi.fn(async () => {
			mockState.operationLog.push({ type: 'saveArticleAtt' });
		}),
		saveSendAtt: vi.fn(async () => {
			mockState.operationLog.push({ type: 'saveSendAtt' });
		}),
		selectByEmailIds: vi.fn(async () => [])
	}
}));

const { default: emailSearchService } = await import('../src/service/email-search-service');
const { default: attService } = await import('../src/service/att-service');
const { default: emailService } = await import('../src/service/email-service');

function createDbRecorder(selectRows = [], onRun = null) {
	const statements = [];
	return {
		statements,
		db: {
			prepare(sql) {
				const statement = {
					sql,
					bindings: [],
					bind(...args) {
						this.bindings = args;
						return this;
					},
					async all() {
						return { results: selectRows };
					},
					async run() {
						if (onRun) {
							return onRun(this);
						}
						return { success: true };
					}
				};
				statements.push(statement);
				return statement;
			}
		}
	};
}

describe('email service status synchronization', () => {
	beforeEach(() => {
		mockState.selectResults = [];
		mockState.updates = [];
		mockState.insertValues = [];
		mockState.operationLog = [];
		mockState.settingResult = {
			noRecipient: settingConst.noRecipient.CLOSE,
			resendTokens: {},
			r2Domain: 'https://assets.example.com',
			send: settingConst.send.OPEN,
			domainList: ['@internal.example.com']
		};
		mockState.userRow = {
			userId: 1,
			email: 'sender@example.com',
			type: 1,
			sendCount: 0
		};
		mockState.roleRow = {
			sendType: 'count',
			sendCount: 0,
			availDomain: ''
		};
		mockState.accountRow = {
			accountId: 1,
			userId: 1,
			email: 'sender@example.com'
		};
		mockState.imageResult = { imageDataList: [], html: '<p>Hello</p>' };
		vi.clearAllMocks();
	});

	it('syncs the sender row after an internal recipient bounce changes its status', async () => {
		const c = { env: { admin: 'admin@example.com', db: createDbRecorder().db } };
		mockState.selectResults = [[]];

		await emailService.HandleOnSiteEmail(c, ['missing@example.com'], {
			emailId: 99,
			sendEmail: 'sender@example.com',
			status: emailConst.status.DELIVERED,
			type: emailConst.type.SEND
		}, []);

		expect(mockState.updates[0]).toMatchObject({ status: emailConst.status.BOUNCED });
		expect(emailSearchService.syncEmailIds).toHaveBeenCalledWith(c, [99]);
	});

	it('recovers stale SAVING messages regardless of is_del and restores them to normal', async () => {
		const recorder = createDbRecorder([{ emailId: 1 }, { emailId: 2 }]);
		const c = { env: { db: recorder.db } };
		mockState.selectResults = [[{ emailId: 1 }, { emailId: 2 }]];

		await emailService.completeReceiveAll(c);

		const selectStatement = recorder.statements.find(statement => statement.sql.includes('SELECT email_id'));
		expect(selectStatement.sql).not.toContain('is_del = ?');
		expect(selectStatement.sql).toContain("datetime('now', '-10 minutes')");

		const updateStatements = recorder.statements.filter(statement => statement.sql.includes('UPDATE email'));
		expect(updateStatements).toHaveLength(2);
		expect(updateStatements.every(statement => statement.sql.includes('is_del = ?'))).toBe(true);
		expect(updateStatements.every(statement => statement.sql.includes("datetime('now', '-10 minutes')"))).toBe(true);
		expect(updateStatements[0].bindings).toEqual([emailConst.status.RECEIVE, isDel.NORMAL, emailConst.status.SAVING, emailConst.type.RECEIVE]);
		expect(updateStatements[1].bindings).toEqual([emailConst.status.NOONE, isDel.NORMAL, emailConst.status.SAVING, emailConst.type.RECEIVE]);
		expect(emailSearchService.syncEmailIds).toHaveBeenCalledWith(c, [1, 2]);
	});

	it('marks failed incoming attachment storage without making the email visible', async () => {
		const c = { env: { db: createDbRecorder().db } };

		await emailService.failReceive(c, 55, 'object upload failed');

		expect(mockState.updates[0]).toEqual({
			status: emailConst.status.FAILED,
			message: 'object upload failed'
		});
		expect(emailSearchService.syncEmailIds).not.toHaveBeenCalled();
	});

	it('updates AI-extracted codes only while the code field is still empty', async () => {
		const recorder = createDbRecorder();
		const c = { env: { db: recorder.db } };

		await emailService.updateCode(c, 55, 'AB12CD');

		const updateStatement = recorder.statements.find(statement => statement.sql.includes('UPDATE email'));
		expect(updateStatement.sql).toContain("WHERE email_id = ? AND code = ''");
		expect(updateStatement.bindings).toEqual(['AB12CD', 55]);
		expect(emailSearchService.syncEmailIds).toHaveBeenCalledWith(c, [55]);
	});

	it('rejects too many outbound attachments before local insert or provider send', async () => {
		const sendMock = vi.fn();
		const c = {
			env: {
				admin: 'admin@example.com',
				email: { send: sendMock },
				kv: {
					get: vi.fn(),
					put: vi.fn()
				}
			}
		};

		await expect(emailService.send(c, {
			accountId: 1,
			name: 'Sender',
			sendType: 'new',
			receiveEmail: ['to@external.example.com'],
			text: 'Hello',
			content: '<p>Hello</p>',
			subject: 'Hello',
			attachments: Array.from({ length: 11 }, (_, index) => ({
				filename: `file-${index}.txt`,
				type: 'text/plain',
				content: 'YQ=='
			}))
		}, 1)).rejects.toThrow();

		expect(sendMock).not.toHaveBeenCalled();
		expect(mockState.insertValues).toHaveLength(0);
		expect(attService.saveSendAtt).not.toHaveBeenCalled();
	});

	it('allows a 3 MiB attachment below the Cloudflare Email limit', async () => {
		const sendMock = vi.fn(async () => ({ messageId: 'cf-three-mib' }));
		const c = {
			env: {
				admin: 'admin@example.com',
				email: { send: sendMock },
				kv: {
					get: vi.fn(async () => null),
					put: vi.fn(async () => {})
				}
			}
		};

		await emailService.send(c, {
			accountId: 1,
			name: 'Sender',
			receiveEmail: ['to@external.example.com'],
			text: 'See attachment',
			content: '<p>See attachment</p>',
			subject: '3 MiB PDF',
			attachments: [{
				filename: 'report.pdf',
				contentType: 'application/pdf',
				content: base64ForDecodedSize(3 * 1024 * 1024)
			}]
		}, 1);

		expect(sendMock).toHaveBeenCalledOnce();
		expect(sendMock.mock.calls[0][0].attachments[0]).toMatchObject({
			filename: 'report.pdf',
			type: 'application/pdf',
			disposition: 'attachment'
		});
		expect(sendMock.mock.calls[0][0].attachments[0].content.byteLength).toBe(3 * 1024 * 1024);
	});

	it('rejects Cloudflare Email messages over 5 MiB before persistence', async () => {
		const sendMock = vi.fn();
		const c = {
			env: {
				admin: 'admin@example.com',
				email: { send: sendMock },
				kv: {
					get: vi.fn(async () => null),
					put: vi.fn(async () => {})
				}
			}
		};

		await expect(emailService.send(c, {
			accountId: 1,
			name: 'Sender',
			receiveEmail: ['to@external.example.com'],
			text: 'Hello',
			content: '<p>Hello</p>',
			subject: 'Hello',
			attachments: [{
				filename: 'large.bin',
				contentType: 'application/octet-stream',
				content: base64ForDecodedSize(4 * 1024 * 1024)
			}]
		}, 1)).rejects.toMatchObject({
			code: 413,
			message: 'Cloudflare Email message exceeds 5 MiB limit'
		});

		expect(mockState.insertValues).toHaveLength(0);
		expect(attService.saveSendAtt).not.toHaveBeenCalled();
		expect(sendMock).not.toHaveBeenCalled();
	});

	it('rejects Resend messages over 40 MB before persistence', async () => {
		mockState.settingResult.resendTokens = { 'example.com': 're_test' };
		const providerSpy = vi.spyOn(emailService, 'sendByResend').mockResolvedValue({
			data: { id: 'resend-message-1' }
		});
		const content = base64ForDecodedSize(15 * 1024 * 1024);
		const c = {
			env: {
				admin: 'admin@example.com',
				kv: {
					get: vi.fn(async () => null),
					put: vi.fn(async () => {})
				}
			}
		};

		try {
			await expect(emailService.send(c, {
				accountId: 1,
				name: 'Sender',
				receiveEmail: ['to@external.example.com'],
				text: 'Hello',
				content: '<p>Hello</p>',
				subject: 'Hello',
				attachments: [0, 1].map(index => ({
					filename: `part-${index}.bin`,
					contentType: 'application/octet-stream',
					content
				}))
			}, 1)).rejects.toMatchObject({
				code: 413,
				message: 'Resend message exceeds 40 MB limit'
			});

			expect(mockState.insertValues).toHaveLength(0);
			expect(attService.saveSendAtt).not.toHaveBeenCalled();
			expect(providerSpy).not.toHaveBeenCalled();
		} finally {
			providerSpy.mockRestore();
		}
	});

	it('persists outbound row and attachments before external provider send', async () => {
		const sendMock = vi.fn(async () => {
			mockState.operationLog.push({ type: 'provider' });
			return { messageId: 'cf-message-1' };
		});
		const c = {
			env: {
				admin: 'admin@example.com',
				email: { send: sendMock },
				kv: {
					get: vi.fn(async () => null),
					put: vi.fn(async () => {})
				}
			}
		};

		const [emailResult] = await emailService.send(c, {
			accountId: 1,
			name: 'Sender',
			sendType: 'new',
			receiveEmail: ['to@external.example.com'],
			text: 'Hello',
			content: '<p>Hello</p>',
			subject: 'Hello',
			attachments: [{
				filename: 'hello.txt',
				type: 'text/plain',
				content: 'YQ=='
			}]
		}, 1);

		const operationTypes = mockState.operationLog.map(operation => operation.type);
		expect(operationTypes.indexOf('insert')).toBeLessThan(operationTypes.indexOf('saveSendAtt'));
		expect(operationTypes.indexOf('saveSendAtt')).toBeLessThan(operationTypes.indexOf('provider'));
		expect(operationTypes.indexOf('provider')).toBeLessThan(operationTypes.lastIndexOf('update'));
		expect(mockState.insertValues[0].status).toBe(emailConst.status.SAVING);
		expect(mockState.updates.at(-1)).toMatchObject({
			status: emailConst.status.DELIVERED,
			resendEmailId: 'cf-message-1'
		});
		expect(emailResult.status).toBe(emailConst.status.DELIVERED);
		expect(emailResult.resendEmailId).toBe('cf-message-1');
	});

	it('marks outbound mail failed when local attachment storage fails', async () => {
		const sendMock = vi.fn();
		const c = {
			env: {
				admin: 'admin@example.com',
				email: { send: sendMock },
				kv: {
					get: vi.fn(async () => null),
					put: vi.fn(async () => {})
				}
			}
		};
		attService.saveSendAtt.mockRejectedValueOnce(new Error('object upload failed'));

		await expect(emailService.send(c, {
			accountId: 1,
			name: 'Sender',
			sendType: 'new',
			receiveEmail: ['to@external.example.com'],
			text: 'Hello',
			content: '<p>Hello</p>',
			subject: 'Hello',
			attachments: [{
				filename: 'hello.txt',
				type: 'text/plain',
				content: 'YQ=='
			}]
		}, 1)).rejects.toThrow('object upload failed');

		expect(sendMock).not.toHaveBeenCalled();
		expect(mockState.updates.at(-1)).toMatchObject({
			status: emailConst.status.FAILED,
			message: 'object upload failed'
		});
	});

	it('keeps an atomically reserved send attempt counted when local storage fails', async () => {
		let reservedCount = 0;
		const recorder = createDbRecorder([], statement => {
			if (statement.sql.includes('UPDATE user') && statement.sql.includes('SET send_count')) {
				reservedCount += statement.bindings[0];
				return { success: true, meta: { changes: 1 } };
			}
			return { success: true };
		});
		const sendMock = vi.fn();
		const c = {
			env: {
				admin: 'admin@example.com',
				db: recorder.db,
				email: { send: sendMock },
				kv: {
					get: vi.fn(async () => null),
					put: vi.fn(async () => {})
				}
			}
		};
		mockState.roleRow = {
			roleId: 1,
			sendType: 'count',
			sendCount: 2,
			availDomain: ''
		};
		attService.saveSendAtt.mockRejectedValueOnce(new Error('object upload failed'));

		await expect(emailService.send(c, {
			accountId: 1,
			name: 'Sender',
			receiveEmail: ['to@external.example.com'],
			text: 'Hello',
			content: '<p>Hello</p>',
			subject: 'Hello',
			attachments: [{
				filename: 'hello.txt',
				contentType: 'text/plain',
				content: 'YQ=='
			}]
		}, 1)).rejects.toThrow('object upload failed');

		expect(reservedCount).toBe(1);
		expect(recorder.statements.filter(statement => statement.sql.includes('UPDATE user')))
			.toHaveLength(1);
		expect(sendMock).not.toHaveBeenCalled();
	});
});
