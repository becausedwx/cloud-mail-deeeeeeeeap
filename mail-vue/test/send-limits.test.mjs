import assert from 'node:assert/strict';
import test from 'node:test';
import {
	SEND_LIMITS,
	getSendLimitViolation
} from '../src/layout/write/send-limits.js';

test('accepts exact send resource boundaries', () => {
	assert.equal(getSendLimitViolation({
		recipientCount: SEND_LIMITS.maxRecipients,
		attachmentSizes: [SEND_LIMITS.maxAttachmentBytes, 6 * 1024 * 1024],
		content: 'h'.repeat(512 * 1024),
		text: 't'.repeat(512 * 1024)
	}), null);
});

test('reports each send resource limit before upload', () => {
	assert.equal(getSendLimitViolation({
		recipientCount: SEND_LIMITS.maxRecipients + 1
	})?.type, 'recipients');

	assert.equal(getSendLimitViolation({
		attachmentSizes: Array.from({ length: SEND_LIMITS.maxAttachments + 1 }, () => 1)
	})?.type, 'attachment-count');

	assert.equal(getSendLimitViolation({
		attachmentSizes: [SEND_LIMITS.maxAttachmentBytes + 1]
	})?.type, 'attachment-size');

	assert.equal(getSendLimitViolation({
		attachmentSizes: [SEND_LIMITS.maxAttachmentBytes, 6 * 1024 * 1024 + 1]
	})?.type, 'attachment-total');

	assert.equal(getSendLimitViolation({
		content: 'h'.repeat(512 * 1024 + 1),
		text: 't'.repeat(512 * 1024)
	})?.type, 'content');
});
