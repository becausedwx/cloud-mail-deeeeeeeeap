import BizError from '../error/biz-error';
import orm from '../entity/orm';
import { v4 as uuidv4 } from 'uuid';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import saltHashUtils from '../utils/crypto-utils';
import cryptoUtils from '../utils/crypto-utils';
import emailUtils from '../utils/email-utils';
import roleService from './role-service';
import verifyUtils from '../utils/verify-utils';
import { t } from '../i18n/i18n';
import reqUtils from '../utils/req-utils';
import dayjs from 'dayjs';
import { isDel, roleConst } from '../const/entity-const';
import email from '../entity/email';
import userService from './user-service';
import KvConst from '../const/kv-const';
import { truncateByBytes, LIKE_PATTERN_MAX_BYTES } from '../utils/sql-utils';
import accountService from './account-service';
import emailService from './email-service';

const PUBLIC_PREVIEW_TEXT_LENGTH = 240;
const PUBLIC_SEND_MAX_RECIPIENTS = 10;
const PUBLIC_SEND_CONTENT_MAX_BYTES = 1024 * 1024;
const PUBLIC_SEND_HOURLY_LIMIT = 100;

function toBoolFlag(value) {
	return value === true || value === 1 || value === '1' || String(value || '').toLowerCase() === 'true';
}

