export const SEND_LIMITS = Object.freeze({
	maxRecipients: 10,
	maxAttachments: 10,
	maxAttachmentBytes: 10 * 1024 * 1024,
	maxAttachmentsBytes: 16 * 1024 * 1024,
	maxContentBytes: 1024 * 1024
});

export function getSendLimitViolation({
	recipientCount = 0,
	attachmentSizes = [],
	content = '',
	text = ''
} = {}) {
	if (recipientCount > SEND_LIMITS.maxRecipients) {
		return { type: 'recipients', limit: SEND_LIMITS.maxRecipients };
	}

	if (attachmentSizes.length > SEND_LIMITS.maxAttachments) {
		return { type: 'attachment-count', limit: SEND_LIMITS.maxAttachments };
	}

	const oversizedAttachment = attachmentSizes.find(size => size > SEND_LIMITS.maxAttachmentBytes);
	if (oversizedAttachment !== undefined) {
		return {
			type: 'attachment-size',
			limit: SEND_LIMITS.maxAttachmentBytes,
			size: oversizedAttachment
		};
	}

	const attachmentTotal = attachmentSizes.reduce((sum, size) => sum + (Number(size) || 0), 0);
	if (attachmentTotal > SEND_LIMITS.maxAttachmentsBytes) {
		return {
			type: 'attachment-total',
			limit: SEND_LIMITS.maxAttachmentsBytes,
			size: attachmentTotal
		};
	}

	const encoder = new TextEncoder();
	const contentSize = encoder.encode(content || '').byteLength
		+ encoder.encode(text || '').byteLength;
	if (contentSize > SEND_LIMITS.maxContentBytes) {
		return {
			type: 'content',
			limit: SEND_LIMITS.maxContentBytes,
			size: contentSize
		};
	}

	return null;
}
