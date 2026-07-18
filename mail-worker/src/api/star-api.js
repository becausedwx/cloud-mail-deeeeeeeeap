import app from '../hono/hono';
import starService from '../service/star-service';
import userContext from '../security/user-context';
import result from '../model/result';
import { readBoundedJson } from '../utils/request-body-utils';

const STAR_JSON_MAX_BYTES = 32 * 1024;

app.post('/star/add', async (c) => {
	await starService.add(c, await readBoundedJson(
		c,
		STAR_JSON_MAX_BYTES,
		'star JSON body exceeds 32 KiB'
	), userContext.getUserId(c));
	return c.json(result.ok());
});

app.get('/star/list', async (c) => {
	const data = await starService.list(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.delete('/star/cancel', async (c) => {
	await starService.cancel(c, await c.req.query(), userContext.getUserId(c));
	return c.json(result.ok());
});
