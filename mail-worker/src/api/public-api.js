import app from '../hono/hono';
import result from '../model/result';
import publicService from '../service/public-service';
import BizError from '../error/biz-error';

const PUBLIC_SEND_JSON_MAX_BYTES = 24 * 1024 * 1024;
const PUBLIC_SEND_JSON_LIMIT_MESSAGE = 'public send JSON body exceeds 24 MiB';

async function readPublicSendJson(c) {
	const declaredLength = Number(c.req.header('content-length'));
	if (Number.isFinite(declaredLength) && declaredLength > PUBLIC_SEND_JSON_MAX_BYTES) {
		throw new BizError(PUBLIC_SEND_JSON_LIMIT_MESSAGE, 413);
	}

	const body = c.req.raw.body;
	if (!body) {
		throw new BizError('invalid JSON body', 400);
	}

	const reader = body.getReader();
	const decoder = new TextDecoder();
	let size = 0;
	let jsonText = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			size += value.byteLength;
			if (size > PUBLIC_SEND_JSON_MAX_BYTES) {
				try {
					await reader.cancel();
				} catch (e) {
					// The size error below is authoritative even if cancellation fails.
				}
				throw new BizError(PUBLIC_SEND_JSON_LIMIT_MESSAGE, 413);
			}

			jsonText += decoder.decode(value, { stream: true });
		}
		jsonText += decoder.decode();
	} catch (e) {
		if (e instanceof BizError) throw e;
		throw new BizError('invalid JSON body', 400);
	}

	try {
		return JSON.parse(jsonText);
	} catch (e) {
		throw new BizError('invalid JSON body', 400);
	}
}

app.post('/public/genToken', async (c) => {
	const data = await publicService.genToken(c, await c.req.json());
	return c.json(result.ok(data));
});

app.post('/public/emailList', async (c) => {
	const list = await publicService.emailList(c, await c.req.json());
	return c.json(result.ok(list));
});

app.post('/public/addUser', async (c) => {
	await publicService.addUser(c, await c.req.json());
	return c.json(result.ok());
});

app.post('/public/sendEmail', async (c) => {
	const data = await publicService.sendEmail(c, await readPublicSendJson(c));
	return c.json(result.ok(data));
});
