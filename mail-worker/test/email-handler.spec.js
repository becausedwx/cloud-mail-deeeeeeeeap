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

	it('rejects more than ten incoming attachments before hashing or persistence', async () => {
		mocks.parse.mockResolvedValue(parsedEmail({
			attachments: Array.from({ length: 11 }, (_, index) => ({
				content: new Uint8Array([index]),
				filename: `attachment-${index}.txt`,
				mimeType: 'text/plain'
			}))
		}));
		const incoming = message();

		await handleEmail(incoming, {}, {});

		expect(incoming.setReject).toHaveBeenCalledWith('Too many attachments');
		expect(mocks.getBuffHash).not.toHaveBeenCalled();
		expect(mocks.receive).not.toHaveBeenCalled();
		expect(mocks.addAtt).not.toHaveBeenCalled();
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
			'ATTACHMENT_STORAGE_FAILED'
		);
		expect(mocks.completeReceive).not.toHaveBeenCalled();
	});

	it('persists the expected attachment count before attachment storage begins', async () => {
		mocks.parse.mockResolvedValue(parsedEmail({
			attachments: [
				{
					content: new Uint8Array([1]),
					filename: 'first.pdf',
					mimeType: 'application/pdf'
				},
				{
					content: new Uint8Array([2]),
					filename: 'second.pdf',
					mimeType: 'application/pdf'
				}
			]
		}));

		await handleEmail(message(), {}, {});

		expect(mocks.receive).toHaveBeenCalledWith(
			{ env: {} },
			expect.objectContaining({ attachmentCount: 2 }),
			expect.any(Array),
			undefined
		);
	});

	it('keeps the email saving when the object exists but the ready-state update is uncertain', async () => {
		mocks.parse.mockResolvedValue(parsedEmail({
			attachments: [{
				content: new Uint8Array([1, 2, 3]),
				filename: 'report.pdf',
				mimeType: 'application/pdf'
			}]
		}));
		const stateError = new Error('Attachment state update failed');
		stateError.attachmentRecoveryPending = true;
		mocks.addAtt.mockRejectedValue(stateError);

		await expect(handleEmail(message(), {}, {}))
			.rejects.toThrow('Attachment state update failed');

		expect(mocks.failReceive).not.toHaveBeenCalled();
		expect(mocks.completeReceive).not.toHaveBeenCalled();
	});
});
