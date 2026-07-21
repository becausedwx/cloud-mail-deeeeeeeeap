import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emailConst, isDel, settingConst } from '../src/const/entity-const';
import { t } from '../src/i18n/i18n';
import emailService from '../src/service/email-service';
import roleService from '../src/service/role-service';
import settingService from '../src/service/setting-service';

const USERS = {
	owner: { userId: 101, accountId: 201, email: 'owner@example.com' },
	other: { userId: 102, accountId: 202, email: 'other@example.com' },
	admin: { userId: 103, accountId: 203, email: 'admin@example.com' }
};

const TARGETS = {
	ownerReceived: 501,
	ownerSent: 502,
	otherReceived: 503,
	ownerDeleted: 504
};

async function initializeDatabase() {
	const response = await SELF.fetch('http://example.com/api/init', {
		method: 'POST',
		headers: { 'X-Cloud-Mail-Init-Secret': 'your-jwt-secret' }
	});

	expect(response.status).toBe(200);
	expect(await response.text()).toBe('success');
}

async function seedReplyFixtures() {
	await env.db.batch([
		env.db.prepare('DELETE FROM delivery_attempt'),
		env.db.prepare('DELETE FROM attachments'),
		env.db.prepare('DELETE FROM star'),
		env.db.prepare('DELETE FROM email_search'),
		env.db.prepare('DELETE FROM email'),
		env.db.prepare('DELETE FROM account'),
		env.db.prepare('DELETE FROM user'),
		env.db.prepare("UPDATE setting SET send = ?").bind(settingConst.send.OPEN),
		env.db.prepare("UPDATE role SET send_type = 'count', send_count = 0, avail_domain = '', ban_email = '' WHERE role_id = 1"),
		...Object.values(USERS).map(user => env.db.prepare(`
			INSERT INTO user (user_id, email, type, password, salt, status, send_count, is_del)
			VALUES (?, ?, 1, 'hash', 'salt', 0, 0, 0)
		`).bind(user.userId, user.email)),
		...Object.values(USERS).map(user => env.db.prepare(`
			INSERT INTO account (account_id, email, name, status, user_id, all_receive, sort, is_del)
			VALUES (?, ?, 'Mailbox', 0, ?, 0, 0, 0)
		`).bind(user.accountId, user.email, user.userId)),
		env.db.prepare(`
			INSERT INTO email (email_id, account_id, user_id, send_email, to_email, subject, message_id, type, status, is_del)
			VALUES
				(?, ?, ?, 'sender@example.net', ?, 'Owner received', 'owner-received-message', ?, ?, ?),
				(?, ?, ?, ?, 'recipient@example.net', 'Owner sent', 'owner-sent-message', ?, ?, ?),
				(?, ?, ?, 'sender@example.net', ?, 'Other received', 'other-received-message', ?, ?, ?),
				(?, ?, ?, 'sender@example.net', ?, 'Owner deleted', 'owner-deleted-message', ?, ?, ?)
		`).bind(
			TARGETS.ownerReceived,
			USERS.owner.accountId,
			USERS.owner.userId,
			USERS.owner.email,
			emailConst.type.RECEIVE,
			emailConst.status.RECEIVE,
			isDel.NORMAL,
			TARGETS.ownerSent,
			USERS.owner.accountId,
			USERS.owner.userId,
			USERS.owner.email,
			emailConst.type.SEND,
			emailConst.status.DELIVERED,
			isDel.NORMAL,
			TARGETS.otherReceived,
			USERS.other.accountId,
			USERS.other.userId,
			USERS.other.email,
			emailConst.type.RECEIVE,
			emailConst.status.RECEIVE,
			isDel.NORMAL,
			TARGETS.ownerDeleted,
			USERS.owner.accountId,
			USERS.owner.userId,
			USERS.owner.email,
			emailConst.type.RECEIVE,
			emailConst.status.RECEIVE,
			isDel.DELETE
		)
	]);
	roleService.clearCache();
	await settingService.refresh({ env });
}

function replyParams(emailId, accountId = USERS.owner.accountId) {
	return {
		accountId,
		name: 'Sender',
		sendType: 'reply',
		emailId,
		receiveEmail: [USERS.other.email],
		text: 'Reply body',
		content: '<p>Reply body</p>',
		subject: 'Reply subject'
	};
}

describe('reply target ownership', () => {
	beforeAll(initializeDatabase);
	beforeEach(seedReplyFixtures);

	it.each([
		['received', TARGETS.ownerReceived, 'owner-received-message'],
		['sent', TARGETS.ownerSent, 'owner-sent-message']
	])('lets a user reply to their own %s mail', async (_kind, emailId, messageId) => {
		const [sent] = await emailService.send(
			{ env },
			replyParams(emailId),
			USERS.owner.userId
		);

		expect(sent).toMatchObject({
			userId: USERS.owner.userId,
			accountId: USERS.owner.accountId,
			inReplyTo: messageId,
			relation: messageId
		});
	});

	it('does not let a user reply to another user\'s mail', async () => {
		await expect(emailService.send(
			{ env },
			replyParams(TARGETS.otherReceived),
			USERS.owner.userId
		)).rejects.toMatchObject({
			message: t('notExistEmailReply')
		});

		expect(await env.db.prepare(`
			SELECT COUNT(*) AS count
			FROM email
			WHERE subject = 'Reply subject'
		`).first()).toMatchObject({ count: 0 });
	});

	it.each([
		['soft-deleted', TARGETS.ownerDeleted],
		['missing', 999999]
	])('returns the same not-found error for a %s reply target', async (_kind, emailId) => {
		await expect(emailService.send(
			{ env },
			replyParams(emailId),
			USERS.owner.userId
		)).rejects.toMatchObject({
			message: t('notExistEmailReply')
		});
	});

	it('does not let the administrator reply to another user\'s mail', async () => {
		await expect(emailService.send(
			{ env },
			replyParams(TARGETS.ownerReceived, USERS.admin.accountId),
			USERS.admin.userId
		)).rejects.toMatchObject({
			message: t('notExistEmailReply')
		});
	});
});