function previewText(row) {
	const text = row.previewText || row.text || '';
	return text
		.replace(/[\u200B-\u200F\uFEFF\u034F\u00A0\u3000\u00AD]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function publicEmailSelect(includeContent) {
	const fields = {
		emailId: email.emailId,
		sendEmail: email.sendEmail,
		sendName: email.name,
		subject: email.subject,
		toEmail: email.toEmail,
		toName: email.toName,
		type: email.type,
		createTime: email.createTime,
		previewText: sql`SUBSTR(${email.text}, 1, ${PUBLIC_PREVIEW_TEXT_LENGTH})`,
		isDel: email.isDel,
	};

	if (includeContent) {
		fields.content = email.content;
		fields.text = email.text;
	}

	return fields;
}

const publicService = {

	async sendEmail(c, params) {
		params = params || {};
		const { sendEmail, receiveEmail, subject, content, text } = params;

		if (typeof sendEmail !== 'string' || !sendEmail.trim()) {
			throw new BizError('sendEmail is required', 400);
		}
		if (receiveEmail === undefined || receiveEmail === null) {
			throw new BizError('receiveEmail is required', 400);
		}
		if (!Array.isArray(receiveEmail)) {
			throw new BizError('receiveEmail must be an array', 400);
		}
		if (receiveEmail.length < 1 || receiveEmail.length > PUBLIC_SEND_MAX_RECIPIENTS) {
			throw new BizError('receiveEmail must contain between 1 and 10 recipients', 400);
		}

		const uniqueReceiveEmail = [...new Set(receiveEmail)];
		if (uniqueReceiveEmail.some(email => typeof email !== 'string' || !verifyUtils.isEmail(email))) {
			throw new BizError('invalid recipient email', 400);
		}

		if (typeof subject !== 'string' || !subject.trim()) {
			throw new BizError('subject is required', 400);
		}
		if (subject.length > 998) {
			throw new BizError('subject exceeds 998 characters', 400);
		}
		if (content !== undefined && content !== null && typeof content !== 'string') {
			throw new BizError('content must be a string', 400);
		}
		if (text !== undefined && text !== null && typeof text !== 'string') {
			throw new BizError('text must be a string', 400);
		}

		const contentValue = content || '';
		const textValue = text || '';
		if (!contentValue.trim() && !textValue.trim()) {
			throw new BizError('content or text is required', 400);
		}
		if (new TextEncoder().encode(contentValue).length > PUBLIC_SEND_CONTENT_MAX_BYTES) {
			throw new BizError('content exceeds 1MB', 400);
		}

		const accountRow = await accountService.selectByEmailIncludeDel(c, sendEmail);
		if (!accountRow || accountRow.isDel !== isDel.NORMAL) {
			throw new BizError('sender account not found', 404);
		}

		const rateLimitKey = `public_send_limit:${dayjs().format('YYYYMMDDHH')}`;
		const sendCount = Number(await c.env.kv.get(rateLimitKey)) || 0;
		if (sendCount >= PUBLIC_SEND_HOURLY_LIMIT) {
			throw new BizError('send rate limit exceeded', 429);
		}
		await c.env.kv.put(rateLimitKey, String(sendCount + 1), { expirationTtl: 3700 });

		return emailService.send(c, {
			accountId: accountRow.accountId,
			name: params.name,
			receiveEmail: uniqueReceiveEmail,
			text: textValue,
			content: contentValue || textValue,
			subject,
			attachments: []
		}, accountRow.userId);
	},

	async emailList(c, params) {

		params = params || {};
		let { toEmail, content, subject, sendName, sendEmail, timeSort, num, size, type , isDel, includeContent } = params
		const withContent = toBoolFlag(includeContent);

		const query = orm(c).select(publicEmailSelect(withContent)).from(email)
		if (isDel === undefined || isDel === null || isDel === '') {
			isDel = 0;
		}

		if (!size) {
			size = 20
		}

		if (!num) {
			num = 1
		}

		size = Number(size);
		num = Number(num);
		if (!Number.isInteger(size) || size < 1) {
			size = 20;
		}
		if (size > 50) {
			size = 50;
		}
		if (!Number.isInteger(num) || num < 1) {
			num = 1;
		}

		num = (num - 1) * size;

		let conditions = []

		//公共接口的 LIKE 模式由调用方拼接，按 D1 50 字节硬限截断防止报错
		if (toEmail) {
			conditions.push(sql`${email.toEmail} COLLATE NOCASE LIKE ${truncateByBytes(toEmail, LIKE_PATTERN_MAX_BYTES)}`)
		}

		if (sendEmail) {
			conditions.push(sql`${email.sendEmail} COLLATE NOCASE LIKE ${truncateByBytes(sendEmail, LIKE_PATTERN_MAX_BYTES)}`)
		}

		if (sendName) {
			conditions.push(sql`${email.name} COLLATE NOCASE LIKE ${truncateByBytes(sendName, LIKE_PATTERN_MAX_BYTES)}`)
		}

		if (subject) {
			conditions.push(sql`${email.subject} COLLATE NOCASE LIKE ${truncateByBytes(subject, LIKE_PATTERN_MAX_BYTES)}`)
		}

		if (content) {
			conditions.push(sql`${email.content} COLLATE NOCASE LIKE ${truncateByBytes(content, LIKE_PATTERN_MAX_BYTES)}`)
		}

		if (type || type === 0) {
			conditions.push(eq(email.type, type))
		}

		if (isDel || isDel === 0) {
			conditions.push(eq(email.isDel, Number(isDel)))
		}

		if (conditions.length === 1) {
			query.where(...conditions)
		} else if (conditions.length > 1) {
			query.where(and(...conditions))
		}

		if (timeSort === 'asc') {
			query.orderBy(asc(email.emailId));
		} else {
			query.orderBy(desc(email.emailId));
		}

		const list = await query.limit(size).offset(num);
		return list.map(item => ({
			...item,
			previewText: previewText(item)
		}));

	},

	async addUser(c, params) {
		const { list } = params;

		if (!Array.isArray(list)) {
			throw new BizError('list must be an array');
		}

		if (list.length === 0) return;

		if (list.length > 100) {
			throw new BizError('A maximum of 100 users can be imported at once');
		}

		for (const emailRow of list) {
			if (!emailRow || typeof emailRow !== 'object') {
				throw new BizError('list item must be an object');
			}

			if (!verifyUtils.isEmail(emailRow.email)) {
				throw new BizError(t('notEmail'));
			}

			if (!c.env.domain.includes(emailUtils.getDomain(emailRow.email))) {
				throw new BizError(t('notEmailDomain'));
			}

			if (emailRow.password && (emailRow.password.length < 6 || emailRow.password.length > 30)) {
				throw new BizError(t(emailRow.password.length < 6 ? 'pwdMinLength' : 'pwdLengthLimit'));
			}

			const { salt, hash } = await saltHashUtils.hashPassword(
				emailRow.password || cryptoUtils.genRandomPwd()
			);

			emailRow.salt = salt;
			emailRow.hash = hash;
		}


		const activeIp = reqUtils.getIp(c);
		const { os, browser, device } = reqUtils.getUserAgent(c);
		const activeTime = dayjs().format('YYYY-MM-DD HH:mm:ss');

		const roleList = await roleService.roleSelectUse(c);
		const defRole = roleList.find(roleRow => roleRow.isDefault === roleConst.isDefault.OPEN);

		const userList = [];

		for (const emailRow of list) {
			let { email, hash, salt, roleName } = emailRow;
			let type = defRole.roleId;

			if (roleName) {
				const roleRow = roleList.find(role => role.name === roleName);
				type = roleRow ? roleRow.roleId : type;
			}

			userList.push(c.env.db.prepare(`
				INSERT INTO user (email, password, salt, type, os, browser, active_ip, create_ip, device, active_time, create_time)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).bind(email, hash, salt, type, os, browser, activeIp, activeIp, device, activeTime, activeTime));
			userList.push(c.env.db.prepare(`
				INSERT INTO account (email, name, user_id)
				VALUES (?, ?, 0)
			`).bind(email, emailUtils.getName(email)));

		}

		userList.push(c.env.db.prepare(`UPDATE account SET user_id = (SELECT user_id FROM user WHERE user.email = account.email) WHERE user_id = 0;`))

		try {
			await c.env.db.batch(userList);
		} catch (e) {
			if(e.message.includes('SQLITE_CONSTRAINT')) {
				throw new BizError(t('emailExistDatabase'))
			} else {
				throw e
			}
		}

	},

	async genToken(c, params) {

		await this.verifyUser(c, params)

		const uuid = uuidv4();

		await c.env.kv.put(KvConst.PUBLIC_KEY, uuid);

		return {token: uuid}
	},

	async verifyUser(c, params) {

		const { email, password } = params

		const userRow = await userService.selectByEmailIncludeDel(c, email);

		if (email !== c.env.admin) {
			throw new BizError(t('notAdmin'));
		}

		if (!userRow || userRow.isDel === isDel.DELETE) {
			throw new BizError(t('notExistUser'));
		}

		if (!await cryptoUtils.verifyPassword(password, userRow.salt, userRow.password)) {
			throw new BizError(t('IncorrectPwd'));
		}
	}

}

export default publicService
