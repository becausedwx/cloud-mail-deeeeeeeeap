import BizError from '../error/biz-error';

export async function readBoundedText(
	c,
	maxBytes,
	limitMessage = 'Request body is too large',
	invalidMessage = 'invalid request body'
) {
	if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
		throw new TypeError('maxBytes must be a positive integer');
	}

	const declaredLength = Number(c.req.header('content-length'));
	if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
		throw new BizError(limitMessage, 413);
	}

	const body = c.req.raw.body;
	if (!body) {
		throw new BizError(invalidMessage, 400);
	}

	const reader = body.getReader();
	const decoder = new TextDecoder();
	const parts = [];
	let size = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			size += value.byteLength;
			if (size > maxBytes) {
				try {
					await reader.cancel();
				} catch (e) {
					// The size error below is authoritative even if cancellation fails.
				}
				throw new BizError(limitMessage, 413);
			}

			parts.push(decoder.decode(value, { stream: true }));
		}
		parts.push(decoder.decode());
	} catch (e) {
		if (e instanceof BizError) throw e;
		throw new BizError(invalidMessage, 400);
	}

	return parts.join('');
}

export async function readBoundedJson(c, maxBytes, limitMessage = 'JSON body is too large') {
	const rawBody = await readBoundedText(
		c,
		maxBytes,
		limitMessage,
		'invalid JSON body'
	);

	try {
		return JSON.parse(rawBody);
	} catch (e) {
		throw new BizError('invalid JSON body', 400);
	}
}
