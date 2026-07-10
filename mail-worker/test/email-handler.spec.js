import { beforeEach, describe, expect, it, vi } from 'vitest';
import { settingConst } from '../src/const/entity-const';

const mocks = vi.hoisted(() => ({
	parse: vi.fn(),
	querySetting: vi.fn(),
	selectAccount: vi.fn(),
	receive: vi.fn(),
	completeReceive: vi.fn(),
	failReceive: vi.fn(),
	updateCode: vi.fn(),
	addAtt: vi.fn(),
	extractCodeByPattern: vi.fn(),
	shouldExtractCode: vi.fn(),
	extractCode: vi.fn(),
	sendEmailToBot: vi.fn(),
	getBuffHash: vi.fn(),
	getExtFileName: vi.fn()
}));

vi.mock('postal-mime', () => ({
	default: { parse: mocks.parse }
}));

vi.mock('../src/service/setting-service', () => ({
	default: { query: mocks.querySetting }
}));

vi.mock('../src/service/account-service', () => ({
	default: { selectByEmailIncludeDel: mocks.selectAccount }
}));

vi.mock('../src/service/email-service', () => ({
	default: {
		receive: mocks.receive,
		completeReceive: mocks.completeReceive,
		failReceive: mocks.failReceive,
		updateCode: mocks.updateCode
	}
}));

vi.mock('../src/service/att-service', () => ({
	default: { addAtt: mocks.addAtt }
}));

vi.mock('../src/service/ai-service', () => ({
	default: {
		extractCodeByPattern: mocks.extractCodeByPattern,
		shouldExtractCode: mocks.shouldExtractCode,
		extractCode: mocks.extractCode
	}
}));

vi.mock('../src/service/telegram-service', () => ({
	default: { sendEmailToBot: mocks.sendEmailToBot }
}));

vi.mock('../src/utils/file-utils', () => ({
	default: {
		getBuffHash: mocks.getBuffHash,
		getExtFileName: mocks.getExtFileName
	}
}));

const { email: handleEmail } = await import('../src/email/email');

function parsedEmail(overrides = {}) {
	return {
		from: { address: 'sender@example.com', name: 'Sender' },
		to: [{ address: 'inbox@example.com', name: 'Inbox' }],
		subject: 'A normal message',
		html: '<p>Hello</p>',
		text: 'Hello',
		attachments: [],
		...overrides
	};
}

function settings(overrides = {}) {
	return {
		receive: settingConst.receive.OPEN,
		noRecipient: settingConst.noRecipient.OPEN,
		ruleType: settingConst.ruleType.ALL,
		tgBotStatus: settingConst.tgBotStatus.CLOSE,
		forwardStatus: settingConst.forwardStatus.CLOSE,
		blackSubject: '',
		blackContent: '',
		blackFrom: '',
		aiCode: settingConst.aiCode.CLOSE,
		...overrides
	};
}

function message() {
	return {
		raw: new Uint8Array(),
		to: 'inbox@example.com',
		setReject: vi.fn(),
		forward: vi.fn()
	};
}

describe('incoming email handler', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.parse.mockResolvedValue(parsedEmail());
		mocks.querySetting.mockResolvedValue(settings());
		mocks.selectAccount.mockResolvedValue(null);
		mocks.receive.mockResolvedValue({ emailId: 1, userId: 0, accountId: 0 });
		mocks.completeReceive.mockResolvedValue({ emailId: 1 });
		mocks.failReceive.mockResolvedValue();
		mocks.addAtt.mockResolvedValue();
		mocks.extractCodeByPattern.mockReturnValue('');
		mocks.shouldExtractCode.mockReturnValue(false);
		mocks.getBuffHash.mockResolvedValue('hash');
		mocks.getExtFileName.mockReturnValue('.pdf');
	});

	it('ignores empty and whitespace-only blacklist entries', async () => {
		mocks.querySetting.mockResolvedValue(settings({
			blackSubject: ' , ,',
			blackContent: ',',
			blackFrom: ' ,'
		}));
		const incoming = message();

		await handleEmail(incoming, {}, {});

		expect(incoming.setReject).not.toHaveBeenCalled();
		expect(mocks.receive).toHaveBeenCalledOnce();
		expect(mocks.completeReceive).toHaveBeenCalledOnce();
	});

	it('still rejects a non-empty blacklist match', async () => {
		mocks.querySetting.mockResolvedValue(settings({ blackSubject: 'blocked' }));
		mocks.parse.mockResolvedValue(parsedEmail({ subject: 'This is blocked' }));
		const incoming = message();

		await handleEmail(incoming, {}, {});

		expect(incoming.setReject).toHaveBeenCalledWith('Message rejected');
		expect(mocks.receive).not.toHaveBeenCalled();
	});

	it('does not complete an incoming email when attachment storage fails', async () => {
		mocks.parse.mockResolvedValue(parsedEmail({
			attachments: [{
				content: new Uint8Array([1, 2, 3]),
				filename: 'report.pdf',
				mimeType: 'application/pdf'
			}]
		}));
		mocks.addAtt.mockRejectedValue(new Error('object upload failed'));
		const incoming = message();

		await expect(handleEmail(incoming, {}, {})).rejects.toThrow('object upload failed');

		expect(mocks.failReceive).toHaveBeenCalledWith(
			{ env: {} },
			1,
			'object upload failed'
		);
		expect(mocks.completeReceive).not.toHaveBeenCalled();
	});
});
